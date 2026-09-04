import { buildSelect } from "../lib/sql/select-builder.js";
import { resolvePageSize } from "./page-size.js";

export const MYSQL_XML_ROW_CHUNK = 200;

function mysqlFamily(engine) {
    return engine === "mysql" || engine === "mariadb";
}

export async function fetchTablePageResult(session, target, useRowid) {
    const pageSize = resolvePageSize(target.gridState, session);
    const offset = target.gridState.page * pageSize;
    const shared = {
        rawWhere: target.gridState.rawWhere,
        rawOrderBy: target.gridState.rawOrderBy,
        rowid: useRowid,
    };
    const engine = session.conn.engine;
    const opts = { timeoutMs: session.timeoutMs };
    if (mysqlFamily(engine) && pageSize > MYSQL_XML_ROW_CHUNK) {
        let columns = [];
        const rows = [];
        for (let fetched = 0; fetched < pageSize;) {
            const limit = Math.min(MYSQL_XML_ROW_CHUNK, pageSize - fetched);
            const sql = buildSelect(engine, target.tableRef, { ...shared, limit, offset: offset + fetched });
            const raw = (await session.driver.runQuery(target.driverContext, sql, opts))[0] || { columns: [], rows: [] };
            if (raw.columns.length)
                columns = raw.columns;
            rows.push(...raw.rows);
            if (raw.rows.length < limit)
                break;
            fetched += raw.rows.length;
        }
        return { columns, rows };
    }
    const sql = buildSelect(engine, target.tableRef, { ...shared, limit: pageSize, offset });
    return (await session.driver.runQuery(target.driverContext, sql, opts))[0] || { columns: [], rows: [] };
}
