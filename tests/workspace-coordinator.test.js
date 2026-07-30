import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceCoordinator } from "../src/workbench/workspace-coordinator.js";
import { isCurrentDataCount, objectCacheKey } from "../src/workbench/workspace-state.js";
import { nextDataRequest } from "../src/workbench/data-runtime.js";
import { targetIsCurrent } from "../src/grid/use-table-page.js";
import { createTableFromSql } from "../src/structure/table-designer-actions.js";

function stubSession(overrides = {}) {
    return {
        conn: { engine: "sqlite" },
        ctx: { database: "app", schema: "main" },
        driver: {
            async listTables() {
                return [{ name: "orders", kind: "table" }];
            },
            async allColumns() {
                return { orders: [{ name: "id" }] };
            },
            async tableInfo() {
                return { columns: [{ name: "id" }], primaryKey: ["id"], rowid: false };
            },
        },
        tables: [],
        columnsMap: {},
        infoCache: new Map(),
        changes: new Map(),
        dataCache: new Map(),
        dataRuntime: new Map(),
        gridState: new Map(),
        structureCache: new Map(),
        queryState: new Map(),
        workspaceOwners: new Map(),
        scopeGeneration: 0,
        ...overrides,
    };
}

function stubAdapters(overrides = {}) {
    return { notify: () => {}, ...overrides };
}

test("openOrActivate creates a workspace with data view and stores it in the session registry", () => {
    const session = stubSession();
    let revisions = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ notify: () => { revisions += 1; } }));
    const ref = { database: "app", schema: "main", table: "orders", kind: "table" };

    const result = coordinator.openOrActivate(ref);

    assert.deepEqual(result, { workspaceId: 1, created: true, activeId: 1 });
    const entry = session.registry.byId[1];
    assert.deepEqual(session.registry.order, [1]);
    assert.equal(session.registry.activeId, 1);
    assert.equal(entry.generation, 1);
    assert.equal(entry.view, "data");
    assert.equal(entry.ref.table, "orders");
    assert.equal(Object.isFrozen(entry.ref), true);
    assert.equal(revisions, 1);
});

test("openOrActivate deduplicates by database, schema, and table; kind is not part of identity", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const first = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders", kind: "table" });
    const second = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders", kind: "view" });

    assert.equal(second.created, false);
    assert.equal(second.workspaceId, first.workspaceId);
    assert.deepEqual(session.registry.order, [first.workspaceId]);
    assert.equal(session.registry.byId[first.workspaceId].ref.kind, "table");
});

test("openOrActivate never collides when object names contain dots", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const dottedSchema = coordinator.openOrActivate({ database: "app", schema: "sales.report", table: "orders" });
    const dottedTable = coordinator.openOrActivate({ database: "app", schema: "sales", table: "report.orders" });

    assert.notEqual(dottedSchema.workspaceId, dottedTable.workspaceId);
    assert.deepEqual(session.registry.order, [dottedSchema.workspaceId, dottedTable.workspaceId]);
    assert.notEqual(session.registry.byId[dottedSchema.workspaceId].key, session.registry.byId[dottedTable.workspaceId].key);
    assert.equal(session.dataRuntime.has(session.registry.byId[dottedSchema.workspaceId].key), true);
    assert.equal(session.dataRuntime.has(session.registry.byId[dottedTable.workspaceId].key), true);
});

test("openOrActivate rejects a ref without a table name", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    assert.deepEqual(coordinator.openOrActivate({ database: "app", schema: "main" }), { error: "INVALID_OBJECT_REF" });
    assert.deepEqual(session.registry.order, []);
});

test("workspace id and generation stay monotonic and are never reused after close", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const first = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    coordinator.close(first.workspaceId);
    const second = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const third = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });

    assert.equal(second.created, true);
    assert.ok(second.workspaceId > first.workspaceId);
    assert.ok(third.workspaceId > second.workspaceId);
    const generations = [first, second, third].map(({ workspaceId }) => workspaceId && session.registry.byId[workspaceId]?.generation);
    assert.ok(session.registry.byId[second.workspaceId].generation > 1);
    assert.ok(session.registry.byId[third.workspaceId].generation > session.registry.byId[second.workspaceId].generation);
    assert.equal(generations[0], undefined);
});

test("setActive switches only to an existing workspace and close applies left-neighbor preference", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const invoices = coordinator.openOrActivate({ database: "app", schema: "main", table: "invoices" });

    assert.deepEqual(coordinator.setActive(orders.workspaceId), { activeId: orders.workspaceId });
    assert.equal(session.registry.activeId, orders.workspaceId);
    assert.deepEqual(coordinator.setActive(999), { error: "STALE_WORKSPACE" });
    assert.equal(session.registry.activeId, orders.workspaceId);

    coordinator.setActive(invoices.workspaceId);
    assert.deepEqual(coordinator.close(invoices.workspaceId), { outcome: "closed", activeId: customers.workspaceId });
    assert.equal(session.registry.activeId, customers.workspaceId);
    assert.equal(session.dataRuntime.size, 2);

    assert.deepEqual(coordinator.close(999), { error: "STALE_WORKSPACE" });
    coordinator.close(customers.workspaceId);
    coordinator.close(orders.workspaceId);
    assert.equal(session.registry.activeId, null);
    assert.equal(coordinator.getActive(), null);
});

