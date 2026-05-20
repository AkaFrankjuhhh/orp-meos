/* Handmatige diensturen: weekoverzicht, kleurindicatie en invoer voor bevoegde leiding. */
function isoWeekInfo(date = new Date()) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return { weekYear: target.getUTCFullYear(), weekNumber };
}

function isoWeekStart(weekYear, weekNumber) {
  const simple = new Date(Date.UTC(Number(weekYear), 0, 1 + (Number(weekNumber) - 1) * 7));
  const day = simple.getUTCDay() || 7;
  if (day <= 4) simple.setUTCDate(simple.getUTCDate() - day + 1);
  else simple.setUTCDate(simple.getUTCDate() + 8 - day);
  return simple;
}

function recentHourWeeks(count = 4) {
  const current = isoWeekInfo(new Date());
  const weeks = [];
  let cursor = isoWeekStart(current.weekYear, current.weekNumber);
  for (let index = 0; index < count; index += 1) {
    const info = isoWeekInfo(cursor);
    weeks.push(info);
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return weeks;
}

function currentHourWeek() {
  return recentHourWeeks(1)[0];
}

function hourEntryFor(personId, weekYear, weekNumber) {
  return (state.hours || []).find((entry) => (
    entry.personId === personId &&
    Number(entry.weekYear) === Number(weekYear) &&
    Number(entry.weekNumber) === Number(weekNumber)
  ));
}

function displayHourValue(value) {
  const number = Math.max(0, Number(value) || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "");
}

function hourToneColor(hours) {
  const value = Math.max(0, Number(hours) || 0);
  if (value >= 10) return "#14532d";
  if (value >= 5) {
    const ratio = Math.min(1, (value - 5) / 5);
    const lightness = 48 - ratio * 22;
    return `hsl(139 62% ${lightness}%)`;
  }
  const ratio = Math.min(1, value / 5);
  const hue = 2 + ratio * 118;
  const lightness = 42 + ratio * 10;
  return `hsl(${hue} 74% ${lightness}%)`;
}

function manualHoursForMonth(person) {
  const now = new Date();
  return (state.hours || [])
    .filter((entry) => entry.personId === person.id)
    .filter((entry) => {
      const start = isoWeekStart(entry.weekYear, entry.weekNumber);
      return start.getUTCFullYear() === now.getFullYear() && start.getUTCMonth() === now.getMonth();
    })
    .reduce((sum, entry) => sum + (Number(entry.hours) || Number(entry.minutes || 0) / 60 || 0), 0);
}

function renderProfileHours(person) {
  const panel = $(".profile-hours-panel");
  if (!panel) return;
  const canEdit = canManageHours();
  const total = manualHoursForMonth(person);
  const currentWeek = currentHourWeek();
  const currentEntry = hourEntryFor(person.id, currentWeek.weekYear, currentWeek.weekNumber);
  $("#profileMonthHours").textContent = `${displayHourValue(total)} uur`;
  $("#profileHoursCurrentWeekLabel").textContent = `Week ${currentWeek.weekNumber}`;
  $("#profileHoursWeekYear").value = currentWeek.weekYear;
  $("#profileHoursWeekNumber").value = currentWeek.weekNumber;
  $("#profileHoursPersonId").value = person.id;
  $("#profileHoursInput").value = currentEntry ? displayHourValue(currentEntry.hours) : "";
  $("#profileHoursEntry").hidden = !canEdit;
  $("#profileHoursWeeks").innerHTML = recentHourWeeks(4)
    .map((week) => {
      const entry = hourEntryFor(person.id, week.weekYear, week.weekNumber);
      const hours = entry ? Number(entry.hours) || 0 : 0;
      return `
        <div class="manual-hours-week" style="--hours-tone:${hourToneColor(hours)}">
          <span>Week ${week.weekNumber}</span>
          <strong>${displayHourValue(hours)} uur</strong>
        </div>
      `;
    })
    .join("");
}

function sortedActivePeopleForHours() {
  return state.people
    .filter((person) => person.status === "Actief")
    .sort((a, b) => {
      const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
}

function openBulkHoursDialog() {
  if (!canManageHours()) return;
  const week = currentHourWeek();
  $("#bulkHoursWeekLabel").textContent = `Week ${week.weekNumber} (${week.weekYear})`;
  $("#bulkHoursWeekYear").value = week.weekYear;
  $("#bulkHoursWeekNumber").value = week.weekNumber;
  $("#bulkHoursRows").innerHTML = sortedActivePeopleForHours()
    .map((person) => {
      const entry = hourEntryFor(person.id, week.weekYear, week.weekNumber);
      return `
        <label class="bulk-hours-row">
          <span>
            <strong>${escapeHtml(person.serviceNumber || "-")} - ${escapeHtml(person.name)}</strong>
            <small>${escapeHtml(person.rank || "-")}</small>
          </span>
          <input type="number" min="0" max="99" step="0.5" value="${entry ? escapeHtml(displayHourValue(entry.hours)) : ""}" data-bulk-hours-person="${escapeHtml(person.id)}" placeholder="0" />
        </label>
      `;
    })
    .join("");
  $("#bulkHoursDialog").showModal();
}

async function saveManualHours(entries, weekYear, weekNumber) {
  return runAction("/api/hours/week", { weekYear, weekNumber, entries });
}

window.DefensiePortalModules.registerFeature("hours", { ready: true });
