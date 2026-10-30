import { selectAll } from "@codemirror/commands";
import { ViewPlugin, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";

export const SELECT_ALL_EVENT = "muxy-select-all";

export function isSelectAllShortcut(event) {
    return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && (event.key === "a" || event.key === "A");
}

export function selectEntireDocument(view) {
    return selectAll(view);
}

export function editorSelectAll() {
    return [
        Prec.high(keymap.of([{ key: "Mod-a", run: selectAll, preventDefault: true, stopPropagation: true }])),
        ViewPlugin.define((view) => {
            const onHostSelectAll = (event) => {
                event.preventDefault();
                event.stopPropagation();
                selectAll(view);
            };
            view.dom.addEventListener(SELECT_ALL_EVENT, onHostSelectAll);
            return {
                destroy() {
                    view.dom.removeEventListener(SELECT_ALL_EVENT, onHostSelectAll);
                },
            };
        }),
    ];
}
