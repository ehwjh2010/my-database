const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function nextCaretPosition(value, start, end, direction) {
    if (start !== end)
        return direction < 0 ? start : end;
    const boundaries = Array.from(segmenter.segment(value), ({ index }) => index);
    if (direction < 0)
        return boundaries.findLast((index) => index < start) ?? 0;
    return boundaries.find((index) => index > end) ?? value.length;
}
