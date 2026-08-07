import { run } from "./exec.js";
import { createPrivateFile, ensurePrivateDirectories, ensurePrivateFile, renamePrivateFile, trashPrivateFile, writePrivateFileAtomically } from "./secure-file.js";

const HOME_SCRIPT = 'my $home=(getpwuid($<))[7] // die "HOME_UNAVAILABLE"; print $home;';
const ABS_PATH_SCRIPT = 'use Cwd qw(abs_path); my $path=abs_path($ARGV[0]) // die "PATH_UNAVAILABLE"; print $path;';
const READ_SCRIPT = String.raw`
use Cwd qw(realpath);
use Encode qw(decode FB_CROAK);
use Fcntl qw(:mode);
use Digest::SHA qw(sha256_hex);
use JSON::PP qw(encode_json);
sub fail { die $_[0] . ": " . $_[1] . "\n"; }
sub check_dir {
    my ($path) = @_;
    my @st = lstat($path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " is a symlink") if S_ISLNK($st[2]);
    fail("FILE_UNSAFE_TYPE", $path . " is not a directory") unless S_ISDIR($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " owner mismatch") if $st[4] != $<;
    chmod(0700, $path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    @st = lstat($path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " changed to a symlink") if S_ISLNK($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " mode is not 0700") unless ($st[2] & 07777) == 0700;
}
my ($rootDir, $fingerprintDir, $databaseDir, $path) = @ARGV;
check_dir($rootDir);
check_dir($fingerprintDir);
check_dir($databaseDir);
my $real = realpath($databaseDir);
fail("FILE_UNSAFE_TYPE", $databaseDir . " is outside its real path") unless defined($real) && $real eq $databaseDir;
my @st = lstat($path) or fail("FILE_NOT_FOUND", $path . ": " . $!);
fail("FILE_UNSAFE_TYPE", $path . " is a symlink") if S_ISLNK($st[2]);
fail("FILE_UNSAFE_TYPE", $path . " is not a regular file") unless S_ISREG($st[2]);
fail("FILE_PERMISSION_FAILED", $path . " owner mismatch") if $st[4] != $<;
chmod(0600, $path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
open(my $fh, "<:raw", $path) or fail("FILE_READ_FAILED", $path . ": " . $!);
local $/;
my $bytes = <$fh>;
close($fh) or fail("FILE_READ_FAILED", $path . ": " . $!);
my $size = 0 + length($bytes // "");
my $sha256 = sha256_hex($bytes // "");
my $content;
eval { $content = decode("UTF-8", $bytes // "", FB_CROAK); 1 } or fail("FILE_READ_FAILED", $path . ": invalid UTF-8");
print encode_json({ content => $content, version => { sha256 => $sha256, size => $size, mtimeMs => 0 + ($st[9] * 1000) } });
`;
const LIST_SCRIPT = String.raw`
use Cwd qw(realpath);
use Encode qw(decode);
use Fcntl qw(:mode);
use JSON::PP qw(encode_json);
sub fail { die $_[0] . ": " . $_[1] . "\n"; }
sub check_dir {
    my ($path) = @_;
    my @st = lstat($path) or fail("FILE_LIST_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " is a symlink") if S_ISLNK($st[2]);
    fail("FILE_UNSAFE_TYPE", $path . " is not a directory") unless S_ISDIR($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " owner mismatch") if $st[4] != $<;
    chmod(0700, $path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    @st = lstat($path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " changed to a symlink") if S_ISLNK($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " mode is not 0700") unless ($st[2] & 07777) == 0700;
}
sub file_meta {
    my ($dir, $name) = @_;
    my $path = $dir . "/" . $name;
    my @st = lstat($path) or fail("FILE_LIST_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " is a symlink") if S_ISLNK($st[2]);
    fail("FILE_UNSAFE_TYPE", $path . " is not a regular file") unless S_ISREG($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " owner mismatch") if $st[4] != $<;
    chmod(0600, $path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    @st = lstat($path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " changed to a symlink") if S_ISLNK($st[2]);
    fail("FILE_UNSAFE_TYPE", $path . " changed to a non-regular file") unless S_ISREG($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " mode is not 0600") unless ($st[2] & 07777) == 0600;
    return {
        name => $name,
        path => $path,
        size => 0 + $st[7],
        mtimeMs => 0 + ($st[9] * 1000),
        reserved => lc($name) eq "console.sql" ? JSON::PP::true() : JSON::PP::false(),
    };
}
check_dir($ARGV[0]);
check_dir($ARGV[1]);
check_dir($ARGV[2]);
my $real = realpath($ARGV[2]);
fail("FILE_UNSAFE_TYPE", $ARGV[2] . " is outside its real path") unless defined($real) && $real eq $ARGV[2];
my $dir = $ARGV[2];
opendir(my $dh, $dir) or fail("FILE_LIST_FAILED", $dir . ": " . $!);
my @files;
while (defined(my $name = readdir($dh))) {
    $name = decode("UTF-8", $name);
    next unless $name =~ /\.sql\z/;
    push @files, file_meta($dir, $name);
}
closedir($dh) or fail("FILE_LIST_FAILED", $dir . ": " . $!);
print encode_json(\@files);
`;
export class SqlFileError extends Error {
    constructor(code, detail = "") {
        super(detail ? `${code}: ${detail}` : code);
        this.name = "SqlFileError";
        this.code = code;
        this.detail = detail;
    }
}

