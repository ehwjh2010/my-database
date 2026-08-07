import assert from "node:assert/strict";
import test from "node:test";

import { queryErrorDiagnostic } from "../src/lib/sql/error-diagnostic.js";

test("PostgreSQL line and caret diagnostics locate the failed statement", () => {
    const sql = "SELECT 1;\nSELECT FRM users;";
    const error = {
        message: "ERROR: syntax error at or near \"FRM\"\nLINE 1: SELECT FRM users;\n       ^",
        statement: { from: 10, to: sql.length, sql: "SELECT FRM users" },
    };

    assert.deepEqual(queryErrorDiagnostic({ engine: "postgres", sql, documentOffset: 4, error }), {
        from: 21,
        to: 22,
        message: error.message,
    });
});

test("near diagnostics require one exact token in the failed statement", () => {
    const sql = "SELECT 1;\nSELECT bad FROM users;";
    const error = {
        message: "ERROR 1064 (42000): syntax error near 'bad FROM users' at line 1",
        statement: { from: 10, to: sql.length, sql: "SELECT bad FROM users" },
    };

    assert.deepEqual(queryErrorDiagnostic({ engine: "mysql", sql, documentOffset: 3, error }), {
        from: 20,
        to: 34,
        message: error.message,
    });
    assert.deepEqual(queryErrorDiagnostic({
        engine: "sqlite",
        sql: "SELECT typo FROM users",
        documentOffset: 2,
        error: { message: "near \"typo\": syntax error" },
    }), { from: 9, to: 13, message: "near \"typo\": syntax error" });
    assert.equal(queryErrorDiagnostic({
        engine: "sqlite",
        sql: "SELECT typo, typo FROM users",
        documentOffset: 0,
        error: { message: "near \"typo\": syntax error" },
    }), null);
});
