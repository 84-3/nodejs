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

function validateTursoConfiguration() {
    const rawUrl = String(TURSO_DATABASE_URL).trim();
    const authToken = String(TURSO_AUTH_TOKEN).trim();

    if (!rawUrl) throw new Error("TURSO_DATABASE_URL is not configured.");
    if (!authToken) throw new Error("TURSO_AUTH_TOKEN is not configured.");

    if (
        /vercel\.app/i.test(rawUrl) ||
        /\/(v2\/pipeline|sync(?:\/|$)|state$|changes$|update$|heartbeat$)/i.test(rawUrl)
    ) {
        throw new Error(
            "TURSO_DATABASE_URL points to an app/API endpoint. Use the raw Turso database URL (for example, libsql://<database>-<organization>.turso.io), without /sync or /v2/pipeline."
        );
    }

    let parsedUrl;
    try {
        const parseableUrl = /^libsql:\/\//i.test(rawUrl)
            ? "https://" + rawUrl.slice("libsql://".length)
            : rawUrl;
        parsedUrl = new URL(parseableUrl);
    } catch {
        throw new Error(
            "TURSO_DATABASE_URL is malformed. Use the URL returned by `turso db show <database> --url`."
        );
    }

    if (!["https:", "http:"].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
        throw new Error("TURSO_DATABASE_URL must use libsql:// or a valid HTTP(S) database URL.");
    }
    if (parsedUrl.pathname && parsedUrl.pathname !== "/") {
        throw new Error("TURSO_DATABASE_URL must not include a path such as /v2/pipeline or /sync.");
    }
    if (parsedUrl.search || parsedUrl.hash) {
        throw new Error("TURSO_DATABASE_URL must not include a query string or fragment.");
    }

    return { url: rawUrl.replace(/\/+$/, ""), authToken };
}

function getDatabase() {
    if (!db) {
        const config = validateTursoConfiguration();
        db = createClient({ url: config.url, authToken: config.authToken });
    }
    return db;
}

async function verifyDatabaseConnection(client) {
    try {
        await client.execute("SELECT 1 AS turso_connection_ok");
    } catch (error) {
        const message = String(error?.message || error);
        if (/invalid Hrana response/i.test(message)) {
            throw new Error(
                "Turso returned an invalid Hrana response. Verify TURSO_DATABASE_URL is the raw database URL (not the Vercel app URL or /v2/pipeline) and TURSO_AUTH_TOKEN belongs to that database. Original error: " + message
            );
        }
        throw new Error("Turso database connection check failed: " + message);
    }
}

async function initDatabase() {
    if (!initPromise) {
        initPromise = (async () => {
            const client = getDatabase();
            await verifyDatabaseConnection(client);

            await client.execute(`
                CREATE TABLE IF NOT EXISTS user_states (
                    username TEXT PRIMARY KEY,
                    score_effects TEXT NOT NULL DEFAULT '{}',
                    next_score_effect TEXT,
                    level TEXT,
                    nametag TEXT,
                    player_card TEXT,
                    player_cards TEXT NOT NULL DEFAULT '{}',
                    jersey TEXT,
                    updated_at INTEGER NOT NULL,
                    last_seen INTEGER NOT NULL
                )
            `);

            try {
                await client.execute(`ALTER TABLE user_states ADD COLUMN next_score_effect TEXT`);
            } catch (error) {
                if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
            }

            try {
                await client.execute(`ALTER TABLE user_states ADD COLUMN player_cards TEXT NOT NULL DEFAULT '{}'`);
            } catch (error) {
                if (!/duplicate column|already exists/i.test(String(error?.message || error))) throw error;
            }

            await client.execute(`
                CREATE TABLE IF NOT EXISTS sync_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    type TEXT NOT NULL,
                    value TEXT,
                    created_at INTEGER NOT NULL
                )
            `);
            await client.execute(`CREATE INDEX IF NOT EXISTS idx_sync_events_created ON sync_events(created_at, id)`);
            await client.execute(`CREATE INDEX IF NOT EXISTS idx_sync_events_username ON sync_events(username, id)`);

            await client.execute(`
                CREATE TABLE IF NOT EXISTS execution_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL,
                    executor TEXT NOT NULL,
                    device TEXT NOT NULL,
                    executed_at INTEGER NOT NULL
                )
            `);
            await client.execute(`CREATE INDEX IF NOT EXISTS idx_execution_events_username ON execution_events(username, executed_at DESC)`);
            await client.execute(`CREATE INDEX IF NOT EXISTS idx_execution_events_time ON execution_events(executed_at DESC)`);
        })().catch(error => {
            initPromise = null;
            throw error;
        });
    }
    return initPromise;
}

