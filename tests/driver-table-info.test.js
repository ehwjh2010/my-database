import assert from "node:assert/strict";
import test from "node:test";

function xmlField(name, value) {
    return value === null ? `<field name="${name}" xsi:nil="true"/>` : `<field name="${name}">${value}</field>`;
}

function mysqlXml(rows) {
    const result = `<resultset>${rows.map((row) => `<row>${Object.entries(row).map(([name, value]) => xmlField(name, value)).join("")}</row>`).join("")}</resultset>`;
    return `${result}<resultset><row><field name="__rc">0</field></row></resultset>`;
}

function csv(headers, rows, sentinel) {
    const value = (entry) => entry === null ? sentinel : `"${String(entry).replaceAll('"', '""')}"`;
    return [headers.map(value).join(","), ...rows.map((row) => row.map(value).join(","))].join("\n") + "\n";
}

globalThis.muxy = { exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }) };

const { setSessionPassword } = await import("../src/lib/credentials.js");
const { mysql } = await import("../src/lib/drivers/mysql.js");
const { postgres } = await import("../src/lib/drivers/postgres.js");

test("MySQL and PostgreSQL tableInfo preserve catalog metadata and ordered keys", async () => {
    setSessionPassword("mysql-table-info", "secret");
    const mysqlSql = [];
    muxy.exec = async (argv) => {
        if (argv[0] === "/usr/bin/which")
            return { exitCode: 0, stdout: "/usr/bin/mysql\n", stderr: "" };
        if (argv[0] === "perl")
            return { exitCode: 0, stdout: "", stderr: "" };
        const sql = argv[argv.indexOf("-e") + 1];
        mysqlSql.push(sql);
        if (sql.includes("information_schema.STATISTICS"))
            return { exitCode: 0, stdout: mysqlXml([{ name: "PRIMARY", nonunique: "0", col: "a", seq: "1" }, { name: "PRIMARY", nonunique: "0", col: "b", seq: "2" }, { name: "orders_code", nonunique: "0", col: "code", seq: "1" }]), stderr: "" };
        if (sql.includes("REFERENTIAL_CONSTRAINTS"))
            return { exitCode: 0, stdout: mysqlXml([{ name: "orders_account", col: "account_id", reftable: "accounts", refcol: "id", onupdate: "CASCADE", ondelete: "RESTRICT" }]), stderr: "" };
        if (sql.includes("information_schema.TRIGGERS"))
            return { exitCode: 0, stdout: mysqlXml([]), stderr: "" };
        return {
            exitCode: 0,
            stdout: mysqlXml([
                { name: "b", type: "varchar(20)", comment: "Second key", nullable: "NO", dflt: null, ckey: "PRI", extra: "", engine: "InnoDB", charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", table_comment: "Orders" },
                { name: "a", type: "bigint", comment: "First key", nullable: "NO", dflt: null, ckey: "PRI", extra: "auto_increment", engine: "InnoDB", charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", table_comment: "Orders" },
                { name: "code", type: "varchar(40)", comment: "", nullable: "YES", dflt: null, ckey: "UNI", extra: "", engine: "InnoDB", charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", table_comment: "Orders" },
            ]),
            stderr: "",
        };
    };
    const mysqlInfo = await mysql.tableInfo({
        conn: { id: "mysql-table-info", engine: "mysql", net: { host: "localhost", port: 3306, user: "tester", database: "app" } },
        database: "app",
        endpoint: { host: "localhost", port: 3306 },
    }, { table: "orders" });

    assert.deepEqual(mysqlInfo.primaryKey, ["a", "b"]);
    assert.deepEqual(mysqlInfo.metadata, { engine: "InnoDB", charset: "utf8mb4", collation: "utf8mb4_0900_ai_ci", comment: "Orders" });
    assert.equal(mysqlInfo.columns[1].autoIncrement, true);
    assert.deepEqual(mysqlInfo.foreignKeys[0], { name: "orders_account", column: "account_id", refTable: "accounts", refColumn: "id", onUpdate: "CASCADE", onDelete: "RESTRICT" });
    assert.equal(mysqlSql.some((sql) => sql.includes("CHARACTER_SET_NAME")), true);

    setSessionPassword("postgres-table-info", "secret");
    const postgresSql = [];
    muxy.exec = async (argv) => {
        if (argv[0] === "perl")
            return { exitCode: 0, stdout: "", stderr: "" };
        const sql = argv[argv.indexOf("-c") + 1];
        postgresSql.push(sql);
        const sentinel = argv.find((value) => value.startsWith("null="))?.slice(5);
        if (sql.includes("FROM pg_class c JOIN pg_attribute"))
            return { exitCode: 0, stdout: csv(["name", "type", "comment", "nullable", "dflt", "identity"], [["id", "bigint", "Identifier", "NO", null, ""], ["code", "text", null, "YES", null, ""]], sentinel), stderr: "" };
        if (sql.includes("i.indisprimary"))
            return { exitCode: 0, stdout: csv(["name", "seq"], [["id", "1"]], sentinel), stderr: "" };
        if (sql.includes("generate_series"))
            return { exitCode: 0, stdout: csv(["name", "is_unique", "seq", "col", "definition"], [["report_code", "t", "1", "code", "CREATE UNIQUE INDEX report_code ON report USING btree (code)"]], sentinel), stderr: "" };
        if (sql.includes("FROM pg_constraint"))
            return { exitCode: 0, stdout: csv(["name", "seq", "col", "refschema", "reftable", "refcol", "onupdate", "ondelete", "definition"], [], sentinel), stderr: "" };
        if (sql.includes("FROM pg_trigger"))
            return { exitCode: 0, stdout: csv(["name", "definition"], [], sentinel), stderr: "" };
        return { exitCode: 0, stdout: csv(["comment"], [["Materialized report"]], sentinel), stderr: "" };
    };
    const postgresInfo = await postgres.tableInfo({
        conn: { id: "postgres-table-info", engine: "postgres", net: { host: "localhost", port: 5432, user: "tester", database: "app" } },
        database: "app",
        schema: "analytics",
        endpoint: { host: "localhost", port: 5432 },
    }, { table: "report", schema: "analytics", kind: "view" });

    assert.deepEqual(postgresInfo.columns.map((column) => column.name), ["id", "code"]);
    assert.deepEqual(postgresInfo.primaryKey, ["id"]);
    assert.deepEqual(postgresInfo.indexes[0].columns, ["code"]);
    assert.deepEqual(postgresInfo.metadata, { comment: "Materialized report" });
    assert.equal(postgresSql.some((sql) => sql.includes("information_schema.columns")), false);
    assert.equal(postgresSql.some((sql) => sql.includes("pg_catalog.format_type")), true);
});
