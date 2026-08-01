import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../ui/empty-state.jsx";
import { Icon } from "../ui/icon.jsx";
import { getConnection, touchConnection } from "../lib/connections.js";
import { hasDatabase, openSession } from "../workbench/state.js";
import { createWorkspaceCoordinator } from "../workbench/workspace-coordinator.js";
import { SessionProvider } from "../workbench/session-context.jsx";
import { Workbench } from "../workbench/workbench.jsx";
import { useMuxyData } from "./use-muxy-data.js";

export function WorkbenchApp() {
    const data = useMuxyData();
    const connectionId = data?.connectionId;
    const [state, setState] = useState({ phase: "idle" });

    const sessionRef = useRef(null);
    const queryHooksRef = useRef(null);
    const setViewRef = useRef(null);
    const newFileRef = useRef(null);

    useEffect(() => {
        if (!window.muxy)
            return;
        let stale = false;
        if (!connectionId) {
            setState({ phase: "missing" });
            sessionRef.current = null;
            return;
        }
        setState({ phase: "connecting", conn: null });
        (async () => {
            const conn = await getConnection(connectionId);
            if (!conn) {
                if (!stale)
                    setState({ phase: "missing" });
                return;
            }
            touchConnection(conn.id);
            if (!stale)
                setState({ phase: "connecting", conn });
            try {
                const session = await openSession(conn);
                session.coordinator = createWorkspaceCoordinator(session, { confirm: (options) => muxy.dialog.confirm(options) });
                await session.coordinator.initiateCatalogLoad();
                if (stale)
                    return;
                sessionRef.current = session;
                muxy.tabs?.setTitle?.(conn.name).catch?.(() => undefined);
                muxy.tabs?.setIcon?.({ symbol: "cylinder.split.1x2" }).catch?.(() => undefined);
                setState({ phase: "ready", conn, session });
            } catch (error) {
                if (!stale)
                    setState({ phase: "error", conn, error });
            }
        })();
        return () => { stale = true; };
    }, [connectionId]);

    useEffect(() => {
        if (!window.muxy)
            return;
        muxy.events?.subscribe?.("command.new-query", () => {
            if (muxy.focused === false || !sessionRef.current)
                return;
            if (!hasDatabase(sessionRef.current))
                return;
            newFileRef.current?.();
        });
        muxy.events?.subscribe?.("command.run-query", () => {
            if (muxy.focused === false || !sessionRef.current)
                return;
            const session = sessionRef.current;
            if (!hasDatabase(session))
                return;
            if (session.surface === "console" && !session.coordinator?.getActiveSql())
                return;
            if (queryHooksRef.current)
                queryHooksRef.current.run();
            else
                setViewRef.current?.(session.surface === "console" ? "console" : "query");
        });
        muxy.lifecycle?.onBeforeClose?.(async () => {
            const coordinator = sessionRef.current?.coordinator;
            if (!coordinator)
                return false;
            const { allowClose } = await coordinator.confirmWindowClose();
            return !allowClose;
        });
    }, []);

    if (!window.muxy)
        return <div className="flex h-full items-center justify-center text-muted-foreground">This page must run inside Muxy</div>;

    if (state.phase === "missing" || state.phase === "idle")
        return <EmptyState icon="database" description="Open a database from the Databases panel" />;

    if (state.phase === "connecting")
        return <EmptyState icon="database" description={`Connecting to ${state.conn?.name ?? "database"}…`} />;

    if (state.phase === "error")
        return (
            <div className="flex h-full flex-col items-center justify-center gap-[var(--s5)] p-[var(--s8)]">
                <Icon name="warning" size={24} />
                <div className="text-[var(--font-title)] font-semibold">{`Could not connect to ${state.conn.name}`}</div>
                <div className="error-box" style={{ maxWidth: "var(--sheet-lg)" }}>
                    {state.error.message}
                </div>
                <button className="btn" onClick={() => muxy.lifecycle?.close?.()}>
                    <Icon name="x" />
                    Close
                </button>
            </div>
        );

    return (
        <SessionProvider
            key={state.session.conn.id}
            session={state.session}
            queryHooksRef={queryHooksRef}
            setViewRef={setViewRef}
            newFileRef={newFileRef}
        >
            <Workbench />
        </SessionProvider>
    );
}
