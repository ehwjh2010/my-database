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
import { NewSqlFileModal, RenameSqlFileModal } from "../editor/console-view.jsx";
import { StructureView } from "../structure/structure-view.jsx";
import { DatabaseExportModal, DatabaseImportModal } from "../transfer/transfer-menu.jsx";
import { WorkspaceTabs } from "./workspace-tabs.jsx";
import { objectCacheKey } from "./workspace-state.js";
import { flattenSessionTabs, parseTabStripKey, sqlFileMenuItems } from "./workspace-chrome.js";
import { dumpDatabase, restoreDatabase } from "../transfer/transfer.js";
import { TransferProgressModal } from "../transfer/transfer-progress-modal.jsx";
import { toast } from "../ui/toast.js";
import { copyToClipboard } from "../lib/clipboard.js";

function fileErrorMessage(error) {
    const code = error?.code || error?.error;
    return {
        FILE_NAME_EMPTY: "Enter a file name.",
        FILE_NAME_INVALID: "File names cannot contain NUL or slash.",
        FILE_RESERVED: "console.sql 不能重命名或删除",
        FILE_EXISTS: "A SQL file with this name already exists.",
        FILE_NOT_FOUND: "The SQL file is no longer available.",
        FILE_VERSION_CONFLICT: "The SQL file changed outside Muxy. Reload it before renaming or deleting.",
        FILE_RENAME_FAILED: "The SQL file could not be renamed.",
        FILE_TRASH_FAILED: "The SQL file could not be moved to the Finder Trash.",
        DATABASE_REQUIRED: "Select a database first.",
    }[code] || error?.message || String(error);
}