async function getAuthorizedUsers() {
    const now = Date.now();
    if (allowedCache.expiresAt > now) return allowedCache.users;

    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content);
    const users = Array.isArray(data.users) ? data.users : [];
    const normalized = new Set(users.map(normalizeUsername).filter(Boolean));
    allowedCache = { expiresAt: now + AUTH_CACHE_MS, users: normalized };
    return normalized;
}

async function requireAuthorized(req, res, next) {
    try {
        const username = normalizeUsername(req.body?.username || req.query?.username);
        if (!username) return res.status(400).json({ error: "Username is required." });

        const users = await getAuthorizedUsers();
        if (!users.has(username)) return res.status(403).json({ error: "User is not authorized." });

        req.syncUsername = username;
        return next();
    } catch (error) {
        console.error("[Sync] Authorization check failed:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
}

function isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeEffects(value) {
    if (!isPlainObject(value)) return {};
    const output = {};
    for (const [name, weight] of Object.entries(value)) {
        const numeric = Number(weight);
        if (name.length > 0 && name.length <= 100 && Number.isFinite(numeric) && numeric >= 0) {
            output[name] = numeric;
        }
    }
    return output;
}

function sanitizeCardName(value) {
    if (typeof value !== "string") return null;
    const name = value.trim();
    return !name || name.length > 100 || /[\r\n]/.test(name) ? null : name;
}

function sanitizeRankedCardMetadata(value) {
    if (!isPlainObject(value)) return null;
    const rawRank = Number(value.seasonRank ?? value.SeasonRank);
    const allowedRanks = new Set([13, 14, 15, 16, 17]);
    const seasonRank = Number.isFinite(rawRank) && allowedRanks.has(Math.floor(rawRank))
        ? Math.floor(rawRank)
        : 13;
    const normalizeCount = raw => {
        const numeric = Number(raw);
        return Number.isFinite(numeric) ? Math.floor(Math.max(0, Math.min(2147483647, numeric))) : 0;
    };
    return {
        seasonRank,
        wins: normalizeCount(value.wins ?? value.Wins),
        losses: normalizeCount(value.losses ?? value.Losses)
    };
}

function sanitizePlayerCards(value) {
    let source = value;
    for (let attempt = 0; attempt < 2 && typeof source === "string"; attempt += 1) {
        try { source = JSON.parse(source); } catch { return {}; }
    }
    if (!isPlainObject(source)) return {};

    const cardSource = isPlainObject(source.cards)
        ? source.cards
        : (isPlainObject(source.values) ? source.values : source);
    const output = {};
    for (const [name, priority] of Object.entries(cardSource)) {
        if (["__sfxdarei", "cards", "values"].includes(name)) continue;
        const safeName = sanitizeCardName(name);
        const numeric = Number(priority);
        if (safeName && Number.isFinite(numeric) && numeric >= 0) output[safeName] = numeric;
    }

    const metadata = isPlainObject(source.__sfxdarei)
        ? source.__sfxdarei
        : (isPlainObject(source.metadata) ? source.metadata : null);
    if (metadata) {
        const ranked = sanitizeRankedCardMetadata(metadata.rankedPlayerCard ?? metadata.ranked_player_card);
        output.__sfxdarei = {
            version: 2,
            enabled: metadata.enabled === true,
            current: sanitizeCardName(metadata.current),
            ...(ranked ? { rankedPlayerCard: ranked } : {})
        };
    }
    return output;
}

function sanitizeString(value, maxLength = 100) {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value);
    if (text.length > maxLength) throw new Error("Value is too long.");
    return text;
}

function sanitizeUpdate(type, value) {
    if (type === "scoreEffects") return sanitizeEffects(value);
    if (type === "playerCards") return sanitizePlayerCards(value);
    if (type === "scoreEffect") return sanitizeString(value);

    if (["level", "nametag", "playerCard", "jersey", "nextScoreEffect"].includes(type)) {
        const text = sanitizeString(value);
        if (type === "nextScoreEffect" && !text) throw new Error("Invalid next score effect.");
        return text;
    }
    throw new Error("Unsupported sync type.");
}

function decodeState(row) {
    let scoreEffects = {};
    let playerCards = {};
    try { scoreEffects = JSON.parse(row.score_effects || "{}"); } catch { scoreEffects = {}; }
    try { playerCards = JSON.parse(row.player_cards || "{}"); } catch { playerCards = {}; }

    if (Object.keys(playerCards).length === 0 && typeof row.player_card === "string" && row.player_card !== "") {
        playerCards[row.player_card] = 100;
    }

    return {
        username: row.username,
        scoreEffects: sanitizeEffects(scoreEffects),
        nextScoreEffect: row.next_score_effect || null,
        level: row.level || null,
        nametag: row.nametag || null,
        playerCard: row.player_card || null,
        playerCards: sanitizePlayerCards(playerCards),
        jersey: row.jersey || null,
        updatedAt: row.updated_at,
        lastSeen: row.last_seen
    };
}

function encodeEvent(row) {
    let value = row.value;
    if (["scoreEffects", "playerCards"].includes(row.type)) {
        try { value = JSON.parse(value || "{}"); } catch { value = {}; }
    }
    return { id: String(row.id), username: row.username, type: row.type, value, createdAt: row.created_at };
}

async function cleanupOldEvents() {
    const cutoff = Date.now() - EVENT_RETENTION_MS;
    try {
        await getDatabase().execute({
            sql: `DELETE FROM sync_events WHERE created_at < ?`,
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
            SELECT username, score_effects, next_score_effect, level, nametag,
                   player_card, player_cards, jersey, updated_at, last_seen
            FROM user_states
        `);
        const states = result.rows
            .filter(row => authorizedUsers.has(normalizeUsername(row.username)))
            .map(decodeState);
        const cursorResult = await getDatabase().execute(`SELECT id FROM sync_events ORDER BY id DESC LIMIT 1`);
        const cursor = cursorResult.rows.length ? String(cursorResult.rows[0].id) : null;
        return res.json({ states, cursor });
    } catch (error) {
        console.error("[Sync] GET state:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
});

router.get("/changes", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();
        const authorizedUsers = await getAuthorizedUsers();
        const after = Number.parseInt(String(req.query.after || "0"), 10) || 0;
        const result = await getDatabase().execute({
            sql: `SELECT id, username, type, value, created_at
                  FROM sync_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
            args: [after, POLL_LIMIT]
        });
        const events = result.rows
            .filter(row => authorizedUsers.has(normalizeUsername(row.username)))
            .map(encodeEvent);
        const cursor = result.rows.length ? String(result.rows[result.rows.length - 1].id) : String(after);
        return res.json({ events, cursor });
    } catch (error) {
        console.error("[Sync] GET changes:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
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
            sql: `SELECT score_effects, next_score_effect, level, nametag,
                         player_card, player_cards, jersey
                  FROM user_states WHERE username = ? LIMIT 1`,
            args: [username]
        });

        let scoreEffects = {};
        let nextScoreEffect = null;
        let level = null;
        let nametag = null;
        let playerCard = null;
        let playerCards = {};
        let jersey = null;

        if (stateResult.rows.length) {
            const row = stateResult.rows[0];
            try { scoreEffects = JSON.parse(row.score_effects || "{}"); } catch { scoreEffects = {}; }
            nextScoreEffect = row.next_score_effect || null;
            level = row.level || null;
            nametag = row.nametag || null;
            playerCard = row.player_card || null;
            try { playerCards = JSON.parse(row.player_cards || "{}"); } catch { playerCards = {}; }
            playerCards = sanitizePlayerCards(playerCards);
            if (Object.keys(playerCards).length === 0 && typeof playerCard === "string" && playerCard !== "") {
                playerCards[playerCard] = 100;
            }
            jersey = row.jersey || null;
        }
        scoreEffects = sanitizeEffects(scoreEffects);

        if (type === "scoreEffects") {
            scoreEffects = value;
        } else if (type === "nextScoreEffect") {
            nextScoreEffect = value;
        } else if (type === "level") {
            level = value;
        } else if (type === "nametag") {
            nametag = value;
        } else if (type === "playerCard") {
            playerCard = value;
            if (Object.keys(playerCards).length === 0) playerCards = value ? { [value]: 100 } : {};
        } else if (type === "playerCards") {
            playerCards = value;
            const cardEntries = Object.entries(value).filter(([name, priority]) =>
                name !== "__sfxdarei" && typeof priority === "number" && Number.isFinite(priority) && priority >= 0
            );
            const metadata = isPlainObject(value.__sfxdarei) ? value.__sfxdarei : null;
            const declaredCurrent = sanitizeCardName(metadata?.current);
            playerCard = declaredCurrent && cardEntries.some(([name]) => name === declaredCurrent)
                ? declaredCurrent
                : (cardEntries.length > 0 ? cardEntries[0][0] : null);
        } else if (type === "jersey") {
            jersey = value;
        }

        await client.execute({
            sql: `INSERT INTO user_states (
                    username, score_effects, next_score_effect, level, nametag,
                    player_card, player_cards, jersey, updated_at, last_seen
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(username) DO UPDATE SET
                    score_effects = excluded.score_effects,
                    next_score_effect = excluded.next_score_effect,
                    level = excluded.level,
                    nametag = excluded.nametag,
                    player_card = excluded.player_card,
                    player_cards = excluded.player_cards,
                    jersey = excluded.jersey,
                    updated_at = excluded.updated_at,
                    last_seen = excluded.last_seen`,
            args: [username, JSON.stringify(scoreEffects), nextScoreEffect, level, nametag,
                playerCard, JSON.stringify(playerCards), jersey, now, now]
        });

        await client.execute({
            sql: `INSERT INTO sync_events (username, type, value, created_at) VALUES (?, ?, ?, ?)`,
            args: [username, type, ["scoreEffects", "playerCards"].includes(type) ? JSON.stringify(value) : value, now]
        });

        if (Math.random() < 0.03) void cleanupOldEvents();
        return res.json({ success: true });
    } catch (error) {
        console.error("[Sync] POST update:", error);
        return res.status(400).json({ error: error.message || "Failed to synchronize update." });
    }
});

router.post("/heartbeat", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();
        const now = Date.now();
        await getDatabase().execute({
            sql: `INSERT INTO user_states (username, score_effects, next_score_effect, updated_at, last_seen)
                  VALUES (?, '{}', NULL, ?, ?)
                  ON CONFLICT(username) DO UPDATE SET last_seen = excluded.last_seen`,
            args: [req.syncUsername, now, now]
        });
        return res.json({ success: true });
    } catch (error) {
        console.error("[Sync] POST heartbeat:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
});

router.post("/execution", requireAuthorized, async (req, res) => {
    try {
        await initDatabase();
        const executor = sanitizeString(req.body?.executor, 100);
        const device = sanitizeString(req.body?.device, 50);
        if (!executor || !device) {
            return res.status(400).json({ error: "Executor and device are required." });
        }
        await getDatabase().execute({
            sql: `INSERT INTO execution_events (username, executor, device, executed_at) VALUES (?, ?, ?, ?)`,
            args: [req.syncUsername, executor, device, Date.now()]
        });
        return res.json({ success: true });
    } catch (error) {
        console.error("[Sync] POST execution:", error);
        return res.status(503).json({ error: "Failed to record execution." });
    }
});

module.exports = router;
