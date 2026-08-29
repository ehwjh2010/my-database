import assert from "node:assert/strict";
import test from "node:test";

import { clampResultsHeight, defaultResultsHeight, resultsHeightFromPointer } from "../src/editor/results-height.js";

test("clampResultsHeight keeps a usable editor and results pane", () => {
    assert.equal(clampResultsHeight(800, 360), 360);
    assert.equal(clampResultsHeight(800, 40), 120);
    assert.equal(clampResultsHeight(800, 780), 704);
    assert.equal(clampResultsHeight(180, 200), 120);
});

test("defaultResultsHeight uses 45 percent of the host", () => {
    assert.equal(defaultResultsHeight(800), 360);
});

test("resultsHeightFromPointer grows the pane as the pointer moves up", () => {
    assert.equal(resultsHeightFromPointer(800, 900, 540), 360);
    assert.equal(resultsHeightFromPointer(800, 900, 200), 700);
    assert.equal(resultsHeightFromPointer(800, 900, 880), 120);
});
