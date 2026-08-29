export const DEFAULT_RESULTS_RATIO = 0.45;
export const MIN_RESULTS_HEIGHT = 120;
export const MIN_EDITOR_HEIGHT = 96;

export function clampResultsHeight(hostHeight, height) {
    const max = Math.max(MIN_RESULTS_HEIGHT, Math.round(hostHeight) - MIN_EDITOR_HEIGHT);
    const min = Math.min(MIN_RESULTS_HEIGHT, max);
    return Math.max(min, Math.min(max, Math.round(height)));
}

export function defaultResultsHeight(hostHeight) {
    return clampResultsHeight(hostHeight, hostHeight * DEFAULT_RESULTS_RATIO);
}

export function resultsHeightFromPointer(hostHeight, hostBottom, clientY) {
    return clampResultsHeight(hostHeight, hostBottom - clientY);
}
