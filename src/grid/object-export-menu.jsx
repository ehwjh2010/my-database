import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";

const FORMATS = [
    ["csv", "CSV"],
    ["json", "JSON"],
    ["sql", "SQL"],
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
            note="SQL includes DROP IF EXISTS, CREATE, and committed rows. CSV and JSON are data only."
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
            note="CSV and JSON clear the current table then insert. SQL runs the dump, replacing a table of the same name."
            onClose={onClose}
            onPick={onImport}
        />
    );
}
