import { objectCacheKey, sameObjectRef } from "./workspace-state.js";

export function isCurrentQueryRequest(session, request) {
    if (request?.sqlTabId != null) {
        const entry = session.sqlRegistry?.byId?.[request.sqlTabId];
        return Boolean(entry
            && entry.key === request.sqlKey
            && session.sqlOwners?.get(entry.key)?.queryRequest === request.queryToken
            && session.surface === "console");
    }
    const ownership = request?.ownership;
    if (!ownership || !session.registry)
        return false;
    const entry = session.registry.byId?.[ownership.workspaceId];
    if (!entry || entry.generation !== ownership.generation || !sameObjectRef(entry.ref, request.objectRef))
        return false;
    if ((session.scopeGeneration || 0) !== ownership.scopeEpoch)
        return false;
    return session.workspaceOwners?.get(entry.key)?.queryRequest === request.queryToken;
}

export function commitQueryResult(session, request, data) {
    if (!isCurrentQueryRequest(session, request))
        return false;
    const state = request.sqlKey ? session.sqlState?.get(request.sqlKey) : session.queryState?.get(objectCacheKey(request.objectRef));
    if (!state)
        return false;
    const result = { results: data };
    const exportable = data.find((entry) => entry.columns.length);
    state.results = result;
    state.exportContext = exportable ? { objectRef: request.objectRef, result: exportable } : null;
    return true;
}

export function commitQueryError(session, request, message) {
    if (!isCurrentQueryRequest(session, request))
        return false;
    const state = request.sqlKey ? session.sqlState?.get(request.sqlKey) : session.queryState?.get(objectCacheKey(request.objectRef));
    if (!state)
        return false;
    const result = { error: message };
    state.results = result;
    state.exportContext = null;
    return true;
}
