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