function joinPath(...parts) {
    return parts.map((part, index) => index === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")).join("/");
}

function namespacePaths(namespace) {
    const rootDir = namespace?.rootDir;
    const fingerprint = namespace?.fingerprint;
    const databaseKey = namespace?.databaseKey;
    const databaseDir = namespace?.databaseDir;
    if (![rootDir, fingerprint, databaseKey, databaseDir].every((value) => typeof value === "string" && value.length > 0))
        throw new SqlFileError("FILE_UNSAFE_TYPE", "invalid namespace");
    if (!rootDir.startsWith("/") || [fingerprint, databaseKey].some((value) => value.includes("/") || value.includes("\0") || value === "." || value === ".."))
        throw new SqlFileError("FILE_UNSAFE_TYPE", "invalid namespace path");
    const fingerprintDir = joinPath(rootDir, fingerprint);
    const expectedDatabaseDir = databaseKey === fingerprint ? fingerprintDir : joinPath(fingerprintDir, databaseKey);
    if (databaseDir !== expectedDatabaseDir)
        throw new SqlFileError("FILE_UNSAFE_TYPE", "database directory escapes fingerprint directory");
    return { rootDir, fingerprintDir, databaseDir };
}

function commandError(error, fallbackCode) {
    const detail = String(error?.stderr || error?.stdout || error?.message || "").trim();
    const match = detail.match(/^(FILE_[A-Z_]+):\s*([\s\S]*)$/);
    return new SqlFileError(match?.[1] || fallbackCode, match?.[2] || detail);
}

async function execute(operation, fallbackCode) {
    try {
        return await operation();
    }
    catch (error) {
        throw commandError(error, fallbackCode);
    }
}

function parseJson(output, fallbackCode) {
    try {
        return JSON.parse(output);
    }
    catch (error) {
        throw new SqlFileError(fallbackCode, error.message);
    }
}

async function sha256(value) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function currentHome() {
    return (await run(["perl", "-e", HOME_SCRIPT])).replace(/\r?\n$/, "");
}

async function absolutePath(path) {
    return (await run(["perl", "-MCwd=abs_path", "-e", ABS_PATH_SCRIPT, path])).replace(/\r?\n$/, "");
}

export async function getSqlNamespace({ conn, database }) {
    if (!database)
        throw new SqlFileError("DATABASE_REQUIRED");
    const home = await currentHome();
    const rootDir = joinPath(home, ".muxy-datagrip");
    let fingerprint;
    let databaseKey;
    if (conn.engine === "sqlite") {
        const path = await absolutePath(conn.sqlite.path);
        fingerprint = await sha256(JSON.stringify(["v1", "sqlite", path]));
        databaseKey = fingerprint;
    }
    else {
        const net = conn.net;
        fingerprint = await sha256(JSON.stringify(["v1", conn.engine, String(net.host).toLowerCase(), String(net.port), String(net.user)]));
        databaseKey = `db-${await sha256(database)}`;
    }
    const fingerprintDir = joinPath(rootDir, fingerprint);
    const databaseDir = databaseKey === fingerprint ? fingerprintDir : joinPath(fingerprintDir, databaseKey);
    return { fingerprint, rootDir, databaseDir, databaseKey };
}

export function validateFileName(input, { allowReserved = false } = {}) {
    if (typeof input !== "string" || !input)
        throw new SqlFileError("FILE_NAME_EMPTY");
    if (input.includes("\0") || input.includes("/"))
        throw new SqlFileError("FILE_NAME_INVALID", "file names cannot contain NUL or slash");
    const name = input.toLowerCase().endsWith(".sql") ? input : `${input}.sql`;
    if (!allowReserved && name.toLowerCase() === "console.sql")
        throw new SqlFileError("FILE_RESERVED", "console.sql 不能重命名或删除");
    return name;
}

export function filePath(namespace, name) {
    const validated = validateFileName(name, { allowReserved: true });
    if (validated !== name)
        throw new SqlFileError("FILE_NAME_INVALID", "file name must be validated");
    const databaseDir = namespace?.databaseDir;
    if (!databaseDir || !databaseDir.startsWith("/") || databaseDir.endsWith("/"))
        throw new SqlFileError("FILE_UNSAFE_TYPE", "database directory is not an absolute directory");
    const path = `${databaseDir}/${name}`;
    if (!path.startsWith(`${databaseDir}/`))
        throw new SqlFileError("FILE_UNSAFE_TYPE", "file path escapes database directory");
    return path;
}

export async function ensureNamespace(namespace) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    await execute(() => ensurePrivateDirectories({ rootDir, fingerprintDir, databaseDir }), "FILE_PERMISSION_FAILED");
    return namespace;
}

