import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

globalThis.muxy = {
    async exec(argv) {
        try {
            const stdout = execFileSync(argv[0], argv.slice(1), { encoding: "utf8" });
            return { exitCode: 0, stdout, stderr: "" };
        }
        catch (error) {
            return { exitCode: error.status ?? 1, stdout: error.stdout || "", stderr: error.stderr || String(error.message) };
        }
    },
};

const { writeFilteredMysqlDump } = await import("../src/lib/mysql-dump-filter.js");

test("mysql dump filter strips GTID and session binlog wrappers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mysql-dump-filter-"));
    const src = join(dir, "dump.sql");
    const dest = join(dir, "filtered.sql");
    writeFileSync(src, [
        "SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;",
        "SET @@SESSION.SQL_LOG_BIN= 0;",
        "SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ 'aaaa,",
        "bbbb';",
        "DROP TABLE IF EXISTS `t`;",
        "INSERT INTO `t` VALUES (1);",
        "SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;",
        "",
    ].join("\n"));
    await writeFilteredMysqlDump(src, dest);
    const filtered = readFileSync(dest, "utf8");
    assert.equal(filtered.includes("GTID_PURGED"), false);
    assert.equal(filtered.includes("SQL_LOG_BIN"), false);
    assert.match(filtered, /DROP TABLE IF EXISTS `t`;/);
    assert.match(filtered, /INSERT INTO `t` VALUES \(1\);/);
});
