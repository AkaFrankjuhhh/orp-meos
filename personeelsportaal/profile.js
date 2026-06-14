/* Defensie Personeelsportaal-profielmodule: profielkaart, trainingen, badges, uren en sancties. */

function setProfilePageIcon(href) {
  if (!href) return;
  const icons = [...document.querySelectorAll("link[rel~='icon']")];
  if (!icons.length) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
    icons.push(link);
  }
  icons.forEach((link) => {
    link.href = href;
  });
}

function applyPortalBranding() {
  const organization = window.DefensiePortalData?.organization || {};
  const isPolice = organization.key === "politie";
  document.body.classList.toggle("portal-org-politie", isPolice);
  document.body.classList.toggle("portal-org-defensie", !isPolice);
  setProfilePageIcon(isPolice ? "/assets/politie-logo.png?v=20260613-form-branding" : "/assets/favicon.png?v=20260526");
}

applyPortalBranding();

function openProfilePage(profileId = "") {
  selectedProfileId = profileId;
  renderProfile();
  setPage("mijn-profiel");
  syncBrowserRoute("mijn-profiel");
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    $("#mijn-profiel")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
  });
}

const profileRankLabels = {
  "Marechaussee 4de Klasser": "Mar 4de Klasser",
  "Marrechaussee 4de Klasser": "Mar 4de Klasser",
  "Marechaussee 3de Klasser": "Mar 3de Klasser",
  "Marrechaussee 3de Klasser": "Mar 3de Klasser",
  "Marechaussee 2de Klasser": "Mar 2de Klasser",
  "Marrechaussee 2de Klasser": "Mar 2de Klasser",
  "Marechaussee 1ste Klasser": "Mar 1de Klasser",
  "Marrechaussee 1de Klasser": "Mar 1de Klasser",
  "Marrechaussee 1ste Klasser": "Mar 1de Klasser"
};

const configuredSideTaskBadges = window.DefensiePortalData?.sideTaskBadges;
const profileSideTaskBadges = Array.isArray(configuredSideTaskBadges) && configuredSideTaskBadges.length
  ? configuredSideTaskBadges
  : ["DSI-Leiding", "DSI", "KLu-Leiding", "KLu", "DNR-Leiding", "DNR", "HRB-Leiding", "HRB"];
window.profileSideTaskBadges = profileSideTaskBadges;

function profileRankLabel(rank) {
  return profileRankLabels[rank] || rank || "-";
}

