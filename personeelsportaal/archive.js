/* Defensie Personeelsportaal archiefmodule: personeelsarchief en ontslag-overzicht. */

function archiveDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function renderArchive() {
  const container = $("#archiveList");
  if (!container) return;
  if (!canViewPersonnelArchive()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const query = $("#archiveSearchInput")?.value.toLowerCase() || "";
  const activeBlacklistIds = new Set((state.blacklist || []).filter((entry) => !entry.revokedAt).map((entry) => archiveDiscordId(entry.discordId)));
  const archived = state.people
    .filter((person) => person.status === "Ontslagen" || person.status === "Gearchiveerd")
    .filter((person) => {
      const haystack = `${person.name} ${person.rank} ${person.previousServiceNumber} ${person.dismissalReason} ${person.status}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => new Date(b.dismissalDate || 0) - new Date(a.dismissalDate || 0));

  container.innerHTML = archived.length
    ? archived
        .map((person) => `
          <article class="person-card">
            <div class="person-head">
              <img class="avatar" src="${avatarFor(person)}" alt="" />
              <div>
                <span class="person-label">Naam</span>
                <h2>${escapeHtml(person.name)}</h2>
                <p class="muted">Oud nummer ${escapeHtml(person.previousServiceNumber || "-")}</p>
              </div>
            </div>
            <div class="badges">
              <span class="badge">${escapeHtml(person.status)}</span>
            </div>
            <div class="person-meta">
              <span>Rang: ${escapeHtml(person.rank || "-")}</span>
              <span>Ontslagdatum: ${escapeHtml(formatDate(person.dismissalDate))}</span>
              <span>In archief tot: ${escapeHtml(formatDate(person.archivedUntil))}</span>
              <span>Dienstnummer vrijgegeven</span>
            </div>
            <div class="archive-reason">
              <span class="person-label">Ontslag Reden</span>
              <p>${escapeHtml(person.dismissalReason || "-")}</p>
            </div>
            ${hasKaderAccess() ? `<div class="person-actions">
              <button class="ghost" type="button" data-restore="${person.id}">Herintrede</button>
              ${hasKaderAccess() && person.discordId && !activeBlacklistIds.has(archiveDiscordId(person.discordId))
                ? `<button class="ghost danger" type="button" data-blacklist-person="${person.id}">Blacklist</button>`
                : ""}
              ${activeBlacklistIds.has(archiveDiscordId(person.discordId)) ? '<span class="badge danger-badge">Blacklisted</span>' : ""}
              <button class="danger" type="button" data-delete-archive="${person.id}">Voorgoed verwijderen</button>
            </div>` : ""}
          </article>
        `)
        .join("")
    : '<div class="feed-item">Geen profielen in het archief.</div>';
}

function renderBlacklist() {
  const container = $("#blacklistList");
  if (!container) return;
  if (!canViewBlacklist()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const query = $("#blacklistSearchInput")?.value.toLowerCase() || "";
  const entries = (state.blacklist || [])
    .filter((entry) => !entry.revokedAt)
    .filter((entry) => {
      const haystack = `${entry.name} ${entry.rank} ${entry.serviceNumber} ${entry.discordId} ${entry.reason} ${entry.blacklistedByName}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => new Date(b.blacklistedAt || 0) - new Date(a.blacklistedAt || 0));

  container.innerHTML = entries.length
    ? entries.map((entry) => `
      <article class="person-card blacklist-card">
        <div class="person-head">
          <div>
            <span class="person-label">Naam</span>
            <h2>${escapeHtml(entry.name || "-")}</h2>
            <p class="muted">${escapeHtml(entry.rank || "-")} - ${escapeHtml(entry.serviceNumber || "Geen oud nummer")}</p>
          </div>
        </div>
        <div class="badges">
          <span class="badge danger-badge">Blacklisted</span>
        </div>
        <div class="person-meta">
          <span>Discord ID: ${escapeHtml(entry.discordId || "-")}</span>
          <span>Datum: ${escapeHtml(formatDate(entry.blacklistedAt))}</span>
          <span>Door: ${escapeHtml(entry.blacklistedByName || "-")}</span>
        </div>
        <div class="archive-reason">
          <span class="person-label">Reden</span>
          <p>${escapeHtml(entry.reason || "-")}</p>
        </div>
        ${hasKaderAccess() ? `
          <div class="person-actions">
            <button class="ghost" type="button" data-revoke-blacklist="${escapeHtml(entry.id)}">Blacklist intrekken</button>
          </div>
        ` : ""}
      </article>
    `).join("")
    : '<div class="feed-item">Geen personen op de blacklist.</div>';
}

function renderResignationOverview() {
  const container = $("#resignationOverview");
  if (!container) return;
  if (!canViewResignationOverview()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const allForms = (state.resignationForms || [])
    .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));
  const formDisplayStatus = (form) => isHandledResignationForm(form) && !["Verwerkt", "Geannuleerd"].includes(form.status || "Ingediend")
    ? "Verwerkt"
    : (form.status || "Ingediend");
  const formHandledAt = (form) => form.processedAt || form.cancelledAt || linkedResignationProfile(form)?.dismissalDate || "";
  const formHandledBy = (form) => form.processedByName || form.cancelledByName || "-";
  const openForms = allForms.filter((form) => !isHandledResignationForm(form));
  const handledForms = allForms.filter(isHandledResignationForm);
  const renderFormCard = (form, handled = false) => `
      <article class="resignation-overview-card">
        <div class="resignation-overview-head">
          <strong>${escapeHtml(form.name || memberName(form.memberId))}</strong>
          <span>${escapeHtml(form.rank || "-")}</span>
          <span>${escapeHtml(formatDate(form.requestedAt))}</span>
          <span class="resignation-overview-status">${escapeHtml(formDisplayStatus(form))}</span>
          ${!handled && hasKaderAccess() ? `<div class="resignation-overview-actions">
            <button class="primary small" type="button" data-resignation-process="${escapeHtml(form.id)}">Verwerkt</button>
            <button class="ghost small" type="button" data-resignation-cancel="${escapeHtml(form.id)}">Annuleren</button>
            <button class="danger small" type="button" data-resignation-delete="${escapeHtml(form.id)}">Verwijderen</button>
          </div>` : ""}
        </div>
        ${handled ? `<div class="resignation-overview-meta">
          <span>Afgehandeld: ${escapeHtml(formatDate(formHandledAt(form)))}</span>
          <span>Door: ${escapeHtml(formHandledBy(form))}</span>
        </div>` : ""}
        <div class="resignation-overview-reason">
          <span>Reden</span>
          <p>${escapeHtml(form.reason || "-")}</p>
        </div>
      </article>
    `;
  container.innerHTML = `
    <section class="resignation-overview-section">
      <h3>Openstaand</h3>
      ${openForms.length ? openForms.map((form) => renderFormCard(form)).join("") : '<div class="feed-item">Geen openstaande ontslagformulieren.</div>'}
    </section>
    <section class="resignation-overview-section">
      <h3>Afgehandeld</h3>
      ${handledForms.length ? handledForms.map((form) => renderFormCard(form, true)).join("") : '<div class="feed-item">Geen afgehandelde ontslagformulieren.</div>'}
    </section>
  `;
}

window.DefensiePortalModules.registerFeature("archive", { ready: true });
