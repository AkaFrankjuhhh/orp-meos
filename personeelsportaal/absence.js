/* Defensie Personeelsportaal afwezigheidsmodule: statussen, overzicht en verwijdercontext. */

function openAbsenceRequestCount() {
  return (state.absences || []).filter(absenceNeedsReview).length;
}

function absenceStatus(entry) {
  return entry.status || "In afwachting";
}

function absenceIsApproved(entry) {
  return absenceStatus(entry) === "Goedgekeurd";
}

function absenceDateOnly(value) {
  const dateText = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return null;
  return dateText;
}

function absenceIsActive(entry) {
  return absenceIsApproved(entry) && absencePeriodIncludesToday(entry);
}

function absencePeriodIncludesToday(entry) {
  const from = absenceDateOnly(entry?.from);
  const to = absenceDateOnly(entry?.to);
  const current = absenceDateOnly(today) || new Date().toISOString().slice(0, 10);
  if (!from || !to) return false;
  return from <= current && current <= to;
}

function absenceMember(entry) {
  const member = (state.people || []).find((person) => person.id === entry.memberId);
  return member || null;
}

function absenceMemberIsActive(entry) {
  const member = absenceMember(entry);
  return Boolean(member && !["Ontslagen", "Gearchiveerd"].includes(member.status));
}

function absenceNeedsReview(entry) {
  return absenceStatus(entry) === "In afwachting" && absenceMemberIsActive(entry);
}

function absenceVisibleInCurrentOverview(entry) {
  return absenceIsActive(entry) && absenceMemberIsActive(entry);
}

function personHasActiveAbsence(person) {
  return (state.absences || []).some((entry) => entry.memberId === person.id && absenceIsActive(entry));
}

function activeInvestigationStatusFor(person) {
  return person?.ioStatus?.active ? person.ioStatus : null;
}

function statusInfoFor(person) {
  const investigation = activeInvestigationStatusFor(person);
  if (investigation) {
    const setBy = investigation.setByName || "Onbekend";
    const reason = investigation.reason ? `\nReden: ${investigation.reason}` : "";
    return {
      label: "I.O",
      className: "io",
      title: `I.O - In overleg / in onderzoek\nOp naam gezet door: ${setBy}${reason}`
    };
  }
  if (personHasActiveAbsence(person)) return { label: "Afwezig", className: "absent", title: "Afwezig" };
  const status = person.status || "Actief";
  if (status === "Non-Actief") return { label: status, className: "non-active", title: status };
  if (status === "I.O") return { label: status, className: "io", title: "I.O - In overleg / in onderzoek" };
  return { label: "Actief", className: "active", title: "Actief" };
}

function renderAbsenceOverview() {
  const container = $("#absenceOverview");
  if (!container) return;
  if (!canViewAbsenceOverview()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const canReview = canReviewAbsences();
  const allAbsences = (state.absences || [])
    .map((entry, originalIndex) => ({ ...entry, originalIndex }));
  const reviewAbsences = canReview
    ? allAbsences.filter(absenceNeedsReview).sort((a, b) => new Date(a.from) - new Date(b.from))
    : [];
  const currentAbsences = allAbsences
    .filter(absenceVisibleInCurrentOverview)
    .sort((a, b) => new Date(a.from) - new Date(b.from));

  const renderAbsenceRows = (absences) => `
      <div class="table-row table-row-head absence-overview-row${canReview ? "" : " absence-overview-row--readonly"}">
        <span>Personeelslid</span>
        <span>Vanaf</span>
        <span>Tot en met</span>
        <span>Status</span>
        <span>Reden</span>
        ${canReview ? "<span>Acties</span>" : ""}
      </div>
      ${absences.map((entry) => {
        const absenceKey = entry.id || String(entry.originalIndex);
        return `
          <div class="table-row absence-overview-row${canReview ? "" : " absence-overview-row--readonly"}" data-absence-id="${escapeHtml(absenceKey)}">
            <strong>${escapeHtml(memberName(entry.memberId))}</strong>
            <span>${escapeHtml(formatDate(entry.from))}</span>
            <span>${escapeHtml(formatDate(entry.to))}</span>
            <span>${escapeHtml(absenceStatus(entry))}</span>
            <span>${escapeHtml(entry.reason || "-")}</span>
            ${canReview ? `<span class="person-actions absence-actions">
              ${absenceStatus(entry) !== "Goedgekeurd" ? `<button class="ghost small approve" type="button" data-absence-approve="${escapeHtml(absenceKey)}">Goedkeuren</button>` : ""}
              ${absenceStatus(entry) !== "Afgekeurd" ? `<button class="ghost small danger" type="button" data-absence-reject="${escapeHtml(absenceKey)}">Afkeuren</button>` : ""}
            </span>` : ""}
          </div>
        `;
      }).join("")}
    `;

  const renderAbsenceSection = (title, absences, emptyText) => `
    <section class="absence-overview-section">
      <h3>${escapeHtml(title)}</h3>
      ${absences.length ? renderAbsenceRows(absences) : `<div class="feed-item">${escapeHtml(emptyText)}</div>`}
    </section>
  `;

  container.innerHTML = [
    canReview ? renderAbsenceSection("Aanvragen in afwachting", reviewAbsences, "Geen openstaande afwezigheidsaanvragen.") : "",
    renderAbsenceSection("Huidige afwezigheden", currentAbsences, "Geen huidige afwezigheden.")
  ].join("");
}

function hideAbsenceContextMenu() {
  const menu = $("#absenceContextMenu");
  if (!menu) return;
  menu.hidden = true;
}

function openAbsenceContextMenu(event, absenceId) {
  if (!absenceId || !hasKaderAccess()) return;
  event.preventDefault();
  pendingAbsenceId = absenceId;
  const menu = $("#absenceContextMenu");
  menu.hidden = false;
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
}

function openDeleteAbsenceDialog() {
  hideAbsenceContextMenu();
  const absence = (state.absences || []).find((entry, index) => (entry.id || String(index)) === pendingAbsenceId);
  if (!absence || !hasKaderAccess()) return;
  $("#deleteAbsenceId").value = pendingAbsenceId;
  $("#deleteAbsenceText").textContent = `Weet je zeker dat je de afwezigheid van ${memberName(absence.memberId)} wil verwijderen?`;
  $("#deleteAbsenceDialog").showModal();
}

window.DefensiePortalModules.registerFeature("absence", { ready: true });
