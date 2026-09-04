import { getEdit, rowHasPending, revertCell, revertInsertCell, revertRow, removeInsert, clearChanges } from "./pending-changes.js";

export const EMPTY_SELECTION = { kind: "none" };

export function pointFromCell(cell) {
    if (!cell)
        return null;
    if (cell.kind === "insert")
        return { type: "insert", insertId: cell.insertId, column: cell.column };
    return { type: "row", row: cell.row, column: cell.column ?? 0 };
}

export function cellFromPoint(point) {
    if (!point)
        return null;
    if (point.type === "insert")
        return { kind: "insert", insertId: point.insertId, column: point.column };
    return { kind: "row", row: point.row, column: point.column };
}

export function singleCellSelection(point) {
    return { kind: "rect", anchor: point, focus: point };
}

export function rowKeyFromPoint(point) {
    return point.type === "insert" ? { type: "insert", insertId: point.insertId } : { type: "row", row: point.row };
}

export function rowKeysEqual(left, right) {
    if (!left || !right || left.type !== right.type)
        return false;
    return left.type === "insert" ? left.insertId === right.insertId : left.row === right.row;
}

export function pointsEqual(left, right) {
    if (!left || !right || left.type !== right.type || left.column !== right.column)
        return false;
    return left.type === "insert" ? left.insertId === right.insertId : left.row === right.row;
}

export function cellClickIntent(event, inSelection) {
    if (event?.detail === 2)
        return "ignore";
    if (event?.shiftKey)
        return "extend";
    if (event?.metaKey || event?.ctrlKey)
        return "additive";
    if (inSelection)
        return "retain";
    return "replace";
}

export function linearIndex(point, rowCount, insertIds) {
    if (point.type === "row")
        return point.row;
    const index = insertIds.indexOf(point.insertId);
    return index < 0 ? -1 : rowCount + index;
}

export function pointAt(linear, column, rowCount, insertIds) {
    if (linear < rowCount)
        return { type: "row", row: linear, column };
    return { type: "insert", insertId: insertIds[linear - rowCount], column };
}

export function nextGridPoint(point, key, rowCount, columnCount, insertIds) {
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[key];
    if (!move || !point)
        return null;
    const totalRows = rowCount + insertIds.length;
    if (!totalRows || !columnCount)
        return null;
    const linear = linearIndex(point, rowCount, insertIds);
    if (linear < 0)
        return null;
    const nextLinear = Math.max(0, Math.min(totalRows - 1, linear + move[0]));
    const nextColumn = Math.max(0, Math.min(columnCount - 1, point.column + move[1]));
    return pointAt(nextLinear, nextColumn, rowCount, insertIds);
}

export function expandRect(anchor, focus) {
    return { kind: "rect", anchor, focus };
}

export function singleRowSelection(key) {
    return { kind: "rows", keys: [key] };
}

export function toggleRowSelection(selection, key) {
    const keys = selection?.kind === "rows" ? selection.keys : [];
    const exists = keys.some((item) => rowKeysEqual(item, key));
    const next = exists ? keys.filter((item) => !rowKeysEqual(item, key)) : [...keys, key];
    return next.length ? { kind: "rows", keys: next } : EMPTY_SELECTION;
}

export function rowRangeSelection(fromKey, toKey, rowCount, insertIds) {
    const from = linearIndex({ ...fromKey, column: 0 }, rowCount, insertIds);
    const to = linearIndex({ ...toKey, column: 0 }, rowCount, insertIds);
    if (from < 0 || to < 0)
        return singleRowSelection(toKey);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const keys = [];
    for (let index = start; index <= end; index += 1)
        keys.push(rowKeyFromPoint(pointAt(index, 0, rowCount, insertIds)));
    return { kind: "rows", keys };
}

export function flattenSelectionToPoints(selection, ctx) {
    if (!selection || selection.kind === "none")
        return [];
    if (selection.kind === "cells")
        return [...selection.points];
    const targets = selectionTargets(selection, ctx);
    if (targets.rows) {
        const points = [];
        for (const key of targets.rows) {
            const base = key.type === "insert" ? { type: "insert", insertId: key.insertId } : { type: "row", row: key.row };
            for (let column = 0; column < ctx.columnCount; column += 1)
                points.push({ ...base, column });
        }
        return points;
    }
    return targets.cells || [];
}

export function toggleCellSelection(selection, point, ctx) {
    const points = flattenSelectionToPoints(selection, ctx);
    const exists = points.some((item) => pointsEqual(item, point));
    const next = exists ? points.filter((item) => !pointsEqual(item, point)) : [...points, point];
    if (!next.length)
        return EMPTY_SELECTION;
    if (next.length === 1)
        return singleCellSelection(next[0]);
    return { kind: "cells", points: next };
}

