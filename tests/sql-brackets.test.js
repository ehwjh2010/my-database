import assert from "node:assert/strict";
import test from "node:test";

import { sqlBracketEdit } from "../src/lib/sql-brackets.js";

test("SQL brackets insert pairs and keep the cursor between them", () => {
    assert.deepEqual(sqlBracketEdit("id = ", 5, 5, "'"), {
        value: "id = ''",
        selectionStart: 6,
        selectionEnd: 6,
    });
    assert.deepEqual(sqlBracketEdit("id IN ", 6, 6, "("), {
        value: "id IN ()",
        selectionStart: 7,
        selectionEnd: 7,
    });
    assert.deepEqual(sqlBracketEdit("", 0, 0, "`"), {
        value: "``",
        selectionStart: 1,
        selectionEnd: 1,
    });
});

test("SQL brackets wrap a selection and preserve the selection", () => {
    assert.deepEqual(sqlBracketEdit("user_id", 0, 7, "`"), {
        value: "`user_id`",
        selectionStart: 1,
        selectionEnd: 8,
    });
});

test("SQL closing brackets are skipped and empty pairs delete together", () => {
    assert.deepEqual(sqlBracketEdit("id IN ()", 7, 7, ")"), {
        value: "id IN ()",
        selectionStart: 8,
        selectionEnd: 8,
    });
    assert.deepEqual(sqlBracketEdit("id = ''", 6, 6, "Backspace"), {
        value: "id = ",
        selectionStart: 5,
        selectionEnd: 5,
    });
});
