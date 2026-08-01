import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceCoordinator } from "../src/workbench/workspace-coordinator.js";
import { commitQueryError, commitQueryResult, isCurrentQueryRequest } from "../src/workbench/query-runtime.js";

function stubSession(overrides = {}) {
    return {
        conn: { engine: "sqlite" },
        ctx: { database: "app", schema: "main" },
        driver: {
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
        },
        changes: new Map(),
        dataCache: new Map(),
        dataRuntime: new Map(),
        gridState: new Map(),
        infoCache: new Map(),
        queryState: new Map(),
        structureCache: new Map(),
        workspaceOwners: new Map(),
        scopeGeneration: 0,
        ...overrides,
    };
}

test("query result commits only to the current token and keeps its export context", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session);
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });

    const stale = coordinator.initiateQueryExecute(workspaceId, "SELECT 1", "execute");
    const current = coordinator.initiateQueryExecute(workspaceId, "SELECT 2", "execute");
    const result = { columns: [{ name: "id" }], rows: [[2]] };

    assert.equal(isCurrentQueryRequest(session, stale), false);
    assert.equal(commitQueryResult(session, stale, [result]), false);
    assert.equal(commitQueryResult(session, current, [result]), true);

    const state = session.queryState.get(session.registry.byId[workspaceId].key);
    assert.deepEqual(state.results, { results: [result] });
    assert.deepEqual(state.exportContext, { objectRef: current.objectRef, result });
});

test("closing and reopening rejects old query success and failure", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session);
    const ref = { database: "app", schema: "main", table: "orders" };
    const first = coordinator.openOrActivate(ref);
    const request = coordinator.initiateQueryExecute(first.workspaceId, "SELECT 1", "execute");

    coordinator.close(first.workspaceId);
    const reopened = coordinator.openOrActivate(ref);
    const state = session.queryState.get(session.registry.byId[reopened.workspaceId].key);

    assert.equal(isCurrentQueryRequest(session, request), false);
    assert.equal(commitQueryResult(session, request, [{ columns: [{ name: "id" }], rows: [[1]] }]), false);
    assert.equal(commitQueryError(session, request, "old failure"), false);
    assert.equal(state.results, null);
    assert.equal(state.exportContext, null);
});

test("current query failure keeps its last successful result and export context", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session);
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const success = coordinator.initiateQueryExecute(workspaceId, "SELECT 1", "execute");
    commitQueryResult(session, success, [{ columns: [{ name: "id" }], rows: [[1]] }]);
    const failure = coordinator.initiateQueryExecute(workspaceId, "SELECT broken", "execute");

    assert.equal(commitQueryError(session, failure, "syntax error"), true);
    const state = session.queryState.get(session.registry.byId[workspaceId].key);
    assert.deepEqual(state.results, { results: [{ columns: [{ name: "id" }], rows: [[1]] }] });
    assert.deepEqual(state.exportContext, { objectRef: success.objectRef, result: { columns: [{ name: "id" }], rows: [[1]] } });
    assert.equal(state.queryError, "syntax error");
    assert.equal(state.queryRunning, false);
});

test("SQL query ownership includes tab generation, request token, and console epoch", async () => {
    const session = stubSession({
        conn: { engine: "sqlite", sqlite: { path: "/tmp/app.sqlite" } },
        sqlNamespace: { databaseDir: "/tmp/sql", fingerprint: "fingerprint", databaseKey: "fingerprint" },
    });
    const coordinator = createWorkspaceCoordinator(session, {
        sqlFiles: {
            async createSqlFile(_, name) {
                return { name, path: `/tmp/sql/${name}`, size: 0, mtimeMs: 0, reserved: false };
            },
        },
    });
    const { sqlTabId } = await coordinator.newQuery();
    const request = coordinator.initiateQueryExecute(sqlTabId, "SELECT 1", "execute");

    assert.equal(request.tabId, sqlTabId);
    assert.equal(request.tabGeneration, session.sqlRegistry.byId[sqlTabId].generation);
    assert.equal(request.requestToken, 1);
    assert.equal(request.consoleEpoch, 0);
    assert.equal(isCurrentQueryRequest(session, request), true);

    coordinator.initiateQueryExecute(sqlTabId, "SELECT 2", "execute");
    assert.equal(isCurrentQueryRequest(session, request), false);
    session.consoleEpoch += 1;
    assert.equal(isCurrentQueryRequest(session, { ...request, requestToken: 2 }), false);
});