test("closing a non-active workspace keeps the active workspace and preserves the remaining order", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const invoices = coordinator.openOrActivate({ database: "app", schema: "main", table: "invoices" });

    const result = coordinator.close(customers.workspaceId);

    assert.deepEqual(result, { outcome: "closed", activeId: invoices.workspaceId });
    assert.equal(session.registry.activeId, invoices.workspaceId);
    assert.deepEqual(session.registry.order, [orders.workspaceId, invoices.workspaceId]);
});

test("cancelling a dirty workspace close keeps every workspace-owned state unchanged", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: async (options) => {
            asked += 1;
            assert.equal(options.buttons[1], "Cancel");
            return "Cancel";
        },
    }));
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    coordinator.setActive(customers.workspaceId);
    const ordersEntry = session.registry.byId[orders.workspaceId];
    const pending = session.changes.get(ordersEntry.key);
    pending.inserts.push({ id: 1 });
    const structure = { snapshot: { columns: [] } };
    session.structureCache.set(ordersEntry.key, structure);
    const query = session.queryState.get(ordersEntry.key);
    const runtime = session.dataRuntime.get(ordersEntry.key);
    const registry = session.registry;

    const result = await coordinator.close(orders.workspaceId);

    assert.deepEqual(result, { outcome: "cancelled" });
    assert.equal(asked, 1);
    assert.equal(session.registry, registry);
    assert.equal(session.registry.activeId, customers.workspaceId);
    assert.equal(session.dataRuntime.get(ordersEntry.key), runtime);
    assert.equal(session.structureCache.get(ordersEntry.key), structure);
    assert.equal(session.queryState.get(ordersEntry.key), query);
    assert.equal(session.changes.get(ordersEntry.key), pending);
    assert.equal(pending.inserts.length, 1);
});

test("a delayed close confirmation cannot clear a closed and reopened workspace", async () => {
    const session = stubSession();
    let resolveConfirm;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: () => new Promise((resolve) => { resolveConfirm = resolve; }),
    }));
    const ref = { database: "app", schema: "main", table: "orders" };
    const first = coordinator.openOrActivate(ref);
    const key = session.registry.byId[first.workspaceId].key;
    session.changes.get(key).inserts.push({ id: 1 });

    const pendingClose = coordinator.close(first.workspaceId);
    session.changes.get(key).inserts.length = 0;
    coordinator.close(first.workspaceId);
    const reopened = coordinator.openOrActivate(ref);
    const reopenedRuntime = session.dataRuntime.get(key);

    resolveConfirm("Close");
    const result = await pendingClose;

    assert.deepEqual(result, { error: "STALE_WORKSPACE" });
    assert.equal(session.registry.activeId, reopened.workspaceId);
    assert.equal(session.dataRuntime.get(key), reopenedRuntime);
});

test("a delayed refresh confirmation cannot invalidate a closed and reopened workspace", async () => {
    const session = stubSession();
    let resolveConfirm;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: () => new Promise((resolve) => { resolveConfirm = resolve; }),
    }));
    const ref = { database: "app", schema: "main", table: "orders" };
    const first = coordinator.openOrActivate(ref);
    const key = session.registry.byId[first.workspaceId].key;
    session.changes.get(key).inserts.push({ id: 1 });

    const pendingRefresh = coordinator.refreshData(first.workspaceId);
    session.changes.get(key).inserts.length = 0;
    coordinator.close(first.workspaceId);
    const reopened = coordinator.openOrActivate(ref);
    const reopenedRuntime = session.dataRuntime.get(key);
    const reopenedToken = reopenedRuntime.token;

    resolveConfirm("Refresh");
    const result = await pendingRefresh;

    assert.deepEqual(result, { error: "STALE_WORKSPACE" });
    assert.equal(session.registry.activeId, reopened.workspaceId);
    assert.equal(session.dataRuntime.get(key), reopenedRuntime);
    assert.equal(reopenedRuntime.token, reopenedToken);
});

test("confirming a dirty current close only clears its workspace and selects the left neighbor", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: async (options) => {
            asked += 1;
            assert.match(options.message, /customers/);
            return "Close";
        },
    }));
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const invoices = coordinator.openOrActivate({ database: "app", schema: "main", table: "invoices" });
    coordinator.setActive(customers.workspaceId);
    const entries = [orders, customers, invoices].map(({ workspaceId }) => session.registry.byId[workspaceId]);
    const pending = new Map(entries.map((entry) => [entry.key, session.changes.get(entry.key)]));
    for (const changes of pending.values())
        changes.inserts.push({ id: 1 });

    const result = await coordinator.close(customers.workspaceId);

    assert.deepEqual(result, { outcome: "closed", activeId: orders.workspaceId });
    assert.equal(asked, 1);
    assert.deepEqual(session.registry.order, [orders.workspaceId, invoices.workspaceId]);
    assert.equal(session.registry.activeId, orders.workspaceId);
    assert.equal(session.dataRuntime.has(entries[1].key), false);
    assert.equal(session.structureCache.has(entries[1].key), false);
    assert.equal(session.queryState.has(entries[1].key), false);
    assert.equal(session.changes.has(entries[1].key), false);
    for (const entry of [entries[0], entries[2]]) {
        assert.equal(session.dataRuntime.has(entry.key), true);
        assert.equal(session.queryState.has(entry.key), true);
        assert.equal(session.changes.get(entry.key).inserts.length, 1);
    }
});

