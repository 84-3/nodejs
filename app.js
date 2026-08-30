const express = require("express");
const path = require("path");

const indexRouter = require("./routes/index");
const apiRouter = require("./routes/api");
const loaderRouter = require("./routes/loader");
const authRouter = require("./routes/auth");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "public")));

// Session middleware for simple login handling. Requires
// running `npm install` to install `express-session`.
app.use(
    session({
        secret: process.env.SESSION_SECRET || "dev-secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false }
    })
);

app.use("/", authRouter);
// Redirect unauthenticated HTML requests to /login (exclude static assets and auth routes)
app.use((req, res, next) => {
    if (req.session && req.session.authenticated) return next();

    const path = req.path || "";
    // allow login page, auth endpoints, loader endpoints and static assets
    const publicPrefixes = ["/login", "/loader", "/authorize", "/css", "/js", "/images", "/favicon.ico"];
    for (const p of publicPrefixes) {
        if (path === p || path.startsWith(p + "/") || path.startsWith(p)) return next();
    }

    // If client prefers HTML, redirect to /login
    if (req.accepts && req.accepts("html")) return res.redirect("/login");

    next();
});
app.use("/", indexRouter);
app.use("/api", apiRouter);
app.use("/", loaderRouter);

// Existing 404 behavior.
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "views", "404.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
