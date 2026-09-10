import assert from "node:assert/strict";
import test from "node:test";

import { chooseExportPath, chooseImportPath, exportCommittedObject } from "../src/transfer/transfer.js";
import { isCurrentDataExport } from "../src/workbench/workspace-state.js";

const ref = { database: "app", schema: "public", table: "orders" };

test("object export serializes CSV, pretty JSON, and SQL dumps from one frozen query", async () => {
    for (const [format, expected] of [["csv", "id,name\n1,Ada\n"], ["json", "  \"id\": 1"], ["sql", "INSERT INTO \"orders\" (\"id\", \"name\") VALUES (1, 'Ada');"]]) {
        const calls = [];
        let written;
        const exported = await exportCommittedObject({
            driver: {
                async runQuery(ctx, sql, options) { calls.push({ ctx, sql, options }); return [{ columns: [{ name: "id" }, { name: "name" }], rows: [[1, "Ada"]] }]; },
                async ddl() { return 'CREATE TABLE "orders" ("id" INTEGER, "name" TEXT)'; },
            },
            engine: "postgres",
            operationCtx: { database: "app" },
            objectRef: ref,
            format,
            path: "/tmp/export",
            timeoutMs: 1000,
            async write(path, content) { written = { path, content }; },
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].sql, 'SELECT * FROM "public"."orders" LIMIT 200 OFFSET 0');
        assert.equal(calls[0].options.timeoutMs, 1000);
        assert.equal(written.path, "/tmp/export");
        assert.ok(written.content.includes(expected));
        if (format === "sql") {
            assert.match(written.content, /^DROP TABLE IF EXISTS "orders";/);
            assert.match(written.content, /CREATE TABLE "orders"/);
        }
        assert.deepEqual(exported, { rowCount: 1 });
    }
});

test("SQL table export omits catalog and schema so the dump can load in another database", async () => {
    for (const [engine, objectRef, ddl, expectedDrop, expectedCreate, expectedInsert] of [
        ["mysql", { database: "source_db", table: "orders" }, "CREATE TABLE `source_db`.`orders` (`id` int)", "DROP TABLE IF EXISTS `orders`;", "CREATE TABLE `orders` (`id` int);", "INSERT INTO `orders` (`id`) VALUES (1);"],
        ["postgres", { database: "source_db", schema: "public", table: "orders" }, 'CREATE TABLE "public"."orders" ("id" integer)', 'DROP TABLE IF EXISTS "orders";', 'CREATE TABLE "orders" ("id" integer);', 'INSERT INTO "orders" ("id") VALUES (1);'],
        ["sqlite", { database: "app", schema: "main", table: "orders" }, 'CREATE TABLE "orders" ("id" INTEGER)', 'DROP TABLE IF EXISTS "orders";', 'CREATE TABLE "orders" ("id" INTEGER);', 'INSERT INTO "orders" ("id") VALUES (1);'],
    ]) {
        let written;
        await exportCommittedObject({
            driver: {
                async runQuery() { return [{ columns: [{ name: "id" }], rows: [[1]] }]; },
                async ddl() { return ddl; },
            },
            engine,
            operationCtx: {},
            objectRef,
            format: "sql",
            path: "/tmp/export",
            write: async (_path, content) => { written = content; },
        });
        assert.equal(written, `${expectedDrop}\n${expectedCreate}\n${expectedInsert}`);
        assert.doesNotMatch(written, /source_db|public|main/);
    }
});

test("sqlite object export pages until a short chunk", async () => {
    let queries = 0;
    let writes = 0;
    const exported = await exportCommittedObject({
        driver: { async runQuery() { queries += 1; return [{ columns: [{ name: "id" }], rows: [[1], [2], [3]] }]; } },
        engine: "sqlite",
        operationCtx: {},
        objectRef: { table: "orders" },
        format: "csv",
        path: "/tmp/export",
        async write() { writes += 1; },
    });
    assert.equal(queries, 1);
    assert.equal(writes, 1);
    assert.deepEqual(exported, { rowCount: 3 });
});

test("object export pages until a short chunk instead of capping rows", async () => {
    const { MYSQL_XML_ROW_CHUNK } = await import("../src/grid/table-page-query.js");
    for (const [engine, first, second] of [
        ["mysql", "SELECT * FROM `app`.`orders` LIMIT 200 OFFSET 0", "SELECT * FROM `app`.`orders` LIMIT 200 OFFSET 200"],
        ["postgres", 'SELECT * FROM "public"."orders" LIMIT 200 OFFSET 0', 'SELECT * FROM "public"."orders" LIMIT 200 OFFSET 200'],
        ["sqlite", 'SELECT * FROM "orders" LIMIT 200 OFFSET 0', 'SELECT * FROM "orders" LIMIT 200 OFFSET 200'],
    ]) {
        const sqls = [];
        const objectRef = engine === "sqlite"
            ? { table: "orders" }
            : engine === "postgres"
                ? { schema: "public", table: "orders" }
                : { database: "app", table: "orders" };
        const exported = await exportCommittedObject({
            driver: {
                async runQuery(_ctx, sql) {
                    sqls.push(sql);
                    if (sql.includes("OFFSET 200"))
                        return [{ columns: [{ name: "id" }], rows: [[201]] }];
                    return [{ columns: [{ name: "id" }], rows: Array.from({ length: MYSQL_XML_ROW_CHUNK }, (_, index) => [index + 1]) }];
                },
            },
            engine,
            operationCtx: {},
            objectRef,
            format: "csv",
            path: "/tmp/export",
            write: async () => {},
        });
        assert.deepEqual(sqls, [first, second]);
        assert.deepEqual(exported, { rowCount: MYSQL_XML_ROW_CHUNK + 1 });
    }
});

