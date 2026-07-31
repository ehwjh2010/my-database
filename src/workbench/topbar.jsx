import { Icon } from "../ui/icon.jsx";
import { ENGINES } from "../lib/connections.js";
import { useSession } from "./session-context.jsx";
import { ScopeSelects } from "./scope-selects.jsx";

const VIEWS = [
    { id: "data", label: "Data", icon: "grid" },
    { id: "structure", label: "Structure", icon: "columns" },
    { id: "query", label: "Console", icon: "code" },
];

export function Topbar() {
    const { session, view, activeId, setView, changeScope, refreshSchema, schemaEpoch } = useSession();
    const conn = session.conn;

    return (
        <div className="topbar">
            <div className="conn-dot ml-[var(--s2)]" style={{ background: conn.color }} />
            <div className="truncate text-[var(--font-emphasis)] font-semibold">{conn.name}</div>
            <div className="truncate text-[var(--font-footnote)] text-muted-foreground">
                {`${ENGINES[conn.engine].label}${session.serverVersion ? " " + session.serverVersion : ""}`}
            </div>
            <ScopeSelects key={schemaEpoch} session={session} onScopeChange={changeScope} />
            <div className="flex-1" />
            {activeId ? (
                <div className="seg">
                    {VIEWS.map((v) => (
                        <button
                            key={v.id}
                            className={view === v.id ? "active" : ""}
                            data-testid={`workspace-mode-${v.id}`}
                            aria-pressed={view === v.id}
                            onClick={() => setView(v.id)}
                        >
                            <Icon name={v.icon} />
                            {v.label}
                        </button>
                    ))}
                </div>
            ) : null}
            <button className="icon-btn" title="Refresh schema" onClick={refreshSchema}>
                <Icon name="refresh" />
            </button>
        </div>
    );
}
