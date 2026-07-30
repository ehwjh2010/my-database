import assert from "node:assert/strict";
import test from "node:test";

import {
    initialWorkspaceState,
    objectCacheKey,
    sameObjectRef,
    workspaceReducer,
    pendingChangeCount,
    pendingChangeCountFor,
    pendingChangeCountAll,
    isCurrentScopeGeneration,
    isCurrentOwnerToken,
    isCurrentDataRequest,
    isCurrentStructureRequest,
    isCurrentQueryEntry,
    isCurrentDataApply,
} from "../src/workbench/workspace-state.js";

test("objectCacheKey never collides when names contain dots", () => {
    const dottedSchema = { database: "app", schema: "sales.report", table: "orders" };
    const dottedTable = { database: "app", schema: "sales", table: "report.orders" };

    assert.notEqual(objectCacheKey(dottedSchema), objectCacheKey(dottedTable));
    assert.equal(objectCacheKey(dottedSchema), objectCacheKey({ ...dottedSchema, kind: "view" }));
});

test("objectCacheKey distinguishes empty and missing scope parts", () => {
    assert.equal(objectCacheKey({ table: "orders" }), objectCacheKey({ database: "", schema: "", table: "orders" }));
    assert.notEqual(objectCacheKey({ schema: "public", table: "orders" }), objectCacheKey({ database: "public", table: "orders" }));
});

test("sameObjectRef compares database, schema, and table field-wise and ignores kind", () => {
    const ref = { database: "app", schema: "main", table: "orders", kind: "table" };

    assert.equal(sameObjectRef(ref, { database: "app", schema: "main", table: "orders", kind: "view" }), true);
    assert.equal(sameObjectRef(ref, { table: "orders" }), false);
    assert.equal(sameObjectRef({ table: "orders" }, { database: "", schema: "", table: "orders" }), true);
    assert.equal(
        sameObjectRef({ database: "app", schema: "sales.report", table: "orders" }, { database: "app", schema: "sales", table: "report.orders" }),
        false,
    );
});

test("OPEN adds and activates a workspace with id, generation, and data view", () => {
    const ref = { database: "app", schema: "public", table: "orders" };

    assert.deepEqual(workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref }), {
        order: [1],
        activeId: 1,
        byId: { 1: { id: 1, key: "k1", generation: 1, ref, view: "data" } },
    });
});

test("OPEN of an existing workspace only activates its original immutable ref", () => {
    const firstRef = { database: "app", schema: "public", table: "orders" };
    const opened = workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: firstRef });
    const state = workspaceReducer(opened, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { ...firstRef, kind: "view" } });

    assert.equal(state.activeId, 1);
    assert.deepEqual(state.order, [1]);
    assert.deepEqual(state.byId[1].ref, firstRef);
    assert.equal(Object.isFrozen(state.byId[1].ref), true);
});

test("OPEN appends a distinct workspace and activates it", () => {
    const opened = workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } });
    const state = workspaceReducer(opened, { type: "OPEN", id: 2, generation: 2, key: "k2", ref: { table: "customers" } });

    assert.deepEqual(state.order, [1, 2]);
    assert.equal(state.activeId, 2);
});

test("ACTIVATE changes only to an open workspace", () => {
    const opened = workspaceReducer(
        workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } }),
        { type: "OPEN", id: 2, generation: 2, key: "k2", ref: { table: "customers" } },
    );

    assert.equal(workspaceReducer(opened, { type: "ACTIVATE", id: 1 }).activeId, 1);
    assert.equal(workspaceReducer(opened, { type: "ACTIVATE", id: 99 }), opened);
});

test("SET_VIEW updates only the selected workspace", () => {
    const opened = workspaceReducer(
        workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } }),
        { type: "OPEN", id: 2, generation: 2, key: "k2", ref: { table: "customers" } },
    );
    const state = workspaceReducer(opened, { type: "SET_VIEW", id: 1, view: "structure" });

    assert.equal(state.byId[1].view, "structure");
    assert.equal(state.byId[2].view, "data");
});

test("SET_VIEW keeps independent data, structure, and query views per workspace", () => {
    const opened = [1, 2, 3].reduce(
        (state, id) => workspaceReducer(state, { type: "OPEN", id, generation: id, key: `k${id}`, ref: { table: `t${id}` } }),
        initialWorkspaceState,
    );
    const state = ["structure", "query", "data"].reduce(
        (next, view, index) => workspaceReducer(next, { type: "SET_VIEW", id: index + 1, view }),
        opened,
    );

    assert.equal(state.byId[1].view, "structure");
    assert.equal(state.byId[2].view, "query");
    assert.equal(state.byId[3].view, "data");
    assert.deepEqual(state.order, [1, 2, 3]);
});

test("CLOSE removes an inactive workspace without changing the active one", () => {
    const opened = workspaceReducer(
        workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } }),
        { type: "OPEN", id: 2, generation: 2, key: "k2", ref: { table: "customers" } },
    );
    const state = workspaceReducer(opened, { type: "CLOSE", id: 1 });

    assert.deepEqual(state.order, [2]);
    assert.equal(state.activeId, 2);
});

