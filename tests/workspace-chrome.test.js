import assert from "node:assert/strict";
import test from "node:test";

import { closeWorkspaceTabIntent, flattenSessionTabs, parseTabStripKey, projectWorkspaceTabs, sqlFileMenuItems, workspaceSwitchMenuItems, workspaceTabTitle } from "../src/workbench/workspace-chrome.js";

function makeRegistry() {
    return {
        order: [1, 2, 3],
        activeId: 2,
        byId: {
            1: { id: 1, key: "k1", generation: 1, ref: { database: "", schema: "", table: "orders", kind: "table" }, view: "data" },
            2: { id: 2, key: "k2", generation: 2, ref: { database: "", schema: "", table: "recent_orders", kind: "view" }, view: "data" },
            3: { id: 3, key: "k3", generation: 3, ref: { database: "", schema: "", table: "monthly_settlement_report_lines_2026", kind: "table" }, view: "data" },
        },
    };
}

const dirtyChanges = new Map([
    ["k2", { edits: new Map([["row", { cells: new Map([["name", "next"]]) }]]), deletes: new Map(), inserts: [] }],
]);

test("workspaceTabTitle exposes the complete object name for tooltips", () => {
    const long = "monthly_settlement_report_lines_2026";

    assert.equal(workspaceTabTitle({ table: long, kind: "table" }), long);
    assert.equal(workspaceTabTitle({ table: "recent_orders", kind: "view" }), "View: recent_orders");
    assert.equal(workspaceTabTitle({ table: "orders", kind: "table" }, "structure"), "DDL: orders");
    assert.ok(workspaceTabTitle({ table: long, kind: "table" }).includes(long));
});

test("projectWorkspaceTabs lists a structure workspace as a distinct DDL tab", () => {
    const tabs = projectWorkspaceTabs({
        order: [1, 2],
        activeId: 2,
        byId: {
            1: { id: 1, key: "k1", generation: 1, ref: { database: "", schema: "", table: "orders", kind: "table" }, view: "data" },
            2: { id: 2, key: "k1:structure", generation: 2, ref: { database: "", schema: "", table: "orders", kind: "table" }, view: "structure" },
        },
        changesByKey: new Map(),
    });

    assert.deepEqual(tabs.map((tab) => tab.name), ["orders", "DDL: orders"]);
    assert.deepEqual(tabs.map((tab) => tab.title), ["orders", "DDL: orders"]);
    assert.deepEqual(tabs.map((tab) => tab.icon), ["table", "columns"]);
    assert.equal(tabs[1].active, true);
    assert.equal(tabs[1].dirty, false);
});

test("projectWorkspaceTabs lists tabs in registry open order with name, title, active and dirty", () => {
    const { order, activeId, byId } = makeRegistry();
    const tabs = projectWorkspaceTabs({ order, byId, activeId, changesByKey: dirtyChanges });

    assert.deepEqual(tabs.map((tab) => tab.id), [1, 2, 3]);
    assert.deepEqual(tabs.map((tab) => tab.name), ["orders", "recent_orders", "monthly_settlement_report_lines_2026"]);
    assert.deepEqual(tabs.map((tab) => tab.active), [false, true, false]);
    assert.deepEqual(tabs.map((tab) => tab.dirty), [false, true, false]);
    assert.deepEqual(tabs.map((tab) => tab.icon), ["table", "eye", "table"]);
    for (const tab of tabs) {
        assert.ok(tab.title.includes(tab.name), "title carries the complete object name");
        assert.ok(tab.closeLabel.includes(tab.name), "close aria-label names the object");
        assert.equal(tab.dirtyLabel, "Unsaved changes", "dirty marker has non-color accessible text");
    }
});

test("projectWorkspaceTabs derives dirty only from the shared pending-changes source", () => {
    const { order, activeId, byId } = makeRegistry();

    assert.ok(projectWorkspaceTabs({ order, byId, activeId, changesByKey: new Map() }).every((tab) => !tab.dirty));
    assert.ok(projectWorkspaceTabs({ order, byId, activeId, changesByKey: dirtyChanges })[1].dirty);
});

test("projectWorkspaceTabs skips registry ids missing from byId", () => {
    const { activeId, byId } = makeRegistry();
    const tabs = projectWorkspaceTabs({ order: [1, 99], byId, activeId, changesByKey: new Map() });

    assert.deepEqual(tabs.map((tab) => tab.id), [1]);
});

test("workspaceSwitchMenuItems lists every workspace in tab order with activate-only items", () => {
    const { order, byId } = makeRegistry();
    const activated = [];
    const items = workspaceSwitchMenuItems({ order, byId, onActivate: (id) => activated.push(id) });

    assert.deepEqual(items.map((item) => item.label), ["orders", "recent_orders", "monthly_settlement_report_lines_2026"]);
    for (const item of items)
        assert.deepEqual(Object.keys(item).sort(), ["label", "onClick"], "menu item carries no close entry or dirty marker");
    items[2].onClick();
    items[0].onClick();
    assert.deepEqual(activated, [3, 1], "menu item only activates its target workspace");
});

