// Statische Defensie Personeelsportaal configuratie komt uit personeelsportaal-data.js.
const {
  ranks,
  rankCategories,
  rankWeight,
  today,
  profileTrainings,
  profileOperational,
  mentorRanks,
  mentorChecklistGroups,
  mentorChecklistLabels,
  extraTasks,
  extraFunctions,
  disciplineTypes,
  profileDistinctions,
  rankTrainingRequirements,
  autoFunctionByRanks,
  rankColors,
  defaultState
} = window.DefensiePortalData;
let state = structuredClone(defaultState);
let authProfile = null;
let serverBacked = false;
let canViewLogbook = false;
let permissions = {};
let pendingDismissalId = "";
let pendingRestoreId = "";
let selectedProfileId = "";
let pendingDisciplineAction = null;
let pendingI8ReviewAction = null;
let pendingI8ArchiveDeleteId = "";
let pendingAbsenceId = "";
let selectedMentorProfileId = "";
let activeI8Tab = "list";
const pageStorageKey = "orp-defensie-current-page";
const profileStorageKey = "orp-defensie-current-profile";
const mentorStorageKey = "orp-defensie-current-mentor";
const openProfileFlagKey = "orp-defensie-open-own-profile";
const pageRouteMap = {
  dashboard: "/",
  medewerkers: "/medewerkers",
  afwezigheid: "/afwezigheid",
  "i8-opstellen": "/i8-formulier",
  "ontslag-formulier": "/ontslag-formulier",
  "i8-controleren": "/i8-controleren",
  "i8-archief": "/i8-archief",
  "mentor-overzicht": "/mentor-overzicht",
  "mentor-traject": "/mentor-traject",
  "mentor-checklist": "/mentor-checklist",
  "mentor-logboek": "/mentor-logboek",
  "ovj-logboek": "/hovj-logboek",
  "personeel-aannemen": "/personeel-aannemen",
  blacklist: "/blacklist",
  personeel: "/personeel",
  "afwezigheid-overzicht": "/afwezigheid-overzicht",
  "ontslag-overzicht": "/ontslag-overzicht",
  archief: "/personeels-archief",
  logboek: "/logboek",
  "mijn-profiel": "/mijn-profiel"
};
const routePageMap = Object.fromEntries(Object.entries(pageRouteMap).map(([page, route]) => [route, page]));
let suppressRouteSync = false;
const portalWindowName = "defensie-personeelsportaal-main";
const portalChannelName = "orp-defensie-portaal-window";
let reviewCounterPoll = null;
let liveEventSource = null;
let liveRefreshTimer = null;
let rankPieSegments = [];
let mentorChecklistEditingUntil = 0;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];


function registerPersoneelsportaalTab() {
  window.name = portalWindowName;
  const markOpen = () => localStorage.setItem("orp-defensie-portaal-window-seen", String(Date.now()));
  const focusSelf = (requestId = Date.now()) => {
    markOpen();
    localStorage.setItem("orp-defensie-personeelsportaal-focus-ack", String(requestId));
    window.focus();
  };
  markOpen();
  window.addEventListener("focus", markOpen);
  document.addEventListener("visibilitychange", markOpen);
  window.addEventListener("storage", (event) => {
    if (event.key === "orp-defensie-personeelsportaal-focus-request") focusSelf(Number(event.newValue) || Date.now());
  });
  try {
    const channel = new BroadcastChannel(portalChannelName);
    channel.addEventListener("message", (event) => {
      if (event.data?.type === "focus-defensie-portaal") focusSelf(Number(event.data.requestId) || Date.now());
    });
  } catch (error) {
    // BroadcastChannel is optional; the named tab fallback still opens Defensie Personeelsportaal correctly.
  }
}
function currentProfile() {
  if (!authProfile) return null;
  return (
    state.people.find((person) => person.id === authProfile.id || person.discordId === authProfile.discordId) ||
    authProfile
  );
}

function visibleProfile() {
  return state.people.find((person) => person.id === selectedProfileId && person.status === "Actief") || currentProfile();
}

function hasKaderAccess() {
  return Boolean(permissions.canManagePeople || canViewLogbook);
}

