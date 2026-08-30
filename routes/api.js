const express = require("express");
const fs = require("fs");
const path = require("path");

const {
    getFile,
    updateFile,
    getLatestCommit
} = require("../github");

const router = express.Router();

const USERS_PATH = "data/users.json";
const SCRIPT_PATH = "script/script.lua";

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

    if (content.length > 1000000) {
        return res.status(413).json({ error: "Script is too large." });
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

module.exports = router;
