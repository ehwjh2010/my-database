import assert from "node:assert/strict";
import test from "node:test";

const writes = [];
const prompts = [];
let folder = "/tmp/exports";
let fileName = "report.json";
let writeFails = false;
let dumpFile = "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);";
let pickedDumpPath = "/tmp/exports/database.sql";
const toasts = [];

globalThis.muxy = {
    dialog: {
        async pickFolder() {
            return folder;
        },
        async prompt() {
            prompts.push(arguments[0]);
            return fileName;
        },
    },
    async exec(argv) {
        writes.push(argv);
        if (argv[0] === "osascript" && String(argv[2] || "").includes("choose file"))
            return { exitCode: 0, stdout: `${pickedDumpPath}\n`, stderr: "" };
        if (argv[1] === "-e" && argv[2].includes("open(my $f, \"<\""))
            return { exitCode: 0, stdout: dumpFile, stderr: "" };
        return writeFails ? { exitCode: 1, stdout: "", stderr: "disk full" } : { exitCode: 0, stdout: "", stderr: "" };
    },
    async toast(value) {
        toasts.push(value);
    },
};

const { dumpDatabase, dumpProgressFor, exportActive, importCommittedObject, restoreDatabase, transferDialogFor } = await import("../src/transfer/transfer.js");

test("database restore picks a dump file", async () => {
    pickedDumpPath = "/tmp/exports/backup.sql";
    try {
        const restored = await restoreDatabase({
            conn: { engine: "sqlite" },
            ctx: {},
            driver: { async runBatch() {} },
        }, {
            confirm: async (path) => {
                assert.equal(path, "/tmp/exports/backup.sql");
                return "Import";
            },
        });
        assert.equal(restored.status, "restored");
        assert.equal(restored.path, "/tmp/exports/backup.sql");
        assert.ok(writes.some((argv) => argv[0] === "osascript" && String(argv[2] || "").includes("choose file")));
    } finally {
        pickedDumpPath = "/tmp/exports/database.sql";
    }
});

test("exportActive exports the active SQL tab result with its SQL filename", async () => {
    writes.length = 0;
    prompts.length = 0;
    const result = { columns: [{ name: "id" }], rows: [[1]] };
    const session = {
        conn: { engine: "sqlite" },
        sqlRegistry: {
            activeId: 2,
            byId: {
                1: { key: "sql:1", name: "old.sql" },
                2: { key: "sql:2", name: "report.sql" },
            },
        },
        sqlState: new Map([
            ["sql:1", { exportContext: { result: { columns: [{ name: "old" }], rows: [[0]] } } }],
            ["sql:2", { exportContext: { result } }],
        ]),
    };

    const exported = await exportActive(session, "json");

    assert.deepEqual(exported, { status: "exported", path: "/tmp/exports/report.json" });
    assert.equal(prompts.at(-1).default, "report.json");
    assert.equal(writes.at(-1).at(-2), "/tmp/exports/report.json");
    assert.match(writes.at(-1).at(-1), /"id": 1/);
    assert.doesNotMatch(writes.at(-1).at(-1), /old/);
});

test("exportActive rejects missing, inactive, and columnless SQL results", async () => {
    const base = { conn: { engine: "sqlite" }, sqlRegistry: { activeId: null, byId: {} }, sqlState: new Map() };

    assert.deepEqual(await exportActive(base, "csv"), { error: "EXPORT_NOT_AVAILABLE" });

    const session = {
        ...base,
        sqlRegistry: { activeId: 1, byId: { 1: { key: "sql:1", name: "empty.sql" } } },
        sqlState: new Map([["sql:1", { exportContext: { result: { columns: [], rows: [] } } }]]),
    };

    assert.deepEqual(await exportActive(session, "csv"), { error: "EXPORT_NOT_AVAILABLE" });
});

test("exportResult returns cancelled without writing when either dialog is cancelled", async () => {
    const { exportResult } = await import("../src/transfer/transfer.js");
    writes.length = 0;
    folder = null;
    assert.deepEqual(await exportResult("sqlite", null, { columns: [{ name: "id" }], rows: [[1]] }, "csv", "report.sql"), { status: "cancelled" });
    assert.equal(writes.length, 0);

    folder = "/tmp/exports";
    fileName = null;
    assert.deepEqual(await exportResult("sqlite", null, { columns: [{ name: "id" }], rows: [[1]] }, "csv", "report.sql"), { status: "cancelled" });
    assert.equal(writes.length, 0);
    folder = "/tmp/exports";
    fileName = "report.json";
});

