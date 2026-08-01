import { useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { Modal } from "../ui/modal.jsx";

function SqlFileNameModal({ title, submitLabel, testId, initialName = "", error, onClose, onSubmit }) {
    const [name, setName] = useState(initialName);
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
            title={title}
            size="sm"
            onClose={onClose}
            footer={(
                <>
                    <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" onClick={submit} disabled={busy}>{submitLabel}</button>
                </>
            )}
        >
            <div className="flex flex-col gap-[var(--s3)] px-[var(--s7)] py-[var(--s6)]">
                <label htmlFor={testId}>File name</label>
                <input
                    id={testId}
                    data-testid={testId}
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

export function NewSqlFileModal({ error, onClose, onSubmit }) {
    return <SqlFileNameModal title="New SQL File" submitLabel="Create" testId="new-sql-file-name" error={error} onClose={onClose} onSubmit={onSubmit} />;
}

export function RenameSqlFileModal({ name, error, onClose, onSubmit }) {
    return <SqlFileNameModal title="Rename SQL File" submitLabel="Rename" testId="rename-sql-file-name" initialName={name} error={error} onClose={onClose} onSubmit={onSubmit} />;
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
