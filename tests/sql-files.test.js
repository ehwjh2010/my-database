import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
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
};

const { createSqlFile, ensureConsoleFile, getSqlNamespace, listSqlFiles, readSqlFile, validateFileName, filePath } = await import("../src/lib/sql-files.js");

test("network SQL namespace uses the connection identity and database key", async () => {
    calls.length = 0;
    const namespace = await getSqlNamespace({
        conn: { engine: "postgres", net: { host: "DB.Example", port: 5432, user: "alice" } },
        database: "sales",
    });
    const fingerprint = createHash("sha256").update(JSON.stringify(["v1", "postgres", "DB.Example", "5432", "alice"])).digest("hex");
    const databaseKey = createHash("sha256").update("sales").digest("hex");

    assert.equal(namespace.fingerprint, fingerprint);
    assert.equal(namespace.rootDir, "/Users/test-user/.my-muxy-database");
    assert.equal(namespace.databaseKey, `db-${databaseKey}`);
    assert.equal(namespace.databaseDir, `${namespace.rootDir}/${fingerprint}/db-${databaseKey}`);
    assert.equal(calls.length, 1);
});

test("SQL file names stay flat and protect console.sql", () => {
    assert.equal(validateFileName("query"), "query.sql");
    assert.equal(validateFileName("报告.sql"), "报告.sql");
    assert.throws(() => validateFileName("nested/query.sql"), { code: "FILE_NAME_INVALID" });
    assert.throws(() => validateFileName("console.sql"), { code: "FILE_RESERVED" });
    assert.equal(filePath({ databaseDir: "/tmp/sql" }, "query.sql"), "/tmp/sql/query.sql");
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
