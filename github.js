const GITHUB_OWNER = "84-3";
const GITHUB_REPO = "nodejs";
const GITHUB_BRANCH = "main";
const API_VERSION = "2022-11-28";

let octokitClassPromise;

async function getClient() {
    const token = process.env.GITHUB_TOKEN;

    if (!token) {
        throw new Error("GITHUB_TOKEN is not configured.");
    }

    octokitClassPromise ??= import("octokit").then(({ Octokit }) => Octokit);
    const Octokit = await octokitClassPromise;

    return new Octokit({ auth: token });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function isTransientError(error) {
    const status = Number(error?.status);

    return (
        !status ||
        status === 429 ||
        status >= 500 ||
        (
            status === 403 &&
            Number(error?.response?.headers?.["x-ratelimit-remaining"]) === 0
        )
    );
}

function isConflictError(error) {
    const status = Number(error?.status);
    const message = String(error?.message || "").toLowerCase();

    return (
        status === 409 ||
        (
            status === 422 &&
            (
                message.includes("sha") ||
                message.includes("conflict") ||
                message.includes("does not match")
            )
        )
    );
}

async function retryRead(operation, attempts = 3) {
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;

            if (!isTransientError(error) || attempt === attempts - 1) {
                throw error;
            }

            await sleep(250 * (2 ** attempt));
        }
    }

    throw lastError;
}

function buildRawUrl(pathname) {
    const encodedPath = pathname
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");

    return `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_BRANCH}/${encodedPath}`;
}

async function fetchRawFile(url, token) {
    return retryRead(async () => {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github.raw",
                "User-Agent": "SFXDarei-Manager",
                "Cache-Control": "no-cache"
            },
            cache: "no-store"
        });

        if (!response.ok) {
            const error = new Error(
                `GitHub raw file request failed (${response.status}).`
            );
            error.status = response.status;
            throw error;
        }

        return response.text();
    });
}

async function getFile(pathname) {
    const octokit = await getClient();
    const token = process.env.GITHUB_TOKEN;

    return retryRead(async () => {
        const { data } = await octokit.rest.repos.getContent({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: pathname,
            ref: GITHUB_BRANCH,
            headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": API_VERSION,
                "Cache-Control": "no-cache"
            }
        });

        if (!data || Array.isArray(data) || data.type !== "file") {
            throw new Error(`${pathname} is not a GitHub file.`);
        }

        let content = null;

        if (
            typeof data.content === "string" &&
            data.encoding === "base64"
        ) {
            content = Buffer
                .from(data.content.replace(/\s/g, ""), "base64")
                .toString("utf8");
        }

        if (content === null || (data.size > 0 && content === "")) {
            content = await fetchRawFile(
                data.download_url || buildRawUrl(pathname),
                token
            );
        }

        if (typeof data.sha !== "string" || !data.sha) {
            throw new Error(`GitHub did not return a SHA for ${pathname}.`);
        }

        return {
            path: pathname,
            sha: data.sha,
            size: Number(data.size || Buffer.byteLength(content, "utf8")),
            downloadUrl: data.download_url || buildRawUrl(pathname),
            content
        };
    });
}

async function updateFile(pathname, content, message, sha) {
    if (typeof content !== "string") {
        throw new TypeError("File content must be a string.");
    }

    if (typeof sha !== "string" || !sha) {
        throw new Error(`A valid file SHA is required to update ${pathname}.`);
    }

    const octokit = await getClient();

    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        path: pathname,
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha,
        branch: GITHUB_BRANCH,
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION
        }
    });

    if (typeof data?.commit?.sha !== "string" || !data.commit.sha) {
        throw new Error("GitHub did not confirm the created commit.");
    }

    return {
        commitSha: data.commit.sha,
        commitUrl: data.commit.html_url || null,
        contentSha: data.content?.sha || null
    };
}

/*
 * Safely update a file after fetching its latest SHA.
 *
 * buildContent(currentContent) must return:
 * - a string to write;
 * - null when no change is needed.
 *
 * isApplied(latestContent) checks whether a request that errored
 * may nevertheless have succeeded on GitHub.
 */
async function updateFileSafely(
    pathname,
    message,
    buildContent,
    isApplied,
    maxAttempts = 4
) {
    let lastError;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const file = await getFile(pathname);
        const nextContent = await buildContent(file.content);

        if (nextContent === null || nextContent === file.content) {
            return { changed: false, commit: null };
        }

        if (typeof nextContent !== "string") {
            throw new TypeError("The file update produced invalid content.");
        }

        try {
            const commit = await updateFile(
                pathname,
                nextContent,
                message,
                file.sha
            );

            return { changed: true, commit, recovered: false };
        } catch (error) {
            lastError = error;

            // Check GitHub's current state before retrying. The write
            // may have succeeded even if its response was lost.
            let latestFile;

            try {
                latestFile = await getFile(pathname);
            } catch (readError) {
                console.error(
                    `[GitHub] Could not verify ${pathname} after update error:`,
                    readError
                );

                if (
                    !isConflictError(error) &&
                    !isTransientError(error)
                ) {
                    throw error;
                }

                if (attempt === maxAttempts - 1) {
                    throw new Error(
                        `Could not verify whether ${pathname} was saved. ` +
                        `Check the repository before retrying.`
                    );
                }

                await sleep(250 * (2 ** attempt));
                continue;
            }

            if (typeof isApplied === "function") {
                let applied = false;

                try {
                    applied = await isApplied(latestFile.content);
                } catch (verifyError) {
                    console.error("[GitHub] Update verification failed:", verifyError);
                }

                if (applied) {
                    // The file's desired state is present. Report the
                    // latest commit if available, without inventing a SHA.
                    const latestCommit = await getLatestCommit().catch(() => null);

                    return {
                        changed: true,
                        commit: latestCommit
                            ? {
                                commitSha: latestCommit.sha,
                                commitUrl: latestCommit.url
                            }
                            : null,
                        recovered: true
                    };
                }
            }

            if (
                !isConflictError(error) &&
                !isTransientError(error)
            ) {
                throw error;
            }

            if (attempt < maxAttempts - 1) {
                await sleep(250 * (2 ** attempt));
            }
        }
    }

    throw lastError || new Error(`Failed to update ${pathname}.`);
}

async function getLatestCommit() {
    const octokit = await getClient();

    return retryRead(async () => {
        const { data } = await octokit.rest.repos.getCommit({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            ref: GITHUB_BRANCH,
            headers: {
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": API_VERSION,
                "Cache-Control": "no-cache"
            }
        });

        if (
            !data ||
            typeof data.sha !== "string" ||
            !data.commit ||
            typeof data.commit.message !== "string"
        ) {
            throw new Error("GitHub returned an incomplete latest-commit response.");
        }

        return {
            sha: data.sha,
            message: data.commit.message,
            date: data.commit.author?.date || null,
            url: data.html_url || null
        };
    });
}

module.exports = {
    GITHUB_OWNER,
    GITHUB_REPO,
    GITHUB_BRANCH,
    getFile,
    updateFile,
    updateFileSafely,
    getLatestCommit
};
