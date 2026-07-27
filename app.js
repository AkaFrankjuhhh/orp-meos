// Statische Defensie Personeelsportaal configuratie komt uit personeelsportaal-data.js.
const {
  organization,
  ranks,
  defaultRecruitRank,
  rankCategories,
  serviceNumberGroups,
  rankWeight,
  today,
  profileTrainings,
  profileOperational,
  porto,
  mentorRanks,
  mentorChecklistGroups,
  mentorChecklistLabels,
  extraTasks,
  extraFunctions,
  disciplineTypes,
  profileDistinctions,
  autoFunctionByRanks,
  rankColors,
  defaultState
} = window.DefensiePortalData;
const organizationConfig = organization || {
  key: "defensie",
  label: "Defensie",
  portalTitle: "Defensie Personeelsportaal",
  portalSubtitle: "Defensie Oranjestad",
  requiredRoleLabel: "Defensie"
};
const organizationKey = organizationConfig.key || "defensie";
const portalPortoConfig = porto || {};
const portalOperatorLabel = portalPortoConfig.operatorLabel || "OPS";
const portalOperatorTraining = portalPortoConfig.operatorTraining || portalOperatorLabel;
let state = structuredClone(defaultState);
let authProfile = null;
let serverBacked = false;
let canViewLogbook = false;
let permissions = {};
const pendingActionKeys = new Set();
let pendingDismissalId = "";
let pendingRestoreId = "";
let selectedProfileId = "";
let pendingDisciplineAction = null;
let pendingI8ReviewAction = null;
let pendingI8ArchiveDeleteId = "";
let pendingAbsenceId = "";
let selectedMentorProfileId = "";
let activeI8Tab = "list";
const pageStorageKey = `orp-${organizationKey}-current-page`;
const profileStorageKey = `orp-${organizationKey}-current-profile`;
const mentorStorageKey = `orp-${organizationKey}-current-mentor`;
const openProfileFlagKey = `orp-${organizationKey}-open-own-profile`;
const pageRouteMap = {
  dashboard: "/",
  medewerkers: "/medewerkers",
  afwezigheid: "/afwezigheid",
  "beschikbaarheids-agenda": "/beschikbaarheids-agenda",
  "i8-opstellen": "/i8-formulier",
  "ontslag-formulier": "/ontslag-formulier",
  voertuiginbeslagname: "/voertuiginbeslagname",
  "i8-controleren": "/i8-controleren",
  "i8-archief": "/i8-archief",
  "mentor-overzicht": "/mentor-overzicht",
  "mentor-traject": "/mentor-traject",
  "mentor-toets": "/mentor-toets",
  "mentor-toetsen": "/mentor-toetsen",
  "mentor-checklist": "/mentor-checklist",
  "mentor-logboek": "/mentor-logboek",
  "trainer-overzicht": "/trainer-overzicht",
  "trainer-ibt": "/trainer-ibt",
  "trainer-logboek": "/trainer-logboek",
  "ovj-logboek": "/hovj-logboek",
  "personeel-aannemen": "/personeel-aannemen",
  blacklist: "/blacklist",
  personeel: "/personeel",
  "afwezigheid-overzicht": "/afwezigheid-overzicht",
  "ontslag-overzicht": "/ontslag-overzicht",
  "ops-tijden": "/ops-tijden",
  archief: "/personeels-archief",
  systeemstatus: "/systeemstatus",
  logboek: "/logboek",
  "mijn-profiel": "/mijn-profiel"
};
const routePageMap = Object.fromEntries(Object.entries(pageRouteMap).map(([page, route]) => [route, page]));
let suppressRouteSync = false;
const portalWindowName = `${organizationKey}-personeelsportaal-main`;
const portalChannelName = `orp-${organizationKey}-portaal-window`;
const serviceNumberDisplayLabel = organizationKey === "politie" ? "Roepnummer" : "Dienstnummer";
let reviewCounterPoll = null;
let reviewCounterLoadPromise = null;
let liveEventSource = null;
let liveRefreshTimer = null;
let liveRefreshSuppressUntil = 0;
let systemHealthCache = null;
let systemHealthLoadedAt = 0;
let systemHealthLoadPromise = null;
let rankPieSegments = [];
let mentorChecklistEditingUntil = 0;
const REVIEW_COUNTER_FALLBACK_MS = 30000;
const LIVE_REFRESH_LOCAL_ACTION_SUPPRESS_MS = 1500;
const SYSTEM_HEALTH_CACHE_MS = 10000;
const MAX_TRAINING_CREDIT_TRAINERS = 5;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function currentLoginPeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 18) return "day";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function setLoginBackgroundByTime() {
  document.body.dataset.organization = organizationKey;
  document.body.dataset.loginPeriod = currentLoginPeriod();
}

function applyOrganizationBranding() {
  setLoginBackgroundByTime();
  const label = organizationConfig.label || "Defensie";
  const title = organizationConfig.portalTitle || `${label} Personeelsportaal`;
  const subtitle = organizationConfig.portalSubtitle || `${label} Oranjestad`;
  const roleLabel = organizationConfig.requiredRoleLabel || label;

  document.title = `Oranjestad RP ${label} | Personeelsbeheer`;
  const lockBrandTitle = document.querySelector(".lock-brand strong");
  const lockBrandSubtitle = document.querySelector(".lock-brand span");
  const lockTitle = document.querySelector("#lockscreen h1");
  const lockText = document.querySelector("#lockscreen p");
  const sidebarTitle = document.querySelector(".sidebar .brand strong");
  const sidebarSubtitle = document.querySelector(".sidebar .brand span");
  const eyebrow = document.querySelector(".topbar .eyebrow");
  const authNoticeText = document.querySelector("#authNotice p");
  const recruitmentHint = document.querySelector(".recruitment-panel .muted");
  const operatorTimesLabel = `${portalOperatorLabel} tijden`;
  const operatorHoursTotalLabel = `${portalOperatorLabel} uren totaal deze maand`;
  const operatorHoursWeeksLabel = `${portalOperatorLabel} uren afgelopen weken`;

  if (lockBrandTitle) lockBrandTitle.textContent = title;
  if (lockBrandSubtitle) lockBrandSubtitle.textContent = subtitle;
  if (lockTitle) lockTitle.textContent = `${title} Oranjestad`;
  if (lockText) lockText.textContent = `Alleen personeel met een gekoppeld ${title}-profiel en de juiste Discord ${roleLabel} rol kan aanmelden.`;
  if (sidebarTitle) sidebarTitle.textContent = label;
  if (sidebarSubtitle) sidebarSubtitle.textContent = "Oranjestad RP";
  if (eyebrow) eyebrow.textContent = organizationKey === "politie" ? "Politie Oranjestad" : "Koninklijke Marechaussee";
  if (authNoticeText) authNoticeText.textContent = `Je kunt aanmelden als je Discord ID in een actief profiel staat en je de ${roleLabel} rol hebt.`;
  if (recruitmentHint) recruitmentHint.textContent = `Nieuwe medewerkers worden automatisch aangemaakt als ${defaultRecruitRank || ranks[ranks.length - 1]}.`;
  $$("[data-operator-times-label]").forEach((element) => {
    element.textContent = operatorTimesLabel;
  });
  const operatorTimesSubtitle = $("#opsTimesPageSubtitle");
  if (operatorTimesSubtitle) operatorTimesSubtitle.textContent = `Overzicht van ${portalOperatorLabel} uren deze week per persoon`;
  const profileOpsTotalLabel = $("#profileOpsTotalLabel");
  if (profileOpsTotalLabel) profileOpsTotalLabel.textContent = operatorHoursTotalLabel;
  const profileOpsWeeksLabel = $("#profileOpsWeeksLabel");
  if (profileOpsWeeksLabel) profileOpsWeeksLabel.textContent = operatorHoursWeeksLabel;
}

function sidebarIconSvg(name) {
  const icons = {
    porto: '<path d="M6 9v6"/><path d="M10 7h4a4 4 0 0 1 0 8h-4z"/><path d="M18 9v6"/>',
    dashboard: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    users: '<path d="M16 20v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    clipboard: '<path d="M9 3h6l1 2h3a1 1 0 0 1 1 1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h3z"/><path d="M9 3v4h6V3"/><path d="M8 13h8"/><path d="M8 17h6"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
    log: '<path d="M6 3h10l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M15 3v5h5"/><path d="M8 13h8"/><path d="M8 17h8"/>',
    graduation: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/><path d="M22 10v6"/>',
    checklist: '<path d="M9 11l2 2 4-4"/><path d="M9 17h6"/><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3h6v4H9z"/>',
    plusUser: '<path d="M15 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M16 11h6"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    car: '<path d="M5 17h14"/><path d="M6 17l1-6h10l1 6"/><path d="M8 11l2-4h4l2 4"/><circle cx="8" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>'
  };
  return `<svg class="nav-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name] || icons.file}</svg>`;
}

function enhanceSidebarIcons() {
  const iconByPage = {
    dashboard: "dashboard",
    medewerkers: "users",
    afwezigheid: "calendar",
    "beschikbaarheids-agenda": "calendar",
    "i8-opstellen": "file",
    "ontslag-formulier": "clipboard",
    voertuiginbeslagname: "car",
    "i8-controleren": "checklist",
    "i8-archief": "archive",
    "ovj-logboek": "log",
    "mentor-overzicht": "graduation",
    "mentor-traject": "graduation",
    "mentor-toets": "checklist",
    "mentor-toetsen": "checklist",
    "mentor-logboek": "log",
    "trainer-overzicht": "graduation",
    "trainer-ibt": "checklist",
    "trainer-logboek": "log",
    "personeel-aannemen": "plusUser",
    blacklist: "shield",
    personeel: "users",
    "afwezigheid-overzicht": "calendar",
    "ontslag-overzicht": "clipboard",
    archief: "folder",
    logboek: "log"
  };
  $$(".nav-item").forEach((button) => {
    if (button.querySelector(".nav-icon")) return;
    const iconName = button.hasAttribute("data-open-porto") ? "porto" : iconByPage[button.dataset.page] || "file";
    const icon = document.createElement("span");
    icon.className = "nav-icon";
    icon.innerHTML = sidebarIconSvg(iconName);
    button.classList.add("has-nav-icon");
    button.prepend(icon);
  });
}


function registerPersoneelsportaalTab() {
  window.name = portalWindowName;
  const markOpen = () => localStorage.setItem(`orp-${organizationKey}-portaal-window-seen`, String(Date.now()));
  const focusSelf = (requestId = Date.now()) => {
    markOpen();
    localStorage.setItem(`orp-${organizationKey}-personeelsportaal-focus-ack`, String(requestId));
    window.focus();
  };
  markOpen();
  window.addEventListener("focus", markOpen);
  document.addEventListener("visibilitychange", markOpen);
  window.addEventListener("storage", (event) => {
    if (event.key === `orp-${organizationKey}-personeelsportaal-focus-request`) focusSelf(Number(event.newValue) || Date.now());
  });
  try {
    const channel = new BroadcastChannel(portalChannelName);
    channel.addEventListener("message", (event) => {
      if (event.data?.type === `focus-${organizationKey}-portaal`) focusSelf(Number(event.data.requestId) || Date.now());
    });
  } catch (error) {
    // BroadcastChannel is optional; the named tab fallback still opens het Personeelsportaal correct.
  }
}
function currentProfile() {
  if (!authProfile) return null;
  const byId = state.people.find((person) => person.id === authProfile.id && isCurrentProfile(person));
  if (byId) return byId;
  const byDiscordId = state.people.find((person) => person.discordId === authProfile.discordId && isCurrentProfile(person));
  return byDiscordId || authProfile;
}

const CURRENT_PROFILE_BLOCKED_STATUSES = new Set([
  "inactief",
  "ontslagen",
  "gearchiveerd",
  "archief",
  "blacklist",
  "geblacklist"
]);

function normalizedProfileStatus(person) {
  return String(person?.status || "Actief").trim();
}

function isCurrentProfile(person) {
  if (!person) return false;
  const status = normalizedProfileStatus(person).toLowerCase();
  if (!status) return true;
  return !CURRENT_PROFILE_BLOCKED_STATUSES.has(status);
}

function visibleProfile() {
  return state.people.find((person) => person.id === selectedProfileId && isCurrentProfile(person)) || currentProfile();
}

function hasKaderAccess() {
  return Boolean(permissions.canManagePeople);
}

function canManageOvcBadge() {
  return Boolean(permissions.canManageOvcBadge);
}

function normalizeFunctionBadgeName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function isOvcFunctionBadge(value) {
  const normalized = normalizeFunctionBadgeName(value);
  return normalized === "ovc" || normalized === "overheidscoordinator";
}

function canonicalProfileFunctions(functions = []) {
  const seen = new Set();
  const result = [];
  for (const badge of functions || []) {
    const next = isOvcFunctionBadge(badge) ? "OVC" : String(badge || "").trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    result.push(next);
  }
  return result;
}

function personHasOvcBadge(person) {
  return canonicalProfileFunctions(person?.extraFunctions || []).some((badge) => isOvcFunctionBadge(badge));
}

function isOvcOnlyProfile(person) {
  return Boolean(personHasOvcBadge(person) && !person?.rank && !person?.serviceNumber);
}

function canViewKaderPages() {
  return Boolean(permissions.canViewKaderPages || permissions.canViewLogbook || canViewLogbook || hasKaderAccess());
}

function canViewPersonnel() {
  return Boolean(permissions.canViewPersonnel || canViewKaderPages());
}

function canManagePersonnelRanks() {
  return Boolean(permissions.canManagePersonnelRanks || hasKaderAccess());
}

function canManageInvestigationStatus() {
  return Boolean(permissions.canManageInvestigationStatus || hasKaderAccess());
}

function canReviewAbsences() {
  return Boolean(permissions.canReviewAbsences || hasKaderAccess());
}

function canViewAbsenceOverview() {
  return Boolean(permissions.canViewAbsenceOverview || canReviewAbsences() || canViewKaderPages());
}

function canViewResignationOverview() {
  return Boolean(permissions.canViewResignationOverview || hasKaderAccess());
}

function canViewPersonnelArchive() {
  return Boolean(permissions.canViewPersonnelArchive || hasKaderAccess());
}

function canManagePersonnelRanksFor(person, action = "") {
  if (!person || ranks.indexOf(person.rank) < 0) return false;
  if (hasKaderAccess()) return true;
  if (!canManagePersonnelRanks() || !person) return false;
  const adjudantIndex = ranks.indexOf("Adjudant");
  const currentIndex = ranks.indexOf(person.rank);
  if (adjudantIndex < 0 || currentIndex < 0) return false;
  if (action === "promote") {
    const nextRank = ranks[currentIndex - 1];
    const nextIndex = ranks.indexOf(nextRank);
    return nextIndex >= adjudantIndex;
  }
  return currentIndex >= adjudantIndex;
}

function canDismissPerson(person) {
  if (isOvcOnlyProfile(person)) return false;
  if (hasKaderAccess()) return true;
  if (permissions.canDismissPersonnel) return true;
  if (!permissions.canDismissPersonnelToAdjudant || !person) return false;
  const adjudantIndex = ranks.indexOf("Adjudant");
  const currentIndex = ranks.indexOf(person.rank);
  return adjudantIndex >= 0 && currentIndex >= adjudantIndex;
}

function canManageProfileBadges() {
  return Boolean(permissions.canManageProfileBadges || hasKaderAccess());
}

function canManageProfileFunctions() {
  return Boolean(permissions.canManageProfileFunctions || hasKaderAccess());
}

function canManageAllProfileTaskBadges() {
  return Boolean(permissions.canManageAllProfileTaskBadges || hasKaderAccess());
}

function manageableProfileFunctionBadges() {
  return Array.isArray(permissions.manageableProfileFunctionBadges) ? permissions.manageableProfileFunctionBadges : [];
}

function manageableProfileTaskBadges() {
  return Array.isArray(permissions.manageableProfileTaskBadges) ? permissions.manageableProfileTaskBadges : [];
}

function canManageQualifications() {
  return Boolean(permissions.canManageQualifications || hasKaderAccess());
}

function canRevokeIbt() {
  return Boolean(permissions.canRevokeIbt || hasKaderAccess());
}

function canViewProfileAuditLog() {
  return Boolean(permissions.canViewProfileAuditLog || hasKaderAccess());
}

function canViewAllDiscipline() {
  return Boolean(permissions.canViewAllDiscipline || hasKaderAccess());
}

function canViewI8Discipline() {
  return Boolean(permissions.canViewI8Discipline || canViewAllDiscipline());
}

function canManageDiscipline() {
  return Boolean(permissions.canManageDiscipline || permissions.canManageI8Discipline || hasKaderAccess());
}

function canManageI8Discipline() {
  return Boolean(permissions.canManageI8Discipline || permissions.canManageDiscipline || hasKaderAccess());
}

function isOwnProfile(person) {
  const current = currentProfile();
  return Boolean(current && person && current.id === person.id);
}

