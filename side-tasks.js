const app = document.querySelector("#app");

let appState = {
  me: null,
  members: [],
  statuses: [],
  profileOpen: false
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Actie mislukt.");
  }
  return payload;
}

function loginView(message = "") {
  app.innerHTML = `
    <section class="login-card">
      <p class="eyebrow">ORP Overheid</p>
      <h1>Neventaken</h1>
      <p class="muted">Log in met Discord om jouw neventaak te openen.</p>
      ${message ? `<p class="alert">${escapeHtml(message)}</p>` : ""}
      <a class="primary-button" href="/api/auth/login">Aanmelden met Discord</a>
    </section>
  `;
}

function displayMemberName(member, task) {
  if (task.allowAlias && member.callSign && member.aliasName) return `[${member.callSign}] ${member.aliasName}`;
  return member.displayName || member.discordId;
}

function memberAvatar(member) {
  return member.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(member.avatarUrl)}" alt="" />`
    : `<div class="avatar"></div>`;
}

function statusButton(status, currentStatus) {
  return `
    <button class="status-button ${status.value === currentStatus ? "is-active" : ""}" data-action="set-status" data-status="${status.value}">
      ${status.value === "8" ? "Status 8" : `Status ${status.value}`}<br><span>${escapeHtml(status.label)}</span>
    </button>
  `;
}

function profileMenu() {
  const { member, task } = appState.me;
  if (!appState.profileOpen) return "";
  return `
    <div class="profile-popover">
      <div class="profile-popover-card">
      <h2>Je profiel</h2>
      <p class="muted">${escapeHtml(displayMemberName(member || {}, task))}</p>
      <form class="profile-form" data-form="profile">
        ${task.allowAlias ? `
          <label>DSI roepnummer
            <input name="callSign" value="${escapeHtml(member?.callSign || "")}" placeholder="A-01" />
          </label>
          <label>Schuilnaam
            <input name="aliasName" value="${escapeHtml(member?.aliasName || "")}" placeholder="Schuilnaam" />
          </label>
        ` : ""}
        <label>Telefoonnummer
          <input name="phone" value="${escapeHtml(member?.phone || "")}" placeholder="06-12345678" />
        </label>
        <button class="secondary-button" type="submit">Profiel opslaan</button>
      </form>
      </div>
    </div>
  `;
}

function topbar() {
  const task = appState.me.task;
  const permissions = appState.me.permissions || {};
  const logo = task.logoUrl ? `<img class="task-logo" src="${escapeHtml(task.logoUrl)}" alt="${escapeHtml(task.label)} logo" />` : "";
  return `
    <header class="topbar">
      <div class="task-brand">
        ${logo}
        <div>
          <p class="eyebrow">ORP Neventaken</p>
          <h1>${escapeHtml(task.label)}</h1>
          <p class="muted">${escapeHtml(task.displayName)}</p>
        </div>
      </div>
      <div class="user-menu">
        <div class="user-menu-row">
          <button class="user-chip" type="button" data-action="toggle-profile" title="Je profiel">
            ${appState.me.user.avatarUrl ? `<img class="avatar" src="${escapeHtml(appState.me.user.avatarUrl)}" alt="" />` : `<div class="avatar"></div>`}
            <strong>${escapeHtml(appState.me.user.displayName)}</strong>
          </button>
          <button class="secondary-button" data-action="logout">Uitloggen</button>
        </div>
        ${permissions.canManageMembers ? `<button class="member-admin-button user-menu-admin" type="button" data-action="open-member-admin">Leden Beheer</button>` : ""}
        ${profileMenu()}
      </div>
    </header>
  `;
}

function statusPanel() {
  const { member, task } = appState.me;
  return `
    <section class="panel">
      <h2>Mijn status</h2>
      <p class="muted">${escapeHtml(task.displayName)}</p>
      <div class="status-grid">
        ${appState.statuses.map((status) => statusButton(status, member?.status || "8")).join("")}
      </div>
    </section>
  `;
}

function isOperationalMember(member) {
  return member?.status === "1" || member?.status === "4";
}

function summaryRow() {
  const active = appState.members.filter((member) => member.status === "1");
  const inactive = appState.members.filter((member) => member.status === "4");
  const operational = appState.members.filter(isOperationalMember);
  return `
    <div class="summary-row">
      <div class="summary-tile"><span class="muted">Totaal in dienst</span><strong>${operational.length}</strong></div>
      <div class="summary-tile"><span class="muted">Aanwezig</span><strong>${active.length}</strong></div>
      <div class="summary-tile"><span class="muted">Afwezig</span><strong>${inactive.length}</strong></div>
    </div>
  `;
}

function memberCard(member) {
  const { task } = appState.me;
  const statusClass = member.status === "1" ? "active" : "inactive";
  const specialties = member.specialties?.length
    ? member.specialties.map((label) => `<span class="specialty-chip">${escapeHtml(label)}</span>`).join("")
    : `<span class="specialty-chip">Geen specialisatie</span>`;
  return `
    <article class="member-card ${member.status === "1" ? "" : "inactive"}">
      <div class="member-main">
        ${memberAvatar(member)}
        <div>
          <p class="member-name">${escapeHtml(displayMemberName(member, task))}</p>
          <p class="muted">${escapeHtml(member.displayName)}${member.callSign ? ` / ${escapeHtml(member.callSign)}` : ""}</p>
          ${member.phone ? `<p class="muted">${escapeHtml(member.phone)}</p>` : ""}
        </div>
        <span class="status-pill ${statusClass}">${escapeHtml(member.statusLabel)}</span>
      </div>
      <div class="chips">${specialties}</div>
    </article>
  `;
}

