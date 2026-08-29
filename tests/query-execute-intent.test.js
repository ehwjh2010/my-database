import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { sql, SQLite } from "@codemirror/lang-sql";

import { queryExecuteIntent, statementPreview } from "../src/editor/query-execute-intent.js";

function editor(doc, selection) {
    return {
        state: EditorState.create({
            doc,
            selection,
            extensions: [sql({ dialect: SQLite })],
        }),
    };
}

test("statementPreview collapses whitespace and truncates", () => {
    assert.equal(statementPreview("SELECT   1"), "SELECT 1");
    assert.equal(statementPreview("a".repeat(80), 10), `${"a".repeat(9)}…`);
});

test("queryExecuteIntent runs a selection or a single statement immediately", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    assert.equal(queryExecuteIntent(editor(doc, EditorSelection.range(0, 9)), "sqlite").kind, "run");
    assert.equal(queryExecuteIntent(editor("SELECT 1;", EditorSelection.cursor(0)), "sqlite").kind, "run");
    assert.equal(queryExecuteIntent(editor("SELECT 1;\n\nSELECT 2;", EditorSelection.cursor("SELECT 1;\n\n".length - 1)), "sqlite").kind, "none");
});

test("queryExecuteIntent offers each statement and execute all", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const intent = queryExecuteIntent(editor(doc, EditorSelection.cursor(0)), "sqlite");

    assert.equal(intent.kind, "choose");
    assert.deepEqual(intent.statements.map((statement) => [statement.label, statement.current, statement.execution.sql]), [
        ["SELECT 1", true, "SELECT 1"],
        ["SELECT 2", false, "SELECT 2"],
    ]);
    assert.equal(intent.all.label, "Execute all 2 statements");
    assert.equal(intent.all.execution.sql, "SELECT 1;\nSELECT 2;");
});
