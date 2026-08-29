import { run, tryRun } from "./exec.js";
import { transferPercent } from "./transfer-percent.js";

const WRITER = 'open(my $f, ">", $ARGV[0]) or die "$!"; chmod 0600, $ARGV[0]; print $f $ARGV[1]; close $f;';
const APPENDER = 'open(my $f, ">>", $ARGV[0]) or die "$!"; print $f $ARGV[1]; close $f;';
const READER = 'open(my $f, "<", $ARGV[0]) or die "$!"; binmode $f; local $/; print <$f> // "";';
const CHUNK = 96 * 1024;
const textEncoder = new TextEncoder();
const PRIVATE_FILE_SCRIPT = String.raw`
use Cwd qw(realpath);
use Digest::SHA qw(sha256_hex);
use Encode qw(decode encode);
use Errno qw(EEXIST ENOENT);
use Fcntl qw(:mode O_WRONLY O_CREAT O_EXCL);
use JSON::PP qw(encode_json);
use Unicode::Normalize qw(NFC);
umask 077;
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
sub ensure_dir {
    my ($path) = @_;
    my @st = lstat($path);
    if (!@st) {
        mkdir($path, 0700) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    }
    check_dir($path);
}
sub ensure_dirs {
    my ($root, $fingerprint, $database) = @_;
    ensure_dir($root);
    ensure_dir($fingerprint);
    ensure_dir($database);
    my $real = realpath($database);
    fail("FILE_UNSAFE_TYPE", $database . " is outside its real path") unless defined($real) && $real eq $database;
}
sub check_dirs {
    my ($root, $fingerprint, $database) = @_;
    check_dir($root);
    check_dir($fingerprint);
    check_dir($database);
    my $real = realpath($database);
    fail("FILE_UNSAFE_TYPE", $database . " is outside its real path") unless defined($real) && $real eq $database;
}
sub check_file {
    my ($path, $st) = @_;
    fail("FILE_UNSAFE_TYPE", $path . " is a symlink") if S_ISLNK($st->[2]);
    fail("FILE_UNSAFE_TYPE", $path . " is not a regular file") unless S_ISREG($st->[2]);
    fail("FILE_PERMISSION_FAILED", $path . " owner mismatch") if $st->[4] != $<;
    chmod(0600, $path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    my @current = lstat($path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " changed to a symlink") if S_ISLNK($current[2]);
    fail("FILE_UNSAFE_TYPE", $path . " changed to a non-regular file") unless S_ISREG($current[2]);
    fail("FILE_PERMISSION_FAILED", $path . " mode is not 0600") unless ($current[2] & 07777) == 0600;
}
sub folded { return lc(NFC($_[0])); }
sub current_version {
    my ($path) = @_;
    my @st = lstat($path) or fail("FILE_NOT_FOUND", $path . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $path . " is a symlink") if S_ISLNK($st[2]);
    fail("FILE_UNSAFE_TYPE", $path . " is not a regular file") unless S_ISREG($st[2]);
    fail("FILE_PERMISSION_FAILED", $path . " owner mismatch") if $st[4] != $<;
    chmod(0600, $path) or fail("FILE_PERMISSION_FAILED", $path . ": " . $!);
    open(my $fh, "<:raw", $path) or fail("FILE_READ_FAILED", $path . ": " . $!);
    local $/;
    my $bytes = <$fh> // "";
    close($fh) or fail("FILE_READ_FAILED", $path . ": " . $!);
    return { sha256 => sha256_hex($bytes), size => 0 + length($bytes), mtimeMs => 0 + ($st[9] * 1000) };
}
sub file_meta {
    my ($name, $path) = @_;
    my @st = lstat($path) or fail("FILE_WRITE_FAILED", $path . ": " . $!);
    check_file($path, \@st);
    return { name => $name, path => $path, size => 0 + $st[7], mtimeMs => 0 + ($st[9] * 1000), reserved => JSON::PP::false() };
}
my $operation = shift @ARGV;
if ($operation eq "directories") {
    ensure_dirs(@ARGV[0..2]);
    exit 0;
}
my ($root, $fingerprint, $database, $path) = @ARGV[0..3];
if ($operation eq "write" || $operation eq "rename") {
    check_dirs($root, $fingerprint, $database);
} else {
    ensure_dirs($root, $fingerprint, $database);
}
if ($operation eq "ensure") {
    my @st = lstat($path);
    if (@st) {
        check_file($path, \@st);
        exit 0;
    }
    fail("FILE_WRITE_FAILED", $path . ": " . $!) unless $! == ENOENT;
    my $fh;
    if (!sysopen($fh, $path, O_WRONLY | O_CREAT | O_EXCL, 0600)) {
        if ($! == EEXIST) {
            @st = lstat($path) or fail("FILE_WRITE_FAILED", $path . ": " . $!);
            check_file($path, \@st);
            exit 0;
        }
        fail("FILE_WRITE_FAILED", $path . ": " . $!);
    }
    print $fh "" or fail("FILE_WRITE_FAILED", $path . ": " . $!);
    close($fh) or fail("FILE_WRITE_FAILED", $path . ": " . $!);
    @st = lstat($path) or fail("FILE_WRITE_FAILED", $path . ": " . $!);
    check_file($path, \@st);
    exit 0;
}
if ($operation eq "create") {
    my $name = decode("UTF-8", $ARGV[4]);
    opendir(my $dh, $database) or fail("FILE_WRITE_FAILED", $database . ": " . $!);
    while (defined(my $existing = readdir($dh))) {
        $existing = decode("UTF-8", $existing);
        fail("FILE_EXISTS", $name) if folded($existing) eq folded($name);
    }
    closedir($dh) or fail("FILE_WRITE_FAILED", $database . ": " . $!);
    my $fh;
    if (!sysopen($fh, $path, O_WRONLY | O_CREAT | O_EXCL, 0600)) {
        fail("FILE_EXISTS", $path) if $! == EEXIST;
        fail("FILE_WRITE_FAILED", $path . ": " . $!);
    }
    print $fh "" or fail("FILE_WRITE_FAILED", $path . ": " . $!);
    close($fh) or fail("FILE_WRITE_FAILED", $path . ": " . $!);
    print encode_json(file_meta($name, $path));
    exit 0;
}
if ($operation eq "write") {
    my $expectedSha = $ARGV[4];
    my @chunks = @ARGV[5..$#ARGV];
    my $current = current_version($path);
    fail("FILE_VERSION_CONFLICT", $path) unless $current->{sha256} eq $expectedSha;
    my $temp = $path . ".muxy-save-" . $$ . "-" . int(rand(1000000));
    my ($error, $version);
    eval {
        my $fh;
        sysopen($fh, $temp, O_WRONLY | O_CREAT | O_EXCL, 0600) or fail("FILE_WRITE_FAILED", $temp . ": " . $!);
        for my $chunk (@chunks) {
            my $bytes = encode("UTF-8", decode("UTF-8", $chunk));
            my $offset = 0;
            while ($offset < length($bytes)) {
                my $written = syswrite($fh, $bytes, length($bytes) - $offset, $offset);
                fail("FILE_WRITE_FAILED", $temp . ": " . $!) unless defined($written) && $written > 0;
                $offset += $written;
            }
        }
        close($fh) or fail("FILE_WRITE_FAILED", $temp . ": " . $!);
        chmod(0600, $temp) or fail("FILE_PERMISSION_FAILED", $temp . ": " . $!);
        my @st = lstat($temp) or fail("FILE_VERIFY_FAILED", $temp . ": " . $!);
        fail("FILE_UNSAFE_TYPE", $temp . " is not a regular file") unless S_ISREG($st[2]);
        fail("FILE_PERMISSION_FAILED", $temp . " mode is not 0600") unless ($st[2] & 07777) == 0600;
        open(my $verify, "<:raw", $temp) or fail("FILE_VERIFY_FAILED", $temp . ": " . $!);
        local $/;
        my $bytes = <$verify> // "";
        close($verify) or fail("FILE_VERIFY_FAILED", $temp . ": " . $!);
        my $expectedBytes = join("", map { encode("UTF-8", decode("UTF-8", $_)) } @chunks);
        my $sha256 = sha256_hex($bytes);
        fail("FILE_VERIFY_FAILED", $temp) unless $sha256 eq sha256_hex($expectedBytes);
        my $beforeCommit = current_version($path);
        fail("FILE_VERSION_CONFLICT", $path) unless $beforeCommit->{sha256} eq $expectedSha;
        rename($temp, $path) or fail("FILE_COMMIT_FAILED", $path . ": " . $!);
        my @committed = lstat($path) or fail("FILE_COMMIT_FAILED", $path . ": " . $!);
        fail("FILE_UNSAFE_TYPE", $path . " is not a regular file") unless S_ISREG($committed[2]);
        $version = { sha256 => $sha256, size => 0 + length($bytes), mtimeMs => 0 + ($committed[9] * 1000) };
        1;
    } or $error = $@;
    if ($error) {
        unlink($temp) if -e $temp;
        die $error;
    }
    print encode_json({ version => $version });
    exit 0;
}
if ($operation eq "rename") {
    my ($targetPath, $sourceName, $targetName, $expectedSha, $expectedSize, $expectedMtime) = @ARGV[4..9];
    my $targetNameText = decode("UTF-8", $targetName);
    my $version = current_version($path);
    fail("FILE_VERSION_CONFLICT", $sourceName) unless $version->{sha256} eq $expectedSha && $version->{size} == $expectedSize && $version->{mtimeMs} == $expectedMtime;
    opendir(my $dh, $database) or fail("FILE_RENAME_FAILED", $database . ": " . $!);
    while (defined(my $existing = readdir($dh))) {
        $existing = decode("UTF-8", $existing);
        fail("FILE_EXISTS", $targetName) if folded($existing) eq folded($targetNameText);
    }
    closedir($dh) or fail("FILE_RENAME_FAILED", $database . ": " . $!);
    rename($path, $targetPath) or fail("FILE_RENAME_FAILED", $path . ": " . $!);
    my @st = lstat($targetPath) or fail("FILE_RENAME_FAILED", $targetPath . ": " . $!);
    fail("FILE_UNSAFE_TYPE", $targetPath . " is not a regular file") unless S_ISREG($st[2]);
    chmod(0600, $targetPath) or fail("FILE_PERMISSION_FAILED", $targetPath . ": " . $!);
    print encode_json({ file => { name => $targetNameText, path => $targetPath, size => 0 + $st[7], mtimeMs => 0 + ($st[9] * 1000), reserved => JSON::PP::false() }, version => $version });
    exit 0;
}
fail("FILE_WRITE_FAILED", "unknown private file operation");
`;
const VERIFY_TRASH_SCRIPT = 'my $path = $ARGV[0]; my @st = lstat($path); die "FILE_TRASH_FAILED: $path still exists\\n" if @st; print "ok";';
const FINDER_TRASH_SCRIPT = String.raw`
on run argv
    if (count of argv) is not 1 then error "FILE_TRASH_FAILED: invalid path"
    set targetPath to item 1 of argv
    tell application "Finder"
        delete POSIX file targetPath
    end tell
end run
`;

