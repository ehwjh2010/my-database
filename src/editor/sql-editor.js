import { Decoration, EditorView, GutterMarker, gutter, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { Annotation, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, PostgreSQL, MySQL, MariaSQL, SQLite } from "@codemirror/lang-sql";
import { acceptCompletion, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, pickedCompletion } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { muxyTheme } from "./editor-theme.js";

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, mariadb: MariaSQL, sqlite: SQLite };
const syncedDocument = Annotation.define();
const executionMarkerEffect = StateEffect.define();
const executionDiagnosticEffect = StateEffect.define();
const executionMarkerField = StateField.define({
    create: () => null,
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(executionMarkerEffect))
                return effect.value;
        }
        return value;
    },
});
const executionDiagnosticField = StateField.define({
    create: () => null,
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(executionDiagnosticEffect))
                return effect.value;
        }
        return value;
    },
});

class ExecutionMarker extends GutterMarker {
    constructor(status) {
        super();
        this.status = status;
    }

    eq(other) {
        return other.status === this.status;
    }

    toDOM() {
        const marker = document.createElement("span");
        const labels = { running: "Query running", success: "Query succeeded", error: "Query failed" };
        marker.className = `cm-execution-marker cm-execution-${this.status}`;
        marker.textContent = this.status === "success" ? "\u2713" : this.status === "error" ? "!" : "\u2026";
        marker.title = labels[this.status];
        marker.setAttribute("aria-label", labels[this.status]);
        marker.setAttribute("role", "img");
        return marker;
    }
}

const executionGutter = gutter({
    class: "cm-execution-gutter",
    renderEmptyElements: true,
    initialSpacer: () => new ExecutionMarker("success"),
    markers: (view) => {
        const marker = view.state.field(executionMarkerField);
        if (!marker)
            return RangeSet.empty;
        const line = view.state.doc.line(Math.min(Math.max(marker.line, 1), view.state.doc.lines));
        return RangeSet.of([new ExecutionMarker(marker.status).range(line.from)]);
    },
});

const executionDecorations = EditorView.decorations.of((view) => {
    const diagnostic = view.state.field(executionDiagnosticField);
    if (!diagnostic)
        return Decoration.none;
    const from = Math.min(Math.max(diagnostic.from, 0), view.state.doc.length);
    const to = Math.min(Math.max(diagnostic.to, from), view.state.doc.length);
    if (from === to)
        return Decoration.none;
    return Decoration.set([Decoration.mark({ class: "cm-sql-error", attributes: { title: diagnostic.message, "aria-label": diagnostic.message } }).range(from, to)]);
});
const completionSpacing = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.annotation(pickedCompletion))
        return transaction;
    const cursor = transaction.newSelection.main.head;
    const hasSpace = transaction.newDoc.sliceString(cursor, cursor + 1) === " ";
    return [transaction, { changes: hasSpace ? undefined : { from: cursor, insert: " " }, selection: { anchor: cursor + 1 }, sequential: true }];
});

export function createSqlEditor(parent, { engine, doc = "", schema = {}, executionMarker, onRun, onDocChange }) {
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [
                executionMarkerField,
                executionDiagnosticField,
                executionDecorations,
                executionGutter,
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
    updateSqlEditorExecution(view, executionMarker);
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

export function querySql(view) {
    return selectedSql(view)?.trim() || view.state.doc.toString().trim();
}

function firstSqlOffset(sql, engine) {
    let offset = 0;
    while (offset < sql.length) {
        if (/\s/.test(sql[offset])) {
            offset += 1;
            continue;
        }
        if (sql.startsWith("--", offset) || ((engine === "mysql" || engine === "mariadb") && sql[offset] === "#")) {
            const nextLine = sql.indexOf("\n", offset);
            offset = nextLine < 0 ? sql.length : nextLine + 1;
            continue;
        }
        if (sql.startsWith("/*", offset)) {
            const end = sql.indexOf("*/", offset + 2);
            if (end < 0)
                return offset;
            offset = end + 2;
            continue;
        }
        return offset;
    }
    return 0;
}

export function queryExecution(view, engine) {
    const selection = view.state.selection.main;
    const selected = !selection.empty;
    const from = selected ? selection.from : 0;
    const text = selected ? view.state.sliceDoc(selection.from, selection.to) : view.state.doc.toString();
    const leading = text.length - text.trimStart().length;
    const sql = text.trim();
    const documentOffset = from + leading;
    const markerOffset = selected ? selection.from : documentOffset + firstSqlOffset(sql, engine);
    return { sql, range: { line: view.state.doc.lineAt(markerOffset).number, from: documentOffset } };
}

function sameMarker(left, right) {
    return left?.line === right?.line && left?.status === right?.status;
}

function sameDiagnostic(left, right) {
    return left?.from === right?.from && left?.to === right?.to && left?.message === right?.message;
}

export function updateSqlEditorExecution(view, marker) {
    if (!view)
        return false;
    const nextMarker = marker ? { line: marker.line, status: marker.status } : null;
    const nextDiagnostic = marker?.diagnostic || null;
    const currentMarker = view.state.field(executionMarkerField);
    const currentDiagnostic = view.state.field(executionDiagnosticField);
    if (sameMarker(currentMarker, nextMarker) && sameDiagnostic(currentDiagnostic, nextDiagnostic))
        return false;
    view.dispatch({ effects: [executionMarkerEffect.of(nextMarker), executionDiagnosticEffect.of(nextDiagnostic)] });
    return true;
}

export function insertSql(view, text) {
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
    });
    view.focus();
}
