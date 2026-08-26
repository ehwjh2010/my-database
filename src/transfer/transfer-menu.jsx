import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";
import { dumpDatabase } from "./transfer.js";

function MenuItem({ icon, label, onSelect }) {
    return (
        <button className="tree-row w-full text-left" onClick={onSelect}>
            <Icon name={icon} />
            {label}
        </button>
    );
}

export function DatabaseExportModal({ session, onClose }) {
    const run = () => {
        onClose();
        void dumpDatabase(session);
    };
    return (
        <Modal icon="download" title="Export database" size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                <MenuItem icon="save" label="Dump entire database" onSelect={run} />
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