function contentChunks(content) {
    const chunks = [];
    let chunk = "";
    let size = 0;
    for (const character of content) {
        const characterSize = textEncoder.encode(character).byteLength;
        if (chunk && size + characterSize > CHUNK) {
            chunks.push(chunk);
            chunk = "";
            size = 0;
        }
        chunk += character;
        size += characterSize;
    }
    chunks.push(chunk);
    return chunks;
}

async function runPrivateFile(operation, args) {
    return run(["perl", "-e", PRIVATE_FILE_SCRIPT, operation, ...args]);
}

export async function writeSecureFile(path, content) {
    await run(["perl", "-e", WRITER, path, content]);
}

async function writeChunks(path, content, firstScript, onProgress) {
    const total = Math.max(String(content).length, 1);
    let written = 0;
    const text = String(content);
    const emit = () => onProgress?.(transferPercent(written, total), written, total);
    await run(["perl", "-e", firstScript, path, text.slice(0, CHUNK)]);
    written = Math.min(CHUNK, text.length);
    emit();
    for (let i = CHUNK; i < text.length; i += CHUNK) {
        await run(["perl", "-e", APPENDER, path, text.slice(i, i + CHUNK)]);
        written = Math.min(i + CHUNK, text.length);
        emit();
    }
}

export async function writeTextFile(path, content, onProgress) {
    await writeChunks(path, content, WRITER, onProgress);
}

