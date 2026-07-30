import assert from "node:assert/strict";
import test from "node:test";

import { createChanges, setEdit, changeCount } from "../src/grid/pending-changes.js";

test("reverting an edited numeric or boolean cell clears its dirty entry", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });

    setEdit(changes, [1], "count", "2", 1);
    setEdit(changes, [1], "count", "1", 1);
    setEdit(changes, [1], "enabled", "0", true);
    setEdit(changes, [1], "enabled", "1", true);

    assert.equal(changeCount(changes), 0);
});
