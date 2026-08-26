export function createChanges(engine, ref, info) {
    const keyColumns = info.primaryKey.length
        ? info.primaryKey
        : info.rowid
            ? ["__rowid"]
            : null;
    return { engine, ref, info, keyColumns, edits: new Map(), deletes: new Map(), inserts: [], insertCounter: 0, revision: 0 };
}

export function isEditable(changes) {
    return changes.keyColumns !== null;
}

export function rowKey(keyValues) {
    return JSON.stringify(keyValues);
}

function comparableValue(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === "boolean")
        return value ? "1" : "0";
    return String(value);
}

export function setEdit(changes, keyValues, column, value, original) {
    const key = rowKey(keyValues);
    if (!changes.edits.has(key))
        changes.edits.set(key, { keyValues, cells: new Map(), originals: new Map() });
    const entry = changes.edits.get(key);
    if (!entry.originals.has(column))
        entry.originals.set(column, original);
    if (comparableValue(entry.originals.get(column)) === comparableValue(value)) {
        entry.cells.delete(column);
        if (!entry.cells.size)
            changes.edits.delete(key);
        changes.revision += 1;
        return;
    }
    entry.cells.set(column, value);
    changes.revision += 1;
}

export function setInsertCell(changes, id, column, value) {
    const insert = changes.inserts.find((entry) => entry.id === id);
    if (!insert)
        return false;
    if (value === null || value === "")
        insert.cells.delete(column);
    else
        insert.cells.set(column, value);
    changes.revision += 1;
    return true;
}

export function getEdit(changes, keyValues, column) {
    const entry = changes.edits.get(rowKey(keyValues));
    if (entry && entry.cells.has(column))
        return { value: entry.cells.get(column), edited: true };
    return { edited: false };
}

export function toggleDelete(changes, keyValues) {
    const key = rowKey(keyValues);
    if (changes.deletes.has(key))
        changes.deletes.delete(key);
    else
        changes.deletes.set(key, keyValues);
    changes.revision += 1;
}

export function isDeleted(changes, keyValues) {
    return changes.deletes.has(rowKey(keyValues));
}

export function addInsert(changes) {
    const insert = { id: ++changes.insertCounter, cells: new Map() };
    changes.inserts.push(insert);
    changes.revision += 1;
    return insert;
}

export function removeInsert(changes, id) {
    changes.inserts = changes.inserts.filter((i) => i.id !== id);
    changes.revision += 1;
}

export function changeCount(changes) {
    let edits = 0;
    for (const entry of changes.edits.values())
        edits += entry.cells.size;
    return edits + changes.deletes.size + changes.inserts.length;
}

export function clearChanges(changes) {
    changes.edits.clear();
    changes.deletes.clear();
    changes.inserts = [];
    changes.revision += 1;
}
