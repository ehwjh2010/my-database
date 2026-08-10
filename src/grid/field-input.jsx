import { useEffect, useId, useRef, useState } from "react";
import { columnCompletions, completionKeyAction, insertColumn, sqlCompletionItems } from "./field-completion.js";

export function FieldInput({ label, value, columns, engine, onChange, onApply }) {
    const input = useRef(null);
    const listId = useId();
    const [completion, setCompletion] = useState(null);
    const [active, setActive] = useState(0);
    const open = !!completion?.matches.length;

    useEffect(() => setCompletion(null), [columns, engine]);

    const updateCompletion = (nextValue, cursor) => {
        const next = columnCompletions(nextValue, cursor, sqlCompletionItems(label, engine, columns));
        setCompletion(next.matches.length ? next : null);
        setActive(0);
    };
    const select = (column) => {
        const suffix = column.cursor ? "" : " ";
        const next = insertColumn(value, completion, column.name + suffix);
        const cursor = completion.start + (column.cursor ?? column.name.length + 1);
        onChange(next);
        setCompletion(null);
        requestAnimationFrame(() => {
            input.current?.focus();
            input.current?.setSelectionRange(cursor, cursor);
        });
    };
    const onKeyDown = (event) => {
        const action = completionKeyAction(event.key, open);
        if (!action)
            return;
        event.preventDefault();
        if (action === "apply") onApply();
        if (action === "close") setCompletion(null);
        if (action === "select") select(completion.matches[active]);
        if (action === "next") setActive((active + 1) % completion.matches.length);
        if (action === "previous") setActive((active - 1 + completion.matches.length) % completion.matches.length);
    };

    return (
        <div className="field-complete" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
                setCompletion(null);
        }}>
            <span className="field-complete-label" aria-hidden="true">{label}</span>
            <input
                ref={input}
                type="text"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="mono search-bar-input"
                role="combobox"
                aria-label={label}
                aria-autocomplete="list"
                aria-controls={open ? listId : undefined}
                aria-expanded={open}
                aria-activedescendant={open ? `${listId}-${active}` : undefined}
                value={value}
                onChange={(event) => {
                    onChange(event.target.value);
                    updateCompletion(event.target.value, event.target.selectionStart);
                }}
                onClick={(event) => updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart)}
                onKeyDown={onKeyDown}
                onKeyUp={(event) => {
                    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                        updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart);
                }}
            />
            {open ? (
                <div id={listId} className="field-complete-list" role="listbox">
                    {completion.matches.map((column, index) => (
                        <button
                            id={`${listId}-${index}`}
                            key={column.name}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={index === active}
                            className={index === active ? "active" : undefined}
                            onClick={() => select(column)}
                        >
                            <span>{column.name}</span>
                            <span>{column.type}</span>
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
