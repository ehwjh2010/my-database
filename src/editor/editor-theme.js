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
            { tag: tags.keyword, color: "var(--muxy-accent)", fontWeight: "600" },
            { tag: tags.string, color: "var(--muxy-diff-add)" },
            { tag: [tags.number, tags.bool, tags.null], color: "var(--muxy-diff-hunk)" },
            { tag: tags.comment, color: "var(--muxy-foreground-muted)", fontStyle: "italic" },
            { tag: tags.operator, color: "var(--muxy-foreground)" },
            { tag: [tags.typeName, tags.className], color: "var(--muxy-diff-remove)" },
            { tag: tags.propertyName, color: "var(--muxy-foreground)" },
        ])),
    ];
}
