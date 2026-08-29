export function transferPercent(done, total) {
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0)
        return 100;
    return Math.max(0, Math.min(100, Math.round((100 * done) / total)));
}

export function clampPercent(value, status) {
    if (Number.isFinite(value))
        return Math.max(0, Math.min(100, Math.round(value)));
    return status === "running" ? 0 : 100;
}
