import { objectCacheKey } from "./workspace-state.js";

export async function loadStructureSnapshot(session, read) {
    const info = await session.driver.tableInfo(read.operationCtx, read.objectRef);
    const ddl = await session.driver.ddl(read.operationCtx, read.objectRef);
    return { info, ddl };
}

export function isCurrentStructureRead(session, read) {
    const entry = session.registry?.byId?.[read.ownership.workspaceId];
    if (!entry || entry.generation !== read.ownership.generation)
        return false;
    if ((session.scopeGeneration || 0) !== read.ownership.scopeEpoch)
        return false;
    const owner = session.workspaceOwners?.get(entry.key);
    return owner?.structureRequest === read.structureToken;
}

export function commitStructureSnapshot(session, read, snapshot) {
    if (!isCurrentStructureRead(session, read))
        return false;
    const key = objectCacheKey(read.objectRef);
    session.structureCache.set(key, {
        snapshot,
        scopeEpoch: read.ownership.scopeEpoch,
        generation: read.ownership.generation,
        token: read.structureToken,
    });
    session.infoCache?.set(key, snapshot.info);
    return true;
}

export function cachedStructureSnapshot(session, key) {
    const entry = session.structureCache?.get(key);
    if (!entry)
        return null;
    if (entry.scopeEpoch !== (session.scopeGeneration || 0))
        return null;
    if (entry.token !== (session.workspaceOwners?.get(key)?.structureRequest ?? 0))
        return null;
    return entry.snapshot;
}

export function invalidateStructureSnapshot(session, key) {
    session.structureCache?.delete(key);
    session.infoCache?.delete(key);
}
