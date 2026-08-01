import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { Annotation, EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, PostgreSQL, MySQL, MariaSQL, SQLite } from "@codemirror/lang-sql";
import { acceptCompletion, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, pickedCompletion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { muxyTheme } from "./editor-theme.js";

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, mariadb: MariaSQL, sqlite: SQLite };
const syncedDocument = Annotation.define();
const completionSpacing = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.annotation(pickedCompletion))
        return transaction;
    const cursor = transaction.newSelection.main.head;
    const hasSpace = transaction.newDoc.sliceString(cursor, cursor + 1) === " ";
    return [transaction, { changes: hasSpace ? undefined : { from: cursor, insert: " " }, selection: { anchor: cursor + 1 }, sequential: true }];
});

export function createSqlEditor(parent, { engine, doc = "", schema = {}, onRun, onDocChange }) {
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                history(),
                drawSelection(),
                highlightActiveLine(),
                highlightSelectionMatches(),
                closeBrackets(),
                autocompletion(),
                completionSpacing,
                keymap.of([
                    { key: "Mod-Enter", run: () => (onRun ? (onRun(), true) : false) },
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                    ...completionKeymap,
                    { key: "Tab", run: acceptCompletion },
                    indentWithTab,
                ]),
                sql({ dialect: DIALECTS[engine] || SQLite, schema, upperCaseKeywords: true }),
                muxyTheme(),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && onDocChange && !update.transactions.some((transaction) => transaction.annotation(syncedDocument)))
                        onDocChange(update.state.doc.toString());
                }),
            ],
        }),
    });
    return view;
}

export function syncSqlEditorDocument(view, doc) {
    if (!view || view.state.doc.toString() === doc)
        return false;
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        annotations: syncedDocument.of(true),
    });
    return true;
}

export function selectedSql(view) {
    const range = view.state.selection.main;
    if (!range.empty)
        return view.state.sliceDoc(range.from, range.to);
    return null;
}

export function insertSql(view, text) {
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
    });
    view.focus();
}
