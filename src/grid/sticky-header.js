import { useLayoutEffect, useState } from "react";

export function measureColumnWidths(headTable, bodyTable) {
    const heads = [...(headTable?.querySelectorAll("thead th") || [])];
    if (!heads.length)
        return [];
    const widths = heads.map((cell) => cell.getBoundingClientRect().width);
    for (const row of bodyTable?.querySelectorAll("tbody tr") || []) {
        [...row.children].forEach((cell, index) => {
            if (index < widths.length)
                widths[index] = Math.max(widths[index], cell.getBoundingClientRect().width);
        });
    }
    return widths.map((width) => Math.ceil(width));
}

export function sameWidths(left, right) {
    return !!left && !!right && left.length === right.length && left.every((width, index) => width === right[index]);
}

export const GRID_GUTTER_WIDTH = 40;

export function frozenTableStyle(widths) {
    if (!widths?.length)
        return undefined;
    const width = widths.reduce((sum, value) => sum + value, 0);
    return { tableLayout: "fixed", width, minWidth: width };
}

export function alignFrozenWidths(widths, columnCount) {
    return widths?.length === columnCount ? widths : null;
}

export function pinGutterWidth(widths, hasGutter) {
    if (!hasGutter || !widths?.length)
        return widths;
    if (widths[0] === GRID_GUTTER_WIDTH)
        return widths;
    return [GRID_GUTTER_WIDTH, ...widths.slice(1)];
}

export function useFrozenColumnWidths(headTableRef, bodyTableRef, extraDeps = []) {
    const [widths, setWidths] = useState(null);
    useLayoutEffect(() => {
        const next = measureColumnWidths(headTableRef.current, bodyTableRef.current);
        setWidths((prev) => (sameWidths(prev, next) ? prev : next));
    }, extraDeps);
    return widths;
}
