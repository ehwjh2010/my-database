import { useEffect, useReducer, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { buildCount } from "../lib/sql/select-builder.js";
import { buildChangeScript } from "../lib/sql/change-script.js";
import { chooseExportPath, copyResult, exportCommittedObject } from "../transfer/transfer.js";
import { copyToClipboard } from "../lib/clipboard.js";
import { setEdit, toggleDelete, addInsert, removeInsert, clearChanges, isDeleted } from "./pending-changes.js";
import { useTablePage } from "./use-table-page.js";
import { DataGrid } from "./data-grid.jsx";
import { FilterBar } from "./filter-bar.jsx";
import { Pager } from "./pager.jsx";
import { nextOrderBy, parseOrderBy } from "./order-by.js";
import { DataToolbar } from "./data-toolbar.jsx";
import { ReviewSheet } from "./review-sheet.jsx";
import { CellViewerModal } from "./cell-viewer.jsx";
import { useSession } from "../workbench/session-context.jsx";
import { objectCacheKey, isCurrentDataApply, isCurrentDataCount, isCurrentDataExport } from "../workbench/workspace-state.js";
import { dataRuntimeFor, initialGridState, invalidateDataRuntime } from "../workbench/data-runtime.js";
import { changeCount } from "./pending-changes.js";
import { ObjectExportMenu } from "./object-export-menu.jsx";

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
    const { notifyPendingChanges, refreshData, columnFocus, consumeColumnFocus, dataOperation, setView } = useSession();
    const coordinator = session.coordinator;
    const activeWorkspaceKey = objectCacheKey(tableRef);
    const runtime = dataRuntimeFor(session, activeWorkspaceKey, tableRef, undefined, workspaceId);
    const [gridState, setGridState] = useState(() => ({ ...runtime.gridState, ...gridStateFor(session, tableRef) }));
    const [draftWhere, setDraftWhere] = useState(gridState.rawWhere);
    const [draftOrderBy, setDraftOrderBy] = useState(gridState.rawOrderBy);
    const [, bumpChanges] = useReducer((n) => n + 1, 0);
    const [editing, setEditing] = useState(null);
    const [selectedCell, setSelectedCell] = useState(null);
    const [scrollTarget, setScrollTarget] = useState(null);
    const [review, setReview] = useState(null);
    const [viewerValue, setViewerValue] = useState(undefined);
    const [exportOpen, setExportOpen] = useState(false);
    const bumpPendingChanges = () => {
        bumpChanges();
        notifyPendingChanges();
    };

    const page = useTablePage(session, tableRef, gridState, activeWorkspaceKey, runtime.dataRevision, workspaceId);
    const selectionIsCurrent = Boolean(selectedCell
        && selectedCell.workspaceId === workspaceId
        && selectedCell.objectKey === activeWorkspaceKey
        && selectedCell.dataRevision === runtime.dataRevision
        && page.displayRows?.[selectedCell.row]
        && page.changes
        && !isDeleted(page.changes, selectedCell.keyValues));

    const toolbarInput = {
        hasObject: Boolean(tableRef),
        pageState: page.loading ? "loading" : page.error ? "error" : page.displayRows.length ? "ready" : "empty",
        editable: Boolean(page.editable),
        hasStableSelection: selectionIsCurrent,
        pendingCount: page.changes ? changeCount(page.changes) : 0,
        operationKind: dataOperation?.kind || "idle",
        importSupported: Boolean(session.driver?.importCsv),
    };

    const mutationLocked = toolbarInput.operationKind === "apply" || toolbarInput.operationKind === "import";

    useEffect(() => {
        setSelectedCell(null);
    }, [activeWorkspaceKey, runtime.dataRevision, gridState.page, gridState.rawWhere, gridState.rawOrderBy, session.pageSize]);

    useEffect(() => {
        if (!page.loading && !page.error)
            setStatus(`${tableRef.table} · ${page.displayRows.length} rows · ${page.elapsed}ms`);
    }, [page, tableRef, setStatus]);

    useEffect(() => {
        if (!columnFocus || columnFocus.workspaceId !== workspaceId || page.loading)
            return;
        setSelectedCell(null);
        if (!page.error) {
            const column = page.displayColumns.findIndex((entry) => entry.name === columnFocus.columnName);
            if (column >= 0) {
                const row = page.displayRows.length ? 0 : null;
                if (row !== null)
                    setSelectedCell({ row, column, workspaceId, objectKey: activeWorkspaceKey, dataRevision: runtime.dataRevision, keyValues: page.keyValuesFor(row) });
                setScrollTarget({ token: columnFocus.token, row, column });
            }
        }
        consumeColumnFocus(columnFocus.token);
    }, [columnFocus, consumeColumnFocus, page, workspaceId]);

    const commitGrid = (patch) => {
        const next = { ...session.gridState.get(activeWorkspaceKey), ...gridState, ...patch };
        setGridState(next);
        session.gridState.set(activeWorkspaceKey, next);
    };

    const queryBar = (
        <FilterBar
            rawWhere={draftWhere}
            rawOrderBy={draftOrderBy}
            columns={page.loading || page.error ? [] : page.displayColumns}
            engine={session.conn.engine}
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
                <DataToolbar input={toolbarInput} onAction={() => {}} />
                {queryBar}
                <div className="flex h-full items-center justify-center text-muted-foreground">Loading…</div>
            </div>
        );

    if (page.error)
        return (
            <div className="flex min-h-0 flex-1 flex-col">
                <DataToolbar input={toolbarInput} onAction={() => {}} />
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
            setStatus("DML not generated");
            toast("DML_NOT_GENERATED", "warning");
            return;
        }
        if (applyDirectly)
            apply(statements);
        else
            setReview({ statements: Object.freeze([...statements]), revision: model.revision });
    };

    const apply = async (statements) => {
        setStatus("Applying changes…");
        const revision = model.revision;
        const operation = coordinator.startDataOperation(workspaceId, "apply", { pendingRevision: revision, statements: Object.freeze([...statements]) });
        if (operation.error) {
            toast(operation.error, "warning");
            return;
        }
        const snapshot = coordinator.initiateDataApply(workspaceId, operation.statements);
        if (snapshot.error) {
            coordinator.settleDataOperation(operation);
            setStatus("Apply failed");
            toast(snapshot.error, "warning");
            return;
        }
        try {
            await session.driver.runScript(snapshot.operationCtx, operation.statements.join("\n"), { timeoutMs: session.timeoutMs });
            if (isCurrentDataApply(session, snapshot.ownership) && model.revision === revision) {
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
        } finally {
            coordinator.settleDataOperation(operation);
        }
    };

    const addRow = () => {
        if (mutationLocked || !page.editable)
            return;
        const insert = addInsert(model);
        bumpPendingChanges();
        setEditing({ kind: "insert", insertId: insert.id, column: page.displayColumns[0]?.name });
    };

    const toolbarAction = (id) => {
        if (id === "refresh")
            return refreshData();
        if (id === "new-row")
            return addRow();
        if (id === "discard-all") {
            if (mutationLocked || !page.editable)
                return;
            clearChanges(model);
            return bumpPendingChanges();
        }
        if (id === "review-dml")
            return openReview(false);
        if (id === "apply")
            return openReview(true);
        if (id === "ddl")
            return setView("structure");
        if (id === "import")
            return importCsv();
        if (id === "export")
            return setExportOpen(true);
        if (id === "delete-row" && !mutationLocked && selectionIsCurrent) {
            changes.toggleDelete(page.keyValuesFor(selectedCell.row));
            bumpPendingChanges();
            return setSelectedCell(null);
        }
    };

    const exportObject = async (format) => {
        setExportOpen(false);
        const entry = session.registry.byId[workspaceId];
        const operation = coordinator.startDataOperation(workspaceId, "export", {
            operationCtx: Object.freeze({ ...session.ctx }),
            objectRef: Object.freeze({ ...tableRef }),
            ownership: Object.freeze({ workspaceId, scopeEpoch: session.scopeGeneration || 0, generation: entry?.generation }),
            format,
        });
        if (operation.error)
            return toast(operation.error, "warning");
        try {
            const path = await chooseExportPath(`${operation.objectRef.table}.${format}`);
            if (!path)
                return;
            const exported = await exportCommittedObject({
                driver: session.driver,
                engine: session.conn.engine,
                operationCtx: operation.operationCtx,
                objectRef: operation.objectRef,
                format: operation.format,
                path,
                timeoutMs: session.timeoutMs,
            });
            if (!isCurrentDataExport(session, operation))
                return;
            if (exported.capped)
                toast("Export may be incomplete: reached 1,000,000 rows", "warning");
            else
                toast(`Exported ${exported.rowCount} rows`, "success");
        } catch (error) {
            if (isCurrentDataExport(session, operation))
                toast(`EXPORT_FAILED: ${error.message}`, "warning");
        } finally {
            coordinator.settleDataOperation(operation);
        }
    };

    const importCsv = async () => {
        if (mutationLocked || !page.editable || toolbarInput.pendingCount > 0 || !toolbarInput.importSupported)
            return;
        const operation = coordinator.startDataOperation(workspaceId, "import", { objectRef: tableRef, pendingRevision: model.revision });
        if (operation.error)
            return toast(operation.error, "warning");
        try {
            const path = await muxy.dialog.pickFile({ title: "Choose CSV file", types: ["public.comma-separated-values-text"] });
            if (!path)
                return;
            await session.driver.importCsv(session.ctx, tableRef, path, { header: true });
            if (session.registry.byId[workspaceId]?.key === activeWorkspaceKey && operation.token === session.workspaceOwners.get(activeWorkspaceKey)?.operation?.token) {
                invalidateDataRuntime(runtime);
                toast("CSV imported", "success");
            }
        } catch (error) {
            toast(error.message, "warning");
        } finally {
            coordinator.settleDataOperation(operation);
        }
    };

    const readOnlyBanner = !page.editable && tableRef.kind !== "view";
    const sortDirections = parseOrderBy(session.conn.engine, gridState.rawOrderBy, page.displayColumns);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <DataToolbar input={toolbarInput} onAction={toolbarAction} />
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
                    mutationLocked={mutationLocked}
                    onChange={bumpPendingChanges}
                    editing={editing}
                    setEditing={setEditing}
                    onContextItems={contextItemsFor}
                    onCopyColumnName={copyText}
                    onViewCell={(value) => setViewerValue(value)}
                    selectedCell={selectedCell}
                    onSelectCell={(cell) => {
                        if (!cell) {
                            setSelectedCell(null);
                            return;
                        }
                        setSelectedCell({ ...cell, workspaceId, objectKey: activeWorkspaceKey, dataRevision: runtime.dataRevision, keyValues: page.keyValuesFor(cell.row) });
                    }}
                    scrollTarget={scrollTarget}
                    sortDirections={sortDirections}
                    onSort={(column) => {
                        const rawOrderBy = nextOrderBy(session.conn.engine, draftOrderBy, column, page.displayColumns);
                        setDraftOrderBy(rawOrderBy);
                        commitGrid({ rawOrderBy, page: 0 });
                    }}
                />
            </div>
            <div className="toolbar-footer border-t" style={{ borderColor: "var(--muxy-border)" }}>
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
                </Pager>
            </div>
            {review ? (
                <ReviewSheet
                    statements={review.statements}
                    changed={model.revision !== review.revision}
                    onClose={() => setReview(null)}
                    onApply={() => { if (model.revision === review.revision) apply(review.statements); }}
                />
            ) : null}
            {exportOpen ? <ObjectExportMenu onClose={() => setExportOpen(false)} onExport={exportObject} /> : null}
            {viewerValue !== undefined ? <CellViewerModal value={viewerValue} onClose={() => setViewerValue(undefined)} /> : null}
        </div>
    );
}
