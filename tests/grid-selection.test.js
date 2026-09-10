import assert from "node:assert/strict";
import test from "node:test";

import { createChanges, setEdit, toggleDelete, addInsert, setInsertCell, changeCount } from "../src/grid/pending-changes.js";
import {
    EMPTY_SELECTION,
    applyDeleteSelection,
    applyRevertSelection,
    expandRect,
    selectionHasPending,
    selectionTargets,
    singleCellSelection,
    toggleCellSelection,
    cellClickIntent,
    cellHighlightClass,
    paintsCellSelection,
    rowHighlightClass,
    singleRowSelection,
} from "../src/grid/grid-selection.js";

const columns = [{ name: "a" }, { name: "b" }, { name: "c" }];

function ctx(changes, insertIds = []) {
    return {
        columns,
        columnCount: columns.length,
        rowCount: 2,
        insertIds,
        keyValuesFor: (row) => [row],
        pendingCount: changeCount(changes),
    };
}

test("none selection enumerates the whole table", () => {
    assert.deepEqual(selectionTargets(EMPTY_SELECTION, ctx(createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false }))), { all: true });
});

test("rect enumerates cells between anchor and focus including inserts", () => {
    const selection = expandRect({ type: "row", row: 1, column: 1 }, { type: "insert", insertId: 1, column: 2 });
    assert.deepEqual(selectionTargets(selection, {
        columnCount: 3,
        rowCount: 2,
        insertIds: [1],
    }), {
        cells: [
            { type: "row", row: 1, column: 1 },
            { type: "row", row: 1, column: 2 },
            { type: "insert", insertId: 1, column: 1 },
            { type: "insert", insertId: 1, column: 2 },
        ],
    });
});

test("rows selection enumerates row keys", () => {
    assert.deepEqual(selectionTargets({
        kind: "rows",
        keys: [{ type: "row", row: 0 }, { type: "insert", insertId: 1 }],
    }, { columnCount: 3, rowCount: 2, insertIds: [1] }), {
        rows: [{ type: "row", row: 0 }, { type: "insert", insertId: 1 }],
    });
});

test("applyRevertSelection with none clears every pending change", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    setEdit(changes, [0], "a", "x", "old");
    toggleDelete(changes, [1]);
    addInsert(changes);
    assert.equal(applyRevertSelection(changes, EMPTY_SELECTION, ctx(changes)), true);
    assert.equal(changeCount(changes), 0);
});

test("applyRevertSelection reverts only cells inside a rect", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    setEdit(changes, [0], "a", "x", "old");
    setEdit(changes, [0], "b", "y", "old");
    const selection = singleCellSelection({ type: "row", row: 0, column: 0 });
    assert.equal(selectionHasPending(selection, changes, ctx(changes)), true);
    assert.equal(applyRevertSelection(changes, selection, ctx(changes)), true);
    assert.equal(changes.edits.get(JSON.stringify([0])).cells.has("b"), true);
    assert.equal(changes.edits.get(JSON.stringify([0])).cells.has("a"), false);
});

test("row selection marks every selected existing row for delete", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const selection = {
        kind: "rows",
        keys: [
            { type: "row", row: 0 },
            { type: "row", row: 1 },
        ],
    };
    assert.equal(applyDeleteSelection(changes, selection, ctx(changes)), true);
    assert.equal(changes.deletes.size, 2);
    assert.deepEqual([...changes.deletes.values()], [[0], [1]]);
});

test("cell rect delete marks each unique row once and drops selected inserts", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const insert = addInsert(changes);
    toggleDelete(changes, [1]);
    const selection = expandRect({ type: "row", row: 0, column: 0 }, { type: "insert", insertId: insert.id, column: 1 });
    assert.equal(applyDeleteSelection(changes, selection, ctx(changes, [insert.id])), true);
    assert.equal(changes.deletes.size, 2);
    assert.equal(changes.inserts.length, 0);
});

test("row selection reverts delete marks and insert rows", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    toggleDelete(changes, [0]);
    const insert = addInsert(changes);
    setInsertCell(changes, insert.id, "a", "new");
    const selection = { kind: "rows", keys: [{ type: "row", row: 0 }, { type: "insert", insertId: insert.id }] };
    assert.equal(applyRevertSelection(changes, selection, ctx(changes, [insert.id])), true);
    assert.equal(changeCount(changes), 0);
});

