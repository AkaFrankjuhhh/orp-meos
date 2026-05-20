/* pManager mentormodule: mentoroverzicht, checklist, traject en mentor-notities. */

function openMentorChecklist(profileId) {
  selectedMentorProfileId = profileId;
  renderMentorChecklist();
  setPage("mentor-checklist");
}

function mentorChecklistFor(person) {
  const checklist = person.mentorChecklist || {};
  const items = Array.isArray(checklist.items) ? checklist.items : [];
  const notes = Array.isArray(checklist.notes)
    ? checklist.notes
    : String(checklist.notes || "").trim()
      ? [
          {
            text: String(checklist.notes).trim(),
            createdAt: checklist.updatedAt || "",
            authorName: checklist.updatedByName || "Onbekend"
          }
        ]
      : [];
  const normalizedItems = mentorChecklistLabels.map((_, index) => Boolean(items[index]));
  return {
    completed: normalizedItems.length > 0 && normalizedItems.every(Boolean),
    items: normalizedItems,
    notes
  };
}

function mentorPeople() {
  return state.people
    .filter((person) => person.status === "Actief" && mentorRanks.includes(person.rank))
    .sort((a, b) => {
      const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
}

function renderMentorOverview() {
  const container = $("#mentorOverviewList");
  if (!container) return;
  if (!canViewMentorOverview()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const query = $("#mentorSearchInput")?.value.toLowerCase() || "";
  const people = mentorPeople().filter((person) => `${person.name} ${person.rank} ${person.serviceNumber}`.toLowerCase().includes(query));
  container.innerHTML = people.length
    ? `
      <div class="mentor-row mentor-row-head">
        <span>Naam</span>
        <span>Rang</span>
        <span>Aangenomen op</span>
        <span>Voortgang</span>
      </div>
      ${people
        .map((person) => {
          const checklist = mentorChecklistFor(person);
          const completedItems = checklist.items.filter(Boolean).length;
          return `
            <button class="mentor-row mentor-row-button ${checklist.completed ? "is-completed" : ""}" type="button" data-open-mentor="${person.id}">
              <strong>${escapeHtml(person.name)}</strong>
              <span>${escapeHtml(person.rank)}</span>
              <span>${escapeHtml(formatDate(hiredDateFor(person)))}</span>
              <span>${completedItems}/${mentorChecklistLabels.length}</span>
            </button>
          `;
        })
        .join("")}
    `
    : '<div class="feed-item">Geen medewerkers in mentorperiode gevonden.</div>';
}

function renderMentorNotes(notes = []) {
  return notes.length
    ? `
      ${notes
        .slice()
        .reverse()
        .map((note) => `
          <article class="mentor-note-card">
            <p>${escapeHtml(note.text || "-")}</p>
            <div class="mentor-note-meta">
              <span>Ondertekend door: ${escapeHtml(note.authorName || "Onbekend")}</span>
              <span>${escapeHtml(formatDateTime(note.createdAt))}</span>
            </div>
          </article>
        `)
        .join("")}
    `
    : '<div class="feed-item">Nog geen koppeldiensten opgeslagen.</div>';
}

function renderMentorChecklistItems(checklist, readOnly = false) {
  let index = 0;
  return mentorChecklistGroups
    .map((group) => `
      <div class="mentor-check-header">${escapeHtml(group.title)}</div>
      ${group.items
        .map((label) => {
          const itemIndex = index;
          index += 1;
          return `
            <label class="mentor-check-row ${readOnly ? "mentor-readonly-row" : ""} ${checklist.items[itemIndex] ? "is-completed" : ""}">
              <span>${escapeHtml(label)}</span>
              <input type="checkbox" ${readOnly ? "disabled" : `data-mentor-item="${itemIndex}"`} ${checklist.items[itemIndex] ? "checked" : ""} />
            </label>
          `;
        })
        .join("")}
    `)
    .join("");
}

function renderMentorChecklist() {
  const person = state.people.find((entry) => entry.id === selectedMentorProfileId && entry.status === "Actief");
  if (!person || !canViewMentorOverview()) {
    $("#mentorChecklistTitle").textContent = "Mentor-Checklist";
    $("#mentorChecklistSubtitle").textContent = "Geen medewerker geselecteerd.";
    $("#mentorChecklistItems").innerHTML = "";
    $("#mentorNotesLog").innerHTML = "";
    $("#mentorNotes").value = "";
    return;
  }
  const checklist = mentorChecklistFor(person);
  $("#mentorChecklistTitle").textContent = person.name;
  $("#mentorChecklistSubtitle").textContent = `${person.rank} - ${person.serviceNumber || "-"}`;
  $("#mentorChecklistItems").innerHTML = renderMentorChecklistItems(checklist);
  $("#mentorNotesLog").innerHTML = renderMentorNotes(checklist.notes);
  $("#mentorNotes").value = "";
}

function renderMentorTrajectory() {
  const subtitle = $("#mentorTrajectorySubtitle");
  const container = $("#mentorTrajectoryProgress");
  if (!subtitle || !container) return;
  const person = currentProfile();
  if (!person || !canViewOwnMentorTrajectory()) {
    subtitle.textContent = "Geen actief mentor-traject.";
    container.innerHTML = '<div class="feed-item">Je zit op dit moment niet in een mentor-traject.</div>';
    return;
  }

  const checklist = mentorChecklistFor(person);
  subtitle.textContent = `${person.rank} - ${person.serviceNumber || "-"}`;
  container.innerHTML = renderMentorChecklistItems(checklist, true);
}

async function saveMentorChecklist(personId, patch = {}) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person || !canManageMentorOverview()) return false;
  const checklist = mentorChecklistFor(person);
  const body = {
    items: patch.items || checklist.items
  };
  if ("newNote" in patch) body.newNote = patch.newNote;
  return runAction(`/api/people/${encodeURIComponent(personId)}/mentor`, body);
}

window.PManagerModules.registerFeature("mentor", { ready: true });
