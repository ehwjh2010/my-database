import assert from "node:assert/strict";
import test from "node:test";

import { frozenTableStyle, measureColumnWidths, sameWidths } from "../src/grid/sticky-header.js";

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
    assert.deepEqual(frozenTableStyle([10, 20]), { tableLayout: "fixed", width: 30 });
});
