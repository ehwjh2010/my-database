import { run } from "../exec.js";
import { detect as detectBinary, which } from "../cli-detect.js";
import { ensurePgPassFile } from "../cred-file.js";
import { quoteIdent, quoteLiteral, qualifiedName } from "../sql/quote.js";
import { makeResult } from "../parse/result.js";
import { parseCsv } from "../parse/csv.js";
import { splitForEngine, statementKind } from "../sql/statement-split.js";

const BIN = "psql";

function nullSentinel() {
    return `__NULL_${Math.random().toString(36).slice(2, 10)}__`;
}

const TAG_PATTERN = /^(INSERT \d+ \d+|UPDATE \d+|DELETE \d+|MERGE \d+|COPY \d+|SELECT \d+|[A-Z]+(?: [A-Z]+)*)$/;

function connKeyword(value) {
    return `'${String(value).replace(/(['\\])/g, "\\$1")}'`;
}

async function conninfo(ctx) {
    const net = ctx.conn.net;
    const passfile = await ensurePgPassFile(ctx);
    const parts = [
        `host=${connKeyword(ctx.endpoint?.host || net.host)}`,
        `port=${connKeyword(ctx.endpoint?.port || net.port || 5432)}`,
        `user=${connKeyword(net.user)}`,
        `dbname=${connKeyword(ctx.database || net.database || "postgres")}`,
        `passfile=${connKeyword(passfile)}`,
    ];
    if (net.sslMode)
        parts.push(`sslmode=${connKeyword(net.sslMode)}`);
    return parts.join(" ");
}

async function exec(ctx, extra, opts = {}) {
    const argv = [BIN, "-X", "-w", "-v", "ON_ERROR_STOP=1", "-d", await conninfo(ctx), ...extra];
    return run(argv, opts);
}

function regclass(ctx, ref) {
    return quoteLiteral("postgres", `${quoteIdent("postgres", ref.schema || "public")}.${quoteIdent("postgres", ref.table)}`) + "::regclass";
}

function decodeCsv(text, sentinel) {
    const rows = parseCsv(text, { bareEmpty: "" });
    return rows.map((row) => row.map((value) => (value === sentinel ? null : value)));
}

function parseStatementOutput(stdout, kind, sentinel) {
    let csvText = stdout;
    let commandTag = "";
    let affectedRows = null;
    if (kind === "command") {
        const lines = stdout.replace(/\n$/, "").split("\n");
        const last = lines[lines.length - 1] || "";
        if (TAG_PATTERN.test(last)) {
            commandTag = last;
            lines.pop();
            csvText = lines.length ? lines.join("\n") + "\n" : "";
            const numbers = last.match(/\d+/g);
            if (numbers)
                affectedRows = Number(numbers[numbers.length - 1]);
        }
    }
    const rows = csvText.trim() ? decodeCsv(csvText, sentinel) : [];
    if (!rows.length)
        return makeResult({ commandTag, affectedRows });
    return makeResult({
        columns: rows[0].map((name) => ({ name: name ?? "" })),
        rows: rows.slice(1),
        commandTag,
        affectedRows,
    });
}

async function runStatement(ctx, sql, opts = {}) {
    const sentinel = nullSentinel();
    const started = performance.now();
    const stdout = await exec(ctx, ["--csv", "-P", `null=${sentinel}`, "-c", sql], opts);
    const result = parseStatementOutput(stdout, statementKind(sql), sentinel);
    result.durationMs = Math.round(performance.now() - started);
    return result;
}

async function query(ctx, sql, opts = {}) {
    const result = await runStatement(ctx, sql, opts);
    return { columns: result.columns, rows: result.rows };
}

function rowsAsObjects(result) {
    return result.rows.map((row) => Object.fromEntries(result.columns.map((col, i) => [col.name, row[i]])));
}

