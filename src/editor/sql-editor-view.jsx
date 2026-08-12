import { useEffect, useRef } from "react";
import { createSqlEditor, syncSqlEditorDocument, updateSqlEditorExecution, updateSqlEditorSchema } from "./sql-editor.js";

export function SqlEditorView({ engine, schema, initialDoc, executionMarker, viewRef, onDocChange, onRun }) {
    const hostRef = useRef(null);
    const callbacks = useRef({ onDocChange, onRun });
    callbacks.current = { onDocChange, onRun };

    useEffect(() => {
        const view = createSqlEditor(hostRef.current, {
            engine,
            doc: initialDoc,
            schema,
            executionMarker,
            onRun: () => callbacks.current.onRun?.(),
            onDocChange: (doc) => callbacks.current.onDocChange?.(doc),
        });
        viewRef.current = view;
        view.focus();
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, []);

    useEffect(() => {
        syncSqlEditorDocument(viewRef.current, initialDoc);
    }, [initialDoc, viewRef]);

    useEffect(() => {
        updateSqlEditorExecution(viewRef.current, executionMarker);
    }, [executionMarker, viewRef]);

    useEffect(() => {
        updateSqlEditorSchema(viewRef.current, engine, schema);
    }, [engine, schema, viewRef]);

    return <div ref={hostRef} className="sql-editor-host flex min-h-0 flex-1 flex-col" />;
}
