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
function editableHourWeeks() {
  return recentHourWeeks(2);
}

function weekKey(week) {
  return `${week.weekYear}-${week.weekNumber}`;
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
  return Number.isInteger(number) ? String(number) : number.toFixed(1).replace(/\.0$/, "").replace(".", ",");
}

function parseHourInputValue(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
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

function opsEntrySeconds(entry) {
  if (Number.isFinite(Number(entry.durationSeconds))) return Math.max(0, Number(entry.durationSeconds));
  const start = Date.parse(entry.startedAt || "");
  const end = Date.parse(entry.endedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : 0;
}

function opsEntriesForPerson(person) {
  return (state.portoOpsLog || []).filter((entry) => entry.memberId === person.id);
}

function opsHoursForMonth(person) {
  const now = new Date();
  return opsEntriesForPerson(person)
    .filter((entry) => {
      const ended = new Date(entry.endedAt || entry.startedAt || 0);
      return ended.getFullYear() === now.getFullYear() && ended.getMonth() === now.getMonth();
    })
    .reduce((sum, entry) => sum + opsEntrySeconds(entry) / 3600, 0);
}

function opsHoursForWeek(person, week) {
  const start = isoWeekStart(week.weekYear, week.weekNumber);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return opsEntriesForPerson(person)
    .filter((entry) => {
      const ended = new Date(entry.endedAt || entry.startedAt || 0);
      return ended >= start && ended < end;
    })
    .reduce((sum, entry) => sum + opsEntrySeconds(entry) / 3600, 0);
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
  $("#profileOpsMonthHours").textContent = `${displayHourValue(opsHoursForMonth(person))} uur`;
  $("#profileOpsHoursWeeks").innerHTML = recentHourWeeks(4)
    .map((week) => {
      const hours = opsHoursForWeek(person, week);
      return `
        <div class="manual-hours-week" style="--hours-tone:${hourToneColor(hours)}">
          <span>Week ${week.weekNumber}</span>
          <strong>${displayHourValue(hours)} uur</strong>
        </div>
      `;
    })
    .join("");
}


function allHourEntriesForPerson(person) {
  return (state.hours || [])
    .filter((entry) => entry.personId === person.id)
    .filter((entry) => Number(entry.weekYear) && Number(entry.weekNumber))
    .sort((a, b) => {
      const yearDelta = Number(b.weekYear) - Number(a.weekYear);
      if (yearDelta !== 0) return yearDelta;
      return Number(b.weekNumber) - Number(a.weekNumber);
    });
}

function allOpsEntriesForPerson(person) {
  return opsEntriesForPerson(person)
    .map((entry) => ({ ...entry, durationSeconds: opsEntrySeconds(entry) }))
    .sort((a, b) => new Date(b.endedAt || b.startedAt || 0) - new Date(a.endedAt || a.startedAt || 0));
}

function openHoursOverviewDialog(person = visibleProfile(), kind = "manual") {
  if (!person || !canViewHours(person)) return;
  const isOps = kind === "ops";
  const entries = isOps ? allOpsEntriesForPerson(person) : allHourEntriesForPerson(person);
  const title = $("#hoursOverviewTitle");
  const subtitle = $("#hoursOverviewSubtitle");
  const list = $("#hoursOverviewRows");
  if (!title || !subtitle || !list) return;
  title.textContent = `${isOps ? "OPS uren" : "Diensturen"} ${person.name || "Onbekend"}`;
  subtitle.textContent = `${person.rank || "-"} - ${person.serviceNumber || "-"}`;
  list.innerHTML = isOps
    ? (entries.length
        ? entries
            .map((entry) => {
              const hours = entry.durationSeconds / 3600;
              return `
                <article class="hours-overview-row" style="--hours-tone:${hourToneColor(hours)}">
                  <div>
                    <strong>${escapeHtml(formatDateTime(entry.startedAt))}</strong>
                    <span>Tot ${escapeHtml(formatDateTime(entry.endedAt))} - afgesloten door ${escapeHtml(entry.endedByName || "Onbekend")}</span>
                  </div>
                  <b>${escapeHtml(displayHourValue(hours))} uur</b>
                </article>
              `;
            })
            .join("")
        : '<div class="feed-item">Nog geen OPS uren geregistreerd.</div>')
    : entries.length
    ? entries
        .map((entry) => {
          const hours = Number(entry.hours) || 0;
          const entered = entry.enteredAt ? `Ingevoerd: ${formatDateTime(entry.enteredAt)}` : "Nog geen invoertijd";
          const author = entry.enteredByName ? `Door: ${entry.enteredByName}` : "";
          return `
            <article class="hours-overview-row" style="--hours-tone:${hourToneColor(hours)}">
              <div>
                <strong>Week ${escapeHtml(entry.weekNumber)} (${escapeHtml(entry.weekYear)})</strong>
                <span>${escapeHtml([entered, author].filter(Boolean).join(" Â· "))}</span>
              </div>
              <b>${escapeHtml(displayHourValue(hours))} uur</b>
            </article>
          `;
        })
        .join("")
    : '<div class="feed-item">Nog geen diensturen geregistreerd.</div>';
  $("#hoursOverviewDialog").showModal();
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

function renderBulkHoursRows(week) {
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
          <input type="text" inputmode="decimal" value="${entry ? escapeHtml(displayHourValue(entry.hours)) : ""}" data-bulk-hours-person="${escapeHtml(person.id)}" placeholder="0" />
        </label>
      `;
    })
    .join("");
}

function renderBulkHoursWeekOptions(selectedWeek) {
  const weeks = editableHourWeeks();
  const selectedKey = weekKey(selectedWeek);
  $("#bulkHoursWeekOptions").innerHTML = weeks
    .map((week, index) => {
      const label = index === 0 ? "Huidige week" : "Vorige week";
      const active = weekKey(week) === selectedKey;
      return `<button class="ghost small ${active ? "active" : ""}" type="button" data-bulk-hours-week-year="${escapeHtml(week.weekYear)}" data-bulk-hours-week-number="${escapeHtml(week.weekNumber)}">${label}: Week ${escapeHtml(week.weekNumber)}</button>`;
    })
    .join("");
}

function selectBulkHoursWeek(week) {
  renderBulkHoursWeekOptions(week);
  renderBulkHoursRows(week);
}

function openBulkHoursDialog() {
  if (!canManageHours()) return;
  selectBulkHoursWeek(currentHourWeek());
  $("#bulkHoursDialog").showModal();
}

async function saveManualHours(entries, weekYear, weekNumber) {
  return runAction("/api/hours/week", { weekYear, weekNumber, entries });
}

window.DefensiePortalModules.registerFeature("hours", { ready: true });
