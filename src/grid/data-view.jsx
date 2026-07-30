import { useEffect, useReducer, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { buildCount } from "../lib/sql/select-builder.js";
import { buildChangeScript } from "../lib/sql/change-script.js";
import { copyResult } from "../transfer/transfer.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { setEdit, toggleDelete, addInsert, removeInsert, clearChanges } from "./pending-changes.js";
import { useTablePage } from "./use-table-page.js";
import { DataGrid } from "./data-grid.jsx";
import { FilterBar } from "./filter-bar.jsx";
import { Pager } from "./pager.jsx";
import { nextOrderBy, parseOrderBy } from "./order-by.js";
import { PendingBar } from "./pending-bar.jsx";
import { ReviewSheet } from "./review-sheet.jsx";
import { CellViewerModal } from "./cell-viewer.jsx";
import { useSession } from "../workbench/session-context.jsx";
import { objectCacheKey, isCurrentDataApply, isCurrentDataCount } from "../workbench/workspace-state.js";
import { dataRuntimeFor, initialGridState, invalidateDataRuntime } from "../workbench/data-runtime.js";

export function gridStateFor(session, ref) {
    const key = objectCacheKey(ref);
    if (!session.gridState.has(key))
        session.gridState.set(key, { ...initialGridState });
    return session.gridState.get(key);
}

export function pendingChangeCount(session) {
    let total = 0;
    for (const changes of session.changes?.values() || []) {
        let edits = 0;
        for (const entry of changes.edits.values())
            edits += entry.cells.size;
        total += edits + changes.deletes.size + changes.inserts.length;
    }
    return total;
}

async function copyText(text) {
    await copyToClipboard(text);
    toast("Copied");
}

export function DataView({ session, tableRef, workspaceId, setStatus }) {
    const { notifyPendingChanges, refreshData } = useSession();
    const coordinator = session.coordinator;
    const activeWorkspaceKey = objectCacheKey(tableRef);
    const runtime = dataRuntimeFor(session, activeWorkspaceKey, tableRef, undefined, workspaceId);
    const [gridState, setGridState] = useState(() => ({ ...runtime.gridState, ...gridStateFor(session, tableRef) }));
    const [draftWhere, setDraftWhere] = useState(gridState.rawWhere);
    const [draftOrderBy, setDraftOrderBy] = useState(gridState.rawOrderBy);
    const [, bumpChanges] = useReducer((n) => n + 1, 0);
    const [editing, setEditing] = useState(null);
    const [review, setReview] = useState(null);
    const [viewerValue, setViewerValue] = useState(undefined);
    const bumpPendingChanges = () => {
        bumpChanges();
        notifyPendingChanges();
    };

    const page = useTablePage(session, tableRef, gridState, activeWorkspaceKey, runtime.dataRevision, workspaceId);

    useEffect(() => {
        if (!page.loading && !page.error)
            setStatus(`${tableRef.table} · ${page.displayRows.length} rows · ${page.elapsed}ms`);
    }, [page, tableRef, setStatus]);

    const commitGrid = (patch) => {
        const next = { ...session.gridState.get(activeWorkspaceKey), ...gridState, ...patch };
        setGridState(next);
        session.gridState.set(activeWorkspaceKey, next);
    };

    const queryBar = (
        <FilterBar
            rawWhere={draftWhere}
            rawOrderBy={draftOrderBy}
            initialRatio={gridState.querySplit}
            onWhereChange={setDraftWhere}
            onOrderByChange={setDraftOrderBy}
            onApply={() => commitGrid({ rawWhere: draftWhere, rawOrderBy: draftOrderBy, page: 0, total: null })}
            onRatioChange={(querySplit) => session.gridState.set(activeWorkspaceKey, {
                ...session.gridState.get(activeWorkspaceKey),
                querySplit,
            })}
        />
    );

    if (page.loading)
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                {queryBar}
                <div className="flex h-full items-center justify-center text-muted-foreground">Loading…</div>
            </div>
        );

    if (page.error)
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                {queryBar}
                <div className="p-[var(--s6)]"><div className="error-box">{page.error}</div></div>
            </div>
        );

    const model = page.changes;
    const changes = {
        model,
        setEdit: (keyValues, column, value, original) => setEdit(model, keyValues, column, value, original),
        toggleDelete: (keyValues) => toggleDelete(model, keyValues),
        removeInsert: (id) => removeInsert(model, id),
    };

    const contextItemsFor = (value, r) => [
        { label: "View cell", onClick: () => setViewerValue(value) },
        { label: "Copy cell", onClick: () => copyText(value === null ? "" : String(value)) },
        { label: "Copy row as JSON", onClick: () => copyResult(session.conn.engine, tableRef, { columns: page.displayColumns, rows: [page.displayRows[r]] }, "json") },
        { label: "Copy row as INSERT", onClick: () => copyResult(session.conn.engine, tableRef, { columns: page.displayColumns, rows: [page.displayRows[r]] }, "sql") },
    ];

    const openReview = (applyDirectly) => {
        const statements = buildChangeScript(model);
        if (!statements.length) {
            clearChanges(model);
            bumpPendingChanges();
            return;
        }
        if (applyDirectly)
            apply(statements);
        else
            setReview(statements);
    };

    const apply = async (statements) => {
        setStatus("Applying changes…");
        const snapshot = coordinator.initiateDataApply(workspaceId, statements);
        if (snapshot.error) {
            setStatus("Apply failed");
            toast(snapshot.error, "warning");
            return;
        }
        try {
            await session.driver.runScript(snapshot.operationCtx, statements.join("\n"), { timeoutMs: session.timeoutMs });
            if (isCurrentDataApply(session, snapshot.ownership)) {
                clearChanges(model);
                notifyPendingChanges();
                invalidateDataRuntime(runtime);
                commitGrid({ total: null });
                toast(`Applied ${statements.length} statement${statements.length === 1 ? "" : "s"}`, "success");
            }
        } catch (error) {
            if (isCurrentDataApply(session, snapshot.ownership)) {
                setStatus("Apply failed");
                toast(error.message, "warning");
            }
        }
    };

    const addRow = () => {
        const insert = addInsert(model);
        bumpPendingChanges();
        setEditing({ kind: "insert", insertId: insert.id, column: page.displayColumns[0]?.name });
    };

    const readOnlyBanner = !page.editable && tableRef.kind !== "view";
    const sortDirections = parseOrderBy(session.conn.engine, gridState.rawOrderBy, page.displayColumns);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {queryBar}
            {readOnlyBanner ? (
                <div
                    className="flex h-[var(--statusbar-height)] items-center gap-[var(--s3)] border-b px-[var(--s5)] text-[var(--font-footnote)] text-muted-foreground"
                    style={{ borderColor: "var(--muxy-border)" }}
                >
                    <Icon name="info" size={12} />
                    Read-only: this table has no primary key
                </div>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col">
                <DataGrid
                    page={page}
                    changes={changes}
                    editable={page.editable}
                    onChange={bumpPendingChanges}
                    editing={editing}
                    setEditing={setEditing}
                    onContextItems={contextItemsFor}
                    onViewCell={(value) => setViewerValue(value)}
                    sortDirections={sortDirections}
                    onSort={(column) => {
                        const rawOrderBy = nextOrderBy(session.conn.engine, draftOrderBy, column, page.displayColumns);
                        setDraftOrderBy(rawOrderBy);
                        commitGrid({ rawOrderBy, page: 0 });
                    }}
                />
            </div>
            <PendingBar
                changes={model}
                onReview={() => openReview(false)}
                onDiscard={() => { clearChanges(model); bumpPendingChanges(); }}
                onApply={() => openReview(true)}
            />
            <div className="toolbar-footer border-t" style={{ borderColor: "var(--muxy-border)" }}>
                <button className="icon-btn" onClick={refreshData} title="Refresh data">
                    <Icon name="refresh" />
                </button>
                <Pager
                    page={gridState.page}
                    pageSize={session.pageSize}
                    rowsOnPage={page.displayRows.length}
                    total={gridState.total}
                    onPage={(p) => commitGrid({ page: Math.max(0, p) })}
                    onCount={async () => {
                        const snapshot = coordinator.initiateDataCount(workspaceId, gridState);
                        if (snapshot.error) {
                            setStatus("Count failed");
                            toast(snapshot.error, "warning");
                            return;
                        }
                        try {
                            const countResults = await session.driver.runQuery(
                                snapshot.operationCtx,
                                buildCount(session.conn.engine, snapshot.objectRef, snapshot.gridParams),
                                { timeoutMs: session.timeoutMs },
                            );
                            if (isCurrentDataCount(session, snapshot))
                                commitGrid({ total: Number(countResults[0]?.rows?.[0]?.[0] ?? 0) });
                        }
                        catch (error) {
                            if (isCurrentDataCount(session, snapshot)) {
                                setStatus("Count failed");
                                toast(error.message, "warning");
                            }
                        }
                    }}
                >
                    {page.editable ? (
                        <button className="btn btn-compact" onClick={addRow}>
                            <Icon name="plus" />
                            Row
                        </button>
                    ) : null}
                </Pager>
            </div>
            {review ? (
                <ReviewSheet
                    statements={review}
                    onClose={() => setReview(null)}
                    onApply={() => { const s = review; setReview(null); apply(s); }}
                />
            ) : null}
            {viewerValue !== undefined ? <CellViewerModal value={viewerValue} onClose={() => setViewerValue(undefined)} /> : null}
        </div>
    );
}
