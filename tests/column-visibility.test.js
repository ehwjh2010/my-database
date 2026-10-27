import assert from "node:assert/strict";
import test from "node:test";

import {
    columnSelectLabel,
    ensureVisibleColumn,
    isAllColumns,
    projectVisibleGrid,
    selectVisibleRange,
    selectedColumnNames,
    toggleVisibleColumn,
} from "../src/grid/column-visibility.js";

const columns = [{ name: "id" }, { name: "email" }, { name: "created_at" }, { name: "bio" }, { name: "avatar" }];

test("default selection shows every column as All", () => {
    assert.equal(isAllColumns(null), true);
    assert.equal(isAllColumns([]), true);
    assert.deepEqual(selectedColumnNames(columns, null), ["id", "email", "created_at", "bio", "avatar"]);
    assert.equal(columnSelectLabel(columns, null), "All");
});

test("clicking a column while showing all starts a subset", () => {
    assert.deepEqual(toggleVisibleColumn(columns, null, "email"), ["email"]);
    assert.deepEqual(toggleVisibleColumn(columns, ["email"], "id"), ["id", "email"]);
    assert.deepEqual(toggleVisibleColumn(columns, ["id", "email"], "email"), ["id"]);
});

test("clearing the last selected column or selecting every column restores All", () => {
    assert.equal(toggleVisibleColumn(columns, ["email"], "email"), null);
    assert.equal(toggleVisibleColumn(columns, ["id", "email", "created_at", "bio"], "avatar"), null);
    assert.equal(columnSelectLabel(columns, ["id", "email", "created_at", "bio", "avatar"]), "All");
});

test("shift range selects inclusive column names in table order", () => {
    assert.deepEqual(selectVisibleRange(columns, "email", "bio"), ["email", "created_at", "bio"]);
    assert.deepEqual(selectVisibleRange(columns, "bio", "email"), ["email", "created_at", "bio"]);
    assert.equal(selectVisibleRange(columns, "id", "avatar"), null);
});

test("column label names two fields then counts the rest", () => {
    assert.equal(columnSelectLabel(columns, ["id"]), "id");
    assert.equal(columnSelectLabel(columns, ["id", "bio"]), "id, bio");
    assert.equal(columnSelectLabel(columns, ["id", "email", "bio"]), "id, email +1");
});

test("grid projection keeps table order and does not drop unselected row values from source rows", () => {
    const rows = [[1, "a@x.com", "2026-01-02", "hello", "img"], [2, "b@x.com", "2026-01-03", "bye", "pic"]];
    const view = projectVisibleGrid(columns, rows, ["bio", "id"]);
    assert.deepEqual(view.columns.map((column) => column.name), ["id", "bio"]);
    assert.deepEqual(view.rows, [[1, "hello"], [2, "bye"]]);
    assert.deepEqual(projectVisibleGrid(columns, rows, null), { columns, rows });
});

test("missing selected names are ignored and sidebar focus can add a hidden column", () => {
    assert.deepEqual(selectedColumnNames(columns, ["id", "missing", "bio"]), ["id", "bio"]);
    assert.equal(ensureVisibleColumn(columns, null, "bio"), null);
    assert.deepEqual(ensureVisibleColumn(columns, ["id"], "bio"), ["id", "bio"]);
    assert.equal(ensureVisibleColumn(columns, ["id", "email", "created_at", "bio"], "avatar"), null);
});
