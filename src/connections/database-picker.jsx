import { useEffect, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { ENGINES } from "../lib/connections.js";
import { connectionTarget } from "./actions.js";
import { listDatabasesForConnection } from "./list-databases.js";

function sortDatabases(names, defaultDb) {
    return names.slice().sort((a, b) => {
        if (a === defaultDb)
            return -1;
        if (b === defaultDb)
            return 1;
        return a.localeCompare(b);
    });
}

export function DatabasePicker({ conn, panel, onBack, onSelect }) {
    const [phase, setPhase] = useState("loading");
    const [databases, setDatabases] = useState([]);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [reloadToken, setReloadToken] = useState(0);
    const defaultDb = conn.net?.database || "";

    useEffect(() => {
        let stale = false;
        setPhase("loading");
        setError("");
        listDatabasesForConnection(conn)
            .then((list) => {
                if (stale)
                    return;
                setDatabases(list);
                setPhase("ready");
            })
            .catch((err) => {
                if (stale)
                    return;
                setError(err.message || "Could not list databases");
                setPhase("error");
            });
        return () => { stale = true; };
    }, [conn, reloadToken]);

    const term = query.trim().toLowerCase();
    const filtered = sortDatabases(
        term ? databases.filter((name) => name.toLowerCase().includes(term)) : databases,
        defaultDb,
    );

    const header = panel ? (
        <div className="search-bar search-bar-compact" style={{ borderColor: "var(--muxy-border)" }}>
            <button className="icon-btn" title="Back" onClick={onBack}>
                <Icon name="left" />
            </button>
            <input
                type="text"
                placeholder="Search databases"
                className="search-bar-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={phase !== "ready"}
                autoFocus
            />
        </div>
    ) : (
        <div className="topbar">
            <button className="btn btn-compact" onClick={onBack}>
                <Icon name="left" />
                Back
            </button>
            <div className="min-w-0 truncate text-[var(--font-emphasis)] font-semibold">{conn.name || "Untitled"}</div>
            <div className="flex-1" />
            {phase === "ready" ? (
                <input type="text" placeholder="Search databases" className="w-56" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            ) : null}
        </div>
    );

    return (
        <div className="flex h-full flex-col">
            {header}
            {phase !== "error" ? (
                <div className={`database-picker-context ${panel ? "" : "mx-[var(--s7)] mt-[var(--s5)]"}`}>
                    <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: conn.color }} />
                    <div className="min-w-0 truncate text-[var(--font-body)] font-semibold">{conn.name || "Untitled"}</div>
                    <div className="mono min-w-0 flex-1 truncate text-[var(--font-footnote)] text-muted-foreground">
                        {`${ENGINES[conn.engine].label} · ${connectionTarget(conn)}`}
                    </div>
                </div>
            ) : null}
            <div className={`flex-1 overflow-y-auto ${panel ? "" : "px-[var(--s7)] py-[var(--s4)]"}`}>
                {phase === "loading" ? (
                    <EmptyState icon="database" description="Loading databases…" />
                ) : null}
                {phase === "error" ? (
                    <div className="flex h-full flex-col items-center justify-center gap-[var(--s5)] p-[var(--s8)]">
                        <Icon name="warning" size={24} />
                        <div className="text-[var(--font-title)] font-semibold">Could not list databases</div>
                        <div className="error-box" style={{ maxWidth: "var(--sheet-lg)" }}>{error}</div>
                        <div className="flex gap-[var(--s3)]">
                            <button className="btn" onClick={onBack}>Back</button>
                            <button className="btn btn-primary" onClick={() => setReloadToken((n) => n + 1)}>Retry</button>
                        </div>
                    </div>
                ) : null}
                {phase === "ready" && filtered.length === 0 ? (
                    <div className="py-[var(--s8)] text-center text-muted-foreground">
                        {databases.length === 0 ? "No databases found" : "No databases match your search"}
                    </div>
                ) : null}
                {phase === "ready" && filtered.length > 0 ? (
                    <div className={`flex flex-col ${panel ? "pt-[var(--s2)]" : "gap-[var(--s2)]"}`}>
                        {filtered.map((name) => {
                            const isDefault = name === defaultDb;
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    className={`database-row ${panel ? "database-row-panel" : "card"}`}
                                    onClick={() => onSelect(name)}
                                >
                                    <span className="database-row-icon">
                                        <Icon name="database" size={13} />
                                    </span>
                                    <span className="mono min-w-0 flex-1 truncate text-left">{name}</span>
                                    {isDefault ? <span className="tree-badge">Default</span> : null}
                                </button>
                            );
                        })}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
