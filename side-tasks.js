const app = document.querySelector("#app");

let appState = {
  me: null,
  members: [],
  statuses: []
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
      Status ${status.value}<br><span>${escapeHtml(status.label)}</span>
    </button>
  `;
}

function profilePanel() {
  const { member, task, permissions } = appState.me;
  const aliasFields = task.allowAlias ? `
    <form class="profile-form" data-form="profile">
      <label>DSI roepnummer
        <input name="callSign" value="${escapeHtml(member?.callSign || "")}" placeholder="A-01" />
      </label>
      <label>Schuilnaam
        <input name="aliasName" value="${escapeHtml(member?.aliasName || "")}" placeholder="Schuilnaam" />
      </label>
      <button class="secondary-button" type="submit">Profiel opslaan</button>
    </form>
  ` : "";
  return `
    <section class="panel">
      <h2>Mijn status</h2>
      <p class="muted">${escapeHtml(task.displayName)}</p>
      <div class="status-grid">
        ${appState.statuses.map((status) => statusButton(status, member?.status || "8")).join("")}
      </div>
      ${aliasFields}
      ${permissions.canManageMembers ? managerPanel() : ""}
    </section>
  `;
}

function managerPanel() {
  return `
    <div class="manager-block">
      <h2>Ledenbeheer</h2>
      <form class="manager-form" data-form="add-member">
        <label>Discord ID
          <input name="discordId" placeholder="Discord ID" required />
        </label>
        <label>Naam
          <input name="displayName" placeholder="Optioneel, wordt anders via Discord gevuld" />
        </label>
        ${appState.me.task.allowAlias ? `
          <label>DSI roepnummer
            <input name="callSign" placeholder="A-01" />
          </label>
          <label>Schuilnaam
            <input name="aliasName" placeholder="Schuilnaam" />
          </label>
        ` : ""}
        <button class="primary-button" type="submit">Lid toevoegen</button>
      </form>
    </div>
  `;
}

function summaryRow() {
  const active = appState.members.filter((member) => member.isActive);
  const inactive = appState.members.filter((member) => !member.isActive);
  const specialties = new Set(active.flatMap((member) => member.specialties || []));
  return `
    <div class="summary-row">
      <div class="summary-tile"><span class="muted">Totaal</span><strong>${appState.members.length}</strong></div>
      <div class="summary-tile"><span class="muted">Aanwezig</span><strong>${active.length}</strong></div>
      <div class="summary-tile"><span class="muted">Niet aanwezig</span><strong>${inactive.length}</strong></div>
      <div class="summary-tile"><span class="muted">Specialisaties actief</span><strong>${specialties.size}</strong></div>
    </div>
  `;
}

function memberCard(member) {
  const { task, permissions } = appState.me;
  const canManage = permissions.canManageMembers;
  const statusClass = member.isActive ? "active" : "inactive";
  const specialties = member.specialties?.length
    ? member.specialties.map((label) => `<span class="specialty-chip">${escapeHtml(label)}</span>`).join("")
    : `<span class="specialty-chip">Geen specialisatie</span>`;
  const editControls = canManage ? `
    <form class="edit-grid" data-form="edit-member" data-id="${escapeHtml(member.id)}">
      <label>Naam
        <input name="displayName" value="${escapeHtml(member.displayName)}" />
      </label>
      <label>Status
        <select name="status">
          ${appState.statuses.map((status) => `<option value="${status.value}" ${status.value === member.status ? "selected" : ""}>Status ${status.value} - ${escapeHtml(status.label)}</option>`).join("")}
        </select>
      </label>
      ${task.allowAlias ? `
        <label>DSI roepnummer
          <input name="callSign" value="${escapeHtml(member.callSign)}" />
        </label>
        <label>Schuilnaam
          <input name="aliasName" value="${escapeHtml(member.aliasName)}" />
        </label>
      ` : ""}
      <div class="button-row">
        <button class="secondary-button" type="submit">Opslaan</button>
        <button class="danger-button" type="button" data-action="delete-member" data-id="${escapeHtml(member.id)}">Verwijderen</button>
      </div>
    </form>
  ` : "";
  return `
    <article class="member-card ${member.isActive ? "" : "inactive"}">
      <div class="member-main">
        ${memberAvatar(member)}
        <div>
          <p class="member-name">${escapeHtml(displayMemberName(member, task))}</p>
          <p class="muted">${escapeHtml(member.displayName)}${member.callSign ? ` · ${escapeHtml(member.callSign)}` : ""}</p>
        </div>
        <span class="status-pill ${statusClass}">${escapeHtml(member.statusLabel)}</span>
      </div>
      <div class="chips">${specialties}</div>
      ${editControls}
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

function renderApp() {
  const task = appState.me.task;
  const active = appState.members.filter((member) => member.isActive);
  const inactive = appState.members.filter((member) => !member.isActive);
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">ORP Neventaken</p>
        <h1>${escapeHtml(task.label)}</h1>
        <p class="muted">${escapeHtml(task.displayName)}</p>
      </div>
      <div class="user-chip">
        ${appState.me.user.avatarUrl ? `<img class="avatar" src="${escapeHtml(appState.me.user.avatarUrl)}" alt="" />` : `<div class="avatar"></div>`}
        <strong>${escapeHtml(appState.me.user.displayName)}</strong>
        <button class="secondary-button" data-action="logout">Uitloggen</button>
      </div>
    </header>
    <div class="grid">
      ${profilePanel()}
      <section class="panel">
        ${summaryRow()}
        ${memberSection(`Aanwezige ${task.label} leden`, active)}
        ${memberSection(`Niet aanwezige ${task.label} leden`, inactive)}
      </section>
    </div>
  `;
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
    if (action === "set-status") {
      await api("/api/side-tasks/me/status", {
        method: "POST",
        body: JSON.stringify({ status: button.dataset.status })
      });
      await refresh();
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
      await api(`/api/side-tasks/members/${encodeURIComponent(form.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify(data)
      });
    }
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

init();
