import { pendingChangeCountFor } from "./workspace-state.js";

export const WORKSPACE_DIRTY_LABEL = "Unsaved changes";

export function workspaceTabTitle(ref, view) {
    if (view === "structure")
        return `DDL: ${ref?.table ?? ""}`;
    return ref?.kind === "view" ? `View: ${ref?.table ?? ""}` : ref?.table ?? "";
}

export function projectWorkspaceTabs({ order = [], byId = {}, activeId = null, changesByKey } = {}) {
    return order
        .map((id) => byId[id])
        .filter(Boolean)
        .map((workspace) => {
            const name = workspace.kind === "sql" ? workspace.name : workspace.view === "structure" ? `DDL: ${workspace.ref.table}` : workspace.ref.table;
            const status = workspace.externalConflict ? { externalConflict: true, statusLabel: "External changes" } : workspace.saveFailed ? { saveFailed: true, statusLabel: "Save failed" } : {};
            return {
                id: workspace.id,
                key: workspace.key,
                name,
                title: workspace.kind === "sql" ? workspace.title : workspaceTabTitle(workspace.ref, workspace.view),
                icon: workspace.kind === "sql" ? "code" : workspace.view === "structure" ? "columns" : workspace.ref.kind === "view" ? "eye" : "table",
                active: workspace.id === activeId,
                dirty: Boolean(workspace.dirty) || pendingChangeCountFor(changesByKey, workspace.key) > 0,
                dirtyLabel: WORKSPACE_DIRTY_LABEL,
                closeLabel: `Close ${name}`,
                ...status,
            };
        });
}

export function workspaceSwitchMenuItems({ order = [], byId = {}, onActivate } = {}) {
    return order
        .map((id) => byId[id])
        .filter(Boolean)
        .map((workspace) => ({
            label: workspace.kind === "sql" ? workspace.name : workspace.view === "structure" ? `DDL: ${workspace.ref.table}` : workspace.ref.table,
            onClick: () => onActivate?.(workspace.id),
        }));
}

export function sqlFileMenuItems({ files = [], onCreate, onOpen } = {}) {
    return [
        { label: "New SQL File...", onClick: onCreate },
        ...files.map((file) => ({ label: file.name, onClick: () => onOpen?.(file) })),
    ];
}

export function closeWorkspaceTabIntent(event, workspaceId, onClose) {
    event?.stopPropagation?.();
    onClose(workspaceId);
}