test("reopening a closed object creates a fresh workspace appended to the end of the tab order", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    coordinator.close(orders.workspaceId);

    const reopened = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    assert.equal(reopened.created, true);
    assert.ok(reopened.workspaceId > customers.workspaceId);
    assert.deepEqual(session.registry.order, [customers.workspaceId, reopened.workspaceId]);
    assert.equal(session.registry.activeId, reopened.workspaceId);
    assert.ok(session.registry.byId[reopened.workspaceId].generation > session.registry.byId[customers.workspaceId].generation);
});

test("re-activating an already open object only moves the active id without reordering tabs", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const invoices = coordinator.openOrActivate({ database: "app", schema: "main", table: "invoices" });

    const again = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders", kind: "view" });

    assert.deepEqual(again, { workspaceId: orders.workspaceId, created: false, activeId: orders.workspaceId });
    assert.deepEqual(session.registry.order, [orders.workspaceId, customers.workspaceId, invoices.workspaceId]);
});

test("changeView validates the enum and reports registry revisions", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    assert.deepEqual(coordinator.changeView(workspaceId, "charts"), { error: "INVALID_VIEW" });
    assert.equal(session.registry.byId[workspaceId].view, "data");

    const changed = coordinator.changeView(workspaceId, "query");
    assert.equal(changed.view, "query");
    assert.equal(changed.registryRevision, coordinator.revision);
    assert.equal(session.registry.byId[workspaceId].view, "query");

    assert.deepEqual(coordinator.changeView(999, "data"), { error: "STALE_WORKSPACE" });
});

test("onPendingChange only notifies for a live workspace", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const before = coordinator.revision;

    const result = coordinator.onPendingChange(workspaceId);

    assert.equal(result.registryRevision, before + 1);
    assert.equal(coordinator.revision, before + 1);
    assert.deepEqual(coordinator.onPendingChange(999), { error: "STALE_WORKSPACE" });
});

test("refreshData keeps pending changes when the user cancels the dirty confirmation", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => { asked += 1; return "Cancel"; } }));
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const key = session.registry.byId[workspaceId].key;
    session.changes.get(key).inserts.push({ id: 1 });
    const runtime = session.dataRuntime.get(key);
    runtime.cache = { displayRows: [[1]] };

    const result = await coordinator.refreshData(workspaceId);

    assert.deepEqual(result, { outcome: "cancelled" });
    assert.equal(asked, 1);
    assert.equal(session.changes.get(key).inserts.length, 1);
    assert.equal(runtime.cache.displayRows[0][0], 1);
});

test("refreshData discards pending changes after confirmation and restarts the read", async () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => "Refresh" }));
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const key = session.registry.byId[workspaceId].key;
    session.changes.get(key).inserts.push({ id: 1 });
    const runtime = session.dataRuntime.get(key);
    runtime.cache = { displayRows: [[1]] };
    const token = runtime.token;

    const result = await coordinator.refreshData(workspaceId);

    assert.deepEqual(result, { outcome: "started" });
    assert.equal(session.changes.get(key).inserts.length, 0);
    assert.equal(runtime.cache, null);
    assert.equal(runtime.token, token + 1);
});

test("changeScope clears the registry and caches, then bumps the scope epoch", async () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    session.structureCache.set("k", { columns: [] });

    const result = await coordinator.changeScope({ database: "other" });

    assert.equal(result.outcome, "committed");
    assert.equal(result.scopeEpoch, 1);
    assert.equal(session.ctx.database, "other");
    assert.equal(session.ctx.schema, "");
    assert.deepEqual(session.registry, { order: [], activeId: null, byId: {} });
    assert.equal(session.dataRuntime.size, 0);
    assert.equal(session.structureCache.size, 0);
    assert.equal(session.queryState.size, 0);
    assert.deepEqual(session.tables, [{ name: "orders", kind: "table" }]);
});

test("cancelling a dirty scope change preserves every workspace and scope state", async () => {
    const session = stubSession();
    const orders = createWorkspaceCoordinator(session, stubAdapters());
    const first = orders.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const second = orders.openOrActivate({ database: "app", schema: "main", table: "customers" });
    orders.changeView(first.workspaceId, "query");
    session.changes.get(session.registry.byId[first.workspaceId].key).inserts.push({ id: 1 });
    session.changes.get(session.registry.byId[second.workspaceId].key).inserts.push({ id: 2 });
    session.tables = [{ name: "orders", kind: "table" }];
    session.columnsMap = { orders: [{ name: "id" }] };
    const before = {
        ctx: { ...session.ctx },
        registry: session.registry,
        dataRuntime: session.dataRuntime,
        structureCache: session.structureCache,
        queryState: session.queryState,
        changes: session.changes,
        tables: session.tables,
        columnsMap: session.columnsMap,
    };
    let confirmCount = 0;
    orders.adapters.confirm = async (options) => {
        confirmCount += 1;
        assert.equal(options.buttons[1], "Cancel");
        return "Cancel";
    };

    const result = await orders.changeScope({ database: "other" });

    assert.deepEqual(result, { outcome: "cancelled" });
    assert.equal(confirmCount, 1);
    assert.deepEqual(session.ctx, before.ctx);
    assert.equal(session.registry, before.registry);
    assert.equal(session.dataRuntime, before.dataRuntime);
    assert.equal(session.structureCache, before.structureCache);
    assert.equal(session.queryState, before.queryState);
    assert.equal(session.changes, before.changes);
    assert.equal(session.tables, before.tables);
    assert.equal(session.columnsMap, before.columnsMap);
    assert.equal(session.scopeGeneration, 0);
    assert.equal(session.catalogToken, 0);
});

