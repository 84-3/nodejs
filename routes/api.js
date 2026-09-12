const express = require("express");
const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

const {
    getFile,
    updateFile,
    getLatestCommit
} = require("../github");

const router = express.Router();

const USERS_PATH = "data/users.json";
const SCRIPT_PATH = "script/script.lua";

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

let analyticsDb = null;

function getAnalyticsDatabase() {
    if (!TURSO_DATABASE_URL) {
        throw new Error("TURSO_DATABASE_URL is not configured.");
    }

    if (!analyticsDb) {
        analyticsDb = createClient({
            url: TURSO_DATABASE_URL,
            authToken: TURSO_AUTH_TOKEN || undefined
        });
    }

    return analyticsDb;
}

function requireDashboardAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    return res.status(401).json({ error: "Authentication required." });
}

router.use(requireDashboardAuth);

function parseUsers(content) {
    const data = JSON.parse(content);
    if (!data || !Array.isArray(data.users)) {
        throw new Error("users.json must contain a users array.");
    }
    return data.users;
}

router.get("/users", async (req, res) => {
    try {
        const file = await getFile(USERS_PATH);
        const users = parseUsers(file.content);

        res.json({
            users,
            count: users.length
        });
    } catch (error) {
        console.error("[API] GET users:", error);
        res.status(500).json({ error: "Failed to read users.json." });
    }
});

router.post("/users", async (req, res) => {
    const username = String(req.body.username || "").trim();

    if (!username) {
        return res.status(400).json({ error: "Username is required." });
    }

    if (username.length > 32 || /[\r\n]/.test(username)) {
        return res.status(400).json({ error: "Invalid username." });
    }

    try {
        const file = await getFile(USERS_PATH);
        const users = parseUsers(file.content);

        const exists = users.some(
            user => String(user).toLowerCase() === username.toLowerCase()
        );

        if (exists) {
            return res.status(409).json({ error: "User is already authorized." });
        }

        users.push(username);

        const result = await updateFile(
            USERS_PATH,
            JSON.stringify({ users }, null, 2) + "\n",
            `auth: add ${username}`,
            file.sha
        );

        res.json({
            success: true,
            username,
            commit: result
        });
    } catch (error) {
        console.error("[API] POST users:", error);
        res.status(500).json({ error: "Failed to add user." });
    }
});

router.delete("/users/:username", async (req, res) => {
    const username = String(req.params.username || "").trim();

    try {
        const file = await getFile(USERS_PATH);
        const users = parseUsers(file.content);

        const nextUsers = users.filter(
            user => String(user).toLowerCase() !== username.toLowerCase()
        );

        if (nextUsers.length === users.length) {
            return res.status(404).json({ error: "User not found." });
        }

        const result = await updateFile(
            USERS_PATH,
            JSON.stringify({ users: nextUsers }, null, 2) + "\n",
            `auth: remove ${username}`,
            file.sha
        );

        res.json({
            success: true,
            username,
            commit: result
        });
    } catch (error) {
        console.error("[API] DELETE users:", error);
        res.status(500).json({ error: "Failed to remove user." });
    }
});

router.get("/script", async (req, res) => {
    try {
        const file = await getFile(SCRIPT_PATH);
        res.json({
            content: file.content,
            sha: file.sha
        });
    } catch (error) {
        console.error("[API] GET script:", error);
        res.status(500).json({ error: "Failed to read script.lua." });
    }
});

router.put("/script", async (req, res) => {
    const content = typeof req.body.content === "string" ? req.body.content : null;

    if (content === null) {
        return res.status(400).json({ error: "Script content is required." });
    }

    try {
        const file = await getFile(SCRIPT_PATH);

        if (content === file.content) {
            return res.json({
                success: true,
                changed: false,
                message: "No changes to commit."
            });
        }

        const result = await updateFile(
            SCRIPT_PATH,
            content,
            "script: update Roblox loader",
            file.sha
        );

        res.json({
            success: true,
            changed: true,
            commit: result
        });
    } catch (error) {
        console.error("[API] PUT script:", error);
        res.status(500).json({ error: "Failed to update script.lua." });
    }
});

