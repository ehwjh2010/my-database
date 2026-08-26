export const DATA_OPERATION_KINDS = Object.freeze(["idle", "apply", "import", "export"]);

function registryEntryFor(session, workspaceId) {
    const registryEntry = session.registry?.byId?.[workspaceId];
    if (!registryEntry)
        return null;
    return registryEntry;
}

function ownerFor(session, workspaceId, create) {
    const registryEntry = registryEntryFor(session, workspaceId);
    if (!registryEntry)
        return null;
    if (!(session.workspaceOwners instanceof Map)) {
        if (!create)
            return null;
        session.workspaceOwners = new Map();
    }
    const owner = session.workspaceOwners.get(registryEntry.key);
    if (!owner && !create)
        return null;
    const nextOwner = owner || {};
    if (!create)
        return { registryEntry, owner: nextOwner };
    if (!Object.hasOwn(nextOwner, "operationToken"))
        nextOwner.operationToken = 0;
    if (!Object.hasOwn(nextOwner, "operation"))
        nextOwner.operation = null;
    if (!owner)
        session.workspaceOwners.set(registryEntry.key, nextOwner);
    return { registryEntry, owner: nextOwner };
}

export function dataOperationFor(session, workspaceId) {
    const entry = ownerFor(session, workspaceId, false);
    const operation = entry?.owner.operation;
    if (!operation)
        return { kind: "idle", busy: false };
    return { kind: operation.kind, busy: true };
}

export function startDataOperation(session, workspaceId, kind, snapshot = {}) {
    if (!DATA_OPERATION_KINDS.includes(kind) || kind === "idle")
        return { error: "INVALID_OPERATION_KIND" };
    const entry = ownerFor(session, workspaceId, true);
    if (!entry)
        return { error: "STALE_WORKSPACE" };
    if (entry.owner.operation)
        return { error: "DATA_OPERATION_IN_PROGRESS" };
    const token = entry.owner.operationToken + 1;
    const operation = Object.freeze({
        ...snapshot,
        workspaceId,
        key: entry.registryEntry.key,
        kind,
        token,
        operationToken: token,
    });
    entry.owner.operationToken = token;
    entry.owner.operation = operation;
    return { ...operation, busy: true };
}

export function settleDataOperation(session, snapshot) {
    const workspaceId = snapshot?.workspaceId;
    const entry = ownerFor(session, workspaceId, false);
    if (!entry)
        return { outcome: "stale" };
    const current = entry.owner.operation;
    if (!current || current.kind !== snapshot.kind || current.token !== (snapshot.operationToken ?? snapshot.token))
        return { outcome: "stale" };
    entry.owner.operation = null;
    return { outcome: "settled" };
}

export function clearDataOperation(session, workspaceId) {
    const entry = ownerFor(session, workspaceId, false);
    if (!entry)
        return false;
    if (!entry.owner.operation)
        return false;
    entry.owner.operation = null;
    return true;
}
