export const SELECTABLE = "input, textarea, select, .cm-editor, pre, .error-box, .editing";

export function isEditableClipboardTarget(target) {
    return Boolean(target?.closest?.(SELECTABLE));
}

export function suppressNativeContextMenu() {
    document.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        if (isEditableClipboardTarget(event.target))
            return;
        window.getSelection()?.removeAllRanges();
    });
}
