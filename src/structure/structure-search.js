export function matchRanges(text, query) {
    if (!query)
        return [];
    const hay = String(text).toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    if (!needle)
        return [];
    const ranges = [];
    let from = 0;
    while (from <= hay.length - needle.length) {
        const index = hay.indexOf(needle, from);
        if (index < 0)
            break;
        ranges.push({ from: index, to: index + needle.length });
        from = index + needle.length;
    }
    return ranges;
}

export function splitHighlighted(text, query) {
    const value = text == null ? "" : String(text);
    const ranges = matchRanges(value, query);
    if (!ranges.length)
        return [{ text: value, match: false }];
    const pieces = [];
    let cursor = 0;
    for (const range of ranges) {
        if (range.from > cursor)
            pieces.push({ text: value.slice(cursor, range.from), match: false });
        pieces.push({ text: value.slice(range.from, range.to), match: true });
        cursor = range.to;
    }
    if (cursor < value.length)
        pieces.push({ text: value.slice(cursor), match: false });
    return pieces;
}

export function nextMatchIndex(count, current, direction) {
    if (count <= 0)
        return -1;
    if (current < 0)
        return direction < 0 ? count - 1 : 0;
    return (current + direction + count * 2) % count;
}
