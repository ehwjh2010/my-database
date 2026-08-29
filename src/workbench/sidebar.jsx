import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { ContextMenu } from "../ui/context-menu.jsx";
import { useSession } from "./session-context.jsx";
import { objectCacheKey } from "./workspace-state.js";
import { dumpProgressFor } from "../transfer/transfer.js";
import { dropObject, ensureObjectWorkspace, truncateTable } from "../structure/structure-actions.js";
import { IndexDesignerModal } from "../structure/index-designer.jsx";
import { getPref } from "../lib/storage.js";
import { invalidateStructureSnapshot } from "./structure-runtime.js";
import { toast } from "../ui/toast.js";

const DEFAULT_WIDTH = 250;
const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

function TreeGroup({ icon, title, children }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <div className="tree-group">
            <button type="button" className="tree-group-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
                <Icon name={expanded ? "chevronDown" : "chevronRight"} />
                <Icon name={icon} />
                <span>{title}</span>
            </button>
            {expanded ? <div className="tree-group-items">{children}</div> : null}
        </div>
    );
}

function DetailRow({ title, detail, tooltip, badges, inline = false, onDoubleClick }) {
    const content = (
        <>
            <span className="tree-detail-main">
                <span className="truncate">{title}</span>
                {badges?.map((badge) => <span className="tree-badge" key={badge}>{badge}</span>)}
            </span>
            {detail ? <span className="tree-detail-meta">{detail}</span> : null}
        </>
    );
    if (!onDoubleClick)
        return <div className="tree-detail-row" title={tooltip}>{content}</div>;
    return (
        <button
            type="button"
            className={`tree-detail-row tree-column-row${inline ? " tree-detail-row-inline" : ""}`}
            title={tooltip}
            onDoubleClick={onDoubleClick}
            onKeyDown={(event) => {
                if (event.key === "Enter")
                    onDoubleClick();
            }}
        >
            {content}
        </button>
    );
}

function metadataLabel(key) {
    return ({ charset: "Character set", collation: "Collation", comment: "Comment", engine: "Engine", strict: "Strict", withoutRowid: "Without rowid" })[key] || key;
}

function metadataValue(value) {
    return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}

function foreignKeyGroups(foreignKeys) {
    const groups = new Map();
    for (const foreignKey of foreignKeys) {
        const name = foreignKey.name || `${foreignKey.column}:${foreignKey.refTable}:${foreignKey.refColumn}`;
        if (!groups.has(name))
            groups.set(name, { name: foreignKey.name || "Foreign key", columns: [] });
        groups.get(name).columns.push(`${foreignKey.column} -> ${foreignKey.refTable}(${foreignKey.refColumn})`);
    }
    return [...groups.values()];
}

