import { splitForEngine } from "../lib/sql/statement-split.js";
import { queryExecution, sqlRangeExecution } from "./sql-editor.js";

export function statementPreview(sql, max = 56) {
    const line = sql.trim().replace(/\s+/g, " ");
    if (!line)
        return sql;
    return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

export function queryExecuteIntent(view, engine) {
    const selection = view.state.selection.main;
    if (!selection.empty) {
        const execution = queryExecution(view, engine);
        return execution.sql ? { kind: "run", execution } : { kind: "none" };
    }
    const current = queryExecution(view, engine);
    if (!current.sql)
        return { kind: "none" };
    const statements = splitForEngine(view.state.doc.toString(), engine);
    if (statements.length <= 1)
        return { kind: "run", execution: current };
    const caret = selection.head;
    return {
        kind: "choose",
        statements: statements.map((statement) => ({
            label: statementPreview(statement.sql),
            current: caret >= statement.from && caret <= statement.to + 1,
            execution: sqlRangeExecution(view, engine, statement.from, statement.to, false),
        })),
        all: {
            label: `Execute all ${statements.length} statements`,
            execution: sqlRangeExecution(view, engine, 0, view.state.doc.length, true),
        },
    };
}
