import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { isCurrentStructureRead, cachedStructureSnapshot, commitStructureSnapshot, loadStructureSnapshot } from "../workbench/structure-runtime.js";
import { objectCacheKey } from "../workbench/workspace-state.js";
import { MarkedText, Section } from "./info-table.jsx";
import { ForeignKeyList, IndexList } from "./structure-keys.jsx";
import { DdlEditor } from "./ddl-editor.jsx";
import { revealDdlMatch } from "./ddl-editor.js";
import { matchRanges, nextMatchIndex } from "./structure-search.js";
import { useSession } from "../workbench/session-context.jsx";

function isFindShortcut(event) {
    if (!(event.metaKey || event.ctrlKey) || event.altKey)
        return false;
    return event.key === "f" || event.key === "F" || event.key === "Enter";
}

function StructureFindBar({ query, setQuery, activeIndex, matchCount, onNext, onPrev, onClose, inputRef }) {
    return (
        <div className="structure-find-bar">
            <Icon name="search" size={12} />
            <input
                ref={inputRef}
                type="text"
                className="structure-find-input"
                placeholder="Find"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        if (event.shiftKey)
                            onPrev();
                        else
                            onNext();
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        onClose();
                    }
                }}
            />
            <span className="structure-find-count">
                {query ? (matchCount ? `${activeIndex + 1}/${matchCount}` : "0/0") : ""}
            </span>
            <button type="button" className="icon-btn structure-find-prev" title="Previous" disabled={!matchCount} onClick={onPrev}>
                <Icon name="chevronDown" size={12} />
            </button>
            <button type="button" className="icon-btn" title="Next" disabled={!matchCount} onClick={onNext}>
                <Icon name="chevronDown" size={12} />
            </button>
            <button type="button" className="icon-btn" title="Close" onClick={onClose}>
                <Icon name="x" size={12} />
            </button>
        </div>
    );
}

export function StructureView({ session, workspaceId, tableRef }) {
    const { ddlSearchRef } = useSession();
    const workspaceKey = objectCacheKey(tableRef);
    const [state, setState] = useState(() => {
        const cached = cachedStructureSnapshot(session, workspaceKey);
        return cached ? { loading: false, info: cached.info, ddl: cached.ddl } : { loading: true };
    });
    const [findOpen, setFindOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const matchCountRef = useRef(0);
    const findOpenRef = useRef(false);
    const findInputRef = useRef(null);
    const pageRef = useRef(null);
    const ddlViewRef = useRef(null);
    const titleCountRef = useRef(0);
    const ddlCountRef = useRef(0);
    findOpenRef.current = findOpen;

    useEffect(() => {
        if (!tableRef || !workspaceId)
            return;
        const cached = cachedStructureSnapshot(session, workspaceKey);
        if (cached) {
            setState({ loading: false, info: cached.info, ddl: cached.ddl });
            return;
        }
        const read = session.coordinator.initiateStructureRead(workspaceId);
        if (read.error) {
            setState({ loading: false, error: read.error });
            return;
        }
        let stale = false;
        setState({ loading: true });
        loadStructureSnapshot(session, read).then((snapshot) => {
            const committed = commitStructureSnapshot(session, read, snapshot);
            if (!stale && committed)
                setState({ loading: false, info: snapshot.info, ddl: snapshot.ddl });
        }).catch((error) => {
            if (!stale && isCurrentStructureRead(session, read))
                setState({ loading: false, error: error.message });
        });
        return () => { stale = true; };
    }, [session, workspaceId, tableRef, workspaceKey, session.structureRevision]);

    const openFind = () => {
        setFindOpen(true);
        requestAnimationFrame(() => {
            findInputRef.current?.focus();
            findInputRef.current?.select();
        });
    };

    const closeFind = () => {
        setFindOpen(false);
        requestAnimationFrame(() => pageRef.current?.focus());
    };

    useEffect(() => {
        if (!ddlSearchRef)
            return;
        ddlSearchRef.current = { search: openFind };
        return () => { ddlSearchRef.current = null; };
    }, [ddlSearchRef]);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === "Escape" && findOpenRef.current) {
                event.preventDefault();
                closeFind();
                return;
            }
            if (!isFindShortcut(event))
                return;
            event.preventDefault();
            event.stopPropagation();
            openFind();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);

    useEffect(() => {
        setActiveIndex(0);
    }, [query]);

    useEffect(() => {
        if (!findOpen)
            return;
        const index = activeIndex;
        const titleCount = titleCountRef.current;
        const ddlCount = ddlCountRef.current;
        if (index >= titleCount && index < titleCount + ddlCount) {
            revealDdlMatch(ddlViewRef.current, query.trim(), index - titleCount);
            return;
        }
        document.querySelector(`[data-structure-match="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [findOpen, query, activeIndex]);

    if (!tableRef)
        return <EmptyState icon="columns" description="Select a table to inspect its structure" />;

    const scroll = "flex min-h-0 flex-1 flex-col";
    if (state.loading)
        return <div className={`${scroll} overflow-y-auto p-[var(--s7)]`}><div className="text-muted-foreground">Loading…</div></div>;
    if (state.error)
        return <div className={`${scroll} overflow-y-auto p-[var(--s7)]`}><div className="error-box">{state.error}</div></div>;

    const { info, ddl } = state;
    const searchQuery = findOpen ? query.trim() : "";
    const titleCount = searchQuery ? matchRanges(tableRef.table, searchQuery).length : 0;
    const ddlCount = searchQuery && ddl ? matchRanges(ddl, searchQuery).length : 0;
    titleCountRef.current = titleCount;
    ddlCountRef.current = ddlCount;
    let matchCursor = 0;
    const nextIndex = () => matchCursor++;
    const page = (
        <>
            <div className="mb-[var(--s6)] flex items-center gap-[var(--s4)]">
                <div className="text-[var(--font-title)] font-semibold">
                    <MarkedText text={tableRef.table} query={searchQuery} activeIndex={activeIndex} nextIndex={nextIndex} />
                </div>
                <span className="text-[var(--font-footnote)] text-muted-foreground">{tableRef.kind === "view" ? "view" : "table"}</span>
            </div>
            <div className="flex flex-col gap-[var(--s7)]">
                {ddl ? (
                    <Section title="DDL">
                        <DdlEditor engine={session.conn.engine} doc={ddl} query={searchQuery} viewRef={ddlViewRef} />
                    </Section>
                ) : null}
                {(() => {
                    matchCursor = titleCount + ddlCount;
                    return null;
                })()}
                <IndexList info={info} query={searchQuery} activeIndex={activeIndex} nextIndex={nextIndex} />
                <ForeignKeyList foreignKeys={info.foreignKeys} query={searchQuery} activeIndex={activeIndex} nextIndex={nextIndex} />
            </div>
        </>
    );
    matchCountRef.current = matchCursor;
    const matchCount = matchCursor;
    const go = (direction) => {
        setActiveIndex((current) => nextMatchIndex(matchCountRef.current, current, direction));
    };

    return (
        <div ref={pageRef} className={`${scroll} outline-none`} tabIndex={0}>
            {findOpen ? (
                <StructureFindBar
                    query={query}
                    setQuery={setQuery}
                    activeIndex={matchCount ? Math.min(activeIndex, matchCount - 1) : 0}
                    matchCount={matchCount}
                    onNext={() => go(1)}
                    onPrev={() => go(-1)}
                    onClose={closeFind}
                    inputRef={findInputRef}
                />
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto p-[var(--s7)]">
                {page}
            </div>
        </div>
    );
}
