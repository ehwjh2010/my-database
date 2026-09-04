import assert from "node:assert/strict";
import test from "node:test";

import { actionLabel, displayIndexes, groupForeignKeys, indexKind } from "../src/structure/structure-keys.js";

test("displayIndexes synthesizes PRIMARY when the driver only reports key columns", () => {
    const indexes = displayIndexes({
        primaryKey: ["id"],
        indexes: [{ name: "idx_org_type", unique: false, columns: ["org_type"] }],
    });
    assert.equal(indexes[0].name, "PRIMARY");
    assert.equal(indexKind(indexes[0], ["id"]), "primary");
    assert.equal(indexKind(indexes[1], ["id"]), "index");
});

test("displayIndexes orders PRIMARY then UNIQUE then remaining indexes", () => {
    const indexes = displayIndexes({
        primaryKey: ["id"],
        indexes: [
            { name: "idx_org_type", unique: false, columns: ["org_type"] },
            { name: "uk_org_code", unique: true, columns: ["org_code"] },
            { name: "PRIMARY", unique: true, columns: ["id"] },
            { name: "idx_parent_id", unique: false, columns: ["parent_id"] },
        ],
    });
    assert.deepEqual(indexes.map((index) => index.name), ["PRIMARY", "uk_org_code", "idx_org_type", "idx_parent_id"]);
});

test("groupForeignKeys collapses composite constraints and keeps referential actions", () => {
    assert.deepEqual(groupForeignKeys([
        { name: "fk_org_agent", column: "agent_id", refTable: "agent", refColumn: "id", onUpdate: "CASCADE", onDelete: "RESTRICT" },
        { name: "fk_org_agent", column: "tenant_id", refTable: "agent", refColumn: "tenant_id", onUpdate: "CASCADE", onDelete: "RESTRICT" },
    ]), [{
        name: "fk_org_agent",
        columns: ["agent_id", "tenant_id"],
        refTable: "agent",
        refColumns: ["id", "tenant_id"],
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
    }]);
});

test("actionLabel hides default referential actions", () => {
    assert.equal(actionLabel("NO ACTION"), "");
    assert.equal(actionLabel("RESTRICT"), "");
    assert.equal(actionLabel("SET_NULL"), "SET NULL");
    assert.equal(actionLabel("CASCADE"), "CASCADE");
});
