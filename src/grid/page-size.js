export function resolvePageSize(gridState, session) {
    const fromGrid = Number(gridState?.pageSize);
    if (Number.isFinite(fromGrid) && fromGrid > 0)
        return Math.floor(fromGrid);
    const fromSession = Number(session?.pageSize);
    if (Number.isFinite(fromSession) && fromSession > 0)
        return Math.floor(fromSession);
    return 200;
}

export function pageSizeOptions(fallback) {
    const sizes = new Set([50, 100, 200, 500, 1000]);
    const value = Number(fallback);
    if (Number.isFinite(value) && value > 0)
        sizes.add(Math.floor(value));
    return [...sizes].sort((left, right) => left - right);
}

export function gutterRowNumber(pageIndex, pageSize, rowIndex) {
    return pageIndex * pageSize + rowIndex + 1;
}
