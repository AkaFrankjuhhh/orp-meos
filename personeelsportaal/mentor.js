/* Defensie Personeelsportaal mentormodule: mentoroverzicht, checklist, traject en mentor-notities. */

let mentorLogDetailContext = null;
const leadershipPeriodLabels = {
  week: "Afgelopen week",
  month: "Afgelopen maand",
  quarter: "Afgelopen 3 maanden",
  halfyear: "Afgelopen 6 maanden"
};

function openMentorChecklist(profileId) {
  selectedMentorProfileId = profileId;
  renderMentorChecklist();
  setPage("mentor-checklist");
}

function canViewMentorLeadershipLog() {
  return Boolean(permissions.canViewMentorLeadershipLog || hasKaderAccess());
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
  const allItemsCompleted = normalizedItems.length > 0 && normalizedItems.every(Boolean);
  const testSent = Boolean(checklist.testSent);
  const testApproved = Boolean(checklist.testApproved);
  return {
    completed: allItemsCompleted && testSent && testApproved,
    allItemsCompleted,
    testSent,
    testApproved,
    items: normalizedItems,
    notes
  };
}

function mentorPeople() {
  return state.people
    .filter((person) => person.status === "Actief" && mentorRanks.includes(person.rank))
    .filter((person) => !mentorChecklistFor(person).completed)
    .sort((a, b) => {
      const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
}

function mentorProgressColor(completed, total) {
  const ratio = total ? completed / total : 0;
  const hue = Math.round(4 + ratio * 126);
  const lightness = Math.round(43 + ratio * 7);
  return `hsl(${hue} 72% ${lightness}%)`;
}

function renderMentorProgressBars(completed, total) {
  const color = mentorProgressColor(completed, total);
  const ratio = total ? completed / total : 0;
  const filledBars = completed <= 0 ? 1 : Math.max(1, Math.ceil(ratio * 4));
  return `
    <span class="mentor-progress-wrap" title="${escapeHtml(completed)}/${escapeHtml(total)} voltooid">
      <span class="mentor-progress-mini" aria-label="${escapeHtml(completed)} van ${escapeHtml(total)} mentorpunten voltooid">
        ${Array.from({ length: 4 }, (_, index) => `<i class="${index < filledBars ? "done" : ""}" style="--mentor-progress-color:${color}"></i>`).join("")}
      </span>
      <b>${escapeHtml(completed)}/${escapeHtml(total)}</b>
    </span>
  `;
}

function renderMentorTestOverview(person, checklist) {
  const locked = !checklist.allItemsCompleted;
  const sentDisabled = locked ? "disabled" : "";
  const approvedDisabled = locked || !checklist.testSent ? "disabled" : "";
  return `
    <span class="mentor-test-overview ${locked ? "is-locked" : ""}" aria-label="Toetsstatus">
      <label class="mentor-test-mini ${checklist.testSent ? "is-completed" : ""}">
        <input type="checkbox" data-mentor-test="sent" data-mentor-test-person="${escapeHtml(person.id)}" ${checklist.testSent ? "checked" : ""} ${sentDisabled} />
        <span>Toets gestuurd</span>
      </label>
      <label class="mentor-test-mini ${checklist.testApproved ? "is-completed" : ""}">
        <input type="checkbox" data-mentor-test="approved" data-mentor-test-person="${escapeHtml(person.id)}" ${checklist.testApproved ? "checked" : ""} ${approvedDisabled} />
        <span>Toets goedgekeurd</span>
      </label>
    </span>
  `;
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
        <span>Aangenomen</span>
        <span>Voortgang</span>
        <span>Toets</span>
      </div>
      ${people
        .map((person) => {
          const checklist = mentorChecklistFor(person);
          const completedItems = checklist.items.filter(Boolean).length;
          return `
            <div class="mentor-row mentor-row-button" role="button" tabindex="0" data-open-mentor="${person.id}">
              <strong>${escapeHtml(person.name)}</strong>
              <span>${escapeHtml(person.rank)}</span>
              <span>${escapeHtml(formatDate(hiredDateFor(person)))}</span>
              ${renderMentorProgressBars(completedItems, mentorChecklistLabels.length)}
              ${renderMentorTestOverview(person, checklist)}
            </div>
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
    items: patch.items || checklist.items,
    testSent: "testSent" in patch ? patch.testSent : checklist.testSent,
    testApproved: "testApproved" in patch ? patch.testApproved : checklist.testApproved
  };
  if ("newNote" in patch) body.newNote = patch.newNote;
  return runAction(`/api/people/${encodeURIComponent(personId)}/mentor`, body);
}

function periodStartDate(period) {
  const now = new Date();
  const start = new Date(now);
  if (period === "week") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  } else if (period === "month") {
    start.setDate(start.getDate() - 30);
  } else if (period === "quarter") {
    start.setDate(start.getDate() - 90);
  } else {
    start.setDate(start.getDate() - 180);
  }
  start.setHours(0, 0, 0, 0);
  return start;
}

function inLeadershipPeriod(dateValue, period) {
  if (period === "all") return true;
  const date = new Date(dateValue || 0);
  if (Number.isNaN(date.getTime())) return false;
  return date >= periodStartDate(period);
}

function mentorLogRowsForPerson(person, period = "halfyear") {
  return (state.people || [])
    .flatMap((trainee) => {
      const checklist = mentorChecklistFor(trainee);
      return checklist.notes.map((note) => ({ ...note, trainee }));
    })
    .filter((note) => (note.authorId && note.authorId === person.id) || (!note.authorId && note.authorName === person.name))
    .filter((note) => inLeadershipPeriod(note.createdAt, period))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function mentorLogPeople() {
  return (state.people || [])
    .filter((person) => person.status === "Actief")
    .filter((person) => (person.badges || []).some((badge) => ["Mentor", "Mentor-Leiding"].includes(badge)))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "nl"));
}

function renderMentorLeadershipLog() {
  const list = $("#mentorLeadershipLogList");
  if (!list) return;
  if (!canViewMentorLeadershipLog()) {
    list.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const people = mentorLogPeople();
  list.innerHTML = people.length
    ? `
      <div class="leadership-row leadership-row-head">
        <span>Naam</span>
        <span>Rang</span>
        <span>Koppeldiensten</span>
      </div>
      ${people
        .map((person) => `
          <button class="leadership-row leadership-row-button" type="button" data-mentor-log-person="${escapeHtml(person.id)}">
            <strong>${escapeHtml(person.name)}</strong>
            <span>${escapeHtml(person.rank || "-")}</span>
            <span class="rank-count"><span>${mentorLogRowsForPerson(person, "all").length}</span></span>
          </button>
        `)
        .join("")}
    `
    : '<div class="feed-item">Geen mentoren gevonden.</div>';
}

function openMentorLogDetail(personId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person || !canViewMentorLeadershipLog()) return;
  mentorLogDetailContext = { personId };
  $("#leadershipLogTitle").textContent = `Mentor-log ${person.name}`;
  $("#leadershipLogSubtitle").textContent = `${person.rank || "-"} - ${person.serviceNumber || "-"}`;
  $("#leadershipLogPeriod").value = "week";
  renderMentorLogDetailRows();
  $("#leadershipLogDialog").showModal();
}

function renderMentorLogDetailRows() {
  if (!mentorLogDetailContext) return;
  const person = state.people.find((entry) => entry.id === mentorLogDetailContext.personId);
  const list = $("#leadershipLogRows");
  if (!person || !list) return;
  const period = $("#leadershipLogPeriod")?.value || "week";
  const rows = mentorLogRowsForPerson(person, period);
  list.innerHTML = rows.length
    ? rows.map((row) => `
      <article class="leadership-detail-row">
        <strong>${escapeHtml(row.trainee?.name || "Onbekend")}</strong>
        <span>${escapeHtml(formatDateTime(row.createdAt))} - ${escapeHtml(leadershipPeriodLabels[period])}</span>
        <p>${escapeHtml(row.text || "-")}</p>
      </article>
    `).join("")
    : '<div class="feed-item">Geen koppeldiensten gevonden voor deze periode.</div>';
}

window.DefensiePortalModules.registerFeature("mentor", { ready: true });