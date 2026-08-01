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
import { ConsoleView, NewSqlFileModal } from "../editor/console-view.jsx";
import { StructureView } from "../structure/structure-view.jsx";
import { TableDesignerModal } from "../structure/table-designer.jsx";
import { TransferMenuModal } from "../transfer/transfer-menu.jsx";
import { WorkspaceTabs } from "./workspace-tabs.jsx";
import { objectCacheKey } from "./workspace-state.js";
import { sqlFileMenuItems } from "./workspace-chrome.js";
import { toast } from "../ui/toast.js";

function fileErrorMessage(error) {
    const code = error?.code || error?.error;
    return {
        FILE_NAME_EMPTY: "Enter a file name.",
        FILE_NAME_INVALID: "File names cannot contain NUL or slash.",
        FILE_RESERVED: "console.sql is protected.",
        FILE_EXISTS: "A SQL file with this name already exists.",
        FILE_NOT_FOUND: "The SQL file is no longer available.",
        DATABASE_REQUIRED: "Select a database first.",
    }[code] || error?.message || String(error);
}

export function Workbench() {
    const { session, view, surface, ref, order, activeId, byId, activeSqlId, activateWorkspace, closeWorkspace, activateSql, closeSql, createAndOpenFile, openSqlFile, enterConsole, setStatus, refreshSchema, schemaEpoch, queryHooksRef, newFileRef, hasDatabase } = useSession();
    const [designerOpen, setDesignerOpen] = useState(false);
    const [transferOpen, setTransferOpen] = useState(false);
    const [newFileOpen, setNewFileOpen] = useState(false);
    const [newFileError, setNewFileError] = useState(null);
    const consolePhase = session.consoleState?.phase;

    const openNewFile = () => {
        if (!hasDatabase) {
            setNewFileError(fileErrorMessage({ error: "DATABASE_REQUIRED" }));
            return;
        }
        setNewFileError(null);
        setNewFileOpen(true);
        if (surface !== "console")
            enterConsole().catch(() => undefined);
    };

    const createFile = async (name) => {
        try {
            const result = await createAndOpenFile(name);
            if (result?.error) {
                setNewFileError(fileErrorMessage(result));
                return false;
            }
            setNewFileOpen(false);
            return true;
        }
        catch (error) {
            setNewFileError(fileErrorMessage(error));
            return false;
        }
    };

    const openFile = async (file) => {
        try {
            const result = await openSqlFile(file.name);
            if (result?.error)
                await toast(fileErrorMessage(result), "error");
        }
        catch (error) {
            await toast(fileErrorMessage(error), "error");
        }
    };

    useEffect(() => {
        if (!newFileRef)
            return;
        newFileRef.current = openNewFile;
        return () => { newFileRef.current = null; };
    }, [newFileRef, hasDatabase, surface, enterConsole]);

    const newMenuItems = surface === "console" && consolePhase === "ready"
        ? sqlFileMenuItems({ files: session.sqlFiles, order: session.sqlRegistry.order, byId: session.sqlRegistry.byId, onCreate: openNewFile, onOpen: openFile })
        : [];

    useEffect(() => {
        if (hasDatabase && consolePhase === "missing")
            enterConsole().catch(() => undefined);
    }, [consolePhase, enterConsole, hasDatabase]);

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
        if (surface === "console") {
            const sqlEntry = session.sqlRegistry.byId[activeSqlId];
            if (!sqlEntry)
                return <ConsoleView state={session.consoleState} hasDatabase={hasDatabase} hasQueryTab={false} onNewQuery={openNewFile} onRetry={() => enterConsole().catch(() => undefined)} />;
            return <QueryView key={`sql:${activeSqlId}`} session={session} sqlTabId={activeSqlId} setStatus={setStatus} queryHooksRef={queryHooksRef} />;
        }
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
                    <WorkspaceTabs
                        order={surface === "console" ? session.sqlRegistry.order : order}
                        activeId={surface === "console" ? activeSqlId : activeId}
                        byId={surface === "console" ? session.sqlRegistry.byId : byId}
                        changesByKey={surface === "console" ? null : session.changes}
                        onActivate={surface === "console" ? activateSql : activateWorkspace}
                        onClose={surface === "console" ? closeSql : closeWorkspace}
                        newMenuItems={surface === "console" ? newMenuItems : []}
                    />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main()}</div>
                </div>
            </div>
            <Statusbar />
            {newFileOpen ? <NewSqlFileModal error={newFileError} onClose={() => setNewFileOpen(false)} onSubmit={createFile} /> : null}
            {designerOpen ? (
                <TableDesignerModal session={session} onClose={() => setDesignerOpen(false)} />
            ) : null}
            {transferOpen ? (
                <TransferMenuModal session={session} tableRef={ref} onClose={() => setTransferOpen(false)} />
            ) : null}
        </div>
    );
}
