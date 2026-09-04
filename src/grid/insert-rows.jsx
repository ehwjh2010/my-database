import { CellEditor } from "./cell-editor.jsx";
import { isCellInSelection, isRowInSelection } from "./grid-selection.js";

function InsertCell({ insert, column, editing, selected, onSelect, onOpenEditor, onCommit, onCancel, onContextMenu, cellRef }) {
    if (editing)
        return (
            <td ref={cellRef} className={`mono editing${selected ? " cell-selected" : ""}`} onClick={onSelect}>
                <CellEditor
                    type={column.type}
                    value={insert.cells.has(column.name) ? insert.cells.get(column.name) : null}
                    onCommit={onCommit}
                    onCancel={onCancel}
                />
            </td>
        );
    return (
        <td ref={cellRef} className={`mono${selected ? " cell-selected" : ""}`} onClick={onSelect} onDoubleClick={onOpenEditor} onContextMenu={onContextMenu}>
            {insert.cells.has(column.name) ? insert.cells.get(column.name) : <span className="null-badge">default</span>}
        </td>
    );
}

export function InsertRows({ inserts, columns, editing, mutationLocked, selection, selectionCtx, onSelectInsert, onSelectInsertRow, onOpenMenu, onEdit, onCommit, cellRefs }) {
    return inserts.map((insert) => {
        const rowKey = { type: "insert", insertId: insert.id };
        const rowSelected = isRowInSelection(selection, rowKey, selectionCtx);
        return (
            <tr key={insert.id} className={["row-insert", rowSelected ? "row-selected" : ""].filter(Boolean).join(" ")}>
                <td className="gutter" onClick={(event) => onSelectInsertRow(insert.id, event)}>
                    +
                </td>
                {columns.map((column, c) => (
                    <InsertCell
                        key={column.name}
                        insert={insert}
                        column={column}
                        selected={isCellInSelection(selection, { type: "insert", insertId: insert.id, column: c }, selectionCtx)}
                        editing={editing && editing.kind === "insert" && editing.insertId === insert.id && editing.column === column.name}
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
                ))}
            </tr>
        );
    });
}
