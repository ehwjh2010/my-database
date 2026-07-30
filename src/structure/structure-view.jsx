import { useEffect, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { toast } from "../ui/toast.js";
import { isCurrentDataApply, objectCacheKey } from "../workbench/workspace-state.js";
import {
    cachedStructureSnapshot,
    commitStructureSnapshot,
    invalidateStructureSnapshot,
    isCurrentStructureRead,
    loadStructureSnapshot,
} from "../workbench/structure-runtime.js";
import { qualifiedName } from "../lib/sql/quote.js";
import { getPref } from "../lib/storage.js";
import { InfoTable, Section } from "./info-table.jsx";
import { IndexDesignerModal } from "./index-designer.jsx";

export function StructureView({ session, workspaceId, tableRef, setStatus, reloadTables }) {
    const workspaceKey = objectCacheKey(tableRef);
    const [state, setState] = useState(() => {
        const cached = cachedStructureSnapshot(session, workspaceKey);
        return cached ? { loading: false, info: cached.info, ddl: cached.ddl } : { loading: true };
    });
    const [reloadTick, setReloadTick] = useState(0);
    const [designerOpen, setDesignerOpen] = useState(false);
    const [confirmDestructive, setConfirmDestructive] = useState(true);

    useEffect(() => {
        getPref("confirmDestructive").then((v) => setConfirmDestructive(v !== false));
    }, []);

    useEffect(() => {
        if (!tableRef || !workspaceId)
            return;
        const cached = cachedStructureSnapshot(session, workspaceKey);
        if (cached) {
            setState({ loading: false, info: cached.info, ddl: cached.ddl });
            return;
        }
        const read = session.coordinator.initiateStructureRead(workspaceId);
        if (read.error) {
            setState({ loading: false, error: read.error });
            return;
        }
        let stale = false;
        setState({ loading: true });
        loadStructureSnapshot(session, read).then((snapshot) => {
            const committed = commitStructureSnapshot(session, read, snapshot);
            if (!stale && committed)
                setState({ loading: false, info: snapshot.info, ddl: snapshot.ddl });
        }).catch((error) => {
            if (!stale && isCurrentStructureRead(session, read))
                setState({ loading: false, error: error.message });
        });
        return () => { stale = true; };
    }, [session, workspaceId, tableRef, workspaceKey, reloadTick]);

    if (!tableRef)
        return <EmptyState icon="columns" description="Select a table to inspect its structure" />;

    const scroll = "flex-1 overflow-y-auto p-[var(--s7)]";
    if (state.loading)
        return <div className={scroll}><div className="text-muted-foreground">Loading…</div></div>;
    if (state.error)
        return <div className={scroll}><div className="error-box">{state.error}</div></div>;

    const { info, ddl } = state;
    const engine = session.conn.engine;

    const reloadStructure = () => {
        invalidateStructureSnapshot(session, workspaceKey);
        setReloadTick((n) => n + 1);
    };

    const runDestructive = async (sql, label, operation) => {
        const snapshot = session.coordinator.initiateStructureWrite(workspaceId, sql, operation);
        if (snapshot.error) {
            toast(snapshot.error, "warning");
            return null;
        }
        if (confirmDestructive) {
            const choice = await muxy.dialog.confirm({
                title: label,
                message: `Run:\n\n${sql}`,
                buttons: [label, "Cancel"],
                cancel: "Cancel",
                style: "warning",
            });
            if (choice !== label)
                return null;
        }
        if (!isCurrentDataApply(session, snapshot.ownership))
            return null;
        try {
            await session.driver.runQuery(snapshot.operationCtx, snapshot.sql, { timeoutMs: session.timeoutMs });
            if (!isCurrentDataApply(session, snapshot.ownership))
                return null;
            toast(`${label} succeeded`, "success");
            return snapshot;
        } catch (error) {
            if (!isCurrentDataApply(session, snapshot.ownership))
                return null;
            toast(error.message, "warning");
            return null;
        }
    };

    const truncate = async () => {
        const sql = engine === "sqlite" ? `DELETE FROM ${qualifiedName(engine, tableRef)}` : `TRUNCATE TABLE ${qualifiedName(engine, tableRef)}`;
        const snapshot = await runDestructive(sql, "Truncate", "truncate");
        if (snapshot && isCurrentDataApply(session, snapshot.ownership))
            reloadStructure();
    };

    const drop = async () => {
        const snapshot = await runDestructive(`DROP ${tableRef.kind === "view" ? "VIEW" : "TABLE"} ${qualifiedName(engine, tableRef)}`, "Drop", "drop");
        if (snapshot && isCurrentDataApply(session, snapshot.ownership))
            await session.coordinator.onObjectDeleted(snapshot.objectRef);
    };

    return (
        <div className={scroll}>
            <div className="mb-[var(--s6)] flex items-center gap-[var(--s4)]">
                <div className="text-[var(--font-title)] font-semibold">{tableRef.table}</div>
                <span className="text-[var(--font-footnote)] text-muted-foreground">{tableRef.kind === "view" ? "view" : "table"}</span>
                <div className="flex-1" />
                <div className="flex items-center gap-[var(--s3)]">
                    {tableRef.kind !== "view" ? (
                        <>
                            <button className="btn" onClick={() => setDesignerOpen(true)}>
                                <Icon name="plus" />
                                Index
                            </button>
                            <button className="btn btn-danger" onClick={truncate}>
                                Truncate
                            </button>
                        </>
                    ) : null}
                    <button className="btn btn-danger" onClick={drop}>
                        <Icon name="trash" />
                        Drop
                    </button>
                </div>
            </div>
            <div className="flex flex-col gap-[var(--s7)]">
                <Section title="Columns">
                    <InfoTable
                        headers={["Name", "Type", "Nullable", "Default", "Key"]}
                        rows={info.columns.map((c) => [c.name, c.type, c.nullable ? "YES" : "NO", c.default, c.isPk ? "PRIMARY" : c.autoIncrement ? "AUTO" : ""])}
                    />
                </Section>
                <Section title="Indexes">
                    <InfoTable
                        headers={["Name", "Unique", "Columns"]}
                        rows={info.indexes.map((i) => [i.name, i.unique ? "YES" : "NO", (i.columns || []).join(", ")])}
                    />
                </Section>
                <Section title="Foreign keys">
                    <InfoTable
                        headers={["Column", "References", "On delete"]}
                        rows={info.foreignKeys.map((f) => [f.column, `${f.refTable}(${f.refColumn})`, f.onDelete || ""])}
                    />
                </Section>
                {info.triggers?.length ? (
                    <Section title="Triggers">
                        <InfoTable headers={["Name", "Definition"]} rows={info.triggers.map((t) => [t.name, t.definition || ""])} />
                    </Section>
                ) : null}
                {ddl ? (
                    <Section title="DDL">
                        <pre
                            className="mono error-box ddl-block"
                            style={{ color: "var(--muxy-foreground)", borderColor: "var(--muxy-border)" }}
                        >
                            {ddl}
                        </pre>
                    </Section>
                ) : null}
            </div>
            {designerOpen ? (
                <IndexDesignerModal
                    session={session}
                    workspaceId={workspaceId}
                    tableRef={tableRef}
                    info={info}
                    onDone={reloadStructure}
                    onClose={() => setDesignerOpen(false)}
                />
            ) : null}
        </div>
    );
}
