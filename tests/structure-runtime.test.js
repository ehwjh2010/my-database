import assert from "node:assert/strict";
import test from "node:test";

import { createWorkspaceCoordinator } from "../src/workbench/workspace-coordinator.js";
import {
    cachedStructureSnapshot,
    commitStructureSnapshot,
    invalidateStructureSnapshot,
    isCurrentStructureRead,
    loadStructureSnapshot,
} from "../src/workbench/structure-runtime.js";

function stubSession(calls, overrides = {}) {
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
            async tableInfo(ctx, ref) {
                calls.push({ kind: "tableInfo", ctx, ref });
                return { columns: [{ name: "id", type: "integer" }], primaryKey: ["id"], rowid: false, indexes: [], foreignKeys: [] };
            },
            async ddl(ctx, ref) {
                calls.push({ kind: "ddl", ctx, ref });
                return `CREATE TABLE ${ref.table}(id)`;
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

function openOrders(coordinator) {
    return coordinator.openOrActivate({ database: "app", schema: "main", table: "orders", kind: "table" });
}

test("first structure entry reads once and the workspace-owned snapshot restores without re-reading", async () => {
    const calls = [];
    const session = stubSession(calls);
    const coordinator = createWorkspaceCoordinator(session, { notify: () => {} });
    const { workspaceId } = openOrders(coordinator);
    const key = session.registry.byId[workspaceId].key;
    const openedCalls = calls.length;

    assert.equal(cachedStructureSnapshot(session, key), null);

    const read = coordinator.initiateStructureRead(workspaceId);
    const snapshot = await loadStructureSnapshot(session, read);
    assert.equal(commitStructureSnapshot(session, read, snapshot), true);
    assert.deepEqual(calls.slice(openedCalls).map((call) => call.kind), ["tableInfo", "ddl"]);

    const restored = cachedStructureSnapshot(session, key);
    assert.equal(restored.info.columns[0].name, "id");
    assert.equal(restored.ddl, "CREATE TABLE orders(id)");
    assert.equal(calls.length, openedCalls + 2);
});

test("structure snapshot reports DDL failures instead of silently returning an empty DDL", async () => {
    const calls = [];
    const session = stubSession(calls, {
        driver: {
            async tableInfo() {
                return { columns: [], primaryKey: [], rowid: false };
            },
            async ddl() {
                throw new Error("ddl failed");
            },
        },
    });
    const coordinator = createWorkspaceCoordinator(session);
    const { workspaceId } = openOrders(coordinator);
    const read = coordinator.initiateStructureRead(workspaceId);

    await assert.rejects(loadStructureSnapshot(session, read), /ddl failed/);
});

test("a superseded structure token rejects the older commit and keeps the newer snapshot", async () => {
    const calls = [];
    const session = stubSession(calls);
    const coordinator = createWorkspaceCoordinator(session, { notify: () => {} });
    const { workspaceId } = openOrders(coordinator);
    const key = session.registry.byId[workspaceId].key;

    const staleRead = coordinator.initiateStructureRead(workspaceId);
    const currentRead = coordinator.initiateStructureRead(workspaceId);
    assert.notEqual(staleRead.structureToken, currentRead.structureToken);

    const staleSnapshot = await loadStructureSnapshot(session, staleRead);
    assert.equal(commitStructureSnapshot(session, staleRead, staleSnapshot), false);
    assert.equal(cachedStructureSnapshot(session, key), null);

    const currentSnapshot = await loadStructureSnapshot(session, currentRead);
    assert.equal(commitStructureSnapshot(session, currentRead, currentSnapshot), true);
    assert.equal(cachedStructureSnapshot(session, key).ddl, "CREATE TABLE orders(id)");
});

test("closing and reopening the workspace rejects the in-flight structure commit", async () => {
    const calls = [];
    const session = stubSession(calls);
    const coordinator = createWorkspaceCoordinator(session, { notify: () => {} });
    const { workspaceId } = openOrders(coordinator);

    const read = coordinator.initiateStructureRead(workspaceId);
    const snapshot = await loadStructureSnapshot(session, read);

    coordinator.close(workspaceId);
    const reopened = openOrders(coordinator);
    assert.equal(reopened.created, true);

    assert.equal(commitStructureSnapshot(session, read, snapshot), false);
    assert.equal(isCurrentStructureRead(session, read), false);
    const key = session.registry.byId[reopened.workspaceId].key;
    assert.equal(cachedStructureSnapshot(session, key), null);
});

test("a scope change rejects the in-flight structure commit and clears the cached snapshot", async () => {
    const calls = [];
    const session = stubSession(calls);
    const coordinator = createWorkspaceCoordinator(session, { notify: () => {} });
    const { workspaceId } = openOrders(coordinator);
    const key = session.registry.byId[workspaceId].key;

    const committed = coordinator.initiateStructureRead(workspaceId);
    commitStructureSnapshot(session, committed, await loadStructureSnapshot(session, committed));
    assert.notEqual(cachedStructureSnapshot(session, key), null);

    const inFlight = coordinator.initiateStructureRead(workspaceId);
    const snapshot = await loadStructureSnapshot(session, inFlight);
    await coordinator.changeScope({ database: "other" });

    assert.equal(commitStructureSnapshot(session, inFlight, snapshot), false);
    assert.equal(isCurrentStructureRead(session, inFlight), false);
    assert.equal(cachedStructureSnapshot(session, key), null);
});

test("explicit invalidation clears the snapshot so the next entry reads with a fresh token", async () => {
    const calls = [];
    const session = stubSession(calls);
    const coordinator = createWorkspaceCoordinator(session, { notify: () => {} });
    const { workspaceId } = openOrders(coordinator);
    const key = session.registry.byId[workspaceId].key;

    const first = coordinator.initiateStructureRead(workspaceId);
    commitStructureSnapshot(session, first, await loadStructureSnapshot(session, first));
    session.infoCache.set(key, { columns: [] });
    const beforeInvalidation = calls.length;

    invalidateStructureSnapshot(session, key);
    assert.equal(cachedStructureSnapshot(session, key), null);
    assert.equal(session.infoCache.has(key), false);

    const second = coordinator.initiateStructureRead(workspaceId);
    assert.ok(second.structureToken > first.structureToken);
    assert.equal(commitStructureSnapshot(session, first, { info: { columns: [] }, ddl: "old" }), false);
    commitStructureSnapshot(session, second, await loadStructureSnapshot(session, second));
    assert.equal(cachedStructureSnapshot(session, key).ddl, "CREATE TABLE orders(id)");
    assert.equal(calls.length, beforeInvalidation + 2);
});

test("data reads and refreshes keep the structure snapshot and request identity untouched", async () => {
    const calls = [];
    const session = stubSession(calls);
    const coordinator = createWorkspaceCoordinator(session, { notify: () => {} });
    const { workspaceId } = openOrders(coordinator);
    const key = session.registry.byId[workspaceId].key;

    const structureRead = coordinator.initiateStructureRead(workspaceId);
    commitStructureSnapshot(session, structureRead, await loadStructureSnapshot(session, structureRead));
    const structureToken = session.workspaceOwners.get(key).structureRequest;

    const dataRead = coordinator.initiateDataRead(workspaceId, { page: 0, rawWhere: "", rawOrderBy: "" });
    assert.equal(dataRead.dataToken, 1);
    assert.equal(session.workspaceOwners.get(key).structureRequest, structureToken);

    const refresh = await coordinator.refreshData(workspaceId);
    assert.equal(refresh.outcome, "started");
    assert.equal(session.workspaceOwners.get(key).structureRequest, structureToken);
    assert.equal(cachedStructureSnapshot(session, key).ddl, "CREATE TABLE orders(id)");

    const again = coordinator.initiateStructureRead(workspaceId);
    assert.equal(again.structureToken, structureToken + 1);
    assert.equal(session.dataRuntime.get(key).token, dataRead.dataToken + 1);
});
