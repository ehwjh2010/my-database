import assert from "node:assert/strict";
import test from "node:test";

let calls = [];

globalThis.muxy = {
    exec: async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: '[{"version":"3.51.0"}]', stderr: "" };
    },
};

const { sqlite } = await import("../src/lib/drivers/sqlite.js");
const ctx = { conn: { sqlite: { path: "/tmp/Application Support/example.sqlite" } } };

test("connection test refuses to create a missing SQLite database", async () => {
    calls = [];
    await sqlite.test(ctx);
    assert.deepEqual(calls[0], [
        "sqlite3",
        "-batch",
        "-bail",
        "-json",
        "file:/tmp/Application%20Support/example.sqlite?mode=rw",
        "SELECT sqlite_version() AS version",
    ]);
});

test("table discovery maps SQLite tables and views", async () => {
    calls = [];
    muxy.exec = async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: '[{"name":"accounts","type":"table"},{"name":"balances","type":"view"}]', stderr: "" };
    };
    assert.deepEqual(await sqlite.listTables(ctx), [
        { name: "accounts", kind: "table" },
        { name: "balances", kind: "view" },
    ]);
    assert.deepEqual(calls[0].slice(0, 5), ["sqlite3", "-batch", "-bail", "-json", "file:/tmp/Application%20Support/example.sqlite?mode=rw"]);
});

test("tableInfo reads complete columns and all index columns without N+1 queries", async () => {
    calls = [];
    muxy.exec = async (argv) => {
        calls.push(argv);
        const sql = argv.at(-1);
        let stdout = "[]";
        if (sql.includes("pragma_table_xinfo"))
            stdout = JSON.stringify([{ cid: 0, name: "b", type: "TEXT", notnull: 1, dflt_value: null, pk: 2, hidden: 0 }, { cid: 1, name: "a", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1, hidden: 0 }, { cid: 2, name: "total", type: "INTEGER", notnull: 0, dflt_value: "0", pk: 0, hidden: 2 }]);
        else if (sql.includes("pragma_index_list"))
            stdout = JSON.stringify([{ name: "orders_unique", is_unique: 1, seqno: 0, col: "a" }, { name: "orders_unique", is_unique: 1, seqno: 1, col: "b" }]);
        else if (sql.includes("foreign_key_list"))
            stdout = JSON.stringify([{ from: "a", table: "accounts", to: "id", on_update: "CASCADE", on_delete: "RESTRICT" }]);
        else if (sql.includes("type = 'trigger'"))
            stdout = "[]";
        else if (sql.includes("SELECT sql FROM sqlite_master"))
            stdout = JSON.stringify([{ sql: "CREATE TABLE orders (b TEXT, a INTEGER, total INTEGER, PRIMARY KEY (a, b)) WITHOUT ROWID, STRICT" }]);
        return { exitCode: 0, stdout, stderr: "" };
    };

    const info = await sqlite.tableInfo(ctx, { table: "orders", kind: "table" });

    assert.deepEqual(info.primaryKey, ["a", "b"]);
    assert.deepEqual(info.indexes, [{ name: "orders_unique", unique: true, columns: ["a", "b"] }]);
    assert.equal(info.columns[2].name, "total");
    assert.equal(info.columns[2].default, "0");
    assert.deepEqual(info.metadata, { strict: true, withoutRowid: true });
    assert.equal(info.rowid, null);
    assert.equal(calls.filter((argv) => argv.at(-1).includes("pragma_index")).length, 1);
});

test("SQLite database restore reads the dump with .read", async () => {
    calls = [];
    muxy.exec = async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: "", stderr: "" };
    };
    await sqlite.importDatabase(ctx, "/tmp/exports/database.sql", { timeoutMs: 600000 });
    assert.deepEqual(calls[0], ["sqlite3", "/tmp/Application Support/example.sqlite", ".read /tmp/exports/database.sql"]);
});

test("SQLite runBatch runs a statement batch without bail or json flags", async () => {
    calls = [];
    muxy.exec = async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: "", stderr: "" };
    };
    await sqlite.runBatch(ctx, "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);", { timeoutMs: 600000 });
    assert.deepEqual(calls[0], ["sqlite3", "-batch", "/tmp/Application Support/example.sqlite", "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);"]);
});

test("SQLite runBatch runs a statement batch without bail or json flags", async () => {
    calls = [];
    muxy.exec = async (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: "", stderr: "" };
    };
    await sqlite.runBatch(ctx, "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);", { timeoutMs: 600000 });
    assert.deepEqual(calls[0], ["sqlite3", "-batch", "/tmp/Application Support/example.sqlite", "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);"]);
});
