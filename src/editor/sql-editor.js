import { Decoration, EditorView, GutterMarker, RectangleMarker, gutter, keymap, layer, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { Annotation, Compartment, EditorSelection, EditorState, RangeSet, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { sql, PostgreSQL, MySQL, MariaSQL, SQLite } from "@codemirror/lang-sql";
import { acceptCompletion, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, insertBracket, pickedCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { isSqlBracketKey } from "../lib/sql-brackets.js";
import { muxyTheme } from "./editor-theme.js";
import { sqlPhraseCompletionSource } from "./sql-completion.js";

const DIALECTS = { postgres: PostgreSQL, mysql: MySQL, mariadb: MariaSQL, sqlite: SQLite };
const sqlSchemaCompartments = new WeakMap();
const structuralKeywords = new Set(["all", "and", "as", "asc", "between", "by", "case", "create", "delete", "desc", "distinct", "drop", "else", "end", "except", "exists", "fetch", "for", "from", "full", "group", "having", "in", "inner", "insert", "intersect", "into", "is", "join", "left", "like", "limit", "not", "null", "offset", "on", "or", "order", "outer", "right", "select", "set", "table", "then", "union", "update", "values", "when", "where"]);
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

function identifierKey(text) {
    const quoted = (text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("`") && text.endsWith("`")) || (text.startsWith("[") && text.endsWith("]"));
    return (quoted ? text.slice(1, -1) : text).toLowerCase();
}

function semanticNames(schema) {
    const tables = new Set();
    const columns = new Set();
    for (const [table, fields] of Object.entries(schema)) {
        tables.add(identifierKey(table));
        for (const field of fields)
            columns.add(identifierKey(field));
    }
    return { tables, columns };
}

export function semanticSqlIdentifiers(state, schema) {
    const { tables, columns } = semanticNames(schema);
    const identifiers = [];
    syntaxTree(state).iterate({
        enter(node) {
            if (node.name !== "Identifier" && node.name !== "QuotedIdentifier" && node.name !== "Keyword")
                return;
            const key = identifierKey(state.sliceDoc(node.from, node.to));
            const kind = tables.has(key) && (node.name !== "Keyword" || !columns.has(key)) ? "table" : columns.has(key) && !structuralKeywords.has(key) ? "column" : null;
            if (kind)
                identifiers.push({ from: node.from, to: node.to, kind });
        },
    });
    return identifiers;
}

function semanticDecorations(schema) {
    return EditorView.decorations.of((view) => {
        const ranges = semanticSqlIdentifiers(view.state, schema).map(({ from, to, kind }) => Decoration.mark({ class: `cm-sql-${kind}-name` }).range(from, to));
        return ranges.length ? Decoration.set(ranges, true) : Decoration.none;
    });
}

function sqlExtensions(engine, schema) {
    const dialectKey = DIALECTS[engine] ? engine : "sqlite";
    const dialect = DIALECTS[dialectKey];
    return [
        sql({ dialect, schema, upperCaseKeywords: true }),
        dialect.language.data.of({ autocomplete: sqlPhraseCompletionSource(dialectKey) }),
        semanticDecorations(schema),
    ];
}

function sameSchema(left, right) {
    const leftEntries = Object.entries(left);
    const rightEntries = Object.entries(right);
    if (leftEntries.length !== rightEntries.length)
        return false;
    const rightTables = new Map(rightEntries);
    return leftEntries.every(([table, fields]) => {
        const other = rightTables.get(table);
        return other && fields.length === other.length && fields.every((field, index) => field === other[index]);
    });
}

const completionSpacing = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.annotation(pickedCompletion))
        return transaction;
    const cursor = transaction.newSelection.main.head;
    const hasSpace = transaction.newDoc.sliceString(cursor, cursor + 1) === " ";
    return [transaction, { changes: hasSpace ? undefined : { from: cursor, insert: " " }, selection: { anchor: cursor + 1 }, sequential: true }];
});

const sqlBracketKeydown = EditorView.domEventHandlers({
    keydown(event, view) {
        if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || !isSqlBracketKey(event.key))
            return false;
        const transaction = insertBracket(view.state, event.key);
        if (!transaction)
            return false;
        view.dispatch(transaction);
        return true;
    },
});

export function sqlStatementAt(state, pos) {
    if (pos == null || !state.doc.length)
        return null;
    const tree = syntaxTree(state);
    const candidates = [pos, pos - 1, pos + 1].filter((offset, index, values) => offset >= 0 && offset < state.doc.length && values.indexOf(offset) === index);
    for (const offset of candidates) {
        let node = tree.resolveInner(offset, -1);
        while (node && node.name !== "Statement")
            node = node.parent;
        if (!node)
            continue;
        const terminator = node.lastChild?.name === ";" ? node.lastChild.from : node.to;
        if (terminator > node.from)
            return { from: node.from, to: terminator };
    }
    return null;
}

const currentStatementBox = layer({
    above: true,
    update(update) {
        return update.docChanged || update.selectionSet;
    },
    markers(view) {
        const statement = sqlStatementAt(view.state, view.state.selection.main.head);
        if (!statement)
            return [];
        const firstLine = view.state.doc.lineAt(statement.from).number;
        const lastLine = view.state.doc.lineAt(Math.max(statement.from, statement.to - 1)).number;
        const pieces = [];
        for (let number = firstLine; number <= lastLine; number += 1) {
            const line = view.state.doc.line(number);
            const from = number === firstLine ? statement.from : line.from;
            const to = number === lastLine ? statement.to : line.to;
            if (to > from)
                pieces.push(...RectangleMarker.forRange(view, "", EditorSelection.range(from, to)));
        }
        if (!pieces.length)
            return [];
        const left = Math.min(...pieces.map((piece) => piece.left));
        const top = Math.min(...pieces.map((piece) => piece.top));
        const right = Math.max(...pieces.map((piece) => piece.left + (piece.width || 0)));
        const bottom = Math.max(...pieces.map((piece) => piece.top + piece.height));
        const padding = 2;
        return [new RectangleMarker("cm-sql-current-statement", left - padding, top - padding, right - left + padding * 2, bottom - top + padding * 2)];
    },
});

export function createSqlEditor(parent, { engine, doc = "", schema = {}, executionMarker, onRun, onDocChange }) {
    const schemaCompartment = new Compartment();
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
                sqlBracketKeydown,
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
                schemaCompartment.of(sqlExtensions(engine, schema)),
                muxyTheme(),
                currentStatementBox,
                EditorView.updateListener.of((update) => {
                    if (update.docChanged && onDocChange && !update.transactions.some((transaction) => transaction.annotation(syncedDocument)))
                        onDocChange(update.state.doc.toString());
                }),
            ],
        }),
    });
    sqlSchemaCompartments.set(view, { compartment: schemaCompartment, engine, schema });
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

export function updateSqlEditorSchema(view, engine, schema) {
    const current = view ? sqlSchemaCompartments.get(view) : null;
    if (!current || (current.engine === engine && sameSchema(current.schema, schema)))
        return false;
    view.dispatch({ effects: current.compartment.reconfigure(sqlExtensions(engine, schema)) });
    current.engine = engine;
    current.schema = schema;
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
