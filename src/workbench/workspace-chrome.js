import { pendingChangeCountFor } from "./workspace-state.js";

export const WORKSPACE_DIRTY_LABEL = "Unsaved changes";

export function workspaceTabTitle(ref) {
    return ref?.kind === "view" ? `View: ${ref?.table ?? ""}` : ref?.table ?? "";
}

export function projectWorkspaceTabs({ order = [], byId = {}, activeId = null, changesByKey } = {}) {
    return order
        .map((id) => byId[id])
        .filter(Boolean)
        .map((workspace) => ({
            id: workspace.id,
            key: workspace.key,
            name: workspace.ref.table,
            title: workspaceTabTitle(workspace.ref),
            icon: workspace.ref.kind === "view" ? "eye" : "table",
            active: workspace.id === activeId,
            dirty: pendingChangeCountFor(changesByKey, workspace.key) > 0,
            dirtyLabel: WORKSPACE_DIRTY_LABEL,
            closeLabel: `Close ${workspace.ref.table}`,
        }));
}

export function workspaceSwitchMenuItems({ order = [], byId = {}, onActivate } = {}) {
    return order
        .map((id) => byId[id])
        .filter(Boolean)
        .map((workspace) => ({
            label: workspace.ref.table,
            onClick: () => onActivate?.(workspace.id),
        }));
}

export function closeWorkspaceTabIntent(event, workspaceId, onClose) {
    event?.stopPropagation?.();
    onClose(workspaceId);
}
