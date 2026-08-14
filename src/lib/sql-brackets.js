const PAIRS = {
    "(": ")",
    "[": "]",
    "{": "}",
    "'": "'",
    "\"": "\"",
    "`": "`",
};

const CLOSINGS = new Set(Object.values(PAIRS));

export function isSqlBracketKey(key) {
    return key in PAIRS || CLOSINGS.has(key);
}

export function sqlBracketEdit(value, start, end, key) {
    if (key === "Backspace" && start === end && start > 0 && PAIRS[value[start - 1]] === value[start]) {
        return {
            value: value.slice(0, start - 1) + value.slice(start + 1),
            selectionStart: start - 1,
            selectionEnd: start - 1,
        };
    }
    if (!isSqlBracketKey(key))
        return null;
    if (start === end && CLOSINGS.has(key) && value[start] === key) {
        return {
            value,
            selectionStart: start + 1,
            selectionEnd: start + 1,
        };
    }
    const closing = PAIRS[key];
    if (!closing)
        return null;
    return {
        value: value.slice(0, start) + key + value.slice(start, end) + closing + value.slice(end),
        selectionStart: start + 1,
        selectionEnd: end + 1,
    };
}
