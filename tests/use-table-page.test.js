import assert from "node:assert/strict";
import test from "node:test";

import { dataRuntimeFor, nextDataRequest } from "../src/workbench/data-runtime.js";
import { cachedPageFor, loadTablePage, targetIsCurrent } from "../src/grid/use-table-page.js";

const tableRef = Object.freeze({ database: "app", schema: "main", table: "orders" });
const gridState = { page: 0, rawWhere: "", rawOrderBy: '"id" DESC', total: null, querySplit: 50 };

function sessionWithDriver(calls) {
    return {
        conn: { engine: "sqlite" },
        ctx: { database: "app", schema: "main" },
        pageSize: 2,
        timeoutMs: 1000,
        scopeGeneration: 4,
        infoCache: new Map(),
        changes: new Map(),
        dataCache: new Map(),
        dataRuntime: new Map(),
        workspaceOwners: new Map(),
        registry: { byId: { 1: { id: 1, generation: 1 } } },
        driver: {
            async tableInfo(ctx, ref) {
                calls.push({ kind: "info", ctx, ref });
                return { columns: [{ name: "id", type: "integer" }], primaryKey: ["id"], rowid: null };
            },
            async runQuery(ctx, sql, options) {
                calls.push({ kind: "query", ctx, sql, options });
                return [{ columns: [{ name: "id", type: "integer" }], rows: [[1]] }];
            },
        },
    };
}

test("loadTablePage uses the captured driver context for metadata and rows", async () => {
    const calls = [];
    const session = sessionWithDriver(calls);
    const key = "app.main.orders";
    const runtime = dataRuntimeFor(session, key, tableRef, undefined, 1, 1);
    const request = { ...nextDataRequest(runtime, session), dataRevision: 0 };
    const target = {
        tableRef,
        gridState,
        workspaceKey: key,
        dataRevision: 0,
        workspaceId: 1,
        workspaceGeneration: 1,
        scopeEpoch: 4,
        generation: runtime.generation,
        driverContext: Object.freeze({ database: "app", schema: "main" }),
    };

    const page = await loadTablePage(session, target, runtime, request);

    assert.equal(page.displayRows.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].ctx.database, "app");
    assert.equal(calls[1].ctx.schema, "main");
    assert.equal(calls[1].sql, 'SELECT * FROM "orders" ORDER BY "id" DESC LIMIT 2 OFFSET 0');
});

test("cached page requires matching grid revision and current request identity", () => {
    const session = sessionWithDriver([]);
    const key = "app.main.orders";
    const runtime = dataRuntimeFor(session, key, tableRef, undefined, 1, 1);
    runtime.gridState = { ...gridState };
    runtime.cache = { loading: false, displayRows: [[1]] };
    runtime.dataRevision = 2;

    assert.deepEqual(cachedPageFor(runtime, { ...gridState }, 2, 1, 4, runtime.generation, runtime.token), runtime.cache);
    assert.deepEqual(cachedPageFor(runtime, { ...gridState, total: 10, querySplit: 70 }, 2, 1, 4, runtime.generation, runtime.token), runtime.cache);
    assert.equal(cachedPageFor(runtime, { ...gridState, page: 1 }, 2, 1, 4, runtime.generation, runtime.token), null);
    assert.equal(cachedPageFor(runtime, { ...gridState, rawOrderBy: "id ASC" }, 2, 1, 4, runtime.generation, runtime.token), null);
    assert.equal(cachedPageFor(runtime, { ...gridState }, 1, 1, 4, runtime.generation, runtime.token), null);

    const request = { owner: runtime.owner, token: runtime.token, generation: runtime.generation, revision: runtime.revision, dataRevision: 2 };
    const target = { workspaceKey: key, workspaceId: 1, workspaceGeneration: 1, scopeEpoch: 4, dataRevision: 2, gridState: { ...gridState } };
    assert.equal(targetIsCurrent(session, target, runtime, request), true);
    runtime.token += 1;
    assert.equal(targetIsCurrent(session, target, runtime, request), false);
});

test("targetIsCurrent rejects stale workspace and mismatched scopeEpoch", () => {
    const session = sessionWithDriver([]);
    const key = "app.main.orders";
    const runtime = dataRuntimeFor(session, key, tableRef, undefined, 1, 1);
    runtime.gridState = { ...gridState };
    runtime.cache = { loading: false, displayRows: [[1]] };
    runtime.dataRevision = 2;
    const request = { owner: runtime.owner, token: runtime.token, generation: runtime.generation, revision: runtime.revision, dataRevision: 2 };

    const target = { workspaceKey: key, workspaceId: 1, workspaceGeneration: 1, scopeEpoch: 4, dataRevision: 2, gridState: { ...gridState } };
    assert.equal(targetIsCurrent(session, target, runtime, request), true);

    const reopenedTarget = { workspaceKey: key, workspaceId: 1, workspaceGeneration: 99, scopeEpoch: 4, dataRevision: 2, gridState: { ...gridState } };
    assert.equal(targetIsCurrent(session, reopenedTarget, runtime, request), false);

    const scopeTarget = { workspaceKey: key, workspaceId: 1, workspaceGeneration: 1, scopeEpoch: 99, dataRevision: 2, gridState: { ...gridState } };
    assert.equal(targetIsCurrent(session, scopeTarget, runtime, request), false);

    const missingTarget = { workspaceKey: key, workspaceId: 99, workspaceGeneration: 1, scopeEpoch: 4, dataRevision: 2, gridState: { ...gridState } };
    assert.equal(targetIsCurrent(session, missingTarget, runtime, request), false);
});

test("view pages remain read-only even when metadata exposes a key", async () => {
    const calls = [];
    const session = sessionWithDriver(calls);
    session.driver.tableInfo = async () => ({ columns: [{ name: "id", type: "integer" }], primaryKey: ["id"], rowid: null });
    const key = "app.main.report";
    const runtime = dataRuntimeFor(session, key, { ...tableRef, table: "report", kind: "view" }, undefined, 2, 2);
    const request = { ...nextDataRequest(runtime, session), dataRevision: 0 };
    const page = await loadTablePage(
        session,
        {
            tableRef: { ...tableRef, table: "report", kind: "view" },
            gridState,
            workspaceKey: key,
            dataRevision: 0,
            workspaceId: 2,
            workspaceGeneration: runtime.generation,
            scopeEpoch: 4,
            generation: runtime.generation,
            driverContext: Object.freeze({ database: "app", schema: "main" }),
        },
        runtime,
        request,
    );

    assert.equal(page.editable, false);
});
