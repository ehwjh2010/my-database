import { parseCsv } from "../lib/parse/csv.js";
import { addInsert, getEdit, setEdit, setInsertCell } from "./pending-changes.js";
import { expandRect, flattenSelectionToPoints, linearIndex, pointAt, pointFromCell, selectionRowKeys } from "./grid-selection.js";

export function clipboardCellText(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "boolean")
        return value ? "true" : "false";
    return String(value);
}

function escapeTsv(value) {
    const text = clipboardCellText(value);
    if (/[\t\n\r",]/.test(text) || text === "")
        return `"${text.replace(/"/g, "\"\"")}"`;
    return text;
}

export function serializeGridClipboard(matrix) {
    return matrix.map((row) => row.map(escapeTsv).join("\t")).join("\n");
}

export function parseGridClipboard(text) {
    const source = String(text ?? "").replace(/^\uFEFF/, "").replace(/\n$/, "");
    if (!source)
        return [];
    const delimiter = source.includes("\t") ? "\t" : ",";
    return parseCsv(source, { delimiter, bareEmpty: "" });
}

export function gridCellValue(page, changes, point) {
    const column = page.displayColumns[point.column];
    if (!column)
        return null;
    if (point.type === "insert") {
        const insert = changes.inserts.find((entry) => entry.id === point.insertId);
        return insert?.cells.has(column.name) ? insert.cells.get(column.name) : null;
    }
    const original = page.displayRows[point.row]?.[point.column];
    const edit = getEdit(changes, page.keyValuesFor(point.row), column.name);
    return edit.edited ? edit.value : (original ?? null);
}

function matrixFromPoints(points, ctx) {
    if (!points.length)
        return [];
    const indexed = points
        .map((point) => ({ point, linear: linearIndex(point, ctx.rowCount, ctx.insertIds) }))
        .filter((entry) => entry.linear >= 0);
    if (!indexed.length)
        return [];
    const linears = indexed.map((entry) => entry.linear);
    const columns = indexed.map((entry) => entry.point.column);
    const minLinear = Math.min(...linears);
    const maxLinear = Math.max(...linears);
    const minColumn = Math.min(...columns);
    const maxColumn = Math.max(...columns);
    const present = new Set(indexed.map((entry) => `${entry.linear}:${entry.point.column}`));
    const matrix = [];
    for (let linear = minLinear; linear <= maxLinear; linear += 1) {
        const row = [];
        for (let column = minColumn; column <= maxColumn; column += 1) {
            const point = pointAt(linear, column, ctx.rowCount, ctx.insertIds);
            row.push(present.has(`${linear}:${column}`) ? ctx.valueAt(point) : "");
        }
        matrix.push(row);
    }
    return matrix;
}

export function clipboardMatrixFromSelection(selection, selectedCell, ctx) {
    if (selection?.kind === "rows") {
        const keys = selectionRowKeys(selection, ctx)
            .slice()
            .sort((left, right) => linearIndex({ ...left, column: 0 }, ctx.rowCount, ctx.insertIds) - linearIndex({ ...right, column: 0 }, ctx.rowCount, ctx.insertIds));
        return keys.map((key) => {
            const row = [];
            for (let column = 0; column < ctx.columnCount; column += 1)
                row.push(ctx.valueAt({ ...key, column }));
            return row;
        });
    }
    if (selection && selection.kind !== "none")
        return matrixFromPoints(flattenSelectionToPoints(selection, ctx), ctx);
    const point = pointFromCell(selectedCell);
    if (!point)
        return [];
    return [[ctx.valueAt(point)]];
}

export function pasteOrigin(selection, selectedCell, ctx) {
    if (selection?.kind === "rows") {
        const keys = selectionRowKeys(selection, ctx);
        if (keys.length) {
            let origin = keys[0];
            let best = linearIndex({ ...origin, column: 0 }, ctx.rowCount, ctx.insertIds);
            for (const key of keys) {
                const linear = linearIndex({ ...key, column: 0 }, ctx.rowCount, ctx.insertIds);
                if (linear >= 0 && (best < 0 || linear < best)) {
                    origin = key;
                    best = linear;
                }
            }
            return { ...origin, column: 0 };
        }
    }
    if (selection && selection.kind !== "none") {
        const points = flattenSelectionToPoints(selection, ctx);
        if (points.length) {
            let origin = points[0];
            let best = linearIndex(origin, ctx.rowCount, ctx.insertIds);
            for (const point of points) {
                const linear = linearIndex(point, ctx.rowCount, ctx.insertIds);
                if (linear < 0)
                    continue;
                if (best < 0 || linear < best || (linear === best && point.column < origin.column)) {
                    origin = point;
                    best = linear;
                }
            }
            return origin;
        }
    }
    return pointFromCell(selectedCell) || { type: "row", row: 0, column: 0 };
}

function pastedValue(text) {
    return text == null || text === "" ? null : text;
}

function writePastedCell(changes, ctx, point, columnIndex, text) {
    const column = ctx.columns[columnIndex];
    if (!column)
        return;
    const value = pastedValue(text);
    if (point.type === "insert") {
        setInsertCell(changes, point.insertId, column.name, value);
        return;
    }
    const original = ctx.displayRows[point.row]?.[columnIndex] ?? null;
    setEdit(changes, ctx.keyValuesFor(point.row), column.name, value, original);
}

export function applyGridPaste(changes, origin, matrix, ctx) {
    if (!matrix?.length)
        return null;
    const insertIds = [...ctx.insertIds];
    const rowCount = ctx.rowCount;
    const originLinear = Math.max(0, linearIndex(origin, rowCount, insertIds));
    const startColumn = Math.max(0, origin.column ?? 0);
    let first = null;
    let last = null;
    for (let row = 0; row < matrix.length; row += 1) {
        const targetLinear = originLinear + row;
        while (targetLinear >= rowCount + insertIds.length)
            insertIds.push(addInsert(changes).id);
        const target = pointAt(targetLinear, 0, rowCount, insertIds);
        const cells = matrix[row];
        for (let offset = 0; offset < cells.length; offset += 1) {
            const column = startColumn + offset;
            if (column >= ctx.columns.length)
                break;
            writePastedCell(changes, ctx, target, column, cells[offset] ?? "");
            const cell = { ...target, column };
            if (!first)
                first = cell;
            last = cell;
        }
    }
    if (!first)
        return null;
    return { origin: first, focus: last || first, selection: expandRect(first, last || first) };
}
