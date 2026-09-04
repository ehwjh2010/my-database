import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function selectableIndexes(items) {
    return items.reduce((list, item, index) => (item.separator || !item.onClick ? list : [...list, index]), []);
}

export function ContextMenu({ x, y, items, onClose }) {
    const menuRef = useRef(null);
    const highlightRef = useRef(0);
    const itemsRef = useRef(items);
    const onCloseRef = useRef(onClose);
    const [pos, setPos] = useState({ left: x, top: y, visible: false });
    const [highlight, setHighlight] = useState(() => selectableIndexes(items)[0] ?? -1);
    itemsRef.current = items;
    onCloseRef.current = onClose;
    highlightRef.current = highlight;

    useLayoutEffect(() => {
        const rect = menuRef.current.getBoundingClientRect();
        let left = x;
        let top = y;
        if (left + rect.width > window.innerWidth)
            left = window.innerWidth - rect.width - 8;
        if (top + rect.height > window.innerHeight)
            top = window.innerHeight - rect.height - 8;
        setPos({ left, top, visible: true });
    }, [x, y]);

    useLayoutEffect(() => {
        const onDown = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target))
                onCloseRef.current();
        };
        const onKeyDown = (event) => {
            const list = selectableIndexes(itemsRef.current);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!list.length)
                    return;
                event.preventDefault();
                event.stopPropagation();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setHighlight((current) => {
                    const at = list.indexOf(current);
                    return list[at === -1 ? 0 : (at + step + list.length) % list.length];
                });
                return;
            }
            if (event.key === "Enter") {
                const item = itemsRef.current[highlightRef.current];
                if (!item?.onClick)
                    return;
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
                item.onClick();
                return;
            }
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current();
            }
        };
        window.addEventListener("mousedown", onDown);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("scroll", onClose, { capture: true });
        return () => {
            window.removeEventListener("mousedown", onDown);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("scroll", onClose, { capture: true });
        };
    }, [onClose]);

    return createPortal(
        <div
            ref={menuRef}
            className="menu"
            style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                zIndex: 60,
                visibility: pos.visible ? "visible" : "hidden",
            }}
        >
            {items.map((item, index) =>
                item.separator ? (
                    <div key={index} style={{ height: "1px", margin: "var(--s2) 0", background: "var(--muxy-border)" }} />
                ) : (
                    <button
                        key={index}
                        className={`tree-row w-full text-left${item.danger ? " btn-danger" : ""}${index === highlight ? " menu-item-active" : ""}`}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => {
                            onClose();
                            item.onClick();
                        }}
                    >
                        {item.label}
                    </button>
                ),
            )}
        </div>,
        document.body,
    );
}
