import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState } from "@codemirror/state";

import { isSelectAllShortcut, selectEntireDocument } from "../src/editor/select-all.js";

test("isSelectAllShortcut matches unmodified Cmd/Ctrl+A", () => {
    assert.equal(isSelectAllShortcut({ key: "a", metaKey: true }), true);
    assert.equal(isSelectAllShortcut({ key: "A", ctrlKey: true }), true);
    assert.equal(isSelectAllShortcut({ key: "a", metaKey: true, shiftKey: true }), false);
    assert.equal(isSelectAllShortcut({ key: "a", metaKey: true, altKey: true }), false);
    assert.equal(isSelectAllShortcut({ key: "f", metaKey: true }), false);
});

test("selectEntireDocument covers the full document, not the current range", () => {
    const doc = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.indexOf("SELECT 2")) });
    let transaction = null;
    assert.equal(selectEntireDocument({ state, dispatch: (next) => { transaction = next; } }), true);
    assert.equal(transaction.newSelection.main.from, 0);
    assert.equal(transaction.newSelection.main.to, doc.length);
});
