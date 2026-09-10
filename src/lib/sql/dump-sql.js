const IDENT = `(?:"(?:[^"]|"")+"|\`[^\`]+\`|\\[[^\\]]+\\]|[A-Za-z_][\\w]*)`;
const CREATE_TABLE_OR_VIEW = new RegExp(
    `^(\\s*)CREATE\\s+(TABLE|VIEW)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?((?:${IDENT}\\.)?${IDENT})`,
    "i",
);

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureDropBeforeCreate(sql) {
    const lines = String(sql || "").split("\n");
    const out = [];
    for (const line of lines) {
        const match = line.match(CREATE_TABLE_OR_VIEW);
        if (!match) {
            out.push(line);
            continue;
        }
        const kind = match[2].toUpperCase();
        const name = match[3];
        const prev = [...out].reverse().find((entry) => entry.trim()) || "";
        if (!new RegExp(`^\\s*DROP\\s+${kind}\\s+IF\\s+EXISTS\\s+${escapeRegExp(name)}\\s*;?\\s*$`, "i").test(prev))
            out.push(`${match[1]}DROP ${kind} IF EXISTS ${name};`);
        out.push(line);
    }
    return out.join("\n");
}
