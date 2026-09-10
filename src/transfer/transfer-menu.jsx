import { useState } from "react";
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

function ObjectPicker({ objects, selected, filter, setFilter, setSelected }) {
    const term = filter.trim().toLowerCase();
    const visible = objects.filter((table) => !term || table.name.toLowerCase().includes(term));
    const toggle = (name) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(name))
                next.delete(name);
            else
                next.add(name);
            return next;
        });
    };
    return (
        <>
            <div className="flex items-center gap-[var(--s2)]">
                <input type="text" placeholder="Filter tables" className="min-w-0 flex-1" value={filter} onChange={(event) => setFilter(event.target.value)} />
                {filter ? (
                    <button type="button" className="icon-btn" title="Clear filter" aria-label="Clear filter" onClick={() => setFilter("")}>
                        <Icon name="x" />
                    </button>
                ) : null}
            </div>
            <div className="flex items-center gap-[var(--s3)]">
                <button type="button" className="btn btn-compact" onClick={() => setSelected(new Set(objects.map((table) => table.name)))}>All</button>
                <button type="button" className="btn btn-compact" onClick={() => setSelected(new Set())}>None</button>
                <span className="flex-1 text-right text-[var(--font-footnote)] text-muted-foreground">{selected.size} of {objects.length}</span>
            </div>
            <div className="dump-table-list">
                {visible.length ? visible.map((table) => (
                    <label key={`${table.kind || "table"}:${table.name}`} className="flex items-center gap-[var(--s3)]">
                        <input type="checkbox" checked={selected.has(table.name)} onChange={() => toggle(table.name)} />
                        <Icon name={table.kind === "view" ? "eye" : "table"} />
                        <span className="truncate">{table.name}</span>
                    </label>
                )) : (
                    <div className="text-muted-foreground">No matches</div>
                )}
            </div>
        </>
    );
}

export function DatabaseExportModal({ session, onClose, onDump }) {
    const objects = (session.tables || []).filter((table) => table?.name);
    const [filter, setFilter] = useState("");
    const [selected, setSelected] = useState(() => new Set(objects.map((table) => table.name)));
    const canExport = !objects.length || selected.size > 0;

    const run = () => {
        if (!canExport)
            return;
        const tables = objects.length ? objects.filter((table) => selected.has(table.name)) : undefined;
        onClose();
        void (onDump ? onDump(tables) : dumpDatabase(session, { tables }));
    };

    return (
        <Modal
            icon="download"
            title="Export database"
            onClose={onClose}
            footer={
                <>
                    <button type="button" className="btn" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={!canExport} onClick={run}>Export</button>
                </>
            }
        >
            <div className="sheet-body">
                {objects.length ? (
                    <ObjectPicker objects={objects} selected={selected} filter={filter} setFilter={setFilter} setSelected={setSelected} />
                ) : (
                    <p className="text-muted-foreground">No tables in this database. Export will dump the database as a whole.</p>
                )}
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
