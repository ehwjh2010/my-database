import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";
import { PostgreSQL, sql, SQLite } from "@codemirror/lang-sql";

import { queryExecution, querySql, semanticSqlIdentifiers, sqlStatementAt, syncSqlEditorDocument } from "../src/editor/sql-editor.js";

function editor(doc, selection, dialect = SQLite) {
    return {
        state: EditorState.create({
            doc,
            selection,
            extensions: [sql({ dialect })],
        }),
    };
}

test("sqlStatementAt returns the complete current statement without its terminator", () => {
    const doc = "SELECT * FROM user_info\n  WHERE id = 10;\n\nUPDATE user_info SET id = 11;";
    const state = EditorState.create({ doc, extensions: [sql({ dialect: SQLite })] });
    const firstEnd = doc.indexOf(";");
    const secondStart = doc.indexOf("UPDATE");
    const secondEnd = doc.lastIndexOf(";");

    assert.deepEqual(sqlStatementAt(state, doc.indexOf("WHERE")), { from: 0, to: firstEnd });
    assert.deepEqual(sqlStatementAt(state, firstEnd), { from: 0, to: firstEnd });
    assert.deepEqual(sqlStatementAt(state, secondStart), { from: secondStart, to: secondEnd });
    assert.deepEqual(sqlStatementAt(state, doc.length), { from: secondStart, to: secondEnd });
});

test("querySql uses the non-empty selection or the current statement", () => {
    const doc = "SELECT 1;\nSELECT 2;";

    assert.equal(querySql(editor(doc, EditorSelection.range(0, 9))), "SELECT 1;");
    assert.equal(querySql(editor(doc, EditorSelection.cursor(0))), "SELECT 1");
    assert.equal(querySql(editor(doc, EditorSelection.cursor(doc.indexOf("SELECT 2")))), "SELECT 2");
});

test("semanticSqlIdentifiers separates loaded tables and columns", () => {
    const doc = "SELECT id FROM user_info ORDER BY id DESC;";
    const state = EditorState.create({ doc, extensions: [sql({ dialect: PostgreSQL })] });

    assert.deepEqual(
        semanticSqlIdentifiers(state, { user_info: ["id"] }).map(({ from, to, kind }) => [doc.slice(from, to), kind]),
        [["id", "column"], ["user_info", "table"], ["id", "column"]],
    );
});

test("queryExecution runs the current statement or the selection", () => {
    const text = "SELECT 1;\nSELECT 2;";
    const second = text.indexOf("SELECT 2");

    assert.deepEqual(queryExecution(editor(text, EditorSelection.cursor(0)), "sqlite"), { sql: "SELECT 1", range: { line: 1, from: 0 } });
    assert.deepEqual(queryExecution(editor(text, EditorSelection.cursor(second)), "sqlite"), { sql: "SELECT 2", range: { line: 2, from: second } });
    assert.deepEqual(queryExecution(editor(text, EditorSelection.range(second, text.length)), "sqlite"), { sql: "SELECT 2;", range: { line: 2, from: second } });
});

test("queryExecution does not run when the caret is outside a statement", () => {
    const text = "SELECT 1;\n\nSELECT 2;";
    const view = editor(text, EditorSelection.cursor(text.indexOf("\n\n") + 1));

    assert.equal(queryExecution(view, "sqlite").sql, "");
});

test("syncSqlEditorDocument replaces a stale editor document once", () => {
    let dispatches = 0;
    let documentText = "SELECT draft;";
    const view = {
        state: {
            doc: {
                get length() {
                    return documentText.length;
                },
                toString: () => documentText,
            },
        },
        dispatch(transaction) {
            dispatches += 1;
            assert.deepEqual(transaction.changes, { from: 0, to: 13, insert: "SELECT disk;" });
            documentText = transaction.changes.insert;
        },
    };

    syncSqlEditorDocument(view, "SELECT disk;");
    syncSqlEditorDocument(view, "SELECT disk;");

    assert.equal(dispatches, 1);
    assert.equal(documentText, "SELECT disk;");
});
