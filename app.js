const express = require("express");
const path = require("path");

const indexRouter = require("./routes/index");
const apiRouter = require("./routes/api");
const loaderRouter = require("./routes/loader");
const syncRouter = require("./routes/sync");
const authRouter = require("./routes/auth");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "public")));

app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev-secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false }
    })
);

app.use("/", authRouter);

app.use((req, res, next) => {
    if (req.session && req.session.authenticated) return next();

    const requestPath = req.path || "";
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

    for (const prefix of publicPrefixes) {
        if (
            requestPath === prefix ||
            requestPath.startsWith(prefix + "/") ||
            requestPath.startsWith(prefix)
        ) {
            return next();
        }
    }

    if (req.accepts && req.accepts("html")) return res.redirect("/login");
    return next();
});

app.use("/", indexRouter);
app.use("/api", apiRouter);
app.use("/sync", syncRouter);
app.use("/", loaderRouter);

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "views", "404.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
