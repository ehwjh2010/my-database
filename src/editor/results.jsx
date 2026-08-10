import { useEffect, useId, useRef, useState } from "react";
import { Grid } from "../grid/grid.jsx";
import { formatNumber } from "../lib/format.js";
import { Icon } from "../ui/icon.jsx";

function metaLine(result) {
    const meta = [];
    if (result.columns.length)
        meta.push(`${formatNumber(result.rows.length)} row${result.rows.length === 1 ? "" : "s"}`);
    if (result.affectedRows != null && !result.columns.length)
        meta.push(`${formatNumber(result.affectedRows)} affected`);
    if (result.commandTag)
        meta.push(result.commandTag);
    meta.push(`${result.durationMs}ms`);
    return meta.join(" · ");
}

function ResultBlock({ result, label }) {
    return (
        <div className="result-block result-block-single flex min-h-0 flex-1 flex-col">
            <div
                className="flex items-center gap-[var(--s4)] border-b px-[var(--s4)] py-[var(--s2)] text-[var(--font-footnote)] text-muted-foreground"
                style={{ borderColor: "var(--muxy-border)" }}
            >
                {label}
                <div className="flex-1" />
                {metaLine(result)}
            </div>
            {result.columns.length ? (
                <div className="result-grid flex min-h-0 flex-1 flex-col">
                    <Grid columns={result.columns} rows={result.rows} />
                </div>
            ) : (
                <div className="px-[var(--s4)] py-[var(--s3)] text-muted-foreground">
                    {result.affectedRows != null
                        ? `OK — ${formatNumber(result.affectedRows)} row${result.affectedRows === 1 ? "" : "s"} affected`
                        : "OK"}
                </div>
            )}
        </div>
    );
}

function resultLabel(index) {
    return `Result ${index + 1}`;
}

export function Results({ results, error, onClose }) {
    const baseId = useId();
    const resultsRef = useRef(results);
    const [activeIndex, setActiveIndex] = useState(0);
    const [closedIndexes, setClosedIndexes] = useState([]);

    useEffect(() => {
        resultsRef.current = results;
        setActiveIndex(0);
        setClosedIndexes([]);
    }, [results]);

    if (error)
        return (
            <div className="p-[var(--s5)]">
                <div className="error-box">{error}</div>
            </div>
        );
    if (!results || !results.length)
        return null;

    const previousResults = resultsRef.current !== results;
    const tabs = results
        .map((result, index) => ({ result, index }))
        .filter(({ index }) => previousResults || !closedIndexes.includes(index));
    if (!tabs.length)
        return null;
    const active = tabs.find(({ index }) => index === (previousResults ? 0 : activeIndex)) || tabs[0];

    const close = (index) => {
        const remaining = tabs.filter((tab) => tab.index !== index);
        if (!remaining.length) {
            onClose?.();
            return;
        }
        setClosedIndexes((current) => [...current, index]);
        if (active.index === index) {
            const current = tabs.findIndex((tab) => tab.index === index);
            setActiveIndex((tabs[current + 1] || tabs[current - 1]).index);
        }
    };

    if (results.length === 1)
        return (
            <div className="flex h-full min-h-0 flex-col p-[var(--s4)]">
                <ResultBlock result={active.result} label="Result" />
            </div>
        );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="result-tabs" role="tablist" aria-label="Query results">
                {tabs.map(({ index }) => {
                    const activeTab = active.index === index;
                    const tabId = `${baseId}-tab-${index}`;
                    const panelId = `${baseId}-panel-${index}`;
                    return (
                        <div key={index} className={`result-tab${activeTab ? " active" : ""}`}>
                            <button
                                id={tabId}
                                type="button"
                                className="result-tab-select"
                                role="tab"
                                aria-selected={activeTab}
                                aria-controls={panelId}
                                onClick={() => setActiveIndex(index)}
                            >
                                <Icon name="table" size={14} />
                                <span>{resultLabel(index)}</span>
                            </button>
                            <button type="button" className="result-tab-close" title={`Close ${resultLabel(index)}`} onClick={() => close(index)}>
                                <Icon name="x" size={12} />
                            </button>
                        </div>
                    );
                })}
            </div>
            <div
                id={`${baseId}-panel-${active.index}`}
                className="min-h-0 flex-1"
                role="tabpanel"
                aria-labelledby={`${baseId}-tab-${active.index}`}
            >
                <ResultBlock result={active.result} label={resultLabel(active.index)} />
            </div>
        </div>
    );
}
