import { useEffect, useState } from "react";
import { useSession } from "./session-context.jsx";
import { Topbar } from "./topbar.jsx";
import { Sidebar } from "./sidebar.jsx";
import { Statusbar } from "./statusbar.jsx";
import { EmptyState } from "../ui/empty-state.jsx";
import { closeTunnel } from "../lib/tunnel.js";
import { clearCredFiles } from "../lib/cred-file.js";
import { DataView } from "../grid/data-view.jsx";
import { QueryView } from "../editor/query-view.jsx";
import { StructureView } from "../structure/structure-view.jsx";
import { TableDesignerModal } from "../structure/table-designer.jsx";
import { TransferMenuModal } from "../transfer/transfer-menu.jsx";
import { WorkspaceTabs } from "./workspace-tabs.jsx";
import { objectCacheKey } from "./workspace-state.js";

export function Workbench() {
    const { session, view, ref, order, activeId, byId, activateWorkspace, closeWorkspace, setStatus, refreshSchema, schemaEpoch, queryHooksRef } = useSession();
    const [designerOpen, setDesignerOpen] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false);

    useEffect(() => {
        const conn = session.conn;
        const onHide = () => {
            clearCredFiles(conn.id).catch(() => undefined);
            if (conn.ssh?.enabled)
                closeTunnel(conn).catch(() => undefined);
        };
        window.addEventListener("pagehide", onHide, { once: true });
        return () => window.removeEventListener("pagehide", onHide);
    }, [session]);

    const main = () => {
        if (view === "query")
            return <QueryView key={activeId} session={session} workspaceId={activeId} setStatus={setStatus} queryHooksRef={queryHooksRef} />;
        if (!ref)
            return <EmptyState icon="table" description="从左侧选择一张表" />;
        if (view === "structure")
            return <StructureView key={`${schemaEpoch}:${ref.table}`} session={session} workspaceId={activeId} tableRef={ref} setStatus={setStatus} reloadTables={refreshSchema} />;
        return <DataView key={`${schemaEpoch}:${objectCacheKey(ref)}`} session={session} tableRef={ref} workspaceId={activeId} setStatus={setStatus} />;
    };

    return (
        <div className="flex h-full flex-col">
            <Topbar />
            <div className="flex min-h-0 flex-1">
                <Sidebar onNewTable={() => setDesignerOpen(true)} onTransfer={() => setTransferOpen(true)} />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <WorkspaceTabs order={order} activeId={activeId} byId={byId} changesByKey={session.changes} onActivate={activateWorkspace} onClose={closeWorkspace} />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main()}</div>
                </div>
            </div>
            <Statusbar />
            {designerOpen ? (
                <TableDesignerModal session={session} onClose={() => setDesignerOpen(false)} />
            ) : null}
            {transferOpen ? (
                <TransferMenuModal session={session} tableRef={ref} onClose={() => setTransferOpen(false)} />
            ) : null}
        </div>
    );
}
