const express = require("express");
const { createClient } = require("@libsql/client");
const { getFile } = require("../github");

const router = express.Router();

const USERS_PATH = "data/users.json";
const POLL_LIMIT = 250;
const AUTH_CACHE_MS = 30_000;
const EVENT_RETENTION_MS = 24 * 60 * 60 * 1000;

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || "";
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

let db = null;
let initPromise = null;
let allowedCache = { expiresAt: 0, users: new Set() };

function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
}

function getDatabase() {
    if (!TURSO_DATABASE_URL) {
        throw new Error("TURSO_DATABASE_URL is not configured.");
    }

    if (!db) {
        db = createClient({
            url: TURSO_DATABASE_URL,
            authToken: TURSO_AUTH_TOKEN || undefined
        });
    }

    return db;
}

async function initDatabase() {
    if (!initPromise) {
        initPromise = (async () => {
            const client = getDatabase();

            await client.execute(`
                CREATE TABLE IF NOT EXISTS user_states (
                    username TEXT PRIMARY KEY,
                    score_effects TEXT NOT NULL DEFAULT '{}',
                    last_score_effect TEXT,
                    level TEXT,
                    nametag TEXT,
                    player_card TEXT,
                    jersey TEXT,
                    updated_at INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL
                )
            `);

            await client.execute(`
                CREATE TABLE IF NOT EXISTS sync_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    type TEXT NOT NULL,
                    value TEXT,
                    created_at INTEGER NOT NULL
                )
            `);

            await client.execute(`
                CREATE INDEX IF NOT EXISTS idx_sync_events_created
                ON sync_events(created_at, id)
            `);

            await client.execute(`
                CREATE INDEX IF NOT EXISTS idx_sync_events_username
                ON sync_events(username, id)
            `);
        })().catch(error => {
            initPromise = null;
            throw error;
        });
    }

    return initPromise;
}

async function getAuthorizedUsers() {
    const now = Date.now();
    if (allowedCache.expiresAt > now) {
        return allowedCache.users;
    }

    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content);
    const users = Array.isArray(data.users) ? data.users : [];
    const normalized = new Set(users.map(normalizeUsername).filter(Boolean));

    allowedCache = {
        expiresAt: now + AUTH_CACHE_MS,
        users: normalized
    };

    return normalized;
}

async function requireAuthorized(req, res, next) {
    try {
        const username = normalizeUsername(
            req.body?.username || req.query?.username
        );

        if (!username) {
            return res.status(400).json({ error: "Username is required." });
        }

        const users = await getAuthorizedUsers();
        if (!users.has(username)) {
            return res.status(403).json({ error: "User is not authorized." });
        }

        req.syncUsername = username;
        return next();
    } catch (error) {
        console.error("[Sync] Authorization check failed:", error);
        return res.status(503).json({
            error: "Synchronization service unavailable."
        });
    }
}

function sanitizeEffects(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    const output = {};
    for (const [name, weight] of Object.entries(value)) {
        const numeric = Number(weight);
        if (
            typeof name === "string" &&
            name.length > 0 &&
            name.length <= 100 &&
            Number.isFinite(numeric) &&
            numeric >= 0
        ) {
            output[name] = numeric;
        }
    }

    return output;
}

function sanitizeString(value, maxLength = 100) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const text = String(value);
    if (text.length > maxLength) {
        throw new Error("Value is too long.");
    }

    return text;
}

function sanitizeUpdate(type, value) {
    if (type === "scoreEffects") {
        return sanitizeEffects(value);
    }

    if (
        type === "level" ||
        type === "nametag" ||
        type === "playerCard" ||
        type === "jersey"
    ) {
        return sanitizeString(value);
    }

    if (type === "scoreEffect") {
        const text = sanitizeString(value);
        if (!text) {
            throw new Error("Invalid score effect.");
        }
        return text;
    }

    throw new Error("Unsupported sync type.");
}

function decodeState(row) {
    let scoreEffects = {};
    try {
        scoreEffects = JSON.parse(row.score_effects || "{}");
    } catch {
        scoreEffects = {};
    }

    return {
        username: row.username,
        scoreEffects: sanitizeEffects(scoreEffects),
        scoreEffect: row.last_score_effect || null,
        level: row.level || null,
        nametag: row.nametag || null,
        playerCard: row.player_card || null,
        jersey: row.jersey || null,
        updatedAt: row.updated_at,
        lastSeen: row.last_seen
    };
}

function encodeEvent(row) {
    let value = row.value;
    if (row.type === "scoreEffects") {
        try {
            value = JSON.parse(value || "{}");
        } catch {
            value = {};
        }
    }

    return {
        id: String(row.id),
        username: row.username,
        type: row.type,
        value,
        createdAt: row.created_at
    };
}

async function cleanupOldEvents() {
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    try {
        await getDatabase().execute({
            sql: "DELETE FROM sync_events WHERE created_at < ?",
            args: [cutoff]
        });
    } catch (error) {
        console.warn("[Sync] Event cleanup failed:", error.message);
    }
}

