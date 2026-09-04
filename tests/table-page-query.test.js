import assert from "node:assert/strict";
import test from "node:test";

import { MYSQL_XML_ROW_CHUNK, fetchTablePageResult } from "../src/grid/table-page-query.js";

const tableRef = Object.freeze({ database: "app", schema: "public", table: "orders" });
const driverContext = Object.freeze({ database: "app" });

function sessionWith(engine, runQuery) {
    return {
        conn: { engine },
        pageSize: 200,
        timeoutMs: 1000,
        driver: { runQuery },
    };
}

test("sqlite fetches a table page in one query", async () => {
    const sqls = [];
    const session = sessionWith("sqlite", async (_ctx, sql) => {
        sqls.push(sql);
        return [{ columns: [{ name: "id" }], rows: [[1], [2]] }];
    });
    const raw = await fetchTablePageResult(session, {
        tableRef,
        gridState: { page: 0, rawWhere: "", rawOrderBy: "", pageSize: 500 },
        driverContext,
    }, false);
    assert.equal(sqls.length, 1);
    assert.match(sqls[0], /LIMIT 500 OFFSET 0/);
    assert.equal(raw.rows.length, 2);
});

test("mysql splits pages larger than the XML chunk", async () => {
    const sqls = [];
    const session = sessionWith("mysql", async (_ctx, sql) => {
        sqls.push(sql);
        const rows = sql.includes("OFFSET 400")
            ? [[401]]
            : Array.from({ length: MYSQL_XML_ROW_CHUNK }, (_, index) => [index + (sql.includes("OFFSET 200") ? 201 : 1)]);
        return [{ columns: [{ name: "id" }], rows }];
    });
    const raw = await fetchTablePageResult(session, {
        tableRef,
        gridState: { page: 0, rawWhere: "", rawOrderBy: "", pageSize: 500 },
        driverContext,
    }, false);
    assert.deepEqual(sqls, [
        "SELECT * FROM `app`.`orders` LIMIT 200 OFFSET 0",
        "SELECT * FROM `app`.`orders` LIMIT 200 OFFSET 200",
        "SELECT * FROM `app`.`orders` LIMIT 100 OFFSET 400",
    ]);
    assert.equal(raw.rows.length, 401);
    assert.equal(raw.columns[0].name, "id");
});

test("mysql stops chunking when a page runs short", async () => {
    const sqls = [];
    const session = sessionWith("mysql", async (_ctx, sql) => {
        sqls.push(sql);
        return [{ columns: [{ name: "id" }], rows: [[1], [2]] }];
    });
    const raw = await fetchTablePageResult(session, {
        tableRef,
        gridState: { page: 0, rawWhere: "", rawOrderBy: "", pageSize: 500 },
        driverContext,
    }, false);
    assert.equal(sqls.length, 1);
    assert.equal(raw.rows.length, 2);
});
