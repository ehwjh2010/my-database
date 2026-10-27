import { useRef } from "react";
import { Icon } from "./icon.jsx";
import { filterEscapeAction } from "./clearable-input.js";

export function ClearableInput({ value, onChange, placeholder, className }) {
    const input = useRef(null);
    return (
        <>
            <input
                ref={input}
                type="text"
                placeholder={placeholder}
                className={className}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key !== "Escape")
                        return;
                    event.preventDefault();
                    if (filterEscapeAction(value) === "clear")
                        onChange("");
                    else
                        input.current?.blur();
                }}
            />
            {value ? (
                <button
                    type="button"
                    className="icon-btn"
                    title="Clear filter"
                    aria-label="Clear filter"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                        onChange("");
                        input.current?.focus();
                    }}
                >
                    <Icon name="x" />
                </button>
            ) : null}
        </>
    );
}
