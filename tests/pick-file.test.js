import assert from "node:assert/strict";
import test from "node:test";

const calls = [];
let result = { exitCode: 0, stdout: "/tmp/data.csv\n", stderr: "" };

globalThis.muxy = {
    async exec(argv, options) {
        calls.push({ argv, options });
        return result;
    },
};

const { pickOpenFile } = await import("../src/lib/pick-file.js");

test("pickOpenFile opens a file picker and returns the chosen path", async () => {
    calls.length = 0;
    result = { exitCode: 0, stdout: "/tmp/orders.sql\n", stderr: "" };
    const path = await pickOpenFile({ title: "Choose SQL file" });
    assert.equal(path, "/tmp/orders.sql");
    assert.equal(calls[0].argv[0], "osascript");
    assert.match(calls[0].argv[2], /choose file/);
    assert.equal(calls[0].argv[3], "Choose SQL file");
    assert.doesNotMatch(calls[0].argv[2], /choose folder|pickFolder/);
    assert.equal(calls[0].options.timeoutMs, 600000);
});

test("pickOpenFile returns null when the file picker is cancelled", async () => {
    result = { exitCode: 0, stdout: "", stderr: "" };
    assert.equal(await pickOpenFile({ title: "Choose CSV file" }), null);
});
