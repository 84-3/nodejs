const express = require("express");
const path = require("path");
const cookieSession = require("cookie-session");

const indexRouter = require("./routes/index");
const apiRouter = require("./routes/api");
const loaderRouter = require("./routes/loader");
const syncRouter = require("./routes/sync");
const authRouter = require("./routes/auth");

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be configured in production.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({
    extended: false,
    limit: "50mb"
}));

app.use(express.static(path.join(__dirname, "public")));

app.use(cookieSession({
    name: "sfxdarei_session",
    keys: [process.env.SESSION_SECRET || "dev-only-change-this-secret"],
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax"
}));

app.use("/", authRouter);

// API requests must receive JSON errors, never login-page redirects.
app.use((req, res, next) => {
    if (req.path === "/api/healthcheck") {
        return next();
    }

    if (req.path.startsWith("/api/")) {
        if (req.session?.authenticated) {
            return next();
        }

        return res.status(401).json({
            error: "Authentication required."
        });
    }

    if (req.session?.authenticated) {
        return next();
    }

    const publicPrefixes = [
        "/login",
        "/loader",
        "/authorize",
        "/sync",
        "/css",
        "/js",
        "/images",
        "/favicon.ico"
    ];

    const isPublic = publicPrefixes.some(prefix =>
        req.path === prefix || req.path.startsWith(prefix + "/")
    );

    if (isPublic) {
        return next();
    }

    return res.redirect("/login");
});

app.use("/", indexRouter);
app.use("/api", apiRouter);
app.use("/sync", syncRouter);
app.use("/", loaderRouter);

app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({
            error: "API endpoint not found."
        });
    }

    return res.status(404).sendFile(
        path.join(__dirname, "views", "404.html")
    );
});

// Vercel invokes the exported app; local development uses app.listen().
if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
