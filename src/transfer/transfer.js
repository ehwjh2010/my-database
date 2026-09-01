import { toast } from "../ui/toast.js";
import { serializeCsv, parseCsv } from "../lib/parse/csv.js";
import { quoteIdent, quoteLiteral, qualifiedName } from "../lib/sql/quote.js";
import { buildSelect } from "../lib/sql/select-builder.js";
import { writeTextFile, readTextFile } from "../lib/secure-file.js";
import { pickOpenFile } from "../lib/pick-file.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { splitForEngine } from "../lib/sql/statement-split.js";
import { clampPercent, transferPercent } from "../lib/transfer-percent.js";

export const OBJECT_EXPORT_LIMIT = 1000000;
const CSV_BATCH = 50;
const STATEMENT_BATCH = 100;
const TRANSFER_TIMEOUT = 600000;

const TRANSFER_DIALOG = {
    dump: { title: "Export database", icon: "download", running: "Dumping database", done: "Dump written", error: "Dump failed" },
    restore: { title: "Import database", icon: "upload", running: "Importing database", done: "Dump imported", error: "Import failed" },
    export: { title: "Export object", icon: "download", running: "Exporting object", done: "Export complete", error: "Export failed" },
    import: { title: "Import data", icon: "upload", running: "Importing data", done: "Data imported", error: "Import failed" },
};

export function transferDialogFor(progress) {
    const copy = TRANSFER_DIALOG[progress?.kind];
    if (!copy)
        return null;
    if (progress.status !== "running" && progress.status !== "done" && progress.status !== "error")
        return null;
    return {
        kind: progress.kind,
        status: progress.status,
        title: copy.title,
        icon: copy.icon,
        label: progress.label || copy[progress.status],
        percent: clampPercent(progress.percent, progress.status),
        ...(progress.indeterminate === true ? { indeterminate: true } : {}),
    };
}

export function dumpProgressFor(progress) {
    if (progress?.kind !== "dump" && progress?.kind !== "restore")
        return null;
    return transferDialogFor(progress);
}

function emitProgress(onProgress, kind, status, label, percent, indeterminate) {
    onProgress?.({ kind, status, label, percent: clampPercent(percent, status), indeterminate: indeterminate === true });
}

export function resultToInserts(engine, ref, result) {
    const target = quoteIdent(engine, ref?.table || "export");
    const names = result.columns.map((c) => quoteIdent(engine, c.name)).join(", ");
    return result.rows
        .map((row) => `INSERT INTO ${target} (${names}) VALUES (${row.map((v) => quoteLiteral(engine, v)).join(", ")});`)
        .join("\n");
}

export function resultToJson(result) {
    return JSON.stringify(result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c.name, row[i]]))), null, 2);
}

async function writeFile(path, content) {
    await writeTextFile(path, content);
}

async function chooseFile(defaultName) {
    const folder = await muxy.dialog.pickFolder({ title: "Choose destination folder" });
    if (!folder)
        return null;
    const name = await muxy.dialog.prompt({ title: "File name", message: "Save as", default: defaultName });
    if (!name)
        return null;
    return `${folder}/${name}`;
}

export function exportContent(engine, ref, result, format) {
    if (format === "csv")
        return serializeCsv(result.columns, result.rows);
    if (format === "json")
        return resultToJson(result);
    return resultToInserts(engine, ref, result);
}

export async function chooseExportPath(defaultName) {
    return chooseFile(defaultName);
}

export async function chooseImportPath(format) {
    const ext = format === "json" || format === "sql" ? format : "csv";
    return pickOpenFile({ title: `Choose ${ext.toUpperCase()} file` });
}

export async function exportCommittedObject({ driver, engine, operationCtx, objectRef, format, path, timeoutMs, write = writeTextFile, onProgress }) {
    emitProgress(onProgress, "export", "running", "Fetching rows…", 0, true);
    const sql = buildSelect(engine, objectRef, { limit: OBJECT_EXPORT_LIMIT, offset: 0 });
    const result = (await driver.runQuery(operationCtx, sql, { timeoutMs }))[0];
    if (!result)
        throw new Error("EXPORT_RESULT_MISSING");
    emitProgress(onProgress, "export", "running", "Writing file…", 0);
    await write(path, exportContent(engine, objectRef, result, format), (percent) => {
        emitProgress(onProgress, "export", "running", "Writing file…", percent);
    });
    return { rowCount: result.rows.length, capped: result.rows.length === OBJECT_EXPORT_LIMIT };
}