export function selectionTargets(selection, { columnCount, rowCount, insertIds }) {
    if (!selection || selection.kind === "none")
        return { all: true };
    if (selection.kind === "rows")
        return { rows: selection.keys };
    if (selection.kind === "cells")
        return { cells: selection.points };
    const anchor = selection.anchor;
    const focus = selection.focus;
    const startRow = linearIndex(anchor, rowCount, insertIds);
    const endRow = linearIndex(focus, rowCount, insertIds);
    if (startRow < 0 || endRow < 0 || !columnCount)
        return { cells: [] };
    const startColumn = Math.min(anchor.column, focus.column);
    const endColumn = Math.max(anchor.column, focus.column);
    const cells = [];
    for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) {
        const base = pointAt(row, 0, rowCount, insertIds);
        for (let column = startColumn; column <= endColumn; column += 1)
            cells.push({ ...base, column });
    }
    return { cells };
}

export function isRowInSelection(selection, key, ctx) {
    if (selection?.kind === "rows")
        return selection.keys.some((item) => rowKeysEqual(item, key));
    if (selection?.kind !== "rect")
        return false;
    const start = linearIndex(selection.anchor, ctx.rowCount, ctx.insertIds);
    const end = linearIndex(selection.focus, ctx.rowCount, ctx.insertIds);
    const row = linearIndex({ ...key, column: 0 }, ctx.rowCount, ctx.insertIds);
    if (start < 0 || end < 0 || row < 0)
        return false;
    const startColumn = Math.min(selection.anchor.column, selection.focus.column);
    const endColumn = Math.max(selection.anchor.column, selection.focus.column);
    return row >= Math.min(start, end) && row <= Math.max(start, end) && startColumn === 0 && endColumn === ctx.columnCount - 1;
}

export function isCellInSelection(selection, point, ctx) {
    if (!selection || selection.kind === "none")
        return false;
    if (selection.kind === "cells")
        return selection.points.some((item) => pointsEqual(item, point));
    if (selection.kind === "rows")
        return isRowInSelection(selection, rowKeyFromPoint(point), ctx);
    const startRow = linearIndex(selection.anchor, ctx.rowCount, ctx.insertIds);
    const endRow = linearIndex(selection.focus, ctx.rowCount, ctx.insertIds);
    const row = linearIndex(point, ctx.rowCount, ctx.insertIds);
    if (startRow < 0 || endRow < 0 || row < 0)
        return false;
    const startColumn = Math.min(selection.anchor.column, selection.focus.column);
    const endColumn = Math.max(selection.anchor.column, selection.focus.column);
    return row >= Math.min(startRow, endRow) && row <= Math.max(startRow, endRow) && point.column >= startColumn && point.column <= endColumn;
}

function cellHasPending(changes, cell, ctx) {
    const column = ctx.columns[cell.column];
    if (!column)
        return false;
    if (cell.type === "insert") {
        const insert = changes.inserts.find((entry) => entry.id === cell.insertId);
        return Boolean(insert?.cells.has(column.name));
    }
    return getEdit(changes, ctx.keyValuesFor(cell.row), column.name).edited;
}

function rowTargetHasPending(changes, key, ctx) {
    if (key.type === "insert")
        return changes.inserts.some((entry) => entry.id === key.insertId);
    return rowHasPending(changes, ctx.keyValuesFor(key.row));
}

export function selectionHasPending(selection, changes, ctx) {
    const targets = selectionTargets(selection, ctx);
    if (targets.all)
        return ctx.pendingCount > 0;
    if (targets.rows)
        return targets.rows.some((key) => rowTargetHasPending(changes, key, ctx));
    return targets.cells.some((cell) => cellHasPending(changes, cell, ctx));
}

export function applyRevertSelection(changes, selection, ctx) {
    const targets = selectionTargets(selection, ctx);
    if (targets.all) {
        if (ctx.pendingCount <= 0)
            return false;
        clearChanges(changes);
        return true;
    }
    let changed = false;
    if (targets.rows) {
        for (const key of targets.rows) {
            if (key.type === "insert") {
                if (changes.inserts.some((entry) => entry.id === key.insertId)) {
                    removeInsert(changes, key.insertId);
                    changed = true;
                }
            }
            else if (revertRow(changes, ctx.keyValuesFor(key.row)))
                changed = true;
        }
        return changed;
    }
    for (const cell of targets.cells) {
        const column = ctx.columns[cell.column];
        if (!column)
            continue;
        if (cell.type === "insert") {
            if (revertInsertCell(changes, cell.insertId, column.name))
                changed = true;
        }
        else if (revertCell(changes, ctx.keyValuesFor(cell.row), column.name))
            changed = true;
    }
    return changed;
}
