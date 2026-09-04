import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, SearchQuery, search, setSearchQuery } from "@codemirror/search";
import { MariaSQL, MySQL, PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { muxyTheme } from "../editor/editor-theme.js";
import { matchRanges } from "./structure-search.js";

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, mariadb: MariaSQL, sqlite: SQLite };

export function createDdlEditor(parent, { engine, doc = "" }) {
    return new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [
                EditorState.readOnly.of(true),
                lineNumbers(),
                drawSelection(),
                highlightSelectionMatches(),
                search(),
                keymap.of(defaultKeymap),
                sql({ dialect: DIALECTS[engine] || SQLite }),
                muxyTheme(),
                EditorView.theme({
                    "&": { height: "auto", backgroundColor: "transparent" },
                    ".cm-scroller": { overflow: "visible" },
                    ".cm-gutters": { backgroundColor: "transparent" },
                    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--muxy-accent) 28%, transparent)" },
                    ".cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--muxy-accent) 55%, transparent)" },
                }),
            ],
        }),
    });
}

export function applyDdlSearch(view, query) {
    if (!view)
        return;
    view.dispatch({
        effects: setSearchQuery.of(new SearchQuery({ search: query || "", caseSensitive: false, literal: true })),
    });
}

export function revealDdlMatch(view, query, index) {
    const range = matchRanges(view?.state.doc.toString() || "", query)[index];
    if (!view || !range)
        return;
    view.dispatch({
        selection: EditorSelection.range(range.from, range.to),
        scrollIntoView: true,
    });
}
