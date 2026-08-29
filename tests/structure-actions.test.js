import assert from "node:assert/strict";
import test from "node:test";

import { dropSql, truncateSql, workspaceIdForObject } from "../src/structure/structure-actions.js";

test("truncateSql uses DELETE on SQLite and TRUNCATE elsewhere", () => {
    const ref = { table: "orders", database: "app", schema: "public" };
    assert.equal(truncateSql("sqlite", ref), 'DELETE FROM "orders"');
    assert.equal(truncateSql("postgres", ref), 'TRUNCATE TABLE "public"."orders"');
    assert.equal(truncateSql("mysql", ref), "TRUNCATE TABLE `app`.`orders`");
});

test("dropSql uses VIEW or TABLE from the object kind", () => {
    assert.equal(dropSql("sqlite", { table: "orders", kind: "table" }), 'DROP TABLE "orders"');
    assert.equal(dropSql("sqlite", { table: "active", kind: "view" }), 'DROP VIEW "active"');
});

test("workspaceIdForObject finds any open workspace for the object", () => {
    const session = {
        registry: {
            order: [2, 5],
            byId: {
                2: { ref: { database: "app", schema: "main", table: "customers" } },
                5: { ref: { database: "app", schema: "main", table: "orders" } },
            },
        },
    };
    assert.equal(workspaceIdForObject(session, { database: "app", schema: "main", table: "orders" }), 5);
    assert.equal(workspaceIdForObject(session, { database: "app", schema: "main", table: "missing" }), undefined);
});
