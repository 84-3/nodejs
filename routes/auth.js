const express = require("express");
const path = require("path");

const router = express.Router();

router.get("/login", (req, res) => {
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
        req.session = {
            authenticated: true,
            user: username
        };

        return res.redirect("/");
    }

    return res.status(401).redirect("/login");
});

router.post("/logout", (req, res) => {
    req.session = null;
    return res.redirect("/login");
});

module.exports = router;
