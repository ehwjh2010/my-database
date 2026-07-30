import { useRef, useState } from "react";

const MIN_WIDTH = 120;
const SEPARATOR_WIDTH = 9;

function clampRatio(element, value) {
    const available = Math.max(1, element.clientWidth - SEPARATOR_WIDTH);
    const minimum = Math.min(50, MIN_WIDTH / available * 100);
    return Math.max(minimum, Math.min(100 - minimum, value));
}

export function FilterBar({ rawWhere, rawOrderBy, initialRatio, onWhereChange, onOrderByChange, onApply, onRatioChange }) {
    const bar = useRef(null);
    const dragging = useRef(false);
    const ratioValue = useRef(initialRatio);
    const [ratio, setRatio] = useState(initialRatio);

    const updateRatio = (value) => {
        const next = clampRatio(bar.current, value);
        ratioValue.current = next;
        setRatio(next);
        return next;
    };
    const resize = (clientX) => {
        const bounds = bar.current.getBoundingClientRect();
        const available = bounds.width - SEPARATOR_WIDTH;
        updateRatio((clientX - bounds.left - SEPARATOR_WIDTH / 2) / available * 100);
    };
    const finishResize = (event) => {
        if (!dragging.current)
            return;
        if (event.type === "pointerup")
            resize(event.clientX);
        dragging.current = false;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        onRatioChange(ratioValue.current);
    };
    const submitOnEnter = (event) => {
        if (event.key === "Enter")
            onApply();
    };

    return (
        <div
            ref={bar}
            className="search-bar data-query-bar"
            style={{ gridTemplateColumns: `minmax(${MIN_WIDTH}px, ${ratio}fr) ${SEPARATOR_WIDTH}px minmax(${MIN_WIDTH}px, ${100 - ratio}fr)` }}
        >
            <input
                type="text"
                className="mono search-bar-input"
                aria-label="WHERE"
                placeholder="WHERE"
                value={rawWhere}
                onChange={(event) => onWhereChange(event.target.value)}
                onKeyDown={submitOnEnter}
            />
            <div
                className="query-separator"
                role="separator"
                aria-label="Resize WHERE and ORDER BY"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ratio)}
                tabIndex={0}
                onPointerDown={(event) => {
                    dragging.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    resize(event.clientX);
                }}
                onPointerMove={(event) => { if (dragging.current) resize(event.clientX); }}
                onPointerUp={finishResize}
                onPointerCancel={finishResize}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                        return;
                    event.preventDefault();
                    onRatioChange(updateRatio(ratioValue.current + (event.key === "ArrowLeft" ? -2 : 2)));
                }}
            />
            <input
                type="text"
                className="mono search-bar-input"
                aria-label="ORDER BY"
                placeholder="ORDER BY"
                value={rawOrderBy}
                onChange={(event) => onOrderByChange(event.target.value)}
                onKeyDown={submitOnEnter}
            />
        </div>
    );
}