function TableTreeNode({ table, tableRef, active, loadTableInfo, focusTableColumn, onSelect, onContextMenu, infoRevision }) {
    const [expanded, setExpanded] = useState(false);
    const [state, setState] = useState({ loading: false, info: null, error: null });

    const load = async () => {
        setState((current) => ({ ...current, loading: true, error: null }));
        try {
            const info = await loadTableInfo(tableRef);
            setState({ loading: false, info, error: null });
        }
        catch (error) {
            setState({ loading: false, info: null, error });
        }
    };

    useEffect(() => {
        if (!expanded || !infoRevision)
            return;
        load();
    }, [infoRevision]);

    const toggle = (event) => {
        event.stopPropagation();
        if (expanded) {
            setExpanded(false);
            return;
        }
        setExpanded(true);
        if (!state.info && !state.loading)
            load();
    };

    const info = state.info;
    const primaryKey = info?.primaryKey || [];
    const uniqueIndexes = info?.indexes?.filter((index) => index.unique && (index.columns?.length !== primaryKey.length || index.columns.some((column, index) => column !== primaryKey[index]))) || [];
    const metadata = Object.entries(info?.metadata || {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
    return (
        <div className="table-tree-node">
            <div
                className={`tree-row table-tree-row ${active ? "active" : ""}`}
                data-object-key={objectCacheKey(tableRef)}
                aria-current={active ? "page" : undefined}
                title={table.comment || undefined}
                onClick={onSelect}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event, tableRef, table);
                }}
            >
                <button type="button" className="tree-disclosure" aria-expanded={expanded} onClick={toggle}>
                    <Icon name={expanded ? "chevronDown" : "chevronRight"} />
                </button>
                <Icon name={table.kind === "view" ? "eye" : "table"} />
                <span className="truncate">{table.name}</span>
            </div>
            {expanded ? (
                <div className="tree-children">
                    {state.loading ? <div className="tree-inline-state">Loading…</div> : null}
                    {state.error ? (
                        <div className="tree-inline-error">
                            <span title={state.error.message}>{state.error.message}</span>
                            <button type="button" className="icon-btn tree-retry" title="Retry" onClick={load}><Icon name="refresh" /></button>
                        </div>
                    ) : null}
                    {info ? (
                        <>
                            <TreeGroup icon="columns" title="Columns">
                                {info.columns.length ? info.columns.map((column) => (
                                    <DetailRow
                                        key={column.name}
                                        title={column.name}
                                        detail={column.type}
                                        tooltip={column.comment}
                                        badges={column.isPk ? ["PK"] : null}
                                        inline
                                        onDoubleClick={() => focusTableColumn(tableRef, column.name)}
                                    />
                                )) : <div className="tree-inline-state">No columns</div>}
                            </TreeGroup>
                            {(info.primaryKey?.length || uniqueIndexes.length) ? (
                                <TreeGroup icon="key" title="Keys">
                                    {info.primaryKey?.length ? <DetailRow title="Primary key" detail={info.primaryKey.join(", ")} badges={["PK"]} /> : null}
                                    {uniqueIndexes.map((index) => <DetailRow key={index.name} title={index.name} detail={(index.columns || []).join(", ")} badges={["UNIQUE"]} />)}
                                </TreeGroup>
                            ) : null}
                            {info.indexes?.length ? (
                                <TreeGroup icon="bolt" title="Indexes">
                                    {info.indexes.map((index) => <DetailRow key={index.name} title={index.name} detail={(index.columns || []).join(", ")} badges={index.unique ? ["UNIQUE"] : null} />)}
                                </TreeGroup>
                            ) : null}
                            {info.foreignKeys?.length ? (
                                <TreeGroup icon="link" title="Foreign keys">
                                    {foreignKeyGroups(info.foreignKeys).map((foreignKey) => <DetailRow key={`${foreignKey.name}:${foreignKey.columns.join(",")}`} title={foreignKey.name} detail={foreignKey.columns.join(", ")} />)}
                                </TreeGroup>
                            ) : null}
                            {metadata.length ? (
                                <TreeGroup icon="info" title="Metadata">
                                    {metadata.map(([key, value]) => <DetailRow key={key} title={metadataLabel(key)} detail={metadataValue(value)} />)}
                                </TreeGroup>
                            ) : null}
                        </>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

export function Sidebar({ onExportDatabase, onImportDatabase, dumpProgress }) {
    const { session, tables, activeKey, selectTable, catalogError, loadTableInfo, focusTableColumn, schemaEpoch } = useSession();
    const sidebar = useRef(null);
    const dragging = useRef(false);
    const [filter, setFilter] = useState("");
    const [width, setWidth] = useState(session.sidebarWidth || DEFAULT_WIDTH);
    const [menu, setMenu] = useState(null);
    const [indexDesigner, setIndexDesigner] = useState(null);
    const [infoRevision, setInfoRevision] = useState(0);
    const [confirmDestructive, setConfirmDestructive] = useState(true);
    const transfer = dumpProgressFor(dumpProgress);
    const transferBusy = transfer?.status === "running";
    const dumpBusy = transfer?.kind === "dump" && transferBusy;
    const restoreBusy = transfer?.kind === "restore" && transferBusy;

    useEffect(() => {
        getPref("confirmDestructive").then((value) => setConfirmDestructive(value !== false));
    }, []);

    const refreshObjectInfo = (tableRef) => {
        invalidateStructureSnapshot(session, objectCacheKey(tableRef));
        session.coordinator.adapters?.notify?.();
        setInfoRevision((value) => value + 1);
    };

    const openIndexDesigner = async (tableRef) => {
        const opened = ensureObjectWorkspace(session, tableRef);
        if (opened.error) {
            toast(opened.error, "warning");
            return;
        }
        try {
            const info = await loadTableInfo(tableRef);
            setIndexDesigner({ tableRef, workspaceId: opened.workspaceId, info });
        }
        catch (error) {
            toast(error.message, "warning");
        }
    };

    const openMenu = (event, tableRef, table) => {
        const items = table.kind === "view"
            ? [{ label: "Drop", danger: true, onClick: () => dropObject(session, tableRef, confirmDestructive) }]
            : [
                { label: "Index", onClick: () => openIndexDesigner(tableRef) },
                { label: "Truncate", danger: true, onClick: () => truncateTable(session, tableRef, confirmDestructive) },
                { separator: true },
                { label: "Drop", danger: true, onClick: () => dropObject(session, tableRef, confirmDestructive) },
            ];
        setMenu({ x: event.clientX, y: event.clientY, items });
    };

    const resize = (value) => {
        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)));
        session.sidebarWidth = next;
        setWidth(next);
    };

    const term = filter.trim().toLowerCase();
    const visible = tables.filter((table) => !term || table.name.toLowerCase().includes(term));
    const tableCount = tables.filter((table) => table.kind === "table").length;
    const viewCount = tables.length - tableCount;

    return (
        <div ref={sidebar} className="sidebar flex w-[var(--sidebar-width)] flex-shrink-0 flex-col border-r" style={{ "--sidebar-width": `${width}px`, borderColor: "var(--muxy-border)" }}>
            <div className="search-bar-shell">
                <div className="search-bar" style={{ borderColor: "var(--muxy-border)" }}>
                    <input type="text" placeholder="Filter tables" className="search-bar-input" value={filter} onChange={(event) => setFilter(event.target.value)} />
                    {onImportDatabase ? (
                        <button
                            className="icon-btn"
                            title={restoreBusy ? transfer.label : "Import database"}
                            aria-label={restoreBusy ? transfer.label : "Import database"}
                            aria-busy={restoreBusy ? "true" : undefined}
                            disabled={transferBusy}
                            onClick={onImportDatabase}
                        >
                            <Icon name={restoreBusy ? "clock" : "upload"} />
                        </button>
                    ) : null}
                    {onExportDatabase ? (
                        <button
                            className="icon-btn"
                            title={dumpBusy ? transfer.label : "Export database"}
                            aria-label={dumpBusy ? transfer.label : "Export database"}
                            aria-busy={dumpBusy ? "true" : undefined}
                            disabled={transferBusy}
                            onClick={onExportDatabase}
                        >
                            <Icon name={dumpBusy ? "clock" : "download"} />
                        </button>
                    ) : null}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto py-[var(--s2)]">
                {catalogError ? (
                    <div className="error-box mx-[var(--s5)] my-[var(--s4)]">{catalogError.message}</div>
                ) : visible.length === 0 ? (
                    <div className="px-[var(--s5)] py-[var(--s4)] text-muted-foreground">{term ? "No matches" : "No tables"}</div>
                ) : visible.map((table) => {
                    const ref = { table: table.name, kind: table.kind, database: session.ctx.database, schema: session.ctx.schema };
                    const key = objectCacheKey(ref);
                    return (
                        <TableTreeNode
                            key={`${schemaEpoch}:${key}`}
                            table={table}
                            tableRef={ref}
                            active={activeKey === key}
                            loadTableInfo={loadTableInfo}
                            focusTableColumn={focusTableColumn}
                            infoRevision={infoRevision}
                            onSelect={() => selectTable(ref)}
                            onContextMenu={openMenu}
                        />
                    );
                })}
            </div>
            <div className="pane-footer-row text-[var(--font-footnote)] text-muted-foreground" style={{ borderColor: "var(--muxy-border)" }}>
                {`${tableCount} tables${viewCount ? ` · ${viewCount} views` : ""}`}
            </div>
            <div
                className="sidebar-resizer"
                role="separator"
                aria-label="Resize sidebar"
                aria-orientation="vertical"
                aria-valuemin={MIN_WIDTH}
                aria-valuemax={MAX_WIDTH}
                aria-valuenow={width}
                tabIndex={0}
                onDoubleClick={() => resize(DEFAULT_WIDTH)}
                onPointerDown={(event) => {
                    dragging.current = true;
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    if (dragging.current)
                        resize(event.clientX - sidebar.current.getBoundingClientRect().left);
                }}
                onPointerUp={(event) => {
                    dragging.current = false;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }}
                onPointerCancel={() => { dragging.current = false; }}
                onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        resize(width + (event.key === "ArrowLeft" ? -10 : 10));
                    }
                }}
            />
            {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
            {indexDesigner ? (
                <IndexDesignerModal
                    session={session}
                    workspaceId={indexDesigner.workspaceId}
                    tableRef={indexDesigner.tableRef}
                    info={indexDesigner.info}
                    onDone={() => refreshObjectInfo(indexDesigner.tableRef)}
                    onClose={() => setIndexDesigner(null)}
                />
            ) : null}
        </div>
    );
}
