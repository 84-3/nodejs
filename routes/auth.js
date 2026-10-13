const express = require("express");
const path = require("path");

const router = express.Router();

/**
 * GET /login
 * Serves the sign-in view. The view reads ?error= from the URL to show why a
 * previous attempt failed (bad credentials, or missing server configuration).
 */
router.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "../views/login.html"));
});

/**
 * POST /login
 * Uses a 303 redirect so the browser follows up with a GET (PRG pattern) and
 * the submitted password is never re-posted on refresh.
 */
router.post("/login", (req, res) => {
    const username = String(req.body?.username || "");
    const password = String(req.body?.password || "");

    const configuredUser = process.env.DASHBOARD_USER;
    const configuredPassword = process.env.DASHBOARD_PASSWORD;

    // Distinguish "server not configured" from "wrong password" — otherwise the
    // app looks broken on a fresh checkout.
    if (!configuredUser || !configuredPassword) {
        console.error(
            "[auth] DASHBOARD_USER / DASHBOARD_PASSWORD are not configured. " +
            "Add them to .env and restart the server."
        );
        return res.redirect(303, "/login?error=config");
    }

    if (username === configuredUser && password === configuredPassword) {
        req.session = {
            authenticated: true,
            user: username
        };

        return res.redirect(303, "/");
    }

    return res.redirect(303, "/login?error=credentials");
});

/**
 * POST /logout
 */
router.post("/logout", (req, res) => {
    req.session = null;
    return res.redirect(303, "/login");
});

module.exports = router;