test("latest scope intent wins when dirty confirmations resolve out of order", async () => {
    const session = stubSession();
    const resolvers = [];
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: () => new Promise((resolve) => { resolvers.push(resolve); }),
    }));
    const first = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    session.changes.get(session.registry.byId[first.workspaceId].key).inserts.push({ id: 1 });

    const older = coordinator.changeScope({ database: "older" });
    const newer = coordinator.changeScope({ database: "newer" });
    assert.equal(resolvers.length, 2);

    resolvers[1]("Change Scope");
    await newer;
    resolvers[0]("Change Scope");
    await older;

    assert.equal(session.ctx.database, "newer");
    assert.equal(session.scopeGeneration, 1);
    assert.deepEqual(session.tables, [{ name: "orders", kind: "table" }]);
});

test("scope catalog loading reports column discovery failures", async () => {
    const session = stubSession({
        driver: {
            async listTables() {
                return [{ name: "orders", kind: "table" }];
            },
            async allColumns() {
                throw new Error("column discovery failed");
            },
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
        },
    });
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const result = await coordinator.changeScope({ schema: "other" });

    assert.equal(result.outcome, "committed");
    assert.equal(result.catalog.error.message, "column discovery failed");
    assert.equal(session.catalogError.message, "column discovery failed");
});

test("current catalog failure stores the actual error and notifies the shared catalog state", async () => {
    const session = stubSession({
        driver: {
            async listTables() {
                return [{ name: "orders", kind: "table" }];
            },
            async allColumns() {
                throw new Error("column discovery failed");
            },
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
        },
    });
    let notified = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ notifyCatalog: () => { notified += 1; } }));

    const result = await coordinator.initiateCatalogLoad();

    assert.equal(result.error.message, "column discovery failed");
    assert.equal(session.catalogError.message, "column discovery failed");
    assert.equal(notified, 1);
    assert.deepEqual(session.tables, []);
    assert.deepEqual(session.columnsMap, {});
});

test("current table discovery failure stores the actual error without a partial catalog", async () => {
    let tableCalls = 0;
    let columnCalls = 0;
    const session = stubSession({
        driver: {
            async listTables() {
                tableCalls += 1;
                throw new Error("table discovery failed");
            },
            async allColumns() {
                columnCalls += 1;
                return { orders: [{ name: "id" }] };
            },
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
        },
    });
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const result = await coordinator.initiateCatalogLoad();

    assert.equal(result.error.message, "table discovery failed");
    assert.equal(tableCalls, 1);
    assert.equal(columnCalls, 1);
    assert.equal(session.catalogError.message, "table discovery failed");
    assert.deepEqual(session.tables, []);
    assert.deepEqual(session.columnsMap, {});
});

test("catalog-only refresh keeps the existing workspace order and active object", async () => {
    const session = stubSession({
        driver: {
            async listTables() {
                return [
                    { name: "orders", kind: "table" },
                    { name: "invoices", kind: "table" },
                ];
            },
            async allColumns() {
                return { orders: ["id"], invoices: ["id"] };
            },
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
        },
    });
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    coordinator.setActive(orders.workspaceId);
    const beforeOrder = [...session.registry.order];
    const beforeActiveId = session.registry.activeId;

    await coordinator.initiateCatalogLoad();

    assert.deepEqual(session.tables, [
        { name: "orders", kind: "table" },
        { name: "invoices", kind: "table" },
    ]);
    assert.deepEqual(session.registry.order, beforeOrder);
    assert.equal(session.registry.activeId, beforeActiveId);
    assert.equal(session.registry.byId[customers.workspaceId].ref.table, "customers");
});

test("table creation success refreshes only the shared catalog", async () => {
    const session = stubSession({
        driver: {
            async runQuery() {},
            async listTables() {
                return [
                    { name: "orders", kind: "table" },
                    { name: "invoices", kind: "table" },
                ];
            },
            async allColumns() {
                return { orders: ["id"], invoices: ["id"] };
            },
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
        },
    });
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    session.coordinator = coordinator;
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    coordinator.setActive(orders.workspaceId);
    const beforeOrder = [...session.registry.order];
    const beforeActiveId = session.registry.activeId;

    const result = await createTableFromSql({
        session,
        sql: "CREATE TABLE invoices (id INTEGER);",
        onClose: () => {},
        toast: () => {},
    });
    await result.done;

    assert.equal(result.outcome, "created");
    assert.deepEqual(session.tables, [
        { name: "orders", kind: "table" },
        { name: "invoices", kind: "table" },
    ]);
    assert.deepEqual(session.registry.order, beforeOrder);
    assert.equal(session.registry.activeId, beforeActiveId);
});

