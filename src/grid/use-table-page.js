import { useEffect, useState } from "react";
import { buildSelect } from "../lib/sql/select-builder.js";
import { createChanges, isEditable } from "./pending-changes.js";
import { dataRuntimeFor, isCurrentDataRuntime, nextDataRequest } from "../workbench/data-runtime.js";

const GRID_KEYS = ["page", "rawWhere", "rawOrderBy"];

function sameValue(left, right) {
    if (left === right)
        return true;
    if (Array.isArray(left) && Array.isArray(right))
        return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
    if (left && right && typeof left === "object" && typeof right === "object") {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        return [...keys].every((key) => sameValue(left[key], right[key]));
    }
    return false;
}

function sameGridState(left, right) {
    return !!left && !!right && GRID_KEYS.every((key) => sameValue(left[key], right[key]));
}

function freezeSnapshot(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        freezeSnapshot(child);
    return Object.freeze(value);
}

function snapshotGridState(gridState) {
    return freezeSnapshot({
        page: gridState.page,
        rawWhere: gridState.rawWhere,
        rawOrderBy: gridState.rawOrderBy,
    });
}

function snapshotDriverContext(ctx) {
    const snapshot = { ...ctx };
    if (ctx.endpoint)
        snapshot.endpoint = { ...ctx.endpoint };
    if (ctx.conn) {
        snapshot.conn = { ...ctx.conn };
        if (ctx.conn.net)
            snapshot.conn.net = { ...ctx.conn.net };
        if (ctx.conn.ssh)
            snapshot.conn.ssh = { ...ctx.conn.ssh };
    }
    return freezeSnapshot(snapshot);
}

export function cachedPageFor(runtime, gridState, dataRevision, workspaceId, scopeEpoch, generation, token) {
    return runtime.cache
        && runtime.dataRevision === dataRevision
        && sameGridState(runtime.gridState, gridState)
        && isCurrentDataRuntime(runtime, workspaceId, scopeEpoch, generation, token)
        ? runtime.cache
        : null;
}

export function targetIsCurrent(session, target, runtime, request) {
    const entry = session.registry?.byId?.[target.workspaceId];
    if (!entry || entry.generation !== target.workspaceGeneration)
        return false;
    return session.dataRuntime?.get(target.workspaceKey) === runtime
        && (session.scopeGeneration || 0) === target.scopeEpoch
        && target.dataRevision === request.dataRevision
        && sameGridState(runtime.gridState, target.gridState)
        && isCurrentDataRuntime(runtime, target.workspaceId, target.scopeEpoch, target.workspaceGeneration, request.token);
}

async function tableInfoFor(session, target) {
    const key = target.workspaceKey;
    if (session.infoCache?.has(key))
        return session.infoCache.get(key);
    return session.coordinator.loadTableInfo(target.tableRef, target.driverContext);
}

function changesFor(session, target, info) {
    const existing = session.changes?.get(target.workspaceKey);
    if (existing && (existing.info === info || existing.info?.columns))
        return existing;
    return createChanges(session.conn.engine, target.tableRef, info);
}

function buildPage(info, changes, target, raw, started) {
    const resultColumns = raw.columns.length ? raw.columns : info.columns.map((column) => ({ name: column.name }));
    const hiddenIndex = resultColumns.findIndex((column) => column.name === "__rowid");
    const displayColumns = resultColumns.filter((_, index) => index !== hiddenIndex);
    const infoByName = new Map(info.columns.map((column) => [column.name, column]));
    for (const column of displayColumns) {
        const infoColumn = infoByName.get(column.name);
        column.type = infoColumn?.type || "";
        column.comment = infoColumn?.comment;
    }
    const displayRows = raw.rows.map((row) => row.filter((_, index) => index !== hiddenIndex));
    const editable = target.tableRef.kind !== "view" && isEditable(changes);
    const keyIndexes = editable
        ? changes.keyColumns.map((column) => (column === "__rowid" ? hiddenIndex : resultColumns.findIndex((entry) => entry.name === column)))
        : [];
    const keyValuesFor = (row) => keyIndexes.map((index) => raw.rows[row][index]);
    return {
        loading: false,
        info,
        changes,
        editable,
        displayColumns,
        displayRows,
        keyValuesFor,
        elapsed: Math.round(performance.now() - started),
    };
}

export async function loadTablePage(session, target, runtime, request) {
    const info = await tableInfoFor(session, target);
    const changes = changesFor(session, target, info);
    const editable = target.tableRef.kind !== "view" && isEditable(changes);
    const useRowid = changes.keyColumns?.[0] === "__rowid";
    const sql = buildSelect(session.conn.engine, target.tableRef, {
        rawWhere: target.gridState.rawWhere,
        rawOrderBy: target.gridState.rawOrderBy,
        limit: session.pageSize,
        offset: target.gridState.page * session.pageSize,
        rowid: useRowid,
    });
    const started = performance.now();
    const results = await session.driver.runQuery(target.driverContext, sql, { timeoutMs: session.timeoutMs });
    return buildPage(info, changes, target, results[0], started);
}

export function useTablePage(session, tableRef, gridState, workspaceKey, dataRevision, workspaceId) {
    const [result, setResult] = useState({ loading: true });

    useEffect(() => {
        let cancelled = false;
        const runtime = dataRuntimeFor(session, workspaceKey, tableRef, undefined, workspaceId);
        const scopeEpoch = session.scopeGeneration || 0;
        const target = freezeSnapshot({
            tableRef: freezeSnapshot({ ...tableRef }),
            gridState: snapshotGridState(gridState),
            workspaceKey,
            dataRevision,
            workspaceId,
            workspaceGeneration: runtime.generation,
            scopeEpoch,
            generation: runtime.generation,
            driverContext: snapshotDriverContext(session.ctx),
        });
        const cached = cachedPageFor(runtime, target.gridState, dataRevision, target.workspaceId, target.scopeEpoch, runtime.generation, runtime.token);
        if (cached) {
            setResult(cached);
            return () => { cancelled = true; };
        }

        const request = { ...nextDataRequest(runtime, session), dataRevision };
        runtime.gridState = target.gridState;
        setResult({ loading: true });
        loadTablePage(session, target, runtime, request).then((page) => {
            if (cancelled || !targetIsCurrent(session, target, runtime, request))
                return;
            runtime.changes = page.changes;
            session.changes.set(workspaceKey, page.changes);
            runtime.cache = page;
            runtime.dataRevision = dataRevision;
            session.dataCache.set(workspaceKey, page);
            session.infoCache.set(workspaceKey, page.info);
            setResult(page);
        }).catch((error) => {
            if (cancelled || !targetIsCurrent(session, target, runtime, request))
                return;
            setResult({ loading: false, error: error.message });
        });
        return () => { cancelled = true; };
    }, [session, tableRef, gridState, workspaceKey, dataRevision, workspaceId]);

    return result;
}
