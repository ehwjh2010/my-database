import { useEffect, useRef } from "react";
import { applyDdlSearch, createDdlEditor } from "./ddl-editor.js";

export function DdlEditor({ engine, doc, query, viewRef }) {
    const hostRef = useRef(null);

    useEffect(() => {
        const view = createDdlEditor(hostRef.current, { engine, doc });
        if (viewRef)
            viewRef.current = view;
        applyDdlSearch(view, query);
        return () => {
            if (viewRef)
                viewRef.current = null;
            view.destroy();
        };
    }, [engine, doc, viewRef]);

    useEffect(() => {
        applyDdlSearch(viewRef?.current, query);
    }, [query, viewRef]);

    return <div ref={hostRef} className="ddl-editor-host" />;
}
