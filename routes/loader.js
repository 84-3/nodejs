const express = require("express");

const { getFile } = require("../github");

const router = express.Router();

const NO_CACHE_HEADERS = {
    "Cache-Control": "private, no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "Surrogate-Control": "no-store",
    "Pragma": "no-cache",
    "Expires": "0",
    "X-Accel-Expires": "0",
    "Vary": "*"
};

function disableCache(req, res, next) {
    res.set(NO_CACHE_HEADERS);
    next();
}

router.get("/loader", disableCache, async (req, res) => {
    try {
        // Fetch the latest script on every request.
        const file = await getFile("script/script.lua");

        if (!file || typeof file.content !== "string") {
            throw new Error("Invalid script response from GitHub.");
        }
        return res
            .status(200)
            .type("text/plain")
            .end(file.content);

    } catch (error) {
        console.error("[Loader] Failed to fetch script:", error);
        // Cache headers are already applied, even for failed requests.
        return res
            .status(500)
            .type("text/plain")
            .end("-- Failed to load script.");
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
