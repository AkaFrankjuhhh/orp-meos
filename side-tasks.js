const app = document.querySelector("#app");

let appState = {
  me: null,
  members: [],
  statuses: [],
  profileOpen: false,
  dsiContextMenu: null,
  archives: [],
  memberEditId: ""
};
const LIVE_REFRESH_INTERVAL_MS = 60000;
let liveRefreshInFlight = false;
let liveEventSource = null;
let liveReconnectTimer = null;

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
  if (task.allowAlias && member.aliasName) {
    const number = aliasNumberForDisplay(member, task);
    const prefix = ["ACO", "TCO"].includes(member.commandRole) ? `${member.commandRole} ` : "";
    if (number) return `${prefix}[${number}] ${member.aliasName}`;
  }
  return member.displayName || member.discordId;
}

function aliasNumberForDisplay(member, task) {
  if (task.key === "KLU") return member.callSign || task.aliasProfile?.numberPlaceholder || "Eagle";
  return (member.commandRole && member.unitNumber) || ((member.status === "1" || member.status === "4") && member.unitNumber)
    ? member.unitNumber
    : member.callSign;
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

function openProfileDraft() {
  const form = app.querySelector('form[data-form="profile"]');
  if (!form) return {};
  const fields = Object.fromEntries(new FormData(form).entries());
  return {
    callSign: String(fields.callSign || ""),
    aliasName: String(fields.aliasName || ""),
    undercover: Boolean(fields.undercover)
  };
}

function aliasProfileFields(member = {}, task = appState.me?.task || {}) {
  if (!task.allowAlias) return "";
  const profile = task.aliasProfile || {};
  const isRankNumber = profile.numberSource === "rank";
  return `
    <label>${escapeHtml(profile.numberLabel || "Roepnummer")}
      <input name="callSign" value="${escapeHtml(member.callSign || "")}" placeholder="${escapeHtml(profile.numberPlaceholder || "")}" ${isRankNumber ? "readonly" : ""} />
    </label>
    <label>${escapeHtml(profile.aliasLabel || "Schuilnaam")}
      <input name="aliasName" value="${escapeHtml(member.aliasName || "")}" placeholder="${escapeHtml(profile.aliasPlaceholder || "")}" />
    </label>
    ${profile.supportsUndercover ? `
      <label class="toggle-line ${member.undercover ? "is-on" : "is-off"}">
        <span>Undercover</span>
        <input name="undercover" type="checkbox" ${member.undercover ? "checked" : ""} />
        <span class="toggle-pill" aria-hidden="true"></span>
      </label>
    ` : ""}
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
        ${aliasProfileFields(member || {}, task)}
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
  const statusClass = member.status === "1" ? "active" : member.status === "0" ? "pending" : "inactive";
  const specialties = member.specialties?.length
    ? member.specialties.map((label) => `<span class="specialty-chip">${escapeHtml(label)}</span>`).join("")
    : `<span class="specialty-chip">Geen specialisatie</span>`;
  return `
    <article class="member-card ${statusClass === "active" ? "" : statusClass}"${task.key === "DSI" ? ` data-dsi-member="${escapeHtml(member.id)}"` : ""}>
      <div class="member-main">
        ${memberAvatar(member)}
        <div>
          <p class="member-name">${escapeHtml(displayMemberName(member, task))}</p>
          <p class="muted">${escapeHtml(member.displayName)}${member.commandRole ? ` / ${escapeHtml(member.commandRole)}` : ""}</p>
          ${member.phone ? `<p class="muted">${escapeHtml(member.phone)}</p>` : ""}
        </div>
        <span class="status-pill ${statusClass}">${escapeHtml(member.statusLabel)}</span>
      </div>
      <div class="chips">${specialties}</div>
    </article>
  `;
}

function dsiUnitSection() {
  const units = new Map();
  const pendingMembers = appState.members.filter((member) => member.status === "0");
  const unitPrefix = String(appState.me.task?.dsiUnits?.prefix || "50");
  const capacity = Number(appState.me.task?.dsiUnits?.capacity || 3);
  appState.members
    .filter((member) => member.status !== "8" && member.unitNumber)
    .forEach((member) => {
      const group = units.get(member.unitNumber) || [];
      group.push(member);
      units.set(member.unitNumber, group);
    });
  const cards = [...units.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "nl", { numeric: true }))
    .map(([unitNumber, members]) => `
      <article class="dsi-unit-card">
        <div class="dsi-unit-head"><strong>${escapeHtml(unitNumber)}</strong><span>${members.length}/${capacity} personen</span></div>
        ${members.map((member) => `
          <button class="dsi-unit-member" type="button" data-dsi-member="${escapeHtml(member.id)}">
            ${memberAvatar(member)}
            <span>${escapeHtml(displayMemberName(member, appState.me.task))}</span>
            <small>${escapeHtml(member.statusLabel)}</small>
          </button>
        `).join("")}
      </article>`)
    .join("");
  return `
    <section class="member-section dsi-units">
      <h2>DSI-eenheden</h2>
      <div class="dsi-unit-grid">${cards || `<p class="muted">Nog geen actieve ${escapeHtml(unitPrefix)}-eenheden.</p>`}</div>
      ${pendingMembers.length ? `
        <div class="dsi-pending-members">
          ${pendingMembers.map((member) => `
            <button class="dsi-unit-member" type="button" data-dsi-member="${escapeHtml(member.id)}">
              ${memberAvatar(member)}
              <span>${escapeHtml(displayMemberName(member, appState.me.task))}</span>
              <small>Nog in te delen</small>
            </button>
          `).join("")}
        </div>
      ` : ""}
    </section>
  `;
}

function dsiContextMenu() {
  const context = appState.dsiContextMenu;
  if (!context || appState.me?.task?.key !== "DSI") return "";
  const member = appState.members.find((entry) => entry.id === context.memberId);
  if (!member) return "";
  const permissions = appState.me.permissions || {};
  const isOwnProfile = member.discordId === appState.me.user.id;
  if (!isOwnProfile && !permissions.canManageDsiUnits) return "";
  const unitCounts = new Map();
  appState.members
    .filter((entry) => entry.status !== "8" && entry.unitNumber)
    .forEach((entry) => unitCounts.set(entry.unitNumber, (unitCounts.get(entry.unitNumber) || 0) + 1));
  const firstRegularUnit = Number(appState.me.task?.dsiUnits?.min || 3);
  const unitPrefix = String(appState.me.task?.dsiUnits?.prefix || "50");
  const capacity = Number(appState.me.task?.dsiUnits?.capacity || 3);
  const units = [...unitCounts.entries()]
    .filter(([unitNumber, count]) => Number(unitNumber.slice(3)) >= firstRegularUnit && unitNumber !== member.unitNumber && count < capacity)
    .map(([unitNumber]) => unitNumber)
    .sort((left, right) => left.localeCompare(right, "nl", { numeric: true }));
  const style = `left:${context.x}px;top:${context.y}px;`;
  return `
    <div class="dsi-context-menu" data-dsi-context-menu style="${style}">
      <div class="dsi-context-title">${escapeHtml(displayMemberName(member, appState.me.task))}</div>
      ${context.mode === "link" ? `
        <label>Koppel aan bestaande ${escapeHtml(unitPrefix)}-eenheid
          <select data-dsi-unit-select ${units.length ? "" : "disabled"}>
            ${units.length ? units.map((unitNumber) => `<option value="${escapeHtml(unitNumber)}">${escapeHtml(unitNumber)}</option>`).join("") : `<option>Geen vrije ${escapeHtml(unitPrefix)}-eenheid</option>`}
          </select>
        </label>
        <div class="dsi-context-actions">
          <button class="secondary-button" type="button" data-action="dsi-close-menu">Annuleren</button>
          <button class="primary-button" type="button" data-action="dsi-confirm-link" ${units.length ? "" : "disabled"}>Koppelen</button>
        </div>
      ` : `
        <button type="button" data-action="dsi-open-link-menu">Koppel aan bestaand ${escapeHtml(unitPrefix)}-nummer</button>
        ${member.status !== "8" ? `<button type="button" data-action="dsi-sign-off-member">Uit dienst melden</button>` : ""}
        ${permissions.canAssignDsiCommand ? `
          <button type="button" data-action="dsi-set-command-role" data-command-role="ACO">ACO toewijzen</button>
          <button type="button" data-action="dsi-set-command-role" data-command-role="TCO">TCO toewijzen</button>
          ${member.commandRole ? `<button type="button" data-action="dsi-set-command-role" data-command-role="">ACO/TCO verwijderen</button>` : ""}
        ` : ""}
        <button class="dsi-context-close" type="button" data-action="dsi-close-menu">Sluiten</button>
      `}
    </div>
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
    <tr class="member-admin-row" data-admin-member="${escapeHtml(member.id)}">
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(alias)}</td>
      <td>${escapeHtml(member.callSign || "-")}</td>
      <td>${escapeHtml(specialties)}</td>
      <td>${escapeHtml(member.statusLabel || "-")}</td>
    </tr>
  `;
}

function archiveAdminRows() {
  return appState.archives.map((archive) => `
    <tr>
      <td>${escapeHtml(archive.displayName)}</td>
      <td>${escapeHtml(archive.aliasName || "-")}</td>
      <td>${escapeHtml(archive.callSign || "-")}</td>
      <td>${escapeHtml(archive.archivedAt ? new Date(archive.archivedAt).toLocaleString("nl-NL") : "-")}</td>
      <td>
        <form class="archive-reason-form" data-form="archive-reason" data-id="${escapeHtml(archive.id)}">
          <input name="reason" value="${escapeHtml(archive.reason || "")}" placeholder="Reden van vertrek" maxlength="400" />
          <button class="secondary-button" type="submit">Opslaan</button>
        </form>
      </td>
    </tr>
  `).join("");
}

function memberEditModal() {
  const member = appState.members.find((entry) => entry.id === appState.memberEditId);
  if (!member || !appState.me?.permissions?.canManageMembers) return "";
  const task = appState.me.task;
  const profile = task.aliasProfile || {};
  const isRankNumber = profile.numberSource === "rank";
  return `
    <div class="member-edit-backdrop">
      <section class="member-edit-modal" role="dialog" aria-modal="true" aria-label="Lid aanpassen">
        <div class="page-heading">
          <div><p class="eyebrow">${escapeHtml(task.label)} ledenbeheer</p><h2>${escapeHtml(member.aliasName || member.displayName)}</h2></div>
          <button class="secondary-button" type="button" data-action="close-member-edit">Sluiten</button>
        </div>
        <form class="edit-grid" data-form="edit-member" data-id="${escapeHtml(member.id)}">
          <label>Naam
            <input name="displayName" value="${escapeHtml(member.displayName)}" maxlength="120" required />
          </label>
          <label>Telefoonnummer
            <input name="phone" value="${escapeHtml(member.phone || "")}" maxlength="32" />
          </label>
          <label>${escapeHtml(profile.numberLabel || "Roepnummer")}
            <input name="callSign" value="${escapeHtml(member.callSign || "")}" maxlength="32" ${isRankNumber ? "readonly" : ""} />
          </label>
          <label>${escapeHtml(profile.aliasLabel || "Schuilnaam")}
            <input name="aliasName" value="${escapeHtml(member.aliasName || "")}" maxlength="80" />
          </label>
          ${profile.supportsUndercover ? `
            <label class="toggle-line ${member.undercover ? "is-on" : "is-off"}">
              <span>Undercover</span>
              <input name="undercover" type="checkbox" ${member.undercover ? "checked" : ""} />
              <span class="toggle-pill" aria-hidden="true"></span>
            </label>
          ` : ""}
          <button class="primary-button" type="submit">Wijzigingen opslaan</button>
        </form>
      </section>
    </div>
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
      ${task.key === "DSI" ? `
        <section class="archive-section">
          <h3>DSI ledenarchief</h3>
          <p class="muted">Leden waarvan de DSI-rol is verwijderd. Pas hier de vertrekreden aan.</p>
          <div class="member-admin-list">
            <table>
              <thead><tr><th>Naam</th><th>Schuilnaam</th><th>Roepnummer</th><th>Gearchiveerd op</th><th>Vertrekreden</th></tr></thead>
              <tbody>${archiveAdminRows() || `<tr><td colspan="5">Geen gearchiveerde DSI-leden.</td></tr>`}</tbody>
            </table>
          </div>
        </section>
      ` : ""}
    </section>
  `;
}

function renderDashboard() {
  const task = appState.me.task;
  const inactive = appState.members.filter((member) => member.status === "4");
  return `
    ${topbar()}
    <div class="grid dashboard-grid">
      ${statusPanel()}
      <section class="panel">
        ${summaryRow()}
        ${task.key === "DSI" ? dsiUnitSection() : ""}
        ${task.key === "DSI" ? "" : memberSection(`Aanwezige ${task.label} leden`, appState.members.filter((member) => member.status === "1"))}
        ${memberSection(`Afwezige ${task.label} leden`, inactive)}
      </section>
    </div>
  `;
}

function renderApp() {
  const page = location.hash === "#ledenbeheer" ? "ledenbeheer" : "dashboard";
  app.innerHTML = `${page === "ledenbeheer" ? memberAdminPage() : renderDashboard()}${dsiContextMenu()}${memberEditModal()}`;
}

async function refresh() {
  const me = await api("/api/auth/me");
  const [members, archives] = await Promise.all([
    api("/api/side-tasks/members"),
    me.permissions?.canManageMembers && me.task?.key === "DSI"
      ? api("/api/side-tasks/archive")
      : Promise.resolve({ archives: [] })
  ]);
  appState.me = me;
  appState.members = members.members;
  appState.statuses = me.statuses || members.statuses || [];
  appState.archives = archives.archives || [];
  renderApp();
}

function isEditingOrManaging() {
  if (appState.profileOpen || appState.dsiContextMenu || appState.memberEditId) return true;
  const activeElement = document.activeElement;
  return Boolean(activeElement?.matches?.("input, textarea, select"));
}

async function refreshLiveState() {
  if (liveRefreshInFlight || document.hidden || isEditingOrManaging()) return;
  liveRefreshInFlight = true;
  try {
    await refresh();
  } catch (error) {
    // Een tijdelijke netwerkfout mag een bestaande DSI-pagina niet naar het loginscherm sturen.
    console.warn("DSI live update mislukt:", error.message);
  } finally {
    liveRefreshInFlight = false;
  }
}

function scheduleLiveReconnect() {
  if (liveReconnectTimer) return;
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    connectLiveEvents();
  }, 5000);
}

function connectLiveEvents() {
  if (!window.EventSource || liveEventSource) return;
  liveEventSource = new EventSource("/api/events");
  liveEventSource.addEventListener("side-task:update", () => {
    refreshLiveState();
  });
  liveEventSource.onerror = () => {
    if (liveEventSource) {
      liveEventSource.close();
      liveEventSource = null;
    }
    scheduleLiveReconnect();
  };
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
    if (action === "close-member-edit") {
      appState.memberEditId = "";
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
      // Een open profielvenster bevat mogelijk nog niet opgeslagen invoer.
      // Stuur die samen met de status mee, zodat Status 0/1 nooit tegen een
      // oudere databaseversie van roepnummer of schuilnaam aanloopt.
      const nextStatus = String(button.dataset.status || "");
      const shouldIncludeAliasProfile = appState.me?.task?.allowAlias && nextStatus !== "8";
      const payload = { status: nextStatus, ...(shouldIncludeAliasProfile ? openProfileDraft() : {}) };
      const result = await api("/api/side-tasks/me/status", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await refresh();
      if (result.warning) alert(result.warning);
      return;
    }
    if (action === "dsi-close-menu") {
      appState.dsiContextMenu = null;
      renderApp();
      return;
    }
    if (action === "dsi-open-link-menu") {
      appState.dsiContextMenu = { ...appState.dsiContextMenu, mode: "link" };
      renderApp();
      return;
    }
    if (action === "dsi-confirm-link") {
      const context = appState.dsiContextMenu;
      const select = app.querySelector("[data-dsi-unit-select]");
      if (!context || !select?.value) return;
      const result = await api(`/api/side-tasks/dsi/members/${encodeURIComponent(context.memberId)}/unit`, {
        method: "POST",
        body: JSON.stringify({ unitNumber: select.value })
      });
      appState.dsiContextMenu = null;
      await refresh();
      if (result.warning) alert(result.warning);
      return;
    }
    if (action === "dsi-sign-off-member") {
      const context = appState.dsiContextMenu;
      if (!context) return;
      const member = appState.members.find((entry) => entry.id === context.memberId);
      const label = member ? displayMemberName(member, appState.me.task) : "dit DSI-lid";
      if (!confirm(`${label} uit dienst melden?`)) return;
      const result = await api(`/api/side-tasks/dsi/members/${encodeURIComponent(context.memberId)}/sign-off`, {
        method: "POST",
        body: JSON.stringify({})
      });
      appState.dsiContextMenu = null;
      await refresh();
      if (result.warning) alert(result.warning);
      return;
    }
    if (action === "dsi-set-command-role") {
      const context = appState.dsiContextMenu;
      if (!context) return;
      const result = await api(`/api/side-tasks/dsi/members/${encodeURIComponent(context.memberId)}/command-role`, {
        method: "POST",
        body: JSON.stringify({ commandRole: button.dataset.commandRole || "" })
      });
      appState.dsiContextMenu = null;
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

app.addEventListener("contextmenu", (event) => {
  const target = event.target.closest("[data-dsi-member]");
  if (!target || appState.me?.task?.key !== "DSI") return;
  event.preventDefault();
  const member = appState.members.find((entry) => entry.id === target.dataset.dsiMember);
  if (!member) return;
  const permissions = appState.me.permissions || {};
  const isOwnProfile = member.discordId === appState.me.user.id;
  if (!isOwnProfile && !permissions.canManageDsiUnits) return;
  const menuWidth = 300;
  const menuHeight = 320;
  appState.dsiContextMenu = {
    memberId: member.id,
    mode: "actions",
    x: Math.min(event.clientX, window.innerWidth - menuWidth - 12),
    y: Math.min(event.clientY, window.innerHeight - menuHeight - 12)
  };
  renderApp();
});

document.addEventListener("click", (event) => {
  if (!appState.dsiContextMenu || event.target.closest("[data-dsi-context-menu]")) return;
  appState.dsiContextMenu = null;
  renderApp();
});

app.addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-form]");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (form.querySelector("input[name='undercover']")) {
    data.undercover = Boolean(form.querySelector("input[name='undercover']")?.checked);
  }
  try {
    if (form.dataset.form === "profile") {
      const result = await api("/api/side-tasks/me/profile", { method: "POST", body: JSON.stringify(data) });
      if (result.warning) alert(result.warning);
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
      appState.memberEditId = "";
    }
    if (form.dataset.form === "archive-reason") {
      await api(`/api/side-tasks/archive/${encodeURIComponent(form.dataset.id)}`, {
        method: "PATCH",
        body: JSON.stringify(data)
      });
    }
    await refresh();
  } catch (error) {
    alert(error.message);
  }
});

app.addEventListener("contextmenu", (event) => {
  const row = event.target.closest("[data-admin-member]");
  if (!row || !appState.me?.permissions?.canManageMembers) return;
  event.preventDefault();
  appState.memberEditId = row.dataset.adminMember;
  renderApp();
});

window.addEventListener("hashchange", () => {
  if (appState.me) renderApp();
});

init();
connectLiveEvents();
setInterval(refreshLiveState, LIVE_REFRESH_INTERVAL_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshLiveState();
});