router.get("/status", async (req, res) => {
    try {
        const commit = await getLatestCommit();

        let localUsers = 0;
        try {
            const local = JSON.parse(
                fs.readFileSync(path.join(__dirname, "../data/users.json"), "utf8")
            );
            localUsers = Array.isArray(local.users) ? local.users.length : 0;
        } catch {}

        res.json({
            commit,
            localUsers
        });
    } catch (error) {
        console.error("[API] GET status:", error);
        res.status(500).json({ error: "Failed to read GitHub status." });
    }
});

async function ensureAnalyticsTable() {
    const db = getAnalyticsDatabase();

    await db.execute(`
        CREATE TABLE IF NOT EXISTS execution_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            executor TEXT NOT NULL,
            device TEXT NOT NULL,
            executed_at INTEGER NOT NULL
        )
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_execution_events_username
        ON execution_events(username, executed_at DESC)
    `);

    await db.execute(`
        CREATE INDEX IF NOT EXISTS idx_execution_events_time
        ON execution_events(executed_at DESC)
    `);
}

router.get("/analytics", async (req, res) => {
    try {
        await ensureAnalyticsTable();

        const usersFile = await getFile(USERS_PATH);
        const authorizedUsers = parseUsers(usersFile.content);

        const result = await getAnalyticsDatabase().execute(`
            SELECT
                username,
                executor,
                device,
                executed_at
            FROM execution_events
            ORDER BY executed_at DESC
        `);

        const authorizedSet = new Set(
            authorizedUsers.map(username =>
                String(username).trim().toLowerCase()
            )
        );

        const executions = result.rows
            .filter(row =>
                authorizedSet.has(String(row.username).trim().toLowerCase())
            )
            .map(row => ({
                username: String(row.username),
                executor: String(row.executor),
                device: String(row.device),
                executedAt: Number(row.executed_at)
            }));

        const executorCounts = {};
        const deviceCounts = {};
        const userCounts = {};

        for (const execution of executions) {
            executorCounts[execution.executor] =
                (executorCounts[execution.executor] || 0) + 1;

            deviceCounts[execution.device] =
                (deviceCounts[execution.device] || 0) + 1;

            const key = execution.username.toLowerCase();

            userCounts[key] = (userCounts[key] || 0) + 1;
        }

        const users = authorizedUsers.map(username => ({
            username,
            executions: userCounts[String(username).toLowerCase()] || 0
        }));

        return res.json({
            totalExecutions: executions.length,
            executors: Object.entries(executorCounts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count),
            devices: Object.entries(deviceCounts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count),
            users
        });
    } catch (error) {
        console.error("[API] GET analytics:", error);

        return res.status(500).json({
            error: "Failed to load analytics."
        });
    }
});

router.get("/analytics/:username", async (req, res) => {
    try {
        await ensureAnalyticsTable();

        const requestedUsername = String(
            req.params.username || ""
        ).trim();

        const usersFile = await getFile(USERS_PATH);
        const authorizedUsers = parseUsers(usersFile.content);

        const authorizedUsername = authorizedUsers.find(
            username =>
                String(username).trim().toLowerCase() ===
                requestedUsername.toLowerCase()
        );

        if (!authorizedUsername) {
            return res.status(404).json({
                error: "Authorized user not found."
            });
        }

        const result = await getAnalyticsDatabase().execute({
            sql: `
                SELECT
                    executor,
                    device,
                    executed_at
                FROM execution_events
                WHERE LOWER(username) = LOWER(?)
                ORDER BY executed_at DESC
            `,
            args: [authorizedUsername]
        });

        return res.json({
            username: authorizedUsername,
            executions: result.rows.map(row => ({
                executor: String(row.executor),
                device: String(row.device),
                executedAt: Number(row.executed_at)
            }))
        });
    } catch (error) {
        console.error("[API] GET user analytics:", error);

        return res.status(500).json({
            error: "Failed to load user execution history."
        });
    }
});

module.exports = router;
