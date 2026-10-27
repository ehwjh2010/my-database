export function isAllColumns(selection) {
    return !selection?.length;
}

export function selectedColumnNames(columns, selection) {
    const names = columns.map((column) => column.name);
    if (isAllColumns(selection))
        return names;
    const wanted = new Set(selection);
    return names.filter((name) => wanted.has(name));
}

export function columnSelectLabel(columns, selection) {
    const names = selectedColumnNames(columns, selection);
    if (isAllColumns(selection) || names.length === columns.length)
        return "All";
    if (names.length <= 2)
        return names.join(", ");
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

export function projectVisibleGrid(columns, rows, selection) {
    const names = selectedColumnNames(columns, selection);
    if (names.length === columns.length)
        return { columns, rows };
    const indexes = names.map((name) => columns.findIndex((column) => column.name === name));
    return {
        columns: indexes.map((index) => columns[index]),
        rows: rows.map((row) => indexes.map((index) => row[index])),
    };
}

export function toggleVisibleColumn(columns, selection, name) {
    const all = columns.map((column) => column.name);
    if (!all.includes(name))
        return isAllColumns(selection) ? null : selectedColumnNames(columns, selection);
    if (isAllColumns(selection))
        return [name];
    const wanted = new Set(selectedColumnNames(columns, selection));
    if (wanted.has(name))
        wanted.delete(name);
    else
        wanted.add(name);
    if (!wanted.size || wanted.size === all.length)
        return null;
    return all.filter((entry) => wanted.has(entry));
}

export function selectVisibleRange(columns, fromName, toName) {
    const all = columns.map((column) => column.name);
    const from = all.indexOf(fromName);
    const to = all.indexOf(toName);
    if (from < 0 && to < 0)
        return null;
    if (from < 0)
        return [toName];
    if (to < 0)
        return [fromName];
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const range = all.slice(start, end + 1);
    return range.length === all.length ? null : range;
}

export function ensureVisibleColumn(columns, selection, name) {
    if (isAllColumns(selection))
        return null;
    const all = columns.map((column) => column.name);
    if (!all.includes(name))
        return selectedColumnNames(columns, selection);
    const wanted = new Set(selectedColumnNames(columns, selection));
    wanted.add(name);
    if (wanted.size === all.length)
        return null;
    return all.filter((entry) => wanted.has(entry));
}
