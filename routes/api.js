const express = require("express");
const { createClient } = require("@libsql/client");

const {
    getFile,
    updateFile,
    updateFileSafely,
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

router.get("/healthcheck", (req, res) => {
    return res.status(200).json({
        status: "ok",
        service: "SFXDarei Manager",
        timestamp: new Date().toISOString()
    });
});

router.use(requireDashboardAuth);

function parseUsers(content) {
    const data = JSON.parse(content);
    if (!data || !Array.isArray(data.users)) {
        throw new Error("users.json must contain a users array.");
    }
    return data.users;
}


router.post("/users", async (req, res) => {
    const username = String(req.body?.username || "").trim();

    if (!username) {
        return res.status(400).json({ error: "Username is required." });
    }

    if (username.length > 32 || /[\r\n]/.test(username)) {
        return res.status(400).json({ error: "Invalid username." });
    }

    let alreadyExists = false;

    try {
        const result = await updateFileSafely(
            USERS_PATH,
            `auth: add ${username}`,
            content => {
                const users = parseUsers(content);
                alreadyExists = users.some(
                    user =>
                        String(user).trim().toLowerCase() ===
                        username.toLowerCase()
                );
                if (alreadyExists) return null;
                users.push(username);
                return JSON.stringify({ users }, null, 2) + "\n";
            },
            content =>
                parseUsers(content).some(
                    user =>
                        String(user).trim().toLowerCase() ===
                        username.toLowerCase()
                )
        );
        if (!result.changed) {
            return res.status(409).json({
                error: alreadyExists
                    ? "User is already authorized."
                    : "No changes were made."
            });
        }
        return res.json({
            success: true,
            username,
            commit: result.commit,
            commitVerified: Boolean(result.commit?.commitSha),
            warning: result.commit
                ? null
                : "The user list was saved, but the latest commit could not yet be verified."
        });
    } catch (error) {
        console.error("[API] POST users:", error);
        return res.status(500).json({
            error: error.message || "Failed to add user. Check GitHub before retrying."
        });
    }
});


router.delete("/users/:username", async (req, res) => {
    const username = String(req.params.username || "").trim();

    if (!username) {
        return res.status(400).json({ error: "Username is required." });
    }

    let userWasFound = false;

    try {
        const result = await updateFileSafely(
            USERS_PATH,
            `auth: remove ${username}`,
            content => {
                const users = parseUsers(content);

                userWasFound = users.some(
                    user =>
                        String(user).trim().toLowerCase() ===
                        username.toLowerCase()
                );

                if (!userWasFound) return null;

                const nextUsers = users.filter(
                    user =>
                        String(user).trim().toLowerCase() !==
                        username.toLowerCase()
                );

                return JSON.stringify({ users: nextUsers }, null, 2) + "\n";
            },
            content =>
                !parseUsers(content).some(
                    user =>
                        String(user).trim().toLowerCase() ===
                        username.toLowerCase()
                )
        );

        if (!result.changed) {
            return res.status(404).json({
                error: userWasFound
                    ? "No changes were made."
                    : "User not found."
            });
        }

        return res.json({
            success: true,
            username,
            commit: result.commit,
            commitVerified: Boolean(result.commit?.commitSha),
            warning: result.commit
                ? null
                : "The user list was saved, but the latest commit could not yet be verified."
        });
    } catch (error) {
        console.error("[API] DELETE users:", error);

        return res.status(500).json({
            error: error.message || "Failed to remove user. Check GitHub before retrying."
        });
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
    const content = typeof req.body?.content === "string"
        ? req.body.content
        : null;

    if (content === null) {
        return res.status(400).json({
            error: "Script content is required."
        });
    }

    try {
        const result = await updateFileSafely(
            SCRIPT_PATH,
            "script: update Roblox loader",
            currentContent =>
                content === currentContent ? null : content,
            currentContent => currentContent === content
        );

        if (!result.changed) {
            return res.json({
                success: true,
                changed: false,
                message: "No changes to commit."
            });
        }

        return res.json({
            success: true,
            changed: true,
            commit: result.commit,
            commitVerified: Boolean(result.commit?.commitSha),
            warning: result.commit
                ? null
                : "The script was saved, but the latest commit could not yet be verified."
        });
    } catch (error) {
        console.error("[API] PUT script:", error);

        return res.status(500).json({
            error: error.message || "Failed to update script.lua. Check GitHub before retrying."
        });
    }
});


router.get("/status", async (req, res) => {
    const [commitResult, usersResult] = await Promise.allSettled([
        getLatestCommit(),
        getFile(USERS_PATH)
    ]);

    let commit = null;
    let localUsers = null;
    const warnings = [];

    if (commitResult.status === "fulfilled") {
        commit = commitResult.value;
    } else {
        console.error(
            "[API] GET status — latest commit:",
            commitResult.reason
        );
        warnings.push("Latest commit is temporarily unavailable.");
    }

    if (usersResult.status === "fulfilled") {
        try {
            localUsers = parseUsers(usersResult.value.content).length;
        } catch (error) {
            console.error("[API] GET status — users:", error);
            warnings.push("Authorized-user count is unavailable.");
        }
    } else {
        console.error(
            "[API] GET status — users:",
            usersResult.reason
        );
        warnings.push("Authorized-user count is unavailable.");
    }

    return res.json({
        commit,
        localUsers,
        warnings
    });
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

        const rows = Array.isArray(result.rows) ? result.rows : [];
        
        const executions = rows
            .filter(row =>
                authorizedSet.has(String(row.username ?? "").trim().toLowerCase())
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
