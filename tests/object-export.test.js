import assert from "node:assert/strict";
import test from "node:test";

import { OBJECT_EXPORT_LIMIT, chooseExportPath, exportCommittedObject } from "../src/transfer/transfer.js";
import { isCurrentDataExport } from "../src/workbench/workspace-state.js";

const ref = { database: "app", schema: "public", table: "orders" };

test("object export serializes CSV, pretty JSON, and qualified SQL inserts from one frozen query", async () => {
    for (const [format, expected] of [["csv", "id,name\n1,Ada\n"], ["json", "  \"id\": 1"], ["sql", "INSERT INTO \"public\".\"orders\" (\"id\", \"name\") VALUES (1, 'Ada');"]]) {
        const calls = [];
        let written;
        const exported = await exportCommittedObject({
            driver: { async runQuery(ctx, sql, options) { calls.push({ ctx, sql, options }); return [{ columns: [{ name: "id" }, { name: "name" }], rows: [[1, "Ada"]] }]; } },
            engine: "postgres",
            operationCtx: { database: "app" },
            objectRef: ref,
            format,
            path: "/tmp/export",
            timeoutMs: 1000,
            async write(path, content) { written = { path, content }; },
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].sql, 'SELECT * FROM "public"."orders" LIMIT 1000000 OFFSET 0');
        assert.equal(calls[0].options.timeoutMs, 1000);
        assert.equal(written.path, "/tmp/export");
        assert.ok(written.content.includes(expected));
        assert.deepEqual(exported, { rowCount: 1, capped: false });
    }
});

test("object export writes once after one query and preserves the cap result without a count", async () => {
    let queries = 0;
    let writes = 0;
    const exported = await exportCommittedObject({
        driver: { async runQuery() { queries += 1; return [{ columns: [{ name: "id" }], rows: Array.from({ length: OBJECT_EXPORT_LIMIT }, (_, id) => [id]) }]; } },
        engine: "sqlite",
        operationCtx: {},
        objectRef: { table: "orders" },
        format: "csv",
        path: "/tmp/export",
        async write() { writes += 1; },
    });
    assert.equal(queries, 1);
    assert.equal(writes, 1);
    assert.deepEqual(exported, { rowCount: OBJECT_EXPORT_LIMIT, capped: true });
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
    assert.equal(sql, 'SELECT * FROM "reporting"."active_orders" LIMIT 1000000 OFFSET 0');
});
