import { Icon } from "../ui/icon.jsx";
import { MarkedText, Section } from "./info-table.jsx";
import { actionLabel, displayIndexes, groupForeignKeys, indexKind } from "./structure-keys.js";

function Chip({ text, query, activeIndex, nextIndex }) {
    return (
        <span className="structure-chip mono">
            <MarkedText text={text} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
        </span>
    );
}

function Badge({ children }) {
    return <span className="structure-badge">{children}</span>;
}

function EmptyHint({ text }) {
    return <div className="structure-key-empty text-muted-foreground">{text}</div>;
}

function KeyCard({ icon, title, badges, children }) {
    return (
        <div className="structure-key-card">
            <div className="structure-key-head">
                <Icon name={icon} size={14} />
                <div className="structure-key-title mono">{title}</div>
                {badges}
            </div>
            {children}
        </div>
    );
}

export function IndexList({ info, query, activeIndex, nextIndex }) {
    const indexes = displayIndexes(info);
    return (
        <Section title={indexes.length ? `Indexes · ${indexes.length}` : "Indexes"}>
            {indexes.length ? (
                <div className="structure-key-list">
                    {indexes.map((index) => {
                        const kind = indexKind(index, info.primaryKey);
                        const badge = kind === "primary" ? "PRIMARY" : kind === "unique" ? "UNIQUE" : "INDEX";
                        return (
                            <KeyCard
                                key={index.name}
                                icon={kind === "index" ? "bolt" : "key"}
                                title={<MarkedText text={index.name} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />}
                                badges={<Badge>{badge}</Badge>}
                            >
                                <div className="structure-chips">
                                    {(index.columns || []).map((column) => (
                                        <Chip key={column} text={column} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
                                    ))}
                                </div>
                                {index.definition ? (
                                    <div className="structure-key-note mono text-muted-foreground">
                                        <MarkedText text={index.definition} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
                                    </div>
                                ) : null}
                            </KeyCard>
                        );
                    })}
                </div>
            ) : (
                <EmptyHint text="No indexes on this table" />
            )}
        </Section>
    );
}

export function ForeignKeyList({ foreignKeys, query, activeIndex, nextIndex }) {
    const groups = groupForeignKeys(foreignKeys);
    return (
        <Section title={groups.length ? `Foreign keys · ${groups.length}` : "Foreign keys"}>
            {groups.length ? (
                <div className="structure-key-list">
                    {groups.map((group) => {
                        const title = group.name || `${group.columns.join(", ")} → ${group.refTable}`;
                        const update = actionLabel(group.onUpdate);
                        const remove = actionLabel(group.onDelete);
                        return (
                            <KeyCard
                                key={`${group.name}:${group.columns.join(",")}`}
                                icon="link"
                                title={<MarkedText text={title} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />}
                                badges={(
                                    <>
                                        {update ? <Badge>{`ON UPDATE ${update}`}</Badge> : null}
                                        {remove ? <Badge>{`ON DELETE ${remove}`}</Badge> : null}
                                    </>
                                )}
                            >
                                <div className="structure-key-ref">
                                    <div className="structure-chips">
                                        {group.columns.map((column) => (
                                            <Chip key={`src:${column}`} text={column} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
                                        ))}
                                    </div>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="mono">
                                        <MarkedText text={group.refTable} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
                                    </span>
                                    <div className="structure-chips">
                                        {group.refColumns.map((column) => (
                                            <Chip key={`ref:${column}`} text={column} query={query} activeIndex={activeIndex} nextIndex={nextIndex} />
                                        ))}
                                    </div>
                                </div>
                            </KeyCard>
                        );
                    })}
                </div>
            ) : (
                <EmptyHint text="No foreign keys on this table" />
            )}
        </Section>
    );
}