export async function appendTextFile(path, content, onProgress) {
    await writeChunks(path, content, APPENDER, onProgress);
}

export async function writeDumpPart(path, content, append) {
    if (append)
        await appendTextFile(path, content);
    else
        await writeTextFile(path, content);
}

export async function readTextFile(path) {
    return run(["perl", "-e", READER, path]);
}

export async function removeFile(path) {
    await tryRun(["rm", "-f", path]);
}

export async function ensurePrivateDirectories({ rootDir, fingerprintDir, databaseDir }) {
    await runPrivateFile("directories", [rootDir, fingerprintDir, databaseDir]);
}

export async function ensurePrivateFile({ rootDir, fingerprintDir, databaseDir, path }) {
    await runPrivateFile("ensure", [rootDir, fingerprintDir, databaseDir, path]);
}

export async function createPrivateFile({ rootDir, fingerprintDir, databaseDir, path, name }) {
    return runPrivateFile("create", [rootDir, fingerprintDir, databaseDir, path, name]);
}

export async function writePrivateFileAtomically({ rootDir, fingerprintDir, databaseDir, path, expectedVersion, content }) {
    return runPrivateFile("write", [rootDir, fingerprintDir, databaseDir, path, expectedVersion.sha256, ...contentChunks(content)]);
}

export async function renamePrivateFile({ rootDir, fingerprintDir, databaseDir, sourcePath, targetPath, sourceName, targetName, expectedVersion }) {
    return runPrivateFile("rename", [rootDir, fingerprintDir, databaseDir, sourcePath, targetPath, sourceName, targetName, expectedVersion.sha256, String(expectedVersion.size), String(expectedVersion.mtimeMs)]);
}

export async function trashPrivateFile(path) {
    await run(["osascript", "-e", FINDER_TRASH_SCRIPT, path]);
    await run(["perl", "-e", VERIFY_TRASH_SCRIPT, path]);
}
