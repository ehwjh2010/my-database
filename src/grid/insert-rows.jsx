import { CellEditor } from "./cell-editor.jsx";

function InsertCell({ insert, column, editing, selected, onSelect, onOpenEditor, onCommit, onCancel }) {
    if (editing)
        return (
            <td className={`mono editing${selected ? " cell-selected" : ""}`} onClick={onSelect}>
                <CellEditor
                    type={column.type}
                    value={insert.cells.has(column.name) ? insert.cells.get(column.name) : null}
                    onCommit={onCommit}
                    onCancel={onCancel}
                />
            </td>
        );
    return (
        <td className={`mono${selected ? " cell-selected" : ""}`} onClick={onSelect} onDoubleClick={onOpenEditor}>
            {insert.cells.has(column.name) ? insert.cells.get(column.name) : <span className="null-badge">default</span>}
        </td>
    );
}

export function InsertRows({ inserts, columns, editing, mutationLocked, selectedCell, onSelectInsert, onEdit, onCommit }) {
    return inserts.map((insert) => {
        const rowSelected = selectedCell?.kind === "insert" && selectedCell.insertId === insert.id;
        return (
            <tr key={insert.id} className={["row-insert", rowSelected ? "row-selected" : ""].filter(Boolean).join(" ")}>
                <td className="gutter" onClick={() => onSelectInsert(insert.id, selectedCell?.column ?? 0)}>
                    +
                </td>
                {columns.map((column, c) => (
                    <InsertCell
                        key={column.name}
                        insert={insert}
                        column={column}
                        selected={rowSelected && selectedCell.column === c}
                        editing={editing && editing.kind === "insert" && editing.insertId === insert.id && editing.column === column.name}
                        onSelect={() => onSelectInsert(insert.id, c)}
                        onOpenEditor={() => { if (!mutationLocked) onEdit({ kind: "insert", insertId: insert.id, column: column.name }); }}
                        onCommit={(next) => onCommit(insert, column, next)}
                        onCancel={() => onEdit(null)}
                    />
                ))}
            </tr>
        );
    });
}