function canViewDisciplineFor(person) {
  return Boolean(isOwnProfile(person) || canViewAllDiscipline() || canViewI8Discipline());
}

function canViewAllDisciplineFor(person) {
  return Boolean(isOwnProfile(person) || canViewAllDiscipline());
}

function canViewI8DisciplineFor(person) {
  return Boolean(isOwnProfile(person) || canViewI8Discipline());
}

function canViewHours(person) {
  const current = currentProfile();
  return Boolean(permissions.canViewAllHours || (current && person && current.id === person.id));
}

function canManageHours() {
  return Boolean(permissions.canManageHours || hasKaderAccess());
}

function canManageVehicleSeizures() {
  return Boolean(permissions.canManageVehicleSeizures || hasKaderAccess());
}

function canViewOpsTimes() {
  return Boolean(permissions.canViewAllHours || canViewKaderPages());
}

function canViewOvJChannels() {
  return Boolean(permissions.canViewOvJChannels || canViewKaderPages());
}

function canViewOvJLeadershipLog() {
  return Boolean(permissions.canViewOvJLeadershipLog || canViewKaderPages());
}

function canLeadOvJ() {
  return Boolean(permissions.canLeadOvJ || hasKaderAccess());
}

function canOverrideI8Forms() {
  return Boolean(permissions.canOverrideI8Forms || canLeadOvJ() || hasKaderAccess());
}

function canReviewI8Forms() {
  return Boolean(permissions.canReviewI8Forms || hasKaderAccess());
}

function canViewMentorOverview() {
  return Boolean(permissions.canViewMentorOverview || hasKaderAccess());
}

function canManageMentorOverview() {
  return Boolean(permissions.canManageMentorOverview || hasKaderAccess());
}

function canViewMentorLeadershipLog() {
  return Boolean(permissions.canViewMentorLeadershipLog || hasKaderAccess());
}

function canManageMentorTestTemplate() {
  return Boolean(permissions.canManageMentorTestTemplate || permissions.canUseDevTools);
}

function canViewOwnMentorTrajectory() {
  const current = currentProfile();
  return Boolean(current && isCurrentProfile(current) && mentorRanks.includes(current.rank));
}

function canViewMentorSection() {
  return Boolean(canViewMentorOverview() || canViewOwnMentorTrajectory());
}

function canViewTrainerSection() {
  return Boolean(permissions.canViewTrainerSection || canManageQualifications() || hasKaderAccess());
}

function canViewTrainerOverview() {
  return Boolean(permissions.canViewTrainerOverview || canViewTrainerSection());
}

function canViewTrainerLogbook() {
  return Boolean(permissions.canViewTrainerLogbook || hasKaderAccess());
}

function canReviewTrainerIbtForms() {
  return Boolean(permissions.canReviewTrainerIbtForms || permissions.canUseDevTools);
}

function canRecruitPeople() {
  return Boolean(permissions.canRecruitPeople || hasKaderAccess());
}

function canViewRecruitment() {
  return Boolean(permissions.canViewRecruitment || canRecruitPeople() || canViewKaderPages());
}

function canViewBlacklist() {
  return Boolean(permissions.canViewBlacklist || canRecruitPeople() || canViewKaderPages());
}

function canViewSystemHealth() {
  return Boolean(permissions.canUseDevTools || canViewKaderPages());
}

function resetPermissions() {
  canViewLogbook = false;
  permissions = {};
}

function updateDeviceMode() {
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const device = width <= 640 ? "mobile" : width <= 1024 ? "tablet" : "desktop";
  document.body.dataset.device = device;
}

// Gedeelde pop-up en formatter helpers komen uit shared-ui.js.
const siteNotice = DefensiePortalUI.createNoticeDialog({ id: "siteNoticeDialog", className: "site-notice-dialog" });
const showSiteNotice = siteNotice.showNotice;
const showSiteConfirm = siteNotice.showConfirm;
const showSiteChoice = siteNotice.showChoice;
const escapeHtml = DefensiePortalUI.escapeHtml;
const formatDate = DefensiePortalUI.formatDate;
const formatDateTime = DefensiePortalUI.formatDateTime;

async function showSiteTextInput({
  title = "Invoer",
  message = "",
  label = "Tekst",
  placeholder = "",
  required = false
} = {}) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "site-notice-dialog";
    dialog.innerHTML = `
      <form method="dialog" class="site-notice-card">
        <div class="panel-head">
          <h2>${escapeHtml(title)}</h2>
          <button class="ghost icon" type="button" data-close>&times;</button>
        </div>
        ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ""}
        <label class="field">
          <span>${escapeHtml(label)}</span>
          <textarea rows="4" ${required ? "required" : ""} placeholder="${escapeHtml(placeholder)}"></textarea>
        </label>
        <menu>
          <button class="ghost" value="cancel" type="submit">Annuleren</button>
          <button class="primary" value="confirm" type="submit">Opslaan</button>
        </menu>
      </form>
    `;
    document.body.appendChild(dialog);
    const textarea = dialog.querySelector("textarea");
    DefensiePortalUI.bindAutoGrowingTextareas?.(dialog);
    dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close("cancel"));
    bindDialogBackdropClose(dialog);
    dialog.addEventListener(
      "close",
      () => {
        const value = dialog.returnValue === "confirm" ? textarea.value.trim() : null;
        dialog.remove();
        resolve(value);
      },
      { once: true }
    );
    dialog.showModal();
    textarea?.focus();
  });
}

let trainingCreditDialogResolve = null;
let trainingCreditOptionPeople = [];

function trainingCreditTrainerLabel(person) {
  if (!person) return "";
  const number = person.serviceNumber ? `${person.serviceNumber} - ` : "";
  return `${number}${person.name || "Onbekend"}`;
}

function trainingCreditPrimaryTrainer() {
  return currentProfile() || authProfile || {};
}

function trainingCreditSelectablePeople(targetPerson) {
  const primary = trainingCreditPrimaryTrainer();
  return (state.people || [])
    .filter((person) => isCurrentProfile(person))
    .filter((person) => person.id !== targetPerson?.id)
    .filter((person) => person.id !== primary?.id)
    .sort((a, b) => compareServiceNumber(a.serviceNumber, b.serviceNumber) || String(a.name || "").localeCompare(String(b.name || ""), "nl"));
}

function fillTrainingCoTrainerOptions(targetPerson) {
  const datalist = $("#trainingCoTrainerOptions");
  if (!datalist) return;
  trainingCreditOptionPeople = trainingCreditSelectablePeople(targetPerson);
  datalist.innerHTML = trainingCreditOptionPeople
    .map((person) => `<option value="${escapeHtml(trainingCreditTrainerLabel(person))}"></option>`)
    .join("");
}

function resetTrainingCoTrainerFields() {
  $$("[data-training-co-trainer-row] input").forEach((input) => {
    input.value = "";
  });
  syncTrainingCoTrainerRows();
}

function syncTrainingCoTrainerRows() {
  const rows = $$("[data-training-co-trainer-row]");
  rows.forEach((row, index) => {
    const previousInput = rows[index - 1]?.querySelector("input");
    const shouldShow = index === 0 || Boolean(previousInput?.value.trim());
    row.hidden = !shouldShow;
    if (!shouldShow) {
      const input = row.querySelector("input");
      if (input) input.value = "";
    }
  });
}

function resolveTrainingCoTrainer(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  const matched = trainingCreditOptionPeople.find((person) => {
    const labels = [
      trainingCreditTrainerLabel(person),
      person.name || "",
      person.serviceNumber || "",
      person.id || ""
    ].map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
    return labels.includes(normalized);
  });
  if (matched) {
    return {
      id: matched.id || "",
      name: matched.name || raw,
      serviceNumber: matched.serviceNumber || "",
      rank: matched.rank || ""
    };
  }
  return { id: "", name: raw, serviceNumber: "", rank: "" };
}

function collectTrainingCoTrainers() {
  const primary = trainingCreditPrimaryTrainer();
  const seen = new Set([primary?.id || "", String(primary?.name || "").trim().toLowerCase()].filter(Boolean));
  const coTrainers = [];
  for (const input of $$("[data-training-co-trainer-row] input")) {
    const resolved = resolveTrainingCoTrainer(input.value);
    if (!resolved?.name) continue;
    const key = resolved.id || resolved.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    coTrainers.push(resolved);
    if (coTrainers.length >= MAX_TRAINING_CREDIT_TRAINERS - 1) break;
  }
  return coTrainers;
}

function resolveTrainingCreditDialog(value) {
  if (typeof trainingCreditDialogResolve === "function") trainingCreditDialogResolve(value);
}

function openTrainingCreditDialog({ trainingNames = [], targetPerson = null } = {}) {
  const dialog = $("#trainingCreditDialog");
  const form = $("#trainingCreditForm");
  if (!dialog || !form) return Promise.resolve([]);
  const primary = trainingCreditPrimaryTrainer();
  $("#trainingCreditTarget").textContent = targetPerson
    ? `${targetPerson.name || "Onbekend"} - ${targetPerson.serviceNumber || "-"}`
    : "-";
  $("#trainingCreditTrainingName").textContent = trainingNames.length > 1 ? trainingNames.join(", ") : trainingNames[0] || "-";
  $("#trainingCreditPrimaryTrainer").textContent = primary?.name || "Onbekend";
  fillTrainingCoTrainerOptions(targetPerson);
  resetTrainingCoTrainerFields();

  return new Promise((resolve) => {
    let settled = false;
    trainingCreditDialogResolve = (value) => {
      if (settled) return;
      settled = true;
      trainingCreditDialogResolve = null;
      resolve(value);
    };
    dialog.addEventListener(
      "close",
      () => {
        if (!settled) {
          settled = true;
          trainingCreditDialogResolve = null;
          resolve(null);
        }
      },
      { once: true }
    );
    dialog.showModal();
    $("#trainingCoTrainer1")?.focus();
  });
}

function bindDialogBackdropClose(root = document) {
  const dialogs = root instanceof HTMLDialogElement ? [root] : [...root.querySelectorAll("dialog")];
  dialogs.forEach((dialog) => {
    if (dialog.dataset.backdropCloseBound === "true") return;
    dialog.dataset.backdropCloseBound = "true";
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const clickedOutsideDialog =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (clickedOutsideDialog) dialog.close();
    });
  });
}

