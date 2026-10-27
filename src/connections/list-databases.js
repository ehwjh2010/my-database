import { ENGINES } from "../lib/connections.js";
import { ensurePassword } from "../lib/credentials.js";
import { getDriver } from "../lib/drivers/index.js";
import { buildContext } from "../workbench/state.js";

export async function listDatabasesForConnection(conn) {
    const driver = getDriver(conn.engine);
    if (!driver.capabilities.databases)
        return [];
    const detection = await driver.detect();
    if (!detection.available)
        throw new Error(`${ENGINES[conn.engine].binaries[0]} not found.\nInstall it with: ${detection.installHint}`);
    if (conn.engine !== "sqlite") {
        const provided = await ensurePassword(conn);
        if (!provided)
            throw new Error("A password is required to connect.");
    }
    const ctx = await buildContext(conn);
    await driver.test(ctx);
    return driver.listDatabases(ctx);
}
