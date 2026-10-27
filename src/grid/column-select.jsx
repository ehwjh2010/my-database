import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import {
    columnSelectLabel,
    isAllColumns,
    selectedColumnNames,
    selectVisibleRange,
    toggleVisibleColumn,
} from "./column-visibility.js";

export function ColumnSelect({ columns, value, onChange }) {
    const listId = useId();
    const root = useRef(null);
    const anchor = useRef(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const names = columns.map((column) => column.name);
    const selected = new Set(selectedColumnNames(columns, value));
    const all = isAllColumns(value) || selected.size === names.length;
    const items = [null, ...names];

    useEffect(() => {
        if (!open)
            return;
        const close = (event) => {
            if (!root.current?.contains(event.target))
                setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [open]);

    const pick = (name, shift) => {
        if (name === null) {
            onChange(null);
            anchor.current = null;
            return;
        }
        if (shift && anchor.current)
            onChange(selectVisibleRange(columns, anchor.current, name));
        else
            onChange(toggleVisibleColumn(columns, value, name));
        anchor.current = name;
    };

    const onKeyDown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
        }
        if (!open && (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setOpen(true);
            setActive(0);
            return;
        }
        if (!open)
            return;
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => (index + 1) % items.length);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => (index - 1 + items.length) % items.length);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            pick(items[active], event.shiftKey);
        }
    };

    return (
        <div ref={root} className="field-complete" onKeyDown={onKeyDown}>
            <span className="field-complete-label" aria-hidden="true">COLUMNS</span>
            <button
                type="button"
                className={["mono search-bar-input column-select-value", all ? "is-all" : ""].filter(Boolean).join(" ")}
                role="combobox"
                aria-label="COLUMNS"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-haspopup="listbox"
                onClick={() => setOpen((current) => !current)}
            >
                {columnSelectLabel(columns, value)}
            </button>
            {open ? (
                <div id={listId} className="field-complete-list column-select-list" role="listbox" aria-multiselectable="true">
                    {items.map((name, index) => {
                        const isAll = name === null;
                        const isSelected = isAll ? all : !all && selected.has(name);
                        return (
                            <button
                                key={isAll ? "__all" : name}
                                type="button"
                                role="option"
                                tabIndex={-1}
                                aria-selected={isSelected}
                                className={[index === active ? "active" : "", isSelected ? "is-selected" : ""].filter(Boolean).join(" ") || undefined}
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    pick(name, event.shiftKey);
                                }}
                            >
                                <span>{isAll ? "All" : name}</span>
                                <span>{isSelected ? <Icon name="check" size={12} /> : null}</span>
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
