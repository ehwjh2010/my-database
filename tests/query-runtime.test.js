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

test("current query failure replaces its result and export context", () => {
    const session = stubSession();
    const coordinator = createWorkspaceCoordinator(session);
    const { workspaceId } = coordinator.openOrActivate({ database: "app", schema: "main", table: "orders" });
    const success = coordinator.initiateQueryExecute(workspaceId, "SELECT 1", "execute");
    commitQueryResult(session, success, [{ columns: [{ name: "id" }], rows: [[1]] }]);
    const failure = coordinator.initiateQueryExecute(workspaceId, "SELECT broken", "execute");

    assert.equal(commitQueryError(session, failure, "syntax error"), true);
    const state = session.queryState.get(session.registry.byId[workspaceId].key);
    assert.deepEqual(state.results, { error: "syntax error" });
    assert.equal(state.exportContext, null);
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

test("SQL tab query results stay isolated and expose export context", () => {
    const session = stubSession({ conn: { engine: "sqlite", sqlite: { path: "/tmp/app.sqlite" } } });
    const coordinator = createWorkspaceCoordinator(session);
    const { sqlTabId } = coordinator.newQuery();
    const request = coordinator.initiateQueryExecute(sqlTabId, "SELECT 1", "execute");
    const result = { columns: [{ name: "id" }], rows: [[1]] };

    assert.equal(commitQueryResult(session, request, [result]), true);
    assert.deepEqual(session.sqlState.get(request.sqlKey), {
        sql: "",
        results: { results: [result] },
        exportContext: { objectRef: undefined, result },
    });
});