export async function ensureConsoleFile(namespace) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    const path = filePath(namespace, "console.sql");
    await execute(() => ensurePrivateFile({ rootDir, fingerprintDir, databaseDir, path }), "FILE_PERMISSION_FAILED");
    return path;
}

export async function createSqlFile(namespace, input) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    const name = validateFileName(input);
    const path = filePath(namespace, name);
    const output = await execute(() => createPrivateFile({ rootDir, fingerprintDir, databaseDir, path, name }), "FILE_WRITE_FAILED");
    return parseJson(output, "FILE_WRITE_FAILED");
}

export async function renameSqlFile(namespace, sourceInput, targetInput, expectedVersion) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    const source = validateFileName(sourceInput);
    const target = validateFileName(targetInput);
    if (!expectedVersion || typeof expectedVersion.sha256 !== "string")
        throw new SqlFileError("FILE_VERSION_REQUIRED");
    const output = await execute(() => renamePrivateFile({
        rootDir,
        fingerprintDir,
        databaseDir,
        sourcePath: filePath(namespace, source),
        targetPath: filePath(namespace, target),
        sourceName: source,
        targetName: target,
        expectedVersion,
    }), "FILE_RENAME_FAILED");
    return parseJson(output, "FILE_RENAME_FAILED");
}

export async function trashSqlFile(namespace, input, expectedVersion) {
    namespacePaths(namespace);
    const name = validateFileName(input);
    if (!expectedVersion || typeof expectedVersion.sha256 !== "string")
        throw new SqlFileError("FILE_VERSION_REQUIRED");
    const path = filePath(namespace, name);
    const current = await readSqlFile(namespace, name);
    if (current.version.sha256 !== expectedVersion.sha256 || current.version.size !== expectedVersion.size || current.version.mtimeMs !== expectedVersion.mtimeMs)
        throw new SqlFileError("FILE_VERSION_CONFLICT", name);
    await execute(() => trashPrivateFile(path), "FILE_TRASH_FAILED");
    return { name, path, trashed: true };
}

export async function readSqlFile(namespace, input) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    const name = validateFileName(input, { allowReserved: true });
    const path = filePath(namespace, name);
    const output = await execute(() => run(["perl", "-MDigest::SHA=sha256_hex", "-MJSON::PP=encode_json", "-e", READ_SCRIPT, rootDir, fingerprintDir, databaseDir, path]), "FILE_READ_FAILED");
    return parseJson(output, "FILE_READ_FAILED");
}

export async function saveSqlFile(namespace, input, content, expectedVersion) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    const name = validateFileName(input, { allowReserved: true });
    if (typeof content !== "string")
        throw new SqlFileError("FILE_WRITE_FAILED", "content must be text");
    if (!expectedVersion || typeof expectedVersion.sha256 !== "string")
        throw new SqlFileError("FILE_VERSION_REQUIRED");
    const output = await execute(() => writePrivateFileAtomically({
        rootDir,
        fingerprintDir,
        databaseDir,
        path: filePath(namespace, name),
        expectedVersion,
        content,
    }), "FILE_WRITE_FAILED");
    return parseJson(output, "FILE_WRITE_FAILED");
}

export async function listSqlFiles(namespace) {
    const { rootDir, fingerprintDir, databaseDir } = namespacePaths(namespace);
    const output = await execute(() => run(["perl", "-MJSON::PP=encode_json", "-e", LIST_SCRIPT, rootDir, fingerprintDir, databaseDir]), "FILE_LIST_FAILED");
    try {
        const files = JSON.parse(output);
        if (!Array.isArray(files))
            throw new Error("list output is not an array");
        return files.sort((left, right) => {
            if (left.reserved !== right.reserved)
                return left.reserved ? -1 : 1;
            return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
        });
    }
    catch (error) {
        throw new SqlFileError("FILE_LIST_FAILED", error.message);
    }
}