test("object export does not hide query or write failures", async () => {
    await assert.rejects(exportCommittedObject({
        driver: { async runQuery() { throw new Error("database unavailable"); } },
        engine: "sqlite", operationCtx: {}, objectRef: { table: "orders" }, format: "csv", path: "/tmp/export",
    }), /database unavailable/);
    await assert.rejects(exportCommittedObject({
        driver: { async runQuery() { return [{ columns: [], rows: [] }]; } },
        engine: "sqlite", operationCtx: {}, objectRef: { table: "orders" }, format: "csv", path: "/tmp/export", write: async () => { throw new Error("disk full"); },
    }), /disk full/);
});

test("object export currentness requires the frozen workspace, object, scope, and operation token", () => {
    const operation = { workspaceId: 1, key: "orders", token: 4, ownership: { workspaceId: 1, generation: 2, scopeEpoch: 3 }, objectRef: { table: "orders" } };
    const session = {
        scopeGeneration: 3,
        registry: { byId: { 1: { key: "orders", generation: 2, ref: { table: "orders" } } } },
        workspaceOwners: new Map([["orders", { operation: { kind: "export", token: 4 } }]]),
    };
    assert.equal(isCurrentDataExport(session, operation), true);
    session.workspaceOwners.get("orders").operation = { kind: "export", token: 5 };
    assert.equal(isCurrentDataExport(session, operation), false);
});

test("csv, json, and sql import paths open a file picker", async () => {
    const previousMuxy = globalThis.muxy;
    try {
        for (const [format, title, chosen] of [
            ["csv", "Choose CSV file", "/tmp/imports/orders.csv"],
            ["json", "Choose JSON file", "/tmp/imports/rows.json"],
            ["sql", "Choose SQL file", "/tmp/imports/orders.sql"],
        ]) {
            const calls = [];
            globalThis.muxy = {
                dialog: {
                    async pickFile() { throw new Error("muxy.dialog.pickFile is not a function"); },
                    async pickFolder() { throw new Error("import must pick a file"); },
                },
                async exec(argv) {
                    calls.push(argv);
                    assert.equal(argv[0], "osascript");
                    assert.match(argv[2], /choose file/);
                    return { exitCode: 0, stdout: `${chosen}\n`, stderr: "" };
                },
            };
            const path = await chooseImportPath(format);
            assert.equal(path, chosen);
            assert.equal(calls[0][3], title);
        }
    } finally {
        globalThis.muxy = previousMuxy;
    }
});

test("choosing no destination settles before any query or write", async () => {
    const previousMuxy = globalThis.muxy;
    let queries = 0;
    let writes = 0;
    globalThis.muxy = { dialog: {
        async pickFolder() { return "/tmp"; },
        async prompt() { return null; },
    } };
    try {
        const path = await chooseExportPath("orders.csv");
        assert.equal(path, null);
        assert.equal(queries, 0);
        assert.equal(writes, 0);
    } finally {
        globalThis.muxy = previousMuxy;
    }
});

test("SQL view export stays insert-only", async () => {
    let written;
    await exportCommittedObject({
        driver: {
            async runQuery() { return [{ columns: [{ name: "id" }], rows: [[1]] }]; },
            async ddl() { throw new Error("view export must not load table DDL"); },
        },
        engine: "postgres",
        operationCtx: {},
        objectRef: { schema: "reporting", table: "active_orders", kind: "view" },
        format: "sql",
        path: "/tmp/export",
        write: async (_path, content) => { written = content; },
    });
    assert.equal(written, 'INSERT INTO "active_orders" ("id") VALUES (1);');
});

test("view export uses the frozen qualified view reference", async () => {
    let sql;
    await exportCommittedObject({
        driver: { async runQuery(_ctx, statement) { sql = statement; return [{ columns: [{ name: "id" }], rows: [[1]] }]; } },
        engine: "postgres",
        operationCtx: {},
        objectRef: { database: "app", schema: "reporting", table: "active_orders", kind: "view" },
        format: "json",
        path: "/tmp/active-orders.json",
        write: async () => {},
    });
    assert.equal(sql, 'SELECT * FROM "reporting"."active_orders" LIMIT 200 OFFSET 0');
});
