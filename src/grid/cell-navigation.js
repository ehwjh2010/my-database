const moves = {
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
};

export function nextSelectedCell(cell, key, rowCount, columnCount) {
    const move = moves[key];
    if (!move)
        return null;
    return {
        row: Math.max(0, Math.min(rowCount - 1, cell.row + move[0])),
        column: Math.max(0, Math.min(columnCount - 1, cell.column + move[1])),
    };
}
