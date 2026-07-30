import assert from "node:assert/strict";
import test from "node:test";

import { columnCompletions, completionKeyAction, insertColumn, sqlCompletionItems } from "../src/grid/field-completion.js";

const columns = [
    { name: "user_id", type: "integer" },
    { name: "UserName", type: "text" },
    { name: "created_at", type: "timestamp" },
];

test("column completions match the fragment before the cursor in column order", () => {
    const completion = columnCompletions("status = 1 AND us", 17, columns);

    assert.deepEqual(completion.matches.map((column) => column.name), ["user_id", "UserName"]);
    assert.deepEqual(columnCompletions("status = 1 AND ", 15, columns).matches, []);
});

test("column insertion replaces the complete fragment around a middle cursor", () => {
    const value = "created = 1";
    const completion = columnCompletions(value, 3, columns);

    assert.equal(insertColumn(value, completion, "created_at"), "created_at = 1");
    assert.equal(completion.start, 0);
    assert.equal(completion.end, 7);
});

test("Enter and Tab select only while completions are open", () => {
    assert.equal(completionKeyAction("Enter", true), "select");
    assert.equal(completionKeyAction("Tab", true), "select");
    assert.equal(completionKeyAction("Tab", false), null);
    assert.equal(completionKeyAction("Enter", false), "apply");
    assert.equal(completionKeyAction("ArrowDown", true), "next");
    assert.equal(completionKeyAction("Escape", true), "close");
});

test("SQL completions include shared and engine-specific WHERE and ORDER BY items", () => {
    const sqliteWhere = sqlCompletionItems("WHERE", "sqlite", columns);
    const mysqlWhere = sqlCompletionItems("WHERE", "mysql", columns);
    const postgresWhere = sqlCompletionItems("WHERE", "postgres", columns);

    assert.equal(sqliteWhere.find((item) => item.name === "LOWER()").cursor, 6);
    assert.ok(sqliteWhere.some((item) => item.name === "IS NOT NULL"));
    assert.ok(sqliteWhere.some((item) => item.name === "STRFTIME()"));
    assert.ok(mysqlWhere.some((item) => item.name === "DATE_FORMAT()"));
    assert.ok(postgresWhere.some((item) => item.name === "DATE_TRUNC()"));
    assert.ok(sqlCompletionItems("ORDER BY", "postgres", columns).some((item) => item.name === "NULLS LAST"));
    assert.ok(!sqlCompletionItems("ORDER BY", "mysql", columns).some((item) => item.name === "NULLS LAST"));
});
