import { pendingChangeCountFor } from "./workspace-state.js";

export const WORKSPACE_DIRTY_LABEL = "Unsaved changes";

export function workspaceTabTitle(ref) {
    return ref?.kind === "view" ? `View: ${ref?.table ?? ""}` : ref?.table ?? "";
}

export function projectWorkspaceTabs({ order = [], byId = {}, activeId = null, changesByKey } = {}) {
    return order
        .map((id) => byId[id])
        .filter(Boolean)
        .map((workspace) => {
            const name = workspace.kind === "sql" ? workspace.name : workspace.ref.table;
            return {
                id: workspace.id,
                key: workspace.key,
                name,
                title: workspace.kind === "sql" ? workspace.title : workspaceTabTitle(workspace.ref),
                icon: workspace.kind === "sql" ? "code" : workspace.ref.kind === "view" ? "eye" : "table",
                active: workspace.id === activeId,
                dirty: pendingChangeCountFor(changesByKey, workspace.key) > 0,
                dirtyLabel: WORKSPACE_DIRTY_LABEL,
                closeLabel: `Close ${name}`,
            };
        });
}

export function workspaceSwitchMenuItems({ order = [], byId = {}, onActivate } = {}) {
    return order
        .map((id) => byId[id])
        .filter(Boolean)
        .map((workspace) => ({
            label: workspace.kind === "sql" ? workspace.name : workspace.ref.table,
            onClick: () => onActivate?.(workspace.id),
        }));
}

export function sqlFileMenuItems({ files = [], order = [], byId = {}, onCreate, onOpen } = {}) {
    const openNames = new Set(order.map((id) => byId[id]?.name).filter(Boolean));
    return [
        { label: "New SQL File...", onClick: onCreate },
        ...files
            .filter((file) => !file.reserved && !openNames.has(file.name))
            .map((file) => ({ label: file.name, onClick: () => onOpen?.(file) })),
    ];
}

export function closeWorkspaceTabIntent(event, workspaceId, onClose) {
    event?.stopPropagation?.();
    onClose(workspaceId);
}
