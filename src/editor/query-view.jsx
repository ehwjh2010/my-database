import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { Modal } from "../ui/modal.jsx";
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

export function QueryView({ session, workspaceId, sqlTabId, setStatus, queryHooksRef }) {
    const editorRef = useRef(null);
    const [panel, setPanel] = useState(null);
    const [running, setRunning] = useState(false);
    const [historyToken, setHistoryToken] = useState(0);
    const [conflictOpen, setConflictOpen] = useState(false);
    const [conflictBusy, setConflictBusy] = useState(false);
    const [conflictActionError, setConflictActionError] = useState(null);
    const [modalConflictVersion, setModalConflictVersion] = useState(null);

    const isSqlTab = sqlTabId != null;
    const tabId = isSqlTab ? sqlTabId : workspaceId;
    const entry = isSqlTab ? session.sqlRegistry?.byId?.[sqlTabId] : session.registry.byId[workspaceId];
    const key = entry?.key;
    const stateMap = isSqlTab ? session.sqlState : session.queryState;
    const qs = key ? (stateMap.get(key) || { sql: "", results: null, exportContext: null }) : { sql: "", results: null, exportContext: null };
    const saveFailed = isSqlTab && qs.saveFailed;
    const externalConflict = isSqlTab && qs.externalConflict;
    const saveError = qs.saveError;
    const [draft, setDraft] = useState(() => qs.sql);
    const [results, setResults] = useState(() => qs.results);

    useEffect(() => {
        setDraft(qs.sql);
        setResults(qs.results);
    }, [key, qs.sql]);

    useEffect(() => {
        if (externalConflict) {
            setConflictOpen(true);
            setConflictActionError(null);
            setModalConflictVersion(qs.conflictVersion);
        }
        else {
            setConflictOpen(false);
            setConflictBusy(false);
            setModalConflictVersion(null);
        }
    }, [externalConflict, key, qs.conflictVersion]);

    if (!entry || !key)
        return null;

    const active = isSqlTab
        ? session.surface === "console" && session.sqlRegistry.activeId === sqlTabId
        : session.surface === "object" && session.registry.activeId === workspaceId;

    const currentStatement = () => {
        if (!editorRef.current) return "";
        const selection = selectedSql(editorRef.current);
        if (selection)
            return selection.trim();
        const offset = editorRef.current.state.selection.main.head;
        return statementAt(editorRef.current.state.doc.toString(), offset, session.conn.engine)?.sql || "";
    };

    const setDraftText = useCallback((sql) => {
        if (isSqlTab)
            session.coordinator.updateSqlDraft(tabId, sql);
        else {
            const store = stateMap.get(key);
            if (store) store.sql = sql;
        }
        setDraft(sql);
    }, [isSqlTab, key, session.coordinator, stateMap, tabId]);

    const execute = useCallback(
        async (sql, mode) => {
            const isExplain = mode === "explain";
            const snapshot = session.coordinator.initiateQueryExecute(tabId, sql, mode);
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
                if (active) {
                    setResults(stateMap.get(key).results);
                    setStatus("Error");
                }
                if (!isSqlTab && !isExplain && isCurrentQueryRequest(session, snapshot))
                    await appendHistory(session.conn.id, { id: String(started), sql: snapshot.sql.slice(0, 4096), startedAt: started, durationMs: Date.now() - started, ok: false });
                return;
            }
            if (!commitQueryResult(session, snapshot, data))
                return;
            const rows = data.reduce((sum, r) => sum + r.rows.length, 0);
            const duration = data.reduce((sum, r) => sum + (r.durationMs || 0), 0);
            if (active) {
                setResults(stateMap.get(key).results);
                setStatus(`Done \u00b7 ${rows} rows \u00b7 ${duration}ms`);
            }
            if (!isSqlTab && !isExplain && isCurrentQueryRequest(session, snapshot))
                await appendHistory(session.conn.id, { id: String(started), sql: snapshot.sql.slice(0, 4096), startedAt: started, durationMs: duration, ok: true, rows });
            } finally {
                if (isCurrentQueryRequest(session, snapshot) && active) {
                    setRunning(false);
                    setHistoryToken((n) => n + 1);
                }
            }
        },
        [active, key, session, setStatus, stateMap, tabId],
    );

    const run = useCallback(async () => {
        if (!editorRef.current) return;
        const sql = currentStatement();
        if (!sql)
            return;
        await execute(sql, "execute");
    }, [execute]);

    const runRef = useRef(run);
    runRef.current = run;

    const runExplain = async () => {
        const sql = currentStatement();
        if (!sql)
            return;
        await execute(sql, "explain");
    };

    const retrySave = async () => {
        const result = await session.coordinator.retrySqlSave(tabId);
        if (result?.error)
            setStatus("Error");
    };

    const reloadFromDisk = async () => {
        if (conflictBusy)
            return;
        setConflictBusy(true);
        setConflictActionError(null);
        try {
            const result = await session.coordinator.reloadSqlFile(tabId);
            if (result?.error)
                setConflictActionError(result.error);
        }
        catch (error) {
            setConflictActionError(error?.message || String(error));
        }
        finally {
            setConflictBusy(false);
        }
    };

    const overwriteDisk = async () => {
        if (conflictBusy)
            return;
        setConflictBusy(true);
        setConflictActionError(null);
        try {
            const result = await session.coordinator.overwriteSqlFile(tabId, modalConflictVersion);
            if (result?.error)
                setConflictActionError(result.error);
        }
        catch (error) {
            setConflictActionError(error?.message || String(error));
            setModalConflictVersion(session.sqlState.get(key)?.conflictVersion || modalConflictVersion);
            setConflictOpen(true);
        }
        finally {
            setConflictBusy(false);
        }
    };

    useEffect(() => {
        queryHooksRef.current = { run: () => runRef.current() };
        return () => { queryHooksRef.current = null; };
    }, [queryHooksRef]);

    const exportResults = async () => {
        const context = stateMap.get(key)?.exportContext;
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
                    <button className="btn btn-compact" title="Explain the statement at the cursor" onClick={runExplain}>
                        Explain
                    </button>
                    <span className="text-[var(--font-footnote)] text-muted-foreground">{"\u2318\u23ce statement"}</span>
                    <div className="flex-1" />
                    <button className="icon-btn" title="Export results as CSV" onClick={exportResults}>
                        <Icon name="download" />
                    </button>
                    <button className="icon-btn" title="Query history" onClick={() => togglePanel("history")}>
                        <Icon name="clock" />
                    </button>
                    {!isSqlTab ? (
                        <button className="icon-btn" title="Saved queries" onClick={() => togglePanel("saved")}>
                            <Icon name="star" />
                        </button>
                    ) : null}
                </div>
                {saveFailed || externalConflict ? (
                    <div className={`save-feedback ${externalConflict ? "external-conflict" : "save-failed"}`} data-testid="sql-save-feedback" data-save-state={externalConflict ? "externalConflict" : "saveFailed"} role="alert">
                        <Icon name="warning" />
                        <span>{saveError?.message || String(saveError)}</span>
                        {saveFailed ? <button className="btn btn-compact" data-testid="sql-save-retry" onClick={() => { void retrySave(); }}><Icon name="refresh" />Retry</button> : null}
                        {externalConflict ? <button className="btn btn-compact" data-testid="sql-conflict-resolve" onClick={() => { setConflictActionError(null); setModalConflictVersion(qs.conflictVersion); setConflictOpen(true); }}>Resolve conflict</button> : null}
                    </div>
                ) : null}
                {conflictOpen && externalConflict ? (
                    <Modal
                        icon="warning"
                        title="External changes detected"
                        size="sm"
                        onClose={() => { if (!conflictBusy) setConflictOpen(false); }}
                        footer={(
                            <>
                                <button className="btn" data-testid="sql-conflict-reload" onClick={() => { void reloadFromDisk(); }} disabled={conflictBusy}>Reload from Disk</button>
                                <button className="btn btn-primary" data-testid="sql-conflict-overwrite" onClick={() => { void overwriteDisk(); }} disabled={conflictBusy}>Overwrite Disk</button>
                            </>
                        )}
                    >
                        <div className="flex flex-col gap-[var(--s3)] px-[var(--s7)] py-[var(--s6)]">
                            <div>The SQL file changed outside Muxy. Choose which version to keep.</div>
                            {conflictActionError ? <div className="error-box" data-testid="sql-conflict-error" role="alert">{conflictActionError}</div> : null}
                        </div>
                    </Modal>
                ) : null}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SqlEditorView
                        engine={session.conn.engine}
                        schema={schemaForCompletion(session)}
                        initialDoc={draft}
                        viewRef={editorRef}
                        onDocChange={(doc) => setDraftText(doc)}
                        onRun={() => runRef.current()}
                    />
                </div>
                <div className="min-h-0 border-t" style={{ borderColor: "var(--muxy-border)", flex: "0 0 45%" }}>
                    <Results results={results?.results} error={results?.error} />
                </div>
            </div>
            {panel === "history" ? (
                <HistoryPanel session={session} refreshToken={historyToken} onPick={(sql) => insertSql(editorRef.current, sql)} />
            ) : null}
            {panel === "saved" && !isSqlTab ? (
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
