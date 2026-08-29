import { useEffect, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { isCurrentStructureRead, cachedStructureSnapshot, commitStructureSnapshot, loadStructureSnapshot } from "../workbench/structure-runtime.js";
import { objectCacheKey } from "../workbench/workspace-state.js";
import { InfoTable, Section } from "./info-table.jsx";

export function StructureView({ session, workspaceId, tableRef }) {
    const workspaceKey = objectCacheKey(tableRef);
    const [state, setState] = useState(() => {
        const cached = cachedStructureSnapshot(session, workspaceKey);
        return cached ? { loading: false, info: cached.info, ddl: cached.ddl } : { loading: true };
    });

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
    }, [session, workspaceId, tableRef, workspaceKey, session.structureRevision]);

    if (!tableRef)
        return <EmptyState icon="columns" description="Select a table to inspect its structure" />;

    const scroll = "flex-1 overflow-y-auto p-[var(--s7)]";
    if (state.loading)
        return <div className={scroll}><div className="text-muted-foreground">Loading…</div></div>;
    if (state.error)
        return <div className={scroll}><div className="error-box">{state.error}</div></div>;

    const { info, ddl } = state;

    return (
        <div className={scroll}>
            <div className="mb-[var(--s6)] flex items-center gap-[var(--s4)]">
                <div className="text-[var(--font-title)] font-semibold">{tableRef.table}</div>
                <span className="text-[var(--font-footnote)] text-muted-foreground">{tableRef.kind === "view" ? "view" : "table"}</span>
            </div>
            <div className="flex flex-col gap-[var(--s7)]">
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
            </div>
        </div>
    );
}