function canManageProfileBadges() {
  return Boolean(permissions.canManageProfileBadges || hasKaderAccess());
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
function canViewOvJChannels() {
  return Boolean(permissions.canViewOvJChannels || hasKaderAccess());
}

function canLeadOvJ() {
  return Boolean(permissions.canLeadOvJ || hasKaderAccess());
}

function canViewMentorOverview() {
  return Boolean(permissions.canViewMentorOverview || hasKaderAccess());
}

function canManageMentorOverview() {
  return Boolean(permissions.canManageMentorOverview || hasKaderAccess());
}

function canViewOwnMentorTrajectory() {
  const current = currentProfile();
  return Boolean(current && current.status === "Actief" && mentorRanks.includes(current.rank));
}

function canViewMentorSection() {
  return Boolean(canViewMentorOverview() || canViewOwnMentorTrajectory());
}

function canRecruitPeople() {
  return Boolean(permissions.canRecruitPeople || hasKaderAccess());
}

function canViewBlacklist() {
  return Boolean(permissions.canViewBlacklist || canRecruitPeople());
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
const escapeHtml = DefensiePortalUI.escapeHtml;
const formatDate = DefensiePortalUI.formatDate;
const formatDateTime = DefensiePortalUI.formatDateTime;
function formatMinutes(minutes) {
  const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${hours}u ${String(remainder).padStart(2, "0")}m`;
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
  if ("canViewLogbook" in payload) {
    canViewLogbook = Boolean(payload.canViewLogbook);
  }
  if (payload.permissions) {
    permissions = payload.permissions;
  }
  localStorage.removeItem("orp-defensie-state");
}

async function runAction(path, body = {}) {
  if (!serverBacked) return false;
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    authProfile = null;
    resetPermissions();
    setLocked(true);
    return false;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showSiteNotice(payload.error || "Actie kon niet worden uitgevoerd.", "Actie mislukt");
    await loadState();
    return false;
  }
  applyServerState(payload);
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
      const shouldShowAuthError = payload.error && payload.error !== "Niet ingelogd";
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

function showLockError() {
  const errorCode = new URLSearchParams(window.location.search).get("authError");
  const messages = {
    "no-profile": "Geen profiel gevonden in Defensie Personeelsportaal.",
    "no-role": "Geen Discord gekoppeld: je mist de Defensie rol.",
    "login-failed": "Aanmelden via Discord is mislukt. Controleer Client Secret, callback URL en probeer opnieuw.",
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
    return person.status === "Actief" && (name === normalized || serviceNumber === normalized || id === normalized);
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
  syncBrowserRoute(resolvedPage || activePageId(), mode);
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
    "mentor-checklist": "Mentor-Checklist",
    "mentor-logboek": "Mentor-Logboek",
    afwezigheid: "Afwezigheid",
    "i8-opstellen": "I8-Formulier",
    "ontslag-formulier": "Ontslag-Formulier",
    "i8-controleren": "I8-Controleren",
    "i8-archief": "I8-Archief",
    "ovj-logboek": "hOvJ-Logboek",
    "afwezigheid-overzicht": "Afwezigheid overzicht",
    "ontslag-overzicht": "Ontslag-Overzicht",
    "personeel-aannemen": "Personeel Aannemen",
    blacklist: "Blacklist",
    archief: "Personeels-Archief",
    logboek: "Logboek"
  }[page];
}

function validPage(page) {
  const visiblePages = new Set(["dashboard", "mijn-profiel", "medewerkers", "afwezigheid", "i8-opstellen", "ontslag-formulier", "i8-controleren", "i8-archief", "afwezigheid-overzicht", "ontslag-overzicht", "mentor-overzicht", "mentor-traject", "mentor-checklist", "mentor-logboek", "ovj-logboek", "personeel-aannemen", "blacklist", "personeel", "archief", "logboek"]);
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

function cleanLoginRedirect() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("login")) return;
  url.searchParams.delete("login");
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, document.title, next || "/");
}

function setPage(page) {
  page = validPage(page);
  if (["logboek", "archief", "personeel", "afwezigheid-overzicht", "ontslag-overzicht"].includes(page) && !hasKaderAccess()) {
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
  if (page === "personeel-aannemen" && !canRecruitPeople()) {
    page = "dashboard";
  }
  if (page === "blacklist" && !canViewBlacklist()) {
    page = "dashboard";
  }
  if (page === "mentor-traject" && !canViewOwnMentorTrajectory()) {
    page = canViewMentorOverview() ? "mentor-overzicht" : "dashboard";
  }
  if (page === "mentor-logboek" && !canViewMentorLeadershipLog()) {
    page = canViewMentorOverview() ? "mentor-overzicht" : "dashboard";
  }
  $$(".page").forEach((element) => element.classList.toggle("active", element.id === page));
  $$(".nav-item").forEach((element) => element.classList.toggle("active", element.dataset.page === page));
  $("#pageTitle").textContent = pageTitle(page);
  saveCurrentPage(page);
  syncBrowserRoute(page);
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
  const activePeople = state.people.filter((person) => person.status === "Actief");
  $("#statActive").textContent = activePeople.length;
  $("#statAbsent").textContent = state.absences.filter(absenceIsActive).length;

  const rankCounts = ranks
    .map((rank) => ({
      rank,
      count: activePeople.filter((person) => person.rank === rank).length
    }))
    .filter((item) => item.count > 0);

  if (!rankCounts.length) {
    rankPieSegments = [];
    $("#rankPie").style.background = "var(--surface-2)";
    $("#rankLegend").innerHTML = '<div class="feed-item">Nog geen actieve leden.</div>';
  } else {
    const sortedRankCounts = rankCounts;
    let cursor = 0;
    rankPieSegments = [];
    const segments = sortedRankCounts.map((item) => {
      const start = cursor;
      const end = cursor + (item.count / activePeople.length) * 100;
      cursor = end;
      rankPieSegments.push({ rank: item.rank, count: item.count, start, end });
      return `${rankColors[item.rank]} ${start}% ${end}%`;
    });
    $("#rankPie").style.background = `conic-gradient(${segments.join(", ")})`;
    $("#rankLegend").innerHTML = sortedRankCounts
      .map((item) => `
        <div class="rank-legend-item">
          <span class="rank-swatch" style="background:${rankColors[item.rank]}"></span>
          <span>${escapeHtml(item.rank)}</span>
          <span class="rank-count">${item.count}</span>
        </div>
      `)
      .join("");
  }

  $("#serviceRangeRows").innerHTML = rankCategories
    .map((category) => {
      const count = activePeople.filter((person) => category.ranks.includes(person.rank)).length;
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
  const isKader = hasKaderAccess();
  const showOvJ = canViewOvJChannels();
  const showMentorOverview = canViewMentorOverview();
  const showMentorTrajectory = canViewOwnMentorTrajectory();
  const showMentorSection = canViewMentorSection();
  const showWs = canRecruitPeople();
  const showOvJLeadership = canViewOvJLeadershipLog();
  const showMentorLeadership = canViewMentorLeadershipLog();
  $$('[data-kader-only="true"]').forEach((element) => {
    element.hidden = !isKader;
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
  $$('[data-ws-only="true"]').forEach((element) => {
    element.hidden = !showWs;
  });
  $$('[data-ovj-leadership-only="true"]').forEach((element) => {
    element.hidden = !showOvJLeadership;
  });
  $$('[data-mentor-leadership-only="true"]').forEach((element) => {
    element.hidden = !showMentorLeadership;
  });
  $$('[data-restricted-divider="true"]').forEach((element) => {
    element.hidden = !(isKader || showOvJ || showMentorSection || showWs || showOvJLeadership || showMentorLeadership);
  });
  renderNavigationCounters();
  if (!isKader && ($("#logboek").classList.contains("active") || $("#archief").classList.contains("active") || $("#personeel").classList.contains("active") || $("#afwezigheid-overzicht").classList.contains("active") || $("#ontslag-overzicht").classList.contains("active"))) {
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
  if (!showMentorTrajectory && $("#mentor-traject").classList.contains("active")) {
    setPage(showMentorOverview ? "mentor-overzicht" : "dashboard");
  }
  if (!showMentorLeadership && $("#mentor-logboek")?.classList.contains("active")) {
    setPage(showMentorOverview ? "mentor-overzicht" : "dashboard");
  }
  if (!showWs && ($("#personeel-aannemen")?.classList.contains("active") || $("#blacklist")?.classList.contains("active"))) {
    setPage("dashboard");
  }
}

function openI8ReviewCount() {
  return (state.i8Forms || []).filter((form) => ["pending", "in_review"].includes(form.status || "pending")).length;
}

function openResignationFormCount() {
  return (state.resignationForms || []).filter((form) => !["Verwerkt", "Geannuleerd"].includes(form.status || "Ingediend")).length;
}

function setNavCounter(selector, count, visible) {
  const badge = $(selector);
  if (!badge) return;
  badge.textContent = String(count);
  badge.hidden = !visible || count <= 0;
}

function renderNavigationCounters() {
  // Sidebar-tellers volgen dezelfde openstaande items als de achterliggende overzichtspagina's.
  setNavCounter("#absenceOverviewCounter", openAbsenceRequestCount(), hasKaderAccess());
  setNavCounter("#resignationOverviewCounter", openResignationFormCount(), hasKaderAccess());
  setNavCounter("#i8ReviewCounter", openI8ReviewCount(), canViewOvJChannels());
}

function activePageId() {
  return $(".page.active")?.id || "dashboard";
}

// Voorkomt dat live refresh een geopend rechtermuismenu uit de DOM rendert.
function hasOpenTransientMenu() {
  return Boolean(
    $(".card-menu-panel.is-context-open") ||
    $("#disciplineContextMenu:not([hidden])") ||
    $("#absenceContextMenu:not([hidden])") ||
    $("#i8ArchiveContextMenu:not([hidden])")
  );
}

function hasActiveMentorChecklistInteraction() {
  const notesField = $("#mentorNotes");
  const isTypingMentorNote = activePageId() === "mentor-checklist" && notesField && document.activeElement === notesField;
  const hasUnsavedMentorNote = activePageId() === "mentor-checklist" && notesField && notesField.value.trim().length > 0;
  return activePageId() === "mentor-checklist" && (Date.now() < mentorChecklistEditingUntil || isTypingMentorNote || hasUnsavedMentorNote);
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
    renderMentorLeadershipLog();
    renderRecruitment();
    renderPeople();
    renderArchive();
    renderBlacklist();
    renderOvJLeadershipLog();
    renderLogbook();
  }

  if (["forms", "state"].includes(scope)) {
    renderDashboard();
    renderI8Forms();
    renderOvJLeadershipLog();
    renderAbsenceOverview();
    renderResignationOverview();
    renderLogbook();
  }

  if (["public-forms", "state"].includes(scope)) {
    renderLogbook();
  }

  if (!["people", "forms", "public-forms", "porto", "state"].includes(scope)) {
    render();
  }

  setPage(page);
}
async function refreshReviewCounters() {
  if (!authProfile || !serverBacked || document.body.classList.contains("locked")) return;
  if (hasOpenTransientMenu() || hasActiveMentorChecklistInteraction() || hasActiveLiveEditInteraction()) return;
  const loaded = await loadState();
  if (!loaded) return;
  renderNavigationCounters();
  const page = activePageId();
  if (page === "i8-controleren") renderI8Forms();
  if (page === "afwezigheid-overzicht") renderAbsenceOverview();
  if (page === "ontslag-overzicht") renderResignationOverview();
  if (page === "blacklist") renderBlacklist();
  if (page === "dashboard") renderDashboard();
}

function startReviewCounterPolling() {
  if (reviewCounterPoll) return;
  reviewCounterPoll = window.setInterval(refreshReviewCounters, 4000);
}

// Houdt het ontslagformulier gekoppeld aan het eigen actieve profiel.
// Houdt het W&S-formulier gekoppeld aan het ingelogde profiel en de huidige datum.

const pendingLiveScopes = new Set();
let liveRefreshDeferTimer = null;

function scheduleLiveRefresh(scope = "state") {
  pendingLiveScopes.add(scope || "state");
  if (liveRefreshTimer) return;
  liveRefreshTimer = window.setTimeout(async () => {
    liveRefreshTimer = null;
    if (!authProfile || !serverBacked || document.body.classList.contains("locked")) return;
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
  ["people", "forms", "porto", "public-forms"].forEach(listenForLiveScope);
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
  pendingLiveScopes.clear();
}
function renderLogbook() {
  const isKader = hasKaderAccess();
  $("#activityFeed").innerHTML = isKader
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
  renderMentorLeadershipLog();
  renderRecruitment();
  renderPeople();
  renderArchive();
  renderI8Forms();
  renderOvJLeadershipLog();
  renderAbsenceOverview();
  renderResignationOverview();
}

function wireEvents() {
  window.addEventListener("resize", updateDeviceMode);
  window.addEventListener("popstate", () => applyRouteState("replace"));
  $$(".nav-item[data-page]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  const rankPie = $("#rankPie");
  rankPie?.addEventListener("mousemove", moveRankPieTooltip);
  rankPie?.addEventListener("mouseleave", hideRankPieTooltip);
  const portoButton = $("[data-open-porto]");
  if (portoButton) {
    portoButton.addEventListener("click", () => window.open("/porto.html", "_blank", "noopener"));
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
    const confirmed = await showSiteConfirm({
      title: "Meldingen leegmaken",
      message: "Weet je zeker dat je al je meldingen wil verwijderen?",
      confirmText: "Leegmaken",
      cancelText: "Annuleren",
      danger: true
    });
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
  $("#addDisciplineBtn").addEventListener("click", openDisciplineDialog);
  $("#closeDisciplineDialog").addEventListener("click", () => $("#disciplineDialog").close());
  $("#cancelDisciplineDialog").addEventListener("click", () => $("#disciplineDialog").close());
  $("#closeEditDisciplineDialog").addEventListener("click", () => $("#editDisciplineDialog").close());
  $("#cancelEditDisciplineDialog").addEventListener("click", () => $("#editDisciplineDialog").close());
  $("#closeDeleteDisciplineDialog").addEventListener("click", () => $("#deleteDisciplineDialog").close());
  $("#cancelDeleteDisciplineDialog").addEventListener("click", () => $("#deleteDisciplineDialog").close());
  $("#closeI8DetailDialog").addEventListener("click", () => $("#i8DetailDialog").close());
  $("#closeI8DetailFooter").addEventListener("click", () => $("#i8DetailDialog").close());
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
  $("#closeProfileBadgeDialog").addEventListener("click", () => $("#profileBadgeDialog").close());
  $("#cancelProfileBadgeDialog").addEventListener("click", () => $("#profileBadgeDialog").close());
  $("#profileBadgeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#profileBadgePersonId").value;
    const viewed = visibleProfile();
    const sideTaskSet = new Set(window.profileSideTaskBadges || []);
    const dialogMode = window.profileBadgeDialogMode || "main";
    const selectedFunctions = $$("#profileBadgeFunctionOptions input:checked").map((input) => input.value);
    const extraFunctions = dialogMode === "side" ? (viewed?.extraFunctions || []) : selectedFunctions;
    const selectedBadges = $$("#profileBadgeTaskOptions input:checked").map((input) => input.value);
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
    if (await runAction(`/api/people/${encodeURIComponent(viewed.id)}/qualifications`, { completedTrainings, completedOperational })) {
      render();
    }
  });
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
  $("#resignationOverview")?.addEventListener("click", async (event) => {
    const processId = event.target.closest("[data-resignation-process]")?.dataset.resignationProcess;
    const cancelId = event.target.closest("[data-resignation-cancel]")?.dataset.resignationCancel;
    const deleteId = event.target.closest("[data-resignation-delete]")?.dataset.resignationDelete;
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
    if (await runAction(endpoint, {})) render();
  });
  $("#i8ArchiveSearchInput").addEventListener("input", renderI8Forms);
  $$('[data-i8-archive-status]').forEach((button) => button.addEventListener("click", () => setI8ArchiveStatusFilter(button.dataset.i8ArchiveStatus)));
  $$('[data-i8-tab]').forEach((button) => {
    button.addEventListener("click", () => {
      setI8Tab(button.dataset.i8Tab);
      if (button.dataset.i8Tab === "create") resetI8Form();
    });
  });
  $("#i8DetailBody").addEventListener("click", (event) => {
    const status = event.target.dataset.i8DetailStatus;
    const formId = event.target.closest("[data-i8-detail-form]")?.dataset.i8DetailForm;
    if (!formId || !status || !canViewOvJChannels()) return;
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
    resetI8Form();
    setI8Tab("list");
    render();
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
    if (!absenceId || !hasKaderAccess()) return;
    const status = approveId ? "Goedgekeurd" : "Afgekeurd";
    if (await runAction(`/api/absences/${encodeURIComponent(absenceId)}/status`, { status })) render();
  });
  $("#absenceOverview").addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-absence-id]");
    if (!row) return;
    openAbsenceContextMenu(event, row.dataset.absenceId);
  });
  $("#absenceContextMenu").addEventListener("click", (event) => {
    if (event.target.dataset.absenceContext === "delete") openDeleteAbsenceDialog();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#absenceContextMenu")) hideAbsenceContextMenu();
    if (!event.target.closest("#i8ArchiveContextMenu")) hideI8ArchiveContextMenu();
  });
  window.addEventListener("scroll", hideAbsenceContextMenu, true);
  window.addEventListener("scroll", hideI8ArchiveContextMenu, true);
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
  $("#mentorOverviewList").addEventListener("click", (event) => {
    if (event.target.closest(".mentor-test-overview")) return;
    const row = event.target.closest("[data-open-mentor]");
    if (!row) return;
    if (canViewMentorLeadershipLog()) {
      selectMentorAuditPerson(row.dataset.openMentor);
      return;
    }
    openMentorChecklist(row.dataset.openMentor);
  });
  $("#mentorOverviewList").addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-open-mentor]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (canViewMentorLeadershipLog()) {
      selectMentorAuditPerson(event.target.dataset.openMentor);
      return;
    }
    openMentorChecklist(event.target.dataset.openMentor);
  });
  $("#mentorOverviewList").addEventListener("change", async (event) => {
    const input = event.target.closest("[data-mentor-test]");
    if (!input) return;
    event.stopPropagation();
    const person = state.people.find((entry) => entry.id === input.dataset.mentorTestPerson);
    if (!person) return;
    const checklist = mentorChecklistFor(person);
    if (!checklist.allItemsCompleted) {
      input.checked = false;
      return;
    }
    const row = input.closest("[data-open-mentor]");
    const sentInput = row?.querySelector('[data-mentor-test="sent"]');
    const approvedInput = row?.querySelector('[data-mentor-test="approved"]');
    let testSent = Boolean(sentInput?.checked);
    let testApproved = Boolean(approvedInput?.checked);
    if (input.dataset.mentorTest === "approved" && testApproved) {
      const confirmed = await showSiteConfirm(`${person.name} heeft de toets goedgekeurd. Mentor-Traject afronden?`, "Mentor-Traject afronden");
      if (!confirmed) {
        input.checked = false;
        return;
      }
    }
    if (!testSent) testApproved = false;
    const saved = await saveMentorChecklist(person.id, { items: checklist.items, testSent, testApproved });
    if (saved) render();
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
  $("#mentorLeadershipLogList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-mentor-log-person]");
    if (row) openMentorLogDetail(row.dataset.mentorLogPerson);
  });
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
  $("#bulkHoursBtn")?.addEventListener("click", openBulkHoursDialog);
  $("#closeHoursOverviewDialog")?.addEventListener("click", () => $("#hoursOverviewDialog").close());
  $("#closeHoursOverviewFooter")?.addEventListener("click", () => $("#hoursOverviewDialog").close());
  $(".profile-hours-panel")?.addEventListener("contextmenu", (event) => {
    const viewed = visibleProfile();
    if (!viewed || !canViewHours(viewed)) return;
    event.preventDefault();
    openHoursOverviewDialog(viewed);
  });
  $("#closeBulkHoursDialog")?.addEventListener("click", () => $("#bulkHoursDialog").close());
  $("#cancelBulkHoursDialog")?.addEventListener("click", () => $("#bulkHoursDialog").close());
  $("#profileHoursEntry")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const personId = $("#profileHoursPersonId").value;
    const weekYear = Number($("#profileHoursWeekYear").value);
    const weekNumber = Number($("#profileHoursWeekNumber").value);
    const hours = Number($("#profileHoursInput").value || 0);
    if (!personId || !canManageHours()) return;
    if (await saveManualHours([{ personId, hours }], weekYear, weekNumber)) render();
  });
  $("#bulkHoursWeekOptions")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-bulk-hours-week-year][data-bulk-hours-week-number]");
    if (!button || typeof selectBulkHoursWeek !== "function") return;
    selectBulkHoursWeek({
      weekYear: Number(button.dataset.bulkHoursWeekYear),
      weekNumber: Number(button.dataset.bulkHoursWeekNumber)
    });
  });  $("#bulkHoursForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canManageHours()) return;
    const weekYear = Number($("#bulkHoursWeekYear").value);
    const weekNumber = Number($("#bulkHoursWeekNumber").value);
    const entries = $$("[data-bulk-hours-person]")
      .filter((input) => input.value !== "")
      .map((input) => ({ personId: input.dataset.bulkHoursPerson, hours: Number(input.value || 0) }));
    if (!entries.length) {
      await showSiteNotice("Vul minimaal een urenregel in.", "Geen uren ingevuld");
      return;
    }
    if (await saveManualHours(entries, weekYear, weekNumber)) {
      $("#bulkHoursDialog").close();
      render();
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
  $("#memberRank").addEventListener("change", () => fillServiceSelect());

  $("#peopleList").addEventListener("click", async (event) => {
    const openPersonProfileId = event.target.dataset.openPersonProfile;
    const editId = event.target.dataset.edit;
    const clearHistoryId = event.target.dataset.clearHistory;
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
    if (promoteId) {
      if (await runAction(`/api/people/${encodeURIComponent(promoteId)}/promote`)) render();
    }
    if (demoteId) {
      if (await runAction(`/api/people/${encodeURIComponent(demoteId)}/demote`)) render();
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
      if (panel !== menu) panel.classList.remove("is-context-open");
    });
    menu.classList.add("is-context-open");
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest(".card-menu-wrap")) return;
    $$(".card-menu-panel.is-context-open").forEach((panel) => panel.classList.remove("is-context-open"));
  });

  $("#dismissalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const person = state.people.find((entry) => entry.id === pendingDismissalId);
    const reason = $("#dismissalReason").value.trim();
    if (!person || !reason) return;
    const dismissed = await runAction(`/api/people/${encodeURIComponent(person.id)}/dismiss`, { reason });
    if (!dismissed) return;
    pendingDismissalId = "";
    $("#dismissalDialog").close();
    render();
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
      rankDate: $("#memberRankDate").value,
      promotionDate: $("#memberPromotionDate").value,
      tasks: $("#memberTasks").value.trim()
    };

    const existing = state.people.find((entry) => entry.id === id);
    const path = existing ? `/api/people/${encodeURIComponent(id)}` : "/api/people";
    if (!(await runAction(path, { person }))) return;
    $("#memberDialog").close();
    render();
  });

  // W&S maakt een basisprofiel aan; de server kiest rang en eerste vrije 74-dienstnummer.
  $("#recruitmentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#recruitmentMessage");
    if (message) {
      message.hidden = true;
      message.textContent = "";
    }
    const saved = await runAction("/api/recruitment/hire", {
      name: $("#recruitmentName").value.trim(),
      hiredDate: $("#recruitmentHiredDate").value,
      discordId: $("#recruitmentDiscordId").value.trim()
    });
    if (!saved) return;
    event.target.reset();
    $("#recruitmentHiredDate").value = today;
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
  registerPersoneelsportaalTab();
  updateDeviceMode();
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
    return;
  }
  const hasState = await loadState();
  if (!hasState) {
    authProfile = null;
    resetPermissions();
    setLocked(true);
    return;
  }
  render();
  restoreSavedPage();
  startReviewCounterPolling();
  startLiveUpdates();
}

init().catch((error) => {
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