function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}u ${String(remainder).padStart(2, "0")}m`;
}

function startOfWeek(date = new Date()) {
  const start = new Date(date);
  const day = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

function dateOnly(date) {
  const value = date instanceof Date ? date : new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(date, days) {
  const value = date instanceof Date ? new Date(date) : new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return dateOnly(value);
}

function datesBetween(from, to) {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  const dates = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    dates.push(dateOnly(date));
  }
  return dates;
}

function isoWeekNumber(date) {
  const value = date instanceof Date ? new Date(date) : new Date(`${date}T00:00:00`);
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + 3 - ((value.getDay() + 6) % 7));
  const week1 = new Date(value.getFullYear(), 0, 4);
  return 1 + Math.round(((value - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

function opsLogEntrySeconds(entry) {
  if (Number.isFinite(Number(entry.durationSeconds))) return Math.max(0, Number(entry.durationSeconds));
  const start = Date.parse(entry.startedAt || "");
  const end = Date.parse(entry.endedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : 0;
}

function opsTimesRowsSince(startDate) {
  const startMs = startDate.getTime();
  return (state.portoOpsLog || [])
    .filter((entry) => {
      const ended = Date.parse(entry.endedAt || entry.startedAt || "");
      return Number.isFinite(ended) && ended >= startMs;
    })
    .map((entry) => ({ ...entry, durationSeconds: opsLogEntrySeconds(entry) }))
    .sort((a, b) => new Date(b.endedAt || b.startedAt || 0) - new Date(a.endedAt || a.startedAt || 0));
}

function opsTimesPersonKey(person) {
  return person?.id || person?.name || "onbekend";
}

function hasOpsTraining(person) {
  return Array.isArray(person?.completedOperational) && person.completedOperational.includes(portalOperatorTraining);
}

function compareServiceNumber(a = "", b = "") {
  const parse = (value) => String(value || "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number(part));
  const left = parse(a);
  const right = parse(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? Number.MAX_SAFE_INTEGER) - (right[index] ?? Number.MAX_SAFE_INTEGER);
    if (delta !== 0) return delta;
  }
  return String(a || "").localeCompare(String(b || ""), "nl", { numeric: true });
}

function renderOpsTimes() {
  const overview = $("#opsTimesOverview");
  if (!overview) return;
  if (!canViewOpsTimes()) {
    overview.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const weekStart = startOfWeek();
  const weekRows = opsTimesRowsSince(weekStart);
  const totals = new Map();
  state.people
    .filter((person) => person.status === "Actief" && hasOpsTraining(person))
    .forEach((person) => {
      totals.set(opsTimesPersonKey(person), {
        memberId: person.id || "",
        name: person.name || "Onbekend",
        serviceNumber: person.serviceNumber || "",
        seconds: 0,
        count: 0
      });
    });
  for (const row of weekRows) {
    const key = row.memberId || row.name || "onbekend";
    const current = totals.get(key);
    if (!current) continue;
    current.seconds += row.durationSeconds;
    current.count += 1;
  }
  const people = [...totals.values()].sort((a, b) => (
    compareServiceNumber(a.serviceNumber, b.serviceNumber) || a.name.localeCompare(b.name, "nl")
  ));
  overview.innerHTML = people.length
    ? `
      <div class="leadership-row leadership-row-head">
        <span>Naam</span>
        <span>${escapeHtml(serviceNumberDisplayLabel)}</span>
        <span>Deze week</span>
      </div>
      ${people.map((person) => `
        <button class="leadership-row leadership-row-button" type="button" data-ops-times-person="${escapeHtml(person.memberId || person.name)}">
          <strong>${escapeHtml(person.name)}</strong>
          <span>${escapeHtml(person.serviceNumber || "-")}</span>
          <span class="rank-count"><span>${escapeHtml(formatMinutes(person.seconds / 60))}</span></span>
        </button>
      `).join("")}
    `
    : `<div class="feed-item">Nog geen ${escapeHtml(portalOperatorLabel)} uren gelogd voor deze week.</div>`;
}

function openOpsTimesDialog(selected) {
  const dialog = $("#opsTimesDialog");
  const title = $("#opsTimesDialogTitle");
  const subtitle = $("#opsTimesDialogSubtitle");
  const rowsElement = $("#opsTimesDialogRows");
  if (!dialog || !rowsElement || !selected || !canViewOpsTimes()) return;
  const fourWeeksStart = startOfWeek();
  fourWeeksStart.setDate(fourWeeksStart.getDate() - 21);
  const rows = opsTimesRowsSince(fourWeeksStart).filter((entry) => (entry.memberId || entry.name || "onbekend") === selected);
  const totalSeconds = rows.reduce((sum, row) => sum + row.durationSeconds, 0);
  const person = state.people.find((entry) => opsTimesPersonKey(entry) === selected);
  if (!person || !hasOpsTraining(person)) return;
  const name = rows[0]?.name || person?.name || selected;
  if (title) title.textContent = name;
  if (subtitle) subtitle.textContent = `Laatste 4 weken totaal: ${formatMinutes(totalSeconds / 60)}`;
  rowsElement.innerHTML = `
    <article class="leadership-detail-row ops-times-summary">
      <strong>${escapeHtml(name)}</strong>
      <span>Laatste 4 weken totaal: ${escapeHtml(formatMinutes(totalSeconds / 60))}</span>
    </article>
    ${rows.length
      ? rows.map((row) => `
        <article class="leadership-detail-row">
          <strong>${escapeHtml(formatMinutes(row.durationSeconds / 60))}</strong>
          <span>${escapeHtml(formatDateTime(row.startedAt))} t/m ${escapeHtml(formatDateTime(row.endedAt))}</span>
          <p>Afgesloten door ${escapeHtml(row.endedByName || "Onbekend")}</p>
        </article>
      `).join("")
      : `<div class="feed-item">Geen ${escapeHtml(portalOperatorLabel)} diensten gevonden in de laatste 4 weken.</div>`}
  `;
  dialog.showModal();
}

async function loadState() {
  try {
    const response = await fetch("/api/state");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      serverBacked = false;
      const errorElement = $("#lockError");
      const shouldShowStateError = response.status !== 401 || freshLoginRedirected() || payload.error !== "Niet ingelogd";
      if (errorElement && shouldShowStateError) {
        errorElement.textContent = payload.error || "Server data kon niet geladen worden.";
        errorElement.hidden = false;
      }
      return false;
    }
    state = { ...structuredClone(defaultState), ...payload };
    serverBacked = true;
    return true;
  } catch (error) {
    serverBacked = false;
    const errorElement = $("#lockError");
    if (errorElement) {
      errorElement.textContent = "Server data kon niet geladen worden. Controleer of de server draait.";
      errorElement.hidden = false;
    }
    return false;
  }
}

function applyServerState(payload) {
  if (!payload?.state) return;
  state = { ...structuredClone(defaultState), ...payload.state };
  if (typeof resetMentorTestCaches === "function") resetMentorTestCaches();
  if ("canViewLogbook" in payload) {
    canViewLogbook = Boolean(payload.canViewLogbook);
  }
  if (payload.permissions) {
    permissions = payload.permissions;
  }
  localStorage.removeItem(`orp-${organizationKey}-state`);
}

function saveActiveFormDraftBeforeAction() {
  const page = activePageId();
  if (typeof saveI8Draft === "function" && page === "i8-opstellen" && activeI8Tab === "create") {
    saveI8Draft();
  }
  if (typeof saveMentorTestDraft === "function" && page === "mentor-toets") {
    saveMentorTestDraft();
  }
}

async function runAction(path, body = {}) {
  if (!serverBacked) return false;
  const actionKey = `${path}\n${JSON.stringify(body || {})}`;
  if (pendingActionKeys.has(actionKey)) return false;
  pendingActionKeys.add(actionKey);
  try {
    saveActiveFormDraftBeforeAction();
    let response;
    try {
      response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (error) {
      await showSiteNotice("Verbinding met de server mislukt. Probeer opnieuw of vernieuw de pagina.", "Actie mislukt");
      return false;
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      authProfile = null;
      resetPermissions();
      setLocked(true);
      await showSiteNotice("Je sessie is verlopen. Log opnieuw in en probeer het formulier daarna opnieuw te versturen.", "Opnieuw inloggen");
      return false;
    }
    if (!response.ok) {
      await showSiteNotice(payload.error || "Actie kon niet worden uitgevoerd.", "Actie mislukt");
      await loadState();
      return false;
    }
    applyServerState(payload);
    suppressImmediateLiveRefresh();
    return true;
  } finally {
    pendingActionKeys.delete(actionKey);
  }
}

function setSubmitBusy(form, busy, label) {
  const button = form?.querySelector("button[type='submit']");
  if (!button) return;
  if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
  button.disabled = Boolean(busy);
  button.textContent = busy ? label : button.dataset.defaultText;
}

async function validateI8FormFields() {
  const fields = [
    { selector: "#i8Date", label: "Datum geweldsaanwending" },
    { selector: "#i8Time", label: "Tijd geweldsaanwending" },
    { selector: "#i8Location", label: "Locatie" },
    { selector: "#i8OpcoOvd", label: "Naam: OPS - OVD/OPCO" },
    { selector: "#i8Description", label: "Beschrijving" },
    { selector: "#i8ForceUsed", label: "Gebruikte geweldsmiddel" },
    { selector: "#i8Vehicle", label: "Geweld tegen voertuig" },
    { selector: "#i8Injury", label: "Letsel bij derden" }
  ];
  const missing = fields.find((field) => !String($(field.selector)?.value || "").trim());
  if (missing) {
    await showSiteNotice(`Vul het veld '${missing.label}' handmatig in. Browser automatisch invullen telt soms niet goed mee.`, "I8 veld mist");
    $(missing.selector)?.focus();
    return false;
  }
  if (!$("#i8Truth")?.checked) {
    await showSiteNotice("Bevestig dat je het I8 formulier naar waarheid hebt opgemaakt.", "I8 bevestiging mist");
    $("#i8Truth")?.focus();
    return false;
  }
  return true;
}

async function loadAuth() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      authProfile = null;
      resetPermissions();
      setLocked(true);
      const errorElement = $("#lockError");
      const shouldShowAuthError = payload.error && !["Niet ingelogd", "Sessie niet gevonden op de server. Log opnieuw in."].includes(payload.error);
      if (errorElement && shouldShowAuthError) {
        errorElement.textContent = payload.error;
        errorElement.hidden = false;
      }
      return false;
    }
    const auth = await response.json();
    authProfile = auth.profile;
    canViewLogbook = Boolean(auth.canViewLogbook);
    permissions = auth.permissions || {};
    setLocked(false);
    return true;
  } catch (error) {
    authProfile = null;
    resetPermissions();
    setLocked(true);
    const errorElement = $("#lockError");
    if (errorElement) {
      errorElement.textContent = "Auth controle mislukt. Herstart de server of probeer opnieuw.";
      errorElement.hidden = false;
    }
    return false;
  }
}
function setLocked(locked) {
  document.body.classList.toggle("locked", locked);
  const notice = $("#authNotice");
  if (notice) notice.hidden = !locked;
}

function markPortalReady() {
  window.__orpPortalAppReady = true;
  if (typeof window.__orpBootReady === "function") {
    window.__orpBootReady();
    return;
  }
  document.documentElement.classList.remove("orp-app-booting", "orp-app-load-error");
  document.documentElement.classList.add("orp-app-ready");
}

function markPortalFailed(error) {
  window.__orpPortalAppReady = false;
  const message = error?.message || String(error || "Onbekende browserfout");
  if (typeof window.__orpBootFail === "function") {
    window.__orpBootFail(`Portaal starten mislukt: ${message}`);
  }
}

function showLockError() {
  const errorCode = new URLSearchParams(window.location.search).get("authError");
  const messages = {
    "no-profile": `Geen profiel gevonden in ${organizationConfig.portalTitle}.`,
    "no-role": `Geen Discord gekoppeld: je mist de ${organizationConfig.requiredRoleLabel || organizationConfig.label} rol.`,
    "login-failed": "Aanmelden via Discord is mislukt. Probeer opnieuw of controleer later de instellingen.",
    "database-busy": "De database was tijdelijk druk. Wacht een paar seconden en probeer opnieuw.",
    "discord-failed": "Discord reageerde niet goed tijdens het aanmelden. Probeer opnieuw.",
    "rate-limited": "Discord blokkeert tijdelijk door te veel pogingen. Wacht 5 tot 10 minuten en probeer opnieuw."
  };
  const errorElement = $("#lockError");
  if (!errorElement || !messages[errorCode]) return;
  errorElement.textContent = messages[errorCode];
  errorElement.hidden = false;
  window.history.replaceState({}, document.title, window.location.pathname);
}

function avatarFor(member) {
  if (member.avatar) return member.avatar;
  const initials = member.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
      <rect width="96" height="96" rx="48" fill="#e17000"/>
      <text x="50%" y="55%" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="Segoe UI, Arial" font-size="34" font-weight="800">${initials}</text>
    </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function hiredDateFor(person) {
  return person.hiredDate || person.rankHistory?.[0]?.date || person.rankDate || "-";
}

function slugForPerson(person) {
  const base = String(person?.name || person?.serviceNumber || person?.id || "profiel").trim() || "profiel";
  return encodeURIComponent(base.replace(/\s+/g, "_"));
}

function normalizeRouteSlug(value) {
  return decodeURIComponent(String(value || "")).replace(/_/g, " ").trim().toLowerCase();
}

function personFromRouteSlug(slug) {
  const normalized = normalizeRouteSlug(slug);
  return (state.people || []).find((person) => {
    const name = String(person.name || "").trim().toLowerCase();
    const serviceNumber = String(person.serviceNumber || "").trim().toLowerCase();
    const id = String(person.id || "").trim().toLowerCase();
    return isCurrentProfile(person) && (name === normalized || serviceNumber === normalized || id === normalized);
  }) || null;
}

function routeForPage(page) {
  if (page === "mijn-profiel") {
    const own = currentProfile();
    const viewed = visibleProfile();
    if (viewed && own && viewed.id !== own.id) return `/medewerkers/${slugForPerson(viewed)}`;
  }
  return pageRouteMap[page] || "/";
}

function routeStateFromLocation() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  if (parts[0]?.toLowerCase() === "medewerkers" && parts[1]) {
    const person = personFromRouteSlug(parts.slice(1).join("/"));
    return person ? { page: "mijn-profiel", profileId: person.id } : { page: "medewerkers", profileId: "" };
  }
  if (parts[0]?.toLowerCase() === "i8-archief" && parts[1]) {
    return { page: "i8-archief", profileId: "", i8Number: parts[1] };
  }
  const normalizedPath = path.toLowerCase();
  return { page: routePageMap[normalizedPath] || "dashboard", profileId: "" };
}

function syncBrowserRoute(page, mode = "push") {
  if (suppressRouteSync || document.body.classList.contains("locked")) return;
  const nextPath = routeForPage(page);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === nextPath) return;
  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method]({ page, profileId: selectedProfileId || "" }, "", nextPath);
}

function applyRouteState(mode = "replace") {
  const route = routeStateFromLocation();
  suppressRouteSync = true;
  selectedProfileId = route.profileId || "";
  if (route.page === "mijn-profiel") renderProfile();
  const resolvedPage = setPage(route.page);
  suppressRouteSync = false;
  if (!route.i8Number || resolvedPage !== route.page) {
    syncBrowserRoute(resolvedPage || activePageId(), mode);
  }
  if (typeof handleI8ArchiveRoute === "function") handleI8ArchiveRoute(route);
}
function pageTitle(page) {
  if (page === "mijn-profiel") {
    const own = currentProfile();
    const viewed = visibleProfile();
    return viewed && own && viewed.id !== own.id ? "Profiel" : "Mijn profiel";
  }
  return {
    dashboard: "Dashboard",
    medewerkers: "Medewerkers",
    personeel: "Personeel",
    "mentor-overzicht": "Mentor-Overzicht",
    "mentor-traject": "Mentor-Traject",
    "mentor-toets": "Mentor-Toets",
    "mentor-toetsen": "Mentor-Toetsen",
    "mentor-checklist": "Mentor-Checklist",
    "mentor-logboek": "Mentor-Logboek",
    "trainer-overzicht": "Trainer-Overzicht",
    "trainer-ibt": "IBT-Toetsen",
    "trainer-logboek": "Trainer-Logboek",
    afwezigheid: "Afwezigheid",
    "beschikbaarheids-agenda": "Beschikbaarheids-agenda",
    "i8-opstellen": "I8-Formulier",
    "ontslag-formulier": "Ontslag-Formulier",
    voertuiginbeslagname: "Voertuiginbeslagname",
    "i8-controleren": "I8-Controleren",
    "i8-archief": "I8-Archief",
    "ovj-logboek": "hOvJ-Logboek",
    "afwezigheid-overzicht": "Afwezigheid overzicht",
    "ontslag-overzicht": "Ontslag-Overzicht",
    "ops-tijden": `${portalOperatorLabel} tijden`,
    "personeel-aannemen": "Personeel Aannemen",
    blacklist: "Blacklist",
    archief: "Personeels-Archief",
    systeemstatus: "Systeemstatus",
    logboek: "Logboek"
  }[page];
}

function validPage(page) {
  const visiblePages = new Set(["dashboard", "mijn-profiel", "medewerkers", "afwezigheid", "beschikbaarheids-agenda", "i8-opstellen", "ontslag-formulier", "voertuiginbeslagname", "i8-controleren", "i8-archief", "afwezigheid-overzicht", "ontslag-overzicht", "ops-tijden", "mentor-overzicht", "mentor-traject", "mentor-toets", "mentor-toetsen", "mentor-checklist", "mentor-logboek", "trainer-overzicht", "trainer-ibt", "trainer-logboek", "ovj-logboek", "personeel-aannemen", "blacklist", "personeel", "archief", "systeemstatus", "logboek"]);
  return visiblePages.has(page) ? page : "dashboard";
}

function saveCurrentPage(page) {
  sessionStorage.setItem(pageStorageKey, page);
  if (page === "mijn-profiel") {
    if (selectedProfileId) {
      sessionStorage.setItem(profileStorageKey, selectedProfileId);
    } else {
      sessionStorage.removeItem(profileStorageKey);
    }
  } else {
    sessionStorage.removeItem(profileStorageKey);
  }
  if (page === "mentor-checklist" && selectedMentorProfileId) {
    sessionStorage.setItem(mentorStorageKey, selectedMentorProfileId);
  } else {
    sessionStorage.removeItem(mentorStorageKey);
  }
}

function resetSavedPage() {
  selectedProfileId = "";
  selectedMentorProfileId = "";
  sessionStorage.removeItem(profileStorageKey);
  sessionStorage.removeItem(mentorStorageKey);
  sessionStorage.setItem(pageStorageKey, "dashboard");
}

function freshLoginRedirected() {
  const params = new URLSearchParams(window.location.search);
  return params.get("login") === "1";
}

function shouldOpenOwnProfile() {
  const params = new URLSearchParams(window.location.search);
  return params.get("openProfile") === "1" || localStorage.getItem(openProfileFlagKey) === "1";
}

function cleanOpenProfileRedirect() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("openProfile")) return;
  url.searchParams.delete("openProfile");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, next || "/");
}

function captureOpenProfileRequest() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("openProfile") !== "1") return;
  localStorage.setItem(openProfileFlagKey, "1");
  cleanOpenProfileRedirect();
}

function authLoginUrl() {
  return "/api/auth/login";
}

function portoAppUrl() {
  if (window.PORTO_APP_URL) return window.PORTO_APP_URL;
  if (["localhost", "127.0.0.1"].includes(window.location.hostname)) return "http://localhost:3002";
  if (organizationKey === "politie") return "https://porto.orppolitie.nl";
  return "https://porto.orpdefensie.nl";
}

function cleanLoginRedirect() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("login")) return;
  url.searchParams.delete("login");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, next || "/");
}

function setPage(page) {
  page = validPage(page);
  if (page === "logboek" && !canViewKaderPages()) {
    page = "dashboard";
  }
  if (page === "ops-tijden" && !canViewOpsTimes()) {
    page = "dashboard";
  }
  if (page === "afwezigheid-overzicht" && !canViewAbsenceOverview()) page = "dashboard";
  if (page === "ontslag-overzicht" && !canViewResignationOverview()) page = "dashboard";
  if (page === "archief" && !canViewPersonnelArchive()) page = "dashboard";
  if (page === "personeel" && !canViewPersonnel()) {
    page = "dashboard";
  }
  if (["i8-controleren", "i8-archief"].includes(page) && !canViewOvJChannels()) {
    page = "dashboard";
  }
  if (page === "ovj-logboek" && !canViewOvJLeadershipLog()) {
    page = canViewOvJChannels() ? "i8-controleren" : "dashboard";
  }
  if (["mentor-overzicht", "mentor-checklist"].includes(page) && !canViewMentorOverview()) {
    page = "dashboard";
  }
  if (page === "personeel-aannemen" && !canViewRecruitment()) {
    page = "dashboard";
  }
  if (page === "blacklist" && !canViewBlacklist()) {
    page = "dashboard";
  }
  if (page === "systeemstatus" && !canViewSystemHealth()) {
    page = "dashboard";
  }
  if (page === "mentor-traject" && !canViewOwnMentorTrajectory()) {
    page = canViewMentorOverview() ? "mentor-overzicht" : "dashboard";
  }
  if (page === "mentor-toets" && !canViewOwnMentorTrajectory()) {
    page = canViewMentorOverview() ? "mentor-overzicht" : "dashboard";
  }
  if (page === "mentor-toetsen" && !canViewMentorLeadershipLog()) {
    page = canViewMentorOverview() ? "mentor-overzicht" : "dashboard";
  }
  if (page === "mentor-logboek" && !canViewMentorLeadershipLog()) {
    page = canViewMentorOverview() ? "mentor-overzicht" : "dashboard";
  }
  if (page === "trainer-overzicht" && !canViewTrainerOverview()) {
    page = "dashboard";
  }
  if (page === "trainer-ibt" && !canReviewTrainerIbtForms()) {
    page = canViewTrainerOverview() ? "trainer-overzicht" : "dashboard";
  }
  if (page === "trainer-logboek" && !canViewTrainerLogbook()) {
    page = canViewTrainerOverview() ? "trainer-overzicht" : "dashboard";
  }
  $$(".page").forEach((element) => element.classList.toggle("active", element.id === page));
  $$(".nav-item").forEach((element) => element.classList.toggle("active", element.dataset.page === page));
  $("#pageTitle").textContent = pageTitle(page);
  const profileNav = $(".profile-nav-buttons");
  if (profileNav) profileNav.hidden = page !== "mijn-profiel";
  if (page === "mijn-profiel") updateProfileNavigationButtons(visibleProfile());
  saveCurrentPage(page);
  syncBrowserRoute(page);
  if (!isMentorTestStaticPageId(page) && typeof window !== "undefined") {
    window.setTimeout(flushPausedStaticPageLiveRefresh, 0);
  }
  if (page === "trainer-ibt" && typeof renderTrainerIbtReviews === "function") {
    renderTrainerIbtReviews();
  }
  if (page === "systeemstatus") {
    renderSystemHealth();
  }
  return page;
}

function restoreSavedPage() {
  if (shouldOpenOwnProfile()) {
    selectedProfileId = "";
    sessionStorage.setItem(pageStorageKey, "mijn-profiel");
    sessionStorage.removeItem(profileStorageKey);
    localStorage.removeItem(openProfileFlagKey);
    cleanOpenProfileRedirect();
    openProfilePage("");
    return;
  }

  if (freshLoginRedirected()) {
    resetSavedPage();
    cleanLoginRedirect();
    setPage("dashboard");
    return;
  }

  const hasDeepRoute = !["/", "/index.html"].includes(window.location.pathname);
  if (hasDeepRoute) {
    applyRouteState("replace");
    return;
  }

  const savedPage = validPage(sessionStorage.getItem(pageStorageKey) || "dashboard");
  if (savedPage === "mijn-profiel") {
    selectedProfileId = sessionStorage.getItem(profileStorageKey) || "";
    renderProfile();
  }
  setPage(savedPage);
}

function renderDashboard() {
  const dashboardPeople = state.people.filter(isCurrentProfile);
  const activePeople = dashboardPeople.filter((person) => normalizedProfileStatus(person) === "Actief");
  const absentMemberIds = new Set(
    state.absences
      .filter(absenceIsActive)
      .map((absence) => absence.memberId)
      .filter(Boolean)
  );
  const absentCount = dashboardPeople.filter((person) => (
    normalizedProfileStatus(person) === "Afwezig" || absentMemberIds.has(person.id)
  )).length;
  $("#statActive").textContent = activePeople.length;
  $("#statAbsent").textContent = absentCount;
  // Het dashboard telt huidig personeel inclusief afwezigheden.
  // Historische, ontslagen en non-actieve profielen horen niet in dit totaal.
  $("#statTotal").textContent = dashboardPeople.length;

  const rankCounts = ranks
    .map((rank) => ({
      rank,
      count: dashboardPeople.filter((person) => person.rank === rank).length
    }))
    .filter((item) => item.count > 0);

  function rankLegendDisplayOrder(items) {
    const calmTwoColumn = document.documentElement.dataset.uiMode === "calm"
      && window.matchMedia("(min-width: 1321px)").matches;
    if (!calmTwoColumn || items.length < 3) return items;
    const leftColumnLength = Math.ceil(items.length / 2);
    const leftColumn = items.slice(0, leftColumnLength);
    const rightColumn = items.slice(leftColumnLength);
    const ordered = [];
    for (let index = 0; index < leftColumnLength; index += 1) {
      if (leftColumn[index]) ordered.push(leftColumn[index]);
      if (rightColumn[index]) ordered.push(rightColumn[index]);
    }
    return ordered;
  }

  if (!rankCounts.length) {
    rankPieSegments = [];
    $("#rankPie").style.background = "var(--surface-2)";
    $("#rankLegend").innerHTML = '<div class="feed-item">Nog geen huidige leden.</div>';
  } else {
    const sortedRankCounts = rankCounts;
    const rankTotal = sortedRankCounts.reduce((total, item) => total + item.count, 0) || 1;
    let cursor = 0;
    rankPieSegments = [];
    const segments = sortedRankCounts.map((item) => {
      const start = cursor;
      const end = cursor + (item.count / rankTotal) * 100;
      cursor = end;
      rankPieSegments.push({ rank: item.rank, count: item.count, start, end });
      return `${rankColors[item.rank]} ${start}% ${end}%`;
    });
    const isCalmUi = document.documentElement.dataset.uiMode === "calm";
    $("#rankPie").style.background = isCalmUi
      ? `linear-gradient(90deg, ${segments.join(", ")})`
      : `conic-gradient(${segments.join(", ")})`;
    const maxRankCount = Math.max(...sortedRankCounts.map((item) => item.count), 1);
    $("#rankLegend").innerHTML = rankLegendDisplayOrder(sortedRankCounts)
      .map((item) => {
        const width = Math.max(8, Math.round((item.count / maxRankCount) * 100));
        return `
        <div class="rank-legend-item">
          <span class="rank-swatch" style="background:${rankColors[item.rank]}"></span>
          <span class="rank-name">${escapeHtml(item.rank)}</span>
          <span class="rank-bar-track"><span class="rank-bar-fill" style="width:${width}%"></span></span>
          <span class="rank-count">${item.count}</span>
        </div>`;
      })
      .join("");
  }

  function normalizeServiceNumberForRange(value) {
    return String(value || "")
      .trim()
      .replace(/[–—−]/g, "-")
      .replace(/\s+/g, "");
  }

  function personInServiceRange(person, category) {
    if (!Array.isArray(category.ranges) || !category.ranges.length) return category.ranks.includes(person.rank);
    const match = /^(\d{2})-(\d{2,3})$/.exec(normalizeServiceNumberForRange(person.serviceNumber));
    if (!match) return false;
    const prefix = match[1];
    const number = Number(match[2]);
    return category.ranges.some((range) => (
      String(range.prefix) === prefix
      && number >= Number(range.min)
      && number <= Number(range.max)
    ));
  }

  $("#serviceRangeRows").innerHTML = rankCategories
    .map((category) => {
      const count = dashboardPeople.filter((person) => personInServiceRange(person, category)).length;
      return `
        <div class="range-row">
          <strong>${escapeHtml(category.serviceRange)}</strong>
          <span>${escapeHtml(category.title)}</span>
          <span>${count}</span>
        </div>
      `;
    })
    .join("");

}

function rankPieSegmentFromEvent(event) {
  const pie = event.currentTarget;
  const rect = pie.getBoundingClientRect();
  if (document.documentElement.dataset.uiMode === "calm") {
    const percent = Math.max(0, Math.min(100, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100));
    return rankPieSegments.find((segment, index) => percent >= segment.start && (percent < segment.end || index === rankPieSegments.length - 1)) || null;
  }
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const radius = rect.width / 2;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > radius || distance < radius * 0.3) return null;
  const percent = ((Math.atan2(dy, dx) * 180 / Math.PI + 90 + 360) % 360) / 3.6;
  return rankPieSegments.find((segment, index) => percent >= segment.start && (percent < segment.end || index === rankPieSegments.length - 1)) || null;
}

function moveRankPieTooltip(event) {
  const tooltip = $("#rankPieTooltip");
  const segment = rankPieSegmentFromEvent(event);
  if (!tooltip || !segment) {
    hideRankPieTooltip();
    return;
  }
  const pieRect = event.currentTarget.getBoundingClientRect();
  tooltip.innerHTML = `<strong>${escapeHtml(segment.rank)}</strong><span>${segment.count} ${segment.count === 1 ? "lid" : "leden"}</span>`;
  tooltip.style.left = `${event.clientX - pieRect.left + 12}px`;
  tooltip.style.top = `${event.clientY - pieRect.top + 12}px`;
  tooltip.hidden = false;
}

function hideRankPieTooltip() {
  const tooltip = $("#rankPieTooltip");
  if (tooltip) tooltip.hidden = true;
}
function renderKaderNavigation() {
  const showKaderPages = canViewKaderPages();
  const showPersonnel = canViewPersonnel();
  const showAbsenceOverview = canViewAbsenceOverview();
  const showResignationOverview = canViewResignationOverview();
  const showPersonnelArchive = canViewPersonnelArchive();
  const showOpsTimes = canViewOpsTimes();
  const showOvJ = canViewOvJChannels();
  const showMentorOverview = canViewMentorOverview();
  const showMentorTrajectory = canViewOwnMentorTrajectory();
  const showMentorSection = canViewMentorSection();
  const showTrainerSection = canViewTrainerSection();
  const showTrainerOverview = canViewTrainerOverview();
  const showTrainerIbt = canReviewTrainerIbtForms();
  const showTrainerLogbook = canViewTrainerLogbook();
  const showRecruitment = canViewRecruitment();
  const showBlacklist = canViewBlacklist();
  const showSystemHealth = canViewSystemHealth();
  const showWs = showRecruitment || showBlacklist;
  const showOvJLeadership = canViewOvJLeadershipLog();
  const showMentorLeadership = canViewMentorLeadershipLog();
  $$('[data-kader-only="true"]').forEach((element) => {
    element.hidden = !showKaderPages;
  });
  $$('[data-personnel-only="true"]').forEach((element) => {
    element.hidden = !showPersonnel;
  });
  $$('[data-absence-review-only="true"]').forEach((element) => {
    element.hidden = !showAbsenceOverview;
  });
  $$('[data-resignation-overview-only="true"]').forEach((element) => {
    element.hidden = !showResignationOverview;
  });
  $$('[data-personnel-archive-only="true"]').forEach((element) => {
    element.hidden = !showPersonnelArchive;
  });
  $$('[data-ops-times-only="true"]').forEach((element) => {
    element.hidden = !showOpsTimes;
  });
  $$('[data-ovj-only="true"]').forEach((element) => {
    element.hidden = !showOvJ;
  });
  $$('[data-mentor-section="true"]').forEach((element) => {
    element.hidden = !showMentorSection;
  });
  $$('[data-mentor-overview-only="true"]').forEach((element) => {
    element.hidden = !showMentorOverview;
  });
  $$('[data-mentor-traject-only="true"]').forEach((element) => {
    element.hidden = !showMentorTrajectory;
  });
  $$('[data-trainer-section="true"]').forEach((element) => {
    element.hidden = !showTrainerSection;
  });
  $$('[data-trainer-overview-only="true"]').forEach((element) => {
    element.hidden = !showTrainerOverview;
  });
  $$('[data-trainer-ibt-only="true"]').forEach((element) => {
    element.hidden = !showTrainerIbt;
  });
  $$('[data-trainer-logbook-only="true"]').forEach((element) => {
    element.hidden = !showTrainerLogbook;
  });
  $$('[data-ws-only="true"]').forEach((element) => {
    element.hidden = !showWs;
  });
  $$('[data-ovj-leadership-only="true"]').forEach((element) => {
    element.hidden = !showOvJLeadership;
  });
  $$('[data-mentor-leadership-only="true"]').forEach((element) => {
    element.hidden = !showMentorLeadership;
  });
  $$('[data-mentor-test-template-only="true"]').forEach((element) => {
    element.hidden = !canManageMentorTestTemplate();
  });
  $$('[data-system-health-only="true"]').forEach((element) => {
    element.hidden = !showSystemHealth;
  });
  $$('[data-restricted-divider="true"]').forEach((element) => {
    element.hidden = !(showKaderPages || showPersonnel || showAbsenceOverview || showResignationOverview || showPersonnelArchive || showSystemHealth || showOvJ || showMentorSection || showTrainerSection || showWs || showOvJLeadership || showMentorLeadership);
  });
  renderNavigationCounters();
  if (!showKaderPages && $("#logboek").classList.contains("active")) {
    setPage("dashboard");
  }
  if (!showOpsTimes && $("#ops-tijden").classList.contains("active")) {
    setPage("dashboard");
  }
  if (!showAbsenceOverview && $("#afwezigheid-overzicht").classList.contains("active")) setPage("dashboard");
  if (!showResignationOverview && $("#ontslag-overzicht").classList.contains("active")) setPage("dashboard");
  if (!showPersonnelArchive && $("#archief").classList.contains("active")) setPage("dashboard");
  if (!showPersonnel && $("#personeel").classList.contains("active")) {
    setPage("dashboard");
  }
  if (!showOvJ && ($("#i8-controleren").classList.contains("active") || $("#i8-archief").classList.contains("active"))) {
    setPage("dashboard");
  }
  if (!showOvJLeadership && $("#ovj-logboek")?.classList.contains("active")) {
    setPage(showOvJ ? "i8-controleren" : "dashboard");
  }
  if (!showMentorOverview && ($("#mentor-overzicht").classList.contains("active") || $("#mentor-checklist").classList.contains("active"))) {
    setPage("dashboard");
  }
  if (!showMentorTrajectory && ($("#mentor-traject").classList.contains("active") || $("#mentor-toets")?.classList.contains("active"))) {
    setPage(showMentorOverview ? "mentor-overzicht" : "dashboard");
  }
  if (!showMentorLeadership && ($("#mentor-logboek")?.classList.contains("active") || $("#mentor-toetsen")?.classList.contains("active"))) {
    setPage(showMentorOverview ? "mentor-overzicht" : "dashboard");
  }
  if (!showTrainerOverview && $("#trainer-overzicht")?.classList.contains("active")) {
    setPage("dashboard");
  }
  if (!showTrainerIbt && $("#trainer-ibt")?.classList.contains("active")) {
    setPage(showTrainerOverview ? "trainer-overzicht" : "dashboard");
  }
  if (!showTrainerLogbook && $("#trainer-logboek")?.classList.contains("active")) {
    setPage(showTrainerOverview ? "trainer-overzicht" : "dashboard");
  }
  if (!showRecruitment && $("#personeel-aannemen")?.classList.contains("active")) {
    setPage("dashboard");
  }
  if (!showBlacklist && $("#blacklist")?.classList.contains("active")) {
    setPage("dashboard");
  }
  if (!showSystemHealth && $("#systeemstatus")?.classList.contains("active")) {
    setPage("dashboard");
  }
}

function openI8ReviewCount() {
  return (state.i8Forms || []).filter((form) => ["pending", "in_review"].includes(form.status || "pending")).length;
}

function linkedResignationProfile(form) {
  if (!form?.memberId) return null;
  return (state.people || []).find((person) => person.id === form.memberId) || null;
}

function isHandledResignationForm(form) {
  if (["Verwerkt", "Geannuleerd"].includes(form?.status || "Ingediend")) return true;
  const linkedProfile = linkedResignationProfile(form);
  return Boolean(linkedProfile && !isCurrentProfile(linkedProfile));
}

function openResignationFormCount() {
  return (state.resignationForms || []).filter((form) => !isHandledResignationForm(form)).length;
}

function setNavCounter(selector, count, visible) {
  const badge = $(selector);
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = !visible || count <= 0;
}

function renderNavigationCounters() {
  // Sidebar-tellers volgen dezelfde openstaande items als de achterliggende overzichtspagina's.
  setNavCounter("#absenceOverviewCounter", openAbsenceRequestCount(), canViewAbsenceOverview());
  setNavCounter("#resignationOverviewCounter", openResignationFormCount(), canViewResignationOverview());
  setNavCounter("#i8ReviewCounter", openI8ReviewCount(), canViewOvJChannels());
  setNavCounter("#trainerIbtCounter", typeof trainerIbtPendingReviewCount === "function" ? trainerIbtPendingReviewCount() : 0, canReviewTrainerIbtForms());
}

function activePageId() {
  return $(".page.active")?.id || "dashboard";
}

let liveRefreshPausedByStaticPage = false;

function isMentorTestStaticPageId(page) {
  return page === "mentor-toets" || page === "mentor-toetsen";
}

function isMentorTestStaticPageActive() {
  return isMentorTestStaticPageId(activePageId()) || Boolean($("#mentorTestTemplateDialog")?.open);
}

function flushPausedStaticPageLiveRefresh() {
  if (!liveRefreshPausedByStaticPage || isMentorTestStaticPageActive()) return;
  liveRefreshPausedByStaticPage = false;
  scheduleLiveRefresh("state");
}

// Voorkomt dat live refresh een geopend rechtermuismenu uit de DOM rendert.
function hasOpenTransientMenu() {
  return Boolean(
    $(".card-menu-panel.is-context-open") ||
    $("#disciplineContextMenu:not([hidden])") ||
    $("#absenceContextMenu:not([hidden])") ||
    $("#i8ArchiveContextMenu:not([hidden])") ||
    $("#mentorTestContextMenu:not([hidden])")
  );
}

function hasActiveMentorChecklistInteraction() {
  const notesField = $("#mentorNotes");
  const isTypingMentorNote = activePageId() === "mentor-checklist" && notesField && document.activeElement === notesField;
  const hasUnsavedMentorNote = activePageId() === "mentor-checklist" && notesField && notesField.value.trim().length > 0;
  const isSavingMentorChecklist = typeof isMentorChecklistSaveActive === "function" && isMentorChecklistSaveActive();
  return activePageId() === "mentor-checklist" && (Date.now() < mentorChecklistEditingUntil || isSavingMentorChecklist || isTypingMentorNote || hasUnsavedMentorNote);
}

function hasActiveLiveEditInteraction() {
  const active = document.activeElement;
  if (!active) return false;
  if (active.matches?.("textarea, input, select, [contenteditable='true']")) return true;
  if (active.closest?.("dialog[open], .site-notice-dialog[open]")) return true;
  return false;
}

function renderLiveScope(scope = "state") {
  const page = activePageId();
  const keepMentorTestPageStable = isMentorTestStaticPageActive();
  renderKaderNavigation();
  renderNavigationCounters();
  renderNotifications();

  if (["people", "state"].includes(scope)) {
    renderProfile();
    renderDashboard();
    renderEmployeeDirectory();
    renderMentorOverview();
    renderMentorChecklist();
    renderMentorTrajectory();
    if (!keepMentorTestPageStable) {
      renderMentorTestPage();
      renderMentorTestsOverview();
    }
    renderMentorLeadershipLog();
    renderTrainerOverview();
    renderTrainerLogbook();
    renderRecruitment();
    renderPeople();
    renderArchive();
    renderVehicleSeizures();
    renderBlacklist();
    renderOvJLeadershipLog();
    renderLogbook();
  }

  if (["forms", "state"].includes(scope)) {
    renderDashboard();
    renderI8Forms();
    renderOvJLeadershipLog();
    renderAbsenceOverview();
    renderAvailabilityAgenda();
    renderResignationOverview();
    renderLogbook();
  }

  if (["vehicle-seizures", "state"].includes(scope)) {
    renderVehicleSeizures();
    renderLogbook();
  }

  if (["public-forms", "state"].includes(scope)) {
    if (page === "trainer-ibt" && typeof refreshTrainerIbtReviewsSilently === "function") {
      refreshTrainerIbtReviewsSilently();
    } else if (typeof resetTrainerIbtReviewCache === "function") {
      resetTrainerIbtReviewCache();
    }
    renderLogbook();
  }

  if (!["people", "forms", "public-forms", "porto", "vehicle-seizures", "state"].includes(scope)) {
    render();
  }

  setPage(page);
}
async function refreshReviewCounters() {
  if (!authProfile || !serverBacked || document.body.classList.contains("locked")) return;
  if (document.visibilityState === "hidden") return;
  if (isMentorTestStaticPageActive()) return;
  if (reviewCounterLoadPromise) return reviewCounterLoadPromise;
  if (hasOpenTransientMenu() || hasActiveMentorChecklistInteraction() || hasActiveLiveEditInteraction()) return;
  reviewCounterLoadPromise = (async () => {
    const loaded = await loadState();
    if (!loaded) return;
    renderNavigationCounters();
    const page = activePageId();
    if (page === "i8-controleren") renderI8Forms();
    if (page === "afwezigheid-overzicht") renderAbsenceOverview();
    if (page === "beschikbaarheids-agenda") renderAvailabilityAgenda();
    if (page === "ontslag-overzicht") renderResignationOverview();
    if (page === "blacklist") renderBlacklist();
    if (page === "voertuiginbeslagname") renderVehicleSeizures();
    if (page === "trainer-overzicht") renderTrainerOverview();
    if (page === "trainer-ibt") {
      if (typeof refreshTrainerIbtReviewsSilently === "function") refreshTrainerIbtReviewsSilently();
    }
    if (page === "trainer-logboek") renderTrainerLogbook();
    if (page === "dashboard") renderDashboard();
  })().finally(() => {
    reviewCounterLoadPromise = null;
  });
  return reviewCounterLoadPromise;
}

function startReviewCounterPolling() {
  if (reviewCounterPoll) return;
  reviewCounterPoll = window.setInterval(refreshReviewCounters, REVIEW_COUNTER_FALLBACK_MS);
}

// Houdt het ontslagformulier gekoppeld aan het eigen actieve profiel.
// Houdt het W&S-formulier gekoppeld aan het ingelogde profiel en de huidige datum.

const pendingLiveScopes = new Set();
let liveRefreshDeferTimer = null;

function suppressImmediateLiveRefresh() {
  liveRefreshSuppressUntil = Date.now() + LIVE_REFRESH_LOCAL_ACTION_SUPPRESS_MS;
  pendingLiveScopes.clear();
  if (liveRefreshTimer) {
    window.clearTimeout(liveRefreshTimer);
    liveRefreshTimer = null;
  }
  if (liveRefreshDeferTimer) {
    window.clearTimeout(liveRefreshDeferTimer);
    liveRefreshDeferTimer = null;
  }
}

function isLiveRefreshSuppressed() {
  return Date.now() < liveRefreshSuppressUntil;
}

function scheduleLiveRefresh(scope = "state") {
  if (isLiveRefreshSuppressed()) return;
  pendingLiveScopes.add(scope || "state");
  if (liveRefreshTimer) return;
  liveRefreshTimer = window.setTimeout(async () => {
    liveRefreshTimer = null;
    if (isLiveRefreshSuppressed()) {
      pendingLiveScopes.clear();
      return;
    }
    if (!authProfile || !serverBacked || document.body.classList.contains("locked")) return;
    if (isMentorTestStaticPageActive()) {
      liveRefreshPausedByStaticPage = true;
      return;
    }
    if (hasOpenTransientMenu() || hasActiveMentorChecklistInteraction() || hasActiveLiveEditInteraction()) {
      if (!liveRefreshDeferTimer) {
        liveRefreshDeferTimer = window.setTimeout(() => {
          liveRefreshDeferTimer = null;
          scheduleLiveRefresh("state");
        }, 1200);
      }
      return;
    }
    const scopes = Array.from(pendingLiveScopes);
    pendingLiveScopes.clear();
    const loaded = await loadState();
    if (!loaded) return;
    const uniqueScopes = scopes.includes("state") ? ["state"] : [...new Set(scopes)];
    uniqueScopes.forEach(renderLiveScope);
  }, 350);
}

function listenForLiveScope(scope) {
  liveEventSource.addEventListener(`${scope}:update`, () => scheduleLiveRefresh(scope));
}

function startLiveUpdates() {
  if (liveEventSource || typeof EventSource === "undefined") return;
  liveEventSource = new EventSource("/api/events");
  liveEventSource.addEventListener("state:update", (event) => {
    const payload = JSON.parse(event.data || "{}");
    scheduleLiveRefresh(payload.scope || "state");
  });
  ["people", "forms", "porto", "public-forms", "vehicle-seizures"].forEach(listenForLiveScope);
  liveEventSource.onerror = () => {
    liveEventSource?.close();
    liveEventSource = null;
    window.setTimeout(startLiveUpdates, 5000);
  };
}

function stopLiveUpdates() {
  liveEventSource?.close();
  liveEventSource = null;
  if (liveRefreshTimer) window.clearTimeout(liveRefreshTimer);
  if (liveRefreshDeferTimer) window.clearTimeout(liveRefreshDeferTimer);
  liveRefreshTimer = null;
  liveRefreshDeferTimer = null;
  liveRefreshPausedByStaticPage = false;
  pendingLiveScopes.clear();
}

function vehicleSeizureStatusLabel(seizure = {}) {
  return seizure.status === "Vrijgegeven" ? "Vrijgegeven" : "Actief";
}

function vehicleSeizuresSorted() {
  return [...(state.vehicleSeizures || [])].sort((first, second) => (
    new Date(second.createdAt || second.updatedAt || 0) - new Date(first.createdAt || first.updatedAt || 0)
  ));
}

function renderVehicleSeizures() {
  const list = $("#vehicleSeizureList");
  if (!list) return;
  const query = ($("#vehicleSeizureSearchInput")?.value || "").trim().toLowerCase();
  const statusFilter = $("#vehicleSeizureStatusFilter")?.value || "active";
  const rows = vehicleSeizuresSorted().filter((seizure) => {
    const status = vehicleSeizureStatusLabel(seizure);
    if (statusFilter === "active" && status !== "Actief") return false;
    if (statusFilter === "released" && status !== "Vrijgegeven") return false;
    if (!query) return true;
    return [
      seizure.vehicle,
      seizure.plate,
      seizure.ownerName,
      seizure.location,
      seizure.reason,
      seizure.notes,
      seizure.organization,
      seizure.createdByName,
      seizure.releasedByName
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });

  if (!rows.length) {
    list.innerHTML = '<div class="feed-item">Geen voertuigen gevonden.</div>';
    return;
  }

  const canRelease = canManageVehicleSeizures();
  list.innerHTML = rows.map((seizure) => {
    const status = vehicleSeizureStatusLabel(seizure);
    const active = status === "Actief";
    return `
      <article class="vehicle-seizure-card ${active ? "active" : "released"}">
        <header class="vehicle-seizure-card-head">
          <div>
            <span class="vehicle-seizure-plate">${escapeHtml(seizure.plate || "-")}</span>
            <h3>${escapeHtml(seizure.vehicle || "-")}</h3>
            <p>${escapeHtml(seizure.ownerName || "-")} &bull; ${escapeHtml(seizure.location || "-")}</p>
          </div>
          <span class="vehicle-seizure-status ${active ? "active" : "released"}">${escapeHtml(status)}</span>
        </header>
        <div class="vehicle-seizure-meta">
          <div><span>Reden</span><strong>${escapeHtml(seizure.reason || "-")}</strong></div>
          <div><span>Opmerking</span><strong>${escapeHtml(seizure.notes || "-")}</strong></div>
          <div><span>Ingevoerd</span><strong>${escapeHtml(seizure.createdByName || "Onbekend")} - ${escapeHtml(formatDateTime(seizure.createdAt))}</strong></div>
          <div><span>Organisatie</span><strong>${escapeHtml(seizure.organization || "-")}</strong></div>
          ${!active ? `
            <div><span>Vrijgegeven</span><strong>${escapeHtml(seizure.releasedByName || "Onbekend")} - ${escapeHtml(formatDateTime(seizure.releasedAt))}</strong></div>
            <div><span>Vrijgave reden</span><strong>${escapeHtml(seizure.releaseReason || "-")}</strong></div>
          ` : ""}
        </div>
        ${active && canRelease ? `
          <div class="vehicle-seizure-actions">
            <button class="ghost secondary" type="button" data-vehicle-seizure-release="${escapeHtml(seizure.id)}">Vrijgeven</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}
function renderLogbook() {
  const canView = canViewKaderPages();
  $("#activityFeed").innerHTML = canView
    ? (state.activity || [])
        .slice(-25)
        .reverse()
        .map((item) => `<div class="feed-item">${escapeHtml(item)}</div>`)
        .join("")
    : '<div class="feed-item">Geen toegang.</div>';
}

function memberName(id) {
  return state.people.find((person) => person.id === id)?.name || "Onbekend";
}

function ownNotifications() {
  const current = currentProfile();
  return Array.isArray(current?.notifications) ? [...current.notifications] : [];
}


function notificationTypeLabel(type) {
  return {
    i8: "I8",
    absence: "Verlof",
    training: "Training"
  }[type] || "Melding";
}

function notificationI8Form(notification) {
  const formId = notification?.meta?.i8FormId;
  if (!formId) return null;
  return (state.i8Forms || []).find((form) => form.id === formId) || null;
}

function notificationTitle(notification) {
  const baseTitle = notification.title || "Nieuwe melding";
  const form = notificationI8Form(notification);
  if (!form) return baseTitle;
  const number = notification.meta?.i8Number || (typeof i8NumberFor === "function" ? i8NumberFor(form, state.i8Forms || []) : "");
  if (!number || baseTitle.includes(`I8 ${number}`)) return baseTitle;
  return `I8 ${number} ${baseTitle.replace(/^I8\s*/i, "")}`.trim();
}

function openNotificationTarget(notificationId) {
  const notification = ownNotifications().find((entry) => entry.id === notificationId);
  const form = notificationI8Form(notification);
  if (!form) return;
  closeNotificationPanel();
  setPage("i8-opstellen");
  if (typeof setI8Tab === "function") setI8Tab("list");
  if (typeof renderI8Forms === "function") renderI8Forms();
  if (typeof openI8DetailDialog === "function") openI8DetailDialog(form.id);
}

function renderNotifications() {
  const notifications = ownNotifications().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const counter = $("#notificationCounter");
  const list = $("#notificationList");
  const readAll = $("#notificationReadAll");
  const clearAll = $("#notificationClearAll");
  if (counter) {
    counter.textContent = String(unread);
    counter.hidden = unread <= 0;
  }
  if (readAll) readAll.disabled = unread <= 0;
  if (clearAll) clearAll.disabled = notifications.length <= 0;
  if (!list) return;
  list.innerHTML = notifications.length
    ? notifications.slice(0, 20).map((notification) => {
      const hasI8Target = Boolean(notificationI8Form(notification));
      return `
        <article class="notification-item ${notification.readAt ? "is-read" : "is-unread"} ${hasI8Target ? "is-clickable" : ""}" ${hasI8Target ? `data-notification-open="${escapeHtml(notification.id)}" role="button" tabindex="0"` : ""}>
          <span>${escapeHtml(notificationTypeLabel(notification.type))}</span>
          <strong>${escapeHtml(notificationTitle(notification))}</strong>
          <p>${escapeHtml(notification.message || "")}</p>
          <time>${escapeHtml(formatDateTime(notification.createdAt))}</time>
        </article>
      `;
    }).join("")
    : '<div class="notification-empty">Geen meldingen.</div>';
}
function closeNotificationPanel() {
  const panel = $("#notificationPanel");
  const bell = $("#notificationBell");
  if (panel) panel.hidden = true;
  if (bell) bell.setAttribute("aria-expanded", "false");
}

function absenceAgendaEntries() {
  const absences = Array.isArray(state.absences) ? state.absences : [];
  const peopleById = new Map((state.people || []).map((person) => [String(person.id), person]));
  const days = new Map();
  absences
    .filter((absence) => String(absence.status || "").toLowerCase() !== "afgekeurd")
    .forEach((absence) => {
      const person = peopleById.get(String(absence.memberId)) || {};
      const entry = {
        ...absence,
        name: absence.name || person.name || "Onbekend",
        rank: absence.rank || person.rank || "",
        serviceNumber: absence.serviceNumber || person.serviceNumber || "",
        reason: absence.reason || "-"
      };
      datesBetween(absence.from, absence.to).forEach((date) => {
        if (!days.has(date)) days.set(date, []);
        days.get(date).push(entry);
      });
    });
  for (const entries of days.values()) {
    entries.sort((a, b) =>
      String(a.serviceNumber || "").localeCompare(String(b.serviceNumber || ""), "nl", { numeric: true }) ||
      String(a.name || "").localeCompare(String(b.name || ""), "nl", { sensitivity: "base" })
    );
  }
  return days;
}

function renderAvailabilityAgenda() {
  const container = $("#availabilityAgenda");
  const summary = $("#availabilityAgendaSummary");
  if (!container) return;
  const availabilityDays = absenceAgendaEntries();
  const todayDate = dateOnly(today || new Date());
  const weekStart = dateOnly(startOfWeek(new Date(`${todayDate}T00:00:00`)));
  const weeks = Array.from({ length: 6 }, (_, weekIndex) => {
    const start = addDays(weekStart, weekIndex * 7);
    const days = Array.from({ length: 7 }, (_, dayIndex) => addDays(start, dayIndex));
    return { start, days };
  });
  if (summary) summary.textContent = `${weeks.length} weken`;
  container.innerHTML = weeks.map((week) => `
    <section class="agenda-week">
      <div class="agenda-week-number">
        <span>Week</span>
        <strong>${escapeHtml(String(isoWeekNumber(week.start)))}</strong>
      </div>
      <div class="agenda-days">
        ${week.days.map((date) => {
          const dayAbsences = availabilityDays.get(date) || [];
          return `
            <article class="agenda-day ${date === todayDate ? "today" : ""}">
              <header>
                <span>${escapeHtml(new Intl.DateTimeFormat("nl-NL", { weekday: "short" }).format(new Date(`${date}T00:00:00`)))}</span>
                <strong>${escapeHtml(formatDate(date).slice(0, 5))}</strong>
              </header>
              <div class="agenda-day-lines">
                ${dayAbsences.map((absence) => `
                  <span title="${escapeHtml(`${absence.rank || "-"} - ${absence.serviceNumber || "-"} - ${absence.reason || "-"}`)}">${escapeHtml(absence.name || "Onbekend")}</span>
                `).join("") || "<em>Geen afwezigheid</em>"}
              </div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `).join("");
}

function formatHealthTimestamp(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function systemHealthCard(label, value, stateName = "neutral") {
  return `
    <article class="system-health-card ${escapeHtml(stateName)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value ?? "-"))}</strong>
    </article>
  `;
}

function renderSystemHealthPayload(payload) {
  const summary = $("#systemHealthSummary");
  const details = $("#systemHealthDetails");
  if (!summary || !details) return;
  const database = payload?.database || {};
  const counts = database.counts || {};
  const activity = database.activity || {};
  const discordSync = payload?.discordSync || {};
  const ok = Boolean(payload?.ok);
  summary.innerHTML = [
    systemHealthCard("Portaal", ok ? "OK" : "Storing", ok ? "ok" : "bad"),
    systemHealthCard("Database", database.ok === true ? `${database.latencyMs ?? "-"} ms` : "Niet bereikbaar", database.ok === true ? "ok" : "bad"),
    systemHealthCard("Sessies", counts.active_sessions ?? payload?.sessions ?? "-", "neutral"),
    systemHealthCard("Discord queue", discordSync.open ?? "-", Number(discordSync.failed || 0) > 0 ? "warn" : "neutral")
  ].join("");
  details.innerHTML = `
    <div class="system-health-grid">
      ${systemHealthCard("Organisatie", payload?.organization || "-", "neutral")}
      ${systemHealthCard("Opslag", payload?.storageMode || "-", "neutral")}
      ${systemHealthCard("Uptime", formatMinutes(Number(payload?.uptimeSeconds || 0) / 60), "neutral")}
      ${systemHealthCard("Laatste check", formatHealthTimestamp(payload?.timestamp), "neutral")}
      ${systemHealthCard("Actieve leden", counts.active_people ?? "-", "neutral")}
      ${systemHealthCard("Personeel totaal", counts.people ?? "-", "neutral")}
      ${systemHealthCard("Actieve porto units", counts.active_porto_units ?? "-", "neutral")}
      ${systemHealthCard("Voertuiginbeslagname", counts.vehicle_seizures ?? "-", "neutral")}
      ${systemHealthCard("Open Discord jobs", discordSync.open ?? "-", "neutral")}
      ${systemHealthCard("Running Discord jobs", discordSync.running ?? "-", "neutral")}
      ${systemHealthCard("Failed Discord jobs", discordSync.failed ?? "-", Number(discordSync.failed || 0) > 0 ? "warn" : "neutral")}
      ${systemHealthCard("DB lock waiters", activity.lock_waiters ?? "-", Number(activity.lock_waiters || 0) > 0 ? "warn" : "neutral")}
    </div>
    <p class="muted system-health-footnote">Event bridge: ${escapeHtml(payload?.eventBridge?.enabled ? "aan" : "uit")} · Laatste Discord job: ${escapeHtml(formatHealthTimestamp(discordSync.latest_created_at))}</p>
  `;
}

async function loadSystemHealth({ force = false } = {}) {
  if (!canViewSystemHealth() || activePageId() !== "systeemstatus") return;
  const now = Date.now();
  if (!force && systemHealthCache && now - systemHealthLoadedAt < SYSTEM_HEALTH_CACHE_MS) {
    renderSystemHealthPayload(systemHealthCache);
    return;
  }
  if (systemHealthLoadPromise) return systemHealthLoadPromise;
  const summary = $("#systemHealthSummary");
  const details = $("#systemHealthDetails");
  if (summary && !systemHealthCache) summary.innerHTML = systemHealthCard("Status", "Laden...", "neutral");
  if (details && !systemHealthCache) details.innerHTML = "";
  systemHealthLoadPromise = fetch("/api/admin/health", { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && !payload.database) throw new Error(payload.error || "Systeemstatus ophalen is mislukt.");
      systemHealthCache = payload;
      systemHealthLoadedAt = Date.now();
      renderSystemHealthPayload(payload);
    })
    .catch((error) => {
      if (summary) summary.innerHTML = systemHealthCard("Status", "Mislukt", "bad");
      if (details) details.innerHTML = `<p class="form-message error">${escapeHtml(error.message || "Systeemstatus ophalen is mislukt.")}</p>`;
    })
    .finally(() => {
      systemHealthLoadPromise = null;
    });
  return systemHealthLoadPromise;
}

function renderSystemHealth() {
  const panel = $("#systeemstatus");
  if (!panel || !panel.classList.contains("active")) return;
  loadSystemHealth();
}

function toggleNotificationPanel() {
  const panel = $("#notificationPanel");
  const bell = $("#notificationBell");
  if (!panel || !bell) return;
  const nextOpen = panel.hidden;
  panel.hidden = !nextOpen;
  bell.setAttribute("aria-expanded", String(nextOpen));
}

function render() {
  if (!authProfile) {
    setLocked(true);
    return;
  }
  setLocked(false);
  document.documentElement.dataset.theme = "dark";
  renderKaderNavigation();
  renderProfile();
  renderNotifications();
  renderDashboard();
  renderLogbook();
  renderEmployeeDirectory();
  renderMentorOverview();
  renderMentorChecklist();
  renderMentorTrajectory();
  renderMentorTestPage();
  renderMentorTestsOverview();
  renderMentorLeadershipLog();
  renderTrainerOverview();
  renderTrainerIbtReviews();
  renderTrainerLogbook();
  renderRecruitment();
  renderPeople();
  renderArchive();
  renderVehicleSeizures();
  renderSystemHealth();
  renderI8Forms();
  renderOvJLeadershipLog();
  renderOpsTimes();
  renderAbsenceOverview();
  renderAvailabilityAgenda();
  renderResignationOverview();
  DefensiePortalUI.bindAutoGrowingTextareas?.();
}

function wireEvents() {
  bindDialogBackdropClose();
  window.addEventListener("resize", updateDeviceMode);
  window.addEventListener("resize", () => DefensiePortalUI.resizeAutoGrowingTextareas?.());
  window.addEventListener("resize", () => {
    if (activePageId() === "dashboard") renderDashboard();
  });
  window.addEventListener("popstate", () => applyRouteState("replace"));
  window.addEventListener("orp-ui-mode-change", () => {
    if (activePageId() === "dashboard") renderDashboard();
  });
  $$(".nav-item[data-page]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  $("#refreshSystemHealthBtn")?.addEventListener("click", () => loadSystemHealth({ force: true }));
  const rankPie = $("#rankPie");
  rankPie?.addEventListener("mousemove", moveRankPieTooltip);
  rankPie?.addEventListener("mouseleave", hideRankPieTooltip);
  const portoButton = $("[data-open-porto]");
  if (portoButton) {
    portoButton.addEventListener("click", () => window.open(portoAppUrl(), "_blank", "noopener"));
  }
  $("#loginBtn").addEventListener("click", () => {
    window.location.href = authLoginUrl();
  });
  $("#lockLoginBtn").addEventListener("click", () => {
    window.location.href = authLoginUrl();
  });
  $("#authLoginBtn").addEventListener("click", () => {
    window.location.href = authLoginUrl();
  });
  $("#profileOpenBtn").addEventListener("click", () => openProfilePage(""));
  $("#profileOpenText").addEventListener("click", () => openProfilePage(""));
  $("#notificationBell")?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNotificationPanel();
  });
  $("#notificationPanel")?.addEventListener("click", (event) => {
    event.stopPropagation();
    const item = event.target.closest("[data-notification-open]");
    if (item) openNotificationTarget(item.dataset.notificationOpen);
  });
  $("#notificationReadAll")?.addEventListener("click", async () => {
    if (await runAction("/api/notifications/read", {})) render();
  });
  $("#notificationClearAll")?.addEventListener("click", async () => {
    const confirmed = await showSiteConfirm(
      "Weet je zeker dat je al je meldingen wil verwijderen?",
      "Meldingen leegmaken"
    );
    if (confirmed && await runAction("/api/notifications/clear", {})) render();
  });
  $("#notificationPanel")?.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const item = event.target.closest("[data-notification-open]");
    if (!item) return;
    event.preventDefault();
    openNotificationTarget(item.dataset.notificationOpen);
  });
  document.addEventListener("click", closeNotificationPanel);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNotificationPanel();
  });
  $("#employeeDirectory").addEventListener("click", (event) => {
    const openProfileId = event.target.closest("[data-open-profile]")?.dataset.openProfile;
    if (openProfileId) openProfilePage(openProfileId);
  });
  $("#profilePrevBtn")?.addEventListener("click", () => {
    const previousId = adjacentProfileId(-1);
    if (previousId) openProfilePage(previousId);
  });
  $("#profileNextBtn")?.addEventListener("click", () => {
    const nextId = adjacentProfileId(1);
    if (nextId) openProfilePage(nextId);
  });
  $("#addDisciplineBtn").addEventListener("click", openDisciplineDialog);
  $("#closeDisciplineDialog").addEventListener("click", () => $("#disciplineDialog").close());
  $("#cancelDisciplineDialog").addEventListener("click", () => $("#disciplineDialog").close());
  $("#closeEditDisciplineDialog").addEventListener("click", () => $("#editDisciplineDialog").close());
  $("#cancelEditDisciplineDialog").addEventListener("click", () => $("#editDisciplineDialog").close());
  $("#closeDeleteDisciplineDialog").addEventListener("click", () => $("#deleteDisciplineDialog").close());
  $("#cancelDeleteDisciplineDialog").addEventListener("click", () => $("#deleteDisciplineDialog").close());
  $("#closeI8DetailDialog").addEventListener("click", () => closeI8DetailDialog());
  $("#closeI8DetailFooter").addEventListener("click", () => closeI8DetailDialog());
  $("#i8DetailDialog").addEventListener("close", () => restoreI8ArchiveRoute("replace"));
  $("#closeI8ReviewDialog").addEventListener("click", () => $("#i8ReviewDialog").close());
  $("#cancelI8ReviewDialog").addEventListener("click", () => $("#i8ReviewDialog").close());
  $("#closeDeleteAbsenceDialog").addEventListener("click", () => $("#deleteAbsenceDialog").close());
  $("#cancelDeleteAbsenceDialog").addEventListener("click", () => $("#deleteAbsenceDialog").close());
  $("#disciplineForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#disciplinePersonId").value;
    const type = $("#disciplineType").value;
    const reason = $("#disciplineReason").value.trim();
    if (!personId || !reason) return;
    if (await runAction(`/api/people/${encodeURIComponent(personId)}/discipline`, { type, reason })) {
      $("#disciplineDialog").close();
      render();
    }
  });
  $("#editDisciplineForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#editDisciplinePersonId").value;
    const disciplineId = $("#editDisciplineEntryId").value;
    const type = $("#editDisciplineType").value;
    const reason = $("#editDisciplineReason").value.trim();
    if (!personId || !disciplineId || !type || !reason) return;
    if (await runAction(`/api/people/${encodeURIComponent(personId)}/discipline/${encodeURIComponent(disciplineId)}`, { action: "update", type, reason })) {
      $("#editDisciplineDialog").close();
      render();
    }
  });
  $("#deleteDisciplineForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#deleteDisciplinePersonId").value;
    const disciplineId = $("#deleteDisciplineEntryId").value;
    if (!personId || !disciplineId) return;
    if (await runAction(`/api/people/${encodeURIComponent(personId)}/discipline/${encodeURIComponent(disciplineId)}`, { action: "delete" })) {
      $("#deleteDisciplineDialog").close();
      render();
    }
  });
  $("#disciplineTypeFilter").addEventListener("change", () => {
    const viewed = visibleProfile();
    if (viewed) renderProfileDiscipline(viewed);
  });
  $("#disciplineDateSort").addEventListener("change", () => {
    const viewed = visibleProfile();
    if (viewed) renderProfileDiscipline(viewed);
  });
  $("#profileDisciplineLog").addEventListener("contextmenu", (event) => {
    const item = event.target.closest(".discipline-item[data-discipline-id]");
    if (!item || !canManageDiscipline()) return;
    event.preventDefault();
    openDisciplineContextMenu(event, item);
  });
  $("#disciplineContextMenu").addEventListener("click", async (event) => {
    const action = event.target.dataset.disciplineContext;
    if (action === "edit") openEditDisciplineDialog();
    if (action === "delete") openDeleteDisciplineDialog();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#disciplineContextMenu")) hideDisciplineContextMenu();
  });
  window.addEventListener("scroll", hideDisciplineContextMenu, true);
  window.addEventListener("resize", hideDisciplineContextMenu);
  $("#mijn-profiel").addEventListener("contextmenu", (event) => {
    const sideTarget = event.target.closest("[data-profile-side-badges-manage]");
    const mainTarget = event.target.closest("[data-profile-manage]");
    if (!sideTarget && !mainTarget) return;
    if (!canManageProfileBadges()) return;
    event.preventDefault();
    openProfileBadgeDialog(sideTarget ? "side" : "main");
  });
  $("#mijn-profiel").addEventListener("click", (event) => {
    const logMoreTarget = event.target.closest("[data-profile-log-more]");
    if (logMoreTarget) {
      event.preventDefault();
      if (typeof openProfileLogDialog === "function") {
        openProfileLogDialog(logMoreTarget.dataset.profileLogMore || "");
      }
      return;
    }

    const sideTarget = event.target.closest("[data-profile-side-badges-manage]");
    if (!sideTarget || !canManageProfileBadges()) return;
    event.preventDefault();
    openProfileBadgeDialog("side");
  });
  $("#closeProfileBadgeDialog").addEventListener("click", () => $("#profileBadgeDialog").close());
  $("#cancelProfileBadgeDialog").addEventListener("click", () => $("#profileBadgeDialog").close());
  $("#profileBadgeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#profileBadgePersonId").value;
    const viewed = visibleProfile();
    const sideTaskSet = new Set(window.profileSideTaskBadges || []);
    const dialogMode = window.profileBadgeDialogMode || "main";
    const selectedFunctions = $$('#profileBadgeDialog input[data-profile-badge-kind="function"]:checked').map((input) => input.value);
    const extraFunctions = dialogMode === "side" || !canManageProfileFunctions() ? canonicalProfileFunctions(viewed?.extraFunctions || []) : selectedFunctions;
    const selectedBadges = $$('#profileBadgeDialog input[data-profile-badge-kind="task"]:checked').map((input) => input.value);
    const existingBadges = viewed?.badges || [];
    const badges = dialogMode === "side"
      ? [...existingBadges.filter((badge) => !sideTaskSet.has(badge)), ...selectedBadges]
      : [...selectedBadges, ...existingBadges.filter((badge) => sideTaskSet.has(badge))];
    if (await runAction(`/api/people/${encodeURIComponent(personId)}/profile-badges`, { extraFunctions, badges })) {
      $("#profileBadgeDialog").close();
      render();
    }
  });
  $("#mijn-profiel").addEventListener("change", async (event) => {
    if (!event.target.matches("[data-profile-check]")) return;
    const viewed = visibleProfile();
    if (!viewed || (!canManageQualifications() && !canRevokeIbt())) {
      renderProfile();
      return;
    }
    const completedTrainings = $$("[data-profile-check='training']:checked").map((input) => input.value);
    const completedOperational = $$("[data-profile-check='operational']:checked").map((input) => input.value);
    const previousTrainings = new Set(Array.isArray(viewed.completedTrainings) ? viewed.completedTrainings : []);
    const addedTrainings = completedTrainings.filter((item) => !previousTrainings.has(item));
    let coTrainers = [];
    if (event.target.dataset.profileCheck === "training" && event.target.checked && addedTrainings.length && canManageQualifications()) {
      const result = await openTrainingCreditDialog({ trainingNames: addedTrainings, targetPerson: viewed });
      if (result === null) {
        renderProfile();
        return;
      }
      coTrainers = result;
    }
    const payload = { completedTrainings, completedOperational };
    if (coTrainers.length) payload.coTrainers = coTrainers;
    if (await runAction(`/api/people/${encodeURIComponent(viewed.id)}/qualifications`, payload)) {
      render();
    } else {
      renderProfile();
    }
  });
  $("#trainingCoTrainerFields")?.addEventListener("input", syncTrainingCoTrainerRows);
  $("#trainingCreditForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    resolveTrainingCreditDialog(collectTrainingCoTrainers());
    $("#trainingCreditDialog")?.close("confirm");
  });
  $("#closeTrainingCreditDialog")?.addEventListener("click", () => $("#trainingCreditDialog")?.close("cancel"));
  $("#cancelTrainingCreditDialog")?.addEventListener("click", () => $("#trainingCreditDialog")?.close("cancel"));
  $("#logoutBtn").addEventListener("click", async () => {
    stopLiveUpdates();
    await fetch("/api/auth/logout", { method: "POST" });
    authProfile = null;
    resetPermissions();
    resetSavedPage();
    setLocked(true);
    render();
  });
  $("#searchInput").addEventListener("input", renderPeople);
  $("#employeeSearchInput").addEventListener("input", renderEmployeeDirectory);
  $("#archiveSearchInput").addEventListener("input", renderArchive);
  $("#blacklistSearchInput")?.addEventListener("input", renderBlacklist);
  $("#vehicleSeizureSearchInput")?.addEventListener("input", renderVehicleSeizures);
  $("#vehicleSeizureStatusFilter")?.addEventListener("change", renderVehicleSeizures);
  $("#vehicleSeizureList")?.addEventListener("click", async (event) => {
    const releaseButton = event.target.closest("[data-vehicle-seizure-release]");
    if (!releaseButton || !canManageVehicleSeizures()) return;
    const seizureId = releaseButton.dataset.vehicleSeizureRelease;
    const seizure = (state.vehicleSeizures || []).find((entry) => entry.id === seizureId);
    if (!seizure) return;
    const releaseReason = await showSiteTextInput({
      title: "Voertuig vrijgeven",
      message: `${seizure.plate || "-"} - ${seizure.vehicle || "-"}`,
      label: "Reden vrijgave",
      placeholder: "Waarom mag het voertuig vrijgegeven worden?",
      required: true
    });
    if (!releaseReason) return;
    releaseButton.disabled = true;
    try {
      if (await runAction(`/api/vehicle-seizures/${encodeURIComponent(seizureId)}/status`, { status: "Vrijgegeven", releaseReason })) {
        renderVehicleSeizures();
      }
    } finally {
      releaseButton.disabled = false;
    }
  });
  $("#resignationOverview")?.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-resignation-process], [data-resignation-cancel], [data-resignation-delete]");
    if (actionButton?.disabled) return;
    const processId = actionButton?.dataset.resignationProcess;
    const cancelId = actionButton?.dataset.resignationCancel;
    const deleteId = actionButton?.dataset.resignationDelete;
    const formId = processId || cancelId || deleteId;
    if (!formId || !hasKaderAccess()) return;
    const form = (state.resignationForms || []).find((entry) => entry.id === formId);
    const name = form?.name || memberName(form?.memberId);
    const action = processId ? "verwerken" : cancelId ? "annuleren" : "verwijderen";
    const title = processId ? "Ontslag verwerken" : cancelId ? "Ontslag annuleren" : "Ontslag verwijderen";
    const confirmed = await showSiteConfirm(
      `Weet je zeker dat je het ontslagformulier van ${name} wil ${action}?`,
      title
    );
    if (!confirmed) return;
    const endpoint = processId
      ? `/api/resignation-forms/${encodeURIComponent(formId)}/process`
      : cancelId
        ? `/api/resignation-forms/${encodeURIComponent(formId)}/cancel`
        : `/api/resignation-forms/${encodeURIComponent(formId)}/delete`;
    actionButton.disabled = true;
    try {
      if (await runAction(endpoint, {})) render();
    } finally {
      actionButton.disabled = false;
    }
  });
  $("#i8ArchiveSearchInput").addEventListener("input", renderI8Forms);
  $$('[data-i8-archive-status]').forEach((button) => button.addEventListener("click", () => setI8ArchiveStatusFilter(button.dataset.i8ArchiveStatus)));
  $$('[data-i8-tab]').forEach((button) => {
    button.addEventListener("click", () => {
      setI8Tab(button.dataset.i8Tab);
      if (button.dataset.i8Tab === "create") restoreI8Draft({ force: false });
    });
  });
  $("#i8DetailBody").addEventListener("click", (event) => {
    const status = event.target.dataset.i8DetailStatus;
    const formId = event.target.closest("[data-i8-detail-form]")?.dataset.i8DetailForm;
    if (!formId || !status || !canReviewI8Forms()) return;
    $("#i8DetailDialog").close();
    openI8ReviewDialog(formId, status);
  });
  $("#i8OwnList").addEventListener("click", openI8DetailFromEvent);
  $("#i8OwnList").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openI8DetailFromEvent(event);
  });
  $("#i8Form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    if (!(await validateI8FormFields())) return;
    form.dataset.submitting = "true";
    setSubmitBusy(form, true, "I8 formulier opslaan...");
    try {
      const saved = await runAction("/api/i8-forms", {
        violenceDate: $("#i8Date").value,
        violenceTime: $("#i8Time").value,
        location: $("#i8Location").value.trim(),
        opcoOvdName: $("#i8OpcoOvd").value.trim(),
        description: $("#i8Description").value.trim(),
        forceUsed: $("#i8ForceUsed").value.trim(),
        vehicleViolence: $("#i8Vehicle").value.trim(),
        thirdPartyInjury: $("#i8Injury").value.trim(),
        truthConfirmed: $("#i8Truth").checked
      });
      if (!saved) return;
      clearI8Draft();
      resetI8Form();
      setI8Tab("list");
      render();
    } finally {
      form.dataset.submitting = "false";
      setSubmitBusy(form, false);
    }
  });
  $("#i8ReviewList").addEventListener("click", openI8DetailFromEvent);
  $("#i8ArchiveList").addEventListener("click", openI8DetailFromEvent);
  $("#i8ArchiveList").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-i8-open]");
    if (!row || !hasKaderAccess()) return;
    event.preventDefault();
    openI8ArchiveContextMenu(event, row.dataset.i8Open);
  });
  $("#i8ArchiveContextMenu")?.addEventListener("click", async (event) => {
    if (event.target.dataset.i8ArchiveContext !== "delete") return;
    const formId = pendingI8ArchiveDeleteId;
    hideI8ArchiveContextMenu();
    if (!formId || !hasKaderAccess()) return;
    const form = (state.i8Forms || []).find((entry) => entry.id === formId);
    const number = form ? i8NumberFor(form, state.i8Forms || []) : "-";
    const name = form?.personName || memberName(form?.personId);
    const confirmed = await showSiteConfirm(`Weet je zeker dat je I8 ${number} van ${name} uit het archief wil verwijderen?`, "I8 verwijderen");
    if (!confirmed) return;
    if (await runAction(`/api/i8-forms/${encodeURIComponent(formId)}/delete`)) render();
  });
  $("#i8ArchiveList").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openI8DetailFromEvent(event);
  });
  $("#i8ReviewList").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    openI8DetailFromEvent(event);
  });
  $("#i8ReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formId = $("#i8ReviewFormId").value || pendingI8ReviewAction?.formId;
    const status = $("#i8ReviewStatus").value || pendingI8ReviewAction?.status;
    if (!formId || !status) return;
    const rejectionReason = $("#i8RejectReason")?.value.trim() || "";
    if (status === "rejected" && !rejectionReason) {
      await showSiteNotice("Vul een reden in waarom dit I8 formulier wordt afgekeurd.", "Reden verplicht");
      $("#i8RejectReason")?.focus();
      return;
    }
    if (await runAction(`/api/i8-forms/${encodeURIComponent(formId)}/status`, { status, rejectionReason })) {
      pendingI8ReviewAction = null;
      $("#i8ReviewDialog").close();
      render();
    }
  });
  $("#absenceOverview").addEventListener("click", async (event) => {
    const approveId = event.target.dataset.absenceApprove;
    const rejectId = event.target.dataset.absenceReject;
    const absenceId = approveId || rejectId;
    if (!absenceId || !canReviewAbsences()) return;
    const status = approveId ? "Goedgekeurd" : "Afgekeurd";
    if (await runAction(`/api/absences/${encodeURIComponent(absenceId)}/status`, { status })) render();
  });
  $("#opsTimesOverview")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-ops-times-person]");
    if (!row) return;
    openOpsTimesDialog(row.dataset.opsTimesPerson || "");
  });
  $("#opsTimesOverview")?.addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-ops-times-person]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openOpsTimesDialog(event.target.dataset.opsTimesPerson || "");
  });
  $("#absenceOverview").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-absence-id]");
    if (!row) return;
    openAbsenceContextMenu(event, row.dataset.absenceId);
  });
  $("#absenceContextMenu").addEventListener("click", (event) => {
    if (event.target.dataset.absenceContext === "delete") openDeleteAbsenceDialog();
  });
  const hideMentorTestContextMenuIfReady = () => {
    if (typeof hideMentorTestContextMenu === "function") hideMentorTestContextMenu();
  };
  $("#mentorTestContextMenu")?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-mentor-test-context]")?.dataset.mentorTestContext;
    if (!action) return;
    if (typeof handleMentorTestContextAction === "function") handleMentorTestContextAction(action);
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#absenceContextMenu")) hideAbsenceContextMenu();
    if (!event.target.closest("#i8ArchiveContextMenu")) hideI8ArchiveContextMenu();
    if (!event.target.closest("#mentorTestContextMenu")) hideMentorTestContextMenuIfReady();
  });
  window.addEventListener("scroll", hideAbsenceContextMenu, true);
  window.addEventListener("scroll", hideI8ArchiveContextMenu, true);
  window.addEventListener("scroll", hideMentorTestContextMenuIfReady, true);
  window.addEventListener("resize", hideMentorTestContextMenuIfReady);
  $("#deleteAbsenceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const absenceId = $("#deleteAbsenceId").value || pendingAbsenceId;
    if (!absenceId || !hasKaderAccess()) return;
    if (await runAction(`/api/absences/${encodeURIComponent(absenceId)}`, { action: "delete" })) {
      pendingAbsenceId = "";
      $("#deleteAbsenceDialog").close();
      render();
    }
  });
  $("#mentorSearchInput").addEventListener("input", renderMentorOverview);
  $("#mentorOverviewList").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-mentor-test-open='true']");
    if (!row) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof openMentorTestContextMenu === "function") openMentorTestContextMenu(event, row.dataset.openMentor);
  });
  $("#mentorOverviewList").addEventListener("click", (event) => {
    const sendButton = event.target.closest("[data-send-mentor-test]");
    if (sendButton) {
      event.preventDefault();
      event.stopPropagation();
      sendMentorTest(sendButton.dataset.sendMentorTest);
      return;
    }
    if (event.target.closest(".mentor-test-overview")) return;
    const row = event.target.closest("[data-open-mentor]");
    if (!row) return;
    selectMentorAuditPerson(row.dataset.openMentor);
    openMentorChecklist(row.dataset.openMentor);
  });
  $("#mentorOverviewList").addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-open-mentor]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectMentorAuditPerson(event.target.dataset.openMentor);
    openMentorChecklist(event.target.dataset.openMentor);
  });
  $("#mentorTestSelf")?.addEventListener("submit", (event) => {
    if (!event.target.matches("[data-mentor-test-self-form]")) return;
    event.preventDefault();
    submitOwnMentorTest();
  });
  $("#mentorTestsList")?.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-open-mentor-test-detail]");
    if (detailButton) {
      openMentorTestDetailDialog(detailButton.dataset.openMentorTestDetail);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-mentor-test]");
    if (deleteButton) {
      deleteMentorTest(deleteButton.dataset.deleteMentorTest);
      return;
    }
    const reviewButton = event.target.closest("[data-review-mentor-test]");
    if (!reviewButton) return;
    reviewMentorTest(reviewButton.dataset.reviewMentorTest, reviewButton.dataset.reviewStatus);
  });
  $("#mentorTestDetailBody")?.addEventListener("click", async (event) => {
    const deleteButton = event.target.closest("[data-delete-mentor-test]");
    if (deleteButton) {
      if (await deleteMentorTest(deleteButton.dataset.deleteMentorTest)) $("#mentorTestDetailDialog")?.close();
      return;
    }
    const reviewButton = event.target.closest("[data-review-mentor-test]");
    if (!reviewButton) return;
    if (await reviewMentorTest(reviewButton.dataset.reviewMentorTest, reviewButton.dataset.reviewStatus)) $("#mentorTestDetailDialog")?.close();
  });
  $("#mentorBackBtn").addEventListener("click", () => setPage("mentor-overzicht"));
  $("#mentorChecklistItems").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-mentor-item]");
    if (!input) return;
    mentorChecklistEditingUntil = Date.now() + 2500;
    const row = input.closest(".mentor-check-row");
    row?.classList.toggle("is-completed", input.checked);
    const saved = await saveMentorChecklistItemsFromDom();
    mentorChecklistEditingUntil = Date.now() + 500;
    if (!saved) renderMentorChecklist();
  });
  async function saveCurrentMentorChecklist(includeNote = false) {
    if (!selectedMentorProfileId) return;
    const person = state.people.find((entry) => entry.id === selectedMentorProfileId);
    if (!person) return;
    const items = mentorChecklistItemsFromDom();
    const payload = { items };
    if (includeNote) payload.newNote = $("#mentorNotes").value.trim();
    const saved = await saveMentorChecklist(selectedMentorProfileId, payload);
    if (saved) render();
  }
  $("#saveMentorChecklistBtn").hidden = true;
  $("#saveMentorChecklistBtn").addEventListener("click", () => saveCurrentMentorChecklist(false));
  const mentorNotesField = $("#mentorNotes");
  mentorNotesField?.addEventListener("focus", () => {
    mentorChecklistEditingUntil = Date.now() + 3000;
  });
  mentorNotesField?.addEventListener("input", () => {
    mentorChecklistEditingUntil = Date.now() + 3000;
  });
  mentorNotesField?.addEventListener("blur", () => {
    mentorChecklistEditingUntil = Date.now() + 500;
    scheduleLiveRefresh("mentor-checklist");
  });
  $("#saveMentorNotesBtn").addEventListener("click", () => saveCurrentMentorChecklist(true));
  $("#editMentorTemplateBtn")?.addEventListener("click", openMentorTemplateDialog);
  $("#closeMentorTemplateDialog")?.addEventListener("click", () => $("#mentorTemplateDialog")?.close());
  $("#cancelMentorTemplateDialog")?.addEventListener("click", () => $("#mentorTemplateDialog")?.close());
  $("#addMentorTemplateItemBtn")?.addEventListener("click", () => {
    const groups = mentorTemplateDraftGroupsFromEditor();
    const target = groups.length ? groups : activeMentorChecklistGroups();
    const lastGroup = target[target.length - 1] || { id: "praktijk", title: "Praktijk", items: [] };
    lastGroup.items.push({ id: `regel-${Date.now()}`, label: "" });
    renderMentorTemplateEditor(target);
  });
  $("#mentorTemplateEditor")?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-template-item]");
    const addButton = event.target.closest("[data-add-template-item]");
    if (removeButton) {
      const row = removeButton.closest("[data-template-item]");
      row?.remove();
      return;
    }
    if (addButton) {
      const group = addButton.closest("[data-template-group]");
      const rows = group?.querySelector(".mentor-template-items");
      if (!group || !rows) return;
      rows.insertAdjacentHTML("beforeend", `
        <div class="mentor-template-item-row" data-template-item data-template-item-id="regel-${Date.now()}">
          <input type="text" data-template-item-label value="" />
          <button class="ghost" type="button" data-remove-template-item>Verwijderen</button>
        </div>
      `);
    }
  });
  $("#mentorTemplateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canManageMentorChecklistTemplate()) return;
    const groups = mentorTemplateDraftGroupsFromEditor();
    if (!groups.length) {
      await showSiteNotice("Laat minimaal een checklistregel staan.", "Checklist leeg");
      return;
    }
    if (await runAction("/api/mentor-checklist-template", { groups })) {
      $("#mentorTemplateDialog")?.close();
      render();
    }
  });
  $("#editMentorTestTemplateBtn")?.addEventListener("click", openMentorTestTemplateDialog);
  $("#closeMentorTestTemplateDialog")?.addEventListener("click", () => $("#mentorTestTemplateDialog")?.close());
  $("#cancelMentorTestTemplateDialog")?.addEventListener("click", () => $("#mentorTestTemplateDialog")?.close());
  $("#closeMentorTestDetailDialog")?.addEventListener("click", () => $("#mentorTestDetailDialog")?.close());
  $("#mentorTestTemplateEditor")?.addEventListener("click", handleMentorTestTemplateEditorClick);
  $("#mentorTestTemplateEditor")?.addEventListener("change", handleMentorTestTemplateEditorChange);
  $("#mentorTestTemplateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveMentorTestTemplate();
  });
  $("#mentorLeadershipLogList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-mentor-log-person]");
    if (row) openMentorLogDetail(row.dataset.mentorLogPerson);
  });
  if (typeof bindTrainerEvents === "function") bindTrainerEvents();
  $("#ovjLeadershipLogList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-ovj-log-person]");
    if (row) openOvJLogDetail(row.dataset.ovjLogPerson);
  });
  $("#leadershipLogPeriod")?.addEventListener("change", () => {
    renderMentorLogDetailRows();
    renderOvJLogDetailRows();
  });
  $("#leadershipLogRows")?.addEventListener("click", openI8DetailFromEvent);
  $("#closeLeadershipLogDialog")?.addEventListener("click", () => $("#leadershipLogDialog").close());
  $("#closeLeadershipLogFooter")?.addEventListener("click", () => $("#leadershipLogDialog").close());
  $("#closeProfileLogDialog")?.addEventListener("click", () => $("#profileLogDialog")?.close());
  $("#closeProfileLogDialogFooter")?.addEventListener("click", () => $("#profileLogDialog")?.close());
  $("#bulkHoursBtn")?.addEventListener("click", openBulkHoursDialog);
  $("#closeHoursOverviewDialog")?.addEventListener("click", () => $("#hoursOverviewDialog").close());
  $("#closeHoursOverviewFooter")?.addEventListener("click", () => $("#hoursOverviewDialog").close());
  $(".profile-hours-panel")?.addEventListener("contextmenu", (event) => {
    const viewed = visibleProfile();
    if (!viewed || !canViewHours(viewed)) return;
    event.preventDefault();
    const kind = event.target.closest("[data-profile-hours-kind='ops']") ? "ops" : "manual";
    openHoursOverviewDialog(viewed, kind);
  });
  $("#closeBulkHoursDialog")?.addEventListener("click", () => $("#bulkHoursDialog").close());
  $("#closeOpsTimesDialog")?.addEventListener("click", () => $("#opsTimesDialog").close());
  $("#closeOpsTimesFooter")?.addEventListener("click", () => $("#opsTimesDialog").close());
  $("#cancelBulkHoursDialog")?.addEventListener("click", () => $("#bulkHoursDialog").close());
  $("#profileHoursEntry")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#profileHoursPersonId").value;
    const weekYear = Number($("#profileHoursWeekYear").value);
    const weekNumber = Number($("#profileHoursWeekNumber").value);
    const hours = parseHourInputValue($("#profileHoursInput").value);
    if (!personId || !canManageHours()) return;
    if (!Number.isFinite(hours) || hours < 0 || hours > 99) {
      await showSiteNotice("Vul een geldig aantal uren in tussen 0 en 99. Komma's en punten mogen allebei.", "Ongeldige uren");
      return;
    }
    if (await saveManualHours([{ personId, hours }], weekYear, weekNumber)) render();
  });
  $("#bulkHoursWeekOptions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bulk-hours-week-year][data-bulk-hours-week-number]");
    if (!button || typeof selectBulkHoursWeek !== "function") return;
    selectBulkHoursWeek({
      weekYear: Number(button.dataset.bulkHoursWeekYear),
      weekNumber: Number(button.dataset.bulkHoursWeekNumber)
    });
  });
  $("#bulkHoursForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canManageHours()) return;
    const weekYear = Number($("#bulkHoursWeekYear").value);
    const weekNumber = Number($("#bulkHoursWeekNumber").value);
    const entries = $$("[data-bulk-hours-person]")
      .map((input) => ({ input, hours: parseHourInputValue(input.value) }))
      .filter((entry) => entry.hours !== null)
      .map((entry) => ({ personId: entry.input.dataset.bulkHoursPerson, hours: entry.hours }));
    if (!entries.length) {
      await showSiteNotice("Vul minimaal een urenregel in.", "Geen uren ingevuld");
      return;
    }
    if (entries.some((entry) => !Number.isFinite(entry.hours) || entry.hours < 0 || entry.hours > 99)) {
      await showSiteNotice("Controleer de uren. Gebruik alleen waarden tussen 0 en 99; komma's en punten mogen allebei.", "Ongeldige uren");
      return;
    }
    if (await saveManualHours(entries, weekYear, weekNumber)) {
      $("#bulkHoursDialog").close();
      render();
      await showSiteNotice(`Uren opgeslagen voor week ${weekNumber}`, "Uren opgeslagen");
    }
  });
  $("#addMemberBtn").addEventListener("click", () => openMemberDialog());
  $("#closeDialog").addEventListener("click", () => $("#memberDialog").close());
  $("#dismissDialog").addEventListener("click", () => $("#memberDialog").close());
  $("#closeDismissalDialog").addEventListener("click", () => $("#dismissalDialog").close());
  $("#cancelDismissal").addEventListener("click", () => $("#dismissalDialog").close());
  $("#closeRestoreDialog").addEventListener("click", () => $("#restoreDialog").close());
  $("#cancelRestoreDialog").addEventListener("click", () => $("#restoreDialog").close());
  $("#restoreForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#restorePersonId").value || pendingRestoreId;
    const rank = $("#restoreRank").value;
    if (!personId || !rank) return;
    if (await runAction(`/api/people/${encodeURIComponent(personId)}/restore`, { rank })) {
      pendingRestoreId = "";
      $("#restoreDialog").close();
      render();
    }
  });
  $("#memberRank").addEventListener("change", () => {
    fillServiceSelect("", { autoSelectFirst: organizationKey === "politie" });
  });

  $("#peopleList").addEventListener("click", async (event) => {
    const menuButton = event.target.closest(".card-menu");
    if (menuButton) {
      const menu = menuButton.closest(".card-menu-wrap")?.querySelector(".card-menu-panel");
      if (!menu) return;
      event.stopPropagation();
      const shouldOpen = !menu.classList.contains("is-context-open");
      $$(".card-menu-panel.is-context-open").forEach((panel) => {
        panel.classList.remove("is-context-open");
        panel.closest(".card-menu-wrap")?.querySelector(".card-menu")?.setAttribute("aria-expanded", "false");
      });
      menu.classList.toggle("is-context-open", shouldOpen);
      menuButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      return;
    }
    const openPersonProfileId = event.target.dataset.openPersonProfile;
    const editId = event.target.dataset.edit;
    const clearHistoryId = event.target.dataset.clearHistory;
    const ioMarkId = event.target.dataset.ioMark;
    const ioClearId = event.target.dataset.ioClear;
    const promoteId = event.target.dataset.promote;
    const demoteId = event.target.dataset.demote;
    const dismissId = event.target.dataset.dismiss;
    if (openPersonProfileId) openProfilePage(openPersonProfileId);
    if (editId) openMemberDialog(state.people.find((person) => person.id === editId));
    if (clearHistoryId) {
      const person = state.people.find((entry) => entry.id === clearHistoryId);
      if (!person || !(await showSiteConfirm(`Rang geschiedenis wissen voor ${person.name}?`, "Rang geschiedenis wissen"))) return;
      if (await runAction(`/api/people/${encodeURIComponent(clearHistoryId)}/clear-history`)) render();
    }
    if (ioMarkId) {
      const person = state.people.find((entry) => entry.id === ioMarkId);
      if (!person) return;
      const reason = await showSiteTextInput({
        title: "I.O melden",
        message: `${person.name} op I.O zetten.`,
        label: "Reden",
        placeholder: "Bijvoorbeeld: Inactiviteit",
        required: true
      });
      if (reason === null) return;
      if (!reason) {
        await showSiteNotice("Vul een reden in voor de I.O melding.", "Reden verplicht");
        return;
      }
      if (await runAction(`/api/people/${encodeURIComponent(ioMarkId)}/io`, { active: true, reason })) render();
    }
    if (ioClearId) {
      const person = state.people.find((entry) => entry.id === ioClearId);
      if (!person || !(await showSiteConfirm(`I.O status intrekken voor ${person.name}?`, "I.O intrekken"))) return;
      if (await runAction(`/api/people/${encodeURIComponent(ioClearId)}/io`, { active: false })) render();
    }
    if (promoteId) {
      const person = state.people.find((entry) => entry.id === promoteId);
      if (!person) return;
      const body = {};
      const nextRank = typeof targetRankForAction === "function" ? targetRankForAction(person, "promote") : "";
      if (nextRank && typeof rankTrainingStatusFor === "function") {
        const trainingStatus = rankTrainingStatusFor(person);
        if (!trainingStatus.ok) {
          const confirmed = await showSiteConfirm(
            `Medewerker mist: ${trainingStatus.missingLabels.join(", ")}. Wil je toch promoveren?`,
            "Weet je het zeker, medewerker mist promotievereisten"
          );
          if (!confirmed) return;
        }
      }
      if (typeof requiresManualRankChangeServiceNumber === "function" && requiresManualRankChangeServiceNumber(person, "promote")) {
        const choices = serviceNumberChoicesForRankAction(person, "promote");
        if (!choices.length) {
          await showSiteNotice("Geen vrij dienstnummer beschikbaar voor deze rang.", "Geen dienstnummer vrij");
          return;
        }
        const choice = await showSiteChoice(`${serviceNumberDisplayLabel} kiezen voor ${targetRankForAction(person, "promote")}`, choices);
        if (!choice) return;
        body.serviceNumber = choice.value;
      }
      if (await runAction(`/api/people/${encodeURIComponent(promoteId)}/promote`, body)) render();
    }
    if (demoteId) {
      const person = state.people.find((entry) => entry.id === demoteId);
      if (!person) return;
      const body = {};
      if (typeof requiresManualRankChangeServiceNumber === "function" && requiresManualRankChangeServiceNumber(person, "demote")) {
        const choices = serviceNumberChoicesForRankAction(person, "demote");
        if (!choices.length) {
          await showSiteNotice("Geen vrij dienstnummer beschikbaar voor deze rang.", "Geen dienstnummer vrij");
          return;
        }
        const choice = await showSiteChoice(`${serviceNumberDisplayLabel} kiezen voor ${targetRankForAction(person, "demote")}`, choices);
        if (!choice) return;
        body.serviceNumber = choice.value;
      }
      if (await runAction(`/api/people/${encodeURIComponent(demoteId)}/demote`, body)) render();
    }
    if (dismissId) {
      const person = state.people.find((entry) => entry.id === dismissId);
      if (person) openDismissalDialog(person);
    }
  });
  $("#peopleList").addEventListener("contextmenu", (event) => {
    const card = event.target.closest("[data-person-card]");
    if (!card) return;
    const menu = card.querySelector(".card-menu-panel");
    if (!menu) return;
    event.preventDefault();
    $$(".card-menu-panel.is-context-open").forEach((panel) => {
      if (panel !== menu) {
        panel.classList.remove("is-context-open");
        panel.closest(".card-menu-wrap")?.querySelector(".card-menu")?.setAttribute("aria-expanded", "false");
      }
    });
    menu.classList.add("is-context-open");
    card.querySelector(".card-menu")?.setAttribute("aria-expanded", "true");
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".card-menu-wrap")) return;
    $$(".card-menu-panel.is-context-open").forEach((panel) => {
      panel.classList.remove("is-context-open");
      panel.closest(".card-menu-wrap")?.querySelector(".card-menu")?.setAttribute("aria-expanded", "false");
    });
  });

  $("#dismissalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.busy === "true") return;
    const person = state.people.find((entry) => entry.id === pendingDismissalId);
    const reason = $("#dismissalReason").value.trim();
    if (!person || !reason) return;
    form.dataset.busy = "true";
    setSubmitBusy(form, true, "Ontslaan...");
    try {
      const dismissed = await runAction(`/api/people/${encodeURIComponent(person.id)}/dismiss`, { reason });
      if (!dismissed) return;
      pendingDismissalId = "";
      $("#dismissalDialog").close();
      render();
    } finally {
      delete form.dataset.busy;
      setSubmitBusy(form, false);
    }
  });

  $("#archiveList").addEventListener("click", async (event) => {
    const restoreId = event.target.closest("[data-restore]")?.dataset.restore;
    const deleteArchiveId = event.target.closest("[data-delete-archive]")?.dataset.deleteArchive;
    const blacklistId = event.target.closest("[data-blacklist-person]")?.dataset.blacklistPerson;
    if (!hasKaderAccess()) return;
    if (blacklistId) {
      const person = state.people.find((entry) => entry.id === blacklistId);
      if (!person) return;
      const confirmed = await showSiteConfirm(
        `Weet je zeker dat je ${person.name} op de blacklist wil zetten?`,
        "Blacklist toevoegen"
      );
      if (!confirmed) return;
      if (await runAction(`/api/blacklist/people/${encodeURIComponent(blacklistId)}`, { reason: person.dismissalReason || "" })) render();
      return;
    }
    if (restoreId) {
      const person = state.people.find((entry) => entry.id === restoreId);
      if (person) openRestoreDialog(person);
    }
    if (deleteArchiveId) {
      const person = state.people.find((entry) => entry.id === deleteArchiveId);
      if (!person) return;
      const confirmed = await showSiteConfirm(
        `Weet je zeker dat je ${person.name} wil verwijderen uit het archief?`,
        "Personeels-Archief verwijderen"
      );
      if (!confirmed) return;
      if (await runAction(`/api/people/${encodeURIComponent(deleteArchiveId)}/delete-archive`)) render();
    }
  });
  $("#blacklistList")?.addEventListener("click", async (event) => {
    const revokeId = event.target.closest("[data-revoke-blacklist]")?.dataset.revokeBlacklist;
    if (!revokeId || !hasKaderAccess()) return;
    const entry = (state.blacklist || []).find((item) => item.id === revokeId);
    if (!entry) return;
    const confirmed = await showSiteConfirm(
      `Weet je zeker dat je de blacklist van ${entry.name} wil intrekken?`,
      "Blacklist intrekken"
    );
    if (!confirmed) return;
    if (await runAction(`/api/blacklist/${encodeURIComponent(revokeId)}/revoke`, { reason: "Blacklist ingetrokken door Kader." })) render();
  });

  $("#memberForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("#memberId").value || crypto.randomUUID();
    const person = {
      id,
      name: $("#memberName").value.trim(),
      discordId: $("#memberDiscord").value.trim(),
      avatar: $("#memberAvatar").value.trim(),
      rank: $("#memberRank").value,
      serviceNumber: $("#memberService").value,
      hiredDate: $("#memberHiredDate").value,
      promotionDate: $("#memberPromotionDate").value,
      tasks: $("#memberTasks").value.trim()
    };
    person.rankDate = person.promotionDate || person.hiredDate;

    const existing = state.people.find((entry) => entry.id === id);
    const path = existing ? `/api/people/${encodeURIComponent(id)}` : "/api/people";
    if (!(await runAction(path, { person }))) return;
    $("#memberDialog").close();
    render();
  });

  // W&S maakt een basisprofiel aan. Organisaties met handmatige reeksen sturen het gekozen dienstnummer mee.
  $("#recruitmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#recruitmentMessage");
    if (message) {
      message.hidden = true;
      message.textContent = "";
    }
    if (!canRecruitPeople()) {
      if (message) {
        message.textContent = "Alleen bekijken: deze rol kan geen personeel aannemen.";
        message.hidden = false;
      }
      return;
    }
    const recruitPayload = {
      name: $("#recruitmentName").value.trim(),
      hiredDate: $("#recruitmentHiredDate").value,
      discordId: $("#recruitmentDiscordId").value.trim()
    };
    if (typeof usesManualRecruitServiceNumber === "function" && usesManualRecruitServiceNumber()) {
      recruitPayload.serviceNumber = $("#recruitmentServiceNumber")?.value || "";
    }
    const saved = await runAction("/api/recruitment/hire", recruitPayload);
    if (!saved) return;
    event.target.reset();
    $("#recruitmentHiredDate").value = today;
    if (typeof fillRecruitmentServiceSelect === "function") fillRecruitmentServiceSelect();
    render();
    if (message) {
      message.textContent = "Medewerker aangenomen en toegevoegd aan Personeel en Medewerkers.";
      message.hidden = false;
    }
  });

  $("#absenceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const from = $("#absenceFrom").value;
    const to = $("#absenceTo").value;
    const reason = $("#absenceReason").value.trim();
    const saved = await runAction("/api/absences", { from, to, reason });
    if (!saved) return;

    // Na indienen brengen we het lid terug naar het dashboard met een duidelijke bevestiging.
    const dateText = from === to ? formatDate(from) : `${formatDate(from)} t/m ${formatDate(to)}`;
    event.target.reset();
    $("#absenceFrom").value = today;
    $("#absenceTo").value = today;
    render();
    setPage("dashboard");
    await showSiteNotice(`Je afwezigheid is geregistreerd voor ${dateText} met reden: ${reason || "-"}.`, "Afwezigheid geregistreerd");
  });
  $("#vehicleSeizureForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === "true") return;
    const payload = {
      vehicle: $("#vehicleSeizureVehicle").value.trim(),
      plate: $("#vehicleSeizurePlate").value.trim(),
      ownerName: $("#vehicleSeizureOwner").value.trim(),
      location: $("#vehicleSeizureLocation").value.trim(),
      reason: $("#vehicleSeizureReason").value.trim(),
      notes: $("#vehicleSeizureNotes").value.trim()
    };
    if (!payload.vehicle || !payload.plate || !payload.ownerName || !payload.location || !payload.reason) return;
    form.dataset.submitting = "true";
    setSubmitBusy(form, true, "Inbeslagname opslaan...");
    try {
      const saved = await runAction("/api/vehicle-seizures", payload);
      if (!saved) return;
      form.reset();
      renderVehicleSeizures();
      const message = $("#vehicleSeizureMessage");
      if (message) {
        message.textContent = "Voertuiginbeslagname opgeslagen.";
        message.hidden = false;
      }
    } finally {
      form.dataset.submitting = "false";
      setSubmitBusy(form, false);
    }
  });
  $("#resignationForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = $("#resignationReason").value.trim();
    const saved = await runAction("/api/resignation-forms", { reason });
    if (!saved) return;
    event.target.reset();
    renderResignationForm();
    const message = $("#resignationFormMessage");
    if (message) {
      message.textContent = "Ontslagformulier ingediend.";
      message.hidden = false;
    }
  });
}

