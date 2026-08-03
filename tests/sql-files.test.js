import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const calls = [];
let execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });

globalThis.muxy = {
    exec: async (argv) => {
        calls.push(argv);
        return execHandler(argv);
    },
    storage: {
        get: async (key) => storageValues.get(key),
        set: async (key, value) => storageValues.set(key, value),
        delete: async (key) => storageValues.delete(key),
    },
};

const { createSqlFile, ensureConsoleFile, getSqlNamespace, listSqlFiles, readSqlFile, renameSqlFile, saveSqlFile, trashSqlFile, validateFileName, filePath } = await import("../src/lib/sql-files.js");
const { deleteConnection } = await import("../src/lib/connections.js");

const storageValues = new Map();

test("network SQL namespace uses the connection identity and database key", async () => {
    calls.length = 0;
    const namespace = await getSqlNamespace({
        conn: { engine: "postgres", net: { host: "DB.Example", port: 5432, user: "alice" } },
        database: "sales",
    });
    const fingerprint = createHash("sha256").update(JSON.stringify(["v1", "postgres", "db.example", "5432", "alice"])).digest("hex");
    const databaseKey = createHash("sha256").update("sales").digest("hex");

    assert.equal(namespace.fingerprint, fingerprint);
    assert.equal(namespace.rootDir, "/Users/test-user/.my-muxy-database");
    assert.equal(namespace.databaseKey, `db-${databaseKey}`);
    assert.equal(namespace.databaseDir, `${namespace.rootDir}/${fingerprint}/db-${databaseKey}`);
    assert.equal(calls.length, 1);
});

