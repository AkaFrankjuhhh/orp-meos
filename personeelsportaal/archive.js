/* Defensie Personeelsportaal archiefmodule: personeelsarchief en ontslag-overzicht. */

function renderArchive() {
  const query = $("#archiveSearchInput")?.value.toLowerCase() || "";
  const archived = state.people
    .filter((person) => person.status === "Ontslagen" || person.status === "Gearchiveerd")
    .filter((person) => {
      const haystack = `${person.name} ${person.rank} ${person.previousServiceNumber} ${person.dismissalReason} ${person.status}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => new Date(b.dismissalDate || 0) - new Date(a.dismissalDate || 0));

  $("#archiveList").innerHTML = archived.length
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
            <div class="person-actions">
              <button class="ghost" type="button" data-restore="${person.id}">Herintrede</button>
              <button class="danger" type="button" data-delete-archive="${person.id}">Voorgoed verwijderen</button>
            </div>
          </article>
        `)
        .join("")
    : '<div class="feed-item">Geen profielen in het archief.</div>';
}

function renderResignationOverview() {
  const container = $("#resignationOverview");
  if (!container) return;
  if (!hasKaderAccess()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const forms = (state.resignationForms || [])
    .filter((form) => !["Verwerkt", "Geannuleerd"].includes(form.status || "Ingediend"))
    .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));
  container.innerHTML = forms.length
    ? forms.map((form) => `
      <article class="resignation-overview-card">
        <div class="resignation-overview-head">
          <strong>${escapeHtml(form.name || memberName(form.memberId))}</strong>
          <span>${escapeHtml(form.rank || "-")}</span>
          <span>${escapeHtml(formatDate(form.requestedAt))}</span>
          <div class="resignation-overview-actions">
            <button class="primary small" type="button" data-resignation-process="${escapeHtml(form.id)}">Verwerkt</button>
            <button class="ghost small" type="button" data-resignation-cancel="${escapeHtml(form.id)}">Annuleren</button>
            <button class="danger small" type="button" data-resignation-delete="${escapeHtml(form.id)}">Verwijderen</button>
          </div>
        </div>
        <div class="resignation-overview-reason">
          <span>Reden</span>
          <p>${escapeHtml(form.reason || "-")}</p>
        </div>
      </article>
    `).join("")
    : '<div class="feed-item">Geen openstaande ontslagformulieren.</div>';
}

window.DefensiePortalModules.registerFeature("archive", { ready: true });
