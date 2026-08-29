import { Icon } from "../ui/icon.jsx";
import { ENGINES } from "../lib/connections.js";
import { useSession } from "./session-context.jsx";
import { ScopeSelects } from "./scope-selects.jsx";

export function Topbar() {
    const { session, changeScope, refreshSchema, schemaEpoch } = useSession();
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
            <button className="icon-btn" title="Refresh schema" onClick={refreshSchema}>
                <Icon name="refresh" />
            </button>
        </div>
    );
}
