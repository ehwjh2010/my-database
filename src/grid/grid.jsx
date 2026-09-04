import { useRef } from "react";
import { frozenTableStyle, useFrozenColumnWidths } from "./sticky-header.js";

const MAX_CELL_CHARS = 400;

export function cellDisplay(value) {
    if (value === null)
        return { null: true };
    const text = String(value);
    return {
        null: false,
        text: text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) + "…" : text,
        title: text.length > 60 ? text.slice(0, 1000) : undefined,
    };
}

export function CellValue({ value }) {
    const info = cellDisplay(value);
    if (info.null)
        return <span className="null-badge">NULL</span>;
    return <>{info.text}</>;
}

export function ColumnTooltip({ column }) {
    return (
        <span className="column-tooltip" role="tooltip">
            <span><strong>{column.name}</strong>{column.type ? `: ${column.type}` : null}</span>
            {column.comment ? <span>{column.comment}</span> : null}
        </span>
    );
}

export function Grid({ columns, rows }) {
    const headTableRef = useRef(null);
    const bodyTableRef = useRef(null);
    const colWidths = useFrozenColumnWidths(headTableRef, bodyTableRef, [columns, rows]);
    const tableStyle = frozenTableStyle(colWidths);
    if (!columns.length)
        return <div className="flex h-full items-center justify-center text-muted-foreground">No rows returned</div>;
    const colgroup = (key) => colWidths?.length ? (
        <colgroup key={key}>
            {colWidths.map((width, index) => (
                <col key={index} style={{ width, minWidth: width }} />
            ))}
        </colgroup>
    ) : null;
    return (
        <div className="grid-wrap">
            <div className="grid-head-pin">
                <table ref={headTableRef} className="grid-table" style={tableStyle}>
                    {colgroup("head")}
                    <thead>
                        <tr>
                            {columns.map((col) => (
                                <th key={col.name} className="column-header">
                                    {col.name}
                                    {col.type ? (
                                        <span className="ml-[var(--s2)] font-normal text-muted-foreground">{col.type.toLowerCase()}</span>
                                    ) : null}
                                    <ColumnTooltip column={col} />
                                </th>
                            ))}
                        </tr>
                    </thead>
                </table>
            </div>
            <table ref={bodyTableRef} className="grid-table" style={tableStyle}>
                {colgroup("body")}
                <tbody>
                    {rows.map((row, r) => (
                        <tr key={r}>
                            {row.map((value, c) => {
                                const info = cellDisplay(value);
                                return (
                                    <td key={c} title={info.title}>
                                        {info.null ? <span className="null-badge">NULL</span> : info.text}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
