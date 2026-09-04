export function indexKind(index, primaryKey) {
    const columns = index.columns || [];
    const pk = primaryKey || [];
    const samePk = pk.length > 0 && columns.length === pk.length && columns.every((column, index) => column === pk[index]);
    if (index.name === "PRIMARY" || samePk)
        return "primary";
    if (index.unique)
        return "unique";
    return "index";
}

export function displayIndexes(info) {
    const primaryKey = info?.primaryKey || [];
    const indexes = [...(info?.indexes || [])];
    const hasPrimary = indexes.some((index) => indexKind(index, primaryKey) === "primary");
    if (primaryKey.length && !hasPrimary)
        indexes.unshift({ name: "PRIMARY", unique: true, columns: [...primaryKey] });
    const rank = { primary: 0, unique: 1, index: 2 };
    return indexes
        .map((index, order) => ({ index, order, kind: indexKind(index, primaryKey) }))
        .sort((left, right) => rank[left.kind] - rank[right.kind] || left.order - right.order)
        .map((entry) => entry.index);
}

export function groupForeignKeys(foreignKeys) {
    const groups = new Map();
    for (const foreignKey of foreignKeys || []) {
        const key = foreignKey.name || `${foreignKey.column}->${foreignKey.refTable}.${foreignKey.refColumn}`;
        if (!groups.has(key)) {
            groups.set(key, {
                name: foreignKey.name || "",
                columns: [],
                refTable: foreignKey.refTable || "",
                refColumns: [],
                onUpdate: foreignKey.onUpdate || "",
                onDelete: foreignKey.onDelete || "",
            });
        }
        const group = groups.get(key);
        if (foreignKey.column)
            group.columns.push(foreignKey.column);
        if (foreignKey.refColumn)
            group.refColumns.push(foreignKey.refColumn);
        if (foreignKey.refTable)
            group.refTable = foreignKey.refTable;
        if (foreignKey.onUpdate)
            group.onUpdate = foreignKey.onUpdate;
        if (foreignKey.onDelete)
            group.onDelete = foreignKey.onDelete;
    }
    return [...groups.values()];
}

export function actionLabel(rule) {
    if (!rule)
        return "";
    const normalized = String(rule).trim().replaceAll("_", " ").toUpperCase();
    if (!normalized || normalized === "NO ACTION" || normalized === "RESTRICT")
        return "";
    return normalized;
}
