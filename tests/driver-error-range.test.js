import assert from "node:assert/strict";
import test from "node:test";

globalThis.muxy = {
    exec: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
};

const { setSessionPassword } = await import("../src/lib/credentials.js");
const { mysql } = await import("../src/lib/drivers/mysql.js");
const { postgres } = await import("../src/lib/drivers/postgres.js");

const mysqlCtx = {
    conn: { id: "mysql-error-range", net: { host: "localhost", port: 3306, user: "tester", database: "app" } },
    database: "app",
    endpoint: { host: "localhost", port: 3306 },
};
const postgresCtx = {
    conn: { id: "postgres-error-range", net: { host: "localhost", port: 5432, user: "tester", database: "app" } },
    database: "app",
    endpoint: { host: "localhost", port: 5432 },
};

test("sequential drivers attach the source range for the failed statement", async () => {
    setSessionPassword("mysql-error-range", "secret");
    muxy.exec = async (argv) => {
        if (argv[0] === "/usr/bin/which")
            return { exitCode: 0, stdout: "/usr/bin/mysql\n", stderr: "" };
        if (argv[0] === "perl")
            return { exitCode: 0, stdout: "", stderr: "" };
        if (argv.at(-1).includes("broken"))
            return { exitCode: 1, stdout: "", stderr: "ERROR 1064: near 'broken'" };
        return { exitCode: 0, stdout: "<resultset><row><field name=\"one\">1</field></row></resultset><resultset><row><field name=\"__rc\">0</field></row></resultset>", stderr: "" };
    };
    await assert.rejects(mysql.runQuery(mysqlCtx, "SELECT 1;\nSELECT broken"), (error) => {
        assert.deepEqual(error.statement, { sql: "SELECT broken", from: 9, to: 23 });
        return true;
    });

    setSessionPassword("postgres-error-range", "secret");
    muxy.exec = async (argv) => {
        if (argv[0] === "perl")
            return { exitCode: 0, stdout: "", stderr: "" };
        if (argv[argv.indexOf("-c") + 1].includes("broken"))
            return { exitCode: 1, stdout: "", stderr: "ERROR: syntax error" };
        return { exitCode: 0, stdout: "one\n1\n", stderr: "" };
    };
    await assert.rejects(postgres.runQuery(postgresCtx, "SELECT 1;\nSELECT broken"), (error) => {
        assert.deepEqual(error.statement, { sql: "SELECT broken", from: 9, to: 23 });
        return true;
    });
});
