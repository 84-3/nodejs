const express = require("express");
const fs = require("fs");
const path = require("path");
const { MongoClient, ObjectId } = require("mongodb");

const { getFile } = require("../github");

const router = express.Router();

const USERS_PATH = "data/users.json";
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB = process.env.MONGODB_DB || "sfxdarei";
const POLL_LIMIT = 250;
const AUTH_CACHE_MS = 30_000;

let clientPromise = null;
let collectionsPromise = null;
let allowedCache = { expiresAt: 0, users: new Set() };

function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
}

async function getCollections() {
    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI is not configured.");
    }

    if (!clientPromise) {
        const client = new MongoClient(MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 0,
            serverSelectionTimeoutMS: 5000
        });
        clientPromise = client.connect();
    }

    if (!collectionsPromise) {
        collectionsPromise = clientPromise.then(async client => {
            const db = client.db(MONGODB_DB);
            const states = db.collection("userStates");
            const events = db.collection("syncEvents");

            await Promise.all([
                states.createIndex({ username: 1 }, { unique: true }),
                events.createIndex({ _id: 1 }),
                events.createIndex({ username: 1, _id: 1 }),
                events.createIndex({ createdAt: 1 }),
                events.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 })
            ]);

            return { states, events };
        });
    }

    return collectionsPromise;
}

async function getAuthorizedUsers() {
    const now = Date.now();
    if (allowedCache.expiresAt > now) {
        return allowedCache.users;
    }

    const file = await getFile(USERS_PATH);
    const data = JSON.parse(file.content);
    const users = Array.isArray(data.users) ? data.users : [];
    const normalized = new Set(
        users.map(normalizeUsername).filter(Boolean)
    );

    allowedCache = {
        expiresAt: now + AUTH_CACHE_MS,
        users: normalized
    };

    return normalized;
}

async function requireAuthorized(req, res, next) {
    try {
        const username = normalizeUsername(req.body?.username || req.query?.username);
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
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
}

function sanitizeConfig(config) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
        return {};
    }

    const out = {};

    if (config.scoreEffects && typeof config.scoreEffects === "object" && !Array.isArray(config.scoreEffects)) {
        const effects = {};
        for (const [name, weight] of Object.entries(config.scoreEffects)) {
            const numeric = Number(weight);
            if (typeof name === "string" && name.length <= 100 && Number.isFinite(numeric) && numeric >= 0) {
                effects[name] = numeric;
            }
        }
        out.scoreEffects = effects;
    }

    for (const field of ["level", "nametag", "playerCard", "jersey"]) {
        const value = config[field];
        if (value === null || value === undefined || value === "") {
            out[field] = null;
        } else {
            const text = String(value);
            if (text.length <= 100) out[field] = text;
        }
    }

    return out;
}

function sanitizeUpdate(type, value) {
    if (type === "scoreEffects") {
        return sanitizeConfig({ scoreEffects: value }).scoreEffects || {};
    }

    if (["level", "nametag", "playerCard", "jersey"].includes(type)) {
        if (value === null || value === undefined || value === "") return null;
        const text = String(value);
        if (text.length > 100) throw new Error(`${type} is too long.`);
        return text;
    }

    if (type === "scoreEffect") {
        const text = String(value || "");
        if (!text || text.length > 100) throw new Error("Invalid score effect.");
        return text;
    }

    throw new Error("Unsupported sync type.");
}

function eventResponse(event) {
    return {
        id: String(event._id),
        username: event.username,
        type: event.type,
        value: event.value,
        createdAt: event.createdAt
    };
}

router.get("/state", requireAuthorized, async (req, res) => {
    try {
        const { states, events } = await getCollections();
        const docs = await states
            .find({})
            .project({ _id: 0, username: 1, scoreEffects: 1, level: 1, nametag: 1, playerCard: 1, jersey: 1 })
            .toArray();

        const latest = await events.find({}).sort({ _id: -1 }).limit(1).next();

        return res.json({
            states,
            cursor: latest ? String(latest._id) : null
        });
    } catch (error) {
        console.error("[Sync] GET state:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
});

router.get("/changes", requireAuthorized, async (req, res) => {
    try {
        const { events } = await getCollections();
        const after = String(req.query.after || "").trim();

        let filter = {};
        if (after && ObjectId.isValid(after)) {
            filter = { _id: { $gt: new ObjectId(after) } };
        }

        const docs = await events
            .find(filter)
            .sort({ _id: 1 })
            .limit(POLL_LIMIT)
            .toArray();

        return res.json({
            events: docs.map(eventResponse),
            cursor: docs.length ? String(docs[docs.length - 1]._id) : after || null
        });
    } catch (error) {
        console.error("[Sync] GET changes:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
});

router.post("/update", requireAuthorized, async (req, res) => {
    try {
        const type = String(req.body?.type || "").trim();
        const value = sanitizeUpdate(type, req.body?.value);
        const { states, events } = await getCollections();

        const now = new Date();
        const update = {
            $set: {
                username: req.syncUsername,
                updatedAt: now
            }
        };

        if (type !== "scoreEffect") {
            update.$set[type] = value;
            await states.updateOne(
                { username: req.syncUsername },
                update,
                { upsert: true }
            );
        }

        const event = {
            username: req.syncUsername,
            type,
            value,
            createdAt: now
        };

        const result = await events.insertOne(event);

        return res.json({
            success: true,
            event: eventResponse({ ...event, _id: result.insertedId })
        });
    } catch (error) {
        console.error("[Sync] POST update:", error);
        return res.status(400).json({ error: error.message || "Failed to synchronize update." });
    }
});

router.post("/heartbeat", requireAuthorized, async (req, res) => {
    try {
        const { states } = await getCollections();
        await states.updateOne(
            { username: req.syncUsername },
            { $set: { username: req.syncUsername, lastSeen: new Date() } },
            { upsert: true }
        );
        return res.json({ success: true });
    } catch (error) {
        console.error("[Sync] POST heartbeat:", error);
        return res.status(503).json({ error: "Synchronization service unavailable." });
    }
});

module.exports = router;