async function init() {
  applyOrganizationBranding();
  enhanceSidebarIcons();
  window.DefensiePortalUI?.ensureUiModeToggle?.(".topbar-actions");
  registerPersoneelsportaalTab();
  updateDeviceMode();
  window.setInterval(setLoginBackgroundByTime, 5 * 60 * 1000);
  showLockError();
  captureOpenProfileRequest();
  fillRankSelect();
  fillRestoreRankSelect();
  ["#absenceFrom", "#absenceTo", "#recruitmentHiredDate"].forEach((selector) => {
    const element = $(selector);
    if (element) element.value = today;
  });
  wireEvents();
  const isAuthenticated = await loadAuth();
  if (!isAuthenticated) {
    markPortalReady();
    return;
  }
  const hasState = await loadState();
  if (!hasState) {
    authProfile = null;
    resetPermissions();
    setLocked(true);
    markPortalReady();
    return;
  }
  render();
  restoreSavedPage();
  startReviewCounterPolling();
  startLiveUpdates();
  markPortalReady();
}

init().catch((error) => {
  markPortalFailed(error);
  const errorElement = $("#lockError");
  if (errorElement) {
    errorElement.textContent = `Browserfout: ${error?.message || error}`;
    errorElement.hidden = false;
  }
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: error?.stack || error?.message || String(error), source: "init", page: location.href })
  }).catch(() => {});
});






