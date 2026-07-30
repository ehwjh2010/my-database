const FIELD_CHAR = /[\p{L}\p{N}_$]/u;
const keyword = (name) => ({ name, type: "keyword" });
const sqlFunction = (name) => ({ name: `${name}()`, type: "function", cursor: name.length + 1 });

const WHERE_KEYWORDS = ["AND", "OR", "NOT", "NULL", "TRUE", "FALSE", "IS NULL", "IS NOT NULL", "IN", "NOT IN", "BETWEEN", "NOT BETWEEN", "LIKE", "NOT LIKE", "EXISTS", "NOT EXISTS"].map(keyword);
const WHERE_FUNCTIONS = ["LOWER", "UPPER", "LENGTH", "TRIM", "LTRIM", "RTRIM", "SUBSTR", "REPLACE", "COALESCE", "NULLIF", "ABS", "ROUND", "CAST"].map(sqlFunction);
const MYSQL_FUNCTIONS = ["DATE", "DATE_FORMAT", "DATEDIFF", "JSON_EXTRACT", "JSON_UNQUOTE"].map(sqlFunction);
const WHERE_ENGINE_FUNCTIONS = {
    sqlite: ["DATE", "DATETIME", "STRFTIME", "JSON_EXTRACT", "JSON_TYPE"].map(sqlFunction),
    mysql: MYSQL_FUNCTIONS,
    mariadb: MYSQL_FUNCTIONS,
    postgres: ["DATE_TRUNC", "EXTRACT", "TO_CHAR", "JSONB_TYPEOF"].map(sqlFunction),
};
const ORDER_KEYWORDS = ["ASC", "DESC"].map(keyword);
const ORDER_ENGINE_KEYWORDS = {
    sqlite: ["NULLS FIRST", "NULLS LAST"].map(keyword),
    mysql: [],
    mariadb: [],
    postgres: ["NULLS FIRST", "NULLS LAST"].map(keyword),
};

export function sqlCompletionItems(label, engine, columns) {
    if (label === "WHERE")
        return [...columns, ...WHERE_KEYWORDS, ...WHERE_FUNCTIONS, keyword("CURRENT_DATE"), keyword("CURRENT_TIMESTAMP"), ...WHERE_ENGINE_FUNCTIONS[engine]];
    return [...columns, ...ORDER_KEYWORDS, ...ORDER_ENGINE_KEYWORDS[engine]];
}

export function columnCompletions(value, cursor, columns) {
    let start = cursor;
    let end = cursor;
    while (start > 0 && FIELD_CHAR.test(value[start - 1]))
        start -= 1;
    while (end < value.length && FIELD_CHAR.test(value[end]))
        end += 1;
    const prefix = value.slice(start, cursor).toLowerCase();
    return {
        start,
        end,
        matches: prefix ? columns.filter((column) => column.name.toLowerCase().startsWith(prefix)) : [],
    };
}

export function insertColumn(value, completion, name) {
    return value.slice(0, completion.start) + name + value.slice(completion.end);
}

export function completionKeyAction(key, open) {
    if (open && key === "ArrowDown") return "next";
    if (open && key === "ArrowUp") return "previous";
    if (open && (key === "Enter" || key === "Tab")) return "select";
    if (open && key === "Escape") return "close";
    if (!open && key === "Enter") return "apply";
    return null;
}