function profileNavigationPeople() {
  return (state.people || [])
    .filter((person) => person.status === "Actief")
    .sort((a, b) => {
      const rankDelta = (rankWeight.get(b.rank) || 0) - (rankWeight.get(a.rank) || 0);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
}

function adjacentProfileId(direction) {
  const viewed = visibleProfile();
  const people = profileNavigationPeople();
  if (!viewed || !people.length) return "";
  const index = people.findIndex((person) => person.id === viewed.id);
  if (index === -1) return "";
  return people[index + direction]?.id || "";
}

function updateProfileNavigationButtons(viewed) {
  const navigation = $(".profile-nav-buttons");
  const previousButton = $("#profilePrevBtn");
  const nextButton = $("#profileNextBtn");
  if (!previousButton || !nextButton) return;
  if (navigation) navigation.hidden = false;
  const people = profileNavigationPeople();
  const index = people.findIndex((person) => person.id === viewed?.id);
  previousButton.disabled = index <= 0;
  nextButton.disabled = index === -1 || index >= people.length - 1;
}

function renderProfileChecks(current) {
  const renderItems = (items, completed, type) =>
    items
      .map((item) => {
        const isCompleted = completed.includes(item);
        const canEditAll = canManageQualifications();
        const canRevokeThisIbt = type === "training" && item === "IBT" && isCompleted && canRevokeIbt();
        const canEdit = canEditAll || canRevokeThisIbt;
        return `
        <label class="${isCompleted ? "is-completed" : "is-missing"}">
          <input type="checkbox" data-profile-check="${type}" value="${escapeHtml(item)}" ${isCompleted ? "checked" : ""} ${canEdit ? "" : "disabled"} />
          ${escapeHtml(item)}
        </label>
      `;
      })
      .join("");

  $("#profileTrainingChecks").innerHTML = renderItems(profileTrainings, current.completedTrainings || [], "training");
  $("#profileOperationalChecks").innerHTML = renderItems(profileOperational, current.completedOperational || [], "operational");
}

function automaticFunctionBadges(person) {
  return autoFunctionByRanks
    .filter((item) => item.ranks.includes(person.rank))
    .map((item) => item.label);
}

function renderProfileBadges(person) {
  const personBadges = person.badges || [];
  const profileFunctions = typeof canonicalProfileFunctions === "function"
    ? canonicalProfileFunctions(person.extraFunctions || [])
    : (person.extraFunctions || []);
  const sideTaskSet = new Set(profileSideTaskBadges);
  const taskBadges = extraTasks.filter((badge) => personBadges.includes(badge) && !sideTaskSet.has(badge));
  const sideTaskBadges = profileSideTaskBadges.filter((badge) => personBadges.includes(badge));
  const functionBadges = [
    ...automaticFunctionBadges(person),
    ...extraFunctions.filter((badge) => profileFunctions.includes(badge))
  ].filter((badge, index, list) => list.indexOf(badge) === index)
    .sort((a, b) => extraFunctions.indexOf(a) - extraFunctions.indexOf(b));
  const functionRow = functionBadges.map((badge) => `<span class="profile-badge function">${escapeHtml(badge)}</span>`).join("");
  const taskRow = taskBadges.map((badge) => `<span class="profile-badge task">${escapeHtml(badge)}</span>`).join("");
  const sideRow = sideTaskBadges.map((badge) => `<span class="profile-badge task side-task">${escapeHtml(badge)}</span>`).join("");

  $("#profilePageBadges").innerHTML = functionRow || taskRow
    ? `
      ${functionRow ? `<div class="profile-badge-line">${functionRow}</div>` : ""}
      ${taskRow ? `<div class="profile-badge-line">${taskRow}</div>` : ""}
    `
    : '<span class="profile-badge muted-badge">Geen extra taken</span>';

  const sideContainer = $("#profilePageSideBadges");
  if (sideContainer) {
    const canManageSideBadges = canManageProfileBadges();
    sideContainer.innerHTML = sideRow || (canManageSideBadges ? '<span class="profile-badge task side-task side-empty" aria-label="Neventaken beheren">+</span>' : "");
  }
}

function monthsActiveForPerson(person) {
  const start = new Date(`${hiredDateFor(person)}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
}

function renderProfileDistinctions(person) {
  const monthsActive = monthsActiveForPerson(person);
  $("#profileDistinctions").innerHTML = profileDistinctions
    .map((distinction) => {
      const earned = monthsActive >= Number(distinction.months || 0);
      const title = earned
        ? `${distinction.type} behaald`
        : `${distinction.type} vanaf ${distinction.months} maand(en) diensttijd`;
      return `
        <span class="distinction-medal service-star ${distinction.tone} ${earned ? "is-earned" : "is-locked"}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></span>
      `;
    })
    .join("");
}

function renderProfileAuditLog(person) {
  const panel = $("#profileAuditPanel");
  const list = $("#profileAuditLog");
  const absenceList = $("#profileAbsenceLog");
  if (!panel || !list || !absenceList) return;
  const canView = canViewProfileAuditLog();
  panel.hidden = !canView;
  if (!canView) return;
  const entries = (Array.isArray(person.profileLog) ? [...person.profileLog] : [])
    .filter((entry) => ["qualification", "badges", "profile"].includes(entry.type || "profile"));
  entries.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  list.innerHTML = entries.length
    ? entries.slice(0, 40).map((entry) => `
      <article class="profile-audit-item">
        <div>
          <strong>${escapeHtml(entry.action || "Profielactie")}</strong>
          <span>${escapeHtml(formatDateTime(entry.createdAt))}</span>
        </div>
        <p>${escapeHtml(entry.details || "-")}</p>
        <small>Door: ${escapeHtml(entry.actorName || "Onbekend")}</small>
      </article>
    `).join("")
    : '<div class="feed-item">Geen trainer- of badgeacties gevonden.</div>';

  const absenceEntries = (state.absences || [])
    .filter((entry) => entry.memberId === person.id)
    .sort((a, b) => Date.parse(b.reviewedAt || b.requestedAt || b.to || b.from || 0) - Date.parse(a.reviewedAt || a.requestedAt || a.to || a.from || 0));
  absenceList.innerHTML = absenceEntries.length
    ? absenceEntries.slice(0, 80).map((entry) => {
      const status = typeof absenceStatus === "function" ? absenceStatus(entry) : (entry.status || "In afwachting");
      const reviewedText = entry.reviewedAt
        ? `Beoordeeld door: ${entry.reviewedByName || "Onbekend"} op ${formatDateTime(entry.reviewedAt)}`
        : `Aangevraagd op: ${formatDateTime(entry.requestedAt)}`;
      return `
        <article class="profile-audit-item profile-absence-item">
          <div>
            <strong>${escapeHtml(status)}</strong>
            <span>${escapeHtml(formatDate(entry.from))} t/m ${escapeHtml(formatDate(entry.to))}</span>
          </div>
          <p>${escapeHtml(entry.reason || "Geen reden opgegeven")}</p>
          <small>${escapeHtml(reviewedText)}</small>
        </article>
      `;
    }).join("")
    : '<div class="feed-item">Geen afwezigheden gevonden.</div>';
}

function activeDisciplineEntries(person) {
  const now = new Date();
  return (person.discipline || []).filter((entry) => !entry.expiresAt || new Date(`${entry.expiresAt}T23:59:59`) >= now);
}

function renderProfileDiscipline(person) {
  const panel = $(".profile-discipline-panel");
  const canViewAll = canViewAllDisciplineFor(person);
  const canViewI8 = canViewI8DisciplineFor(person);
  if (panel) panel.hidden = !canViewDisciplineFor(person);
  if (!canViewDisciplineFor(person)) return;
  const entries = person.discipline || [];
  const activeEntries = activeDisciplineEntries(person);
  const officialWarningCount = activeEntries.filter((entry) => entry.type === "regular-warning").length;
  const regularWarnings = officialWarningCount % 3;
  const manualRegularStrikes = activeEntries.filter((entry) => entry.type === "regular-strike").length;
  const automaticRegularStrikes = Math.floor(officialWarningCount / 3);
  const regularStrikes = manualRegularStrikes + automaticRegularStrikes;
  const i8WarningCount = activeEntries.filter((entry) => entry.type === "i8-warning").length;
  const i8Warnings = i8WarningCount % 3;
  const manualI8Strikes = activeEntries.filter((entry) => entry.type === "i8-strike").length;
  const automaticI8Strikes = Math.floor(i8WarningCount / 3);
  const i8Strikes = manualI8Strikes + automaticI8Strikes;
  $("#regularWarningCount").textContent = regularWarnings;
  $("#regularStrikeCount").textContent = regularStrikes;
  $("#i8WarningCount").textContent = i8Warnings;
  $("#i8StrikeCount").textContent = i8Strikes;
  const notices = [];
  if (automaticRegularStrikes > 0) {
    notices.push({ tone: "strike", text: `${automaticRegularStrikes} automatische Strike door ${officialWarningCount} Offici\u00eble Waarschuwingen.` });
  }
  if (automaticI8Strikes > 0) {
    notices.push({ tone: "i8", text: `${automaticI8Strikes} automatische I8 Strike door ${i8WarningCount} I8 Waarschuwingen.` });
  }
  if (i8Strikes >= 3) {
    notices.push({ tone: "strike", text: "IBT training innemen volgens I8-regel." });
  }
  $("#disciplineNotice").innerHTML = notices.map((notice) => `<div class="discipline-notice-line ${notice.tone}">${escapeHtml(notice.text)}</div>`).join("");
  $("#disciplineNotice").hidden = notices.length === 0;
  $("#addDisciplineBtn").hidden = !canManageDiscipline();
  const i8Only = canViewI8 && !canViewAll;
  $$(".discipline-summary div").forEach((element, index) => {
    element.hidden = i8Only && index < 2;
  });
  ["all", "official"].forEach((value) => {
    const option = $(`#disciplineTypeFilter option[value='${value}']`);
    if (option) option.hidden = i8Only;
  });
  if (i8Only) $("#disciplineTypeFilter").value = "i8";

  const typeFilter = i8Only ? "i8" : ($("#disciplineTypeFilter")?.value || "all");
  const dateSort = $("#disciplineDateSort")?.value || "new-old";
  const filteredEntries = entries
    .filter((entry) => {
      if (typeFilter === "i8") return ["i8-warning", "i8-strike"].includes(entry.type);
      if (typeFilter === "official") return ["regular-warning", "regular-strike"].includes(entry.type);
      return true;
    })
    .sort((a, b) => {
      const dateA = new Date(a.issuedAt || 0);
      const dateB = new Date(b.issuedAt || 0);
      return dateSort === "old-new" ? dateA - dateB : dateB - dateA;
    });

  $("#profileDisciplineLog").innerHTML = filteredEntries.length
    ? filteredEntries
        .map((entry) => {
          const type = disciplineTypes[entry.type] || { label: entry.type || "Onbekend", tone: "warning" };
          const expired = entry.expiresAt && new Date(`${entry.expiresAt}T23:59:59`) < new Date();
          return `
            <article class="discipline-item ${expired ? "is-expired" : ""}" data-discipline-id="${escapeHtml(entry.id || "")}">
              <div class="discipline-item-head">
                <span class="discipline-type ${escapeHtml(type.tone)}">${escapeHtml(type.label)}</span>
                <span class="muted">${expired ? "Verlopen" : "Actief"}</span>
              </div>
              <p class="discipline-reason">${escapeHtml(entry.reason || "-")}</p>
              <div class="discipline-meta">
                <span>${escapeHtml(formatDateTime(entry.issuedAt))}</span>
                <span>Door: ${escapeHtml(entry.issuedByName || "-")}</span>
                <span>Verloopt: ${escapeHtml(formatDate(entry.expiresAt))}</span>
                ${entry.updatedAt ? `<span>Aangepast: ${escapeHtml(formatDateTime(entry.updatedAt))}</span>` : ""}
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="feed-item">Geen strikes of waarschuwingen gevonden voor dit filter.</div>';
}

function setDisciplineTypeOptionsForPermissions(selectElement) {
  if (!selectElement) return;
  const i8Only = canManageI8Discipline() && !canViewAllDiscipline();
  [...selectElement.options].forEach((option) => {
    option.hidden = i8Only && !String(option.value || "").startsWith("i8-");
    option.disabled = option.hidden;
  });
  if (i8Only && !String(selectElement.value || "").startsWith("i8-")) {
    selectElement.value = "i8-warning";
  }
}

function openDisciplineDialog() {
  const viewed = visibleProfile();
  if (!viewed || !canManageDiscipline()) return;
  $("#disciplinePersonId").value = viewed.id;
  setDisciplineTypeOptionsForPermissions($("#disciplineType"));
  $("#disciplineType").value = canViewAllDiscipline() ? "regular-warning" : "i8-warning";
  $("#disciplineReason").value = "";
  $("#disciplineDialog").showModal();
}

function hideDisciplineContextMenu() {
  const menu = $("#disciplineContextMenu");
  if (!menu) return;
  menu.hidden = true;
  pendingDisciplineAction = null;
}

function openDisciplineContextMenu(event, item) {
  const viewed = visibleProfile();
  if (!viewed || !canManageDiscipline() || !item?.dataset.disciplineId) return;
  pendingDisciplineAction = { personId: viewed.id, disciplineId: item.dataset.disciplineId };
  const menu = $("#disciplineContextMenu");
  if (!menu) return;
  menu.hidden = false;
  const width = menu.offsetWidth || 190;
  const height = menu.offsetHeight || 88;
  const left = Math.min(event.clientX, window.innerWidth - width - 8);
  const top = Math.min(event.clientY, window.innerHeight - height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function findPendingDisciplineEntry() {
  if (!pendingDisciplineAction) return null;
  const person = state.people.find((entry) => entry.id === pendingDisciplineAction.personId);
  const discipline = (person?.discipline || []).find((entry) => entry.id === pendingDisciplineAction.disciplineId);
  return person && discipline ? { person, discipline } : null;
}

function openEditDisciplineDialog() {
  const pending = pendingDisciplineAction;
  const match = findPendingDisciplineEntry();
  hideDisciplineContextMenu();
  if (!pending || !match) return;
  $("#editDisciplinePersonId").value = pending.personId;
  $("#editDisciplineEntryId").value = pending.disciplineId;
  setDisciplineTypeOptionsForPermissions($("#editDisciplineType"));
  $("#editDisciplineType").value = match.discipline.type || (canViewAllDiscipline() ? "regular-warning" : "i8-warning");
  $("#editDisciplineReason").value = match.discipline.reason || "";
  $("#editDisciplineDialog").showModal();
}

function openDeleteDisciplineDialog() {
  const pending = pendingDisciplineAction;
  const match = findPendingDisciplineEntry();
  hideDisciplineContextMenu();
  if (!pending || !match) return;
  const type = disciplineTypes[match.discipline.type]?.label || "Sanctie";
  $("#deleteDisciplinePersonId").value = pending.personId;
  $("#deleteDisciplineEntryId").value = pending.disciplineId;
  $("#deleteDisciplineText").textContent = `Weet je zeker dat je ${type} van ${match.person.name} wil verwijderen?`;
  $("#deleteDisciplineDialog").showModal();
}

function weekStart(date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() - day + 1);
  return next;
}

function minutesInRange(entries, start, end) {
  return entries
    .filter((entry) => {
      const value = new Date(entry.endedAt || entry.startedAt || entry.syncedAt || 0);
      return value >= start && value < end;
    })
    .reduce((sum, entry) => sum + (Number(entry.minutes) || 0), 0);
}

function renderProfileHours(person) {
  const entries = (state.hours || []).filter((entry) => entry.personId === person.id);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thisWeekStart = weekStart(now);
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const previousWeekStart = new Date(thisWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const twoWeeksAgoStart = new Date(thisWeekStart);
  twoWeeksAgoStart.setDate(twoWeeksAgoStart.getDate() - 14);

  $("#profileMonthHours").textContent = formatMinutes(minutesInRange(entries, monthStart, nextMonthStart));
  $("#profileWeekHours").textContent = formatMinutes(minutesInRange(entries, thisWeekStart, nextWeekStart));
  $("#profilePreviousWeekHours").textContent = formatMinutes(minutesInRange(entries, previousWeekStart, thisWeekStart));
  $("#profileTwoWeeksAgoHours").textContent = formatMinutes(minutesInRange(entries, twoWeeksAgoStart, previousWeekStart));
}

function openProfileBadgeDialog(mode = "main") {
  const viewed = visibleProfile();
  if (!viewed || !canManageProfileBadges()) return;
  window.profileBadgeDialogMode = mode;
  $("#profileBadgePersonId").value = viewed.id;
  const selectedFunctions = viewed.extraFunctions || [];
  const selectedTasks = viewed.badges || [];
  const sideTaskSet = new Set(profileSideTaskBadges);
  const isSideMode = mode === "side";
  const selectedProfileFunctions = typeof canonicalProfileFunctions === "function" ? canonicalProfileFunctions(selectedFunctions) : selectedFunctions;
  const manageableFunctions = !isSideMode && hasKaderAccess()
    ? extraFunctions.filter((item) => !(typeof isOvcFunctionBadge === "function" && isOvcFunctionBadge(item)) || (typeof canManageOvcBadge === "function" && canManageOvcBadge()))
    : [];
  $("#profileBadgeFunctionOptions").innerHTML = manageableFunctions.length
    ? manageableFunctions
      .map((item) => `
        <label>
          <input type="checkbox" value="${escapeHtml(item)}" ${selectedProfileFunctions.includes(item) ? "checked" : ""} />
          ${escapeHtml(item)}
        </label>
      `)
      .join("")
    : `<div class="muted">${isSideMode ? "Deze neventaken staan los van de standaard profielbadges." : "Alleen Kader kan Kader, Hoofdofficier en Officiersraad toewijzen."}</div>`;
  $("#profileBadgeTaskOptions").innerHTML = extraTasks
    .filter((task) => isSideMode ? sideTaskSet.has(task) : !sideTaskSet.has(task))
    .map((task) => `
      <label>
        <input type="checkbox" value="${escapeHtml(task)}" ${selectedTasks.includes(task) ? "checked" : ""} />
        ${escapeHtml(task)}
      </label>
    `)
    .join("");
  $("#profileBadgeDialog h2").textContent = isSideMode ? "Neventaken" : "Functies & badges";
  $("#profileBadgeDialog").showModal();
}

function renderProfile() {
  const current = currentProfile();
  const viewed = visibleProfile();
  if (!current) return;
  $("#currentName").textContent = current.name;
  $("#currentService").textContent = current.serviceNumber;
  $("#currentAvatar").src = avatarFor(current);
  $("#absenceMemberDisplay").value = `${current.serviceNumber || "-"} - ${current.name}`;
  renderResignationForm();
  $("#profilePageAvatar").src = avatarFor(viewed);
  const profileNameStack = $("#profilePageNameService");
  const profileRankNumber = $("#profilePageRankNumber");
  const profileDisplayName = $("#profilePageDisplayName");
  profileNameStack.classList.remove("profile-police-layout");
  profileNameStack.classList.add("profile-service-layout");
  const viewedIsOvcOnly = typeof isOvcOnlyProfile === "function" && isOvcOnlyProfile(viewed);
  profileRankNumber.textContent = viewedIsOvcOnly ? "" : profileRankLabel(viewed.rank);
  const serviceLine = document.createElement("span");
  serviceLine.className = "profile-service-line";
  serviceLine.textContent = viewedIsOvcOnly ? "" : viewed.serviceNumber || "-";
  const nameLine = document.createElement("span");
  nameLine.className = "profile-display-name";
  nameLine.textContent = viewed.name || "-";
  profileDisplayName.replaceChildren(serviceLine, nameLine);
  const profileStatus = statusInfoFor(viewed);
  const profileStatusDot = $("#profilePageStatusDot");
  if (profileStatusDot) {
    profileStatusDot.className = `status-dot ${profileStatus.className}`;
    profileStatusDot.title = profileStatus.title || profileStatus.label;
    profileStatusDot.setAttribute("aria-label", profileStatus.title || profileStatus.label);
  }
  updateProfileNavigationButtons(viewed);
  renderProfileBadges(viewed);
  renderProfileDistinctions(viewed);
  renderProfileAuditLog(viewed);
  $("#profilePageHiredDate").textContent = formatDate(hiredDateFor(viewed));
  $("#profilePagePromotionDate").textContent = formatDate(viewed.promotionDate);
  renderProfileChecks(viewed);
  $(".profile-hours-panel").hidden = !canViewHours(viewed);
  renderProfileDiscipline(viewed);
  if (canViewHours(viewed)) renderProfileHours(viewed);
  $("#loginBtn").hidden = Boolean(authProfile);
  $("#logoutBtn").hidden = !authProfile;
}

window.DefensiePortalModules.registerFeature("profile", { ready: true });