test("toggleCellSelection from none selects a single cell", () => {
    const bounds = { columnCount: 3, rowCount: 2, insertIds: [] };
    const point = { type: "row", row: 1, column: 2 };
    assert.deepEqual(toggleCellSelection(EMPTY_SELECTION, point, bounds), singleCellSelection(point));
});

test("toggleCellSelection flattens a rect then adds a disjoint cell", () => {
    const bounds = { columnCount: 3, rowCount: 2, insertIds: [] };
    const rect = expandRect({ type: "row", row: 0, column: 0 }, { type: "row", row: 0, column: 1 });
    const extra = { type: "row", row: 1, column: 2 };
    const added = toggleCellSelection(rect, extra, bounds);
    assert.equal(added.kind, "cells");
    assert.deepEqual(selectionTargets(added, bounds), {
        cells: [
            { type: "row", row: 0, column: 0 },
            { type: "row", row: 0, column: 1 },
            { type: "row", row: 1, column: 2 },
        ],
    });
    const removed = toggleCellSelection(added, { type: "row", row: 0, column: 0 }, bounds);
    assert.deepEqual(selectionTargets(removed, bounds), {
        cells: [
            { type: "row", row: 0, column: 1 },
            { type: "row", row: 1, column: 2 },
        ],
    });
});

test("applyRevertSelection reverts only disjoint selected cells", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    setEdit(changes, [0], "a", "x", "old");
    setEdit(changes, [0], "b", "y", "old");
    setEdit(changes, [1], "c", "z", "old");
    const selection = { kind: "cells", points: [{ type: "row", row: 0, column: 0 }, { type: "row", row: 1, column: 2 }] };
    assert.equal(applyRevertSelection(changes, selection, ctx(changes)), true);
    assert.equal(changes.edits.get(JSON.stringify([0])).cells.has("b"), true);
    assert.equal(changes.edits.has(JSON.stringify([0])) && changes.edits.get(JSON.stringify([0])).cells.has("a"), false);
    assert.equal(changes.edits.has(JSON.stringify([1])), false);
});

test("cellClickIntent prefers double-click ignore then Shift then Ctrl then retain", () => {
    assert.equal(cellClickIntent({ detail: 2, shiftKey: true, ctrlKey: true }, false), "ignore");
    assert.equal(cellClickIntent({ detail: 1, shiftKey: true, ctrlKey: true }, false), "extend");
    assert.equal(cellClickIntent({ detail: 1, metaKey: true }, false), "additive");
    assert.equal(cellClickIntent({ detail: 1, ctrlKey: true }, true), "additive");
    assert.equal(cellClickIntent({ detail: 1 }, true), "retain");
    assert.equal(cellClickIntent({ detail: 1 }, false), "replace");
});

test("row selection paints a current row without per-cell selection fills", () => {
    const bounds = { columnCount: 3, rowCount: 2, insertIds: [] };
    const selection = singleRowSelection({ type: "row", row: 0 });
    const selectedCell = { kind: "row", row: 0, column: 1 };
    assert.equal(paintsCellSelection(selection, { type: "row", row: 0, column: 0 }, bounds), false);
    assert.equal(rowHighlightClass(selection, { type: "row", row: 0 }, bounds, selectedCell), "row-current row-selected");
    assert.equal(cellHighlightClass(selection, { type: "row", row: 0, column: 1 }, bounds, selectedCell), undefined);
    assert.equal(cellHighlightClass(selection, { type: "row", row: 0, column: 0 }, bounds, selectedCell), undefined);
});

test("clicking a cell highlights the current row and the focused cell", () => {
    const bounds = { columnCount: 3, rowCount: 2, insertIds: [] };
    const selection = singleCellSelection({ type: "row", row: 1, column: 2 });
    const selectedCell = { kind: "row", row: 1, column: 2 };
    assert.equal(rowHighlightClass(selection, { type: "row", row: 1 }, bounds, selectedCell), "row-current");
    assert.equal(rowHighlightClass(selection, { type: "row", row: 0 }, bounds, selectedCell), undefined);
    assert.equal(cellHighlightClass(selection, { type: "row", row: 1, column: 2 }, bounds, selectedCell), "cell-selected cell-focused");
    assert.equal(paintsCellSelection(selection, { type: "row", row: 1, column: 0 }, bounds), false);
});
