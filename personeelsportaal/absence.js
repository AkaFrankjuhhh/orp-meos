/* Defensie Personeelsportaal afwezigheidsmodule: statussen, overzicht en verwijdercontext. */

function openAbsenceRequestCount() {
  return (state.absences || []).filter((entry) => absenceStatus(entry) === "In afwachting").length;
}

function absenceStatus(entry) {
  return entry.status || "In afwachting";
}

function absenceIsApproved(entry) {
  return absenceStatus(entry) === "Goedgekeurd";
}

function absenceIsActive(entry) {
  return absenceIsApproved(entry) && new Date(entry.to) >= new Date(today);
}

function personHasActiveAbsence(person) {
  return (state.absences || []).some((entry) => entry.memberId === person.id && absenceIsActive(entry));
}

function statusInfoFor(person) {
  if (personHasActiveAbsence(person)) return { label: "Afwezig", className: "absent" };
  const status = person.status || "Actief";
  if (status === "Non-Actief") return { label: status, className: "non-active" };
  if (status === "I.O") return { label: status, className: "io" };
  return { label: "Actief", className: "active" };
}

function renderAbsenceOverview() {
  const container = $("#absenceOverview");
  if (!container) return;
  if (!canReviewAbsences()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const absences = (state.absences || [])
    .map((entry, originalIndex) => ({ ...entry, originalIndex }))
    .sort((a, b) => new Date(a.from) - new Date(b.from));
  container.innerHTML = absences.length
    ? `
      <div class="table-row table-row-head absence-overview-row">
        <span>Personeelslid</span>
        <span>Vanaf</span>
        <span>Tot en met</span>
        <span>Status</span>
        <span>Reden</span>
      </div>
      ${absences.map((entry) => {
        const absenceKey = entry.id || String(entry.originalIndex);
        return `
          <div class="table-row absence-overview-row" data-absence-id="${escapeHtml(absenceKey)}">
            <strong>${escapeHtml(memberName(entry.memberId))}</strong>
            <span>${escapeHtml(formatDate(entry.from))}</span>
            <span>${escapeHtml(formatDate(entry.to))}</span>
            <span>${escapeHtml(absenceStatus(entry))}</span>
            <span>${escapeHtml(entry.reason || "-")}</span>
            <span class="person-actions absence-actions">
              ${absenceStatus(entry) !== "Goedgekeurd" ? `<button class="ghost small approve" type="button" data-absence-approve="${escapeHtml(absenceKey)}">Goedkeuren</button>` : ""}
              ${absenceStatus(entry) !== "Afgekeurd" ? `<button class="ghost small danger" type="button" data-absence-reject="${escapeHtml(absenceKey)}">Afkeuren</button>` : ""}
            </span>
          </div>
        `;
      }).join("")}
    `
    : '<div class="feed-item">Geen afwezigheden geregistreerd.</div>';
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
