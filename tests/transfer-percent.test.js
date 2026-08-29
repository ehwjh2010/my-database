import assert from "node:assert/strict";
import test from "node:test";
import { clampPercent, transferPercent } from "../src/lib/transfer-percent.js";

test("transferPercent rounds completed work into a 0-100 range", () => {
    assert.equal(transferPercent(0, 4), 0);
    assert.equal(transferPercent(1, 4), 25);
    assert.equal(transferPercent(4, 4), 100);
    assert.equal(transferPercent(9, 0), 100);
    assert.equal(transferPercent(Number.NaN, 10), 100);
});

test("clampPercent treats missing running values as 0 and finished values as 100", () => {
    assert.equal(clampPercent(37.4, "running"), 37);
    assert.equal(clampPercent(undefined, "running"), 0);
    assert.equal(clampPercent(undefined, "done"), 100);
    assert.equal(clampPercent(140, "done"), 100);
    assert.equal(clampPercent(-8, "error"), 0);
});
