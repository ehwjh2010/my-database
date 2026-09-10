import { useEffect, useRef, useState } from "react";
import { cellDisplay, ColumnTooltip } from "./grid.jsx";
import { gutterRowNumber } from "./page-size.js";
import { frozenTableStyle, useFrozenColumnWidths } from "./sticky-header.js";
import { CellEditor } from "./cell-editor.jsx";
import { ContextMenu } from "../ui/context-menu.jsx";
import { InsertRows } from "./insert-rows.jsx";
import { getEdit, isDeleted, setInsertCell } from "./pending-changes.js";
import { Icon } from "../ui/icon.jsx";
import { cellClickIntent, cellHighlightClass, isCellInSelection, nextGridPoint, pointFromCell, rowHighlightClass } from "./grid-selection.js";
import { isEditableClipboardTarget } from "../lib/suppress-native-menu.js";

function gridOwnsClipboard(grid, target) {
    if (!grid)
        return false;
    if (target && grid.contains(target))
        return true;
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return Boolean(active && grid.contains(active));
}

function normalizeInput(value) {
    if (value === null)
        return null;
    if (typeof value === "boolean")
        return value ? "1" : "0";
    return String(value);
}

function Cols({ widths }) {
    if (!widths?.length)
        return null;
    return (
        <colgroup>
            {widths.map((width, index) => (
                <col key={index} style={{ width, minWidth: width }} />
            ))}
        </colgroup>
    );
}

