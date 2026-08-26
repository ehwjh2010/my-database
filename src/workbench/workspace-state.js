import { changeCount } from "../grid/pending-changes.js";

export const initialWorkspaceState = { order: [], activeId: null, byId: {} };

function countPendingEntry(changes) {
    if (!changes)
        return 0;
    return changeCount(changes);
}

export function pendingChangeCount(changes) {
    return changes instanceof Map ? pendingChangeCountAll(changes) : countPendingEntry(changes);
}

export function pendingChangeCountFor(changesByKey, key) {
    return countPendingEntry(changesByKey?.get(key));
}

export function pendingChangeCountAll(changesByKey) {
    let total = 0;
    for (const changes of changesByKey?.values() || [])
        total += countPendingEntry(changes);
    return total;
}

export function isCurrentScopeGeneration(currentGeneration, requestGeneration) {
    return currentGeneration === requestGeneration;
}

export function isCurrentOwnerToken(currentOwner, currentToken, requestOwner, requestToken) {
    return currentOwner === requestOwner && currentToken === requestToken;
}

export function isCurrentDataRequest({ owner, token, currentOwner, currentToken, generation, currentGeneration }) {
    return isCurrentOwnerToken(currentOwner, currentToken, owner, token)
        && isCurrentScopeGeneration(currentGeneration, generation);
}

export function isCurrentStructureRequest({ owner, token, currentOwner, currentToken, generation, currentGeneration }) {
    return isCurrentOwnerToken(currentOwner, currentToken, owner, token)
        && isCurrentScopeGeneration(currentGeneration, generation);
}

export function isCurrentQueryEntry(currentEntry, requestEntry) {
    return currentEntry === requestEntry;
}

export function isCurrentDataApply(session, ownership) {
    if (!ownership || !session.registry)
        return false;
    const entry = session.registry.byId?.[ownership.workspaceId];
    if (!entry)
        return false;
    if (entry.generation !== ownership.generation)
        return false;
    if ((session.scopeGeneration || 0) !== ownership.scopeEpoch)
        return false;
    return true;
}

export function isCurrentDataCount(session, request) {
    if (!request?.ownership || !isCurrentDataApply(session, request.ownership))
        return false;
    const entry = session.registry.byId[request.ownership.workspaceId];
    return sameObjectRef(entry.ref, request.objectRef)
        && session.workspaceOwners?.get(entry.key)?.dataCountRequest === request.countToken
        && session.gridState?.get(entry.key)?.rawWhere === request.gridParams?.rawWhere;
}

export function objectCacheKey({ database, schema, table }) {
    return JSON.stringify([database ?? "", schema ?? "", table]);
}

export function sameObjectRef(a, b) {
    return (a?.database ?? "") === (b?.database ?? "")
        && (a?.schema ?? "") === (b?.schema ?? "")
        && (a?.table ?? "") === (b?.table ?? "");
}

export function workspaceReducer(state, action) {
    switch (action.type) {
        case "OPEN": {
            if (state.byId[action.id])
                return { ...state, activeId: action.id };
            return {
                order: [...state.order, action.id],
                activeId: action.id,
                byId: {
                    ...state.byId,
                    [action.id]: { id: action.id, key: action.key, generation: action.generation, ref: Object.freeze({ ...action.ref }), view: "data" },
                },
            };
        }
        case "ACTIVATE":
            return state.byId[action.id] ? { ...state, activeId: action.id } : state;
        case "SET_VIEW":
            return state.byId[action.id]
                ? { ...state, byId: { ...state.byId, [action.id]: { ...state.byId[action.id], view: action.view } } }
                : state;
        case "CLOSE": {
            const index = state.order.indexOf(action.id);
            if (index < 0)
                return state;
            const order = state.order.filter((id) => id !== action.id);
            const { [action.id]: _, ...byId } = state.byId;
            return {
                order,
                activeId: state.activeId === action.id ? (order[index - 1] || order[index] || null) : state.activeId,
                byId,
            };
        }
        case "CLEAR_ALL":
            return initialWorkspaceState;
        default:
            return state;
    }
}
