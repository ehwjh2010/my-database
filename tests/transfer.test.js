import assert from "node:assert/strict";
import test from "node:test";

const writes = [];
const prompts = [];
let folder = "/tmp/exports";
let fileName = "report.json";
let writeFails = false;
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
        return writeFails ? { exitCode: 1, stdout: "", stderr: "disk full" } : { exitCode: 0, stdout: "", stderr: "" };
    },
    async toast(value) {
        toasts.push(value);
    },
};

const { exportActive } = await import("../src/transfer/transfer.js");

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
