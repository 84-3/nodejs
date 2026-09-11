const express = require("express");

const { getFile } = require("../github");

const router = express.Router();

router.get("/loader", async (req, res) => {
    try {
        const file = await getFile("script/script.lua");

        res.set("Content-Type", "text/plain; charset=utf-8");
        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate"
        );
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");

        return res.status(200).send(file.content);
    } catch (error) {
        console.error("[Loader] Failed to fetch script:", error);

        return res
            .status(500)
            .set("Content-Type", "text/plain; charset=utf-8")
            .send("-- Failed to load script.");
    }
});

router.get("/authorize", async (req, res) => {
    const requestedUsername = String(
        req.query.username || ""
    ).trim().toLowerCase();

    if (!requestedUsername) {
        return res.status(400).json({
            authorized: false,
            error: "Missing username."
        });
    }

    try {
        // Always fetch the latest users.json directly from GitHub.
        const file = await getFile("data/users.json");

        const data = JSON.parse(file.content);
        const users = Array.isArray(data.users) ? data.users : [];

        const authorized = users.some(
            username =>
                String(username).trim().toLowerCase() === requestedUsername
        );

        res.set(
            "Cache-Control",
            "no-store, no-cache, must-revalidate, proxy-revalidate"
        );
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");

        return res.json({ authorized });
    } catch (error) {
        console.error("[Authorize] Failed to fetch users:", error);

        return res.status(500).json({
            authorized: false,
            error: "Authorization service unavailable."
        });
    }
});

module.exports = router;