export function Workbench() {
    const { session, view, surface, ref, activeSqlId, activateWorkspace, activateSql, closeWorkspace, createAndOpenFile, openSqlFile, enterConsole, closeSql, setStatus, refreshSchema, schemaEpoch, queryHooksRef, newFileRef, hasDatabase } = useSession();
    const [databaseExportOpen, setDatabaseExportOpen] = useState(false);
    const [databaseImportOpen, setDatabaseImportOpen] = useState(false);
    const [dumpProgress, setDumpProgress] = useState(null);
    const [newFileOpen, setNewFileOpen] = useState(false);
    const [newFileError, setNewFileError] = useState(null);
    const [renameFile, setRenameFile] = useState(null);
    const [renameFileError, setRenameFileError] = useState(null);
    const consolePhase = session.consoleState?.phase;

    const openNewFile = () => {
        if (!hasDatabase) {
            setNewFileError(fileErrorMessage({ error: "DATABASE_REQUIRED" }));
            return;
        }
        setNewFileError(null);
        setNewFileOpen(true);
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

    const openRenameFile = (tab) => {
        const entry = session.sqlRegistry.byId[tab.id];
        if (!entry || entry.reserved || entry.name?.toLowerCase() === "console.sql")
            return;
        setRenameFile({ id: tab.id, name: entry.name });
        setRenameFileError(null);
    };

    const renameFileSubmit = async (name) => {
        try {
            const result = await session.coordinator.renameSqlFile(renameFile.id, name);
            if (result?.error) {
                setRenameFileError(fileErrorMessage(result));
                return false;
            }
            setRenameFile(null);
            return true;
        }
        catch (error) {
            setRenameFileError(fileErrorMessage(error));
            return false;
        }
    };

    const trashFile = async (tab) => {
        try {
            const result = await session.coordinator.trashSqlFile(tab.id);
            if (result?.error)
                await toast(fileErrorMessage(result), "error");
        }
        catch (error) {
            await toast(fileErrorMessage(error), "error");
        }
    };

    const closeSqlFile = (tab) => {
        const result = closeSql(tab.id);
        if (result?.error)
            toast(fileErrorMessage(result), "error");
    };

    useEffect(() => {
        if (!newFileRef)
            return;
        newFileRef.current = openNewFile;
        return () => { newFileRef.current = null; };
    }, [newFileRef, hasDatabase]);

    const newMenuItems = consolePhase === "ready"
        ? sqlFileMenuItems({ files: session.sqlFiles, onCreate: openNewFile, onOpen: openFile })
        : [];
    const objectTabMenuItems = (id) => {
        const table = session.registry.byId[id]?.ref?.table;
        return table ? [{ label: "Copy Table Name", onClick: () => copyToClipboard(table) }] : [];
    };
    const sqlTabMenuItems = (id) => {
        const entry = session.sqlRegistry.byId[id];
        if (!entry)
            return [];
        const tab = { id };
        if (entry.reserved || entry.name?.toLowerCase() === "console.sql")
            return [{ label: "Close", onClick: () => closeSqlFile(tab) }];
        return [
            { label: "Rename...", onClick: () => openRenameFile(tab) },
            { separator: true },
            { label: "Delete", onClick: () => trashFile(tab) },
            { separator: true },
            { label: "Close", onClick: () => closeSqlFile(tab) },
        ];
    };
    const strip = flattenSessionTabs({ tabOrder: session.tabOrder, registry: session.registry, sqlRegistry: session.sqlRegistry, surface });
    const activateStrip = (key) => {
        const tab = parseTabStripKey(key);
        if (tab?.kind === "sql")
            activateSql(tab.id);
        else if (tab?.kind === "object")
            activateWorkspace(tab.id);
    };
    const closeStrip = (key) => {
        const tab = parseTabStripKey(key);
        if (tab?.kind === "sql")
            closeSqlFile({ id: tab.id });
        else if (tab?.kind === "object")
            closeWorkspace(tab.id);
    };
    const tabMenuItems = (tab) => {
        const parsed = parseTabStripKey(tab.id);
        if (parsed?.kind === "sql")
            return sqlTabMenuItems(parsed.id);
        if (parsed?.kind === "object")
            return objectTabMenuItems(parsed.id);
        return [];
    };

    useEffect(() => {
        if (hasDatabase && consolePhase === "missing")
            enterConsole({ activate: false }).catch(() => undefined);
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

    const startDatabaseDump = async () => {
        if (dumpProgress?.status === "running")
            return;
        await dumpDatabase(session, { onProgress: setDumpProgress });
    };

    const startDatabaseRestore = async () => {
        if (dumpProgress?.status === "running")
            return;
        const restored = await restoreDatabase(session, { onProgress: setDumpProgress });
        if (restored?.status === "restored")
            await refreshSchema();
    };

    const main = () => {
        if (surface === "console") {
            const sqlEntry = session.sqlRegistry.byId[activeSqlId];
            if (sqlEntry)
                return <QueryView key={`sql:${activeSqlId}`} session={session} sqlTabId={activeSqlId} setStatus={setStatus} queryHooksRef={queryHooksRef} />;
        }
        if (view === "query")
            return <QueryView key={session.registry.activeId} session={session} workspaceId={session.registry.activeId} setStatus={setStatus} queryHooksRef={queryHooksRef} />;
        if (!ref)
            return <EmptyState icon="table" description="从左侧选择一张表" />;
        if (view === "structure")
            return <StructureView key={`${schemaEpoch}:${ref.table}`} session={session} workspaceId={session.registry.activeId} tableRef={ref} />;
        return <DataView key={`${schemaEpoch}:${objectCacheKey(ref)}`} session={session} tableRef={ref} workspaceId={session.registry.activeId} setStatus={setStatus} />;
    };

    return (
        <div className="flex h-full flex-col">
            <Topbar />
            <div className="flex min-h-0 flex-1">
                <Sidebar
                    onImportDatabase={() => setDatabaseImportOpen(true)}
                    onExportDatabase={() => setDatabaseExportOpen(true)}
                    dumpProgress={dumpProgress}
                />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <WorkspaceTabs
                        order={strip.order}
                        activeId={strip.activeId}
                        byId={strip.byId}
                        changesByKey={session.changes}
                        onActivate={activateStrip}
                        onClose={closeStrip}
                        newMenuItems={newMenuItems}
                        tabMenuItems={tabMenuItems}
                    />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">{main()}</div>
                </div>
            </div>
            <Statusbar />
            {newFileOpen ? <NewSqlFileModal error={newFileError} onClose={() => setNewFileOpen(false)} onSubmit={createFile} /> : null}
            {renameFile ? <RenameSqlFileModal name={renameFile.name} error={renameFileError} onClose={() => setRenameFile(null)} onSubmit={renameFileSubmit} /> : null}
            {databaseExportOpen ? (
                <DatabaseExportModal session={session} onClose={() => setDatabaseExportOpen(false)} onDump={startDatabaseDump} />
            ) : null}
            {databaseImportOpen ? (
                <DatabaseImportModal session={session} onClose={() => setDatabaseImportOpen(false)} onRestore={startDatabaseRestore} />
            ) : null}
            {dumpProgress ? (
                <TransferProgressModal
                    progress={dumpProgress}
                    onClose={() => {
                        if (dumpProgress.status !== "running")
                            setDumpProgress(null);
                    }}
                />
            ) : null}
        </div>
    );
}
