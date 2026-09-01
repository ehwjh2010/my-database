const DEFAULT_TIMEOUT = 60000;
const STDIN_FILE_EXEC = String.raw`
open(STDIN, "<", $ARGV[0]) or die $ARGV[0] . ": $!\n";
exec { $ARGV[1] } @ARGV[1 .. $#ARGV] or die $!;
`;

export class ExecError extends Error {
    constructor(message, res = {}) {
        super(message);
        this.stderr = res.stderr || "";
        this.stdout = res.stdout || "";
        this.exitCode = res.exitCode ?? -1;
    }
}

function fail(argv, res) {
    const detail = (res.stderr || res.stdout || "").trim();
    throw new ExecError(detail || `Command failed: ${argv[0]}`, res);
}

export async function run(argv, opts = {}) {
    const res = await muxy.exec(argv, { timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT });
    if (res.exitCode !== 0)
        fail(argv, res);
    return res.stdout;
}

export async function runWithStdinFile(argv, file, opts = {}) {
    if (!argv?.length)
        throw new Error("Command failed: exec");
    return run(["perl", "-e", STDIN_FILE_EXEC, file, ...argv], opts);
}

export async function tryRun(argv, opts = {}) {
    try {
        return await run(argv, opts);
    }
    catch {
        return null;
    }
}
