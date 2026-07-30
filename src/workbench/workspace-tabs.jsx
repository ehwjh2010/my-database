import { useState } from "react";
import { Icon } from "../ui/icon.jsx";
import { ContextMenu } from "../ui/context-menu.jsx";
import { closeWorkspaceTabIntent, projectWorkspaceTabs, workspaceSwitchMenuItems } from "./workspace-chrome.js";

export function WorkspaceTabs({ order = [], activeId, byId = {}, changesByKey, onActivate, onClose }) {
    const [menu, setMenu] = useState(null);
    const tabs = projectWorkspaceTabs({ order, byId, activeId, changesByKey });
    const items = workspaceSwitchMenuItems({ order, byId, onActivate });

    return (
        <div className="workspace-tabs" data-testid="workspace-tabs">
            <div className="workspace-tabs-scroll" role="tablist" aria-label="Open workspaces">
                {tabs.map((tab) => (
                    <div
                        key={tab.id}
                        className={`workspace-tab ${tab.active ? "active" : ""}`}
                        data-workspace-key={tab.key}
                        data-dirty={tab.dirty ? "true" : "false"}
                        role="tab"
                        aria-selected={tab.active}
                        tabIndex={0}
                        title={tab.title}
                        onClick={() => onActivate(tab.id)}
                        onKeyDown={(event) => {
                            if (event.target !== event.currentTarget)
                                return;
                            if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                onActivate(tab.id);
                            }
                        }}
                    >
                        <Icon name={tab.icon} />
                        <span className="workspace-tab-name">{tab.name}</span>
                        {tab.dirty ? <span className="workspace-tab-dirty" role="img" aria-label={tab.dirtyLabel} title={tab.dirtyLabel} /> : null}
                        <button
                            type="button"
                            className="workspace-tab-close"
                            aria-label={tab.closeLabel}
                            title={tab.closeLabel}
                            onClick={(event) => closeWorkspaceTabIntent(event, tab.id, onClose)}
                        >
                            <Icon name="x" size={12} />
                        </button>
                    </div>
                ))}
            </div>
            <button
                type="button"
                className="workspace-tabs-all"
                data-testid="workspace-tabs-all"
                aria-label="切换工作区"
                title="切换工作区"
                disabled={!items.length}
                onClick={(event) => setMenu({ x: event.clientX, y: event.clientY })}
            >
                <Icon name="chevronRight" />
            </button>
            {menu ? <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} /> : null}
        </div>
    );
}
