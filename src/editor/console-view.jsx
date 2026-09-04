import { useState } from "react";
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
