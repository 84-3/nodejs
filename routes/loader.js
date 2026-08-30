const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const SCRIPT_PATH = path.join(__dirname, "../script/script.lua");

router.get("/loader", (req, res) => {
    try {
        const script = fs.readFileSync(SCRIPT_PATH, "utf8");

        res.type("text/plain; charset=utf-8");
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
        res.send(script);
    } catch (error) {
        console.error("[Loader] Failed to read script:", error);
        res.status(500).type("text/plain").send("-- Failed to load script.");
    }
});

router.get("/authorize", (req, res) => {
    const requestedUsername = String(req.query.username || "").trim().toLowerCase();

    if (!requestedUsername) {
        return res.status(400).json({
            authorized: false,
            error: "Missing username."
        });
    }

    try {
        const usersPath = path.join(__dirname, "../data/users.json");
        const data = JSON.parse(fs.readFileSync(usersPath, "utf8"));
        const users = Array.isArray(data.users) ? data.users : [];

        const authorized = users.some(
            username => String(username).trim().toLowerCase() === requestedUsername
        );

        return res.json({ authorized });
    } catch (error) {
        console.error("[Authorize] Failed to read users:", error);
        return res.status(500).json({
            authorized: false,
            error: "Authorization service unavailable."
        });
    }
});

module.exports = router;
