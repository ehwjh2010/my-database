import { Modal } from "../ui/modal.jsx";
import { Icon } from "../ui/icon.jsx";

const FORMATS = [
    ["csv", "CSV"],
    ["json", "JSON"],
    ["sql", "SQL INSERTs"],
];

export function ObjectExportMenu({ onClose, onExport }) {
    return (
        <Modal icon="download" title="Export object" size="sm" onClose={onClose}>
            <div className="py-[var(--s3)]">
                {FORMATS.map(([format, label]) => (
                    <button key={format} className="tree-row w-full text-left" onClick={() => onExport(format)}>
                        <Icon name="download" />
                        Export as {label}
                    </button>
                ))}
                <p className="px-[var(--s5)] py-[var(--s3)] text-[var(--font-footnote)] text-muted-foreground">Exports committed object data, up to 1,000,000 rows.</p>
            </div>
        </Modal>
    );
}
