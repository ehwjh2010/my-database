import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";
import { dumpDatabase, restoreDatabase } from "./transfer.js";

function MenuItem({ icon, label, onSelect }) {
    return (
        <button className="tree-row w-full text-left" onClick={onSelect}>
            <Icon name={icon} />
            {label}
        </button>
    );
}

export function DatabaseExportModal({ session, onClose, onDump }) {
    const run = () => {
        onClose();
        void (onDump ? onDump() : dumpDatabase(session));
    };
    return (
        <Modal icon="download" title="Export database" size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                <MenuItem icon="save" label="Dump entire database" onSelect={run} />
            </div>
        </Modal>
    );
}

export function DatabaseImportModal({ session, onClose, onRestore }) {
    const run = () => {
        onClose();
        void (onRestore ? onRestore() : restoreDatabase(session));
    };
    return (
        <Modal icon="upload" title="Import database" size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                <MenuItem icon="upload" label="Import SQL dump" onSelect={run} />
            </div>
        </Modal>
    );
}

export function ExportMenuModal({ onClose, onExport }) {
    const run = (format) => () => {
        onClose();
        void onExport(format);
    };
    return (
        <Modal icon="download" title="Export result" size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                <MenuItem icon="download" label="Export result as CSV" onSelect={run("csv")} />
                <MenuItem icon="download" label="Export result as JSON" onSelect={run("json")} />
                <MenuItem icon="download" label="Export result as SQL INSERTs" onSelect={run("sql")} />
            </div>
        </Modal>
    );
}
