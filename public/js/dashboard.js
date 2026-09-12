const state = {
    users: [],
    scriptLoaded: false,
    analyticsLoaded: false
};

const $ = selector => document.querySelector(selector);

function toast(message, error = false) {
    const node = document.createElement("div");
    node.className = `toast${error ? " error" : ""}`;
    node.textContent = message;
    $("#toast-container").appendChild(node);
    setTimeout(() => node.remove(), 3500);
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        cache: "no-store",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    let data = {};
    try {
        data = await response.json();
    } catch {}

    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
}

function switchSection(section) {
    document.querySelectorAll(".nav-item").forEach(button => {
        button.classList.toggle("active", button.dataset.section === section);
    });

    document.querySelectorAll(".section").forEach(node => {
        node.classList.toggle("active", node.id === `${section}-section`);
    });

    const titles = {
        dashboard: ["Dashboard", "Manage your script and authorized users."],
        users: ["Users", "Manage who can execute the script."],
        analytics: ["Analytics", "View script executions, executors and devices."],
        script: ["Script", "Edit the live Roblox script."]
    };

    $("#page-title").textContent = titles[section][0];
    $("#page-subtitle").textContent = titles[section][1];

    if (section === "users") loadUsers();
    if (section === "analytics") loadAnalytics();
    if (section === "script") loadScript();
}

async function loadUsers() {
    try {
        const data = await api("/api/users");
        state.users = data.users;
        renderUsers();
    } catch (error) {
        toast(error.message, true);
    }
}

function renderUsers() {
    const query = $("#user-search").value.trim().toLowerCase();
    const users = state.users.filter(user => user.toLowerCase().includes(query));

    $("#user-total").textContent = `${state.users.length} user${state.users.length === 1 ? "" : "s"}`;
    $("#user-count").textContent = state.users.length;

    const list = $("#users-list");
    list.innerHTML = "";

    if (!users.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = query ? "No matching users." : "No authorized users yet.";
        list.appendChild(empty);
        return;
    }

    users.forEach(username => {
        const row = document.createElement("div");
        row.className = "user-row";

        const name = document.createElement("span");
        name.className = "user-name";
        name.textContent = username;

        const remove = document.createElement("button");
        remove.className = "remove-btn";
        remove.textContent = "Remove";
        remove.addEventListener("click", () => removeUser(username));

        row.append(name, remove);
        list.appendChild(row);
    });
}

async function removeUser(username) {
    if (!confirm(`Remove "${username}" from the authorized users?`)) return;

    try {
        await api(`/api/users/${encodeURIComponent(username)}`, {
            method: "DELETE"
        });
        toast(`Removed ${username}. GitHub commit created.`);
        await Promise.all([loadUsers(), loadStatus()]);
    } catch (error) {
        toast(error.message, true);
    }
}

function openAddUserModal() {
    $("#modal-title").textContent = "Add user";
    $("#modal-text").textContent = "Enter the Roblox username you want to authorize.";
    $("#modal-input").value = "";
    $("#modal").classList.remove("hidden");
    setTimeout(() => $("#modal-input").focus(), 0);
}

function closeModal() {
    $("#modal").classList.add("hidden");
}

async function addUser() {
    const username = $("#modal-input").value.trim();

    if (!username) {
        toast("Enter a username.", true);
        return;
    }

    try {
        await api("/api/users", {
            method: "POST",
            body: JSON.stringify({ username })
        });

        closeModal();
        toast(`Added ${username}. GitHub commit created.`);
        await Promise.all([loadUsers(), loadStatus()]);
    } catch (error) {
        toast(error.message, true);
    }
}

const chartColors = [
    "#4f8cff",
    "#7c5cff",
    "#00c48c",
    "#ffb020",
    "#ff5c7a",
    "#19c3ff",
    "#a66cff",
    "#ff7a45",
    "#5cd65c",
    "#c77dff"
];

function renderPieChart(chartId, legendId, items) {
    const chart = document.getElementById(chartId);
    const legend = document.getElementById(legendId);

    chart.style.background = "#252a35";
    legend.innerHTML = "";

    if (!items.length) {
        return;
    }

    const total = items.reduce((sum, item) => sum + item.count, 0);

    if (!total) {
        return;
    }

    let current = 0;

    const segments = items.map((item, index) => {
        const start = (current / total) * 360;
        current += item.count;
        const end = (current / total) * 360;
        const color = chartColors[index % chartColors.length];

        return `${color} ${start}deg ${end}deg`;
    });

    chart.style.background = `conic-gradient(${segments.join(", ")})`;

    items.forEach((item, index) => {
        const color = chartColors[index % chartColors.length];

        const row = document.createElement("div");
        row.className = "legend-item";

        const dot = document.createElement("span");
        dot.className = "legend-color";
        dot.style.background = color;

        const text = document.createElement("span");
        const percentage = ((item.count / total) * 100).toFixed(1);
        text.textContent = `${item.name} — ${item.count} (${percentage}%)`;

        row.append(dot, text);
        legend.appendChild(row);
    });
}