test("exportActive uses the selected format extension for CSV, JSON, and SQL", async () => {
    const session = {
        conn: { engine: "sqlite" },
        sqlRegistry: { activeId: 1, byId: { 1: { key: "sql:1", name: "report.sql" } } },
        sqlState: new Map([["sql:1", { exportContext: { result: { columns: [{ name: "id" }], rows: [[1]] } } }]]),
    };
    for (const format of ["csv", "json", "sql"]) {
        const name = `report.${format}`;
        fileName = name;
        const exported = await exportActive(session, format);
        assert.deepEqual(exported, { status: "exported", path: `/tmp/exports/${name}` });
        assert.equal(prompts.at(-1).default, name);
    }
    fileName = "report.json";
});

test("exportResult returns EXPORT_FAILED with the write error", async () => {
    const { exportResult } = await import("../src/transfer/transfer.js");
    writes.length = 0;
    toasts.length = 0;
    writeFails = true;

    const failed = await exportResult("sqlite", null, { columns: [{ name: "id" }], rows: [[1]] }, "json", "report.sql");

    assert.deepEqual(failed, { error: "EXPORT_FAILED", message: "disk full" });
    assert.equal(writes.length, 1);
    assert.match(toasts.at(-1).body, /EXPORT_FAILED: disk full/);
    writeFails = false;
});

test("database dump keeps the active connection context and driver timeout", async () => {
    const calls = [];
    folder = "/tmp/exports";
    fileName = "database.sql";

    await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app", schema: "public" },
        driver: { async dumpDatabase(ctx, path, options) { calls.push({ ctx, path, options }); } },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ctx, { database: "app", schema: "public" });
    assert.equal(calls[0].path, "/tmp/exports/database.sql");
    assert.deepEqual(calls[0].options, { timeoutMs: 600000 });
});

test("dump progress projection reports indeterminate running then complete percent", () => {
    assert.equal(dumpProgressFor(null), null);
    assert.deepEqual(dumpProgressFor({ kind: "export", status: "running" }), null);
    assert.deepEqual(dumpProgressFor({ kind: "dump", status: "running" }), {
        kind: "dump",
        status: "running",
        title: "Export database",
        icon: "download",
        label: "Dumping database",
        percent: 0,
    });
    assert.deepEqual(dumpProgressFor({ kind: "dump", status: "running", indeterminate: true, label: "Dumping database…" }), {
        kind: "dump",
        status: "running",
        title: "Export database",
        icon: "download",
        label: "Dumping database…",
        indeterminate: true,
        percent: 0,
    });
    assert.deepEqual(dumpProgressFor({ kind: "dump", status: "done", label: "Dump written" }), {
        kind: "dump",
        status: "done",
        title: "Export database",
        icon: "download",
        label: "Dump written",
        percent: 100,
    });
    assert.deepEqual(dumpProgressFor({ kind: "restore", status: "running" }), {
        kind: "restore",
        status: "running",
        title: "Import database",
        icon: "upload",
        label: "Importing database",
        percent: 0,
    });
});

test("database dump reports running then done progress", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    const dumped = await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: { async dumpDatabase() {} },
    }, { onProgress: (value) => progress.push({ ...value }) });
    assert.equal(dumped.status, "dumped");
    assert.equal(progress[0].status, "running");
    assert.equal(progress[0].kind, "dump");
    assert.equal(progress[0].percent, 0);
    assert.equal(progress.at(-1).status, "done");
    assert.equal(progress.at(-1).percent, 100);
});

test("cancelled database dump does not report progress", async () => {
    folder = null;
    const progress = [];
    const dumped = await dumpDatabase({
        conn: { name: "App DB" },
        ctx: {},
        driver: { async dumpDatabase() { throw new Error("should not dump"); } },
    }, { onProgress: (value) => progress.push(value) });
    assert.deepEqual(dumped, { status: "cancelled" });
    assert.equal(progress.length, 0);
    folder = "/tmp/exports";
});

