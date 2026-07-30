import assert from "node:assert/strict";
import test from "node:test";

import { nextOrderBy, parseOrderBy } from "../src/grid/order-by.js";
import { buildCount, buildSelect } from "../src/lib/sql/select-builder.js";

const ref = { database: "app", schema: "main", table: "orders" };
const columns = [{ name: "id" }, { name: "created_at" }, { name: "last,name" }];

test("select SQL composes raw WHERE and ORDER BY before paging", () => {
    assert.equal(buildSelect("sqlite", ref), 'SELECT * FROM "orders" LIMIT 100 OFFSET 0');
    assert.equal(
        buildSelect("sqlite", ref, { rawWhere: "  active = 1  ", limit: 20, offset: 40 }),
        'SELECT * FROM "orders" WHERE active = 1 LIMIT 20 OFFSET 40',
    );
    assert.equal(
        buildSelect("sqlite", ref, { rawOrderBy: "  created_at DESC, id ASC  " }),
        'SELECT * FROM "orders" ORDER BY created_at DESC, id ASC LIMIT 100 OFFSET 0',
    );
    assert.equal(
        buildSelect("postgres", ref, { rawWhere: "active", rawOrderBy: '"id" DESC', limit: 10 }),
        'SELECT * FROM "main"."orders" WHERE active ORDER BY "id" DESC LIMIT 10 OFFSET 0',
    );
});

test("count SQL applies WHERE and ignores ORDER BY", () => {
    assert.equal(
        buildCount("mysql", ref, { rawWhere: "  active = 1 ", rawOrderBy: "id DESC" }),
        "SELECT COUNT(*) AS count FROM `app`.`orders` WHERE active = 1",
    );
});

test("simple ORDER BY items map to matching column directions", () => {
    assert.deepEqual([...parseOrderBy("sqlite", "id, created_at DESC", columns)], [["id", "ASC"], ["created_at", "DESC"]]);
    assert.deepEqual([...parseOrderBy("sqlite", '"last,name" DESC, "id"', columns)], [["last,name", "DESC"], ["id", "ASC"]]);
    assert.deepEqual([...parseOrderBy("mysql", "`id` DESC, `created_at` ASC", columns)], [["id", "DESC"], ["created_at", "ASC"]]);
});

test("ORDER BY parsing keeps the first duplicate and ignores complex or unknown items", () => {
    assert.deepEqual(
        [...parseOrderBy("sqlite", "id DESC, id ASC, lower(created_at), missing DESC, created_at + 1", columns)],
        [["id", "DESC"]],
    );
});

test("header sorting cycles a single column and replaces other ORDER BY content", () => {
    assert.equal(nextOrderBy("sqlite", "", "id", columns), '"id" ASC');
    assert.equal(nextOrderBy("sqlite", "id", "id", columns), '"id" DESC');
    assert.equal(nextOrderBy("sqlite", '"id" DESC', "id", columns), "");
    assert.equal(nextOrderBy("sqlite", "id ASC, created_at DESC", "id", columns), '"id" ASC');
    assert.equal(nextOrderBy("mysql", "lower(id)", "id", columns), "`id` ASC");
});
