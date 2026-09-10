import { quoteIdent, qualifiedName } from "../lib/sql/quote.js";
import { ensureDropBeforeCreate } from "../lib/sql/dump-sql.js";

export { ensureDropBeforeCreate };

export function dropIfExistsSql(engine, ref) {
    return `DROP TABLE IF EXISTS ${quoteIdent(engine, ref.table)};`;
}

export function withTrailingSemicolon(sql) {
    const text = String(sql || "").trim();
    if (!text)
        return "";
    return /;$/.test(text) ? text : `${text};`;
}

export function unqualifyTableDdl(engine, ref, ddl) {
    const table = quoteIdent(engine, ref.table);
    let text = String(ddl || "");
    const qualified = qualifiedName(engine, ref);
    if (qualified !== table)
        text = text.split(qualified).join(table);
    if (engine === "postgres" && ref.schema) {
        text = text.split(`${quoteIdent(engine, ref.schema)}.${table}`).join(table);
        text = text.split(`${ref.schema}.${ref.table}`).join(ref.table);
    }
    if ((engine === "mysql" || engine === "mariadb") && ref.database)
        text = text.split(`${quoteIdent(engine, ref.database)}.${table}`).join(table);
    return text;
}

export function tableSqlDump(engine, ref, ddl, inserts) {
    const structure = withTrailingSemicolon(unqualifyTableDdl(engine, ref, ddl));
    if (!structure)
        throw new Error("EXPORT_DDL_MISSING");
    const header = /^\s*DROP\s+TABLE\s+IF\s+EXISTS/i.test(structure)
        ? structure
        : `${dropIfExistsSql(engine, ref)}\n${structure}`;
    return inserts ? `${header}\n${inserts}` : header;
}
