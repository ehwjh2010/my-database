const COMMANDS = Object.freeze([
    ["refresh", "Refresh data", "refresh"],
    ["new-row", "Add Row", "plus"],
    ["delete-row", "Delete Row", "minus"],
    ["revert-selected", "Revert Selected", "undo"],
    ["review-dml", "Preview Pending Changes", "eye"],
    ["apply", "Apply changes", "arrowUp"],
    ["ddl", "DDL", "code"],
    ["import", "Import data", "upload"],
    ["export", "Export object", "download"],
]);

function reasonFor(id, input, mutationLocked, anyOperation) {
    if (!input.hasObject)
        return "OBJECT_REQUIRED";
    if (id === "refresh")
        return mutationLocked ? "DATA_MUTATION_IN_PROGRESS" : null;
    if (id === "ddl" || id === "export")
        return id === "export" && anyOperation ? "DATA_OPERATION_IN_PROGRESS" : null;
    if ((id === "apply" || id === "import") && anyOperation)
        return "DATA_OPERATION_IN_PROGRESS";
    if (mutationLocked && id !== "apply")
        return "DATA_MUTATION_IN_PROGRESS";
    if (!input.editable)
        return input.pageState === "loading" || input.pageState === "error" ? "DATA_NOT_READY" : "OBJECT_NOT_EDITABLE";
    if (id === "delete-row" && !input.hasStableSelection)
        return "NO_STABLE_SELECTION";
    if (id === "revert-selected") {
        if (!input.hasRevertTarget)
            return "NO_PENDING_CHANGES";
    }
    if ((id === "review-dml" || id === "apply") && input.pendingCount <= 0)
        return "NO_PENDING_CHANGES";
    if (id === "import") {
        if (!input.importSupported)
            return "IMPORT_UNSUPPORTED";
        if (input.pendingCount > 0)
            return "PENDING_CHANGES_EXIST";
        if (anyOperation)
            return "DATA_OPERATION_IN_PROGRESS";
    }
    return null;
}

function transferProgressFor(progress) {
    if (progress?.kind !== "import" && progress?.kind !== "export")
        return null;
    if (progress.status !== "running" && progress.status !== "done" && progress.status !== "error")
        return null;
    const fallback = progress.kind === "import" ? "Importing data" : "Exporting object";
    return {
        kind: progress.kind,
        status: progress.status,
        label: progress.label || fallback,
        indeterminate: progress.indeterminate === true,
        percent: Number.isFinite(progress.percent) ? progress.percent : (progress.status === "running" ? 0 : 100),
    };
}

export function deriveDataToolbar(input) {
    const normalized = input;
    const mutationLocked = normalized.operationKind === "apply" || normalized.operationKind === "import";
    const anyOperation = normalized.operationKind !== "idle";
    const commands = COMMANDS.map(([id, label, icon]) => {
        const reason = reasonFor(id, normalized, mutationLocked, anyOperation);
        const busy = normalized.operationKind === (id === "apply" ? "apply" : id === "import" ? "import" : id === "export" ? "export" : "__never__");
        const iconName = id === "review-dml" && normalized.pendingCount > 0 ? "eye-pending" : icon;
        return {
            id,
            label,
            icon: busy ? "clock" : iconName,
            visible: true,
            enabled: reason === null,
            disabled: reason !== null,
            disabledReason: reason,
            busy,
            ariaBusy: busy ? "true" : undefined,
            ariaDisabled: reason !== null ? "true" : undefined,
        };
    });
    return {
        commands,
        byId: Object.fromEntries(commands.map((command) => [command.id, command])),
        mutationLocked,
        anyOperation,
        pendingCount: normalized.pendingCount,
        pendingLabel: normalized.pendingCount > 0 ? `${normalized.pendingCount} pending` : null,
        pendingAriaLabel: normalized.pendingCount > 0 ? `${normalized.pendingCount} pending changes` : null,
        transferProgress: transferProgressFor(normalized.transferProgress),
    };
}

export const DATA_TOOLBAR_COMMANDS = COMMANDS;
