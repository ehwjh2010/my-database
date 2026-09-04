import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { Modal } from "../ui/modal.jsx";
import { ContextMenu } from "../ui/context-menu.jsx";
import { queryExecuteIntent } from "./query-execute-intent.js";
import { queryErrorDiagnostic } from "../lib/sql/error-diagnostic.js";
import { exportActive } from "../transfer/transfer.js";
import { ExportMenuModal } from "../transfer/transfer-menu.jsx";
import { SqlEditorView } from "./sql-editor-view.jsx";
import { Results } from "./results.jsx";
import { ResultsPane } from "./results-pane.jsx";

export function schemaForCompletion(session) {
    const schema = {};
    for (const table of session.tables)
        schema[table.name] = session.columnsMap?.[table.name] || [];
    return schema;
}

export function QueryView({ session, workspaceId, sqlTabId, setStatus, queryHooksRef }) {
    const editorRef = useRef(null);
    const editorHostRef = useRef(null);
    const resultsHeightRef = useRef(null);
    const [conflictOpen, setConflictOpen] = useState(false);
    const [conflictBusy, setConflictBusy] = useState(false);
    const [conflictActionError, setConflictActionError] = useState(null);
    const [modalConflictVersion, setModalConflictVersion] = useState(null);
    const [exportOpen, setExportOpen] = useState(false);
    const [resultsOpen, setResultsOpen] = useState(false);
    const [executeMenu, setExecuteMenu] = useState(null);

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

    useEffect(() => {
        setDraft(qs.sql);
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

    const isActive = () => isSqlTab
        ? session.surface === "console" && session.sqlRegistry.activeId === sqlTabId
        : session.surface === "object" && session.registry.activeId === workspaceId;

    const setDraftText = useCallback((sql) => {
        if (isSqlTab)
            session.coordinator.updateSqlDraft(tabId, sql);
        else {
            const store = stateMap.get(key);
            if (store) store.sql = sql;
            if (store) store.executionMarker = null;
        }
        setDraft(sql);
    }, [isSqlTab, key, session.coordinator, stateMap, tabId]);

    const execute = useCallback(
        async (execution, mode) => {
            const isExplain = mode === "explain";
            const snapshot = session.coordinator.initiateQueryExecute(tabId, execution.sql, mode, execution.range, isSqlTab);
            if (snapshot.error) {
                setStatus("Error");
                return;
            }
            setStatus(isExplain ? "Explaining\u2026" : "Running\u2026");
            let data;
            try {
                data = isExplain
                    ? await session.driver.explain(snapshot.operationCtx, snapshot.sql, { timeoutMs: session.timeoutMs })
                    : await session.driver.runQuery(snapshot.operationCtx, snapshot.sql, { timeoutMs: session.timeoutMs });
            } catch (error) {
                const diagnostic = isExplain ? null : queryErrorDiagnostic({ engine: session.conn.engine, sql: snapshot.sql, documentOffset: snapshot.executionRange.from, error });
                if (!session.coordinator.commitQueryError(snapshot, error.message, diagnostic))
                    return;
                if (isActive()) {
                    setStatus("Error");
                    setResultsOpen(true);
                }
                return;
            }
            if (!session.coordinator.commitQueryResult(snapshot, data))
                return;
            if (isActive()) {
                setStatus("Ready");
                setResultsOpen(true);
            }
        },
        [session, setStatus, tabId],
    );

    const presentExecute = useCallback((mode) => {
        const view = editorRef.current;
        if (!view)
            return;
        const intent = queryExecuteIntent(view, session.conn.engine);
        if (intent.kind === "none")
            return;
        if (intent.kind === "run") {
            void execute(intent.execution, mode);
            return;
        }
        const coords = view.coordsAtPos?.(view.state.selection.main.head);
        setExecuteMenu({
            x: coords?.left ?? 24,
            y: coords?.bottom ?? 72,
            items: [
                ...intent.statements.map((statement) => ({
                    label: statement.current ? `${statement.label}  (current)` : statement.label,
                    onClick: () => execute(statement.execution, mode),
                })),
                { separator: true },
                { label: intent.all.label, onClick: () => execute(intent.all.execution, mode) },
            ],
        });
    }, [execute, session.conn.engine]);

    const run = useCallback(() => presentExecute("execute"), [presentExecute]);

    const runRef = useRef(run);
    runRef.current = run;

    const runExplain = () => presentExecute("explain");

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

    const exportResults = async (format) => {
        await exportActive(session, format);
    };

    const canExport = Boolean(qs.exportContext?.result?.columns?.length);
    const hasResults = Boolean(qs.results?.results?.length || qs.queryError);

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
                <div className="toolbar border-b" style={{ borderColor: "var(--muxy-border)" }}>
                    <div className="flex-1" />
                    <button className={`icon-btn${resultsOpen ? " active" : ""}`} title={resultsOpen ? "Hide results" : "Show results"} disabled={!hasResults} onClick={() => setResultsOpen(!resultsOpen)}>
                        <Icon name="table" />
                    </button>
                    <button className="icon-btn" title="Export results" disabled={!canExport || qs.queryRunning} onClick={() => setExportOpen(true)}>
                        <Icon name="download" />
                    </button>
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
                <div ref={editorHostRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                    <SqlEditorView
                        engine={session.conn.engine}
                        schema={schemaForCompletion(session)}
                        initialDoc={draft}
                        executionMarker={qs.executionMarker}
                        viewRef={editorRef}
                        onDocChange={(doc) => setDraftText(doc)}
                        onRun={() => runRef.current()}
                    />
                    {hasResults && resultsOpen ? (
                        <ResultsPane hostRef={editorHostRef} heightRef={resultsHeightRef}>
                            <Results results={qs.results?.results} error={qs.queryError} onClose={() => setResultsOpen(false)} />
                        </ResultsPane>
                    ) : null}
                </div>
            </div>
            {exportOpen ? <ExportMenuModal onClose={() => setExportOpen(false)} onExport={exportResults} /> : null}
            {executeMenu ? <ContextMenu x={executeMenu.x} y={executeMenu.y} items={executeMenu.items} onClose={() => setExecuteMenu(null)} /> : null}
        </div>
    );
}
