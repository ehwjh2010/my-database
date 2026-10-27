import assert from "node:assert/strict";
import test from "node:test";

import { GRID_GUTTER_WIDTH, alignFrozenWidths, frozenTableStyle, measureColumnWidths, pinGutterWidth, sameWidths } from "../src/grid/sticky-header.js";

function cell(width) {
    return { getBoundingClientRect: () => ({ width }) };
}

function tables(headWidths, rows) {
    const headTable = {
        querySelectorAll: (selector) => selector === "thead th" ? headWidths.map(cell) : [],
    };
    const bodyTable = {
        querySelectorAll: (selector) => selector === "tbody tr"
            ? rows.map((row) => ({ children: row.map(cell) }))
            : [],
    };
    return [headTable, bodyTable];
}

test("measureColumnWidths takes the max of header and body cells", () => {
    const [head, body] = tables([40, 10], [[12, 80], [9, 20]]);
    assert.deepEqual(measureColumnWidths(head, body), [40, 80]);
});

test("sameWidths and frozenTableStyle keep paired tables aligned", () => {
    assert.equal(sameWidths([10, 20], [10, 20]), true);
    assert.equal(sameWidths([10, 20], [10, 21]), false);
    assert.deepEqual(frozenTableStyle([10, 20]), { tableLayout: "fixed", width: 30, minWidth: 30 });
});

test("pinGutterWidth keeps the row-number column at a fixed size", () => {
    assert.equal(pinGutterWidth(null, true), null);
    assert.deepEqual(pinGutterWidth([80, 120], false), [80, 120]);
    assert.deepEqual(pinGutterWidth([80, 120], true), [GRID_GUTTER_WIDTH, 120]);
});

test("frozen widths are ignored when the column count changes", () => {
    assert.equal(alignFrozenWidths([40, 80, 90, 70], 2), null);
    assert.deepEqual(alignFrozenWidths([40, 80], 2), [40, 80]);
    assert.equal(alignFrozenWidths(null, 2), null);
});
