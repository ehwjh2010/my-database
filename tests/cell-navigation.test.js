import test from "node:test";
import assert from "node:assert/strict";
import { nextSelectedCell } from "../src/grid/cell-navigation.js";

test("arrow keys move cell selection and stop at grid boundaries", () => {
    const cell = { row: 1, column: 1 };
    assert.deepEqual(nextSelectedCell(cell, "ArrowUp", 3, 3), { row: 0, column: 1 });
    assert.deepEqual(nextSelectedCell(cell, "ArrowDown", 3, 3), { row: 2, column: 1 });
    assert.deepEqual(nextSelectedCell(cell, "ArrowLeft", 3, 3), { row: 1, column: 0 });
    assert.deepEqual(nextSelectedCell(cell, "ArrowRight", 3, 3), { row: 1, column: 2 });
    assert.deepEqual(nextSelectedCell({ row: 0, column: 0 }, "ArrowUp", 3, 3), { row: 0, column: 0 });
    assert.deepEqual(nextSelectedCell({ row: 2, column: 2 }, "ArrowRight", 3, 3), { row: 2, column: 2 });
});
