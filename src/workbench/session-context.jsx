import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { hasDatabase } from "./state.js";

const SessionContext = createContext(null);

export function useSession() {
    return useContext(SessionContext);
}

export function SessionProvider({ session, queryHooksRef, setViewRef, newFileRef, children }) {
    const coordinator = session.coordinator;
    const [registryRevision, bumpRegistryRevision] = useReducer((n) => n + 1, 0);
    const [tables, setTables] = useState(session.tables || []);
    const [columnsMap, setColumnsMap] = useState(session.columnsMap || {});
    const [catalogError, setCatalogError] = useState(session.catalogError || null);
    const [status, setStatus] = useState("Ready");
    const [schemaEpoch, bumpEpoch] = useReducer((n) => n + 1, 0);
    const [pendingRevision, bumpPendingRevision] = useReducer((n) => n + 1, 0);
    const [dataRevision, bumpDataRevision] = useReducer((n) => n + 1, 0);
    const [columnFocus, setColumnFocus] = useState(session.columnFocus || null);
    const queryRunRef = useRef(null);
    const notifyPendingChanges = useCallback(() => bumpPendingRevision(), []);

    useEffect(() => {
        coordinator.adapters.notify = bumpRegistryRevision;
        coordinator.adapters.notifyPending = bumpPendingRevision;
        coordinator.adapters.notifyData = bumpDataRevision;
        coordinator.adapters.notifyColumnFocus = setColumnFocus;
        coordinator.adapters.notifyScope = () => {
            bumpEpoch();
            setStatus("Ready");
        };
        coordinator.adapters.notifyCatalog = () => {
            setTables(session.tables);
            setColumnsMap(session.columnsMap || {});
            setCatalogError(session.catalogError || null);
        };
    }, [coordinator, session]);

    const { order, activeId, byId } = session.registry;
    const activeWorkspace = activeId ? byId[activeId] || null : null;
    const activeKey = activeWorkspace?.key || null;
    const activeMode = activeWorkspace?.view || null;
    const activeRef = activeWorkspace?.ref || null;
    const activeSqlId = session.sqlRegistry?.activeId || null;
    const surface = session.surface || (activeWorkspace ? "object" : "console");

    const refreshSchema = useCallback(async () => {
        await coordinator.initiateCatalogLoad();
        bumpEpoch();
    }, [coordinator]);

    const openWorkspace = useCallback((next) => coordinator.openOrActivate(next), [coordinator]);
    const enterConsole = useCallback(() => coordinator.enterConsole(), [coordinator]);
    const newQuery = useCallback(() => coordinator.newQuery(), [coordinator]);
    const createAndOpenFile = useCallback((name) => coordinator.createAndOpenFile(name), [coordinator]);
    const openSqlFile = useCallback((name) => coordinator.openSqlFile(name), [coordinator]);
    const activateSql = useCallback((sqlTabId) => coordinator.activateSql(sqlTabId), [coordinator]);
    const closeSql = useCallback((sqlTabId) => coordinator.closeSql(sqlTabId), [coordinator]);
    const loadTableInfo = useCallback((ref) => coordinator.loadTableInfo(ref), [coordinator]);
    const focusTableColumn = useCallback((ref, columnName) => coordinator.focusTableColumn(ref, columnName), [coordinator]);
    const consumeColumnFocus = useCallback((token) => coordinator.consumeColumnFocus(token), [coordinator]);
    const activateWorkspace = useCallback((workspaceId) => coordinator.setActive(workspaceId), [coordinator]);
    const closeWorkspace = useCallback((workspaceId) => coordinator.close(workspaceId), [coordinator]);
    const setWorkspaceMode = useCallback((workspaceId, mode) => coordinator.changeView(workspaceId, mode), [coordinator]);
    const refreshData = useCallback(async () => {
        if (!activeId)
            return false;
        const result = await coordinator.refreshData(activeId);
        return result.outcome === "started";
    }, [coordinator, activeId]);
    const changeScope = useCallback((scope) => coordinator.changeScope(scope), [coordinator]);
    const changeView = useCallback((next) => {
        if (next === "console")
            return coordinator.enterConsole();
        if (activeId)
            return coordinator.changeView(activeId, next);
        return { error: "OBJECT_WORKSPACE_REQUIRED" };
    }, [coordinator, activeId]);
    const selectTable = useCallback((next) => openWorkspace(next), [openWorkspace]);

    useEffect(() => {
        if (!setViewRef)
            return;
        setViewRef.current = changeView;
        return () => { setViewRef.current = null; };
    }, [setViewRef, changeView]);

    const value = useMemo(
        () => ({
            session,
            coordinator,
            order,
            activeId,
            byId,
            activeKey,
            activeMode,
            activeRef,
            activeSqlId,
            surface,
            registryRevision,
            pendingRevision,
            notifyPendingChanges,
            dataRevision,
            queryRunRef,
            openWorkspace,
            enterConsole,
            newQuery,
            createAndOpenFile,
            openSqlFile,
            activateSql,
            closeSql,
            loadTableInfo,
            focusTableColumn,
            columnFocus,
            consumeColumnFocus,
            activateWorkspace,
            closeWorkspace,
            refreshData,
            setWorkspaceMode,
            view: surface === "console" ? "console" : activeMode,
            hasDatabase: hasDatabase(session),
            setView: changeView,
            ref: activeRef,
            selectTable,
            tables,
            columnsMap,
            catalogError,
            status,
            setStatus,
            refreshSchema,
            changeScope,
            schemaEpoch,
            queryHooksRef,
            newFileRef,
        }),
        [session, coordinator, order, activeId, byId, activeKey, activeMode, activeRef, activeSqlId, surface, registryRevision, pendingRevision, dataRevision, notifyPendingChanges, changeView, selectTable, openWorkspace, enterConsole, newQuery, createAndOpenFile, openSqlFile, activateSql, closeSql, loadTableInfo, focusTableColumn, columnFocus, consumeColumnFocus, activateWorkspace, closeWorkspace, refreshData, setWorkspaceMode, tables, columnsMap, catalogError, status, refreshSchema, changeScope, schemaEpoch, queryHooksRef, newFileRef],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
