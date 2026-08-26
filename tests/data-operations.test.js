import assert from "node:assert/strict";
import test from "node:test";

import { dataOperationFor, settleDataOperation, startDataOperation } from "../src/workbench/data-operations.js";
import { deriveDataToolbar } from "../src/grid/data-toolbar.js";

function session() {
    return {
        registry: { byId: { 1: { id: 1, key: "orders" } } },
        workspaceOwners: new Map([["orders", {}]]),
    };
}

test("one workspace operation slot rejects overlap and settles only its matching token", () => {
    const state = session();
    const apply = startDataOperation(state, 1, "apply");

    assert.equal(apply.kind, "apply");
    assert.equal(dataOperationFor(state, 1).busy, true);
    assert.deepEqual(startDataOperation(state, 1, "export"), { error: "DATA_OPERATION_IN_PROGRESS" });
    assert.deepEqual(settleDataOperation(state, { ...apply, operationToken: apply.operationToken + 1 }), { outcome: "stale" });
    assert.equal(dataOperationFor(state, 1).kind, "apply");
    assert.deepEqual(settleDataOperation(state, apply), { outcome: "settled" });
    assert.deepEqual(dataOperationFor(state, 1), { kind: "idle", busy: false });
});

test("data operation projection is idle after its workspace is gone", () => {
    const state = session();
    startDataOperation(state, 1, "import");
    delete state.registry.byId[1];

    assert.deepEqual(dataOperationFor(state, 1), { kind: "idle", busy: false });
});

test("idle projection does not create an operation owner", () => {
    const state = {
        registry: { byId: { 1: { id: 1, key: "orders" } } },
        workspaceOwners: new Map(),
    };

    assert.deepEqual(dataOperationFor(state, 1), { kind: "idle", busy: false });
    assert.equal(state.workspaceOwners.size, 0);
});

test("toolbar projection keeps nine commands and reports busy and disabled states", () => {
    const toolbar = deriveDataToolbar({
        hasObject: true,
        pageState: "ready",
        editable: true,
        hasStableSelection: true,
        pendingCount: 2,
        operationKind: "apply",
        importSupported: true,
    });

    assert.deepEqual(toolbar.commands.map((command) => command.id), ["refresh", "new-row", "delete-row", "discard-all", "review-dml", "apply", "ddl", "import", "export"]);
    assert.equal(toolbar.mutationLocked, true);
    assert.equal(toolbar.byId.apply.busy, true);
    assert.equal(toolbar.byId.apply.icon, "clock");
    assert.equal(toolbar.byId.refresh.disabledReason, "DATA_MUTATION_IN_PROGRESS");
    assert.equal(toolbar.byId.ddl.enabled, true);
    assert.equal(toolbar.pendingLabel, "2 pending");
});

test("toolbar disables every object command when no object is selected", () => {
    const toolbar = deriveDataToolbar({
        hasObject: false,
        pageState: "ready",
        editable: true,
        hasStableSelection: true,
        pendingCount: 1,
        operationKind: "idle",
        importSupported: true,
    });

    for (const command of toolbar.commands)
        assert.equal(command.enabled, false, command.id);
    assert.equal(toolbar.byId.refresh.disabledReason, "OBJECT_REQUIRED");
    assert.equal(toolbar.byId["new-row"].disabledReason, "OBJECT_REQUIRED");
    assert.equal(toolbar.byId.apply.disabledReason, "OBJECT_REQUIRED");
});

test("toolbar projection preserves export-time editing and hides only zero pending text", () => {
    const toolbar = deriveDataToolbar({
        hasObject: true,
        pageState: "ready",
        editable: true,
        hasStableSelection: true,
        pendingCount: 0,
        operationKind: "export",
        importSupported: true,
    });

    assert.equal(toolbar.mutationLocked, false);
    assert.equal(toolbar.byId.refresh.enabled, true);
    assert.equal(toolbar.byId["new-row"].enabled, true);
    assert.equal(toolbar.byId.apply.disabledReason, "DATA_OPERATION_IN_PROGRESS");
    assert.equal(toolbar.byId.export.busy, true);
    assert.equal(toolbar.pendingLabel, null);
});

test("toolbar gives an existing export priority over import readiness failures", () => {
    const toolbar = deriveDataToolbar({
        hasObject: true,
        pageState: "loading",
        editable: false,
        hasStableSelection: false,
        pendingCount: 1,
        operationKind: "export",
        importSupported: false,
    });

    assert.equal(toolbar.byId.import.disabledReason, "DATA_OPERATION_IN_PROGRESS");
});

test("toolbar projection gives operation and page readiness the documented priority", () => {
    const toolbar = deriveDataToolbar({
        hasObject: true,
        pageState: "loading",
        editable: false,
        hasStableSelection: false,
        pendingCount: 1,
        operationKind: "import",
        importSupported: false,
    });

    assert.equal(toolbar.byId.refresh.disabledReason, "DATA_MUTATION_IN_PROGRESS");
    assert.equal(toolbar.byId["new-row"].disabledReason, "DATA_MUTATION_IN_PROGRESS");
    assert.equal(toolbar.byId.apply.disabledReason, "DATA_OPERATION_IN_PROGRESS");
    assert.equal(toolbar.byId.import.busy, true);
    assert.equal(toolbar.byId.export.disabledReason, "DATA_OPERATION_IN_PROGRESS");
    assert.equal(toolbar.byId.ddl.enabled, true);
});
