import { toast } from "../ui/toast.js";
import { serializeCsv } from "../lib/parse/csv.js";
import { quoteIdent, quoteLiteral, qualifiedName } from "../lib/sql/quote.js";
import { buildSelect } from "../lib/sql/select-builder.js";
import { writeTextFile } from "../lib/secure-file.js";
import { copyToClipboard } from "../lib/clipboard.js";

export const OBJECT_EXPORT_LIMIT = 1000000;

export function resultToInserts(engine, ref, result) {
    const target = qualifiedName(engine, ref || { table: "export" });
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

export async function exportCommittedObject({ driver, engine, operationCtx, objectRef, format, path, timeoutMs, write = writeTextFile }) {
    const sql = buildSelect(engine, objectRef, { limit: OBJECT_EXPORT_LIMIT, offset: 0 });
    const result = (await driver.runQuery(operationCtx, sql, { timeoutMs }))[0];
    if (!result)
        throw new Error("EXPORT_RESULT_MISSING");
    await write(path, exportContent(engine, objectRef, result, format));
    return { rowCount: result.rows.length, capped: result.rows.length === OBJECT_EXPORT_LIMIT };
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

async function fetchAll(session, ref) {
    const sql = buildSelect(session.conn.engine, ref, { limit: OBJECT_EXPORT_LIMIT, offset: 0 });
    const results = await session.driver.runQuery(session.ctx, sql, { timeoutMs: session.timeoutMs });
    return results[0];
}

export async function exportTable(session, ref, format) {
    setBusy("Exporting…");
    try {
        const result = await fetchAll(session, ref);
        await exportResult(session.conn.engine, ref, result, format);
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

export async function importCsv(session, ref) {
    const folder = await muxy.dialog.pickFolder({ title: "Folder containing the CSV" });
    if (!folder)
        return;
    const name = await muxy.dialog.prompt({ title: "CSV file", message: "File name", placeholder: "data.csv" });
    if (!name)
        return;
    const path = `${folder}/${name}`;
    try {
        await session.driver.importCsv(session.ctx, ref, path, { header: true });
        toast("CSV imported", "success");
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

export async function dumpDatabase(session) {
    const conn = session.conn;
    const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, "-");
    const path = await chooseFile(`${conn.name.replace(/\W+/g, "_")}-${stamp}.sql`);
    if (!path)
        return;
    setBusy("Dumping database…");
    try {
        await session.driver.dumpDatabase(session.ctx, path, { timeoutMs: 600000 });
        toast(`Dump written to ${path}`, "success");
    }
    catch (error) {
        toast(error.message, "warning");
    }
}

function setBusy(message) {
    toast(message, "info");
}