test("table creation failure surfaces the actual error without changing workspaces", async () => {
    const expected = new Error("syntax error near invoices");
    const toasts = [];
    let refreshed = false;
    const session = stubSession({
        driver: {
            async runQuery() {
                throw expected;
            },
        },
    });
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    session.coordinator = { initiateCatalogLoad: () => { refreshed = true; } };
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    coordinator.setActive(orders.workspaceId);
    const beforeOrder = [...session.registry.order];
    const beforeActiveId = session.registry.activeId;

    const result = await createTableFromSql({
        session,
        sql: "CREATE TABLE invoices (id INTEGER);",
        onClose: () => {
            throw new Error("should not close designer");
        },
        toast: (message, kind) => toasts.push([message, kind]),
    });

    assert.equal(result.outcome, "error");
    assert.equal(result.error, expected);
    assert.equal(refreshed, false);
    assert.deepEqual(toasts, [["syntax error near invoices", "warning"]]);
    assert.deepEqual(session.registry.order, beforeOrder);
    assert.equal(session.registry.activeId, beforeActiveId);
});

test("stale table creation completion cannot update the current catalog", async () => {
    let finishCreate;
    let operationCtx;
    let refreshed = false;
    let closed = false;
    const session = stubSession({
        driver: {
            runQuery(ctx) {
                operationCtx = ctx;
                return new Promise((resolve) => { finishCreate = resolve; });
            },
        },
    });
    session.coordinator = { initiateCatalogLoad: () => { refreshed = true; } };

    const pending = createTableFromSql({
        session,
        sql: "CREATE TABLE invoices (id INTEGER);",
        onClose: () => {
            closed = true;
        },
        toast: () => {
            throw new Error("should not toast stale create");
        },
    });
    session.ctx = { database: "other", schema: "main" };
    session.scopeGeneration += 1;
    finishCreate();
    const result = await pending;

    assert.equal(result.outcome, "stale");
    assert.equal(refreshed, false);
    assert.equal(closed, false);
    assert.deepEqual(operationCtx, { database: "app", schema: "main" });
    assert.deepEqual(session.tables, []);
});

test("confirmed scope change clears workspaces before loading the new catalog", async () => {
    const session = stubSession({ conn: { engine: "postgres" } });
    const events = [];
    session.driver = {
        async listTables(ctx) {
            events.push(`load:${session.registry.order.length}:${session.tables.length}:${ctx.database}:${ctx.schema}`);
            return [{ name: "customers", kind: "table" }];
        },
        async allColumns() {
            return { customers: [{ name: "id" }] };
        },
        async tableInfo() {
            return { columns: [], primaryKey: [], rowid: false };
        },
    };
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: async () => "Change Scope",
        notify: () => events.push("registry"),
        notifyPending: () => events.push("pending"),
        notifyData: () => events.push("data"),
        notifyScope: () => events.push(`scope:${session.scopeGeneration}`),
        notifyCatalog: () => events.push(`catalog:${session.tables.length}`),
    }));
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const ordersKey = session.registry.byId[orders.workspaceId].key;
    session.changes.get(ordersKey).inserts.push({ id: 1 });
    session.dataRuntime.get(ordersKey).cache = { displayRows: [[1]] };
    session.structureCache.set(ordersKey, { snapshot: { columns: [] } });
    session.infoCache.set(ordersKey, { columns: [] });
    session.queryState.get(ordersKey).results = { results: [] };
    session.tables = [{ name: "orders", kind: "table" }];
    session.columnsMap = { orders: [{ name: "id" }] };
    events.length = 0;

    const result = await coordinator.changeScope({ database: "other" });

    assert.equal(result.outcome, "committed");
    assert.equal(session.ctx.database, "other");
    assert.equal(session.ctx.schema, "public");
    assert.equal(session.scopeGeneration, 1);
    assert.deepEqual(session.registry, { order: [], activeId: null, byId: {} });
    assert.equal(session.dataRuntime.size, 0);
    assert.equal(session.structureCache.size, 0);
    assert.equal(session.infoCache.size, 0);
    assert.equal(session.queryState.size, 0);
    assert.equal(session.changes.size, 0);
    assert.deepEqual(session.tables, [{ name: "customers", kind: "table" }]);
    assert.deepEqual(session.columnsMap, { customers: [{ name: "id" }] });
    assert.deepEqual(events, [
        "registry",
        "pending",
        "data",
        "scope:1",
        "catalog:0",
        "load:0:0:other:public",
        "catalog:1",
    ]);
});

test("initiateCatalogLoad does not commit a stale result over a newer scope", async () => {
    const session = stubSession();
    let resolveFirst;
    let firstCall = true;
    session.driver = {
        listTables: () => {
            if (firstCall) {
                firstCall = false;
                return new Promise((resolve) => { resolveFirst = () => resolve([{ name: "old", kind: "table" }]); });
            }
            return Promise.resolve([{ name: "orders", kind: "table" }]);
        },
        allColumns: async () => ({}),
        tableInfo: async () => ({ primaryKey: [], rowid: false }),
    };
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const pending = coordinator.initiateCatalogLoad();
    await coordinator.changeScope({ database: "other" });
    resolveFirst();
    const first = await pending;

    assert.equal(first.stale, true);
    assert.deepEqual(session.tables, [{ name: "orders", kind: "table" }]);
    assert.equal(session.catalogToken, 2);
});

