const express = require("express");
const path = require("path");

const router = express.Router();

function requireDashboardAuth(req, res, next) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Basic ")) {
        res.set("WWW-Authenticate", 'Basic realm="SFXDarei Manager"');
        return res.status(401).send("Authentication required.");
    }

    let credentials;
    try {
        credentials = Buffer.from(header.slice(6), "base64").toString("utf8");
    } catch {
        credentials = "";
    }

    const separator = credentials.indexOf(":");
    const username = separator >= 0 ? credentials.slice(0, separator) : "";
    const password = separator >= 0 ? credentials.slice(separator + 1) : "";

    if (
        username !== process.env.DASHBOARD_USER ||
        !process.env.DASHBOARD_PASSWORD ||
        password !== process.env.DASHBOARD_PASSWORD
    ) {
        res.set("WWW-Authenticate", 'Basic realm="SFXDarei Manager"');
        return res.status(401).send("Invalid credentials.");
    }

    next();
}

router.get("/", requireDashboardAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../views/dashboard.html"));
});

module.exports = router;
