# SFXDarei Manager

A web-based dashboard for managing the SFXDarei Roblox script distribution system. It provides authorized-user management, Roblox Lua script updates, execution analytics, and a protected administrative interface.

## Table of Contents

* [Overview](#overview)
* [Features](#features)
* [Technology Stack](#technology-stack)
* [Project Structure](#project-structure)
* [How It Works](#how-it-works)
* [Requirements](#requirements)
* [Configuration](#configuration)
* [Installation](#installation)
* [Deployment to Vercel](#deployment-to-vercel)
* [Dashboard Sections](#dashboard-sections)
* [API Reference](#api-reference)
* [GitHub Integration](#github-integration)
* [Analytics and Database](#analytics-and-database)
* [Authentication and Security](#authentication-and-security)
* [Troubleshooting](#troubleshooting)
* [License](#license)

## Overview

SFXDarei Manager is an administrative dashboard for a Roblox script distribution system. It uses GitHub as the source of truth for the authorized-user list and the distributed Lua script, while Turso stores execution analytics.

The dashboard provides a central interface for maintaining authorized usernames, updating the distributed script, monitoring recent repository activity, and reviewing execution statistics.

The application is built with Node.js and Express and can be deployed to Vercel.

## Features

### Dashboard

* Administrative interface protected by login authentication.
* Status information retrieved from GitHub.
* Authorized-user count.
* Latest repository commit information.
* API health-check endpoint.

### Authorized User Management

* Add Roblox usernames to the authorization list.
* Remove previously authorized usernames.
* Retrieve the current authorized-user list from GitHub.
* Validate input before modifying the list.
* Detect duplicate usernames.
* Commit authorization changes to the GitHub repository.
* Retry safe updates when GitHub reports a conflicting file version.

### Script Management

* Load the current Roblox Lua script from GitHub.
* Edit the script through the dashboard.
* Save script changes to the repository.
* Avoid unnecessary commits when the script has not changed.
* Display commit information when it can be verified.

### Execution Analytics

* Store script execution events in Turso.
* Count total executions.
* Group executions by executor.
* Group executions by device.
* Show execution totals for authorized users.
* Retrieve execution history for an individual authorized username.

### Roblox Distribution Integration

* Retrieve the distributed Lua script through the loader endpoint.
* Check whether a username is authorized.
* Record execution events through the synchronization API.
* Keep authorization data and the distributed script centralized in GitHub.

### Deployment

* Express application suitable for serverless deployment.
* Vercel routing configuration.
* Environment-based credentials and configuration.
* GitHub and Turso integrations without requiring a local database file for analytics.

## Technology Stack

| Technology            | Purpose                              |
| --------------------- | ------------------------------------ |
| Node.js               | JavaScript runtime                   |
| Express.js            | HTTP server and API routing          |
| Octokit               | GitHub API integration               |
| GitHub                | Script and authorization storage     |
| Turso / libSQL        | Execution analytics database         |
| `@libsql/client`      | Database connectivity                |
| `cookie-session`      | Signed-cookie session authentication |
| HTML, CSS, JavaScript | Dashboard interface                  |
| Vercel                | Hosting and serverless deployment    |

## Project Structure

The following is the expected organization of the main application files. Individual frontend assets and supporting files may vary.

```text
sfxdarei-manager/
├── app.js
├── github.js
├── package.json
├── package-lock.json
├── vercel.json
│
├── routes/
│   ├── index.js
│   ├── api.js
│   ├── auth.js
│   ├── loader.js
│   └── sync.js
│
├── public/
│   ├── index.html
│   ├── css/
│   ├── js/
│   │   └── dashboard.js
│   └── images/
│
├── views/
│   ├── login.html
│   └── 404.html
│
├── data/
│   └── users.json
│
└── script/
    └── script.lua
```

**Important:** `data/users.json` and `script/script.lua` are paths in the GitHub repository used by the application. They are not necessarily writable files in the deployed Vercel filesystem.

## How It Works

The application consists of four primary components.

### 1. Dashboard server

`app.js` initializes Express, parses incoming requests, serves static dashboard assets, configures session authentication, and registers the application routers.

The API router is mounted at `/api`, so a route declared as `router.get("/users", ...)` is accessed at `/api/users`.

### 2. GitHub repository

GitHub stores the canonical authorization list and Lua script.

The application uses Octokit to read files, update their contents, and retrieve the latest commit.

Repository configuration:

* Owner: `84-3`
* Repository: `nodejs`
* Branch: `main`
* Authorization file: `data/users.json`
* Script file: `script/script.lua`

### 3. Turso analytics

Turso stores execution events in the `execution_events` table. The dashboard queries these records to calculate execution statistics.

### 4. Roblox integration

The loader retrieves the Lua script, while the authorization endpoint checks a supplied username against the GitHub-hosted user list. Execution events can be sent to the synchronization service for analytics storage.

## Requirements

* A GitHub account with access to the script repository.
* A GitHub personal access token with the required repository permissions.
* A Turso database and authentication token.
* A Vercel account for deployment.
* The environment variables listed below.
* Node.js for local development, if desired.

## Configuration

Configure the following environment variables in Vercel under **Project Settings → Environment Variables**.

| Variable             | Required                                | Description                                           |
| -------------------- | --------------------------------------- | ----------------------------------------------------- |
| `GITHUB_TOKEN`       | Yes                                     | Token used to access and update the GitHub repository |
| `DASHBOARD_USER`     | Yes                                     | Username used to log in to the dashboard              |
| `DASHBOARD_PASSWORD` | Yes                                     | Password used to log in to the dashboard              |
| `SESSION_SECRET`     | Yes in production                       | Secret used to sign session cookies                   |
| `TURSO_DATABASE_URL` | Yes for analytics                       | URL of the Turso database                             |
| `TURSO_AUTH_TOKEN`   | Required for authenticated Turso access | Database authentication token                         |
| `NODE_ENV`           | Recommended                             | Set to `production` in production deployments         |

### GitHub token

Create a token with the minimum permissions needed to read repository contents and write changes to the target repository.

For a fine-grained personal access token, grant access to the `84-3/nodejs` repository and enable the necessary Contents permissions.

Store the token in `GITHUB_TOKEN`. Never embed it in frontend JavaScript or commit it to the repository.

### Session secret

Generate a strong random secret. For example, in a local Node.js environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set the generated value as `SESSION_SECRET` in Vercel.

Do not use a public or predictable secret in production.

### Turso configuration

Set `TURSO_DATABASE_URL` to the database URL supplied by Turso and `TURSO_AUTH_TOKEN` to its corresponding authentication token.

The application creates the analytics table and its indexes when analytics are accessed, provided the configured database credentials have permission to create them.

After changing environment variables, redeploy the application so the deployment receives the new configuration.

## Installation

### Deploy through GitHub and Vercel

The recommended production workflow is:

1. Push the project to GitHub.
2. Import the repository into Vercel.
3. Configure the required environment variables.
4. Ensure the project contains the Vercel configuration described below.
5. Deploy the project.
6. Open the deployment URL and sign in.

Vercel normally installs dependencies automatically during deployment based on `package.json` and the available lockfile. A local `npm install` is not required just to trigger a Vercel deployment.

### Local development

If you want to run the project locally, install Node.js and the project dependencies, configure the environment variables, and start the application:

```bash
npm install
npm start
```

The default local address is:

```text
http://localhost:3000
```

Local development should use a separate development secret and non-production credentials.

## Deployment to Vercel

### Vercel configuration

The root-level `vercel.json` should route requests through the Express application:

```json
{
  "version": 2,
  "builds": [
    {
      "src": "app.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "/app.js"
    }
  ]
}
```

This configuration is intended for deployments where `app.js` is the Express entry point and all requests should pass through it.

### Express serverless export

The application must export the Express app:

```javascript
module.exports = app;
```

For Vercel, `app.js` should not start a separate persistent HTTP listener. Local development can retain `app.listen()` behind a condition that excludes the Vercel environment.

### Deployment checklist

* [ ] `vercel.json` is in the repository root.
* [ ] `app.js` exports the Express application.
* [ ] Required environment variables are configured.
* [ ] GitHub token permissions are sufficient.
* [ ] Turso credentials are valid.
* [ ] The latest deployment completed successfully.
* [ ] `/api/healthcheck` returns JSON.
* [ ] Login and authenticated API requests work.

## Dashboard Sections

### Dashboard

Displays system status and repository information, including the latest commit and authorized-user count when those values are available.

### Users

Reads the authorized-user list from GitHub and allows administrators to add or remove usernames.

Changes are written to `data/users.json` on the configured branch. A successful response should only be treated as a confirmed commit when the backend reports that the commit was verified.

### Script

Loads the contents of `script/script.lua` and allows authorized administrators to save updates to GitHub.

If the submitted script is identical to the current version, the backend can return a successful response indicating that no changes were needed.

### Analytics

Displays aggregated execution data from Turso, including:

* Total recorded executions.
* Execution counts by executor.
* Execution counts by device.
* Execution totals by authorized username.
* Individual execution histories where requested.

Analytics are filtered against the current authorized-user list from GitHub.

## API Reference

All API paths below are relative to the application's root URL.

Unless otherwise specified, `/api/*` endpoints require an authenticated dashboard session.

### Health check

**`GET /api/healthcheck`**

Checks whether the API is responding.

Example response:

```json
{
  "status": "ok",
  "service": "SFXDarei Manager",
  "timestamp": "2026-10-10T12:00:00.000Z"
}
```

The timestamp is generated dynamically.

### List authorized users

**`GET /api/users`**

Retrieves the current user list from GitHub.

Example response:

```json
{
  "success": true,
  "users": [
    "ExampleUser",
    "AnotherUser"
  ]
}
```

The usernames above are illustrative.

### Add an authorized user

**`POST /api/users`**

Request body:

```json
{
  "username": "ExampleUser"
}
```

The endpoint validates the username, checks for duplicates, and updates `data/users.json`.

A successful response includes the username and commit-verification information. A duplicate username returns HTTP `409`; invalid input returns HTTP `400`.

### Remove an authorized user

**`DELETE /api/users/:username`**

Example:

```http
DELETE /api/users/ExampleUser
```

Removes the specified username from the authorization list.

A successful response includes the operation result and commit-verification information. A username that is not found returns HTTP `404`.

### Read the distributed script

**`GET /api/script`**

Returns the current script content and GitHub file SHA.

Example response:

```json
{
  "content": "-- Roblox Lua script",
  "sha": "example-file-sha"
}
```

The values are illustrative.

### Update the distributed script

**`PUT /api/script`**

Request body:

```json
{
  "content": "-- Updated Roblox Lua script"
}
```

Writes the new content to `script/script.lua` on GitHub. Identical content may result in a successful response with `changed: false`.

### System status

**`GET /api/status`**

Returns the latest commit, the authorized-user count, and any warnings encountered while retrieving the data.

Example response:

```json
{
  "commit": {
    "sha": "example-commit-sha",
    "message": "Update script",
    "date": "2026-10-10T12:00:00.000Z",
    "url": "https://github.com/84-3/nodejs/commit/example-commit-sha"
  },
  "localUsers": 2,
  "warnings": []
}
```

The `commit` field may be `null` if GitHub commit information cannot be retrieved. The field `localUsers` is the count of usernames read from GitHub; it does not imply that a local writable file is being used.

### Analytics summary

**`GET /api/analytics`**

Returns aggregated execution statistics.

Example response:

```json
{
  "totalExecutions": 25,
  "executors": [
    {
      "name": "ExampleExecutor",
      "count": 15
    }
  ],
  "devices": [
    {
      "name": "Windows",
      "count": 20
    }
  ],
  "users": [
    {
      "username": "ExampleUser",
      "executions": 10
    }
  ]
}
```

The values are illustrative. The actual response depends on the records in Turso and the current authorized-user list.

### Individual user analytics

**`GET /api/analytics/:username`**

Returns execution history for a particular authorized username.

The username must exist in the current authorization list. Otherwise, the endpoint returns HTTP `404`.

### Authentication responses

Unauthenticated API requests should return a JSON `401` response:

```json
{
  "error": "Authentication required."
}
```

This allows the frontend to distinguish authentication failures from missing routes and server errors.

## GitHub Integration

GitHub is the source of truth for both the authorized-user list and the distributed Lua script.

The application uses the GitHub API to retrieve file contents and file SHAs. When a file changes, the backend submits an update to the configured branch with a commit message.

### Authorization data format

`data/users.json` should contain an object with a `users` array:

```json
{
  "users": [
    "ExampleUser",
    "AnotherUser"
  ]
}
```

The backend validates this structure before using the list.

### Script storage

The distributed script is stored at:

```text
script/script.lua
```

Updates made through the dashboard are saved to the GitHub repository rather than relying on a writable local file.

### Concurrent updates

GitHub file updates use the file's SHA to identify the version being modified. If another update happens first, the submitted SHA can become stale.

The safe-update workflow should re-read the current file and retry suitable conflicts to reduce lost updates. If an operation's result cannot be verified, check the repository before repeating the operation.

## Analytics and Database

The application uses Turso, a hosted libSQL database, to persist execution events.

### Database schema

The analytics table is created by the backend when needed:

```sql
CREATE TABLE IF NOT EXISTS execution_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    executor TEXT NOT NULL,
    device TEXT NOT NULL,
    executed_at INTEGER NOT NULL
);
```

Indexes are created for username/time and time-based queries.

### Event fields

| Field         | Description                                    |
| ------------- | ---------------------------------------------- |
| `id`          | Unique event identifier                        |
| `username`    | Username associated with the execution         |
| `executor`    | Executor reported by the integration           |
| `device`      | Device or platform reported by the integration |
| `executed_at` | Execution timestamp represented as an integer  |

The precise timestamp unit should match the code that records the event and the code that formats it for display.

### Authorization filtering

Analytics endpoints read the current authorized-user list from GitHub and filter the execution records accordingly. This means historical events for users who are no longer authorized may not appear in the dashboard's aggregated results.

## Authentication and Security

### Dashboard login

The login page accepts credentials matching `DASHBOARD_USER` and `DASHBOARD_PASSWORD`.

After successful authentication, the application stores the authenticated state and username in the session. Protected pages and APIs check this state before proceeding.

### Session cookies

The production configuration uses signed cookies with:

* HTTP-only cookie access.
* HTTPS-only cookies in production.
* `SameSite=Lax`.
* A limited session lifetime.
* A secret supplied through `SESSION_SECRET`.

The Express application trusts the Vercel proxy so secure-cookie behavior can work correctly behind HTTPS termination.

Cookie-based sessions are signed, not encrypted. Do not store passwords, GitHub tokens, or other secrets inside the session.

### Security recommendations

* Never commit `.env` files or credentials.
* Use a strong, unique `SESSION_SECRET`.
* Keep GitHub tokens server-side.
* Grant repository tokens only the permissions they require.
* Use HTTPS in production.
* Validate all API inputs.
* Keep authentication checks enabled for administrative endpoints.
* Avoid exposing stack traces or secrets in API responses.
* Rotate credentials if they are accidentally disclosed.
* Consider adding rate limiting to login and sensitive endpoints.

## Troubleshooting

### Vercel returns an HTML 404 page

**Symptoms:** `/api/users` returns an HTML page rather than JSON.

**Possible causes:**

* The deployment is not routing requests through Express.
* `vercel.json` is missing or incorrectly configured.
* The latest code has not been deployed.
* The Express entry point is not exported correctly.

**Checks:**

1. Verify that `vercel.json` exists in the repository root.
2. Verify that the deployment includes `app.js` and the `routes/` directory.
3. Inspect Vercel build and function logs.
4. Request `/api/healthcheck`.

### The API returns `{"error":"API endpoint not found."}`

This response indicates that the request reached the Express application's fallback handler but did not match a registered route.

Check that the endpoint exists in the appropriate router and that the router is mounted at the expected prefix.

For example:

```javascript
app.use("/api", apiRouter);
```

Combined with:

```javascript
router.get("/users", handler);
```

This registers `GET /api/users`.

### Requests redirect to `/login`

Check the session cookie and authentication middleware.

Possible causes include:

* The browser did not send the session cookie.
* `SESSION_SECRET` changed between deployments.
* The secure-cookie or proxy configuration is incorrect.
* The request is being sent to a different hostname.
* The session cookie expired.

API requests should return JSON `401` responses instead of redirecting to HTML login pages.

### Login works, but the Users tab fails

Check the browser's Network panel and inspect the exact method and URL.

The frontend's user-list request must use `GET /api/users`, and the backend must register `router.get("/users", ...)`.

A route that only implements `POST /users` does not support retrieving the user list.

### GitHub updates fail

Check:

* `GITHUB_TOKEN` is configured.
* The token can read repository contents.
* The token has permission to update repository contents.
* `84-3/nodejs` exists and the `main` branch is correct.
* `data/users.json` and `script/script.lua` exist.
* Vercel function logs for GitHub API errors.

If a request times out or the response cannot be verified, inspect GitHub before repeating the operation.

### Authorized-user count or latest commit is unavailable

The status endpoint retrieves the commit and user list independently. A failure in one lookup may result in a warning while the other value remains available.

Check GitHub API permissions, repository availability, rate limits, and Vercel logs.

### Analytics fail to load

Check:

* `TURSO_DATABASE_URL` is valid.
* `TURSO_AUTH_TOKEN` is configured when required.
* The database is reachable.
* The database credentials allow the required table and index creation.
* The event table contains records in the expected format.
* The analytics endpoint is receiving an authenticated request.

### Vercel deployment fails after dependency changes

Verify that `package.json` includes every required dependency and that `package-lock.json`, if committed, is consistent with it.

Inspect the deployment build logs for missing packages or incompatible versions.

## License

This project is distributed under the MIT License, as declared in `package.json`.

If a separate `LICENSE` file is included in the repository, that file should contain the full license text and remain the authoritative license document.

---

**SFXDarei Manager** — centralized Roblox script distribution, authorization management, and execution analytics.