export const postgres = {
    engine: "postgres",
    capabilities: { databases: true, schemas: true, routines: true, sequences: true, triggers: true, importCsv: true, explain: true, rowid: false },
    dialect: { explainPrefix: "EXPLAIN", cmDialect: "PostgreSQL" },

    detect: () => detectBinary(BIN),

    async test(ctx) {
        const result = await query(ctx, "SELECT current_setting('server_version') AS v", { timeoutMs: 15000 });
        return { ok: true, serverVersion: result.rows[0]?.[0] || "" };
    },

    async listDatabases(ctx) {
        const result = await query(ctx, "SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY 1");
        return result.rows.map((r) => r[0]);
    },

    async listSchemas(ctx) {
        const result = await query(ctx, "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY 1");
        return result.rows.map((r) => r[0]);
    },

    async listTables(ctx) {
        const schema = quoteLiteral("postgres", ctx.schema || "public");
        const result = await query(ctx, `SELECT c.relname AS name, CASE WHEN c.relkind IN ('v','m') THEN 'view' ELSE 'table' END AS kind, GREATEST(c.reltuples, 0)::bigint AS estimate, obj_description(c.oid, 'pg_class') AS comment FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r','p','v','m') AND n.nspname = ${schema} ORDER BY 1`);
        return rowsAsObjects(result).map((r) => ({ name: r.name, kind: r.kind, rowEstimate: Number(r.estimate) || null, comment: r.comment }));
    },

    async tableInfo(ctx, ref) {
        const rc = regclass(ctx, ref);
        const [cols, pk, idx, fks, trg, meta] = await Promise.all([
            query(ctx, `SELECT a.attname AS name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, col_description(a.attrelid, a.attnum) AS comment, CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable, pg_get_expr(ad.adbin, ad.adrelid) AS dflt, a.attidentity AS identity FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum WHERE c.oid = ${rc} AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`),
            query(ctx, `SELECT a.attname AS name, key.position AS seq FROM pg_index i JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS key(attnum, position) ON key.position <= i.indnkeyatts JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = key.attnum WHERE i.indrelid = ${rc} AND i.indisprimary ORDER BY key.position`),
            query(ctx, `SELECT ci.relname AS name, i.indisunique AS is_unique, position.n AS seq, pg_get_indexdef(i.indexrelid, position.n, true) AS col, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class ci ON ci.oid = i.indexrelid JOIN LATERAL generate_series(1, i.indnkeyatts) AS position(n) ON true WHERE i.indrelid = ${rc} ORDER BY ci.relname, position.n`),
            query(ctx, `SELECT con.conname AS name, source.position AS seq, source_column.attname AS col, ref_namespace.nspname AS refschema, ref_table.relname AS reftable, ref_column.attname AS refcol, CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS onupdate, CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS ondelete, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS source(attnum, position) ON true JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS target(attnum, position) ON target.position = source.position JOIN pg_attribute source_column ON source_column.attrelid = con.conrelid AND source_column.attnum = source.attnum JOIN pg_class ref_table ON ref_table.oid = con.confrelid JOIN pg_namespace ref_namespace ON ref_namespace.oid = ref_table.relnamespace JOIN pg_attribute ref_column ON ref_column.attrelid = con.confrelid AND ref_column.attnum = target.attnum WHERE con.contype = 'f' AND con.conrelid = ${rc} ORDER BY con.conname, source.position`),
            query(ctx, `SELECT tgname AS name, pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE tgrelid = ${rc} AND NOT tgisinternal`),
            query(ctx, `SELECT obj_description(${rc}, 'pg_class') AS comment`),
        ]);
        const primaryKey = rowsAsObjects(pk).map((row) => row.name);
        const pkNames = new Set(primaryKey);
        const columns = rowsAsObjects(cols).map((r) => ({
            name: r.name,
            type: r.type || "",
            comment: r.comment,
            nullable: r.nullable === "YES",
            default: r.dflt,
            isPk: pkNames.has(r.name),
            autoIncrement: !!r.identity || !!(r.dflt && r.dflt.startsWith("nextval(")),
        }));
        const indexMap = new Map();
        for (const row of rowsAsObjects(idx)) {
            if (!indexMap.has(row.name))
                indexMap.set(row.name, { name: row.name, unique: row.is_unique === "t", columns: [], definition: row.definition });
            indexMap.get(row.name).columns.push(row.col);
        }
        const foreignKeys = rowsAsObjects(fks).map((r) => ({
            name: r.name,
            column: r.col,
            refTable: r.refschema === (ref.schema || "public") ? r.reftable : r.refschema + "." + r.reftable,
            refColumn: r.refcol,
            onUpdate: r.onupdate,
            onDelete: r.ondelete,
            definition: r.definition,
        }));
        const triggers = rowsAsObjects(trg).map((r) => ({ name: r.name, definition: r.definition }));
        const comment = rowsAsObjects(meta)[0]?.comment;
        return {
            columns,
            indexes: [...indexMap.values()],
            foreignKeys,
            triggers,
            primaryKey,
            rowid: null,
            ...(comment !== null && comment !== undefined && comment !== "" ? { metadata: { comment } } : {}),
        };
    },

    async listRoutines(ctx) {
        const schema = quoteLiteral("postgres", ctx.schema || "public");
        const result = await query(ctx, `SELECT routine_name AS name, routine_type AS kind FROM information_schema.routines WHERE specific_schema = ${schema} ORDER BY 1`);
        return rowsAsObjects(result).map((r) => ({ name: r.name, kind: (r.kind || "function").toLowerCase() }));
    },

    async runQuery(ctx, sql, opts = {}) {
        const statements = splitForEngine(sql, "postgres");
        const results = [];
        for (const statement of statements)
            results.push(await runStatement(ctx, statement.sql, opts));
        return results.length ? results : [makeResult({})];
    },

    async runScript(ctx, sql, opts = {}) {
        await exec(ctx, ["-q", "-c", sql], opts);
    },

    async ddl(ctx, ref) {
        if (await which("pg_dump")) {
            const argv = ["pg_dump", "-w", "--schema-only", "--no-owner", "--no-privileges", "-d", await conninfo(ctx), "-t", `${ref.schema || "public"}.${ref.table}`];
            const stdout = await run(argv, { timeoutMs: 30000 });
            return stdout
                .split("\n")
                .filter((line) => !/^--|^SET |^SELECT pg_catalog|^\s*$/.test(line))
                .join("\n")
                .trim();
        }
        const info = await this.tableInfo(ctx, ref);
        const body = info.columns.map((c) => `    ${quoteIdent("postgres", c.name)} ${c.type}${c.nullable ? "" : " NOT NULL"}${c.default ? ` DEFAULT ${c.default}` : ""}`);
        return `CREATE TABLE ${qualifiedName("postgres", ref)} (\n${body.join(",\n")}\n);`;
    },

    async importCsv(ctx, ref, filePath, opts = {}) {
        const target = qualifiedName("postgres", ref);
        const sql = `\\copy ${target} FROM ${quoteLiteral("postgres", filePath)} WITH (FORMAT csv${opts.header ? ", HEADER" : ""})`;
        await exec(ctx, ["-q", "-c", sql], opts);
    },

    async dumpDatabase(ctx, outPath, opts = {}) {
        await run(["pg_dump", "-w", "-d", await conninfo(ctx), "-f", outPath], { timeoutMs: opts.timeoutMs || 600000 });
    },

    async allColumns(ctx) {
        const schema = quoteLiteral("postgres", ctx.schema || "public");
        const result = await query(ctx, `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ${schema} ORDER BY table_name, ordinal_position`);
        const map = {};
        for (const row of rowsAsObjects(result)) {
            (map[row.t] = map[row.t] || []).push(row.c);
        }
        return map;
    },

    async explain(ctx, sql, opts = {}) {
        return this.runQuery(ctx, `EXPLAIN ${sql}`, opts);
    },
};
