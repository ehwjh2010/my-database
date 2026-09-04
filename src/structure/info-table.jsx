import { splitHighlighted } from "./structure-search.js";

export function MarkedText({ text, query, activeIndex, nextIndex }) {
    if (!query)
        return text == null ? "" : String(text);
    return splitHighlighted(text, query).map((piece, index) => {
        if (!piece.match)
            return piece.text;
        const matchIndex = nextIndex();
        return (
            <mark
                key={`${matchIndex}:${index}`}
                data-structure-match={matchIndex}
                className={matchIndex === activeIndex ? "structure-match is-current" : "structure-match"}
            >
                {piece.text}
            </mark>
        );
    });
}

export function InfoTable({ headers, rows, query, activeIndex, nextIndex }) {
    const mark = query
        ? (text) => <MarkedText text={text} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
        : null;
    return (
        <div className="grid-wrap grid-wrap-inline">
            <table className="grid-table grid-table-structure">
                <thead>
                    <tr>
                        {headers.map((head) => (
                            <th key={head}>{head}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.length ? (
                        rows.map((row, r) => (
                            <tr key={r}>
                                {row.map((cell, c) => {
                                    const text = cell === null ? "" : String(cell);
                                    return (
                                        <td key={c} title={text.length > 60 ? text : undefined}>
                                            {cell === null ? <span className="null-badge">—</span> : (mark ? mark(text) : text)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={headers.length} className="text-muted-foreground">
                                None
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}

export function Section({ title, children }) {
    return (
        <div className="flex flex-col gap-[var(--s3)]">
            <div className="section-label">{title}</div>
            {children}
        </div>
    );
}
