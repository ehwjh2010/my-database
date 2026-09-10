import { qualifiedName } from "./quote.js";

export function truncateSql(engine, tableRef) {
    return engine === "sqlite"
        ? `DELETE FROM ${qualifiedName(engine, tableRef)}`
        : `TRUNCATE TABLE ${qualifiedName(engine, tableRef)}`;
}
