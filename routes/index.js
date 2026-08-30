const express = require("express");
const path = require("path");

const router = express.Router();

function requireDashboardAuth(req, res, next) {
    if (req.session && req.session.authenticated) return next();

    // Not authenticated: redirect to login
    return res.redirect("/login");
}

router.get("/", requireDashboardAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../views/dashboard.html"));
});

module.exports = router;
