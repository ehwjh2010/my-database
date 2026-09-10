import { CellEditor } from "./cell-editor.jsx";
import { cellHighlightClass, rowHighlightClass } from "./grid-selection.js";

function InsertCell({ insert, column, editing, className, onSelect, onOpenEditor, onCommit, onCancel, onContextMenu, cellRef }) {
    const cellClass = ["mono", className].filter(Boolean).join(" ");
    if (editing)
        return (
            <td ref={cellRef} className={cellClass} onClick={onSelect}>
                <CellEditor
                    type={column.type}
                    value={insert.cells.has(column.name) ? insert.cells.get(column.name) : null}
                    onCommit={onCommit}
                    onCancel={onCancel}
                />
            </td>
        );
    return (
        <td ref={cellRef} className={cellClass} onClick={onSelect} onDoubleClick={onOpenEditor} onContextMenu={onContextMenu}>
            {insert.cells.has(column.name) ? insert.cells.get(column.name) : <span className="null-badge">default</span>}
        </td>
    );
}

export function InsertRows({ inserts, columns, editing, mutationLocked, selection, selectionCtx, selectedCell, onSelectInsert, onSelectInsertRow, onOpenMenu, onEdit, onCommit, cellRefs }) {
    return inserts.map((insert) => {
        const rowKey = { type: "insert", insertId: insert.id };
        return (
            <tr key={insert.id} className={rowHighlightClass(selection, rowKey, selectionCtx, selectedCell, ["row-insert"])}>
                <td className="gutter" onClick={(event) => onSelectInsertRow(insert.id, event)}>
                    +
                </td>
                {columns.map((column, c) => {
                    const isEditing = editing && editing.kind === "insert" && editing.insertId === insert.id && editing.column === column.name;
                    return (
                        <InsertCell
                            key={column.name}
                            insert={insert}
                            column={column}
                            className={cellHighlightClass(selection, { type: "insert", insertId: insert.id, column: c }, selectionCtx, selectedCell, [isEditing ? "editing" : ""])}
                            editing={isEditing}
                            onSelect={(event) => onSelectInsert(insert.id, c, event)}
                            onOpenEditor={() => { if (!mutationLocked) onEdit({ kind: "insert", insertId: insert.id, column: column.name }); }}
                            onCommit={(next) => onCommit(insert, column, next)}
                            onCancel={() => onEdit(null)}
                            onContextMenu={(event) => onOpenMenu(event, insert.id, c)}
                            cellRef={(node) => {
                                const key = `insert:${insert.id}:${c}`;
                                if (node)
                                    cellRefs?.current.set(key, node);
                                else
                                    cellRefs?.current.delete(key);
                            }}
                        />
                    );
                })}
            </tr>
        );
    });
}
