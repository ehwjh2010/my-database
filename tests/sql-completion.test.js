import assert from "node:assert/strict";
import test from "node:test";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";

import { sqlPhraseCompletionSource } from "../src/editor/sql-completion.js";

test("Console completion offers common multi-keyword SQL phrases", () => {
    const state = EditorState.create({ doc: "ORD" });
    const result = sqlPhraseCompletionSource("sqlite")(new CompletionContext(state, state.doc.length, false));
    const labels = result.options.map((option) => option.label);

    assert.equal(result.from, 0);
    assert.ok(labels.includes("ORDER BY"));
    assert.ok(labels.includes("GROUP BY"));
    assert.ok(labels.includes("LEFT OUTER JOIN"));
    assert.ok(labels.includes("IS NOT NULL"));
    assert.ok(labels.includes("CREATE TABLE"));
    assert.deepEqual(result.options.find((option) => option.label === "ORDER BY"), { label: "ORDER BY", type: "keyword", boost: 50 });
});

test("Console phrase completion includes only the active SQL dialect phrases", () => {
    const state = EditorState.create({ doc: "ON" });
    const context = new CompletionContext(state, state.doc.length, false);
    const postgres = sqlPhraseCompletionSource("postgres")(context).options.map((option) => option.label);
    const mysql = sqlPhraseCompletionSource("mysql")(context).options.map((option) => option.label);
    const sqlite = sqlPhraseCompletionSource("sqlite")(context).options.map((option) => option.label);

    assert.ok(postgres.includes("NULLS LAST"));
    assert.ok(postgres.includes("ON CONFLICT"));
    assert.ok(!postgres.includes("ON DUPLICATE KEY UPDATE"));
    assert.ok(mysql.includes("ON DUPLICATE KEY UPDATE"));
    assert.ok(!mysql.includes("NULLS LAST"));
    assert.ok(sqlite.includes("INSERT OR REPLACE"));
    assert.ok(!sqlite.includes("RIGHT OUTER JOIN"));
});

test("Console phrase completion stays closed without typed text", () => {
    const state = EditorState.create();
    const completion = sqlPhraseCompletionSource("postgres");

    assert.equal(completion(new CompletionContext(state, 0, false)), null);
    assert.ok(completion(new CompletionContext(state, 0, true)).options.length > 1);
});
