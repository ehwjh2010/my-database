import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";

export function ConsoleView({ state, hasDatabase, hasQueryTab, onNewQuery, onRetry }) {
    const phase = state?.phase || "missing";
    const loading = phase === "loading";
    const ready = phase === "ready";
    const disabled = !hasDatabase || !hasQueryTab || loading || phase === "error";

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="toolbar border-b" style={{ borderColor: "var(--muxy-border)" }}>
                <button className="btn btn-compact btn-primary" disabled={disabled}>
                    <Icon name="play" />
                    Run
                </button>
                <button className="btn btn-compact" disabled={disabled}>Explain</button>
                <div className="flex-1" />
                <button className="icon-btn" title="Export results as CSV" disabled={disabled}>
                    <Icon name="download" />
                </button>
                <button className="btn btn-compact" disabled={!hasDatabase || !ready} onClick={onNewQuery}>
                    <Icon name="plus" />
                    New Query
                </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
                {!hasDatabase ? (
                    <EmptyState icon="database" title="Database required" description="Select a database first to open Console." />
                ) : loading ? (
                    <EmptyState icon="refresh" title="Loading Console" description="Preparing the SQL file space…" />
                ) : phase === "error" ? (
                    <EmptyState icon="warning" title="Could not load SQL files" description="The Console file list could not be loaded.">
                        <div className="error-box max-w-[var(--sheet-lg)] text-left">{state.error?.message || String(state.error)}</div>
                        <button className="btn" onClick={onRetry}>
                            <Icon name="refresh" />
                            Retry
                        </button>
                    </EmptyState>
                ) : (
                    <EmptyState icon="code" title="Database Console" description="No SQL tabs open.">
                        <button className="btn btn-primary" onClick={onNewQuery}>
                            <Icon name="plus" />
                            New Query
                        </button>
                    </EmptyState>
                )}
            </div>
        </div>
    );
}
