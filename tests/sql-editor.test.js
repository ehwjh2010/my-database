import assert from "node:assert/strict";
import test from "node:test";

import { syncSqlEditorDocument } from "../src/editor/sql-editor.js";

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
