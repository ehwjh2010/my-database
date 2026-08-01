import { useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { Modal } from "../ui/modal.jsx";

export function NewSqlFileModal({ error, onClose, onSubmit }) {
    const [name, setName] = useState("");
    const [busy, setBusy] = useState(false);

    const submit = async () => {
        if (busy)
            return;
        setBusy(true);
        await onSubmit(name);
        setBusy(false);
    };

    return (
        <Modal
            icon="file"
            title="New SQL File"
            size="sm"
            onClose={onClose}
            footer={(
                <>
                    <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" onClick={submit} disabled={busy}>Create</button>
                </>
            )}
        >
            <div className="flex flex-col gap-[var(--s3)] px-[var(--s7)] py-[var(--s6)]">
                <label htmlFor="new-sql-file-name">File name</label>
                <input
                    id="new-sql-file-name"
                    data-testid="new-sql-file-name"
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            submit();
                        }
                    }}
                />
                {error ? <div className="error-box" role="alert">{error}</div> : null}
            </div>
        </Modal>
    );
}

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
