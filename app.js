const express = require("express");
const path = require("path");

const indexRouter = require("./routes/index");
const apiRouter = require("./routes/api");
const loaderRouter = require("./routes/loader");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

app.use(express.static(path.join(__dirname, "public")));

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
