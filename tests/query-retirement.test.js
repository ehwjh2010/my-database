import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deleted = [];
const values = new Map([
    ["connections:v1", [{ id: "conn-1" }]],
    ["history:conn-1", [{ sql: "SELECT legacy;" }]],
    ["saved-queries:v1", [{ sql: "SELECT saved;" }]],
]);

globalThis.muxy = {
    storage: {
        async get(key) { return values.get(key); },
        async set(key, value) { values.set(key, value); },
        async delete(key) { deleted.push(key); values.delete(key); },
    },
};

const { deleteConnection } = await import("../src/lib/connections.js");
const storageSource = await readFile(new URL("../src/lib/storage.js", import.meta.url), "utf8");
const queryViewSource = await readFile(new URL("../src/editor/query-view.jsx", import.meta.url), "utf8");

test("deleting a connection keeps legacy query data and cleans drafts/ui", async () => {
    await deleteConnection("conn-1");

    assert.deepEqual(deleted, ["drafts:conn-1", "ui:conn-1"]);
    assert.deepEqual(values.get("history:conn-1"), [{ sql: "SELECT legacy;" }]);
    assert.deepEqual(values.get("saved-queries:v1"), [{ sql: "SELECT saved;" }]);
});

test("retired query storage and UI APIs have no active exports or references", () => {
    assert.doesNotMatch(storageSource, /getHistory|appendHistory|clearHistory|getSavedQueries|setSavedQueries/);
    assert.doesNotMatch(queryViewSource, /HistoryPanel|SavedPanel|appendHistory|Query history|Saved queries/);
});