test("initiate methods capture frozen operation snapshots with independent tokens", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    const read = coordinator.initiateDataRead(workspaceId, { page: 0, sort: null, filters: [], rawWhere: "" });
    assert.equal(read.ownership.workspaceId, workspaceId);
    assert.equal(read.ownership.scopeEpoch, 0);
    assert.equal(read.ownership.generation, session.registry.byId[workspaceId].generation);
    assert.equal(read.dataToken, 1);
    assert.equal(read.operationCtx.database, "app");
    session.ctx.database = "moved";
    assert.equal(read.operationCtx.database, "app");
    assert.equal(coordinator.initiateDataRead(workspaceId, {}).dataToken, 2);

    const query = coordinator.initiateQueryExecute(workspaceId, "SELECT 1", "execute");
    assert.equal(query.queryToken, 1);
    assert.equal(coordinator.initiateQueryExecute(workspaceId, "SELECT 1", "explain").queryToken, 2);
    assert.deepEqual(coordinator.initiateQueryExecute(workspaceId, "SELECT 1", "run"), { error: "INVALID_QUERY_MODE" });
    assert.deepEqual(coordinator.initiateQueryExecute(workspaceId, "  ", "execute"), { error: "INVALID_SQL" });

    const structure = coordinator.initiateStructureRead(workspaceId);
    assert.equal(structure.structureToken, 1);
    assert.equal(coordinator.initiateDataRead(workspaceId, {}).dataToken, 3);

    const apply = coordinator.initiateDataApply(workspaceId, ["UPDATE orders SET id = 1"]);
    assert.deepEqual(apply.statements, ["UPDATE orders SET id = 1"]);
    assert.deepEqual(coordinator.initiateDataApply(workspaceId, []), { error: "INVALID_STATEMENTS" });

    const write = coordinator.initiateStructureWrite(workspaceId, "DROP TABLE orders", "drop");
    assert.equal(write.operation, "drop");
    assert.deepEqual(coordinator.initiateStructureWrite(workspaceId, "DROP TABLE orders", "delete"), { error: "INVALID_STRUCTURE_OPERATION" });

    assert.deepEqual(coordinator.initiateDataRead(999, {}), { error: "STALE_WORKSPACE" });
});

test("data count snapshots keep the workspace, scope, object, and latest count token", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    const stale = coordinator.initiateDataCount(workspaceId, { page: 0, total: null });
    const current = coordinator.initiateDataCount(workspaceId, { page: 1, total: null });

    assert.equal(stale.operationCtx.database, "app");
    assert.equal(stale.objectRef.table, "orders");
    assert.equal(isCurrentDataCount(session, stale), false);
    assert.equal(isCurrentDataCount(session, current), true);

    session.scopeGeneration = 1;
    assert.equal(isCurrentDataCount(session, current), false);
});

test("confirmWindowClose aggregates all dirty workspaces into one confirmation", async () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    assert.deepEqual(await coordinator.confirmWindowClose(), { allowClose: true, dirtyWorkspaceCount: 0 });

    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    session.changes.get(session.registry.byId[orders.workspaceId].key).inserts.push({ id: 1 });
    session.changes.get(session.registry.byId[customers.workspaceId].key).inserts.push({ id: 2 });

    let message = null;
    coordinator.adapters.confirm = async (options) => { message = options.message; return "Cancel"; };
    const cancelled = await coordinator.confirmWindowClose();
    assert.deepEqual(cancelled, { allowClose: false, dirtyWorkspaceCount: 2 });
    assert.equal(message, "2 unapplied changes will be lost.");

    coordinator.adapters.confirm = async () => "Discard & Close";
    assert.deepEqual(await coordinator.confirmWindowClose(), { allowClose: true, dirtyWorkspaceCount: 2 });
});

test("confirmed window close clears every workspace-owned runtime before allowing close", async () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => "Discard & Close" }));
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const ordersKey = session.registry.byId[orders.workspaceId].key;
    const customersKey = session.registry.byId[customers.workspaceId].key;
    session.changes.get(ordersKey).inserts.push({ id: 1 });
    session.changes.get(customersKey).inserts.push({ id: 2 });
    session.dataRuntime.get(ordersKey).cache = { displayRows: [[1]] };
    session.dataCache.set(ordersKey, { displayRows: [[1]] });
    session.gridState.set(ordersKey, { page: 2 });
    session.structureCache.set(customersKey, { snapshot: { columns: [] } });
    session.infoCache.set(customersKey, { columns: [] });
    session.queryState.get(ordersKey).results = { results: [{ rows: [[1]], columns: [] }] };

    const result = await coordinator.confirmWindowClose();

    assert.deepEqual(result, { allowClose: true, dirtyWorkspaceCount: 2 });
    assert.deepEqual(session.registry, { order: [], activeId: null, byId: {} });
    assert.equal(session.dataRuntime.size, 0);
    assert.equal(session.dataCache.size, 0);
    assert.equal(session.gridState.size, 0);
    assert.equal(session.changes.size, 0);
    assert.equal(session.workspaceOwners.size, 0);
    assert.equal(session.structureCache.size, 0);
    assert.equal(session.infoCache.size, 0);
    assert.equal(session.queryState.size, 0);
});

