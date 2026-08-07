import { objectCacheKey, sameObjectRef } from "./workspace-state.js";

function finishExecution(state, request, status, diagnostic) {
    if (!request.executionMarker)
        return;
    state.executionMarker = diagnostic
        ? { ...request.executionMarker, status, diagnostic }
        : { ...request.executionMarker, status };
}

export function isCurrentQueryRequest(session, request) {
    if (request?.tabId != null || request?.sqlTabId != null) {
        const tabId = request.tabId ?? request.sqlTabId;
        const entry = session.sqlRegistry?.byId?.[tabId];
        const requestToken = request.requestToken ?? request.queryToken;
        return Boolean(entry
            && entry.key === request.sqlKey
            && entry.generation === request.tabGeneration
            && session.sqlOwners?.get(entry.key)?.queryRequest === requestToken
            && session.consoleEpoch === request.consoleEpoch);
    }
    const ownership = request?.ownership;
    if (!ownership || !session.registry)
        return false;
    const entry = session.registry.byId?.[ownership.workspaceId];
    if (!entry || entry.generation !== ownership.generation || !sameObjectRef(entry.ref, request.objectRef))
        return false;
    if ((session.scopeGeneration || 0) !== ownership.scopeEpoch)
        return false;
    return session.workspaceOwners?.get(entry.key)?.queryRequest === (request.requestToken ?? request.queryToken);
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
    state.queryError = null;
    state.queryRunning = false;
    finishExecution(state, request, "success");
    state.exportContext = exportable ? { objectRef: request.objectRef, result: exportable } : null;
    return true;
}

export function commitQueryError(session, request, message, diagnostic) {
    if (!isCurrentQueryRequest(session, request))
        return false;
    const state = request.sqlKey ? session.sqlState?.get(request.sqlKey) : session.queryState?.get(objectCacheKey(request.objectRef));
    if (!state)
        return false;
    state.queryError = message;
    state.queryRunning = false;
    finishExecution(state, request, "error", diagnostic);
    return true;
}
