import assert from "node:assert/strict";
import test from "node:test";

import { matchRanges, nextMatchIndex, splitHighlighted } from "../src/structure/structure-search.js";

test("matchRanges finds overlapping-safe case-insensitive spans", () => {
    assert.deepEqual(matchRanges("Org_code ORG", "org"), [
        { from: 0, to: 3 },
        { from: 9, to: 12 },
    ]);
    assert.deepEqual(matchRanges("hello", ""), []);
});

test("splitHighlighted wraps each match as its own piece", () => {
    assert.deepEqual(splitHighlighted("idx_org_type", "org"), [
        { text: "idx_", match: false },
        { text: "org", match: true },
        { text: "_type", match: false },
    ]);
});

test("nextMatchIndex wraps around the match list", () => {
    assert.equal(nextMatchIndex(0, -1, 1), -1);
    assert.equal(nextMatchIndex(3, -1, 1), 0);
    assert.equal(nextMatchIndex(3, -1, -1), 2);
    assert.equal(nextMatchIndex(3, 2, 1), 0);
});