test("clean window close releases workspace memory without showing a confirmation", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => { asked += 1; return "Cancel"; } }));
    coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    const result = await coordinator.confirmWindowClose();

    assert.deepEqual(result, { allowClose: true, dirtyWorkspaceCount: 0 });
    assert.equal(asked, 0);
    assert.deepEqual(session.registry, { order: [], activeId: null, byId: {} });
    assert.equal(session.dataRuntime.size, 0);
    assert.equal(session.queryState.size, 0);
});

test("cancelled window close keeps the aggregate workspace state unchanged", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        confirm: async () => { asked += 1; return "Cancel"; },
    }));
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const ordersKey = session.registry.byId[orders.workspaceId].key;
    const customersKey = session.registry.byId[customers.workspaceId].key;
    session.changes.get(ordersKey).inserts.push({ id: 1 });
    session.changes.get(customersKey).inserts.push({ id: 2 });
    const registry = session.registry;
    const dataRuntime = session.dataRuntime;
    const structure = { snapshot: { columns: [] } };
    session.structureCache.set(customersKey, structure);
    const query = session.queryState.get(ordersKey);

    const result = await coordinator.confirmWindowClose();

    assert.deepEqual(result, { allowClose: false, dirtyWorkspaceCount: 2 });
    assert.equal(asked, 1);
    assert.equal(session.registry, registry);
    assert.equal(session.dataRuntime, dataRuntime);
    assert.equal(session.structureCache.get(customersKey), structure);
    assert.equal(session.queryState.get(ordersKey), query);
    assert.equal(session.changes.get(ordersKey).inserts.length, 1);
    assert.equal(session.changes.get(customersKey).inserts.length, 1);
});

test("onObjectDeleted closes the bound workspace without a dirty confirmation and reloads the catalog", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => { asked += 1; return "Cancel"; } }));
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders", kind: "table" });
    session.changes.get(session.registry.byId[workspaceId].key).inserts.push({ id: 1 });

    const result = await coordinator.onObjectDeleted({ database: "app", schema: "main", table: "orders", kind: "view" });

    assert.equal(result.closedWorkspaceId, workspaceId);
    assert.equal(result.activeId, null);
    assert.equal(asked, 0);
    assert.deepEqual(session.registry.order, []);
    assert.deepEqual(session.tables, [{ name: "orders", kind: "table" }]);
    assert.deepEqual(await coordinator.onObjectDeleted({ database: "app", schema: "main", table: "orders" }), { error: "INVALID_OBJECT_REF" });
});

test("onObjectDeleted uses the complete close cleanup and selects the left workspace", async () => {
    const session = stubSession();
    let pendingNotifies = 0;
    let dataNotifies = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        notifyPending: () => { pendingNotifies += 1; },
        notifyData: () => { dataNotifies += 1; },
    }));
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const invoices = coordinator.openOrActivate({ database: "app", schema: "main", table: "invoices" });
    const entry = session.registry.byId[customers.workspaceId];
    coordinator.setActive(customers.workspaceId);
    session.structureCache.set(entry.key, { columns: [] });
    session.changes.get(entry.key).inserts.push({ id: 1 });

    const result = await coordinator.onObjectDeleted({ database: "app", schema: "main", table: "customers", kind: "view" });

    assert.equal(result.closedWorkspaceId, customers.workspaceId);
    assert.equal(result.activeId, orders.workspaceId);
    assert.deepEqual(session.registry.order, [orders.workspaceId, invoices.workspaceId]);
    assert.equal(session.dataRuntime.has(entry.key), false);
    assert.equal(session.workspaceOwners.has(entry.key), false);
    assert.equal(session.structureCache.has(entry.key), false);
    assert.equal(session.queryState.has(entry.key), false);
    assert.equal(session.changes.has(entry.key), false);
    assert.equal(pendingNotifies, 1);
    assert.equal(dataNotifies, 1);
});

test("onObjectDeleted keeps the workspace closed when catalog reload fails", async () => {
    const session = stubSession({
        driver: {
            async listTables() {
                throw new Error("catalog refresh failed");
            },
            async allColumns() {
                return {};
            },
        },
    });
    let catalogNotifies = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({
        notifyCatalog: () => { catalogNotifies += 1; },
    }));
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    const result = await coordinator.onObjectDeleted({ database: "app", schema: "main", table: "orders" });

    assert.equal(result.closedWorkspaceId, workspaceId);
    assert.equal(result.catalog.error.message, "catalog refresh failed");
    assert.deepEqual(session.registry.order, []);
    assert.equal(session.catalogError.message, "catalog refresh failed");
    assert.equal(catalogNotifies, 1);
});

