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
    const current = queryExecution(view, engine);
    if (!current.sql)
        return { kind: "none" };
    if (selection.empty)
        return { kind: "run", execution: current };
    const statements = splitForEngine(view.state.doc.toString(), engine)
        .filter((statement) => statement.from < selection.to && statement.to > selection.from);
    if (statements.length <= 1)
        return { kind: "run", execution: current };
    return {
        kind: "choose",
        statements: statements.map((statement) => ({
            label: statementPreview(statement.sql),
            execution: sqlRangeExecution(view, engine, statement.from, statement.to, false),
        })),
        all: {
            label: `Execute selection (${statements.length} statements)`,
            execution: sqlRangeExecution(view, engine, selection.from, selection.to, true),
        },
    };
}