test("CLOSE of an active workspace prefers the workspace to its left", () => {
    const opened = [1, 2, 3].reduce(
        (state, id) => workspaceReducer(state, { type: "OPEN", id, generation: id, key: `k${id}`, ref: { table: `t${id}` } }),
        initialWorkspaceState,
    );
    const state = workspaceReducer(opened, { type: "CLOSE", id: 3 });

    assert.equal(state.activeId, 2);
});

test("CLOSE of the first active workspace uses the workspace to its right", () => {
    const opened = workspaceReducer(
        workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } }),
        { type: "OPEN", id: 2, generation: 2, key: "k2", ref: { table: "customers" } },
    );
    const activeFirst = workspaceReducer(opened, { type: "ACTIVATE", id: 1 });
    const state = workspaceReducer(activeFirst, { type: "CLOSE", id: 1 });

    assert.equal(state.activeId, 2);
});

test("CLOSE of the last workspace returns an empty registry", () => {
    const state = workspaceReducer(
        workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } }),
        { type: "CLOSE", id: 1 },
    );

    assert.deepEqual(state, initialWorkspaceState);
});

test("CLEAR_ALL empties the workspace registry", () => {
    const opened = workspaceReducer(initialWorkspaceState, { type: "OPEN", id: 1, generation: 1, key: "k1", ref: { table: "orders" } });

    assert.deepEqual(workspaceReducer(opened, { type: "CLEAR_ALL" }), initialWorkspaceState);
});

test("pending helpers count one workspace and aggregate all workspaces", () => {
    const orders = { edits: new Map([["row", { cells: new Map([["name", "next"], ["status", "open"]]) }]]), deletes: new Map([["deleted", []]]), inserts: [{ id: 1 }] };
    const customers = { edits: new Map([["row", { cells: new Map([["name", "next"]]) }]]), deletes: new Map(), inserts: [] };
    const changes = new Map([["orders", orders], ["customers", customers]]);

    assert.equal(pendingChangeCount(), 0);
    assert.equal(pendingChangeCount(orders), 4);
    assert.equal(pendingChangeCountFor(changes, "orders"), 4);
    assert.equal(pendingChangeCountFor(changes, "missing"), 0);
    assert.equal(pendingChangeCountAll(changes), 5);
});

test("scope generation only accepts the current generation", () => {
    assert.equal(isCurrentScopeGeneration(3, 3), true);
    assert.equal(isCurrentScopeGeneration(3, 2), false);
});

test("Data and Structure owner-token checks keep their tokens independent", () => {
    const owner = {};
    const reopenedOwner = {};
    const dataToken = 1;
    const structureToken = 7;

    assert.equal(isCurrentOwnerToken(owner, dataToken, owner, dataToken), true);
    assert.equal(isCurrentOwnerToken(owner, dataToken, owner, 2), false);
    assert.equal(isCurrentOwnerToken(owner, dataToken, reopenedOwner, dataToken), false);
    assert.equal(isCurrentDataRequest({ owner, token: dataToken, currentOwner: owner, currentToken: dataToken, generation: 4, currentGeneration: 4 }), true);
    assert.equal(isCurrentDataRequest({ owner, token: dataToken, currentOwner: owner, currentToken: dataToken, generation: 4, currentGeneration: 5 }), false);
    assert.equal(isCurrentStructureRequest({ owner, token: structureToken, currentOwner: owner, currentToken: structureToken, generation: 4, currentGeneration: 4 }), true);
    assert.equal(isCurrentStructureRequest({ owner, token: structureToken, currentOwner: owner, currentToken: structureToken + 1, generation: 4, currentGeneration: 4 }), false);
    assert.equal(isCurrentDataRequest({ owner, token: dataToken, currentOwner: owner, currentToken: dataToken + 1, generation: 4, currentGeneration: 4 }), false);
    assert.equal(isCurrentStructureRequest({ owner, token: structureToken, currentOwner: owner, currentToken: structureToken, generation: 4, currentGeneration: 4 }), true);
    assert.equal(isCurrentDataRequest({ owner, token: dataToken, currentOwner: owner, currentToken: dataToken, generation: 4, currentGeneration: 4 }), true);
    assert.equal(isCurrentStructureRequest({ owner, token: structureToken, currentOwner: owner, currentToken: structureToken + 1, generation: 4, currentGeneration: 4 }), false);
});

test("isCurrentDataApply verifies workspace existence, scopeEpoch, and generation", () => {
    const session = {
        registry: {
            byId: {
                1: { id: 1, generation: 5 },
            },
        },
        scopeGeneration: 3,
    };

    assert.equal(isCurrentDataApply(session, { workspaceId: 1, scopeEpoch: 3, generation: 5 }), true);
    assert.equal(isCurrentDataApply(session, { workspaceId: 1, scopeEpoch: 3, generation: 6 }), false);
    assert.equal(isCurrentDataApply(session, { workspaceId: 1, scopeEpoch: 4, generation: 5 }), false);
    assert.equal(isCurrentDataApply(session, { workspaceId: 99, scopeEpoch: 3, generation: 5 }), false);
    assert.equal(isCurrentDataApply(session, null), false);
});

test("Query result writes require the captured entry identity", () => {
    const entry = {};
    assert.equal(isCurrentQueryEntry(entry, entry), true);
    assert.equal(isCurrentQueryEntry(entry, {}), false);
    assert.equal(isCurrentQueryEntry(entry, null), false);
});
