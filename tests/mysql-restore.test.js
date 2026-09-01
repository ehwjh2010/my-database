import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, openSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDetection } from "../src/lib/cli-detect.js";

const calls = [];
let sourcedSql = "";

globalThis.muxy = {
    async exec(argv) {
        if (argv[0] === "/usr/bin/which") {
            const ok = argv[1] === "mysql" || argv[1] === "mysqldump";
            return { exitCode: ok ? 0 : 1, stdout: ok ? `${argv[1]}\n` : "", stderr: "" };
        }
        calls.push(argv);
        if (argv[0] === "perl") {
            if (String(argv[2] || "").includes("open(STDIN")) {
                sourcedSql = readFileSync(argv[3], "utf8");
                return { exitCode: 0, stdout: "", stderr: "" };
            }
            try {
                const stdout = execFileSync("perl", argv.slice(1), { encoding: "utf8" });
                return { exitCode: 0, stdout, stderr: "" };
            }
            catch (error) {
                return { exitCode: error.status ?? 1, stdout: error.stdout || "", stderr: error.stderr || String(error.message) };
            }
        }
        if (argv[0] === "mysqldump") {
            const resultFile = argv.find((arg) => arg.startsWith("--result-file="));
            const tables = argv.slice(10).filter((arg) => !arg.startsWith("--") && !/^\d+$/.test(arg));
            if (resultFile) {
                writeFileSync(resultFile.slice("--result-file=".length), `DUMP:${tables.join(",")}`);
            }
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
    },
};

const { mysql } = await import("../src/lib/drivers/mysql.js");

const ctx = {
    conn: { id: "c1", net: { host: "127.0.0.1", port: 3306, user: "root", database: "airflow_db6" } },
    database: "airflow_db6",
};

test("mysql dump omits GTID purged metadata and dumps in three phases", async () => {
    resetDetection();
    calls.length = 0;
    await mysql.dumpDatabase(ctx, "/tmp/muxy-mysql-dump-test.sql");
    const dumps = calls.filter((argv) => argv[0] === "mysqldump");
    assert.ok(dumps.length >= 3, `expected 3 phased dumps, got ${dumps.length}`);
    for (const dump of dumps) {
        assert.ok(dump.includes("--set-gtid-purged=OFF"));
        assert.ok(dump.includes("--single-transaction"));
    }
    assert.ok(dumps[0].includes("--no-data"));
    assert.ok(dumps[0].includes("--routines"));
    assert.ok(dumps[0].includes("--skip-triggers"));
    assert.ok(dumps[1].includes("--no-create-info"));
    assert.ok(dumps[1].includes("--skip-triggers"));
    assert.ok(!dumps[1].includes("--no-data"));
    assert.ok(dumps[2].includes("--no-data"));
    assert.ok(dumps[2].includes("--triggers"));
    for (const dump of dumps)
        assert.ok(dump.some((arg) => arg.startsWith("--result-file=")), "dump should write via --result-file");
});

test("mysql per-table dump appends to the file instead of overwriting", async () => {
    resetDetection();
    calls.length = 0;
    const dumpPath = join(mkdtempSync(join(tmpdir(), "mysql-table-dump-")), "db.sql");
    await mysql.dumpDatabase(ctx, dumpPath, { table: "authors" });
    await mysql.dumpDatabase(ctx, dumpPath, { table: "books", append: true });
    await mysql.dumpDatabase(ctx, dumpPath, { table: "orders", append: true });
    const content = readFileSync(dumpPath, "utf8");
    const parts = content.split(/(?=DUMP:)/).filter(Boolean);
    assert.equal(parts.length, 3, `expected 3 table dumps, got: ${content}`);
    assert.match(parts[0], /DUMP:.*authors$/);
    assert.match(parts[1], /DUMP:.*books$/);
    assert.match(parts[2], /DUMP:.*orders$/);
});

test("mysql restore sources a filtered dump file", async () => {
    resetDetection();
    calls.length = 0;
    sourcedSql = "";
    const dumpPath = join(mkdtempSync(join(tmpdir(), "mysql-restore-")), "database.sql");
    writeFileSync(dumpPath, "SET @@GLOBAL.GTID_PURGED='x';\nINSERT INTO t VALUES (1);\n");
    await mysql.importDatabase(ctx, dumpPath, { timeoutMs: 600000 });
    const client = calls.find(
        (argv) => argv[0] === "perl" && String(argv[2] || "").includes("open(STDIN")
    );
    assert.ok(client);
    assert.equal(client[3], "/tmp/muxy-database-c1-import.sql");
    assert.equal(client[4], "mysql");
    assert.ok(client.slice(4).includes("--binary-mode"));
    assert.equal(client.slice(4).includes("-e"), false);
    assert.equal(sourcedSql.includes("GTID_PURGED"), false);
    assert.match(sourcedSql, /INSERT INTO t VALUES \(1\);/);
});

// ── Real integration tests against live MySQL container ───────────────────────

const MYSQL_HOST = "127.0.0.1";
const MYSQL_PORT = "13306";
const MYSQL_USER = "root";
const MYSQL_PASS = "secret123";
const MYSQL_DB = "srcdb";

function mysqlExec(sql) {
    const out = execFileSync(
        "mysql",
        ["-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER, `-p${MYSQL_PASS}`, "--protocol=TCP", MYSQL_DB],
        { encoding: "utf8", input: sql }
    );
    const lines = out.split("\n").filter(Boolean);
    return lines[lines.length - 1] ?? "";
}

test("mysql dump respects schema → data → triggers ordering", () => {
    const dumpPath = mkdtempSync(join(tmpdir(), "mysql-e2e-")) + "/dump.sql";
    writeFileSync("/tmp/my.cnf", `[client]\npassword=${MYSQL_PASS}\n`);

    const argv = [
        "mysqldump",
        `--defaults-extra-file=/tmp/my.cnf`, "--protocol=TCP",
        "--single-transaction", "--set-gtid-purged=OFF",
        "-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER,
        MYSQL_DB,
        "--no-data", "--skip-triggers", "--routines", "--events",
    ];
    const schema = execFileSync(argv[0], argv.slice(1), { encoding: "utf8" });
    writeFileSync(dumpPath, schema);

    const dataArgv = [
        "mysqldump",
        `--defaults-extra-file=/tmp/my.cnf`, "--protocol=TCP",
        "--single-transaction", "--set-gtid-purged=OFF",
        "-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER,
        MYSQL_DB,
        "--no-create-info", "--skip-triggers",
    ];
    execFileSync(dataArgv[0], dataArgv.slice(1), { encoding: "utf8" }).split("\n")
        .filter((l) => l.trim()).forEach((line) => {
            const f = openSync(dumpPath, "a");
            writeFileSync(dumpPath, line + "\n", { flag: "a" });
        });

    const trigArgv = [
        "mysqldump",
        `--defaults-extra-file=/tmp/my.cnf`, "--protocol=TCP",
        "--single-transaction", "--set-gtid-purged=OFF",
        "-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER,
        MYSQL_DB,
        "--no-create-info", "--no-data", "--triggers",
    ];
    execFileSync(trigArgv[0], trigArgv.slice(1), { encoding: "utf8" }).split("\n")
        .filter((l) => l.trim()).forEach((line) => {
            writeFileSync(dumpPath, line + "\n", { flag: "a" });
        });

    const text = readFileSync(dumpPath, "utf8");
    const lines = text.split("\n");
    const authorsCreate = lines.findIndex((l) => /CREATE TABLE .authors./i.test(l));
    const authorsData = lines.findIndex((l) => /INSERT INTO .authors. VALUES/i.test(l));
    const booksData = lines.findIndex((l) => /INSERT INTO .books. VALUES/i.test(l));
    const finalView = lines.findIndex((l) => /Final view structure for view .book_list./i.test(l));
    const triggerLine = lines.findIndex((l) => /TRIGGER.*books_before_insert/i.test(l) || /\bbooks_before_insert\b/.test(l));
    const procedureLine = lines.findIndex((l) => /\bPROCEDURE\b/i.test(l) && /\bcount_books\b/.test(l));

    assert.ok(authorsCreate > 0, "schema phase should emit CREATE TABLE");
    assert.ok(finalView > 0, "schema phase should emit the final view block");
    assert.ok(procedureLine > 0, "schema phase should emit the procedure");
    assert.ok(authorsData > 0, "data phase should produce rows");
    assert.ok(authorsData > authorsCreate, "data must follow schema");
    assert.ok(booksData > authorsData, "books data must follow authors data");
    assert.ok(triggerLine > booksData, `trigger (line ${triggerLine}) must come after data rows (line ${booksData})`);
    assert.ok(triggerLine > procedureLine, "triggers must come after routines");

    rmSync(dumpPath, { force: true });
});

test("mysql dump-and-restore preserves data, views, triggers, and routines", () => {
    writeFileSync("/tmp/my.cnf", `[client]\npassword=${MYSQL_PASS}\n`);
    const dumpPath = mkdtempSync(join(tmpdir(), "mysql-e2e2-")) + "/full.sql";
    const dstDb = "srcdb_restore_test";

    try {
        const phases = [
            ["--no-data", "--skip-triggers", "--routines", "--events"],
            ["--no-create-info", "--skip-triggers"],
            ["--no-create-info", "--no-data", "--triggers"],
        ];
        for (let i = 0; i < phases.length; i++) {
            const argv = [
                "mysqldump",
                `--defaults-extra-file=/tmp/my.cnf`, "--protocol=TCP",
                "--single-transaction", "--set-gtid-purged=OFF",
                "-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER,
                MYSQL_DB,
                ...phases[i],
            ];
            const out = execFileSync(argv[0], argv.slice(1)); // Buffer (binary)
            appendFileSync(dumpPath, out);
        }

        // filter GTID lines and restore — keep binary encoding for blob data
        const filteredPath = dumpPath + ".filtered";
        const raw = readFileSync(dumpPath);
        const SKIP_PREFIXES = [
            Buffer.from("SET @@GLOBAL.GTID_PURGED"),
            Buffer.from("SET @@SESSION.SQL_LOG_BIN"),
            Buffer.from("SET @@MYSQLDUMP_TEMP_LOG_BIN"),
        ];
        const lineRanges = [];
        let start = 0;
        for (let i = 0; i <= raw.length; i++) {
            if (i === raw.length || raw[i] === 10) {
                if (i > start)
                    lineRanges.push([start, i]);
                start = i + 1;
            }
        }
        const out = [];
        for (const [from, to] of lineRanges) {
            const line = raw.slice(from, to);
            const skip = SKIP_PREFIXES.some((p) => line.subarray(0, p.length).equals(p));
            if (!skip)
                out.push(line, Buffer.from([10]));
        }
        writeFileSync(filteredPath, Buffer.concat(out));

        // recreate destination database
        try { mysqlExec(`DROP DATABASE IF EXISTS ${dstDb}`); } catch (_) {}
        mysqlExec(`CREATE DATABASE ${dstDb}`);

        const importArgv = [
            "mysql",
            `--defaults-extra-file=/tmp/my.cnf`, "--protocol=TCP",
            "-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER,
            "--binary-mode",
            dstDb,
        ];
        const input = readFileSync(filteredPath);
        execFileSync(importArgv[0], importArgv.slice(1), { input });

        function mysqlQuery(sql) {
            const out = execFileSync(
                "mysql",
                ["-h", MYSQL_HOST, "-P", MYSQL_PORT, "-u", MYSQL_USER, `-p${MYSQL_PASS}`, "--protocol=TCP", dstDb],
                { input: sql }
            );
            const text = out.toString("latin1");
            const lines = text.split("\n").filter(Boolean);
            return lines[lines.length - 1] ?? "";
        }

        // verify
        const authors = mysqlQuery("SELECT COUNT(*) FROM authors");
        const books = mysqlQuery("SELECT COUNT(*) FROM books");
        const blobRow = mysqlQuery("SELECT HEX(blob_data) FROM books WHERE id=1");
        const viewRows = mysqlQuery("SELECT COUNT(*) FROM book_list");
        const trigCount = mysqlQuery("SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='" + dstDb + "'");
        const routineCount = mysqlQuery("SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='" + dstDb + "'");
        const author2Name = mysqlQuery("SELECT name FROM authors WHERE id=2");

        assert.equal(authors, "3");
        assert.equal(books, "3");
        assert.equal(blobRow, "DEADBEEF");
        assert.equal(viewRows, "3");
        assert.equal(trigCount, "1");
        assert.equal(routineCount, "1");
        assert.equal(author2Name, "Bob");
    }
    finally {
        try { mysqlExec(`DROP DATABASE IF EXISTS ${dstDb}`); } catch (_) {}
        rmSync(dumpPath, { force: true });
        rmSync(dumpPath + ".filtered", { force: true });
    }
});