test("network namespace identity ignores presentation and credential settings", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-identity-")));
    execHandler = async (argv) => argv[2]?.includes("getpwuid")
        ? { exitCode: 0, stdout: `${base}\n`, stderr: "" }
        : { exitCode: 0, stdout: "", stderr: "" };

    try {
        const first = await getSqlNamespace({
            conn: { engine: "mysql", name: "Production", net: { host: "DB.Example", port: 3306, user: "alice", sslMode: "require" }, password: "one", ssh: { enabled: true, host: "jump" }, tunnel: { localPort: 4100 } },
            database: "sales",
        });
        const second = await getSqlNamespace({
            conn: { engine: "mysql", name: "Renamed", net: { host: "db.example", port: "3306", user: "alice", sslMode: "disabled" }, password: "two", ssh: { enabled: false }, tunnel: { localPort: 4200 } },
            database: "sales",
        });

        assert.equal(first.fingerprint, second.fingerprint);
        assert.equal(first.databaseKey, second.databaseKey);
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("the same network identity reuses files while users stay isolated", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-reuse-")));
    execHandler = (argv) => argv[2]?.includes("getpwuid")
        ? Promise.resolve({ exitCode: 0, stdout: `${base}\n`, stderr: "" })
        : new Promise((resolve, reject) => {
            const child = spawn(argv[0], argv.slice(1));
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => stdout += chunk);
            child.stderr.on("data", (chunk) => stderr += chunk);
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
        });

    try {
        const alice = await getSqlNamespace({ conn: { engine: "postgres", net: { host: "DB.Example", port: 5432, user: "alice" } }, database: "sales" });
        const reopened = await getSqlNamespace({ conn: { engine: "postgres", net: { host: "db.example", port: 5432, user: "alice" } }, database: "sales" });
        const bob = await getSqlNamespace({ conn: { engine: "postgres", net: { host: "db.example", port: 5432, user: "bob" } }, database: "sales" });
        const renamedHost = await getSqlNamespace({ conn: { engine: "postgres", net: { host: "other.example", port: 5432, user: "alice" } }, database: "sales" });
        await ensureConsoleFile(alice);
        await ensureConsoleFile(bob);
        await ensureConsoleFile(renamedHost);
        const file = await createSqlFile(alice, "reused");

        assert.equal(reopened.databaseDir, alice.databaseDir);
        assert.notEqual(bob.databaseDir, alice.databaseDir);
        assert.notEqual(renamedHost.databaseDir, alice.databaseDir);
        assert.deepEqual((await listSqlFiles(reopened)).map(({ name }) => name), ["console.sql", "reused.sql"]);
        assert.deepEqual((await listSqlFiles(bob)).map(({ name }) => name), ["console.sql"]);
        assert.deepEqual((await listSqlFiles(renamedHost)).map(({ name }) => name), ["console.sql"]);
        assert.equal(file.name, "reused.sql");
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("deleting a saved connection leaves its SQL namespace intact", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-retention-")));
    execHandler = (argv) => argv[2]?.includes("getpwuid")
        ? Promise.resolve({ exitCode: 0, stdout: `${base}\n`, stderr: "" })
        : new Promise((resolve, reject) => {
            const child = spawn(argv[0], argv.slice(1));
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => stdout += chunk);
            child.stderr.on("data", (chunk) => stderr += chunk);
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
        });

    try {
        const namespace = await getSqlNamespace({ conn: { engine: "mysql", net: { host: "db.example", port: 3306, user: "alice" } }, database: "sales" });
        await ensureConsoleFile(namespace);
        const file = await createSqlFile(namespace, "retained");
        storageValues.set("connections:v1", [{ id: "connection-1" }]);
        await deleteConnection("connection-1");

        assert.equal(await readFile(file.path, "utf8"), "");
    }
    finally {
        storageValues.clear();
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("SQLite namespace follows the absolute database path", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sqlite-namespace-")));
    const oldPath = join(base, "old.sqlite");
    const newPath = join(base, "new.sqlite");
    await writeFile(oldPath, "");
    execHandler = (argv) => argv[2]?.includes("getpwuid")
        ? Promise.resolve({ exitCode: 0, stdout: `${base}\n`, stderr: "" })
        : new Promise((resolve, reject) => {
            const child = spawn(argv[0], argv.slice(1));
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => stdout += chunk);
            child.stderr.on("data", (chunk) => stderr += chunk);
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
        });

    try {
        const oldNamespace = await getSqlNamespace({ conn: { engine: "sqlite", sqlite: { path: oldPath } }, database: "main" });
        await rename(oldPath, newPath);
        const newNamespace = await getSqlNamespace({ conn: { engine: "sqlite", sqlite: { path: newPath } }, database: "main" });
        assert.notEqual(newNamespace.fingerprint, oldNamespace.fingerprint);
        assert.notEqual(newNamespace.databaseDir, oldNamespace.databaseDir);
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("reading SQL files rejects unsafe namespace directories", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-boundary-")));
    const rootDir = join(base, "root");
    const fingerprintDir = join(rootDir, "fingerprint");
    const databaseDir = join(fingerprintDir, "db-key");
    const outsideDir = join(base, "outside");
    await mkdir(fingerprintDir, { recursive: true, mode: 0o700 });
    await mkdir(outsideDir, { mode: 0o700 });
    await writeFile(join(outsideDir, "draft.sql"), "SELECT outside;");
    await symlink(outsideDir, databaseDir);
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await assert.rejects(readSqlFile({ rootDir, fingerprint: "fingerprint", databaseKey: "db-key", databaseDir }, "draft.sql"), { code: "FILE_UNSAFE_TYPE" });
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("SQL file names stay flat and protect console.sql", () => {
    assert.equal(validateFileName("query"), "query.sql");
    assert.equal(validateFileName("报告.sql"), "报告.sql");
    assert.throws(() => validateFileName("nested/query.sql"), { code: "FILE_NAME_INVALID" });
    assert.throws(() => validateFileName("console.sql"), { code: "FILE_RESERVED" });
    assert.equal(filePath({ databaseDir: "/tmp/sql" }, "query.sql"), "/tmp/sql/query.sql");
});

test("rename and trash reject every case variant of console.sql with the reserved error", async () => {
    const namespace = { rootDir: "/tmp/root", fingerprint: "fingerprint", databaseKey: "db-key", databaseDir: "/tmp/root/fingerprint/db-key" };

    await assert.rejects(renameSqlFile(namespace, "CONSOLE.SQL", "renamed.sql", { sha256: "hash" }), (error) => {
        assert.equal(error.code, "FILE_RESERVED");
        assert.match(error.message, /console\.sql 不能重命名或删除/);
        return true;
    });
    await assert.rejects(trashSqlFile(namespace, "Console.sql", { sha256: "hash" }), (error) => {
        assert.equal(error.code, "FILE_RESERVED");
        assert.match(error.message, /console\.sql 不能重命名或删除/);
        return true;
    });
});

test("ensureConsoleFile creates a private empty file without overwriting it", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const path = join(databaseDir, "console.sql");
        assert.equal(await readFile(path, "utf8"), "");
        assert.equal((await stat(path)).mode & 0o777, 0o600);
        assert.equal((await stat(rootDir)).mode & 0o777, 0o700);
        await writeFile(path, "SELECT 1;");
        await ensureConsoleFile(namespace);
        assert.equal(await readFile(path, "utf8"), "SELECT 1;");
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("listSqlFiles returns one sorted metadata batch and converges file modes", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        await writeFile(join(databaseDir, "z.sql"), "SELECT 2;");
        await writeFile(join(databaseDir, "A.sql"), "SELECT 3;");
        await writeFile(join(databaseDir, "😀.sql"), "SELECT 4;");
        calls.length = 0;
        const files = await listSqlFiles(namespace);

        assert.equal(calls.length, 1);
        assert.deepEqual(files.map((file) => file.name), ["console.sql", "A.sql", "z.sql", "😀.sql"]);
        assert.deepEqual(files.find((file) => file.name === "console.sql"), {
            name: "console.sql",
            path: join(databaseDir, "console.sql"),
            size: 0,
            mtimeMs: files[0].mtimeMs,
            reserved: true,
        });
        assert.equal((await stat(join(databaseDir, "z.sql"))).mode & 0o777, 0o600);
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("createSqlFile is create-only and readSqlFile returns content with its observed version", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        calls.length = 0;
        const created = await createSqlFile(namespace, "draft");

        assert.equal(created.name, "draft.sql");
        assert.equal(created.size, 0);
        assert.equal(created.reserved, false);
        assert.equal((await stat(created.path)).mode & 0o777, 0o600);
        assert.equal(calls.length, 1);

        const read = await readSqlFile(namespace, "draft.sql");
        assert.equal(read.content, "");
        assert.deepEqual(read.version, {
            sha256: createHash("sha256").update("").digest("hex"),
            size: 0,
            mtimeMs: read.version.mtimeMs,
        });
        assert.equal(calls.length, 2);
        await assert.rejects(createSqlFile(namespace, "draft.sql"), { code: "FILE_EXISTS" });
        await assert.rejects(createSqlFile(namespace, "DRAFT.sql"), { code: "FILE_EXISTS" });
        await writeFile(join(databaseDir, "e\u0301.sql"), "");
        await assert.rejects(createSqlFile(namespace, "é"), { code: "FILE_EXISTS" });
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("saveSqlFile atomically replaces content, preserves private mode, and returns its new version", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const file = await createSqlFile(namespace, "draft");
        await writeFile(file.path, "SELECT 1;");
        const observed = await readSqlFile(namespace, file.name);
        await chmod(file.path, 0o644);

        const saved = await saveSqlFile(namespace, file.name, "SELECT 2;\n😀", observed.version);

        assert.equal(await readFile(file.path, "utf8"), "SELECT 2;\n😀");
        assert.equal((await stat(file.path)).mode & 0o777, 0o600);
        assert.deepEqual(saved.version, {
            sha256: createHash("sha256").update("SELECT 2;\n😀").digest("hex"),
            size: Buffer.byteLength("SELECT 2;\n😀"),
            mtimeMs: saved.version.mtimeMs,
        });
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("saveSqlFile rejects an unexpected on-disk hash without replacing bytes", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const file = await createSqlFile(namespace, "draft");
        await writeFile(file.path, "SELECT 1;");
        const observed = await readSqlFile(namespace, file.name);
        await writeFile(file.path, "SELECT outside;");

        await assert.rejects(saveSqlFile(namespace, file.name, "SELECT inside;", observed.version), { code: "FILE_VERSION_CONFLICT" });
        assert.equal(await readFile(file.path, "utf8"), "SELECT outside;");
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("saveSqlFile preserves the source and cleans temporary files when the private writer fails", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    let injectedFailure = false;
    execHandler = (argv) => new Promise((resolve, reject) => {
        const command = [...argv];
        if (argv[0] === "perl" && argv[3] === "write") {
            const marker = 'sysopen($fh, $temp, O_WRONLY | O_CREAT | O_EXCL, 0600) or fail("FILE_WRITE_FAILED", $temp . ": " . $!);';
            command[2] = command[2].replace(marker, `${marker}\n        fail("FILE_WRITE_FAILED", "injected failure");`);
            injectedFailure = command[2] !== argv[2];
        }
        const child = spawn(command[0], command.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const file = await createSqlFile(namespace, "draft");
        await writeFile(file.path, "SELECT original;");
        const observed = await readSqlFile(namespace, file.name);

        await assert.rejects(saveSqlFile(namespace, file.name, "SELECT replacement;", observed.version), { code: "FILE_WRITE_FAILED" });
        assert.equal(injectedFailure, true);
        assert.equal(await readFile(file.path, "utf8"), "SELECT original;");
        assert.equal((await readdir(databaseDir)).some((name) => name.includes(".muxy-save-")), false);
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("saveSqlFile and renameSqlFile do not recreate a missing namespace", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const fingerprintDir = join(rootDir, fingerprint);
    const databaseDir = join(fingerprintDir, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    const version = { sha256: "missing", size: 0, mtimeMs: 0 };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await assert.rejects(saveSqlFile(namespace, "draft.sql", "SELECT 1;", version), { code: "FILE_PERMISSION_FAILED" });
        await assert.rejects(renameSqlFile(namespace, "draft.sql", "renamed.sql", version), { code: "FILE_PERMISSION_FAILED" });
        await assert.rejects(stat(rootDir), { code: "ENOENT" });
        await assert.rejects(stat(fingerprintDir), { code: "ENOENT" });
        await assert.rejects(stat(databaseDir), { code: "ENOENT" });
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("saveSqlFile sends large UTF-8 content in bounded argv chunks", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const file = await createSqlFile(namespace, "draft");
        const observed = await readSqlFile(namespace, file.name);
        const content = "😀".repeat(120000);
        await saveSqlFile(namespace, file.name, content, observed.version);
        const saveArgs = calls.at(-1);
        const chunks = saveArgs.slice(9);

        assert.ok(chunks.length > 1);
        assert.ok(chunks.every((chunk) => Buffer.byteLength(chunk) <= 96 * 1024));
        assert.equal(chunks.join(""), content);
        assert.equal(await readFile(file.path, "utf8"), content);
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("renameSqlFile changes the name only when the source version matches", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const source = await createSqlFile(namespace, "draft");
        await writeFile(source.path, "SELECT 1;");
        const observed = await readSqlFile(namespace, source.name);
        const renamed = await renameSqlFile(namespace, source.name, "renamed.sql", observed.version);

        assert.equal(renamed.file.name, "renamed.sql");
        assert.equal(await readFile(join(databaseDir, "renamed.sql"), "utf8"), "SELECT 1;");
        await assert.rejects(stat(join(databaseDir, "draft.sql")), { code: "ENOENT" });
        assert.deepEqual(renamed.version, observed.version);
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("renameSqlFile leaves the source untouched on a stale version or target collision", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => new Promise((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1));
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => stdout += chunk);
        child.stderr.on("data", (chunk) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
    });

    try {
        await ensureConsoleFile(namespace);
        const source = await createSqlFile(namespace, "draft");
        await writeFile(source.path, "SELECT 1;");
        const observed = await readSqlFile(namespace, source.name);
        await writeFile(source.path, "SELECT 2;");
        await assert.rejects(renameSqlFile(namespace, source.name, "renamed.sql", observed.version), { code: "FILE_VERSION_CONFLICT" });
        assert.equal(await readFile(source.path, "utf8"), "SELECT 2;");

        const target = await createSqlFile(namespace, "renamed");
        const current = await readSqlFile(namespace, source.name);
        await assert.rejects(renameSqlFile(namespace, source.name, target.name, current.version), { code: "FILE_EXISTS" });
        assert.equal(await readFile(source.path, "utf8"), "SELECT 2;");

        const unicodeTarget = await createSqlFile(namespace, "中");
        const unicodeCurrent = await readSqlFile(namespace, source.name);
        await assert.rejects(renameSqlFile(namespace, source.name, unicodeTarget.name, unicodeCurrent.version), { code: "FILE_EXISTS" });
        assert.equal(await readFile(source.path, "utf8"), "SELECT 2;");
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("trashSqlFile sends the versioned source to Finder and requires the path to disappear", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => {
        if (argv[0] === "osascript")
            return rm(join(databaseDir, "draft.sql")).then(() => ({ exitCode: 0, stdout: "", stderr: "" }));
        return new Promise((resolve, reject) => {
            const child = spawn(argv[0], argv.slice(1));
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => stdout += chunk);
            child.stderr.on("data", (chunk) => stderr += chunk);
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
        });
    };

    try {
        await ensureConsoleFile(namespace);
        const source = await createSqlFile(namespace, "draft");
        await writeFile(source.path, "SELECT 1;");
        const observed = await readSqlFile(namespace, source.name);
        const trashed = await trashSqlFile(namespace, source.name, observed.version);

        assert.equal(trashed.trashed, true);
        await assert.rejects(stat(source.path), { code: "ENOENT" });
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});

test("trashSqlFile reports Finder failure without removing the source", async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), "muxy-sql-files-")));
    const rootDir = join(base, "root");
    const fingerprint = "fingerprint";
    const databaseKey = "db-key";
    const databaseDir = join(rootDir, fingerprint, databaseKey);
    const namespace = { rootDir, fingerprint, databaseKey, databaseDir };
    execHandler = (argv) => {
        if (argv[0] === "osascript")
            return Promise.resolve({ exitCode: 1, stdout: "", stderr: "Finder denied" });
        return new Promise((resolve, reject) => {
            const child = spawn(argv[0], argv.slice(1));
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => stdout += chunk);
            child.stderr.on("data", (chunk) => stderr += chunk);
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
        });
    };

    try {
        await ensureConsoleFile(namespace);
        const source = await createSqlFile(namespace, "draft");
        await writeFile(source.path, "SELECT 1;");
        const observed = await readSqlFile(namespace, source.name);
        await assert.rejects(trashSqlFile(namespace, source.name, observed.version), { code: "FILE_TRASH_FAILED" });
        assert.equal(await readFile(source.path, "utf8"), "SELECT 1;");
    }
    finally {
        execHandler = async () => ({ exitCode: 0, stdout: "/Users/test-user\n", stderr: "" });
        await rm(base, { recursive: true, force: true });
    }
});
