import { useRef, useState } from "react";
import { clampResultsHeight, DEFAULT_RESULTS_RATIO, defaultResultsHeight, MIN_EDITOR_HEIGHT, MIN_RESULTS_HEIGHT, resultsHeightFromPointer } from "./results-height.js";

export function ResultsPane({ hostRef, heightRef, children }) {
    const dragging = useRef(false);
    const [height, setHeight] = useState(() => heightRef?.current ?? null);

    const hostBounds = () => hostRef.current.getBoundingClientRect();

    const apply = (value) => {
        const next = clampResultsHeight(hostBounds().height, value);
        if (heightRef)
            heightRef.current = next;
        setHeight(next);
        return next;
    };

    const resize = (clientY) => {
        const bounds = hostBounds();
        apply(resultsHeightFromPointer(bounds.height, bounds.bottom, clientY));
    };

    return (
        <div
            className="results-pane absolute inset-x-0 bottom-0 z-10 flex flex-col overflow-hidden rounded-t-[var(--radius-card)] border border-b-0 bg-background"
            style={{ height: height == null ? `${DEFAULT_RESULTS_RATIO * 100}%` : `${height}px`, borderColor: "var(--muxy-border)" }}
        >
            <div
                className="results-resizer"
                role="separator"
                aria-label="Resize results"
                aria-orientation="horizontal"
                aria-valuemin={MIN_RESULTS_HEIGHT}
                aria-valuemax={Math.max(MIN_RESULTS_HEIGHT, Math.round((hostRef.current?.getBoundingClientRect().height || 0) - MIN_EDITOR_HEIGHT))}
                aria-valuenow={height == null ? undefined : height}
                tabIndex={0}
                onDoubleClick={() => apply(defaultResultsHeight(hostBounds().height))}
                onPointerDown={(event) => {
                    dragging.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    resize(event.clientY);
                }}
                onPointerMove={(event) => {
                    if (dragging.current)
                        resize(event.clientY);
                }}
                onPointerUp={(event) => {
                    dragging.current = false;
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
                        event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => { dragging.current = false; }}
                onKeyDown={(event) => {
                    if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
                        return;
                    event.preventDefault();
                    const current = height ?? defaultResultsHeight(hostBounds().height);
                    apply(current + (event.key === "ArrowUp" ? 16 : -16));
                }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
