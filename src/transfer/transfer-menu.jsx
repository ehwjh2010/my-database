import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";
import { exportTable, importCsv, dumpDatabase } from "./transfer.js";

function MenuItem({ icon, label, onSelect }) {
    return (
        <button className="tree-row w-full text-left" onClick={onSelect}>
            <Icon name={icon} />
            {label}
        </button>
    );
}

export function TransferMenuModal({ session, tableRef, onClose }) {
    const run = (fn) => () => {
        onClose();
        fn();
    };
    return (
        <Modal icon="download" title="Import / Export" size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                {tableRef ? (
                    <>
                        <MenuItem icon="download" label="Export table as CSV" onSelect={run(() => exportTable(session, tableRef, "csv"))} />
                        <MenuItem icon="download" label="Export table as JSON" onSelect={run(() => exportTable(session, tableRef, "json"))} />
                        <MenuItem icon="download" label="Export table as SQL INSERTs" onSelect={run(() => exportTable(session, tableRef, "sql"))} />
                        <MenuItem icon="upload" label="Import CSV into table" onSelect={run(() => importCsv(session, tableRef))} />
                    </>
                ) : null}
                <MenuItem icon="save" label="Dump entire database" onSelect={run(() => dumpDatabase(session))} />
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
