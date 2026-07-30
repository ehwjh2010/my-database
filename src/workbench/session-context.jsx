import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";

const SessionContext = createContext(null);

export function useSession() {
    return useContext(SessionContext);
}

export function SessionProvider({ session, queryHooksRef, setViewRef, children }) {
    const coordinator = session.coordinator;
    const [registryRevision, bumpRegistryRevision] = useReducer((n) => n + 1, 0);
    const [tables, setTables] = useState(session.tables || []);
    const [columnsMap, setColumnsMap] = useState(session.columnsMap || {});
    const [catalogError, setCatalogError] = useState(session.catalogError || null);
    const [status, setStatus] = useState("Ready");
    const [schemaEpoch, bumpEpoch] = useReducer((n) => n + 1, 0);
    const [pendingRevision, bumpPendingRevision] = useReducer((n) => n + 1, 0);
    const [dataRevision, bumpDataRevision] = useReducer((n) => n + 1, 0);
    const queryRunRef = useRef(null);
    const notifyPendingChanges = useCallback(() => bumpPendingRevision(), []);

    useEffect(() => {
        coordinator.adapters.notify = bumpRegistryRevision;
        coordinator.adapters.notifyPending = bumpPendingRevision;
        coordinator.adapters.notifyData = bumpDataRevision;
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

    const refreshSchema = useCallback(async () => {
        await coordinator.initiateCatalogLoad();
        bumpEpoch();
    }, [coordinator]);

    const openWorkspace = useCallback((next) => coordinator.openOrActivate(next), [coordinator]);
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
        if (activeId)
            coordinator.changeView(activeId, next);
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
            registryRevision,
            pendingRevision,
            notifyPendingChanges,
            dataRevision,
            queryRunRef,
            openWorkspace,
            activateWorkspace,
            closeWorkspace,
            refreshData,
            setWorkspaceMode,
            view: activeMode,
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
        }),
        [session, coordinator, order, activeId, byId, activeKey, activeMode, activeRef, registryRevision, pendingRevision, dataRevision, notifyPendingChanges, changeView, selectTable, openWorkspace, activateWorkspace, closeWorkspace, refreshData, setWorkspaceMode, tables, columnsMap, catalogError, status, refreshSchema, changeScope, schemaEpoch, queryHooksRef],
    );

    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
