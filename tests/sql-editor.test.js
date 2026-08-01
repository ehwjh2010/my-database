import assert from "node:assert/strict";
import test from "node:test";

import { querySql, syncSqlEditorDocument } from "../src/editor/sql-editor.js";

test("querySql uses the non-empty selection or the whole document", () => {
    const view = {
        state: {
            selection: { main: { from: 7, to: 15 } },
            sliceDoc: (from, to) => from === 7 && to === 15 ? "SELECT 1" : "",
            doc: { toString: () => "SELECT 1;\nSELECT 2;" },
        },
    };

    assert.equal(querySql(view), "SELECT 1");
    view.state.selection.main = { from: 0, to: 0 };
    assert.equal(querySql(view), "SELECT 1;\nSELECT 2;");
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
