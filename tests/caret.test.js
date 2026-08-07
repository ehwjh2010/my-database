import test from "node:test";
import assert from "node:assert/strict";
import { nextCaretPosition } from "../src/grid/caret.js";

test("caret movement collapses selections and follows grapheme boundaries", () => {
    assert.equal(nextCaretPosition("abcd", 1, 3, -1), 1);
    assert.equal(nextCaretPosition("abcd", 1, 3, 1), 3);
    assert.equal(nextCaretPosition("a😀b", 1, 1, 1), 3);
    assert.equal(nextCaretPosition("a😀b", 3, 3, -1), 1);
});
