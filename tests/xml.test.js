import assert from "node:assert/strict";
import test from "node:test";

import { mysqlXmlComplete, parseMysqlXml } from "../src/lib/parse/xml.js";

const complete = "<resultset><row><field name=\"id\">1</field></row></resultset><resultset><row><field name=\"__rc\">1</field></row></resultset>";
const truncated = "<resultset><row><field name=\"id\">1</field></row><row><field name=\"id\">";

test("mysqlXmlComplete requires matching resultset tags", () => {
    assert.equal(mysqlXmlComplete(complete), true);
    assert.equal(mysqlXmlComplete(truncated), false);
    assert.equal(mysqlXmlComplete(""), true);
});

test("parseMysqlXml ignores a truncated trailing resultset", () => {
    assert.deepEqual(parseMysqlXml(truncated), []);
    assert.equal(parseMysqlXml(complete).length, 2);
});

test("parseMysqlXml keeps utf8mb4 text", () => {
    const xml = `<resultset><row><field name="name">系统用户查询</field><field name="description">按关键词查询系统用户</field></row></resultset>`;
    assert.deepEqual(parseMysqlXml(xml), [{
        columns: [{ name: "name" }, { name: "description" }],
        rows: [["系统用户查询", "按关键词查询系统用户"]],
    }]);
});
