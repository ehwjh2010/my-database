import { clearChanges } from "../grid/pending-changes.js";
import { dataOperationFor, settleDataOperation, startDataOperation } from "./data-operations.js";
import { createSqlFile, ensureConsoleFile, getSqlNamespace, listSqlFiles, readSqlFile, renameSqlFile, saveSqlFile, trashSqlFile, validateFileName } from "../lib/sql-files.js";
import { clearDataRuntime, clearDataRuntimes, dataRuntimeFor, nextDataRequest, refreshDataRuntime } from "./data-runtime.js";
import { currentDatabase, hasDatabase } from "./state.js";
import { initialWorkspaceState, objectCacheKey, pendingChangeCountFor, sameObjectRef, workspaceReducer } from "./workspace-state.js";

export const WORKSPACE_VIEWS = Object.freeze(["data", "structure", "query"]);
export const QUERY_MODES = Object.freeze(["execute", "explain"]);
export const STRUCTURE_OPERATIONS = Object.freeze(["drop", "truncate"]);

const STALE_WORKSPACE = { error: "STALE_WORKSPACE" };

export function createWorkspaceCoordinator(session, adapters = {}) {
    if (!session.registry)
        session.registry = initialWorkspaceState;
    session.workspaceIdCounter = session.workspaceIdCounter || 0;
    session.workspaceGenerationCounter = session.workspaceGenerationCounter || 0;
    session.catalogToken = session.catalogToken || 0;
    session.scopeRequestToken = session.scopeRequestToken || 0;
    session.catalogError = session.catalogError || null;
    session.tableInfoRequests = session.tableInfoRequests || new Map();
    session.tableInfoErrors = session.tableInfoErrors || new Map();
    session.columnFocusToken = session.columnFocusToken || 0;
    session.columnFocus = session.columnFocus || null;
    session.sqlRegistry = session.sqlRegistry || { order: [], activeId: null, byId: {} };
    session.sqlState = session.sqlState || new Map();
    session.sqlOwners = session.sqlOwners || new Map();
    session.sqlTabIdCounter = session.sqlTabIdCounter || 0;
    session.sqlTabGenerationCounter = session.sqlTabGenerationCounter || 0;
    session.sqlFiles = session.sqlFiles || [];
    session.consoleToken = session.consoleToken || 0;
    session.consoleEpoch = session.consoleEpoch || 0;
    session.consoleState = session.consoleState || { phase: "missing", files: [], error: null };
    session.surface = session.surface || "console";
    let registryRevision = 0;

    const emit = () => {
        registryRevision += 1;
        adapters.notify?.(registryRevision);
    };
    const commit = (action) => {
        session.registry = workspaceReducer(session.registry, action);
        emit();
    };
    const entryById = (workspaceId) => session.registry.byId[workspaceId] || null;
    const isCurrentEntry = (entry) => entryById(entry.id) === entry;
    const captureOperationCtx = () => ({ ...session.ctx });
    const ownershipFor = (entry) => ({ workspaceId: entry.id, scopeEpoch: session.scopeGeneration || 0, generation: entry.generation });
    const clearWorkspaceRuntime = (key) => {
        clearDataRuntime(session, key);
        session.structureCache?.delete(key);
        session.queryState?.delete(key);
    };
    const clearSqlSaveTimers = () => {
        for (const owner of session.sqlOwners.values()) {
            if (owner.saveTimer)
                clearTimeout(owner.saveTimer);
        }
    };
    const clearSqlRuntime = () => {
        clearSqlSaveTimers();
        session.sqlState.clear();
        session.sqlOwners.clear();
        session.sqlRegistry = { order: [], activeId: null, byId: {} };
        session.sqlFiles = [];
        session.sqlNamespace = null;
    };
    const clearWindowRuntime = ({ clearSql = true } = {}) => {
        clearDataRuntimes(session);
        session.structureCache?.clear();
        session.infoCache?.clear();
        session.tableInfoRequests.clear();
        session.tableInfoErrors.clear();
        session.queryState?.clear();
        if (clearSql) {
            clearSqlRuntime();
            session.consoleEpoch += 1;
        }
        session.columnFocus = null;
        commit({ type: "CLEAR_ALL" });
        adapters.notifyPending?.();
        adapters.notifyData?.();
        adapters.notifyColumnFocus?.(null);
    };
    const clearScopeRuntime = ({ clearSql = true } = {}) => {
        session.tables = [];
        session.columnsMap = {};
        session.catalogError = null;
        if (clearSql) {
            session.surface = "console";
            session.consoleState = { phase: "missing", files: [], error: null };
        }
        clearWindowRuntime({ clearSql });
        adapters.notifyScope?.();
        adapters.notifyCatalog?.();
    };
    const closeWorkspace = (entry) => {
        if (session.columnFocus?.workspaceId === entry.id) {
            session.columnFocus = null;
            adapters.notifyColumnFocus?.(null);
        }
        clearWorkspaceRuntime(entry.key);
        commit({ type: "CLOSE", id: entry.id });
        adapters.notifyPending?.();
        adapters.notifyData?.();
        return { outcome: "closed", activeId: session.registry.activeId };
    };
    const sqlEntryById = (sqlTabId) => session.sqlRegistry.byId[sqlTabId] || null;
    const sqlStateFor = (sqlTabId) => {
        const entry = sqlEntryById(sqlTabId);
        return entry ? session.sqlState.get(entry.key) : null;
    };
    const filesApi = () => adapters.sqlFiles || { getNamespace: getSqlNamespace, ensureConsoleFile, listSqlFiles, createSqlFile, readSqlFile, renameSqlFile, saveSqlFile, trashSqlFile };
    const sortFiles = (files) => [...files].sort((left, right) => {
        if (left.reserved !== right.reserved)
            return left.reserved ? -1 : 1;
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
    const setSqlFiles = (files) => {
        session.sqlFiles = sortFiles(files);
        session.consoleState = { ...session.consoleState, files: session.sqlFiles };
    };
    const emptyVersion = (file) => ({
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        size: 0,
        mtimeMs: file.mtimeMs,
    });
    const createSqlTab = (file, content, observedVersion) => {
        const id = ++session.sqlTabIdCounter;
        const generation = ++session.sqlTabGenerationCounter;
        const key = `sql:${id}`;
        session.sqlState.set(key, { sql: content, results: null, exportContext: null, queryRunning: false, queryError: null, executionMarker: null, observedVersion, dirty: false, saveStatus: "clean", saveFailed: false, saveError: null, conflictStatus: "none", conflictVersion: null, externalConflict: false });
        session.sqlOwners.set(key, { queryRequest: 0, saveTimer: null, savePromise: null, savePending: false });
        session.sqlRegistry = {
            order: [...session.sqlRegistry.order, id],
            activeId: id,
            byId: { ...session.sqlRegistry.byId, [id]: { id, key, generation, kind: "sql", name: file.name, title: file.name, path: file.path, reserved: Boolean(file.reserved), observedVersion, dirty: false, saveStatus: "clean", saveFailed: false, saveError: null, conflictStatus: "none", conflictVersion: null, externalConflict: false } },
        };
        session.surface = "console";
        emit();
        return { sqlTabId: id, created: true, activeId: id };
    };
    const updateSqlEntry = (sqlTabId, changes) => {
        const entry = sqlEntryById(sqlTabId);
        if (!entry)
            return null;
        session.sqlRegistry = { ...session.sqlRegistry, byId: { ...session.sqlRegistry.byId, [sqlTabId]: { ...entry, ...changes } } };
        return session.sqlRegistry.byId[sqlTabId];
    };
    const markSqlConflict = async (sqlTabId, owner, error) => {
        const entry = sqlEntryById(sqlTabId);
        const state = sqlStateFor(sqlTabId);
        if (!entry || !state || session.sqlOwners.get(entry.key) !== owner)
            return;
        const api = filesApi();
        const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
        const conflictVersion = error.conflictVersion || (await api.readSqlFile(namespace, entry.name)).version;
        state.dirty = true;
        state.saveStatus = "clean";
        state.saveFailed = false;
        state.saveError = error;
        state.conflictStatus = "externalConflict";
        state.conflictVersion = conflictVersion;
        state.externalConflict = true;
        updateSqlEntry(sqlTabId, { dirty: true, saveStatus: "clean", saveFailed: false, saveError: error, conflictStatus: "externalConflict", conflictVersion, externalConflict: true });
        emit();
    };
    const flushSqlDraft = async (sqlTabId, owner) => {
        if (owner.savePromise) {
            owner.savePending = true;
            return;
        }
        const entry = sqlEntryById(sqlTabId);
        const state = sqlStateFor(sqlTabId);
        if (!entry || !state || session.sqlOwners.get(entry.key) !== owner)
            return;
        const content = state.sql;
        const expectedVersion = state.observedVersion;
        owner.savePromise = (async () => {
            try {
                const api = filesApi();
                const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
                const result = await api.saveSqlFile(namespace, entry.name, content, expectedVersion);
                if (session.sqlOwners.get(entry.key) !== owner)
                    return;
                const currentState = session.sqlState.get(entry.key);
                const dirty = currentState.sql !== content;
                currentState.observedVersion = result.version;
                currentState.dirty = dirty;
                currentState.saveStatus = dirty ? "saving" : "clean";
                currentState.saveFailed = false;
                currentState.saveError = null;
                currentState.conflictStatus = "none";
                currentState.conflictVersion = null;
                currentState.externalConflict = false;
                updateSqlEntry(sqlTabId, { observedVersion: result.version, dirty, saveStatus: currentState.saveStatus, saveFailed: false, saveError: null, conflictStatus: "none", conflictVersion: null, externalConflict: false });
                emit();
            }
            catch (error) {
                if (session.sqlOwners.get(entry.key) !== owner)
                    return;
                const currentState = session.sqlState.get(entry.key);
                const externalConflict = error?.code === "FILE_VERSION_CONFLICT";
                if (externalConflict) {
                    await markSqlConflict(sqlTabId, owner, error);
                    return;
                }
                currentState.dirty = true;
                currentState.saveStatus = "saveFailed";
                currentState.saveFailed = true;
                currentState.saveError = error;
                currentState.conflictStatus = externalConflict ? "externalConflict" : currentState.conflictStatus;
                currentState.externalConflict = externalConflict || currentState.externalConflict;
                updateSqlEntry(sqlTabId, { dirty: true, saveStatus: currentState.saveStatus, saveFailed: currentState.saveFailed, saveError: error, conflictStatus: currentState.conflictStatus, externalConflict: currentState.externalConflict });
                emit();
            }
        })();
        await owner.savePromise;
        owner.savePromise = null;
        const currentState = session.sqlState.get(entry.key);
        if (session.sqlOwners.get(entry.key) === owner && !currentState?.externalConflict && (owner.savePending || currentState?.sql !== content)) {
            owner.savePending = false;
            void flushSqlDraft(sqlTabId, owner);
        }
    };
    const scheduleSqlDraft = (sqlTabId, owner) => {
        if (owner.saveTimer)
            clearTimeout(owner.saveTimer);
        owner.saveTimer = setTimeout(() => {
            owner.saveTimer = null;
            void flushSqlDraft(sqlTabId, owner);
        }, 500);
    };
    const sqlNeedsUnsavedGuard = (entry) => {
        const state = session.sqlState.get(entry.key);
        return Boolean(state?.dirty || state?.saveFailed || state?.externalConflict || entry.dirty || entry.saveFailed || entry.externalConflict);
    };
    const confirmSqlAction = (entry, action) => {
        if (!sqlNeedsUnsavedGuard(entry))
            return null;
        return (async () => {
            let choice;
            try {
                choice = await adapters.confirm?.({
                    title: "Discard unsaved changes?",
                    message: `${entry.name} has unsaved changes that will be lost.`,
                    buttons: [action, "Cancel"],
                    cancel: "Cancel",
                    style: "warning",
                });
            }
            catch {
                return { error: "CONFIRMATION_FAILED" };
            }
            return choice === action ? null : { outcome: "cancelled" };
        })();
    };

    const coordinator = {
        adapters,

        get revision() {
            return registryRevision;
        },

        getActive() {
            return entryById(session.registry.activeId);
        },

        getActiveSql() {
            return sqlEntryById(session.sqlRegistry.activeId);
        },

        enterConsole() {
            session.surface = "console";
            const token = ++session.consoleToken;
            if (!hasDatabase(session)) {
                session.consoleState = { phase: "missing", files: [], error: null };
                emit();
                return Promise.resolve({ error: "DATABASE_REQUIRED" });
            }
            session.consoleState = { phase: "loading", files: session.consoleState.files || [], error: null };
            emit();
            const api = filesApi();
            return (async () => {
                try {
                    const namespace = await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
                    await api.ensureConsoleFile(namespace);
                    const files = await api.listSqlFiles(namespace);
                    if (session.consoleToken !== token)
                        return { stale: true };
                    session.sqlNamespace = namespace;
                    setSqlFiles(files);
                    session.consoleState = { phase: "ready", files, error: null };
                    emit();
                    return { namespace, files };
                }
                catch (error) {
                    if (session.consoleToken === token) {
                        session.consoleState = { phase: "error", files: session.consoleState.files || [], error };
                        emit();
                    }
                    throw error;
                }
            })();
        },

        retryConsole() {
            return coordinator.enterConsole();
        },

        newQuery() {
            if (!hasDatabase(session))
                return { error: "DATABASE_REQUIRED" };
            return coordinator.createAndOpenFile("New Query");
        },

        async createAndOpenFile(rawName) {
            if (!hasDatabase(session))
                return { error: "DATABASE_REQUIRED" };
            const name = validateFileName(rawName);
            const api = filesApi();
            const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
            const file = await api.createSqlFile(namespace, name);
            setSqlFiles([...session.sqlFiles.filter((item) => item.name !== file.name), file]);
            return createSqlTab(file, "", emptyVersion(file));
        },

        async openSqlFile(rawName, expectedConsoleToken) {
            if (!hasDatabase(session))
                return { error: "DATABASE_REQUIRED" };
            if (expectedConsoleToken !== undefined && session.consoleToken !== expectedConsoleToken)
                return { stale: true };
            const name = validateFileName(rawName, { allowReserved: true });
            const existingId = session.sqlRegistry.order.find((id) => session.sqlRegistry.byId[id]?.name === name);
            if (existingId !== undefined) {
                session.surface = "console";
                session.sqlRegistry = { ...session.sqlRegistry, activeId: existingId };
                emit();
                return { sqlTabId: existingId, activated: true, created: false, activeId: existingId };
            }
            const file = session.sqlFiles.find((item) => item.name === name);
            if (!file)
                return { error: "FILE_NOT_FOUND" };
            const api = filesApi();
            const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
            const read = await api.readSqlFile(namespace, name);
            if (expectedConsoleToken !== undefined && session.consoleToken !== expectedConsoleToken)
                return { stale: true };
            return createSqlTab(file, read.content, read.version);
        },

        updateSqlDraft(sqlTabId, content) {
            const entry = sqlEntryById(sqlTabId);
            const state = sqlStateFor(sqlTabId);
            if (!entry || !state)
                return { error: "QUERY_TAB_REQUIRED" };
            state.sql = content;
            state.dirty = true;
            state.executionMarker = null;
            state.saveStatus = state.externalConflict ? "clean" : "saving";
            state.saveFailed = false;
            if (!state.externalConflict)
                state.saveError = null;
            const owner = session.sqlOwners.get(entry.key);
            updateSqlEntry(sqlTabId, { dirty: true, saveStatus: state.saveStatus, saveFailed: false, saveError: state.saveError });
            if (!state.externalConflict)
                scheduleSqlDraft(sqlTabId, owner);
            emit();
            return { sqlTabId, dirty: true };
        },

        async reloadSqlFile(sqlTabId) {
            const entry = sqlEntryById(sqlTabId);
            const state = sqlStateFor(sqlTabId);
            const owner = entry && session.sqlOwners.get(entry.key);
            if (!entry || !state || !owner)
                return { error: "QUERY_TAB_REQUIRED" };
            if (owner.saveTimer) {
                clearTimeout(owner.saveTimer);
                owner.saveTimer = null;
            }
            owner.savePending = false;
            const api = filesApi();
            const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
            const read = await api.readSqlFile(namespace, entry.name);
            state.sql = read.content;
            state.observedVersion = read.version;
            state.dirty = false;
            state.saveStatus = "clean";
            state.saveFailed = false;
            state.saveError = null;
            state.conflictStatus = "none";
            state.conflictVersion = null;
            state.externalConflict = false;
            updateSqlEntry(sqlTabId, { observedVersion: read.version, dirty: false, saveStatus: "clean", saveFailed: false, saveError: null, conflictStatus: "none", conflictVersion: null, externalConflict: false });
            emit();
            return { sqlTabId, content: read.content, version: read.version, reloaded: true, dirty: false, externalConflict: false };
        },

        async overwriteSqlFile(sqlTabId, conflictVersion) {
            const entry = sqlEntryById(sqlTabId);
            const state = sqlStateFor(sqlTabId);
            const owner = entry && session.sqlOwners.get(entry.key);
            if (!entry || !state || !owner)
                return { error: "QUERY_TAB_REQUIRED" };
            if (!state.externalConflict)
                return { error: "FILE_CONFLICT_REQUIRED" };
            const expectedVersion = conflictVersion || state.conflictVersion;
            if (!expectedVersion)
                return { error: "FILE_VERSION_REQUIRED" };
            state.saveStatus = "saving";
            state.saveError = null;
            updateSqlEntry(sqlTabId, { saveStatus: "saving", saveError: null });
            emit();
            try {
                const api = filesApi();
                const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
                const result = await api.saveSqlFile(namespace, entry.name, state.sql, expectedVersion);
                state.observedVersion = result.version;
                state.dirty = false;
                state.saveStatus = "clean";
                state.saveFailed = false;
                state.saveError = null;
                state.conflictStatus = "none";
                state.conflictVersion = null;
                state.externalConflict = false;
                updateSqlEntry(sqlTabId, { observedVersion: result.version, dirty: false, saveStatus: "clean", saveFailed: false, saveError: null, conflictStatus: "none", conflictVersion: null, externalConflict: false });
                emit();
                return { sqlTabId, version: result.version, overwritten: true, dirty: false, externalConflict: false };
            }
            catch (error) {
                if (error?.code === "FILE_VERSION_CONFLICT")
                    await markSqlConflict(sqlTabId, owner, error);
                else {
                    state.saveStatus = "saveFailed";
                    state.saveError = error;
                    updateSqlEntry(sqlTabId, { saveStatus: "saveFailed", saveError: error });
                    emit();
                }
                throw error;
            }
        },

        async retrySqlSave(sqlTabId) {
            const entry = sqlEntryById(sqlTabId);
            const state = sqlStateFor(sqlTabId);
            const owner = entry && session.sqlOwners.get(entry.key);
            if (!entry || !state || !owner)
                return { error: "QUERY_TAB_REQUIRED" };
            if (owner.saveTimer) {
                clearTimeout(owner.saveTimer);
                owner.saveTimer = null;
            }
            owner.savePending = false;
            state.saveStatus = "saving";
            state.saveFailed = false;
            state.saveError = null;
            updateSqlEntry(sqlTabId, { saveStatus: "saving", saveFailed: false, saveError: null });
            emit();
            await flushSqlDraft(sqlTabId, owner);
            const current = sqlStateFor(sqlTabId);
            return { sqlTabId, dirty: current.dirty, saveFailed: current.saveFailed, externalConflict: current.externalConflict };
        },

        async renameSqlFile(sqlTabId, rawName, expectedVersion) {
            if (!hasDatabase(session))
                return { error: "DATABASE_REQUIRED" };
            const entry = sqlEntryById(sqlTabId);
            if (!entry)
                return { error: "QUERY_TAB_REQUIRED" };
            if (entry.reserved || entry.name?.toLowerCase() === "console.sql")
                return { error: "FILE_RESERVED" };
            const name = validateFileName(rawName);
            const api = filesApi();
            const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
            const result = await api.renameSqlFile(namespace, entry.name, name, expectedVersion || entry.observedVersion);
            const file = result.file;
            const nextEntry = { ...entry, name: file.name, title: file.name, path: file.path, observedVersion: result.version };
            session.sqlRegistry = { ...session.sqlRegistry, byId: { ...session.sqlRegistry.byId, [sqlTabId]: nextEntry } };
            const state = session.sqlState.get(entry.key);
            if (state)
                state.observedVersion = result.version;
            setSqlFiles([...session.sqlFiles.filter((item) => item.name !== entry.name), file]);
            emit();
            return { sqlTabId, name: file.name, file, renamed: true };
        },

        async trashSqlFile(sqlTabId) {
            if (!hasDatabase(session))
                return { error: "DATABASE_REQUIRED" };
            const entry = sqlEntryById(sqlTabId);
            if (!entry)
                return { error: "QUERY_TAB_REQUIRED" };
            if (entry.reserved || entry.name?.toLowerCase() === "console.sql")
                return { error: "FILE_RESERVED" };
            const unsaved = confirmSqlAction(entry, "Delete");
            if (unsaved) {
                const result = await unsaved;
                if (result)
                    return result;
                if (sqlEntryById(sqlTabId) !== entry)
                    return { error: "QUERY_TAB_REQUIRED" };
            }
            let choice;
            try {
                choice = await adapters.confirm?.({
                    title: "Move SQL file to Trash?",
                    message: `Move ${entry.name} to the Finder Trash?`,
                    buttons: ["Delete", "Cancel"],
                    cancel: "Cancel",
                    style: "warning",
                });
            }
            catch {
                return { error: "CONFIRMATION_FAILED" };
            }
            if (choice !== "Delete")
                return { outcome: "cancelled" };
            const api = filesApi();
            const namespace = session.sqlNamespace || await api.getNamespace({ conn: session.conn, database: currentDatabase(session) });
            await api.trashSqlFile(namespace, entry.name, entry.observedVersion);
            setSqlFiles(session.sqlFiles.filter((item) => item.name !== entry.name));
            const closed = coordinator.closeSqlNow(sqlTabId);
            return { outcome: "trashed", sqlTabId, activeId: closed.activeId };
        },

        activateSql(sqlTabId) {
            if (!sqlEntryById(sqlTabId))
                return { error: "QUERY_TAB_REQUIRED" };
            session.sqlRegistry = { ...session.sqlRegistry, activeId: sqlTabId };
            session.surface = "console";
            emit();
            return { activeId: sqlTabId };
        },

        closeSql(sqlTabId) {
            const entry = sqlEntryById(sqlTabId);
            if (!entry)
                return { error: "QUERY_TAB_REQUIRED" };
            const guard = confirmSqlAction(entry, "Close");
            if (guard)
                return guard.then((result) => result || coordinator.closeSqlNow(sqlTabId));
            return coordinator.closeSqlNow(sqlTabId);
        },

        closeSqlNow(sqlTabId) {
            const entry = sqlEntryById(sqlTabId);
            if (!entry)
                return { error: "QUERY_TAB_REQUIRED" };
            const index = session.sqlRegistry.order.indexOf(sqlTabId);
            const order = session.sqlRegistry.order.filter((id) => id !== sqlTabId);
            const nextActive = session.sqlRegistry.activeId === sqlTabId ? order[Math.max(0, index - 1)] || order[0] || null : session.sqlRegistry.activeId;
            const { [sqlTabId]: _, ...byId } = session.sqlRegistry.byId;
            const owner = session.sqlOwners.get(entry.key);
            if (owner?.saveTimer)
                clearTimeout(owner.saveTimer);
            session.sqlRegistry = { order, activeId: nextActive, byId };
            session.sqlState.delete(entry.key);
            session.sqlOwners.delete(entry.key);
            emit();
            return { activeId: nextActive };
        },

        loadTableInfo(objectRef, operationCtx = captureOperationCtx()) {
            if (!objectRef?.table)
                return Promise.reject(new Error("INVALID_OBJECT_REF"));
            const key = objectCacheKey(objectRef);
            if (session.infoCache.has(key))
                return Promise.resolve(session.infoCache.get(key));
            if (session.tableInfoRequests.has(key))
                return session.tableInfoRequests.get(key);
            const scopeEpoch = session.scopeGeneration || 0;
            const catalogToken = session.catalogToken;
            let request;
            request = session.driver.tableInfo(operationCtx, objectRef).then((info) => {
                if ((session.scopeGeneration || 0) !== scopeEpoch || session.catalogToken !== catalogToken || session.tableInfoRequests.get(key) !== request)
                    throw new Error("Table metadata request is stale.");
                session.infoCache.set(key, info);
                session.tableInfoErrors.delete(key);
                return info;
            }).catch((error) => {
                if ((session.scopeGeneration || 0) === scopeEpoch && session.catalogToken === catalogToken && session.tableInfoRequests.get(key) === request)
                    session.tableInfoErrors.set(key, error);
                throw error;
            }).finally(() => {
                if (session.tableInfoRequests.get(key) === request)
                    session.tableInfoRequests.delete(key);
            });
            session.tableInfoRequests.set(key, request);
            return request;
        },

        openOrActivate(objectRef) {
            if (!objectRef?.table)
                return { error: "INVALID_OBJECT_REF" };
            const key = objectCacheKey(objectRef);
            const existingId = session.registry.order.find((id) => session.registry.byId[id]?.key === key);
            if (existingId !== undefined) {
                session.surface = "object";
                commit({ type: "ACTIVATE", id: existingId });
                return { workspaceId: existingId, created: false, activeId: session.registry.activeId };
            }
            const workspaceId = ++session.workspaceIdCounter;
            const generation = ++session.workspaceGenerationCounter;
            dataRuntimeFor(session, key, objectRef, undefined, workspaceId, generation);
            if (!(session.queryState instanceof Map))
                session.queryState = new Map();
            session.queryState.set(key, { sql: "", results: null, exportContext: null, queryRunning: false, queryError: null, executionMarker: null });
            session.surface = "object";
            commit({ type: "OPEN", id: workspaceId, key, generation, ref: objectRef });
            return { workspaceId, created: true, activeId: session.registry.activeId };
        },

        setActive(workspaceId) {
            if (!entryById(workspaceId))
                return STALE_WORKSPACE;
            session.surface = "object";
            commit({ type: "ACTIVATE", id: workspaceId });
            return { activeId: session.registry.activeId };
        },

        close(workspaceId) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            const pendingCount = pendingChangeCountFor(session.changes, entry.key);
            if (!pendingCount)
                return closeWorkspace(entry);
            return (async () => {
                let choice;
                try {
                    choice = await adapters.confirm?.({
                        title: "Discard pending changes?",
                        message: `Closing ${entry.ref.table} will discard ${pendingCount} unapplied change${pendingCount === 1 ? "" : "s"}.`,
                        buttons: ["Close", "Cancel"],
                        cancel: "Cancel",
                        style: "warning",
                    });
                }
                catch {
                    return { error: "CONFIRMATION_FAILED" };
                }
                if (choice !== "Close")
                    return { outcome: "cancelled" };
                if (!isCurrentEntry(entry))
                    return STALE_WORKSPACE;
                return closeWorkspace(entry);
            })();
        },

        changeView(workspaceId, view) {
            if (!WORKSPACE_VIEWS.includes(view))
                return { error: "INVALID_VIEW" };
            if (!entryById(workspaceId))
                return STALE_WORKSPACE;
            if (session.surface === "console")
                session.consoleToken += 1;
            session.surface = "object";
            commit({ type: "SET_VIEW", id: workspaceId, view });
            return { view, registryRevision };
        },

        focusTableColumn(objectRef, columnName) {
            if (!columnName)
                return { error: "INVALID_COLUMN" };
            const opened = coordinator.openOrActivate(objectRef);
            if (opened.error)
                return opened;
            coordinator.changeView(opened.workspaceId, "data");
            const request = {
                token: ++session.columnFocusToken,
                workspaceId: opened.workspaceId,
                columnName,
            };
            session.columnFocus = request;
            adapters.notifyColumnFocus?.(request);
            return { ...request, created: opened.created };
        },

        consumeColumnFocus(token) {
            if (session.columnFocus?.token !== token)
                return false;
            session.columnFocus = null;
            adapters.notifyColumnFocus?.(null);
            return true;
        },

        onPendingChange(workspaceId) {
            if (!entryById(workspaceId))
                return STALE_WORKSPACE;
            emit();
            return { registryRevision };
        },

        dataOperationFor(workspaceId) {
            return dataOperationFor(session, workspaceId);
        },

        startDataOperation(workspaceId, kind, snapshot) {
            const operation = startDataOperation(session, workspaceId, kind, snapshot);
            if (!operation.error)
                emit();
            return operation;
        },

        settleDataOperation(snapshot) {
            const result = settleDataOperation(session, snapshot);
            if (result.outcome === "settled")
                emit();
            return result;
        },

        async refreshData(workspaceId) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            if (pendingChangeCountFor(session.changes, entry.key) > 0) {
                let choice;
                try {
                    choice = await adapters.confirm?.({
                        title: "Discard pending changes?",
                        message: "Refreshing Data will discard pending changes in this workspace.",
                        buttons: ["Refresh", "Cancel"],
                        cancel: "Cancel",
                        style: "warning",
                    });
                }
                catch {
                    return { error: "CONFIRMATION_FAILED" };
                }
                if (choice !== "Refresh")
                    return { outcome: "cancelled" };
                if (!isCurrentEntry(entry))
                    return STALE_WORKSPACE;
                clearChanges(session.changes.get(entry.key));
                adapters.notifyPending?.();
            }
            refreshDataRuntime(session, entry.key, entry.ref);
            adapters.notifyData?.();
            return { outcome: "started" };
        },

        async changeScope(nextScope) {
            const scopeRequestToken = ++session.scopeRequestToken;
            const target = { database: session.ctx.database, schema: session.ctx.schema };
            if (nextScope.database !== undefined) {
                target.database = nextScope.database;
                target.schema = session.conn.engine === "postgres" ? "public" : "";
            }
            if (nextScope.schema !== undefined)
                target.schema = nextScope.schema;
            let dirtyWorkspaceCount = 0;
            let totalChanges = 0;
            for (const workspaceId of session.registry.order) {
                const entry = session.registry.byId[workspaceId];
                const count = pendingChangeCountFor(session.changes, entry.key);
                if (count > 0) {
                    dirtyWorkspaceCount += 1;
                    totalChanges += count;
                }
            }
            const dirtySqlTabCount = session.sqlRegistry.order.filter((sqlTabId) => sqlNeedsUnsavedGuard(sqlEntryById(sqlTabId))).length;
            if (dirtyWorkspaceCount > 0 || dirtySqlTabCount > 0) {
                let choice;
                try {
                    const changeMessage = totalChanges ? `${totalChanges} unapplied change${totalChanges === 1 ? "" : "s"}` : "";
                    const sqlMessage = dirtySqlTabCount > 0 ? `${dirtySqlTabCount} SQL tab${dirtySqlTabCount === 1 ? "" : "s"} with unsaved changes` : "";
                    choice = await adapters.confirm?.({
                        title: "Discard pending changes?",
                        message: `${changeMessage}${changeMessage && sqlMessage ? " " : ""}${sqlMessage} will be lost when changing scope.`,
                        buttons: ["Change Scope", "Cancel"],
                        cancel: "Cancel",
                        style: "warning",
                    });
                }
                catch {
                    return { error: "CONFIRMATION_FAILED" };
                }
                if (choice !== "Change Scope")
                    return { outcome: "cancelled" };
            }
            if (session.scopeRequestToken !== scopeRequestToken)
                return { outcome: "cancelled", stale: true };
            const databaseChanged = target.database !== session.ctx.database;
            session.ctx.database = target.database;
            session.ctx.schema = target.schema;
            session.scopeGeneration = (session.scopeGeneration || 0) + 1;
            clearScopeRuntime({ clearSql: databaseChanged });
            const consoleApi = filesApi();
            const reloadConsole = databaseChanged
                && (session.consoleState.phase !== "missing" || session.sqlNamespace || adapters.sqlFiles)
                && typeof consoleApi.getNamespace === "function"
                && typeof consoleApi.listSqlFiles === "function";
            const consoleLoad = reloadConsole ? coordinator.enterConsole() : null;
            const catalog = await coordinator.initiateCatalogLoad();
            const console = consoleLoad ? await consoleLoad : null;
            return { outcome: "committed", scopeEpoch: session.scopeGeneration, catalog, ...(console ? { console, files: session.sqlFiles } : {}) };
        },

        async initiateCatalogLoad() {
            session.catalogToken += 1;
            const scopeEpoch = session.scopeGeneration || 0;
            const catalogToken = session.catalogToken;
            const operationCtx = captureOperationCtx();
            session.infoCache?.clear();
            session.tableInfoRequests.clear();
            session.tableInfoErrors.clear();
            let tables;
            let columnsMap;
            try {
                [tables, columnsMap] = await Promise.all([
                    session.driver.listTables(operationCtx),
                    session.driver.allColumns(operationCtx),
                ]);
            }
            catch (error) {
                if ((session.scopeGeneration || 0) !== scopeEpoch || session.catalogToken !== catalogToken)
                    return { operationCtx, scopeEpoch, catalogToken, stale: true, error };
                session.catalogError = error;
                adapters.notifyCatalog?.();
                return { operationCtx, scopeEpoch, catalogToken, error };
            }
            if ((session.scopeGeneration || 0) !== scopeEpoch || session.catalogToken !== catalogToken)
                return { operationCtx, scopeEpoch, catalogToken, stale: true };
            session.tables = tables;
            session.columnsMap = columnsMap;
            session.catalogError = null;
            adapters.notifyCatalog?.();
            return { operationCtx, scopeEpoch, catalogToken };
        },

        initiateDataRead(workspaceId, gridParams) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            const runtime = dataRuntimeFor(session, entry.key, entry.ref);
            const request = nextDataRequest(runtime, session);
            return { operationCtx: captureOperationCtx(), objectRef: entry.ref, ownership: ownershipFor(entry), dataToken: request.token, gridParams };
        },

        initiateDataApply(workspaceId, statements) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            if (!statements?.length)
                return { error: "INVALID_STATEMENTS" };
            return { operationCtx: captureOperationCtx(), objectRef: entry.ref, ownership: ownershipFor(entry), statements };
        },

        initiateDataCount(workspaceId, gridParams) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            const owner = session.workspaceOwners.get(entry.key);
            owner.dataCountRequest = (owner.dataCountRequest || 0) + 1;
            return { operationCtx: captureOperationCtx(), objectRef: entry.ref, ownership: ownershipFor(entry), countToken: owner.dataCountRequest, gridParams };
        },

        initiateQueryExecute(workspaceId, sql, mode, executionRange, isSqlTab) {
            if (workspaceId == null)
                return { error: "QUERY_TAB_REQUIRED" };
            const sqlEntry = isSqlTab === false ? null : sqlEntryById(workspaceId);
            if (sqlEntry) {
                if (!QUERY_MODES.includes(mode))
                    return { error: "INVALID_QUERY_MODE" };
                if (!sql?.trim())
                    return { error: "INVALID_SQL" };
                const owner = session.sqlOwners.get(sqlEntry.key);
                owner.queryRequest = (owner.queryRequest || 0) + 1;
                const state = session.sqlState.get(sqlEntry.key);
                state.queryRunning = true;
                state.executionMarker = executionRange ? { line: executionRange.line, status: "running" } : null;
                emit();
                return { operationCtx: captureOperationCtx(), tabId: workspaceId, tabGeneration: sqlEntry.generation, consoleEpoch: session.consoleEpoch, sqlTabId: workspaceId, sqlKey: sqlEntry.key, requestToken: owner.queryRequest, queryToken: owner.queryRequest, sql, mode, executionRange, executionMarker: state.executionMarker };
            }
            if (isSqlTab)
                return { error: "QUERY_TAB_REQUIRED" };
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            if (!QUERY_MODES.includes(mode))
                return { error: "INVALID_QUERY_MODE" };
            if (!sql?.trim())
                return { error: "INVALID_SQL" };
            const owner = session.workspaceOwners.get(entry.key);
            owner.queryRequest = (owner.queryRequest || 0) + 1;
            const state = session.queryState.get(entry.key);
            state.queryRunning = true;
            state.executionMarker = executionRange ? { line: executionRange.line, status: "running" } : null;
            emit();
            return { operationCtx: captureOperationCtx(), objectRef: entry.ref, ownership: ownershipFor(entry), requestToken: owner.queryRequest, queryToken: owner.queryRequest, sql, mode, executionRange, executionMarker: state.executionMarker };
        },

        initiateStructureRead(workspaceId) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            const owner = session.workspaceOwners.get(entry.key);
            owner.structureRequest = (owner.structureRequest || 0) + 1;
            return { operationCtx: captureOperationCtx(), objectRef: entry.ref, ownership: ownershipFor(entry), structureToken: owner.structureRequest };
        },

        initiateStructureWrite(workspaceId, sql, operation) {
            const entry = entryById(workspaceId);
            if (!entry)
                return STALE_WORKSPACE;
            if (!STRUCTURE_OPERATIONS.includes(operation))
                return { error: "INVALID_STRUCTURE_OPERATION" };
            if (!sql?.trim())
                return { error: "INVALID_SQL" };
            return { operationCtx: captureOperationCtx(), objectRef: entry.ref, ownership: ownershipFor(entry), sql, operation };
        },

        async onObjectDeleted(objectRef) {
            const workspaceId = session.registry.order.find((id) => sameObjectRef(session.registry.byId[id]?.ref, objectRef));
            if (workspaceId === undefined)
                return { error: "INVALID_OBJECT_REF" };
            const entry = session.registry.byId[workspaceId];
            closeWorkspace(entry);
            const catalog = await coordinator.initiateCatalogLoad();
            return { closedWorkspaceId: workspaceId, activeId: session.registry.activeId, catalog };
        },

        async confirmWindowClose() {
            let dirtyWorkspaceCount = 0;
            let totalChanges = 0;
            for (const workspaceId of session.registry.order) {
                const entry = session.registry.byId[workspaceId];
                const count = pendingChangeCountFor(session.changes, entry.key);
                if (count > 0) {
                    dirtyWorkspaceCount += 1;
                    totalChanges += count;
                }
            }
            const dirtySqlTabCount = session.sqlRegistry.order.filter((sqlTabId) => sqlNeedsUnsavedGuard(sqlEntryById(sqlTabId))).length;
            if (!dirtyWorkspaceCount && !dirtySqlTabCount) {
                clearWindowRuntime();
                return { allowClose: true, dirtyWorkspaceCount: 0 };
            }
            let choice;
            try {
                const closeMessage = totalChanges ? `${totalChanges} unapplied change${totalChanges === 1 ? "" : "s"}` : "";
                const sqlMessage = dirtySqlTabCount > 0 ? `${dirtySqlTabCount} SQL tab${dirtySqlTabCount === 1 ? "" : "s"} with unsaved changes` : "";
                choice = await adapters.confirm?.({
                    title: "Discard pending changes?",
                    message: `${closeMessage}${closeMessage && sqlMessage ? " " : ""}${sqlMessage} will be lost.`,
                    buttons: ["Discard & Close", "Cancel"],
                    cancel: "Cancel",
                    style: "warning",
                });
            }
            catch {
                return { allowClose: false, dirtyWorkspaceCount, error: "CONFIRMATION_FAILED" };
            }
            const allowClose = choice === "Discard & Close";
            if (allowClose)
                clearWindowRuntime();
            return dirtySqlTabCount > 0 ? { allowClose, dirtyWorkspaceCount, dirtySqlTabCount } : { allowClose, dirtyWorkspaceCount };
        },
    };
    session.coordinator = coordinator;
    return coordinator;
}
