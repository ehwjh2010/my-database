import { run, runWithStdinFile } from "../exec.js";
import { writeDumpPart } from "../secure-file.js";
import { detect as detectBinary } from "../cli-detect.js";
import { quoteIdent, quoteLiteral } from "../sql/quote.js";
import { makeResult, fromObjects, parseJsonStream } from "../parse/result.js";

const BIN = "sqlite3";

function databaseUri(path) {
    return `file:${path.split("/").map(encodeURIComponent).join("/")}?mode=rw`;
}

function argv(ctx, sql, flags = ["-json"]) {
    return [BIN, "-batch", "-bail", ...flags, databaseUri(ctx.conn.sqlite.path), sql];
}

async function query(ctx, sql, opts = {}) {
    const stdout = await run(argv(ctx, sql), opts);
    return parseJsonStream(stdout);
}

export const sqlite = {
    engine: "sqlite",
    capabilities: { databases: false, schemas: false, routines: false, sequences: false, triggers: true, importData: true, explain: true, rowid: true },
    dialect: { explainPrefix: "EXPLAIN QUERY PLAN", cmDialect: "SQLite" },

    detect: () => detectBinary(BIN),

    async test(ctx) {
        const sets = await query(ctx, "SELECT sqlite_version() AS version");
        return { ok: true, serverVersion: sets[0]?.[0]?.version || "" };
    },

    async listDatabases() {
        return [];
    },

    async listSchemas() {
        return [];
    },

    async listTables(ctx) {
        const sets = await query(ctx, "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
        return (sets[0] || []).map((row) => ({ name: row.name, kind: row.type === "view" ? "view" : "table" }));
    },

    async tableInfo(ctx, ref) {
        const table = ref.table;
        const tableLit = quoteLiteral("sqlite", table);
        const [columnsSet, indexSet, fkSet, masterSet, triggersSet] = await Promise.all([
            query(ctx, `SELECT * FROM pragma_table_xinfo(${tableLit}) ORDER BY cid`),
            query(ctx, `SELECT il.name, il."unique" AS is_unique, ix.seqno, ix.name AS col FROM pragma_index_list(${tableLit}) il LEFT JOIN pragma_index_xinfo(il.name) ix ON ix."key" = 1 ORDER BY il.seq, ix.seqno`),
            query(ctx, `PRAGMA foreign_key_list(${quoteIdent("sqlite", table)})`),
            query(ctx, `SELECT sql FROM sqlite_master WHERE name = ${tableLit}`),
            query(ctx, `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ${tableLit}`),
        ]);
        const ddl = masterSet[0]?.[0]?.sql || "";
        const autoIncrement = /\bAUTOINCREMENT\b/i.test(ddl);
        const columns = (columnsSet[0] || []).map((row) => ({
            name: row.name,
            type: row.type || "",
            nullable: row.notnull === 0,
            default: row.dflt_value,
            isPk: row.pk > 0,
            autoIncrement: autoIncrement && row.pk > 0,
        }));
        const tableOptions = ddl.slice(ddl.lastIndexOf(")") + 1);
        const withoutRowid = /WITHOUT\s+ROWID/i.test(tableOptions);
        const strict = /\bSTRICT\b/i.test(tableOptions);
        const indexMap = new Map();
        for (const row of indexSet[0] || []) {
            if (!indexMap.has(row.name))
                indexMap.set(row.name, { name: row.name, unique: row.is_unique === 1, columns: [] });
            if (row.col)
                indexMap.get(row.name).columns.push(row.col);
        }
        const foreignKeys = (fkSet[0] || []).map((row) => ({
            column: row.from,
            refTable: row.table,
            refColumn: row.to,
            onUpdate: row.on_update,
            onDelete: row.on_delete,
        }));
        const triggers = (triggersSet[0] || []).map((row) => ({ name: row.name, definition: row.sql }));
        const primaryKey = (columnsSet[0] || []).filter((row) => row.pk > 0).sort((left, right) => left.pk - right.pk).map((row) => row.name);
        const metadata = { ...(strict ? { strict: true } : {}), ...(withoutRowid ? { withoutRowid: true } : {}) };
        return {
            columns,
            indexes: [...indexMap.values()],
            foreignKeys,
            triggers,
            primaryKey,
            rowid: ref.kind !== "view" && !withoutRowid && !primaryKey.length ? "rowid" : null,
            ...(Object.keys(metadata).length ? { metadata } : {}),
        };
    },

    async runQuery(ctx, sql, opts = {}) {
        const started = performance.now();
        const wrapped = `${sql.replace(/;\s*$/, "")};SELECT changes() AS c;`;
        const sets = await run(argv(ctx, wrapped), opts).then(parseJsonStream);
        const durationMs = Math.round(performance.now() - started);
        const changesSet = sets.pop();
        const affected = Number(changesSet?.[0]?.c ?? 0);
        const results = sets.map((set) => ({ ...fromObjects(set), durationMs }));
        if (!results.length)
            return [makeResult({ affectedRows: affected, durationMs })];
        return results;
    },

    async runScript(ctx, sql, opts = {}) {
        const script = `BEGIN;\n${sql}\nCOMMIT;`;
        await run(argv(ctx, script, []), opts);
    },

    async ddl(ctx, ref) {
        const sets = await query(ctx, `SELECT sql FROM sqlite_master WHERE name = ${quoteLiteral("sqlite", ref.table)}`);
        return sets[0]?.[0]?.sql || "";
    },

    async dumpDatabase(ctx, outPath, opts = {}) {
        if (opts.table) {
            const sql = await run([BIN, ctx.conn.sqlite.path, `.dump ${opts.table}`], { timeoutMs: opts.timeoutMs || 600000 });
            await writeDumpPart(outPath, sql.endsWith("\n") ? sql : `${sql}\n`, Boolean(opts.append));
            return;
        }
        const phaseArgv = (extra) => [BIN, ctx.conn.sqlite.path, ...extra];
        const phases = [
            phaseArgv([".schema --nosys"]),
            phaseArgv([".dump --data-only"]),
            phaseArgv([".sql", "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid"]),
        ];
        let append = Boolean(opts.append);
        for (const argv of phases) {
            const sql = await run(argv, { timeoutMs: opts.timeoutMs || 600000 });
            if (!sql)
                continue;
            await writeDumpPart(outPath, sql.endsWith("\n") ? sql : `${sql}\n`, append);
            append = true;
        }
    },

    async importDatabase(ctx, dumpPath, opts = {}) {
        await runWithStdinFile(["sqlite3", "-bail", "-batch", databaseUri(ctx.conn.sqlite.path)], dumpPath, { timeoutMs: opts.timeoutMs || 600000 });
    },

    async runBatch(ctx, sql, opts = {}) {
        await run([BIN, "-batch", ctx.conn.sqlite.path, sql], opts);
    },

    async runBatch(ctx, sql, opts = {}) {
        await run([BIN, "-batch", ctx.conn.sqlite.path, sql], opts);
    },

    async allColumns(ctx) {
        const sets = await query(ctx, "SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'");
        const map = {};
        for (const row of sets[0] || []) {
            (map[row.t] = map[row.t] || []).push(row.c);
        }
        return map;
    },

    async explain(ctx, sql, opts = {}) {
        const started = performance.now();
        const stdout = await run(argv(ctx, `EXPLAIN QUERY PLAN ${sql}`, []), opts);
        const rows = stdout.split("\n").filter((line) => line.trim()).map((line) => [line]);
        return [makeResult({ columns: [{ name: "plan" }], rows, durationMs: Math.round(performance.now() - started) })];
    },
};
