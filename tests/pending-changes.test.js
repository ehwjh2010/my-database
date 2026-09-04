import assert from "node:assert/strict";
import test from "node:test";

import { createChanges, setEdit, setInsertCell, toggleDelete, addInsert, removeInsert, clearChanges, changeCount, revertCell, revertRow, rowHasPending } from "../src/grid/pending-changes.js";

test("reverting an edited numeric or boolean cell clears its dirty entry", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });

    setEdit(changes, [1], "count", "2", 1);
    setEdit(changes, [1], "count", "1", 1);
    setEdit(changes, [1], "enabled", "0", true);
    setEdit(changes, [1], "enabled", "1", true);

    assert.equal(changeCount(changes), 0);
});

test("every pending mutator advances the revision, including equivalent results", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    assert.equal(changes.revision, 0);
    setEdit(changes, [1], "name", "same", "old");
    assert.equal(changes.revision, 1);
    setEdit(changes, [1], "name", "old", "old");
    assert.equal(changes.revision, 2);
    toggleDelete(changes, [1]);
    assert.equal(changes.revision, 3);
    toggleDelete(changes, [1]);
    assert.equal(changes.revision, 4);
    const insert = addInsert(changes);
    assert.equal(changes.revision, 5);
    setInsertCell(changes, insert.id, "name", "new");
    assert.equal(changes.revision, 6);
    removeInsert(changes, insert.id);
    assert.equal(changes.revision, 7);
    clearChanges(changes);
    assert.equal(changes.revision, 8);
});

test("changeCount is the canonical three-part pending count", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    setEdit(changes, [1], "name", "new", "old");
    toggleDelete(changes, [2]);
    const insert = addInsert(changes);
    setInsertCell(changes, insert.id, "name", "value");
    assert.equal(changeCount(changes), 3);
});

test("revertCell clears one column and leaves sibling edits and the delete mark", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    setEdit(changes, [1], "name", "new", "old");
    setEdit(changes, [1], "count", "2", "1");
    toggleDelete(changes, [1]);
    assert.equal(revertCell(changes, [1], "name"), true);
    assert.equal(rowHasPending(changes, [1]), true);
    assert.equal(changes.edits.get(JSON.stringify([1])).cells.has("count"), true);
    assert.equal(changes.deletes.has(JSON.stringify([1])), true);
    assert.equal(revertCell(changes, [1], "missing"), false);
});

test("revertRow clears edits and the delete mark for one key", () => {
    const changes = createChanges("sqlite", { table: "items" }, { primaryKey: ["id"], rowid: false });
    setEdit(changes, [1], "name", "new", "old");
    toggleDelete(changes, [1]);
    toggleDelete(changes, [2]);
    assert.equal(rowHasPending(changes, [1]), true);
    assert.equal(revertRow(changes, [1]), true);
    assert.equal(rowHasPending(changes, [1]), false);
    assert.equal(rowHasPending(changes, [2]), true);
    assert.equal(changeCount(changes), 1);
});