test("failed database dump reports error progress", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    const dumped = await dumpDatabase({
        conn: { name: "App DB" },
        ctx: {},
        driver: { async dumpDatabase() { throw new Error("pg_dump failed"); } },
    }, { onProgress: (value) => progress.push(value) });
    assert.equal(dumped.error, "DUMP_FAILED");
    assert.equal(dumped.message, "pg_dump failed");
    assert.equal(progress.at(-1).status, "error");
    assert.equal(progress.at(-1).percent, 100);
});

test("database dump reports percent after each table", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const calls = [];
    const progress = [];
    const dumped = await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [{ name: "accounts" }, { name: "orders" }];
            },
            async dumpDatabase(ctx, path, options) {
                calls.push({ ctx, path, options });
            },
        },
    }, { onProgress: (value) => progress.push({ label: value.label, percent: value.percent, status: value.status }) });
    assert.equal(dumped.status, "dumped");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.table, "accounts");
    assert.equal(calls[0].options.append, false);
    assert.equal(calls[1].options.table, "orders");
    assert.equal(calls[1].options.append, true);
    assert.equal(progress.find((entry) => entry.label === "Dumping accounts…" && entry.percent === 0)?.status, "running");
    assert.equal(progress.find((entry) => entry.label === "Dumping orders…" && entry.percent === 50)?.status, "running");
    assert.deepEqual(progress.at(-1), { label: "Dump written", percent: 100, status: "done" });
});

test("database dump weights percent by row estimates", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [{ name: "big", rowEstimate: 300 }, { name: "small", rowEstimate: 100 }];
            },
            async dumpDatabase() {},
        },
    }, { onProgress: (value) => progress.push({ label: value.label, percent: value.percent }) });
    assert.equal(progress.find((entry) => entry.label === "Dumping big…").percent, 0);
    assert.equal(progress.find((entry) => entry.label === "Dumping small…").percent, 75);
    assert.equal(progress.filter((entry) => entry.percent === 100).length >= 1, true);
});

test("database dump falls back to equal weights when estimates are missing", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [{ name: "accounts" }, { name: "orders" }];
            },
            async dumpDatabase() {},
        },
    }, { onProgress: (value) => progress.push({ label: value.label, percent: value.percent }) });
    assert.equal(progress.find((entry) => entry.label === "Dumping orders…").percent, 50);
});

test("database dump with no tables reports an indeterminate single dump", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    const dumped = await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [];
            },
            async dumpDatabase() {},
        },
    }, { onProgress: (value) => progress.push({ ...value }) });
    assert.equal(dumped.status, "dumped");
    assert.equal(progress[0].indeterminate, true);
    assert.equal(progress.at(-1).status, "done");
});

test("database restore batches split statements and reports batch percent", async () => {
    dumpFile = Array.from({ length: 250 }, (_, index) => `INSERT INTO t VALUES (${index});`).join("\n");
    const batches = [];
    const progress = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async runBatch(ctx, sql) { batches.push(sql); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: (value) => progress.push({ percent: value.percent, indeterminate: value.indeterminate, label: value.label }),
    });
    assert.equal(restored.status, "restored");
    assert.equal(batches.length, 3);
    assert.match(batches[0], /VALUES \(0\);\n/);
    assert.match(batches[0], /VALUES \(99\);$/);
    assert.match(batches[2], /VALUES \(249\);$/);
    assert.equal(progress[1].percent, 0);
    assert.equal(progress[2].percent, 33);
    assert.equal(progress[2].label.includes("2/3"), true);
    assert.equal(progress[4].percent, 100);
    dumpFile = "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);";
});

test("database restore falls back to single-shot import without runBatch", async () => {
    const calls = [];
    const progress = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async importDatabase(ctx, path, options) { calls.push({ path, options }); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: (value) => progress.push({ ...value }),
    });
    assert.equal(restored.status, "restored");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeoutMs, 600000);
    assert.equal(progress[1].indeterminate, true);
    assert.equal(progress.at(-1).status, "done");
});

test("database restore falls back when the dump cannot be read", async () => {
    const calls = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async importDatabase() { calls.push("import"); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: () => undefined,
    });
    assert.equal(restored.status, "restored");
    assert.equal(calls.length, 1);
});

