import { tryRun } from "./exec.js";

const cache = new Map();

export function flagsFromDumpHelp(helpText) {
    const text = String(helpText || "");
    const flags = [];
    if (text.includes("--dump-masking-policies"))
        flags.push("--skip-dump-masking-policies");
    if (text.includes("--column-statistics"))
        flags.push("--column-statistics=0");
    if (text.includes("--no-tablespaces"))
        flags.push("--no-tablespaces");
    return flags;
}

export async function mysqlDumpPrivilegeFlags(dumpBin) {
    if (cache.has(dumpBin))
        return cache.get(dumpBin);
    const flags = flagsFromDumpHelp(await tryRun([dumpBin, "--help"], { timeoutMs: 10000 }));
    cache.set(dumpBin, flags);
    return flags;
}

export function resetMysqlDumpFlags() {
    cache.clear();
}