test("SQL query can commit after switching away from Console while its tab remains open", async () => {
    const session = stubSession({
        conn: { engine: "sqlite", sqlite: { path: "/tmp/app.sqlite" } },
        sqlNamespace: { databaseDir: "/tmp/sql", fingerprint: "fingerprint", databaseKey: "fingerprint" },
    });
    const coordinator = createWorkspaceCoordinator(session, {
        sqlFiles: {
            async createSqlFile(_, name) {
                return { name, path: `/tmp/sql/${name}`, size: 0, mtimeMs: 0, reserved: false };
            },
        },
    });
    const { sqlTabId } = await coordinator.newQuery();
    const request = coordinator.initiateQueryExecute(sqlTabId, "SELECT 1", "execute");
    session.surface = "object";

    assert.equal(commitQueryResult(session, request, [{ columns: [{ name: "id" }], rows: [[1]] }]), true);
});

test("schema changes preserve SQL ownership while database changes invalidate it", async () => {
    const session = stubSession({
        conn: { engine: "postgres", net: { database: "app" } },
        driver: {
            async listTables() { return []; },
            async allColumns() { return {}; },
            async tableInfo() { return { columns: [], primaryKey: [], rowid: false }; },
        },
        sqlNamespace: { databaseDir: "/tmp/sql", fingerprint: "fingerprint", databaseKey: "fingerprint" },
    });
    const coordinator = createWorkspaceCoordinator(session, {
        sqlFiles: {
            async createSqlFile(_, name) {
                return { name, path: `/tmp/sql/${name}`, size: 0, mtimeMs: 0, reserved: false };
            },
        },
    });
    const { sqlTabId } = await coordinator.newQuery();
    const schemaRequest = coordinator.initiateQueryExecute(sqlTabId, "SELECT 1", "execute");

    await coordinator.changeScope({ schema: "reporting" });
    assert.equal(session.consoleEpoch, 0);
    assert.equal(isCurrentQueryRequest(session, schemaRequest), true);
    assert.equal(commitQueryResult(session, schemaRequest, [{ columns: [], rows: [] }]), true);

    const databaseRequest = coordinator.initiateQueryExecute(sqlTabId, "SELECT 2", "execute");
    await coordinator.changeScope({ database: "other" });
    assert.equal(session.consoleEpoch, 1);
    assert.equal(isCurrentQueryRequest(session, databaseRequest), false);
});

test("query state stays isolated across workspaces and scope epochs", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session);
    const orders = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const customers = coordinator.openOrActivate({ database: "app", schema: "main", table: "customers" });
    const ordersRequest = coordinator.initiateQueryExecute(orders.workspaceId, "SELECT 1", "execute");
    const customersRequest = coordinator.initiateQueryExecute(customers.workspaceId, "SELECT 2", "execute");

    assert.equal(commitQueryResult(session, customersRequest, [{ columns: [{ name: "id" }], rows: [[2]] }]), true);
    assert.equal(session.queryState.get(session.registry.byId[orders.workspaceId].key).results, null);
    assert.equal(session.queryState.get(session.registry.byId[customers.workspaceId].key).exportContext.objectRef.table, "customers");

    session.scopeGeneration = 1;
    assert.equal(isCurrentQueryRequest(session, ordersRequest), false);
    assert.equal(commitQueryResult(session, ordersRequest, [{ columns: [{ name: "id" }], rows: [[1]] }]), false);
});

test("SQL tab query results stay isolated and expose export context", async () => {
    const session = stubSession({
        conn: { engine: "sqlite", sqlite: { path: "/tmp/app.sqlite" } },
        sqlNamespace: { databaseDir: "/tmp/sql", fingerprint: "fingerprint", databaseKey: "fingerprint" },
        sqlFiles: [],
    });
    const coordinator = createWorkspaceCoordinator(session, {
        sqlFiles: {
            async createSqlFile(_, name) {
                return { name, path: `/tmp/sql/${name}`, size: 0, mtimeMs: 0, reserved: false };
            },
        },
    });
    const { sqlTabId } = await coordinator.newQuery();
    const request = coordinator.initiateQueryExecute(sqlTabId, "SELECT 1", "execute");
    const result = { columns: [{ name: "id" }], rows: [[1]] };

    assert.equal(commitQueryResult(session, request, [result]), true);
    const state = session.sqlState.get(request.sqlKey);
    assert.equal(state.sql, "");
    assert.deepEqual(state.results, { results: [result] });
    assert.deepEqual(state.exportContext, { objectRef: undefined, result });
});
