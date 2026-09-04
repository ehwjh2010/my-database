import assert from "node:assert/strict";
import test from "node:test";

import { gutterRowNumber, pageSizeOptions, resolvePageSize } from "../src/grid/page-size.js";

test("resolvePageSize prefers the grid value and falls back to the session default", () => {
    assert.equal(resolvePageSize({ pageSize: 50 }, { pageSize: 200 }), 50);
    assert.equal(resolvePageSize({}, { pageSize: 200 }), 200);
    assert.equal(resolvePageSize({}, {}), 200);
});

test("pageSizeOptions includes the current size without writing prefs", () => {
    assert.deepEqual(pageSizeOptions(200), [50, 100, 200, 500, 1000]);
    assert.deepEqual(pageSizeOptions(250), [50, 100, 200, 250, 500, 1000]);
});

test("gutterRowNumber continues across pages like DataGrip", () => {
    assert.equal(gutterRowNumber(0, 200, 0), 1);
    assert.equal(gutterRowNumber(0, 200, 199), 200);
    assert.equal(gutterRowNumber(1, 200, 0), 201);
});