test("workspaceSwitchMenuItems is empty when no workspace is open", () => {
    assert.deepEqual(workspaceSwitchMenuItems({ order: [], byId: {}, onActivate: () => {} }), []);
});

test("sqlFileMenuItems includes create and every existing file", () => {
    const opened = [];
    const items = sqlFileMenuItems({
        files: [
            { name: "console.sql", reserved: true },
            { name: "open.sql", reserved: false },
            { name: "saved.sql", reserved: false },
        ],
        onCreate: () => opened.push("create"),
        onOpen: (file) => opened.push(file.name),
    });

    assert.deepEqual(items.map((item) => item.label), ["New SQL File...", "console.sql", "open.sql", "saved.sql"]);
    items[0].onClick();
    items[1].onClick();
    items[2].onClick();
    assert.deepEqual(opened, ["create", "console.sql", "open.sql"]);
});

test("projectWorkspaceTabs renders SQL tabs with code icons and no dirty state", () => {
    const tabs = projectWorkspaceTabs({
        order: [4],
        activeId: 4,
        byId: { 4: { id: 4, key: "sql:4", kind: "sql", name: "New Query", title: "New Query" } },
        changesByKey: null,
    });

    assert.deepEqual(tabs, [{
        id: 4,
        key: "sql:4",
        name: "New Query",
        title: "New Query",
        icon: "code",
        active: true,
        dirty: false,
        dirtyLabel: "Unsaved changes",
        closeLabel: "Close New Query",
    }]);
});

test("flattenSessionTabs lists SQL and object tabs in mixed open order", () => {
    const flattened = flattenSessionTabs({
        tabOrder: [{ kind: "sql", id: 4 }, { kind: "object", id: 1 }],
        sqlRegistry: {
            activeId: 4,
            byId: { 4: { id: 4, key: "sql:4", kind: "sql", name: "console.sql", title: "console.sql" } },
        },
        registry: {
            activeId: 1,
            byId: { 1: { id: 1, key: "k1", ref: { table: "orders", kind: "table" }, view: "data" } },
        },
        surface: "console",
    });
    const tabs = projectWorkspaceTabs({ ...flattened, changesByKey: new Map() });

    assert.deepEqual(parseTabStripKey(tabs[0].id), { kind: "sql", id: 4 });
    assert.deepEqual(tabs.map((tab) => tab.name), ["console.sql", "orders"]);
    assert.deepEqual(tabs.map((tab) => tab.icon), ["code", "table"]);
    assert.deepEqual(tabs.map((tab) => tab.active), [true, false]);
});

test("projectWorkspaceTabs reflects SQL draft dirty state from the SQL tab entry", () => {
    const tabs = projectWorkspaceTabs({
        order: [4],
        activeId: 4,
        byId: { 4: { id: 4, key: "sql:4", kind: "sql", name: "New Query", title: "New Query", dirty: true } },
        changesByKey: null,
    });

    assert.equal(tabs[0].dirty, true);
});

test("projectWorkspaceTabs exposes save failure and external conflict status without changing tab dimensions", () => {
    const tabs = projectWorkspaceTabs({
        order: [4, 5],
        activeId: 4,
        byId: {
            4: { id: 4, key: "sql:4", kind: "sql", name: "failed.sql", title: "failed.sql", dirty: true, saveFailed: true },
            5: { id: 5, key: "sql:5", kind: "sql", name: "conflict.sql", title: "conflict.sql", dirty: true, externalConflict: true },
        },
        changesByKey: null,
    });

    assert.equal(tabs[0].saveFailed, true);
    assert.equal(tabs[0].statusLabel, "Save failed");
    assert.equal(tabs[0].dirty, true);
    assert.equal(tabs[1].externalConflict, true);
    assert.equal(tabs[1].statusLabel, "External changes");
    assert.equal(tabs[1].dirty, true);
});

test("closeWorkspaceTabIntent stops propagation before closing and never activates", () => {
    const calls = [];
    let propagationStopped = false;
    const event = {
        stopPropagation() {
            propagationStopped = true;
            calls.push("stopPropagation");
        },
    };

    closeWorkspaceTabIntent(event, 7, (id) => {
        assert.equal(propagationStopped, true, "activation click is stopped before close runs");
        calls.push(`close:${id}`);
    });

    assert.deepEqual(calls, ["stopPropagation", "close:7"]);
    assert.equal(closeWorkspaceTabIntent.length <= 3, true, "close intent has no activate callback");
});
