import { qualifiedName } from "./quote.js";

export function buildSelect(engine, ref, opts = {}) {
    const columns = opts.rowid ? `rowid AS __rowid, *` : "*";
    let sql = `SELECT ${columns} FROM ${qualifiedName(engine, ref)}`;
    const where = opts.rawWhere?.trim();
    if (where)
        sql += ` WHERE ${where}`;
    const orderBy = opts.rawOrderBy?.trim();
    if (orderBy)
        sql += ` ORDER BY ${orderBy}`;
    sql += ` LIMIT ${Number(opts.limit) || 100} OFFSET ${Number(opts.offset) || 0}`;
    return sql;
}

export function buildCount(engine, ref, opts = {}) {
    let sql = `SELECT COUNT(*) AS count FROM ${qualifiedName(engine, ref)}`;
    const where = opts.rawWhere?.trim();
    if (where)
        sql += ` WHERE ${where}`;
    return sql;
}