test("database dump weights percent by row estimates", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [{ name: "big", rowEstimate: 300 }, { name: "small", rowEstimate: 100 }];
            },
            async dumpDatabase() {},
        },
    }, { onProgress: (value) => progress.push({ label: value.label, percent: value.percent }) });
    assert.equal(progress.find((entry) => entry.label === "Dumping big…").percent, 0);
    assert.equal(progress.find((entry) => entry.label === "Dumping small…").percent, 75);
    assert.equal(progress.filter((entry) => entry.percent === 100).length >= 1, true);
});

test("database dump falls back to equal weights when estimates are missing", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [{ name: "accounts" }, { name: "orders" }];
            },
            async dumpDatabase() {},
        },
    }, { onProgress: (value) => progress.push({ label: value.label, percent: value.percent }) });
    assert.equal(progress.find((entry) => entry.label === "Dumping orders…").percent, 50);
});

test("database dump with no tables reports an indeterminate single dump", async () => {
    folder = "/tmp/exports";
    fileName = "database.sql";
    const progress = [];
    const dumped = await dumpDatabase({
        conn: { name: "App DB" },
        ctx: { database: "app" },
        driver: {
            async listTables() {
                return [];
            },
            async dumpDatabase() {},
        },
    }, { onProgress: (value) => progress.push({ ...value }) });
    assert.equal(dumped.status, "dumped");
    assert.equal(progress[0].indeterminate, true);
    assert.equal(progress.at(-1).status, "done");
});

test("database restore batches split statements and reports batch percent", async () => {
    dumpFile = Array.from({ length: 250 }, (_, index) => `INSERT INTO t VALUES (${index});`).join("\n");
    const batches = [];
    const progress = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async runBatch(ctx, sql) { batches.push(sql); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: (value) => progress.push({ percent: value.percent, indeterminate: value.indeterminate, label: value.label }),
    });
    assert.equal(restored.status, "restored");
    assert.equal(batches.length, 3);
    assert.match(batches[0], /VALUES \(0\);\n/);
    assert.match(batches[0], /VALUES \(99\);$/);
    assert.match(batches[2], /VALUES \(249\);$/);
    assert.equal(progress[1].percent, 0);
    assert.equal(progress[2].percent, 33);
    assert.equal(progress[2].label.includes("2/3"), true);
    assert.equal(progress[4].percent, 100);
    dumpFile = "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);";
});

test("database restore falls back to single-shot import without runBatch", async () => {
    const calls = [];
    const progress = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async importDatabase(ctx, path, options) { calls.push({ path, options }); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: (value) => progress.push({ ...value }),
    });
    assert.equal(restored.status, "restored");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeoutMs, 600000);
    assert.equal(progress[1].indeterminate, true);
    assert.equal(progress.at(-1).status, "done");
});

test("database restore falls back when the dump cannot be read", async () => {
    const calls = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async importDatabase() { calls.push("import"); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: () => undefined,
    });
    assert.equal(restored.status, "restored");
    assert.equal(calls.length, 1);
});