async function loadAnalytics() {
    try {
        const data = await api("/api/analytics");

        $("#analytics-total").textContent = data.totalExecutions;
        $("#analytics-executor-count").textContent = data.executors.length;
        $("#analytics-device-count").textContent = data.devices.length;

        renderPieChart(
            "executor-chart",
            "executor-legend",
            data.executors
        );

        renderPieChart(
            "device-chart",
            "device-legend",
            data.devices
        );

        const usersContainer = $("#analytics-users");
        usersContainer.innerHTML = "";

        if (!data.users.length) {
            usersContainer.textContent = "No authorized users.";
        } else {
            data.users.forEach(user => {
                const button = document.createElement("button");
                button.className = "analytics-user";

                const name = document.createElement("span");
                name.className = "analytics-user-name";
                name.textContent = user.username;

                const count = document.createElement("span");
                count.className = "analytics-user-count";
                count.textContent =
                    `${user.executions} execution${user.executions === 1 ? "" : "s"}`;

                button.append(name, count);

                button.addEventListener("click", () => {
                    loadExecutionHistory(user.username);
                });

                usersContainer.appendChild(button);
            });
        }

        state.analyticsLoaded = true;
    } catch (error) {
        toast(error.message, true);
    }
}

async function loadExecutionHistory(username) {
    const panel = $("#execution-history-panel");
    const history = $("#execution-history");

    panel.classList.remove("hidden");
    $("#history-title").textContent = `${username} — Execution history`;
    history.textContent = "Loading…";

    try {
        const data = await api(
            `/api/analytics/${encodeURIComponent(username)}`
        );

        history.innerHTML = "";

        if (!data.executions.length) {
            history.textContent = "This user has no recorded executions.";
            return;
        }

        data.executions.forEach(execution => {
            const row = document.createElement("div");
            row.className = "execution-row";

            const executor = document.createElement("div");
            executor.textContent = `Executor: ${execution.executor}`;

            const device = document.createElement("div");
            device.textContent = `Device: ${execution.device}`;

            const time = document.createElement("div");
            time.className = "execution-time";
            time.textContent = new Date(
                execution.executedAt
            ).toLocaleString();

            row.append(executor, device, time);
            history.appendChild(row);
        });

        panel.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    } catch (error) {
        history.textContent = error.message;
        toast(error.message, true);
    }
}

async function loadScript() {
    if (state.scriptLoaded) return;

    $("#script-state").textContent = "Loading…";

    try {
        const data = await api("/api/script");
        $("#script-editor").value = data.content;
        $("#script-state").textContent = "Loaded from GitHub";
        state.scriptLoaded = true;
    } catch (error) {
        $("#script-state").textContent = "Failed to load";
        toast(error.message, true);
    }
}

async function saveScript() {
    const button = $("#save-script");
    const content = $("#script-editor").value;

    button.disabled = true;
    button.textContent = "Committing…";
    $("#script-state").textContent = "Creating GitHub commit…";

    try {
        const result = await api("/api/script", {
            method: "PUT",
            body: JSON.stringify({ content })
        });

        if (result.changed === false) {
            toast("No changes to commit.");
            $("#script-state").textContent = "No changes";
        } else {
            toast("Script committed to GitHub. Railway will deploy it automatically.");
            $("#script-state").textContent = `Committed ${result.commit.commitSha.slice(0, 7)}`;
        }

        await loadStatus();
    } catch (error) {
        toast(error.message, true);
        $("#script-state").textContent = "Commit failed";
    } finally {
        button.disabled = false;
        button.textContent = "Save & Commit";
    }
}

async function loadStatus() {
    try {
        const data = await api("/api/status");
        $("#user-count").textContent = data.localUsers;

        const commit = data.commit;
        $("#commit-info").innerHTML = `
            <div><span class="commit-sha">${escapeHtml(commit.sha.slice(0, 12))}</span> — ${escapeHtml(commit.message.split("\n")[0])}</div>
            <div>${commit.date ? new Date(commit.date).toLocaleString() : "Unknown date"}</div>
            <div><a href="${escapeAttribute(commit.url)}" target="_blank" rel="noopener">Open commit on GitHub</a></div>
        `;
    } catch (error) {
        $("#commit-info").textContent = error.message;
    }
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#039;"
    }[char]));
}

function escapeAttribute(value) {
    return String(value).replace(/["&<>]/g, char => ({
        '"': "&quot;", "&": "&amp;", "<": "&lt;", ">": "&gt;"
    }[char]));
}

document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => switchSection(button.dataset.section));
});

$("#refresh").addEventListener("click", async () => {
    state.scriptLoaded = false;
    state.analyticsLoaded = false;

    await Promise.all([loadUsers(), loadStatus()]);

    if ($("#script-section").classList.contains("active")) { await loadScript(); }

    if ($("#analytics-section").classList.contains("active")) { await loadAnalytics(); }

    toast("Refreshed.");
});

$("#user-search").addEventListener("input", renderUsers);
$("#add-user").addEventListener("click", openAddUserModal);
$("#modal-close").addEventListener("click", closeModal);
$("#modal-cancel").addEventListener("click", closeModal);
$("#modal-confirm").addEventListener("click", addUser);
$("#save-script").addEventListener("click", saveScript);

$("#modal-input").addEventListener("keydown", event => {
    if (event.key === "Enter") addUser();
    if (event.key === "Escape") closeModal();
});

loadUsers();
loadStatus();
if ($("#analytics-section").classList.contains("active")) {
    loadAnalytics();
}
