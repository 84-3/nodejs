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

async function getFile(pathname) {
    const octokit = getClient();

    const { data } = await octokit.rest.repos.getContent({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: pathname,
        ref: GITHUB_BRANCH
    });

    if (Array.isArray(data) || data.type !== "file") {
        throw new Error(`${pathname} is not a file.`);
    }

    return {
        path: pathname,
        sha: data.sha,
        content: Buffer.from(data.content, "base64").toString("utf8")
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

    const { data } = await octokit.rest.repos.createOrUpdateFileContents(payload);

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
        branch: GITHUB_BRANCH
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
