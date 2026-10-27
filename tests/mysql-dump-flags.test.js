import assert from "node:assert/strict";
import test from "node:test";
import { flagsFromDumpHelp, mysqlDumpPrivilegeFlags, resetMysqlDumpFlags } from "../src/lib/mysql-dump-flags.js";

test("masking policy help yields the skip flag", () => {
    assert.deepEqual(
        flagsFromDumpHelp("  --dump-masking-policies\n                      Dump masking policies."),
        ["--skip-dump-masking-policies"],
    );
});

test("mysql 8 help skips column statistics and tablespaces", () => {
    assert.deepEqual(
        flagsFromDumpHelp("  --column-statistics\n  --no-tablespaces"),
        ["--column-statistics=0", "--no-tablespaces"],
    );
});

test("old dump help yields no privilege flags", () => {
    assert.deepEqual(flagsFromDumpHelp("  --single-transaction\n  --set-gtid-purged"), []);
});

test("empty help yields no privilege flags", () => {
    assert.deepEqual(flagsFromDumpHelp(""), []);
    assert.deepEqual(flagsFromDumpHelp(null), []);
});

test("privilege flags are read from dump help and cached", async () => {
    resetMysqlDumpFlags();
    const calls = [];
    globalThis.muxy = {
        async exec(argv) {
            calls.push(argv);
            return {
                exitCode: 0,
                stdout: "  --dump-masking-policies\n  --column-statistics\n  --no-tablespaces\n",
                stderr: "",
            };
        },
    };
    const first = await mysqlDumpPrivilegeFlags("mysqldump");
    const second = await mysqlDumpPrivilegeFlags("mysqldump");
    assert.deepEqual(first, [
        "--skip-dump-masking-policies",
        "--column-statistics=0",
        "--no-tablespaces",
    ]);
    assert.deepEqual(second, first);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ["mysqldump", "--help"]);
});

test("missing dump help yields no privilege flags", async () => {
    resetMysqlDumpFlags();
    globalThis.muxy = {
        async exec() {
            return { exitCode: 1, stdout: "", stderr: "unknown option" };
        },
    };
    assert.deepEqual(await mysqlDumpPrivilegeFlags("mysqldump"), []);
});
