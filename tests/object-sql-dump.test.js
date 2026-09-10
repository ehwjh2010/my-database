import assert from "node:assert/strict";
import test from "node:test";

import { dropIfExistsSql, ensureDropBeforeCreate, tableSqlDump, unqualifyTableDdl, withTrailingSemicolon } from "../src/transfer/object-sql-dump.js";

test("tableSqlDump drops then creates then inserts", () => {
    const dump = tableSqlDump(
        "sqlite",
        { table: "orders" },
        'CREATE TABLE "orders" ("id" INTEGER)',
        'INSERT INTO "orders" ("id") VALUES (1);',
    );
    assert.equal(dump, [
        'DROP TABLE IF EXISTS "orders";',
        'CREATE TABLE "orders" ("id" INTEGER);',
        'INSERT INTO "orders" ("id") VALUES (1);',
    ].join("\n"));
});

test("tableSqlDump still writes structure when there are no rows", () => {
    const dump = tableSqlDump("mysql", { table: "orders" }, "CREATE TABLE `orders` (`id` int)");
    assert.equal(dump, "DROP TABLE IF EXISTS `orders`;\nCREATE TABLE `orders` (`id` int);");
});

test("unqualifyTableDdl strips catalog and schema so the dump can load elsewhere", () => {
    assert.equal(
        unqualifyTableDdl("mysql", { database: "source_db", table: "orders" }, "CREATE TABLE `source_db`.`orders` (`id` int)"),
        "CREATE TABLE `orders` (`id` int)",
    );
    assert.equal(
        unqualifyTableDdl("postgres", { schema: "public", table: "orders" }, 'CREATE TABLE "public"."orders" (\n    id integer\n)'),
        'CREATE TABLE "orders" (\n    id integer\n)',
    );
    assert.equal(withTrailingSemicolon("CREATE TABLE t"), "CREATE TABLE t;");
    assert.equal(dropIfExistsSql("postgres", { table: "orders" }), 'DROP TABLE IF EXISTS "orders";');
});

test("tableSqlDump does not double a DROP already in the DDL", () => {
    const dump = tableSqlDump(
        "sqlite",
        { table: "orders" },
        'DROP TABLE IF EXISTS "orders";\nCREATE TABLE "orders" (id INTEGER);',
        "",
    );
    assert.equal(dump, 'DROP TABLE IF EXISTS "orders";\nCREATE TABLE "orders" (id INTEGER);');
});

test("tableSqlDump rejects missing DDL", () => {
    assert.throws(() => tableSqlDump("sqlite", { table: "orders" }, "  "), /EXPORT_DDL_MISSING/);
});

test("ensureDropBeforeCreate prepends DROP IF EXISTS before CREATE TABLE and VIEW", () => {
    const dump = ensureDropBeforeCreate([
        "PRAGMA foreign_keys=OFF;",
        "CREATE TABLE \"orders\" (id INTEGER);",
        "INSERT INTO \"orders\" VALUES (1);",
        "CREATE VIEW active AS SELECT * FROM \"orders\";",
    ].join("\n"));
    assert.equal(dump, [
        "PRAGMA foreign_keys=OFF;",
        "DROP TABLE IF EXISTS \"orders\";",
        "CREATE TABLE \"orders\" (id INTEGER);",
        "INSERT INTO \"orders\" VALUES (1);",
        "DROP VIEW IF EXISTS active;",
        "CREATE VIEW active AS SELECT * FROM \"orders\";",
    ].join("\n"));
});

test("ensureDropBeforeCreate does not double an existing DROP", () => {
    const dump = ensureDropBeforeCreate("DROP TABLE IF EXISTS t;\nCREATE TABLE t (id INTEGER);");
    assert.equal(dump, "DROP TABLE IF EXISTS t;\nCREATE TABLE t (id INTEGER);");
});
