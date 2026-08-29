import { run } from "./exec.js";

const CHOOSE_FILE_SCRIPT = String.raw`
on run argv
    if (count of argv) is not 1 then error "PICK_FILE_FAILED: invalid arguments"
    set promptText to item 1 of argv
    try
        set theFile to choose file with prompt promptText
        return POSIX path of theFile
    on error number -128
        return ""
    end try
end run
`;

export async function pickOpenFile({ title } = {}) {
    const path = String(await run(["osascript", "-e", CHOOSE_FILE_SCRIPT, title || "Choose file"], { timeoutMs: 600000 })).trim();
    return path || null;
}
