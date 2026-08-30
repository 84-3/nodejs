const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/login", (req, res) => {
    // Serve a simple login page
    res.sendFile(path.join(__dirname, "../views/login.html"));
});

router.post("/login", (req, res) => {
    const username = String(req.body.username || "");
    const password = String(req.body.password || "");

    if (
        username === process.env.DASHBOARD_USER &&
        process.env.DASHBOARD_PASSWORD &&
        password === process.env.DASHBOARD_PASSWORD
    ) {
        req.session.authenticated = true;
        req.session.user = username;
        return res.redirect("/");
    }

    // Invalid login, redirect back to login with 401
    res.status(401).redirect("/login");
});

router.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.redirect("/login");
    });
});

module.exports = router;