export async function importCommittedObject({ driver, engine, operationCtx, objectRef, format, path, timeoutMs, read = readTextFile, onProgress }) {
    if (format === "sql")
        return importSqlDump({ driver, engine, operationCtx, path, timeoutMs, read, onProgress });
    emitProgress(onProgress, "import", "running", "Reading file…", 0, true);
    const text = await read(path);
    const rows = format === "json" ? parseJsonRows(text) : parseCsvRows(text);
    if (!rows)
        throw new Error(`${format.toUpperCase()}_INVALID`);
    if (!rows.columns.length || !rows.data.length)
        throw new Error("IMPORT_EMPTY");
    return insertRows({ driver, engine, operationCtx, objectRef, columns: rows.columns, data: rows.data, timeoutMs, onProgress });
}

function parseJsonRows(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (!Array.isArray(parsed))
        return null;
    if (!parsed.length)
        return { columns: [], data: [] };
    if (typeof parsed[0] !== "object" || parsed[0] === null || Array.isArray(parsed[0]))
        return null;
    const names = [...new Set(parsed.flatMap((row) => Object.keys(row)))].filter((name) => typeof name === "string" && name);
    if (!names.length)
        return null;
    return { columns: names, data: parsed.map((row) => names.map((name) => row[name] ?? null)) };
}

function parseCsvRows(text) {
    const rows = parseCsv(text);
    return { columns: rows[0]?.map((name) => String(name ?? "")) || [], data: rows.slice(1) };
}

async function insertRows({ driver, engine, operationCtx, objectRef, columns, data, timeoutMs, onProgress }) {
    const target = qualifiedName(engine, objectRef);
    const names = columns.map((name) => quoteIdent(engine, name)).join(", ");
    const label = "Importing data…";
    const total = data.length;
    for (let index = 0; index < data.length; index += CSV_BATCH) {
        emitProgress(onProgress, "import", "running", label, transferPercent(index, total));
        const batch = data.slice(index, index + CSV_BATCH);
        const values = batch
            .map((row) => `(${columns.map((_, column) => quoteLiteral(engine, row[column] ?? null)).join(", ")})`)
            .join(", ");
        await driver.runQuery(operationCtx, `INSERT INTO ${target} (${names}) VALUES ${values}`, { timeoutMs });
    }
    emitProgress(onProgress, "import", "running", label, 100);
    return { rowCount: total };
}

async function importSqlDump({ driver, engine, operationCtx, path, timeoutMs, read, onProgress }) {
    const statements = splitForEngine(await read(path), engine).map((entry) => entry.sql);
    if (!statements.length)
        throw new Error("IMPORT_EMPTY");
    const batches = [];
    for (let index = 0; index < statements.length; index += STATEMENT_BATCH)
        batches.push(statements.slice(index, index + STATEMENT_BATCH));
    for (let index = 0; index < batches.length; index++) {
        emitProgress(onProgress, "import", "running", `Importing data… (${index + 1}/${batches.length})`, transferPercent(index, batches.length));
        try {
            await driver.runBatch(operationCtx, `${batches[index].join(";\n")};`, { timeoutMs });
        }
        catch (error) {
            error.message = `batch ${index + 1}/${batches.length}: ${error.message}`;
            throw error;
        }
    }
    emitProgress(onProgress, "import", "running", "Importing data…", 100);
    return { rowCount: statements.length };
}

function suggestedExportName(name, format, fallback) {
    const base = name ? name.replace(/\.sql$/i, "") : fallback;
    return `${base}.${format === "sql" ? "sql" : format}`;
}

export async function copyResult(engine, ref, result, format) {
    const text = exportContent(engine, ref, result, format);
    await copyToClipboard(text);
    toast(`Copied as ${format.toUpperCase()}`, "success");
}

