import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { appendHistory } from "../lib/storage.js";
import { statementAt } from "../lib/sql/statement-split.js";
import { selectedSql, insertSql } from "./sql-editor.js";
import { exportResult } from "../transfer/transfer.js";
import { SqlEditorView } from "./sql-editor-view.jsx";
import { Results } from "./results.jsx";
import { HistoryPanel } from "./history-panel.jsx";
import { SavedPanel } from "./saved-panel.jsx";
import { commitQueryError, commitQueryResult, isCurrentQueryRequest } from "../workbench/query-runtime.js";

export function schemaForCompletion(session) {
    const schema = {};
    for (const table of session.tables)
        schema[table.name] = session.columnsMap?.[table.name] || [];
    return schema;
}

export function QueryView({ session, workspaceId, setStatus, queryHooksRef }) {
    const editorRef = useRef(null);
    const [panel, setPanel] = useState(null);
    const [running, setRunning] = useState(false);
    const [historyToken, setHistoryToken] = useState(0);

    // Derive workspace state synchronously from session.queryState
    const entry = session.registry.byId[workspaceId];
    const key = entry?.key;
    const qs = key ? (session.queryState.get(key) || { sql: "", results: null, exportContext: null }) : { sql: "", results: null, exportContext: null };
    const [draft, setDraft] = useState(() => qs.sql);
    const [results, setResults] = useState(() => qs.results);

    // Sync local state when workspace changes (remount due to key={workspaceId})
    useEffect(() => {
        setDraft(qs.sql);
        setResults(qs.results);
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!entry || !key)
        return null;

    const currentStatement = () => {
        if (!editorRef.current) return "";
        const selection = selectedSql(editorRef.current);
        if (selection)
            return selection.trim();
        const offset = editorRef.current.state.selection.main.head;
        return statementAt(editorRef.current.state.doc.toString(), offset, session.conn.engine)?.sql || "";
    };

    const setDraftText = useCallback((sql) => {
        const store = session.queryState.get(key);
        if (store) store.sql = sql;
        setDraft(sql);
    }, [key, session]);

    const execute = useCallback(
        async (sql, mode) => {
            const isExplain = mode === "explain";
            const snapshot = session.coordinator.initiateQueryExecute(workspaceId, sql, mode);
            if (snapshot.error) {
                setStatus("Error");
                return;
            }
            setRunning(true);
            setStatus(isExplain ? "Explaining\u2026" : "Running\u2026");
            const started = Date.now();
            try {
            let data;
            try {
                data = isExplain
                    ? await session.driver.explain(snapshot.operationCtx, snapshot.sql, { timeoutMs: session.timeoutMs })
                    : await session.driver.runQuery(snapshot.operationCtx, snapshot.sql, { timeoutMs: session.timeoutMs });
            } catch (error) {
                if (!commitQueryError(session, snapshot, error.message))
                    return;
                if (session.registry.activeId === workspaceId) {
                    setResults(session.queryState.get(key).results);
                    setStatus("Error");
                }
                if (!isExplain && isCurrentQueryRequest(session, snapshot))
                    await appendHistory(session.conn.id, { id: String(started), sql: snapshot.sql.slice(0, 4096), startedAt: started, durationMs: Date.now() - started, ok: false });
                return;
            }
            if (!commitQueryResult(session, snapshot, data))
                return;
            const rows = data.reduce((sum, r) => sum + r.rows.length, 0);
            const duration = data.reduce((sum, r) => sum + (r.durationMs || 0), 0);
            if (session.registry.activeId === workspaceId) {
                setResults(session.queryState.get(key).results);
                setStatus(`Done \u00b7 ${rows} rows \u00b7 ${duration}ms`);
            }
            if (!isExplain && isCurrentQueryRequest(session, snapshot))
                await appendHistory(session.conn.id, { id: String(started), sql: snapshot.sql.slice(0, 4096), startedAt: started, durationMs: duration, ok: true, rows });
            } finally {
                if (isCurrentQueryRequest(session, snapshot) && session.registry.activeId === workspaceId) {
                    setRunning(false);
                    setHistoryToken((n) => n + 1);
                }
            }
        },
        [key, session, setStatus, workspaceId],
    );

    const run = useCallback(
        async (mode) => {
            if (!editorRef.current) return;
            const sql = mode === "all" ? editorRef.current.state.doc.toString().trim() : currentStatement();
            if (!sql)
                return;
            await execute(sql, "execute");
        },
        [execute, session],
    );

    const runRef = useRef(run);
    runRef.current = run;

    const runExplain = async () => {
        const sql = currentStatement();
        if (!sql)
            return;
        await execute(sql, "explain");
    };

    // Expose run command to parent via queryHooksRef
    useEffect(() => {
        queryHooksRef.current = { run: () => runRef.current("cursor") };
        return () => { queryHooksRef.current = null; };
    }, [queryHooksRef]);

    const exportResults = async () => {
        const context = session.queryState.get(key)?.exportContext;
        if (!context?.result) {
            toast("No result rows to export", "warning");
            return;
        }
        await exportResult(session.conn.engine, context.objectRef, context.result, "csv");
    };

    const togglePanel = (kind) => setPanel((prev) => (prev === kind ? null : kind));

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="toolbar border-b" style={{ borderColor: "var(--muxy-border)" }}>
                    <button className="btn btn-compact btn-primary" disabled={running} onClick={() => run("cursor")}>
                        <Icon name="play" />
                        Run
                    </button>
                    <button className="btn btn-compact" title="Run every statement in this workspace" onClick={() => run("all")}>
                        Run All
                    </button>
                    <button className="btn btn-compact" title="Explain the statement at the cursor" onClick={runExplain}>
                        Explain
                    </button>
                    <span className="text-[var(--font-footnote)] text-muted-foreground">\u2318\u23ce statement \u00b7 \u21e7\u2318\u23ce all</span>
                    <div className="flex-1" />
                    <button className="icon-btn" title="Export results as CSV" onClick={exportResults}>
                        <Icon name="download" />
                    </button>
                    <button className="icon-btn" title="Query history" onClick={() => togglePanel("history")}>
                        <Icon name="clock" />
                    </button>
                    <button className="icon-btn" title="Saved queries" onClick={() => togglePanel("saved")}>
                        <Icon name="star" />
                    </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SqlEditorView
                        engine={session.conn.engine}
                        schema={schemaForCompletion(session)}
                        initialDoc={draft}
                        viewRef={editorRef}
                        onDocChange={(doc) => setDraftText(doc)}
                        onRun={() => runRef.current("cursor")}
                        onRunAll={() => runRef.current("all")}
                    />
                </div>
                <div className="min-h-0 border-t" style={{ borderColor: "var(--muxy-border)", flex: "0 0 45%" }}>
                    <Results results={results?.results} error={results?.error} />
                </div>
            </div>
            {panel === "history" ? (
                <HistoryPanel session={session} refreshToken={historyToken} onPick={(sql) => insertSql(editorRef.current, sql)} />
            ) : null}
            {panel === "saved" ? (
                <div className="w-[var(--side-panel-width)] flex-shrink-0 border-l" style={{ borderColor: "var(--muxy-border)" }}>
                    <SavedPanel
                        session={session}
                        onPick={(sql) => insertSql(editorRef.current, sql)}
                        getCurrentSql={() => selectedSql(editorRef.current) ?? (editorRef.current ? editorRef.current.state.doc.toString() : "")}
                    />
                </div>
            ) : null}
        </div>
    );
}
