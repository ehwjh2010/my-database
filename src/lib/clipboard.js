import { tryRun } from "./exec.js";

const SCRIPT = ["on run(argv)", "set the clipboard to (item 1 of argv)", "end run"];
const READ_SCRIPT = ["try", "return the clipboard as Unicode text", "on error", "return \"\"", "end try"];

export async function copyToClipboard(text) {
    const value = String(text);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        }
        catch {
        }
    }
    await tryRun(["osascript", ...SCRIPT.flatMap((line) => ["-e", line]), value]);
}

export async function readClipboard() {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
        try {
            return await navigator.clipboard.readText();
        }
        catch {
        }
    }
    const text = await tryRun(["osascript", ...READ_SCRIPT.flatMap((line) => ["-e", line])]);
    if (text == null)
        return "";
    return String(text).replace(/\n$/, "");
}
