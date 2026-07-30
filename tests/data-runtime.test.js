import assert from "node:assert/strict";
import test from "node:test";

import {
    createDataRuntime,
    dataRuntimeFor,
    clearDataRuntime,
    isCurrentDataRuntime,
    refreshDataRuntime,
} from "../src/workbench/data-runtime.js";

test("data runtime keeps independent cache, grid, changes, and request identity per workspace", () => {
    const session = { dataRuntime: new Map(), scopeGeneration: 3 };
    const first = dataRuntimeFor(session, "app.public.orders", undefined, undefined, 1);
    const second = dataRuntimeFor(session, "app.public.customers", undefined, undefined, 2);

    first.gridState.page = 2;
    first.gridState.querySplit = 65;
    first.cache = { rows: [[1]], metadata: { columns: ["id"] } };
    first.changes.inserts.push({ id: 1 });
    first.token = 4;

    assert.notEqual(first, second);
    assert.equal(first.gridState.page, 2);
    assert.equal(second.gridState.page, 0);
    assert.equal(first.gridState.querySplit, 65);
    assert.equal(second.gridState.querySplit, 50);
    assert.equal(first.changes.inserts.length, 1);
    assert.equal(isCurrentDataRuntime(first, 1, 3, 3, 4), true);
    assert.equal(isCurrentDataRuntime(first, 1, 3, 3, 5), false);

    clearDataRuntime(session, "app.public.orders");
    assert.equal(session.dataRuntime.has("app.public.orders"), false);
    assert.equal(session.dataRuntime.has("app.public.customers"), true);
});

test("createDataRuntime starts with non-persistent empty Data state", () => {
    const runtime = createDataRuntime(null, 0, 7);
    assert.deepEqual(runtime.gridState, { page: 0, rawWhere: "", rawOrderBy: "", total: null, querySplit: 50 });
    assert.deepEqual(runtime.cache, null);
    assert.deepEqual([...runtime.changes.edits], []);
    assert.deepEqual([...runtime.changes.deletes], []);
    assert.deepEqual(runtime.changes.inserts, []);
    assert.equal(runtime.changes.insertCounter, 0);
    assert.equal(runtime.generation, 7);
    assert.equal(runtime.token, 0);
    assert.equal(runtime.revision, 0);
    assert.equal(runtime.stale, false);
});

test("refreshDataRuntime clears only the selected Data cache and advances its request", () => {
    const session = {
        conn: { engine: "sqlite" },
        scopeGeneration: 3,
        dataRuntime: new Map(),
        dataCache: new Map(),
        gridState: new Map(),
        changes: new Map(),
        workspaceOwners: new Map(),
        structureCache: new Map([["app.main.orders", { columns: [] }]]),
    };
    const orders = dataRuntimeFor(session, "app.main.orders", { database: "app", schema: "main", table: "orders" }, undefined, 1);
    const customers = dataRuntimeFor(session, "app.main.customers", { database: "app", schema: "main", table: "customers" }, undefined, 2);
    orders.cache = { displayRows: [[1]] };
    customers.cache = { displayRows: [[2]] };
    session.dataCache.set("app.main.orders", orders.cache);
    session.dataCache.set("app.main.customers", customers.cache);
    const token = orders.token;

    refreshDataRuntime(session, "app.main.orders", { database: "app", schema: "main", table: "orders" });

    assert.equal(orders.cache, null);
    assert.equal(session.dataCache.has("app.main.orders"), false);
    assert.equal(orders.token, token + 1);
    assert.equal(orders.stale, true);
    assert.equal(customers.cache.displayRows[0][0], 2);
    assert.equal(session.dataCache.get("app.main.customers"), customers.cache);
    assert.deepEqual(session.structureCache.get("app.main.orders"), { columns: [] });
});