function memberSection(title, members) {
  return `
    <section class="member-section">
      <h2>${escapeHtml(title)}</h2>
      <div class="member-list">
        ${members.length ? members.map(memberCard).join("") : `<p class="muted">Geen leden gevonden.</p>`}
      </div>
    </section>
  `;
}

function memberAdminRow(member) {
  const name = member.displayName || member.discordId;
  const alias = member.aliasName || "-";
  const specialties = member.specialties?.length ? member.specialties.join(", ") : "Geen specialisaties";
  return `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(alias)}</td>
      <td>${escapeHtml(member.callSign || "-")}</td>
      <td>${escapeHtml(specialties)}</td>
      <td>${escapeHtml(member.statusLabel || "-")}</td>
    </tr>
  `;
}

function memberAdminPage() {
  const { task, permissions } = appState.me;
  if (!permissions.canManageMembers) {
    return `
      ${topbar()}
      <section class="panel">
        <h2>Geen toegang</h2>
        <p class="muted">Je hebt geen rechten voor ledenbeheer.</p>
      </section>
    `;
  }
  const rows = appState.members
    .slice()
    .sort((a, b) => (a.callSign || "").localeCompare(b.callSign || "", "nl") || displayMemberName(a, task).localeCompare(displayMemberName(b, task), "nl"))
    .map(memberAdminRow)
    .join("");
  return `
    ${topbar()}
    <section class="panel member-admin-page">
      <div class="page-heading">
        <div>
          <p class="eyebrow">ORP Neventaken</p>
          <h2>${escapeHtml(task.label)} - Ledenbeheer</h2>
        </div>
        <button class="secondary-button" type="button" data-action="open-dashboard">Terug naar overzicht</button>
      </div>
      <div class="member-admin-list">
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>Schuilnaam</th>
              <th>Roepnummer</th>
              <th>Specialisaties</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="5">Geen leden gevonden.</td></tr>`}
          </tbody>
        </table>
      </div>
      <form class="manager-form" data-form="add-member">
        <h3>Lid toevoegen</h3>
        <label>Discord ID
          <input name="discordId" placeholder="Discord ID" required />
        </label>
        <label>Naam
          <input name="displayName" placeholder="Optioneel, wordt anders via Discord gevuld" />
        </label>
        <label>Telefoonnummer
          <input name="phone" placeholder="06-12345678" />
        </label>
        ${task.allowAlias ? `
          <label>DSI roepnummer
            <input name="callSign" placeholder="A-01" />
          </label>
          <label>Schuilnaam
            <input name="aliasName" placeholder="Schuilnaam" />
          </label>
        ` : ""}
        <button class="primary-button" type="submit">Lid toevoegen</button>
      </form>
    </section>
  `;
}

function renderDashboard() {
  const task = appState.me.task;
  const active = appState.members.filter((member) => member.status === "1");
  const inactive = appState.members.filter((member) => member.status === "4");
  return `
    ${topbar()}
    <div class="grid dashboard-grid">
      ${statusPanel()}
      <section class="panel">
        ${summaryRow()}
        ${memberSection(`Aanwezige ${task.label} leden`, active)}
        ${memberSection(`Afwezige ${task.label} leden`, inactive)}
      </section>
    </div>
  `;
}

function renderApp() {
  const page = location.hash === "#ledenbeheer" ? "ledenbeheer" : "dashboard";
  app.innerHTML = page === "ledenbeheer" ? memberAdminPage() : renderDashboard();
}

async function refresh() {
  const [me, members] = await Promise.all([
    api("/api/auth/me"),
    api("/api/side-tasks/members")
  ]);
  appState.me = me;
  appState.members = members.members;
  appState.statuses = me.statuses || members.statuses || [];
  renderApp();
}

async function init() {
  try {
    await refresh();
  } catch (error) {
    const params = new URLSearchParams(location.search);
    const authError = params.get("authError");
    const messages = {
      forbidden: "Je hebt geen rol voor deze neventaak.",
      discord: "Discord login of rolcheck is mislukt.",
      session: "Discord login sessie klopt niet. Probeer opnieuw."
    };
    loginView(messages[authError] || "");
  }
}

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "logout") {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      loginView();
      return;
    }
    if (action === "toggle-profile") {
      appState.profileOpen = !appState.profileOpen;
      renderApp();
      return;
    }
    if (action === "open-member-admin") {
      appState.profileOpen = false;
      location.hash = "ledenbeheer";
      renderApp();
      return;
    }
    if (action === "open-dashboard") {
      appState.profileOpen = false;
      history.replaceState(null, "", location.pathname + location.search);
      renderApp();
      return;
    }
    if (action === "set-status") {
      const result = await api("/api/side-tasks/me/status", {
        method: "POST",
        body: JSON.stringify({ status: button.dataset.status })
      });
      await refresh();
      if (result.warning) alert(result.warning);
      return;
    }
    if (action === "delete-member") {
      if (!confirm("Weet je zeker dat je dit lid wil verwijderen?")) return;
      await api(`/api/side-tasks/members/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
      await refresh();
    }
  } catch (error) {
    alert(error.message);
  }
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.dataset.form === "profile") {
      await api("/api/side-tasks/me/profile", { method: "POST", body: JSON.stringify(data) });
    }
    if (form.dataset.form === "add-member") {
      await api("/api/side-tasks/members", { method: "POST", body: JSON.stringify(data) });
      form.reset();
    }
    if (form.dataset.form === "edit-member") {
      const result = await api(`/api/side-tasks/members/${encodeURIComponent(form.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify(data)
      });
      if (result.warning) alert(result.warning);
    }
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

window.addEventListener("hashchange", () => {
  if (appState.me) renderApp();
});

init();
