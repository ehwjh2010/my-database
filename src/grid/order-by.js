import { quoteIdent } from "../lib/sql/quote.js";

function splitItems(value) {
    const items = [];
    let item = "";
    let quote = null;
    for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (quote && char === quote && value[i + 1] === quote) {
            item += char + char;
            i += 1;
        }
        else if (char === quote) {
            quote = null;
            item += char;
        }
        else if (!quote && (char === '"' || char === "`")) {
            quote = char;
            item += char;
        }
        else if (!quote && char === ",") {
            items.push(item.trim());
            item = "";
        }
        else
            item += char;
    }
    items.push(item.trim());
    return items;
}

function parseItem(engine, item) {
    const quote = engine === "mysql" || engine === "mariadb" ? "`" : '"';
    const quoted = quote === "`" ? "`(?:``|[^`])+`" : '"(?:""|[^"])+"';
    const match = item.match(new RegExp(`^(${quoted}|[A-Za-z_][A-Za-z0-9_$]*)(?:\\s+(ASC|DESC))?$`, "i"));
    if (!match)
        return null;
    const isQuoted = match[1][0] === quote;
    const name = isQuoted ? match[1].slice(1, -1).replaceAll(quote + quote, quote) : match[1];
    return { name, quoted: isQuoted, direction: (match[2] || "ASC").toUpperCase() };
}

function resolveColumn(item, columns) {
    const names = columns.map((column) => typeof column === "string" ? column : column.name);
    if (item.quoted)
        return names.find((name) => name === item.name);
    return names.find((name) => name === item.name)
        || names.find((name) => name.toLowerCase() === item.name.toLowerCase());
}

export function parseOrderBy(engine, value, columns) {
    const directions = new Map();
    for (const text of splitItems(value.trim())) {
        const item = parseItem(engine, text);
        const name = item && resolveColumn(item, columns);
        if (name && !directions.has(name))
            directions.set(name, item.direction);
    }
    return directions;
}

export function nextOrderBy(engine, value, column, columns) {
    const items = splitItems(value.trim());
    const current = items.length === 1 && parseItem(engine, items[0]);
    const currentColumn = current && resolveColumn(current, columns);
    const direction = currentColumn === column ? current.direction : null;
    if (direction === "DESC")
        return "";
    return `${quoteIdent(engine, column)} ${direction === "ASC" ? "DESC" : "ASC"}`;
}