export function DataGrid({ page, pageIndex = 0, pageSize = 1, changes, editable, mutationLocked, onChange, editing, setEditing, onContextItems, onCopyColumnName, onViewCell, selectedCell, selection, onSelectCell, onClearSelection, onRevertSelected, onCopySelection, onPasteSelection, canRevert, scrollTarget, sortDirections, onSort }) {
    const { displayColumns, displayRows, keyValuesFor } = page;
    const [menu, setMenu] = useState(null);
    const gridRef = useRef(null);
    const headTableRef = useRef(null);
    const bodyTableRef = useRef(null);
    const headerRefs = useRef(new Map());
    const cellRefs = useRef(new Map());
    const collapseTimerRef = useRef(null);
    const onCopySelectionRef = useRef(onCopySelection);
    const onPasteSelectionRef = useRef(onPasteSelection);
    onCopySelectionRef.current = onCopySelection;
    onPasteSelectionRef.current = onPasteSelection;
    const insertIds = (changes.model.inserts || []).map((insert) => insert.id);
    const selectionCtx = { columnCount: displayColumns.length, rowCount: displayRows.length, insertIds };
    const colWidths = useFrozenColumnWidths(headTableRef, bodyTableRef, [displayColumns, displayRows, editable, editing]);
    const tableStyle = frozenTableStyle(colWidths);

    const clearCollapseTimer = () => {
        if (collapseTimerRef.current) {
            clearTimeout(collapseTimerRef.current);
            collapseTimerRef.current = null;
        }
    };

    useEffect(() => () => clearCollapseTimer(), []);

    useEffect(() => {
        const ignore = (target) => isEditableClipboardTarget(target) || !gridOwnsClipboard(gridRef.current, target);
        const onCopy = (event) => {
            if (ignore(event.target))
                return;
            if (!onCopySelectionRef.current?.(event))
                return;
            event.preventDefault();
            event.stopPropagation();
        };
        const onPaste = (event) => {
            if (ignore(event.target))
                return;
            event.preventDefault();
            event.stopPropagation();
            void onPasteSelectionRef.current?.(event);
        };
        const onKeyDown = (event) => {
            if (ignore(event.target))
                return;
            const command = event.metaKey || event.ctrlKey;
            if (!command || event.altKey || event.shiftKey)
                return;
            const key = event.key.toLowerCase();
            if (key === "c") {
                if (!onCopySelectionRef.current?.(event))
                    return;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (key === "v") {
                event.preventDefault();
                event.stopPropagation();
                void onPasteSelectionRef.current?.(event);
            }
        };
        window.addEventListener("copy", onCopy, true);
        window.addEventListener("paste", onPaste, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("copy", onCopy, true);
            window.removeEventListener("paste", onPaste, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, []);

    useEffect(() => {
        if (!scrollTarget)
            return;
        const target = scrollTarget.row === null
            ? headerRefs.current.get(scrollTarget.column)
            : cellRefs.current.get(`${scrollTarget.row}:${scrollTarget.column}`);
        target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [scrollTarget]);

    const commitRowEdit = (r, column, original, next) => {
        if (mutationLocked)
            return setEditing(null);
        if (next !== undefined)
            changes.setEdit(keyValuesFor(r), column.name, normalizeInput(next), original);
        onChange();
        setEditing(null);
    };

    const commitInsertEdit = (insert, column, next) => {
        if (mutationLocked)
            return setEditing(null);
        if (next !== undefined) {
            setInsertCell(changes.model, insert.id, column.name, normalizeInput(next));
        }
        onChange();
        setEditing(null);
    };

    const revertMenuItem = canRevert
        ? [{ label: "Revert Selected", onClick: () => onRevertSelected() }]
        : [];

    const clipboardMenuItems = [
        { label: "Copy", onClick: () => { void onCopySelection?.(); } },
        ...(editable && !mutationLocked ? [{ label: "Paste", onClick: () => { void onPasteSelection?.(); } }] : []),
    ];

    const rowContextItems = (r, c) => {
        const column = displayColumns[c];
        const value = displayRows[r][c];
        const items = [...clipboardMenuItems, ...revertMenuItem, ...onContextItems(value, r, column)];
        if (editable && !mutationLocked) {
            items.push({ separator: true });
            items.push({
                label: "Set NULL",
                onClick: () => { changes.setEdit(keyValuesFor(r), column.name, null, value); onChange(); },
            });
            items.push({
                label: isDeleted(changes.model, keyValuesFor(r)) ? "Undelete row" : "Delete row",
                onClick: () => { changes.toggleDelete(keyValuesFor(r)); onChange(); },
            });
        }
        return items;
    };

    const insertContextItems = () => [...clipboardMenuItems, ...revertMenuItem];

    const focusGrid = () => {
        gridRef.current.focus({ preventScroll: true });
    };

    const applyCellPointer = (cell, event) => {
        if (event?.target?.closest?.("td.editing"))
            return;
        focusGrid();
        const point = pointFromCell(cell);
        const intent = cellClickIntent(event, isCellInSelection(selection, point, selectionCtx));
        if (intent === "ignore")
            return;
        clearCollapseTimer();
        if (intent === "retain") {
            onSelectCell(cell, { focusOnly: true });
            collapseTimerRef.current = setTimeout(() => {
                collapseTimerRef.current = null;
                onSelectCell(cell, {});
            }, 400);
            return;
        }
        if (intent === "extend")
            onSelectCell(cell, { extend: true });
        else if (intent === "additive")
            onSelectCell(cell, { additive: true });
        else
            onSelectCell(cell, {});
    };

    const selectCell = (row, column, event) => {
        applyCellPointer({ row, column }, event);
    };

    const selectRow = (row, event) => {
        if (!displayColumns.length)
            return;
        clearCollapseTimer();
        focusGrid();
        const column = Math.max(0, Math.min(selectedCell?.column ?? 0, displayColumns.length - 1));
        onSelectCell({ row, column }, { row: true, extend: event?.shiftKey, additive: event?.metaKey || event?.ctrlKey });
    };

    const selectInsert = (insertId, column, event) => {
        if (!displayColumns.length)
            return;
        applyCellPointer(
            { kind: "insert", insertId, column: Math.max(0, Math.min(column, displayColumns.length - 1)) },
            event,
        );
    };

    const selectInsertRow = (insertId, event) => {
        if (!displayColumns.length)
            return;
        clearCollapseTimer();
        focusGrid();
        const column = Math.max(0, Math.min(selectedCell?.column ?? 0, displayColumns.length - 1));
        onSelectCell(
            { kind: "insert", insertId, column },
            { row: true, extend: event?.shiftKey, additive: event?.metaKey || event?.ctrlKey },
        );
    };

    const startEditing = (next) => {
        clearCollapseTimer();
        setEditing(next);
    };

    const beginEditFromFocus = () => {
        if (!editable || mutationLocked || !selectedCell || !displayColumns.length)
            return false;
        const column = displayColumns[Math.max(0, Math.min(selectedCell.column ?? 0, displayColumns.length - 1))];
        if (!column)
            return false;
        if (selectedCell.kind === "insert")
            startEditing({ kind: "insert", insertId: selectedCell.insertId, column: column.name });
        else
            startEditing({ kind: "row", row: selectedCell.row, column: column.name });
        return true;
    };

    const openCellMenu = (event, r, c) => {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        clearCollapseTimer();
        const point = { type: "row", row: r, column: c };
        if (!isCellInSelection(selection, point, selectionCtx))
            selectCell(r, c);
        setMenu({ x: event.clientX, y: event.clientY, items: rowContextItems(r, c) });
    };

    const onGridKeyDown = (event) => {
        if (event.ctrlKey && event.altKey && (event.key === "z" || event.key === "Z") && !event.metaKey) {
            event.preventDefault();
            if (editing)
                startEditing(null);
            onRevertSelected?.();
            return;
        }
        if (event.key === "Escape") {
            if (editing)
                return;
            event.preventDefault();
            clearCollapseTimer();
            onClearSelection?.();
            return;
        }
        if (editing)
            return;
        if (event.key === "Enter" && !event.isComposing) {
            if (beginEditFromFocus())
                event.preventDefault();
            return;
        }
        const point = pointFromCell(selectedCell);
        const next = nextGridPoint(point, event.key, displayRows.length, displayColumns.length, insertIds);
        if (!next)
            return;
        event.preventDefault();
        clearCollapseTimer();
        const cell = next.type === "insert"
            ? { kind: "insert", insertId: next.insertId, column: next.column }
            : { row: next.row, column: next.column };
        onSelectCell(cell, { extend: event.shiftKey });
        const key = next.type === "insert" ? `insert:${next.insertId}:${next.column}` : `${next.row}:${next.column}`;
        cellRefs.current.get(key)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    };

    return (
        <div
            ref={gridRef}
            className="grid-wrap outline-none"
            tabIndex={0}
            onKeyDown={onGridKeyDown}
            onMouseDown={(event) => {
                if (event.button === 2)
                    event.preventDefault();
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    clearCollapseTimer();
                    onClearSelection?.();
                }
            }}
        >
            <div className="grid-head-pin">
                <table ref={headTableRef} className="grid-table data-grid-table" style={tableStyle}>
                    <Cols widths={colWidths} />
                    <thead>
                        <tr>
                            {editable ? <th className="gutter" /> : null}
                            {displayColumns.map((col, c) => {
                                const direction = sortDirections.get(col.name);
                                return (
                                    <th
                                        key={col.name}
                                        ref={(node) => node ? headerRefs.current.set(c, node) : headerRefs.current.delete(c)}
                                        aria-sort={direction === "ASC" ? "ascending" : direction === "DESC" ? "descending" : "none"}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            setMenu({ x: event.clientX, y: event.clientY, items: [{ label: "Copy Column Name", onClick: () => onCopyColumnName(col.name) }] });
                                        }}
                                    >
                                        <button type="button" className="sortable-header" onClick={() => onSort(col.name)}>
                                            <span>{col.name}</span>
                                            {direction ? (
                                                <span className={`sort-arrow ${direction === "ASC" ? "sort-arrow-asc" : ""}`}>
                                                    <Icon name="chevronDown" size={12} />
                                                </span>
                                            ) : null}
                                            <ColumnTooltip column={col} />
                                        </button>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                </table>
            </div>
            <table ref={bodyTableRef} className="grid-table data-grid-table" style={tableStyle}>
                <Cols widths={colWidths} />
                <tbody>
                    {displayRows.map((row, r) => {
                        const deleted = editable && isDeleted(changes.model, keyValuesFor(r));
                        const rowKey = { type: "row", row: r };
                        return (
                            <tr key={r} className={rowHighlightClass(selection, rowKey, selectionCtx, selectedCell, [deleted ? "row-deleted" : ""])}>
                                {editable ? (
                                    <td className="gutter" onClick={(event) => selectRow(r, event)}>
                                        {gutterRowNumber(pageIndex, pageSize, r)}
                                    </td>
                                ) : null}
                                {row.map((value, c) => {
                                    const column = displayColumns[c];
                                    const edit = editable ? getEdit(changes.model, keyValuesFor(r), column.name) : { edited: false };
                                    const isEditing = editing && editing.kind === "row" && editing.row === r && editing.column === column.name;
                                    const point = { type: "row", row: r, column: c };
                                    if (isEditing)
                                        return (
                                            <td
                                                key={c}
                                                ref={(node) => node ? cellRefs.current.set(`${r}:${c}`, node) : cellRefs.current.delete(`${r}:${c}`)}
                                                className={cellHighlightClass(selection, point, selectionCtx, selectedCell, ["editing"])}
                                                onClick={(event) => selectCell(r, c, event)}
                                            >
                                                <CellEditor
                                                    type={column.type}
                                                    value={edit.edited ? edit.value : value}
                                                    onCommit={(next) => commitRowEdit(r, column, value, next)}
                                                    onCancel={() => startEditing(null)}
                                                />
                                            </td>
                                        );
                                    const info = cellDisplay(edit.edited ? edit.value : value);
                                    return (
                                        <td
                                            key={c}
                                            ref={(node) => node ? cellRefs.current.set(`${r}:${c}`, node) : cellRefs.current.delete(`${r}:${c}`)}
                                            className={cellHighlightClass(selection, point, selectionCtx, selectedCell, [edit.edited ? "cell-edited" : ""])}
                                            title={info.title}
                                            onClick={(event) => selectCell(r, c, event)}
                                            onDoubleClick={() => {
                                                if (editable && !mutationLocked)
                                                    startEditing({ kind: "row", row: r, column: column.name });
                                                else
                                                    onViewCell(value);
                                            }}
                                            onContextMenu={(event) => openCellMenu(event, r, c)}
                                        >
                                            {info.null ? <span className="null-badge">NULL</span> : info.text}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}
                    {editable ? (
                        <InsertRows
                            inserts={changes.model.inserts}
                            columns={displayColumns}
                            editing={editing}
                            mutationLocked={mutationLocked}
                            selection={selection}
                            selectionCtx={selectionCtx}
                            selectedCell={selectedCell}
                            onSelectInsert={selectInsert}
                            onSelectInsertRow={selectInsertRow}
                            onOpenMenu={(event, insertId, c) => {
                                const items = insertContextItems();
                                if (!items.length)
                                    return;
                                event.preventDefault();
                                if (!isCellInSelection(selection, { type: "insert", insertId, column: c }, selectionCtx))
                                    selectInsert(insertId, c);
                                setMenu({ x: event.clientX, y: event.clientY, items });
                            }}
                            onEdit={startEditing}
                            onCommit={commitInsertEdit}
                            cellRefs={cellRefs}
                        />
                    ) : null}
                </tbody>
            </table>
            {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
        </div>
    );
}
