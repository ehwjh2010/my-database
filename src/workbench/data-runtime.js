import { createChanges } from "../grid/pending-changes.js";

export const initialGridState = Object.freeze({ page: 0, rawWhere: "", rawOrderBy: "", total: null, querySplit: 50 });

export function createDataRuntime(workspaceId, scopeEpoch, generation, options = {}) {
    return {
        key: options.key || null,
        workspaceId,
        scopeEpoch,
        token: options.token || 0,
        generation,
        gridState: options.gridState || { ...initialGridState },
        cache: options.cache || null,
        dataRevision: options.dataRevision || 0,
        changes: options.changes || createChanges(options.engine, options.ref, options.info || { primaryKey: [], rowid: false }),
        revision: options.revision || 0,
        stale: false,
    };
}

function ensureMap(session, name) {
    if (!(session[name] instanceof Map))
        session[name] = new Map();
    return session[name];
}

function ownerEntryFor(session, key) {
    const owners = ensureMap(session, "workspaceOwners");
    const entry = owners.get(key) || { dataRequest: 0, structureRequest: 0 };
    if (!entry.owner)
        entry.owner = {};
    owners.set(key, entry);
    return entry;
}

export function dataRuntimeFor(session, key, ref, info, workspaceId, generation) {
    const runtimes = ensureMap(session, "dataRuntime");
    if (runtimes.has(key))
        return runtimes.get(key);

    const ownerEntry = ownerEntryFor(session, key);
    const gridState = ensureMap(session, "gridState");
    const dataCache = ensureMap(session, "dataCache");
    const changes = ensureMap(session, "changes");
    const runtime = createDataRuntime(workspaceId ?? null, session.scopeGeneration || 0, generation ?? (session.scopeGeneration || 0), {
        key,
        token: ownerEntry.dataRequest,
        revision: ownerEntry.dataRevision || 0,
        dataRevision: ownerEntry.dataRevision || 0,
        gridState: gridState.get(key) || { ...initialGridState },
        cache: dataCache.get(key) || null,
        changes: changes.get(key) || createChanges(session.conn?.engine, ref, info || { primaryKey: [], rowid: false }),
        engine: session.conn?.engine,
        ref,
        info,
    });
    runtime.key = key;
    runtimes.set(key, runtime);
    gridState.set(key, runtime.gridState);
    dataCache.set(key, runtime.cache);
    changes.set(key, runtime.changes);
    return runtime;
}

export function nextDataRequest(runtime, session) {
    runtime.token += 1;
    runtime.revision += 1;
    runtime.stale = false;
    if (session && runtime.key)
        Object.assign(ownerEntryFor(session, runtime.key), { dataRequest: runtime.token, dataRevision: runtime.revision });
    return { owner: runtime.owner, token: runtime.token, generation: runtime.generation, revision: runtime.revision };
}

export function invalidateDataRuntime(runtime) {
    runtime.token += 1;
    runtime.revision += 1;
    runtime.stale = true;
    return runtime;
}

export function refreshDataRuntime(session, key, ref) {
    const runtime = dataRuntimeFor(session, key, ref);
    runtime.cache = null;
    runtime.dataRevision += 1;
    session.dataCache?.delete(key);
    invalidateDataRuntime(runtime);
    const owner = session.workspaceOwners?.get(key);
    if (owner)
        owner.dataRequest = runtime.token;
    return runtime;
}

export function isCurrentDataRuntime(runtime, workspaceId, scopeEpoch, generation, token) {
    if (runtime.stale)
        return false;
    return runtime.workspaceId === workspaceId
        && runtime.scopeEpoch === scopeEpoch
        && runtime.generation === generation
        && runtime.token === token;
}

export function clearDataRuntime(session, key) {
    session.dataRuntime?.delete(key);
    session.dataCache?.delete(key);
    session.gridState?.delete(key);
    session.changes?.delete(key);
    session.workspaceOwners?.delete(key);
}

export function clearDataRuntimes(session) {
    session.dataRuntime?.clear();
    session.dataCache?.clear();
    session.gridState?.clear();
    session.changes?.clear();
    session.workspaceOwners?.clear();
}
