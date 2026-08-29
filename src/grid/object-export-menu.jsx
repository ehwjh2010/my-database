import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";

const FORMATS = [
    ["csv", "CSV"],
    ["json", "JSON"],
    ["sql", "SQL INSERTs"],
];

export function ObjectFormatMenu({ icon, title, action, note, onClose, onPick }) {
    return (
        <Modal icon={icon} title={title} size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                {FORMATS.map(([format, label]) => (
                    <button key={format} className="tree-row w-full text-left" onClick={() => onPick(format)}>
                        <Icon name={icon} />
                        {action} {label}
                    </button>
                ))}
                {note ? (
                    <p className="px-[var(--s5)] py-[var(--s3)] text-[var(--font-footnote)] text-muted-foreground">{note}</p>
                ) : null}
            </div>
        </Modal>
    );
}

export function ObjectExportMenu({ onClose, onExport }) {
    return (
        <ObjectFormatMenu
            icon="download"
            title="Export object"
            action="Export as"
            note="Exports committed object data, up to 1,000,000 rows."
            onClose={onClose}
            onPick={onExport}
        />
    );
}

export function ObjectImportMenu({ onClose, onImport }) {
    return (
        <ObjectFormatMenu
            icon="upload"
            title="Import data"
            action="Import from"
            note="Imports into the current table. Existing rows are not modified."
            onClose={onClose}
            onPick={onImport}
        />
    );
}
