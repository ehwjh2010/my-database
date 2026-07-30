export async function createTableFromSql({ session, sql, onClose, toast }) {
    if (sql.startsWith("--"))
        return { outcome: "invalid" };
    const operationCtx = { ...session.ctx };
    const scopeEpoch = session.scopeGeneration || 0;
    try {
        await session.driver.runQuery(operationCtx, sql, { timeoutMs: session.timeoutMs });
        if ((session.scopeGeneration || 0) !== scopeEpoch)
            return { outcome: "stale" };
        toast("Table created", "success");
        onClose();
        return { outcome: "created", done: session.coordinator.initiateCatalogLoad() };
    } catch (error) {
        if ((session.scopeGeneration || 0) === scopeEpoch)
            toast(error.message, "warning");
        return { outcome: "error", error };
    }
}
