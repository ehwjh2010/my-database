import { toast } from "../ui/toast.js";
import { qualifiedName } from "../lib/sql/quote.js";
import { truncateSql } from "../lib/sql/truncate.js";
import { isCurrentDataApply, objectCacheKey, sameObjectRef } from "../workbench/workspace-state.js";
import { invalidateStructureSnapshot } from "../workbench/structure-runtime.js";

export { truncateSql };

export function dropSql(engine, tableRef) {
    return `DROP ${tableRef.kind === "view" ? "VIEW" : "TABLE"} ${qualifiedName(engine, tableRef)}`;
}

export function workspaceIdForObject(session, tableRef) {
    return session.registry.order.find((id) => sameObjectRef(session.registry.byId[id]?.ref, tableRef));
}

export function ensureObjectWorkspace(session, tableRef) {
    const existing = workspaceIdForObject(session, tableRef);
    if (existing !== undefined)
        return { workspaceId: existing };
    return session.coordinator.openOrActivate(tableRef);
}

async function confirmMutation(label, sql, enabled) {
    if (!enabled)
        return true;
    const choice = await muxy.dialog.confirm({
        title: label,
        message: `Run:\n\n${sql}`,
        buttons: [label, "Cancel"],
        cancel: "Cancel",
        style: "warning",
    });
    return choice === label;
}

export async function runStructureMutation(session, { tableRef, sql, label, operation, confirmDestructive }) {
    const opened = ensureObjectWorkspace(session, tableRef);
    if (opened.error)
        return { outcome: "error", error: opened.error };
    const snapshot = session.coordinator.initiateStructureWrite(opened.workspaceId, sql, operation);
    if (snapshot.error) {
        toast(snapshot.error, "warning");
        return { outcome: "error", error: snapshot.error };
    }
    if (!await confirmMutation(label, sql, confirmDestructive))
        return { outcome: "cancelled" };
    if (!isCurrentDataApply(session, snapshot.ownership))
        return { outcome: "stale" };
    try {
        await session.driver.runQuery(snapshot.operationCtx, snapshot.sql, { timeoutMs: session.timeoutMs });
        if (!isCurrentDataApply(session, snapshot.ownership))
            return { outcome: "stale" };
        toast(`${label} succeeded`, "success");
        invalidateStructureSnapshot(session, objectCacheKey(tableRef));
        session.coordinator.adapters?.notify?.();
        return { outcome: "ok", snapshot };
    }
    catch (error) {
        if (isCurrentDataApply(session, snapshot.ownership))
            toast(error.message, "warning");
        return { outcome: "error", error };
    }
}

export async function truncateTable(session, tableRef, confirmDestructive) {
    return runStructureMutation(session, {
        tableRef,
        sql: truncateSql(session.conn.engine, tableRef),
        label: "Truncate",
        operation: "truncate",
        confirmDestructive,
    });
}

export async function dropObject(session, tableRef, confirmDestructive) {
    const result = await runStructureMutation(session, {
        tableRef,
        sql: dropSql(session.conn.engine, tableRef),
        label: "Drop",
        operation: "drop",
        confirmDestructive,
    });
    if (result.outcome === "ok")
        await session.coordinator.onObjectDeleted(result.snapshot.objectRef);
    return result;
}
