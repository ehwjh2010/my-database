import { Icon } from "../ui/icon.jsx";
import { deriveDataToolbar } from "./data-toolbar.js";

const GROUPS = [
    ["group-a", ["refresh", "new-row", "delete-row"]],
    ["group-b", ["discard-all", "review-dml", "apply"]],
    ["group-c", ["ddl", "import", "export"]],
];

export function DataToolbar({ input, onAction }) {
    const projection = deriveDataToolbar(input);
    return (
        <div className="data-toolbar" data-toolbar="true" data-toolbar-state={input.pageState}>
            {GROUPS.map(([group, ids]) => (
                <div key={group} className={`data-toolbar-group ${group}`} data-toolbar-group={group}>
                    {ids.map((id) => {
                        const command = projection.byId[id];
                        const label = command.busy ? `${command.label} in progress` : command.label;
                        return (
                            <button
                                key={id}
                                type="button"
                                className="data-toolbar-command icon-btn"
                                data-toolbar-command={id}
                                aria-label={label}
                                aria-disabled={command.disabled ? "true" : undefined}
                                aria-busy={command.busy ? "true" : undefined}
                                disabled={command.disabled}
                                title={command.disabledReason || label}
                                onClick={() => onAction(id)}
                            >
                                <Icon name={command.icon} size={14} />
                            </button>
                        );
                    })}
                    {group === "group-b" ? (
                        <span className="data-toolbar-pending" data-toolbar-pending aria-label={projection.pendingAriaLabel || "No pending changes"}>
                            {projection.pendingLabel || ""}
                        </span>
                    ) : null}
                </div>
            ))}
        </div>
    );
}
