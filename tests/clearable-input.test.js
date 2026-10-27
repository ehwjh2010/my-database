import assert from "node:assert/strict";
import test from "node:test";

import { filterEscapeAction } from "../src/ui/clearable-input.js";

test("Escape clears a filled filter and blurs an empty one", () => {
    assert.equal(filterEscapeAction("users"), "clear");
    assert.equal(filterEscapeAction(" "), "clear");
    assert.equal(filterEscapeAction(""), "blur");
});