router.get("/state", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();
        const authorizedUsers = await getAuthorizedUsers();
        const result = await getDatabase().execute(`
            SELECT username, score_effects, last_score_effect,
                   level, nametag, player_card, jersey,
                   updated_at, last_seen
            FROM user_states
        `);

        const states = result.rows
            .filter(row => authorizedUsers.has(normalizeUsername(row.username)))
            .map(decodeState);

        const cursorResult = await getDatabase().execute(`
            SELECT id FROM sync_events ORDER BY id DESC LIMIT 1
        `);

        const cursor = cursorResult.rows.length
            ? String(cursorResult.rows[0].id)
            : null;

        return res.json({ states, cursor });
    } catch (error) {
        console.error("[Sync] GET state:", error);
        return res.status(503).json({
            error: "Synchronization service unavailable."
        });
    }
});

router.get("/changes", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();
        const authorizedUsers = await getAuthorizedUsers();
        const after = Number.parseInt(String(req.query.after || "0"), 10) || 0;

        const result = await getDatabase().execute({
            sql: `
                SELECT id, username, type, value, created_at
                FROM sync_events
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?
            `,
            args: [after, POLL_LIMIT]
        });

        const events = result.rows
            .filter(row => authorizedUsers.has(normalizeUsername(row.username)))
            .map(encodeEvent);

        const newestId = result.rows.length
            ? String(result.rows[result.rows.length - 1].id)
            : String(after);

        return res.json({ events, cursor: newestId });
    } catch (error) {
        console.error("[Sync] GET changes:", error);
        return res.status(503).json({
            error: "Synchronization service unavailable."
        });
    }
});

router.post("/update", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();

        const type = String(req.body?.type || "").trim();
        const value = sanitizeUpdate(type, req.body?.value);
        const username = req.syncUsername;
        const now = Date.now();
        const client = getDatabase();

        const stateResult = await client.execute({
            sql: `
                SELECT score_effects, last_score_effect, level,
                       nametag, player_card, jersey
                FROM user_states
                WHERE username = ?
                LIMIT 1
            `,
            args: [username]
        });

        let scoreEffects = {};
        let lastScoreEffect = null;
        let level = null;
        let nametag = null;
        let playerCard = null;
        let jersey = null;

        if (stateResult.rows.length) {
            const row = stateResult.rows[0];
            try {
                scoreEffects = JSON.parse(row.score_effects || "{}");
            } catch {}
            lastScoreEffect = row.last_score_effect || null;
            level = row.level || null;
            nametag = row.nametag || null;
            playerCard = row.player_card || null;
            jersey = row.jersey || null;
        }

        scoreEffects = sanitizeEffects(scoreEffects);

        if (type === "scoreEffects") {
            scoreEffects = value;
        } else if (type === "scoreEffect") {
            lastScoreEffect = value;
        } else if (type === "level") {
            level = value;
        } else if (type === "nametag") {
            nametag = value;
        } else if (type === "playerCard") {
            playerCard = value;
        } else if (type === "jersey") {
            jersey = value;
        }

        await client.execute({
            sql: `
                INSERT INTO user_states (
                    username, score_effects, last_score_effect,
                    level, nametag, player_card, jersey,
                    updated_at, last_seen
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                    score_effects = excluded.score_effects,
                    last_score_effect = excluded.last_score_effect,
                    level = excluded.level,
                    nametag = excluded.nametag,
                    player_card = excluded.player_card,
                    jersey = excluded.jersey,
                    updated_at = excluded.updated_at,
                    last_seen = excluded.last_seen
            `,
            args: [
                username,
                JSON.stringify(scoreEffects),
                lastScoreEffect,
                level,
                nametag,
                playerCard,
                jersey,
                now,
                now
            ]
        });

        await client.execute({
            sql: `
                INSERT INTO sync_events (username, type, value, created_at)
                VALUES (?, ?, ?, ?)
            `,
            args: [
                username,
                type,
                type === "scoreEffects" ? JSON.stringify(value) : value,
                now
            ]
        });

        if (Math.random() < 0.03) {
            void cleanupOldEvents();
        }

        return res.json({ success: true });
    } catch (error) {
        console.error("[Sync] POST update:", error);
        return res.status(400).json({
            error: error.message || "Failed to synchronize update."
        });
    }
});

router.post("/heartbeat", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();
        const now = Date.now();

        await getDatabase().execute({
            sql: `
                INSERT INTO user_states (
                    username, score_effects, updated_at, last_seen
                ) VALUES (?, '{}', ?, ?)
                ON CONFLICT(username) DO UPDATE SET
                    last_seen = excluded.last_seen
            `,
            args: [req.syncUsername, now, now]
        });

        return res.json({ success: true });
    } catch (error) {
        console.error("[Sync] POST heartbeat:", error);
        return res.status(503).json({
            error: "Synchronization service unavailable."
        });
    }
});

module.exports = router;
