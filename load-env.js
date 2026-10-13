"use strict";

/**
 * Zero-dependency .env loader.
 *
 * Why this exists:
 *   app.js reads configuration (DASHBOARD_USER, DASHBOARD_PASSWORD, TURSO_*,
 *   GITHUB_TOKEN, ...) from process.env, but nothing ever loaded the local
 *   .env file. Without it, DASHBOARD_USER / DASHBOARD_PASSWORD are undefined
 *   and every login attempt is rejected — the app appears "stuck" on /login.
 *
 * Design notes:
 *   - No dependency on `dotenv`, so it works on a clean `npm install`.
 *   - Real environment variables always win. Hosted platforms (Railway, Vercel)
 *     inject their own env, so a missing .env file is not an error there.
 *   - Only used to bootstrap local development; it never logs secret values.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_ENV_PATH = path.join(__dirname, ".env");
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parse the contents of a .env file into a plain object.
 * Supports: comments, blank lines, `export` prefixes, single/double quotes,
 * inline `# comments` on unquoted values, and `\n` escapes in double quotes.
 *
 * @param {string} source
 * @returns {Record<string, string>}
 */
function parseEnv(source) {
    const result = {};

    for (const rawLine of String(source).split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith("#")) continue;

        const assignment = line.startsWith("export ")
            ? line.slice("export ".length).trim()
            : line;

        const separator = assignment.indexOf("=");
        if (separator === -1) continue;

        const key = assignment.slice(0, separator).trim();
        if (!KEY_PATTERN.test(key)) continue;

        let value = assignment.slice(separator + 1).trim();
        const quote = value[0];

        if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
            value = value.slice(1, -1);
            if (quote === '"') {
                value = value
                    .replace(/\\n/g, "\n")
                    .replace(/\\r/g, "\r")
                    .replace(/\\t/g, "\t");
            }
        } else {
            // Strip an unquoted trailing " # comment".
            const commentAt = value.indexOf(" #");
            if (commentAt !== -1) value = value.slice(0, commentAt).trim();
        }

        result[key] = value;
    }

    return result;
}

/**
 * Load a .env file into process.env without overwriting existing variables.
 *
 * @param {string} [filePath]
 * @returns {{ loaded: boolean, applied: string[], path: string }}
 */
function loadEnv(filePath = DEFAULT_ENV_PATH) {
    let source;

    try {
        source = fs.readFileSync(filePath, "utf8");
    } catch {
        // No .env on disk (expected on hosted platforms). Nothing to do.
        return { loaded: false, applied: [], path: filePath };
    }

    const parsed = parseEnv(source);
    const applied = [];

    for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined && value !== "") {
            process.env[key] = value;
            applied.push(key);
        }
    }

    return { loaded: true, applied, path: filePath };
}

module.exports = { loadEnv, parseEnv };