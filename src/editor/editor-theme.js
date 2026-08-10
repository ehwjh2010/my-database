import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export function muxyTheme() {
    return [
        EditorView.theme({
            "&": { backgroundColor: "var(--muxy-background)", color: "var(--muxy-foreground)", height: "100%" },
            ".cm-content": { caretColor: "var(--muxy-accent)", fontFamily: "var(--font-mono)", fontSize: "var(--font-body)" },
            ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--muxy-accent)" },
            ".cm-gutters": {
                backgroundColor: "var(--muxy-background)",
                color: "var(--muxy-foreground-muted)",
                border: "none",
                borderRight: "1px solid var(--muxy-border)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-footnote)",
            },
            ".cm-gutter.cm-execution-gutter": { minWidth: "2rem" },
            ".cm-execution-marker": { display: "block", width: "2rem", textAlign: "center", fontSize: "1.375rem", lineHeight: "1.25rem", fontWeight: "800" },
            ".cm-execution-running": { color: "var(--muxy-accent)" },
            ".cm-execution-success": { color: "var(--muxy-diff-add)" },
            ".cm-execution-error": { color: "var(--muxy-diff-remove)" },
            ".cm-sql-error": { textDecoration: "underline wavy var(--muxy-diff-remove)", textDecorationThickness: "1px", textUnderlineOffset: "2px" },
            ".cm-sql-table-name, .cm-sql-table-name *": { color: "light-dark(#000000, #A9B7C6) !important" },
            ".cm-sql-column-name, .cm-sql-column-name *": { color: "light-dark(#660E7A, #9876AA) !important" },
            ".cm-sql-current-statement": { pointerEvents: "none", border: "1px solid var(--muxy-diff-add)", backgroundColor: "color-mix(in srgb, var(--muxy-diff-add) 4%, transparent)" },
            ".cm-activeLine": { backgroundColor: "var(--muxy-hover)" },
            ".cm-activeLineGutter": { backgroundColor: "var(--muxy-hover)" },
            "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
                backgroundColor: "color-mix(in srgb, var(--muxy-accent) 15%, var(--muxy-background))",
            },
            ".cm-selectionMatch": { backgroundColor: "var(--muxy-accent-soft)" },
            ".cm-tooltip": {
                backgroundColor: "var(--muxy-surface)",
                border: "1px solid var(--muxy-border)",
                color: "var(--muxy-foreground)",
            },
            ".cm-tooltip-autocomplete ul li[aria-selected]": {
                backgroundColor: "var(--muxy-accent-soft)",
                color: "var(--muxy-foreground)",
            },
            ".cm-panels": { backgroundColor: "var(--muxy-surface)", color: "var(--muxy-foreground)" },
            ".cm-panels input, .cm-panels button": { fontSize: "var(--font-body)" },
        }),
        syntaxHighlighting(HighlightStyle.define([
            { tag: tags.keyword, color: "light-dark(#000080, #CC7832)", fontWeight: "600" },
            { tag: [tags.string, tags.special(tags.string)], color: "#6A8759" },
            { tag: [tags.number, tags.bool, tags.null], color: "#6897BB" },
            { tag: tags.comment, color: "#808080", fontStyle: "italic" },
            { tag: tags.operator, color: "#A9B7C6" },
            { tag: [tags.typeName, tags.className], color: "#FFC66D" },
            { tag: [tags.name, tags.variableName, tags.labelName], color: "#D7DAE0" },
        ])),
    ];
}
