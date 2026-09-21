const { Octokit } = require("octokit");

const GITHUB_OWNER = "84-3";
const GITHUB_REPO = "nodejs";
const GITHUB_BRANCH = "main";

function getClient() {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
        throw new Error("GITHUB_TOKEN is not configured.");
    }

    return new Octokit({ auth: token });
}

function buildRawUrl(pathname) {
    const encodedPath = pathname
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");

    return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodedPath}`;
}

async function fetchRawFile(url, token) {
    const response = await fetch(url, {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github.raw",
            "User-Agent": "SFXDarei-Railway-Manager"
        },
        cache: "no-store"
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `Failed to fetch raw GitHub file (${response.status}): ${body || response.statusText}`
        );
    }

    return response.text();
}

async function getFile(pathname) {
    const octokit = getClient();
    const token = process.env.GITHUB_TOKEN;

    const { data } = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: pathname,
        ref: GITHUB_BRANCH,
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
        }
    });

    if (Array.isArray(data) || data.type !== "file") {
        throw new Error(`${pathname} is not a file.`);
    }

    let content = null;

    // Small files are returned normally as Base64 content.
    if (
        typeof data.content === "string" &&
        data.content.length > 0 &&
        data.encoding === "base64"
    ) {
        content = Buffer
            .from(data.content.replace(/\s/g, ""), "base64")
            .toString("utf8");
    }

    // Large files can have no usable `content` field.
    // Fetch them through GitHub's raw file endpoint instead.
    if (content === null) {
        const rawUrl = data.download_url || buildRawUrl(pathname);
        content = await fetchRawFile(rawUrl, token);
    }

    return {
        path: pathname,
        sha: data.sha,
        size: Number(data.size || Buffer.byteLength(content, "utf8")),
        downloadUrl: data.download_url || buildRawUrl(pathname),
        content
    };
}

async function updateFile(pathname, content, message, sha) {
    const octokit = getClient();

    const payload = {
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: pathname,
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: GITHUB_BRANCH
    };

    if (sha) {
        payload.sha = sha;
    }

    const { data } =
        await octokit.rest.repos.createOrUpdateFileContents(payload);

    return {
        commitSha: data.commit.sha,
        commitUrl: data.commit.html_url,
        contentSha: data.content ? data.content.sha : null
    };
}

async function getLatestCommit() {
    const octokit = getClient();

    const { data } = await octokit.rest.repos.getBranch({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        branch: GITHUB_BRANCH,
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2026-03-10",
            "Cache-Control": "no-cache",
            Pragma: "no-cache"
        }
    });

    return {
        sha: data.commit.sha,
        message: data.commit.commit.message,
        date: data.commit.commit.author?.date || null,
        url: data.commit.html_url
    };
}

module.exports = {
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_BRANCH,
    getFile,
    updateFile,
    getLatestCommit
};