test("a data read started before close cannot commit into the reopened workspace generation", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const ref = { database: "app", schema: "main", table: "orders" };
    const first = coordinator.openOrActivate(ref);
    const key = session.registry.byId[first.workspaceId].key;
    const staleRuntime = session.dataRuntime.get(key);
    const staleRequest = { ...nextDataRequest(staleRuntime, session), dataRevision: 0 };
    const staleTarget = {
        workspaceKey: key,
        workspaceId: first.workspaceId,
        workspaceGeneration: staleRuntime.generation,
        scopeEpoch: 0,
        dataRevision: 0,
        gridState: { ...staleRuntime.gridState },
    };

    coordinator.close(first.workspaceId);
    const reopened = coordinator.openOrActivate(ref);

    assert.equal(reopened.created, true);
    assert.ok(reopened.workspaceId > first.workspaceId);
    const currentRuntime = session.dataRuntime.get(key);
    assert.notEqual(currentRuntime, staleRuntime);
    assert.equal(targetIsCurrent(session, staleTarget, staleRuntime, staleRequest), false);

    const currentRequest = { ...nextDataRequest(currentRuntime, session), dataRevision: 0 };
    const currentTarget = { workspaceKey: key, workspaceId: reopened.workspaceId, workspaceGeneration: currentRuntime.generation, scopeEpoch: 0, dataRevision: 0, gridState: { ...currentRuntime.gridState } };
    assert.equal(targetIsCurrent(session, currentTarget, currentRuntime, currentRequest), true);
});

test("openOrActivate initializes per-workspace query state with SELECT * default SQL", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const ref = { database: "app", schema: "main", table: "orders", kind: "table" };

    const { workspaceId } = coordinator.openOrActivate(ref);
    const key = objectCacheKey(ref);

    const qs = session.queryState.get(key);
    assert.ok(qs, "query state should exist after openOrActivate");
    assert.ok(qs.sql.startsWith("SELECT *"), "default SQL should start with SELECT *");
    assert.equal(qs.results, null, "results should be null initially");
    assert.equal(session.queryState.size, 1, "one workspace has one query state entry");
});

test("query state is isolated per workspace with independent defaults", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });

    const ordersKey = objectCacheKey({ database: "app", schema: "main", table: "orders" });
    const customersKey = objectCacheKey({ database: "app", schema: "main", table: "customers" });

    assert.ok(session.queryState.has(ordersKey), "orders workspace has query state");
    assert.ok(session.queryState.has(customersKey), "customers workspace has query state");
    assert.equal(session.queryState.size, 2, "two workspaces have two query state entries");

    const ordersQs = session.queryState.get(ordersKey);
    const customersQs = session.queryState.get(customersKey);
    assert.notEqual(ordersQs, customersQs, "each workspace gets its own query state object");
    assert.ok(ordersQs.sql.includes("orders"), "default SQL references the bound table");
    assert.ok(customersQs.sql.includes("customers"), "default SQL references the bound table");
});

test("query state is cleaned up when workspace is closed", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const key = objectCacheKey({ database: "app", schema: "main", table: "orders" });

    assert.ok(session.queryState.has(key), "query state exists before close");
    coordinator.close(workspaceId);
    assert.equal(session.queryState.has(key), false, "query state is removed after close");
});

test("refreshData returns started without confirm when workspace has no pending changes", async () => {
    const session = stubSession();
    let asked = 0;
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => { asked += 1; return "Cancel"; } }));
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const key = session.registry.byId[workspaceId].key;

    const result = await coordinator.refreshData(workspaceId);

    assert.deepEqual(result, { outcome: "started" });
    assert.equal(asked, 0);
    const runtime = session.dataRuntime.get(key);
    assert.equal(runtime.cache, null);
});

test("refreshData returns STALE_WORKSPACE for a non-existent workspace", async () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());

    const result = await coordinator.refreshData(999);

    assert.deepEqual(result, { error: "STALE_WORKSPACE" });
});

test("refreshData returns CONFIRMATION_FAILED when confirm throws", async () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters({ confirm: async () => { throw new Error("host error"); } }));
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const key = session.registry.byId[workspaceId].key;
    session.changes.get(key).inserts.push({ id: 1, name: "temp" });

    const result = await coordinator.refreshData(workspaceId);

    assert.deepEqual(result, { error: "CONFIRMATION_FAILED" });
});

test("each workspace restores its own view across activations without reordering tabs", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session, stubAdapters());
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const invoices = coordinator.openOrActivate({ database: "app", schema: "main", table: "invoices" });

    coordinator.changeView(customers.workspaceId, "structure");
    coordinator.changeView(invoices.workspaceId, "query");

    coordinator.setActive(orders.workspaceId);
    assert.equal(coordinator.getActive().view, "data");
    coordinator.setActive(customers.workspaceId);
    assert.equal(coordinator.getActive().view, "structure");
    coordinator.setActive(invoices.workspaceId);
    assert.equal(coordinator.getActive().view, "query");
    coordinator.setActive(orders.workspaceId);
    assert.equal(coordinator.getActive().view, "data");

    assert.deepEqual(session.registry.order, [orders.workspaceId, customers.workspaceId, invoices.workspaceId]);
    assert.equal(session.registry.activeId, orders.workspaceId);
    assert.equal(session.registry.byId[customers.workspaceId].view, "structure");
    assert.equal(session.registry.byId[invoices.workspaceId].view, "query");
});