test("database restore keeps the active connection context and driver timeout", async () => {
    const calls = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: { database: "app", schema: "public" },
        driver: { async runBatch(ctx, sql, options) { calls.push({ ctx, sql, options }); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: () => undefined,
    });
    assert.deepEqual(restored, { status: "restored", path: "/tmp/exports/database.sql" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ctx, { database: "app", schema: "public" });
    assert.equal(calls[0].sql, "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);");
    assert.deepEqual(calls[0].options, { timeoutMs: 600000 });
});

test("database restore reports running then done progress", async () => {
    const progress = [];
    const restored = await restoreDatabase({
        ctx: {},
        driver: { async importDatabase() {} },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: (value) => progress.push({ ...value }),
    });
    assert.equal(restored.status, "restored");
    assert.equal(progress[0].kind, "restore");
    assert.equal(progress[0].status, "running");
    assert.equal(progress[0].percent, 0);
    assert.equal(progress.at(-1).status, "done");
    assert.equal(progress.at(-1).percent, 100);
});

test("cancelled database restore does not report progress", async () => {
    const progress = [];
    const skippedFile = await restoreDatabase({
        ctx: {},
        driver: { async importDatabase() { throw new Error("should not restore"); } },
    }, {
        pickFile: async () => null,
        confirm: async () => "Import",
        onProgress: (value) => progress.push(value),
    });
    const skippedConfirm = await restoreDatabase({
        ctx: {},
        driver: { async importDatabase() { throw new Error("should not restore"); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Cancel",
        onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(skippedFile, { status: "cancelled" });
    assert.deepEqual(skippedConfirm, { status: "cancelled" });
    assert.equal(progress.length, 0);
});

test("failed database restore reports error progress", async () => {
    const progress = [];
    const restored = await restoreDatabase({
        conn: { engine: "sqlite" },
        ctx: {},
        driver: { async runBatch() { throw new Error("syntax error"); } },
    }, {
        pickFile: async () => "/tmp/exports/database.sql",
        confirm: async () => "Import",
        onProgress: (value) => progress.push(value),
    });
    assert.equal(restored.error, "RESTORE_FAILED");
    assert.equal(restored.message, "batch 1/1: syntax error");
    assert.equal(progress.at(-1).status, "error");
    assert.equal(progress.at(-1).percent, 100);
});

test("transfer dialog projects a determinate percent for every transfer kind", () => {
    assert.deepEqual(transferDialogFor({ kind: "import", status: "running", percent: 40 }), {
        kind: "import",
        status: "running",
        title: "Import data",
        icon: "upload",
        label: "Importing data",
        percent: 40,
    });
    assert.equal(transferDialogFor({ kind: "export", status: "done" }).percent, 100);
    assert.equal(transferDialogFor({ kind: "dump", status: "running" }).percent, 0);
});

test("data import reports percent before each batch for every row format", async () => {
    for (const format of ["csv", "json"]) {
        const queries = [];
        const progress = [];
        const rows = format === "csv"
            ? `id\n${Array.from({ length: 60 }, (_, index) => String(index)).join("\n")}\n`
            : JSON.stringify(Array.from({ length: 60 }, (_, index) => ({ id: index })));
        const imported = await importCommittedObject({
            driver: {
                async runQuery(ctx, sql, options) {
                    queries.push({ ctx, sql, options });
                    return [{}];
                },
            },
            engine: "sqlite",
            operationCtx: { database: "app" },
            objectRef: { table: "items" },
            format,
            path: `/tmp/items.${format}`,
            timeoutMs: 1000,
            read: async () => rows,
            onProgress: (value) => progress.push({ percent: value.percent, status: value.status, kind: value.kind }),
        });
        assert.deepEqual(imported, { rowCount: 60 });
        assert.equal(queries.length, 2);
        assert.equal(queries[0].options.timeoutMs, 1000);
        assert.match(queries[0].sql, /INSERT INTO "items"/);
        assert.equal(progress[0].percent, 0);
        assert.equal(progress[0].kind, "import");
        assert.equal(progress[1].percent, 0);
        assert.equal(progress[2].percent, 83);
        assert.equal(progress.at(-1).percent, 100);
    }
});

test("data import rejects invalid or empty json and csv payloads", async () => {
    const driver = { async runQuery() { return [{}]; } };
    await assert.rejects(
        importCommittedObject({ driver, engine: "sqlite", operationCtx: {}, objectRef: { table: "t" }, format: "json", path: "/x", read: async () => "{oops" }),
        /JSON_INVALID/,
    );
    await assert.rejects(
        importCommittedObject({ driver, engine: "sqlite", operationCtx: {}, objectRef: { table: "t" }, format: "json", path: "/x", read: async () => '{"id":1}' }),
        /JSON_INVALID/,
    );
    await assert.rejects(
        importCommittedObject({ driver, engine: "sqlite", operationCtx: {}, objectRef: { table: "t" }, format: "json", path: "/x", read: async () => "[]" }),
        /IMPORT_EMPTY/,
    );
    await assert.rejects(
        importCommittedObject({ driver, engine: "sqlite", operationCtx: {}, objectRef: { table: "t" }, format: "csv", path: "/x", read: async () => "id\n" }),
        /IMPORT_EMPTY/,
    );
});

test("data import maps json rows onto the union of keys with nulls", async () => {
    const queries = [];
    await importCommittedObject({
        driver: { async runQuery(_ctx, sql) { queries.push(sql); return [{}]; } },
        engine: "sqlite",
        operationCtx: {},
        objectRef: { table: "t" },
        format: "json",
        path: "/x",
        read: async () => JSON.stringify([{ id: 1, name: "Ada" }, { id: 2 }]),
    });
    assert.match(queries[0], /INSERT INTO "t" \("id", "name"\) VALUES \(1, 'Ada'\), \(2, NULL\)/);
});

test("data import splits sql dumps into batched statements", async () => {
    const batches = [];
    const progress = [];
    const statements = Array.from({ length: 250 }, (_, index) => `INSERT INTO t VALUES (${index})`).join(";\n");
    const imported = await importCommittedObject({
        driver: {
            engine: "sqlite",
            async runBatch(_ctx, sql, options) {
                batches.push({ sql, options });
                return [];
            },
        },
        engine: "sqlite",
        operationCtx: {},
        objectRef: { table: "t" },
        format: "sql",
        path: "/x",
        timeoutMs: 1000,
        read: async () => statements,
        onProgress: (value) => progress.push({ percent: value.percent, status: value.status }),
    });
    assert.deepEqual(imported, { rowCount: 250 });
    assert.equal(batches.length, 3);
    assert.equal(batches[0].options.timeoutMs, 1000);
    assert.match(batches[0].sql, /INSERT INTO t VALUES \(99\);?/);
    assert.doesNotMatch(batches[0].sql, /VALUES \(100\)/);
    assert.match(batches.at(-1).sql, /VALUES \(249\)/);
    assert.equal(progress[0].percent, 0);
    assert.equal(progress.at(-1).percent, 100);
});

test("data import rejects an empty sql dump without running a batch", async () => {
    let batches = 0;
    await assert.rejects(
        importCommittedObject({
            driver: { engine: "sqlite", async runBatch() { batches += 1; return []; } },
            engine: "sqlite",
            operationCtx: {},
            objectRef: { table: "t" },
            format: "sql",
            path: "/x",
            read: async () => "   \n",
        }),
        /IMPORT_EMPTY/,
    );
    assert.equal(batches, 0);
});

test("committed object export reports an indeterminate fetch then continuous write percent", async () => {
    const { exportCommittedObject } = await import("../src/transfer/transfer.js");
    const progress = [];
    await exportCommittedObject({
        driver: { async runQuery() { return [{ columns: [{ name: "id" }], rows: [[1]] }]; } },
        engine: "sqlite",
        operationCtx: {},
        objectRef: { table: "orders" },
        format: "json",
        path: "/tmp/export.json",
        async write(path, content, onWrite) {
            onWrite(25);
            onWrite(75);
        },
        onProgress: (value) => progress.push({ ...value }),
    });
    assert.deepEqual(progress[0], { kind: "export", status: "running", label: "Fetching rows…", percent: 0, indeterminate: true });
    assert.deepEqual(progress[1], { kind: "export", status: "running", label: "Writing file…", percent: 0, indeterminate: false });
    assert.deepEqual(progress[2], { kind: "export", status: "running", label: "Writing file…", percent: 25, indeterminate: false });
    assert.deepEqual(progress[3].percent, 75);
    assert.equal(progress.at(-1).percent, 75);
});

test("committed object export reports an indeterminate fetch then continuous write percent", async () => {
    const { exportCommittedObject } = await import("../src/transfer/transfer.js");
    const progress = [];
    await exportCommittedObject({
        driver: { async runQuery() { return [{ columns: [{ name: "id" }], rows: [[1]] }]; } },
        engine: "sqlite",
        operationCtx: {},
        objectRef: { table: "orders" },
        format: "json",
        path: "/tmp/export.json",
        async write(path, content, onWrite) {
            onWrite(25);
            onWrite(75);
        },
        onProgress: (value) => progress.push({ ...value }),
    });
    assert.deepEqual(progress[0], { kind: "export", status: "running", label: "Fetching rows…", percent: 0, indeterminate: true });
    assert.deepEqual(progress[1], { kind: "export", status: "running", label: "Writing file…", percent: 0, indeterminate: false });
    assert.deepEqual(progress[2], { kind: "export", status: "running", label: "Writing file…", percent: 25, indeterminate: false });
    assert.deepEqual(progress[3].percent, 75);
    assert.equal(progress.at(-1).percent, 75);
});