export async function exportResult(engine, ref, result, format, suggestedName) {
    const path = await chooseFile(suggestedExportName(suggestedName, format, ref?.table || "export"));
    if (!path)
        return { status: "cancelled" };
    const content = exportContent(engine, ref, result, format);
    try {
        await writeFile(path, content);
        toast(`Exported to ${path}`, "success");
        return { status: "exported", path };
    }
    catch (error) {
        const message = error?.message || String(error);
        toast(`EXPORT_FAILED: ${message}`, "warning");
        return { error: "EXPORT_FAILED", message };
    }
}

export async function exportActive(session, format) {
    const tabId = session.sqlRegistry?.activeId;
    const entry = tabId == null ? null : session.sqlRegistry.byId?.[tabId];
    const state = entry ? session.sqlState?.get(entry.key) : null;
    const context = state?.exportContext;
    if (!context?.result?.columns?.length)
        return { error: "EXPORT_NOT_AVAILABLE" };
    return exportResult(session.conn.engine, context.objectRef, context.result, format, entry.name);
}

export async function dumpDatabase(session, { onProgress } = {}) {
    const conn = session.conn;
    const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
    const path = await chooseFile(`${conn.name.replace(/\W+/g, "_")}-${stamp}.sql`);
    if (!path)
        return { status: "cancelled" };
    try {
        const tables = typeof session.driver.listTables === "function" ? await session.driver.listTables(session.ctx) : [];
        const objects = (tables || []).filter((table) => table?.name);
        if (!objects.length) {
            emitProgress(onProgress, "dump", "running", "Dumping database…", 0, true);
            await session.driver.dumpDatabase(session.ctx, path, { timeoutMs: TRANSFER_TIMEOUT });
        }
        else {
            const ordered = [...objects.filter((o) => o.kind !== "view"), ...objects.filter((o) => o.kind === "view")];
            const weights = ordered.map((table) => Math.max(Number(table.rowEstimate) || 0, 1));
            const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
            let weightDone = 0;
            for (let index = 0; index < ordered.length; index++) {
                const table = ordered[index];
                emitProgress(onProgress, "dump", "running", `Dumping ${table.name}…`, transferPercent(weightDone, totalWeight));
                await session.driver.dumpDatabase(session.ctx, path, { timeoutMs: TRANSFER_TIMEOUT, table: table.name, append: index > 0 });
                weightDone += weights[index];
                emitProgress(onProgress, "dump", "running", `Dumping ${table.name}…`, transferPercent(weightDone, totalWeight));
            }
        }
        emitProgress(onProgress, "dump", "done", "Dump written", 100);
        toast(`Dump written to ${path}`, "success");
        return { status: "dumped", path };
    }
    catch (error) {
        const message = error?.message || String(error);
        emitProgress(onProgress, "dump", "error", message, 100);
        toast(message, "warning");
        return { error: "DUMP_FAILED", message };
    }
}

async function chooseDumpFile() {
    return pickOpenFile({ title: "Choose SQL dump" });
}

async function confirmRestore(path) {
    return muxy.dialog.confirm({
        title: "Import database",
        message: `Import this SQL dump into the current database?\n\n${path}\n\nExisting objects may be replaced, or the import may fail if they already exist.`,
        buttons: ["Import", "Cancel"],
        cancel: "Cancel",
        style: "warning",
    });
}

export async function restoreDatabase(session, { onProgress, pickFile = chooseDumpFile, confirm = confirmRestore } = {}) {
    const path = await pickFile();
    if (!path)
        return { status: "cancelled" };
    const choice = await confirm(path);
    if (choice !== "Import")
        return { status: "cancelled" };
    emitProgress(onProgress, "restore", "running", "Importing database…", 0);
    try {
        const restored = await importDump(session, path, onProgress);
        emitProgress(onProgress, "restore", "done", "Dump imported", 100);
        toast(`Imported ${path}`, "success");
        return { status: "restored", path };
    }
    catch (error) {
        const message = error?.message || String(error);
        emitProgress(onProgress, "restore", "error", message, 100);
        toast(message, "warning");
        return { error: "RESTORE_FAILED", message };
    }
}

async function importDump(session, path, onProgress) {
    emitProgress(onProgress, "restore", "running", "Importing database…", 0, true);
    await session.driver.importDatabase(session.ctx, path, { timeoutMs: TRANSFER_TIMEOUT });
}
