import { createPortal } from "react-dom";
import { Icon } from "./icon.jsx";

const SIZES = { sm: "sheet-sm", lg: "sheet-lg", xl: "sheet-xl" };

export function Modal({ icon, title, size, onClose, footer, headerActions, children, closable = true }) {
    return createPortal(
        <div className="backdrop" onMouseDown={(e) => { if (closable && e.target === e.currentTarget) onClose(); }}>
            <div className={`sheet ${SIZES[size] || ""}`}>
                <div
                    className="flex items-center gap-[var(--s4)] border-b px-[var(--s7)] py-[var(--s5)] text-[var(--font-title)] font-semibold"
                    style={{ borderColor: "var(--muxy-border)" }}
                >
                    {icon ? <Icon name={icon} /> : null}
                    {title}
                    <div className="flex-1" />
                    {headerActions}
                    {closable ? (
                        <button className="icon-btn" onClick={onClose}>
                            <Icon name="x" />
                        </button>
                    ) : null}
                </div>
                {children}
                {footer ? <div className="sheet-footer">{footer}</div> : null}
            </div>
        </div>,
        document.body,
    );
}
