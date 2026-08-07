import { useRef, useState } from "react";
import { nextCaretPosition } from "./caret.js";

export function editorKind(type) {
    const t = (type || "").toLowerCase();
    if (/bool|tinyint\(1\)/.test(t))
        return "bool";
    if (/int|serial|numeric|decimal|real|double|float|money/.test(t))
        return "number";
    return "text";
}

function BoolEditor({ value, onCommit, onCancel }) {
    const selected = value === null ? " null" : /^(1|t|true)$/i.test(String(value)) ? "true" : "false";
    return (
        <select
            autoFocus
            defaultValue={selected}
            onChange={(e) => onCommit(e.target.value === " null" ? null : e.target.value === "true")}
            onBlur={onCancel}
            onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        >
            <option value="true">true</option>
            <option value="false">false</option>
        </select>
    );
}

function TextEditor({ value, onCommit, onCancel }) {
    const [text, setText] = useState(value === null ? "" : String(value));
    const changed = useRef(false);
    const commit = () => onCommit(changed.current ? text : undefined);
    return (
        <div className="grid-cell-editor">
            <input
                type="text"
                className="mono"
                autoFocus
                value={text}
                onFocus={(e) => e.target.select()}
                onChange={(e) => {
                    changed.current = true;
                    setText(e.target.value);
                }}
                onKeyDown={(e) => {
                    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        const direction = e.key === "ArrowLeft" ? -1 : 1;
                        const position = nextCaretPosition(e.currentTarget.value, e.currentTarget.selectionStart, e.currentTarget.selectionEnd, direction);
                        e.currentTarget.setSelectionRange(position, position);
                    } else if (e.key === "Enter") {
                        e.preventDefault();
                        commit();
                    } else if (e.key === "Escape") {
                        onCancel();
                    }
                }}
                onBlur={commit}
            />
        </div>
    );
}

export function CellEditor({ type, value, onCommit, onCancel }) {
    if (editorKind(type) === "bool")
        return <BoolEditor value={value} onCommit={onCommit} onCancel={onCancel} />;
    return <TextEditor value={value} onCommit={onCommit} onCancel={onCancel} />;
}
