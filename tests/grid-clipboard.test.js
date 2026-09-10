import assert from "node:assert/strict";
import test from "node:test";

import { addInsert, createChanges, getEdit, setEdit, setInsertCell } from "../src/grid/pending-changes.js";
import {
    applyGridPaste,
    clipboardMatrixFromSelection,
    gridCellValue,
    parseGridClipboard,
    pasteOrigin,
    serializeGridClipboard,
} from "../src/grid/grid-clipboard.js";

const columns = [{ name: "id" }, { name: "name" }, { name: "note" }];

function page(rows, changes) {
    return {
        displayColumns: columns,
        displayRows: rows,
        keyValuesFor: (row) => [rows[row][0]],
    };
}

function ctx(rows, changes, insertIds = []) {
    const current = page(rows, changes);
    return {
        columns,
        columnCount: columns.length,
        rowCount: rows.length,
        insertIds,
        displayRows: rows,
        keyValuesFor: current.keyValuesFor,
        valueAt: (point) => gridCellValue(current, changes, point),
    };
}

test("row copy serializes TSV without headers and round-trips tabs", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const rows = [[1, "a", null], [2, "b\tc", "x"]];
    const selection = { kind: "rows", keys: [{ type: "row", row: 0 }, { type: "row", row: 1 }] };
    const matrix = clipboardMatrixFromSelection(selection, null, ctx(rows, changes));
    assert.deepEqual(matrix, [[1, "a", null], [2, "b\tc", "x"]]);
    const text = serializeGridClipboard(matrix);
    assert.equal(text, "1\ta\t\"\"\n2\t\"b\tc\"\tx");
    assert.deepEqual(parseGridClipboard(text), [["1", "a", ""], ["2", "b\tc", "x"]]);
});

test("single-cell values with commas stay one column over TSV", () => {
    const text = serializeGridClipboard([["a,b", "c"]]);
    assert.equal(text, "\"a,b\"\tc");
    assert.deepEqual(parseGridClipboard(text), [["a,b", "c"]]);
    assert.deepEqual(parseGridClipboard("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("clipboard without tabs parses as CSV lines", () => {
    assert.deepEqual(parseGridClipboard("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("paste overwrites from the selected cell and appends insert rows", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const rows = [[1, "a", ""], [2, "b", ""]];
    const origin = { type: "row", row: 1, column: 1 };
    const result = applyGridPaste(changes, origin, [["x", "y"], ["n", "o"]], ctx(rows, changes));
    assert.equal(getEdit(changes, [2], "name").value, "x");
    assert.equal(getEdit(changes, [2], "note").value, "y");
    assert.equal(changes.inserts.length, 1);
    assert.equal(changes.inserts[0].cells.get("name"), "n");
    assert.equal(changes.inserts[0].cells.get("note"), "o");
    assert.equal(result.selection.kind, "rect");
    assert.equal(result.origin.column, 1);
});

test("row paste starts at column zero of the first selected row", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const rows = [[1, "a", "old"], [2, "b", "keep"]];
    const selection = { kind: "rows", keys: [{ type: "row", row: 1 }, { type: "row", row: 0 }] };
    const bounds = ctx(rows, changes);
    const origin = pasteOrigin(selection, { kind: "row", row: 1, column: 2 }, bounds);
    assert.deepEqual(origin, { type: "row", row: 0, column: 0 });
    applyGridPaste(changes, origin, [["9", "aa", "nn"]], bounds);
    assert.equal(getEdit(changes, [1], "id").value, "9");
    assert.equal(getEdit(changes, [1], "name").value, "aa");
    assert.equal(getEdit(changes, [1], "note").value, "nn");
    assert.equal(getEdit(changes, [2], "name").edited, false);
});

test("paste empty cells write NULL and extra rows become inserts", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const rows = [[1, "a", null], [2, "b", "keep"]];
    applyGridPaste(changes, { type: "row", row: 0, column: 1 }, [[""]], ctx(rows, changes));
    assert.equal(getEdit(changes, [1], "name").value, null);
    applyGridPaste(changes, { type: "row", row: 0, column: 2 }, [[""]], ctx(rows, changes));
    assert.equal(getEdit(changes, [1], "note").edited, false);
    applyGridPaste(changes, { type: "row", row: 1, column: 0 }, [["9", "x", ""], ["8", "y", "z"]], ctx(rows, changes));
    assert.equal(getEdit(changes, [2], "id").value, "9");
    assert.equal(changes.inserts.length, 1);
    assert.equal(changes.inserts[0].cells.get("id"), "8");
});

test("copy includes pending edits and insert rows", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    const rows = [[1, "a", ""]];
    setEdit(changes, [1], "name", "edited", "a");
    const insert = addInsert(changes);
    setInsertCell(changes, insert.id, "name", "new");
    const selection = { kind: "rows", keys: [{ type: "row", row: 0 }, { type: "insert", insertId: insert.id }] };
    const matrix = clipboardMatrixFromSelection(selection, null, ctx(rows, changes, [insert.id]));
    assert.deepEqual(matrix, [[1, "edited", ""], [null, "new", null]]);
});
