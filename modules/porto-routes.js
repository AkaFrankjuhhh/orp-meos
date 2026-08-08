const crypto = require("node:crypto");
const { createPortoServices } = require("./porto");
const { enqueueDiscordSyncJob } = require("./discord-sync-jobs");
const { currentOrganization } = require("./organizations");
const { allSideTasks } = require("./side-tasks-config");
const { createSideTasksStore } = require("./side-tasks-store");
const { portoPhonebookPeople } = require("./porto-phonebook");
const { isCurrentPerson } = require("./person-status");
const {
  DEFAULT_PORTO_DUTY_HOURS_START_WEEK,
  PORTO_DUTY_HOURS_ENTERED_BY_ID,
  PORTO_DUTY_HOURS_SOURCE,
  buildPortoDutyHourEntries
} = require("./porto-duty-hours");
const { operationalWeekForDate } = require("./operational-weeks");

function activePersonForAuth(state, auth) {
  return (state.people || []).find((entry) => entry.id === auth.profile.id && isCurrentPerson(entry));
}

function offDutyMemberKey(memberId) {
  return String(memberId || "").trim();
}

function collectPortoOffDutyUnits(state, { unit, oldVehicleNumber = "", offDutyScope = "vehicle", operatorVehicleNumber = "30-00" } = {}) {
  if (!unit) return [];
  const scopedUnits = offDutyScope === "member" || oldVehicleNumber === operatorVehicleNumber
    ? [unit]
    : (state.portoUnits || []).filter((entry) => entry.active !== false && entry.vehicleNumber === oldVehicleNumber);
  const memberKeys = new Set(scopedUnits.map((entry) => offDutyMemberKey(entry.memberId)).filter(Boolean));
  const seen = new Set();
  const unitsToEnd = [];
  for (const entry of [
    ...scopedUnits,
    ...(state.portoUnits || []).filter((candidate) => (
      candidate?.active !== false &&
      memberKeys.has(offDutyMemberKey(candidate.memberId))
    ))
  ]) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    unitsToEnd.push(entry);
  }
  return unitsToEnd;
}

function regularPortoPrefix(operatorVehicleNumber = "30-00") {
  return String(operatorVehicleNumber || "30-00").split("-")[0] || "30";
}

function firstAvailableRegularPortoVehicleNumber(state, operatorVehicleNumber = "30-00") {
  const prefix = regularPortoPrefix(operatorVehicleNumber);
  const range = (state.portoVehicleRanges || []).find((entry) => entry.prefix === prefix);
  if (!range) return "";
  const used = new Set(
    (state.portoUnits || [])
      .filter((unit) => unit.active !== false && unit.vehicleNumber)
      .map((unit) => unit.vehicleNumber)
  );
  return (range.numbers || []).find((number) => number && number !== operatorVehicleNumber && !used.has(number)) || "";
}

function createPortoRouteHandler({ requireAuth, readState, writeState, writePortoSettings, writePortoPhone, writePortoUnits, writePortoDutyHours, readBody, sendJson, discordBot }) {
  const organization = currentOrganization();
  const sideTasksStore = createSideTasksStore();
  const sideTaskDefinitions = allSideTasks();
  let sideTaskStatusWarningLogged = false;
  let sideTaskStatusCache = { expiresAt: 0, byDiscordId: new Map() };
  const operatorLabel = organization.porto?.operatorLabel || organization.discord?.portoOperatorLabel || "OPS";
  const operatorTraining = organization.porto?.operatorTraining || operatorLabel;
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";
  const operatorVehicleCode = organization.porto?.operatorVehicleCode || operatorLabel;
  const operatorVehicleType = organization.porto?.operatorVehicleType || operatorLabel;
  const operatorVehicleName = organization.porto?.operatorVehicleName || operatorLabel;
  const operatorChannelKey = organization.porto?.operatorChannelKey || "ops";
  const managementLabel = organization.permissionAliases?.kader?.[0] || "leiding";
  const managementBypassLabel = organization.key === "politie" ? "KL Bypass" : "Kader Bypass";
  const portoDutyHoursTimeZone = process.env.PORTO_DUTY_HOURS_TIME_ZONE || "Europe/Amsterdam";
  const portoDutyHoursStartWeek = process.env.PORTO_DUTY_HOURS_START_WEEK || DEFAULT_PORTO_DUTY_HOURS_START_WEEK;
  const {
    ensurePortoVehicleRanges,
    canUsePortoDevBypass,
    canUsePortoManagementBypass,
    canServePortoOps,
    canOperatePortoOps,
    activePortoOps,
    vehicleRangeForNumber,
    vehicleDetailsForSelection,
    availablePortoVehicleNumbers,
    firstAvailableVehicleNumber,
    syncPortoLinkedNames,
    closeIneligiblePortoOpsUnits,
    sweepPortoPresence,
    touchPortoPresence,
    decoratePortoUnit,
    portoOpsPayload,
    configuredPortoDiscordChannels,
    isPortoOperatorLeadUnit
  } = createPortoServices();
  let mutationQueue = Promise.resolve();
  const status4Reasons = new Set(["Staandehouding", "Afhandeling", "In hoofd", "Overige"]);
  const configuredStatus8RejoinGuardMs = Number(process.env.PORTO_STATUS8_REJOIN_GUARD_MS);
  const status8RejoinGuardMs = Number.isFinite(configuredStatus8RejoinGuardMs)
    ? Math.max(0, configuredStatus8RejoinGuardMs)
    : 15 * 60 * 1000;
  const configuredBrowserTimeoutMs = Number(process.env.PORTO_BROWSER_TIMEOUT_MS);
  const portoBrowserTimeoutMs = Number.isFinite(configuredBrowserTimeoutMs)
    ? (configuredBrowserTimeoutMs <= 0 ? 0 : Math.max(60000, configuredBrowserTimeoutMs))
    : 15 * 60 * 1000;
  const configuredBrowserCloseGraceMs = Number(process.env.PORTO_BROWSER_CLOSE_GRACE_MS);
  const portoBrowserCloseGraceMs = Number.isFinite(configuredBrowserCloseGraceMs)
    ? (configuredBrowserCloseGraceMs <= 0 ? 0 : Math.max(portoBrowserTimeoutMs || 60000, configuredBrowserCloseGraceMs))
    : (portoBrowserTimeoutMs ? Math.max(portoBrowserTimeoutMs, 60 * 60 * 1000) : 0);
  const configuredBrowserTimeoutCheckMs = Number(process.env.PORTO_BROWSER_TIMEOUT_CHECK_MS);
  const portoBrowserTimeoutCheckMs = Number.isFinite(configuredBrowserTimeoutCheckMs)
    ? Math.max(30000, configuredBrowserTimeoutCheckMs)
    : 60 * 1000;
  const configuredBrowserHardTimeoutMs = Number(process.env.PORTO_BROWSER_HARD_TIMEOUT_MS);
  const portoBrowserHardTimeoutMs = Number.isFinite(configuredBrowserHardTimeoutMs)
    ? (configuredBrowserHardTimeoutMs <= 0 ? 0 : Math.max(portoBrowserTimeoutMs || 60000, configuredBrowserHardTimeoutMs))
    : 4 * 60 * 60 * 1000;
  const configuredBrowserHeartbeatPersistMs = Number(process.env.PORTO_BROWSER_HEARTBEAT_PERSIST_MS);
  const portoBrowserHeartbeatPersistMs = Number.isFinite(configuredBrowserHeartbeatPersistMs)
    ? (configuredBrowserHeartbeatPersistMs <= 0 ? 0 : Math.max(5000, configuredBrowserHeartbeatPersistMs))
    : 45 * 1000;
  const configuredDiscordJobDelayMs = Number(process.env.PORTO_DISCORD_JOB_DELAY_MS);
  const portoDiscordJobDelayMs = Number.isFinite(configuredDiscordJobDelayMs)
    ? Math.max(0, configuredDiscordJobDelayMs)
    : 500;
  let portoBrowserTimeoutTimer = null;
  const pendingAutoAssignMs = 60000;
  const recentlyEndedPortoMembers = new Map();
  const dutyRoleSuffix = organization.key === "politie" ? "P" : "K";
  const dutyRoleDefinitions = [
    ...(organization.key === "politie" ? [] : [
      { key: "OPCO", label: "OPCO", requiredAny: ["OPCO"], nicknameLabel: `OPCO-${dutyRoleSuffix}` },
      { key: "OVD", label: "OVD", requiredAny: ["OVD", "OVD-P", "OVD-K"], nicknameLabel: `OVD-${dutyRoleSuffix}` }
    ]),
    { key: "BGD", label: "BGD (Burgerdienst)", requiredAny: [], requiresManagementBypass: true, allowMultiple: true, nicknameLabel: "BGD" },
    { key: "K9", label: "K9", requiredAny: ["K9"], nicknameLabel: `K9-${dutyRoleSuffix}`, requiresK9Name: true },
    { key: "K9_BEGELEIDER", label: "K9 Begeleider", requiredAny: ["K9 Begeleider"], nicknameLabel: `K9B-${dutyRoleSuffix}` }
  ];

  function portoMemberKey(memberId) {
    return String(memberId || "").trim();
  }

  function markRecentlyEnded(memberId, nowMs = Date.now()) {
    if (!status8RejoinGuardMs) return;
    const key = portoMemberKey(memberId);
    if (key) recentlyEndedPortoMembers.set(key, nowMs + status8RejoinGuardMs);
  }

  function markRecentlyEndedUnits(units = [], nowMs = Date.now()) {
    for (const unit of units || []) markRecentlyEnded(unit?.memberId, nowMs);
  }

  function clearRecentlyEnded(memberId) {
    const key = portoMemberKey(memberId);
    if (key) recentlyEndedPortoMembers.delete(key);
  }

  function isRecentlyEnded(memberId, nowMs = Date.now()) {
    if (!status8RejoinGuardMs) return false;
    const key = portoMemberKey(memberId);
    if (!key) return false;
    const expiresAt = recentlyEndedPortoMembers.get(key);
    if (!expiresAt) return false;
    if (expiresAt <= nowMs) {
      recentlyEndedPortoMembers.delete(key);
      return false;
    }
    return true;
  }

  function firstAvailableRegularVehicleNumber(state) {
    return firstAvailableRegularPortoVehicleNumber(state, operatorVehicleNumber);
  }

  function pendingSeconds(unit, nowMs = Date.now()) {
    const requestedAt = Date.parse(unit?.requestedAt || unit?.updatedAt || "");
    if (!Number.isFinite(requestedAt)) return 0;
    return Math.max(0, Math.floor((nowMs - requestedAt) / 1000));
  }

  function recentlyEndedError() {
    return {
      error: "Uitdienstmelding wordt nog verwerkt. Wacht kort voordat je opnieuw aanmeldt.",
      code: "porto_recently_ended"
    };
  }

  function normalizedPortoDutyRole(value) {
    const key = String(value || "").trim().toUpperCase();
    return dutyRoleDefinitions.some((role) => role.key === key) ? key : "";
  }

  function canPersonUsePortoDutyRole(person, roleKey) {
    const role = dutyRoleDefinitions.find((entry) => entry.key === roleKey);
    if (!role) return false;
    if (role.requiresManagementBypass && !canUsePortoManagementBypass(person)) return false;
    if (!Array.isArray(role.requiredAny) || !role.requiredAny.length) return true;
    const values = new Set([
      ...(Array.isArray(person?.completedOperational) ? person.completedOperational : []),
      ...(Array.isArray(person?.completedTrainings) ? person.completedTrainings : [])
    ].map(String));
    return role.requiredAny.some((value) => values.has(value));
  }

  function personHasK9Training(person) {
    return (Array.isArray(person?.completedTrainings) ? person.completedTrainings : []).includes("K9");
  }

  function clearPortoDutyRole(unit) {
    if (!unit) return;
    unit.dutyRole = "";
  }

  function markPortoBrowserHeartbeat(unit, nowIso = new Date().toISOString()) {
    if (!unit || unit.active === false) return false;
    const nowMs = timestampMs(nowIso) || Date.now();
    const previousHeartbeatMs = timestampMs(unit.browserHeartbeatAt);
    const hadCloseSignal = Boolean(unit.browserCloseSuspectedAt);
    const wasInactive = !unit.browserHeartbeatActive;
    const shouldPersist =
      hadCloseSignal ||
      wasInactive ||
      !previousHeartbeatMs ||
      (portoBrowserHeartbeatPersistMs > 0 && nowMs - previousHeartbeatMs >= portoBrowserHeartbeatPersistMs);

    if (!shouldPersist) return false;

    unit.browserHeartbeatActive = true;
    unit.browserHeartbeatAt = nowIso;
    unit.lastSeenAt = nowIso;
    unit.updatedAt = nowIso;
    delete unit.browserCloseSuspectedAt;
    return true;
  }

  function markPortoBrowserClosed(unit, nowIso = new Date().toISOString()) {
    if (!unit || unit.active === false) return false;
    unit.browserHeartbeatActive = true;
    unit.browserCloseSuspectedAt = nowIso;
    unit.updatedAt = nowIso;
    return true;
  }

  function clearPortoBrowserHeartbeat(unit) {
    if (!unit) return;
    delete unit.browserHeartbeatActive;
    delete unit.browserHeartbeatAt;
    delete unit.browserCloseSuspectedAt;
  }

  function timestampMs(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
  }

  function secondsFromHourEntry(entry) {
    const startedAt = timestampMs(entry?.startedAt);
    const endedAt = timestampMs(entry?.endedAt);
    if (endedAt > startedAt) return Math.round((endedAt - startedAt) / 1000);
    const minutes = Number(entry?.minutes ?? entry?.durationMinutes);
    if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes * 60);
    const hours = Number(entry?.hours ?? entry?.hoursValue);
    return Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : 0;
  }

  function mergedHourEntrySeconds(entries, rangeStartMs = null, rangeEndMs = null) {
    const intervals = [];
    let fallbackSeconds = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
      const startedAt = timestampMs(entry?.startedAt);
      const endedAt = timestampMs(entry?.endedAt);
      if (endedAt > startedAt) {
        const start = Number.isFinite(rangeStartMs) ? Math.max(startedAt, rangeStartMs) : startedAt;
        const end = Number.isFinite(rangeEndMs) ? Math.min(endedAt, rangeEndMs) : endedAt;
        if (end > start) intervals.push({ start, end });
        continue;
      }
      fallbackSeconds += secondsFromHourEntry(entry);
    }
    intervals.sort((a, b) => a.start - b.start || a.end - b.end);
    let mergedSeconds = 0;
    let active = null;
    for (const interval of intervals) {
      if (!active) {
        active = { ...interval };
        continue;
      }
      if (interval.start <= active.end) {
        active.end = Math.max(active.end, interval.end);
        continue;
      }
      mergedSeconds += Math.round((active.end - active.start) / 1000);
      active = { ...interval };
    }
    if (active) mergedSeconds += Math.round((active.end - active.start) / 1000);
    return fallbackSeconds + mergedSeconds;
  }

  function isPortoDutyHourEntry(entry) {
    if (!entry) return false;
    if (entry.source === PORTO_DUTY_HOURS_SOURCE) return true;
    if (entry.enteredById === PORTO_DUTY_HOURS_ENTERED_BY_ID) return true;
    return String(entry.id || "").startsWith("porto-duty-");
  }

  function currentWeekPortoDutyEntries(state, now, week) {
    const byKey = new Map();
    const generatedEntries = buildPortoDutyHourEntries(state, {
      now,
      timeZone: portoDutyHoursTimeZone,
      startWeek: portoDutyHoursStartWeek
    });
    const activeSourceUnitIds = new Set(
      (state?.portoUnits || [])
        .filter((unit) => unit?.active !== false && unit?.assignedAt && unit?.id)
        .map((unit) => String(unit.id))
    );
    const addEntry = (entry) => {
      if (!entry || Number(entry.weekYear) !== week.weekYear || Number(entry.weekNumber) !== week.weekNumber) return;
      if (!isPortoDutyHourEntry(entry)) return;
      const key = entry.id || [
        entry.personId || "",
        entry.discordId || "",
        entry.startedAt || "",
        entry.endedAt || "",
        entry.sourceUnitId || "",
        entry.sourceVehicleNumber || ""
      ].join("::");
      const previous = byKey.get(key);
      if (!previous || secondsFromHourEntry(entry) >= secondsFromHourEntry(previous)) byKey.set(key, entry);
    };
    for (const entry of Array.isArray(state?.hours) ? state.hours : []) {
      const sourceUnitId = String(entry?.sourceUnitId || "");
      if (sourceUnitId && activeSourceUnitIds.has(sourceUnitId)) continue;
      addEntry(entry);
    }
    for (const entry of generatedEntries) addEntry(entry);
    return [...byKey.values()];
  }

  function rangeOverlapSeconds(startMs, endMs, rangeStartMs, rangeEndMs) {
    const start = Math.max(startMs, rangeStartMs);
    const end = Math.min(endMs, rangeEndMs);
    return end > start ? Math.floor((end - start) / 1000) : 0;
  }

  function portoDutyEntryMatchesUnit(entry, unit) {
    if (!entry || !unit) return false;
    const entryUnitId = String(entry.sourceUnitId || "");
    const unitId = String(unit.id || "");
    if (entryUnitId && unitId && entryUnitId === unitId) return true;
    const entryVehicleNumber = String(entry.sourceVehicleNumber || "");
    return Boolean(entryVehicleNumber && entryVehicleNumber === String(unit.vehicleNumber || ""));
  }

  function activePortoDutySessionWeekSeconds(entries, person, unit, assignedAtMs, nowMs, week) {
    if (!assignedAtMs || !person?.id || !unit?.vehicleNumber || unit.active === false) return { total: 0, counted: 0 };
    const weekStartMs = week.startsAt.getTime();
    const weekEndMs = week.endsAt.getTime();
    const total = rangeOverlapSeconds(assignedAtMs, nowMs, weekStartMs, weekEndMs);
    if (!total) return { total: 0, counted: 0 };
    const activeStartMs = Math.max(assignedAtMs, weekStartMs);
    const activeEndMs = Math.min(nowMs, weekEndMs);
    const counted = mergedHourEntrySeconds(
      entries.filter((entry) => String(entry.personId || "") === String(person.id || "") && portoDutyEntryMatchesUnit(entry, unit)),
      activeStartMs,
      activeEndMs
    );
    return { total, counted };
  }

  function portoDutyTimePayload(state, person, unit) {
    const now = new Date();
    const week = operationalWeekForDate(now, { timeZone: portoDutyHoursTimeZone });
    const assignedAtMs = unit?.active !== false && unit?.vehicleNumber ? timestampMs(unit.assignedAt || "") : 0;
    const nowMs = now.getTime();
    const currentSessionSeconds = assignedAtMs ? Math.max(0, Math.floor((nowMs - assignedAtMs) / 1000)) : 0;
    const currentWeekEntries = currentWeekPortoDutyEntries(state, now, week);
    let weekTotalSeconds = mergedHourEntrySeconds(
      currentWeekEntries.filter((entry) => String(entry.personId || "") === String(person?.id || ""))
    );
    const activeSession = activePortoDutySessionWeekSeconds(currentWeekEntries, person, unit, assignedAtMs, nowMs, week);
    weekTotalSeconds += Math.max(0, activeSession.total - activeSession.counted);
    return {
      generatedAt: now.toISOString(),
      timeZone: portoDutyHoursTimeZone,
      weekYear: week.weekYear,
      weekNumber: week.weekNumber,
      weekStartsAt: week.startsAt.toISOString(),
      weekEndsAt: week.endsAt.toISOString(),
      currentSessionStartedAt: assignedAtMs ? new Date(assignedAtMs).toISOString() : "",
      currentSessionSeconds,
      weekTotalSeconds,
      running: Boolean(assignedAtMs)
    };
  }

  function preferredActiveUnit(a, b) {
    const aAssigned = Boolean(a.vehicleNumber);
    const bAssigned = Boolean(b.vehicleNumber);
    if (aAssigned !== bAssigned) return aAssigned ? a : b;
    const aTime = timestampMs(a.updatedAt || a.assignedAt || a.requestedAt || a.lastSeenAt);
    const bTime = timestampMs(b.updatedAt || b.assignedAt || b.requestedAt || b.lastSeenAt);
    if (aTime !== bTime) return aTime > bTime ? a : b;
    return String(a.id || "").localeCompare(String(b.id || "")) >= 0 ? a : b;
  }

  function enqueuePortoMutation(task) {
    const run = mutationQueue.then(task, task);
    mutationQueue = run.catch(() => {});
    return run;
  }

  function peopleById(state) {
    return new Map((state.people || []).map((entry) => [entry.id, entry]));
  }

  function sideTaskStatusView(task, member) {
    const value = String(member?.status || "8");
    if (value === "1") {
      return { key: task.key, label: task.label, state: "available", text: "Beschikbaar" };
    }
    if (value === "4") {
      return { key: task.key, label: task.label, state: "temporary", text: "Tijdelijk Afwezig" };
    }
    return { key: task.key, label: task.label, state: "absent", text: "Afwezig" };
  }

  async function loadSideTaskMembersByDiscordId() {
    if (sideTaskStatusCache.expiresAt > Date.now()) return sideTaskStatusCache.byDiscordId;
    const byDiscordId = new Map();
    try {
      await Promise.all(sideTaskDefinitions.map(async (task) => {
        const members = await sideTasksStore.listMembers(task.key);
        for (const member of members || []) {
          const discordId = String(member.discordId || "").trim();
          if (!discordId) continue;
          if (!byDiscordId.has(discordId)) byDiscordId.set(discordId, new Map());
          byDiscordId.get(discordId).set(task.key, member);
        }
      }));
    } catch (error) {
      if (!sideTaskStatusWarningLogged) {
        sideTaskStatusWarningLogged = true;
        console.error(`[porto] Neventaken-status kon niet worden geladen: ${error.message}`);
      }
      return new Map();
    }
    sideTaskStatusCache = { expiresAt: Date.now() + 2500, byDiscordId };
    return byDiscordId;
  }

  function sideTaskOverview(membersByDiscordId) {
    return sideTaskDefinitions.map((task) => {
      const statuses = [];
      for (const taskMembers of membersByDiscordId.values()) {
        const member = taskMembers.get(task.key);
        if (member) statuses.push(sideTaskStatusView(task, member));
      }
      if (!statuses.length) return sideTaskStatusView(task, null);
      return statuses.sort((left, right) => {
        const priority = { available: 0, temporary: 1, absent: 2 };
        return (priority[left.state] ?? 9) - (priority[right.state] ?? 9);
      })[0];
    });
  }

  async function attachSideTaskOverview(payload) {
    const membersByDiscordId = await loadSideTaskMembersByDiscordId();
    payload.sideTaskOverview = sideTaskOverview(membersByDiscordId);
    return payload;
  }

  function delayedDiscordJobRunAfter() {
    return new Date(Date.now() + portoDiscordJobDelayMs);
  }

  function logDirectDiscordResult(action, subject, result) {
    const label = String(subject || "onbekend");
    if (result?.skipped) {
      console.warn(`[porto] Directe Discord ${action} overgeslagen voor ${label}: ${result.reason || "geen reden"}`);
      return;
    }
    if (result?.unchanged) {
      console.log(`[porto] Directe Discord ${action} ongewijzigd voor ${label}: ${result.nickname || "geen wijziging"}`);
      return;
    }
    if (result?.ok) {
      console.log(`[porto] Directe Discord ${action} gelukt voor ${label}${result.nickname ? `: ${result.nickname}` : ""}`);
      return;
    }
    if (result) console.warn(`[porto] Directe Discord ${action} gaf onverwacht resultaat voor ${label}: ${JSON.stringify(result).slice(0, 500)}`);
  }

  function configuredPortoChannelKeys() {
    return new Set(configuredPortoDiscordChannels().filter((channel) => channel.configured).map((channel) => channel.key));
  }

  function uniquePortoUnits(units = []) {
    const byId = new Map();
    for (const unit of units || []) {
      if (!unit?.id || byId.has(unit.id)) continue;
      byId.set(unit.id, unit);
    }
    return [...byId.values()];
  }

  function activeUnitsForVehicle(state, vehicleNumber) {
    const number = String(vehicleNumber || "").trim();
    if (!number) return [];
    return (state.portoUnits || []).filter((entry) => entry.active !== false && entry.vehicleNumber === number);
  }

  function affectedActiveVehicleUnits(state, vehicleNumbers = [], extraUnits = []) {
    return uniquePortoUnits([
      ...(extraUnits || []),
      ...vehicleNumbers.flatMap((vehicleNumber) => activeUnitsForVehicle(state, vehicleNumber))
    ]).filter((unit) => unit.active !== false && unit.vehicleNumber);
  }

  function vehicleNumbersFromUnits(units = []) {
    return [...new Set((units || [])
      .map((unit) => unit?.previousVehicleNumber || unit?.vehicleNumber || "")
      .map((vehicleNumber) => String(vehicleNumber || "").trim())
      .filter(Boolean))];
  }

  function unitWithPortoNicknameContext(state, unit) {
    if (!unit) return unit;
    return {
      ...unit,
      isPortoOpsLead: isPortoOperatorLeadUnit(state, unit),
      dutyRole: normalizedPortoDutyRole(unit.dutyRole)
    };
  }

  function operatorSlotForTarget(entry, targetVehicleNumber, leadUnitId = "") {
    if (targetVehicleNumber !== operatorVehicleNumber) return "";
    return entry?.id && entry.id === leadUnitId ? "lead" : "support";
  }

  async function enqueuePortoVoiceMove(state, units, channelKey, reason = "Porto eenheid handmatig naar voicekanaal verplaatst") {
    if (!channelKey) return;
    const byId = peopleById(state);
    const discordIds = [...new Set((units || [])
      .map((unit) => byId.get(unit.memberId)?.discordId || unit.discordId || "")
      .map((discordId) => String(discordId || "").trim())
      .filter(Boolean))];
    if (!discordIds.length) return;
    await enqueueDiscordSyncJob("porto_voice_move", { discordIds, channelKey, reason }, { maxAttempts: 3, runAfter: delayedDiscordJobRunAfter() }).catch(() => {});
    if (discordBot?.isConfigured?.() && typeof discordBot.moveMembersToVoice === "function") {
      discordBot.moveMembersToVoice(discordIds, channelKey, reason)
        .then((result) => logDirectDiscordResult("voice move", channelKey, result))
        .catch((error) => console.error(`[porto] Directe Discord voice move mislukt voor ${channelKey}: ${error.message}`));
    }
  }

  async function enqueuePortoDiscordNicknames(state, units, reason = "Porto roepnummer aangepast") {
    const byId = peopleById(state);
    for (const unit of uniquePortoUnits(units)) {
      const person = byId.get(unit.memberId);
      if (!person?.discordId) continue;
      await enqueueDiscordSyncJob("porto_nickname", {
        personId: person.id,
        discordId: person.discordId,
        unitId: unit.id,
        dutyRole: normalizedPortoDutyRole(unit.dutyRole),
        unitUpdatedAt: unit.updatedAt || unit.assignedAt || unit.requestedAt || "",
        reason
      }, { personId: person.id, discordId: person.discordId, runAfter: delayedDiscordJobRunAfter() }).catch(() => {});
      if (discordBot?.isConfigured?.() && typeof discordBot.syncPortoNicknameForPersonIfNeeded === "function") {
        discordBot.syncPortoNicknameForPersonIfNeeded(person, unitWithPortoNicknameContext(state, unit), reason)
          .then((result) => logDirectDiscordResult("Porto nickname", person.serviceNumber || person.name || person.id, result))
          .catch((error) => console.error(`[porto] Directe Discord Porto nickname mislukt voor ${person.serviceNumber || person.name || person.id}: ${error.message}`));
      }
    }
  }

  async function enqueueNormalDiscordNicknames(state, units, reason = "Porto dienst beeindigd") {
    const byId = peopleById(state);
    for (const unit of uniquePortoUnits(units)) {
      const person = byId.get(unit.memberId);
      if (!person?.discordId) continue;
      await enqueueDiscordSyncJob("sync_person", {
        personId: person.id,
        discordId: person.discordId,
        forceNormalNickname: true,
        endedAt: unit.endedAt || unit.updatedAt || "",
        endedUnitId: unit.id || "",
        reason
      }, { personId: person.id, discordId: person.discordId, runAfter: delayedDiscordJobRunAfter() }).catch(() => {});
      if (discordBot?.isConfigured?.() && typeof discordBot.syncNicknameForPersonIfNeeded === "function") {
        discordBot.syncNicknameForPersonIfNeeded(person, reason)
          .then((result) => logDirectDiscordResult("normale nickname", person.serviceNumber || person.name || person.id, result))
          .catch((error) => console.error(`[porto] Directe normale Discord nickname mislukt voor ${person.serviceNumber || person.name || person.id}: ${error.message}`));
      }
    }
  }

  async function enqueuePortoChannelStatus(channelKey, status, reason = "Porto kanaalstatus aangepast") {
    if (!channelKey) return;
    await enqueueDiscordSyncJob("porto_channel_status", { channelKey, status, reason }, { maxAttempts: 3, runAfter: delayedDiscordJobRunAfter() }).catch(() => {});
    if (discordBot?.isConfigured?.() && typeof discordBot.setVoiceChannelStatus === "function") {
      discordBot.setVoiceChannelStatus(channelKey, status, reason)
        .then((result) => logDirectDiscordResult("kanaalstatus", channelKey, result))
        .catch((error) => console.error(`[porto] Directe Discord kanaalstatus mislukt voor ${channelKey}: ${error.message}`));
    }
  }

  async function persistPortoDutyHoursForUnits(state, units) {
    if (typeof writePortoDutyHours !== "function") return;
    const endedUnits = uniquePortoUnits(units)
      .filter((unit) => unit?.assignedAt && (unit.active === false || unit.status === "8" || unit.endedAt));
    if (!endedUnits.length) return;
    await Promise.resolve(writePortoDutyHours(state, endedUnits, {
      timeZone: portoDutyHoursTimeZone,
      startWeek: portoDutyHoursStartWeek
    }));
  }

  async function persistPortoState(state, options = {}) {
    const units = options.units || null;
    const settings = Boolean(options.settings);
    const phonePerson = options.phonePerson || null;
    if (typeof writePortoUnits === "function" || typeof writePortoSettings === "function" || typeof writePortoPhone === "function") {
      if (settings && typeof writePortoSettings === "function") await Promise.resolve(writePortoSettings(state));
      if (phonePerson && typeof writePortoPhone === "function") await Promise.resolve(writePortoPhone(phonePerson.id, phonePerson.portoPhone || "", { k9Name: phonePerson.k9Name || "" }));
      if (units) await persistPortoDutyHoursForUnits(state, units);
      if (units && typeof writePortoUnits === "function") await Promise.resolve(writePortoUnits(units));
      return state;
    }
    await Promise.resolve(writeState(state));
    return state;
  }


  function ensureOpsUnit(state, person, nowIso = new Date().toISOString()) {
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    let unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false && entry.vehicleNumber === operatorVehicleNumber);
    if (!unit) {
      unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false && !entry.vehicleNumber);
    }
    if (!unit) {
      unit = { id: crypto.randomUUID(), memberId: person.id, linkedWith: [], active: true };
      state.portoUnits.push(unit);
    }
    Object.assign(unit, {
      name: person.name,
      rank: person.rank,
      serviceNumber: person.serviceNumber,
      phone: person.portoPhone || "",
      vehicleNumber: operatorVehicleNumber,
      vehicleCode: operatorVehicleCode,
      vehicleType: operatorVehicleType,
      vehicleName: operatorVehicleName,
      status: "1",
      statusDetail: `${operatorLabel} in dienst`,
      discordChannelKey: operatorChannelKey,
      discordChannelStatus: unit.discordChannelStatus || "",
      reviewStatus: operatorLabel.toLowerCase(),
      operatorSlot: "lead",
      assignedById: person.id,
      assignedByName: person.name,
      assignedAt: unit.assignedAt || nowIso,
      requestedAt: unit.requestedAt || nowIso,
      lastSeenAt: nowIso,
      updatedAt: nowIso,
      active: true
    });
    return unit;
  }

  function closeDuplicateOpsUnits(state, person, keepUnit, nowIso = new Date().toISOString()) {
    const closedUnits = [];
    for (const entry of state.portoUnits || []) {
      if (
        entry.id !== keepUnit.id &&
        entry.memberId === person.id &&
        entry.active !== false &&
        entry.vehicleNumber === operatorVehicleNumber
      ) {
        const previousVehicleNumber = entry.vehicleNumber;
        entry.active = false;
        entry.status = "8";
        entry.statusDetail = `Dubbele ${operatorLabel}-aanmelding gesloten`;
        entry.vehicleNumber = "";
        entry.vehicleCode = "";
        entry.vehicleType = "";
        entry.vehicleName = "";
        entry.operatorSlot = "";
        clearPortoDutyRole(entry);
        entry.linkedWith = [];
        entry.endedAt = nowIso;
        entry.updatedAt = nowIso;
        closedUnits.push({ ...entry, previousVehicleNumber });
      }
    }
    return closedUnits;
  }

  function closeDuplicateActiveUnitsForMember(state, memberId, keepUnitId = "", nowIso = new Date().toISOString()) {
    if (!memberId) return [];
    const activeUnits = (state.portoUnits || []).filter((entry) => entry.memberId === memberId && entry.active !== false);
    if (activeUnits.length <= 1) return [];
    const keepUnit = activeUnits.find((entry) => entry.id === keepUnitId) || activeUnits
      .slice()
      .reduce((best, entry) => preferredActiveUnit(best, entry), activeUnits[0]);
    const closedUnits = [];
    for (const entry of activeUnits) {
      if (entry.id === keepUnit.id) continue;
      const previousVehicleNumber = entry.vehicleNumber;
      entry.active = false;
      entry.status = "8";
      entry.statusDetail = "Dubbele Porto-aanmelding gesloten";
      entry.vehicleNumber = "";
      entry.vehicleCode = "";
      entry.vehicleType = "";
      entry.vehicleName = "";
      entry.operatorSlot = "";
      clearPortoDutyRole(entry);
      entry.linkedWith = [];
      entry.endedAt = nowIso;
      entry.updatedAt = nowIso;
      closedUnits.push({ ...entry, previousVehicleNumber });
    }
    return closedUnits;
  }

  function appendOpsLog(state, ops, endedBy, endedAt = new Date().toISOString()) {
    if (!ops) return;
    state.portoOpsLog = Array.isArray(state.portoOpsLog) ? state.portoOpsLog : [];
    const startedMs = Date.parse(ops.startedAt || "");
    const endedMs = Date.parse(endedAt);
    state.portoOpsLog.unshift({
      id: crypto.randomUUID(),
      memberId: ops.memberId || "",
      name: ops.name || "Onbekend",
      serviceNumber: ops.serviceNumber || "",
      phone: ops.phone || "",
      startedAt: ops.startedAt || "",
      endedAt,
      durationSeconds: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, Math.round((endedMs - startedMs) / 1000)) : 0,
      endedById: endedBy.id || "",
      endedByName: endedBy.name || "Onbekend"
    });
    state.portoOpsLog = state.portoOpsLog.slice(0, 250);
  }

  function memberHasOpsTraining(state, memberId) {
    const person = (state.people || []).find((entry) => entry.id === memberId);
    return canServePortoOps(person);
  }

  function canReleasePortoOps(person, currentOps) {
    return Boolean(
      currentOps &&
        person &&
        (currentOps.memberId === person.id || canOperatePortoOps(person))
    );
  }

  function unitMemberCanServeOps(state, unit) {
    const person = (state.people || []).find((entry) => entry.id === unit?.memberId);
    return canServePortoOps(person);
  }

  function assertCanAssignOpsNumber(state, units, res) {
    const invalid = (units || []).find((unit) => !unitMemberCanServeOps(state, unit));
    if (!invalid) return true;
    sendJson(res, 403, {
      error: `${invalid.name || "Deze medewerker"} heeft geen ${operatorTraining}-training en mag niet op ${operatorVehicleNumber} worden gezet.`
    });
    return false;
  }

  function releaseCurrentOps(state, currentOps, endedBy, endedAt = new Date().toISOString(), statusDetail = `${operatorLabel} neergelegd`) {
    if (!currentOps) return false;
    markRecentlyEnded(currentOps.memberId);
    if (memberHasOpsTraining(state, currentOps.memberId)) appendOpsLog(state, currentOps, endedBy, endedAt);
    state.portoCurrentOps = { ...currentOps, active: false, endedAt };
    const opsUnit = (state.portoUnits || []).find((entry) => entry.memberId === currentOps.memberId && entry.active !== false && entry.vehicleNumber === operatorVehicleNumber);
    if (opsUnit) {
      Object.assign(opsUnit, {
        status: "8",
        statusDetail,
        active: false,
        vehicleNumber: "",
        vehicleCode: "",
        vehicleType: "",
        vehicleName: "",
        operatorSlot: "",
        dutyRole: "",
        endedById: endedBy.id || "",
        endedByName: endedBy.name || "Onbekend",
        endedAt,
        updatedAt: endedAt
      });
      clearPortoBrowserHeartbeat(opsUnit);
    }
    for (const entry of state.portoUnits || []) {
      if (entry.active === false || entry.vehicleNumber !== operatorVehicleNumber || entry.memberId === currentOps.memberId) continue;
      if (entry.operatorSlot !== "lead") entry.operatorSlot = "support";
      if (entry.statusDetail === `${operatorLabel} in dienst`) entry.statusDetail = "Beschikbaar";
      entry.updatedAt = endedAt;
    }
    return true;
  }

  function releaseOpsIfEnded(state, units, endedBy, endedAt = new Date().toISOString(), statusDetail = "Uit dienst") {
    const currentOps = activePortoOps(state);
    if (!currentOps) return false;
    const endedCurrentOps = (units || []).some((entry) =>
      entry.vehicleNumber === operatorVehicleNumber &&
      entry.memberId === currentOps.memberId
    );
    return endedCurrentOps ? releaseCurrentOps(state, currentOps, endedBy, endedAt, statusDetail) : false;
  }

  async function signOffTimedOutPortoBrowsers() {
    if (!portoBrowserTimeoutMs) return;
    await enqueuePortoMutation(async () => {
      const state = await Promise.resolve(readState());
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const now = new Date();
      const nowIso = now.toISOString();
      const closeCutoffMs = portoBrowserCloseGraceMs ? now.getTime() - portoBrowserCloseGraceMs : 0;
      const hardCutoffMs = portoBrowserHardTimeoutMs ? now.getTime() - portoBrowserHardTimeoutMs : 0;
      const timedOutUnits = state.portoUnits.filter((unit) => {
        if (!unit || unit.active === false || !unit.browserHeartbeatActive) return false;
        const heartbeatMs = timestampMs(unit.browserHeartbeatAt);
        const closeMs = timestampMs(unit.browserCloseSuspectedAt);
        if (closeCutoffMs > 0 && closeMs > 0 && closeMs <= closeCutoffMs && heartbeatMs <= closeMs) return true;
        return hardCutoffMs > 0 && heartbeatMs > 0 && heartbeatMs <= hardCutoffMs;
      });
      if (!timedOutUnits.length) return;

      const actor = { id: "system", name: "Systeem" };
      const releasedVehicleNumbers = new Set(timedOutUnits.map((unit) => unit.vehicleNumber).filter(Boolean));
      const settingsChanged = releaseOpsIfEnded(state, timedOutUnits, actor, nowIso, "Uit dienst (browser gesloten)");

      for (const unit of timedOutUnits) {
        clearRecentlyEnded(unit.memberId);
        Object.assign(unit, {
          status: "8",
          statusDetail: "Uit dienst (browser gesloten)",
          active: false,
          vehicleNumber: "",
          vehicleCode: "",
          vehicleType: "",
          vehicleName: "",
          operatorSlot: "",
          dutyRole: "",
          linkedWith: [],
          endedById: actor.id,
          endedByName: actor.name,
          endedAt: nowIso,
          updatedAt: nowIso
        });
        clearPortoBrowserHeartbeat(unit);
      }

      for (const releasedVehicleNumber of releasedVehicleNumbers) syncPortoLinkedNames(state, releasedVehicleNumber);
      const remainingVehicleUnits = affectedActiveVehicleUnits(state, [...releasedVehicleNumbers]);
      await persistPortoState(state, { units: state.portoUnits, settings: settingsChanged });
      await enqueueNormalDiscordNicknames(state, timedOutUnits, "Porto browser gesloten");
      await enqueuePortoDiscordNicknames(state, remainingVehicleUnits, "Porto groep bijgewerkt");
      console.log(`[porto] Browser-timeout: ${timedOutUnits.length} unit(s) automatisch uit dienst gezet.`);
    });
  }

  function closePendingPortoRequestsForMember(state, memberId, keepUnitId = "") {
    const now = new Date().toISOString();
    for (const entry of state.portoUnits || []) {
      if (
        entry.id !== keepUnitId &&
        entry.memberId === memberId &&
        entry.active !== false &&
        String(entry.status) === "0" &&
        !entry.vehicleNumber
      ) {
        entry.active = false;
        entry.reviewStatus = "assigned-duplicate-closed";
        entry.endedAt = now;
        entry.updatedAt = now;
      }
    }
  }

  function refreshActivePortoPhoneForPerson(state, person, nowIso = new Date().toISOString()) {
    let unitsChanged = false;
    let settingsChanged = false;
    const phone = person.portoPhone || "";
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    for (const unit of state.portoUnits) {
      if (unit.memberId === person.id && unit.active !== false && unit.phone !== phone) {
        unit.phone = phone;
        unit.updatedAt = nowIso;
        unitsChanged = true;
      }
    }
    if (state.portoCurrentOps?.memberId === person.id && state.portoCurrentOps.phone !== phone) {
      state.portoCurrentOps.phone = phone;
      settingsChanged = true;
    }
    return { unitsChanged, settingsChanged };
  }

  async function maintainPortoPresence(state, person, { touch = true, recoverOpsUnit = true } = {}) {
    const changedBySweep = sweepPortoPresence(state);
    const changedByOpsEligibility = closeIneligiblePortoOpsUnits(state);
    const changedByTouch = touch ? touchPortoPresence(state, person) : false;
    let unitsChanged = changedBySweep || changedByTouch || changedByOpsEligibility;
    let settingsChanged = changedByOpsEligibility;
    const currentOps = activePortoOps(state);
    const currentOpsRecentlyEnded = currentOps && isRecentlyEnded(currentOps.memberId);
    if (currentOpsRecentlyEnded) {
      state.portoCurrentOps = { ...currentOps, active: false, endedAt: currentOps.endedAt || new Date().toISOString() };
      delete state.portoCurrentOps.recoveredFromUnit;
      settingsChanged = true;
    } else if (currentOps?.recoveredFromUnit) {
      state.portoCurrentOps = { ...currentOps };
      delete state.portoCurrentOps.recoveredFromUnit;
      settingsChanged = true;
    }
    if (recoverOpsUnit && currentOps && !currentOpsRecentlyEnded) {
      let opsUnit = (state.portoUnits || []).find((entry) => entry.memberId === currentOps.memberId && entry.active !== false && entry.vehicleNumber === operatorVehicleNumber);
      if (!opsUnit) {
        const opsPerson = (state.people || []).find((entry) => entry.id === currentOps.memberId);
        if (opsPerson) {
          opsUnit = ensureOpsUnit(state, opsPerson);
          settingsChanged = true;
          unitsChanged = true;
        }
      }
    }
    if (unitsChanged || settingsChanged) await persistPortoState(state, { units: unitsChanged ? state.portoUnits : null, settings: settingsChanged });
    return unitsChanged || settingsChanged;
  }

  async function sendPortoState(res, state, person, unit = null, extra = {}) {
    const { omitPhonebook = false, ...responseExtra } = extra;
    const payload = {
      ...responseExtra,
      unit: decoratePortoUnit(state, unit),
      profile: person,
      dutyTime: portoDutyTimePayload(state, person, unit),
      vehicleRanges: state.portoVehicleRanges,
      ...portoOpsPayload(state, person)
    };
    if (!omitPhonebook) payload.phonebook = portoPhonebookPeople(state);
    sendJson(res, 200, await attachSideTaskOverview(payload));
  }

  async function requireActivePerson(req, res) {
    const auth = requireAuth(req, res);
    if (!auth) return null;
    const state = await Promise.resolve(readState());
    const person = activePersonForAuth(state, auth);
    if (!person) {
      sendJson(res, 404, { error: "Profiel niet gevonden." });
      return null;
    }
    return { auth, state, person };
  }

  async function handlePortoApi(req, res, url) {
    if (!url.pathname.startsWith("/api/porto/")) return false;
    if (req.method !== "GET") {
      return enqueuePortoMutation(() => handlePortoApiInner(req, res, url));
    }
    return handlePortoApiInner(req, res, url);
  }

  async function handlePortoApiInner(req, res, url) {
    if (url.pathname === "/api/porto/profile" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const body = await readBody(req);
      const previousK9Name = String(person.k9Name || "").trim();
      person.portoPhone = String(body.portoPhone || "").trim().slice(0, 40);
      if (personHasK9Training(person)) {
        person.k9Name = String(body.k9Name || "").trim().slice(0, 40);
      } else {
        person.k9Name = "";
      }
      const { unitsChanged, settingsChanged } = refreshActivePortoPhoneForPerson(state, person);
      await persistPortoState(state, {
        phonePerson: person,
        units: unitsChanged ? state.portoUnits : null,
        settings: settingsChanged
      });
      const recentlyEnded = isRecentlyEnded(person.id);
      const unit = recentlyEnded ? null : state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      if (unit && normalizedPortoDutyRole(unit.dutyRole) === "K9" && previousK9Name !== String(person.k9Name || "").trim()) {
        enqueuePortoDiscordNicknames(state, [unit], "K9-naam bijgewerkt")
          .catch((error) => console.error(`[porto] Discord nickname queue voor K9-naam mislukt: ${error.message}`));
      }
      await sendPortoState(res, state, person, unit, recentlyEnded ? { recentlyEnded: true } : {});
      return true;
    }

    if (url.pathname === "/api/porto/heartbeat" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      if (isRecentlyEnded(person.id)) {
        sendJson(res, 200, { ok: true, active: false, recentlyEnded: true });
        return true;
      }
      const unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      if (!unit) {
        sendJson(res, 200, { ok: true, active: false });
        return true;
      }
      const heartbeatChanged = markPortoBrowserHeartbeat(unit);
      if (heartbeatChanged) await persistPortoState(state, { units: state.portoUnits });
      sendJson(res, 200, { ok: true, active: true, unitId: unit.id, persisted: heartbeatChanged });
      return true;
    }

    if (url.pathname === "/api/porto/browser-closed" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      if (isRecentlyEnded(person.id)) {
        sendJson(res, 200, { ok: true, active: false, recentlyEnded: true });
        return true;
      }
      const unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      if (!unit) {
        sendJson(res, 200, { ok: true, active: false });
        return true;
      }
      markPortoBrowserClosed(unit);
      await persistPortoState(state, { units: state.portoUnits });
      sendJson(res, 200, { ok: true, active: true, unitId: unit.id, browserClosePending: true });
      return true;
    }

    if (url.pathname === "/api/porto/status" && req.method === "GET") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const rangesChanged = ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const skipPresenceMaintain = isRecentlyEnded(person.id);
      if (!skipPresenceMaintain) await maintainPortoPresence(state, person, { touch: false, recoverOpsUnit: false });
      if (rangesChanged) await persistPortoState(state, { units: state.portoUnits, settings: true });
      const unit = skipPresenceMaintain ? null : state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      const omitPhonebook = url.searchParams.get("phonebook") === "0";
      await sendPortoState(res, state, person, unit, {
        ...(skipPresenceMaintain ? { recentlyEnded: true } : {}),
        omitPhonebook
      });
      return true;
    }

    if (url.pathname === "/api/porto/status" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const body = await readBody(req);
      const status = String(body.status || "").trim();
      const allowedStatuses = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
      if (!allowedStatuses.has(status)) {
        sendJson(res, 400, { error: "Ongeldige Porto status." });
        return true;
      }
      const rawStatus4Detail = status === "4" ? String(body.detail || "").trim() : "";
      if (rawStatus4Detail && !status4Reasons.has(rawStatus4Detail)) {
        sendJson(res, 400, { error: "Ongeldige Status 4 reden." });
        return true;
      }
      const detail = status === "4" ? (rawStatus4Detail || "Niet beschikbaar") : "";
      const requestNote = status === "0" ? String(body.requestNote || "").trim().slice(0, 240) : "";
      const manualStatusChange = body.manualStatusChange === true;
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const now = new Date().toISOString();
      sweepPortoPresence(state);
      const changedByOpsEligibility = closeIneligiblePortoOpsUnits(state, now);
      let unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false);
      const recentlyEnded = isRecentlyEnded(person.id);
      if (recentlyEnded && status === "0" && !manualStatusChange) {
        if (changedByOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        await sendPortoState(res, state, person, null, { recentlyEnded: true });
        return true;
      }
      if (recentlyEnded && !["0", "8"].includes(status)) {
        if (changedByOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        sendJson(res, 409, recentlyEndedError());
        return true;
      }
      if (!unit && status === "8") {
        markRecentlyEnded(person.id);
        if (changedByOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        await sendPortoState(res, state, person, null, { recentlyEnded: true });
        return true;
      }
      if (!unit && status !== "0") {
        if (changedByOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        sendJson(res, 409, { error: `Je moet eerst Status 0 doen voordat ${operatorLabel} je kan indelen.` });
        return true;
      }
      if (unit && unit.vehicleNumber && status === "0") {
        await sendPortoState(res, state, person, unit);
        return true;
      }
      if (unit && !unit.vehicleNumber && !["0", "8"].includes(status)) {
        sendJson(res, 409, { error: `Wacht op ${operatorLabel}-indeling voordat je deze status gebruikt.` });
        return true;
      }
      if (!unit) {
        unit = { id: crypto.randomUUID(), memberId: person.id, linkedWith: [], reviewStatus: "pending", requestedAt: now, active: true };
        state.portoUnits.push(unit);
      }
      const assignedGroupStatus = Boolean(unit.vehicleNumber && !["0", "8"].includes(status));
      const group = assignedGroupStatus
        ? state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === unit.vehicleNumber)
        : [unit];
      const statusDetail = status === "0" ? `Aangemeld bij ${operatorLabel}` : detail;
      Object.assign(unit, {
        name: person.name,
        rank: person.rank,
        serviceNumber: person.serviceNumber,
        phone: person.portoPhone || "",
        lastSeenAt: now,
        updatedAt: now
      });
      for (const entry of group) {
        entry.status = status;
        entry.statusDetail = statusDetail;
        entry.updatedAt = now;
      }
      delete unit.autoOffline;
      delete unit.autoOfflineAt;
      delete unit.autoRemoveAt;
      let settingsChanged = changedByOpsEligibility;
      if (status === "0") {
        clearRecentlyEnded(person.id);
        unit.reviewStatus = "pending";
        unit.requestedAt = unit.requestedAt || now;
        unit.requestNote = requestNote;
        markPortoBrowserHeartbeat(unit, now);
      }
      let endedUnitsForNickname = [];
      let duplicateUnitsClosed = [];
      let unitsNeedingPortoSync = [];
      if (status === "8") {
        const personKey = portoMemberKey(person.id);
        const endedUnits = state.portoUnits.filter((entry) => (
          portoMemberKey(entry.memberId) === personKey && entry.active !== false
        ));
        if (!endedUnits.some((entry) => entry.id === unit.id)) endedUnits.push(unit);
        endedUnitsForNickname = endedUnits;
        const releasedVehicleNumbers = new Set(endedUnits.map((entry) => entry.vehicleNumber).filter(Boolean));
        markRecentlyEndedUnits(endedUnits);
        const opsReleased = releaseOpsIfEnded(state, endedUnits, person, now, "Uit dienst");
        settingsChanged = settingsChanged || opsReleased;
        for (const endedUnit of endedUnits) {
          Object.assign(endedUnit, {
            status: "8",
            statusDetail: "Uit dienst",
            active: false,
            dutyRole: "",
            endedAt: now,
            updatedAt: now
          });
          clearPortoBrowserHeartbeat(endedUnit);
        }
        for (const releasedVehicleNumber of releasedVehicleNumbers) syncPortoLinkedNames(state, releasedVehicleNumber);
        unitsNeedingPortoSync = affectedActiveVehicleUnits(state, [...releasedVehicleNumbers]);
      } else {
        markPortoBrowserHeartbeat(unit, now);
        duplicateUnitsClosed = closeDuplicateActiveUnitsForMember(state, person.id, unit.id, now);
        const affectedVehicleNumbers = [unit.vehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)];
        unitsNeedingPortoSync = assignedGroupStatus
          ? affectedActiveVehicleUnits(state, affectedVehicleNumbers, group)
          : affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
      }
      await persistPortoState(state, { units: state.portoUnits, settings: settingsChanged });
      if (status === "8") {
        await enqueueNormalDiscordNicknames(state, endedUnitsForNickname);
        await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto groep bijgewerkt");
      } else {
        await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
        await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto status aangepast");
      }
      await sendPortoState(res, state, person, status === "8" ? null : unit, status === "8" ? { recentlyEnded: true } : {});
      return true;
    }

    if (url.pathname === "/api/porto/dev-bypass" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      if (!canUsePortoDevBypass(person)) {
        sendJson(res, 403, { error: "Dev bypass is alleen beschikbaar voor het dev-profiel." });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const now = new Date().toISOString();
      sweepPortoPresence(state);
      let unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false);
      if (!unit) {
        unit = { id: crypto.randomUUID(), memberId: person.id, linkedWith: [], requestedAt: now, active: true };
        state.portoUnits.push(unit);
      }
      const previousVehicleNumber = unit.vehicleNumber || "";
      const reusableVehicleNumber = previousVehicleNumber && previousVehicleNumber !== operatorVehicleNumber ? previousVehicleNumber : "";
      const vehicleNumber = reusableVehicleNumber || firstAvailableRegularVehicleNumber(state);
      if (!vehicleNumber) {
        sendJson(res, 409, { error: "Geen vrij regulier 30-nummer beschikbaar." });
        return true;
      }
      const range = vehicleRangeForNumber(state, vehicleNumber);
      Object.assign(unit, {
        name: person.name,
        rank: person.rank,
        serviceNumber: person.serviceNumber,
        phone: person.portoPhone || "",
        vehicleNumber,
        vehicleType: range?.vehicleType || "Noodhulp",
        reviewStatus: "dev-bypass",
        assignedById: person.id,
        assignedByName: "Dev bypass",
        assignedAt: unit.assignedAt || now,
        status: "1",
        statusDetail: "Beschikbaar",
        lastSeenAt: now,
        updatedAt: now
      });
      syncPortoLinkedNames(state, vehicleNumber);
      if (previousVehicleNumber && previousVehicleNumber !== vehicleNumber) syncPortoLinkedNames(state, previousVehicleNumber);
      const duplicateUnitsClosed = closeDuplicateActiveUnitsForMember(state, person.id, unit.id, now);
      for (const duplicateVehicleNumber of vehicleNumbersFromUnits(duplicateUnitsClosed)) {
        syncPortoLinkedNames(state, duplicateVehicleNumber);
      }
      const affectedVehicleNumbers = [vehicleNumber, previousVehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)].filter(Boolean);
      const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
      await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto automatische indeling actief");
      await sendPortoState(res, state, person, unit);
      return true;
    }

    if (url.pathname === "/api/porto/management-bypass" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      if (!canUsePortoManagementBypass(person)) {
        sendJson(res, 403, { error: `Alleen ${managementLabel} mag deze bypass gebruiken.` });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const now = new Date().toISOString();
      sweepPortoPresence(state);
      let unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false);
      if (!unit) {
        unit = { id: crypto.randomUUID(), memberId: person.id, linkedWith: [], requestedAt: now, active: true };
        state.portoUnits.push(unit);
      }
      const previousVehicleNumber = unit.vehicleNumber || "";
      const reusableVehicleNumber = previousVehicleNumber && previousVehicleNumber !== operatorVehicleNumber ? previousVehicleNumber : "";
      const vehicleNumber = reusableVehicleNumber || firstAvailableRegularVehicleNumber(state);
      if (!vehicleNumber) {
        sendJson(res, 409, { error: "Geen vrij regulier 30-nummer beschikbaar." });
        return true;
      }
      const range = vehicleRangeForNumber(state, vehicleNumber);
      Object.assign(unit, {
        name: person.name,
        rank: person.rank,
        serviceNumber: person.serviceNumber,
        phone: person.portoPhone || "",
        vehicleNumber,
        vehicleType: range?.vehicleType || "Dienst",
        reviewStatus: "management-bypass",
        assignedById: person.id,
        assignedByName: managementBypassLabel,
        assignedAt: unit.assignedAt || now,
        status: "1",
        statusDetail: "Beschikbaar",
        lastSeenAt: now,
        updatedAt: now
      });
      markPortoBrowserHeartbeat(unit, now);
      syncPortoLinkedNames(state, vehicleNumber);
      if (previousVehicleNumber && previousVehicleNumber !== vehicleNumber) syncPortoLinkedNames(state, previousVehicleNumber);
      const duplicateUnitsClosed = closeDuplicateActiveUnitsForMember(state, person.id, unit.id, now);
      for (const duplicateVehicleNumber of vehicleNumbersFromUnits(duplicateUnitsClosed)) {
        syncPortoLinkedNames(state, duplicateVehicleNumber);
      }
      const affectedVehicleNumbers = [vehicleNumber, previousVehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)].filter(Boolean);
      const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
      await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto leiding-bypass actief");
      await sendPortoState(res, state, person, unit);
      return true;
    }

    if (url.pathname === "/api/porto/auto-assign" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      sweepPortoPresence(state);
      if (isRecentlyEnded(person.id)) {
        sendJson(res, 409, recentlyEndedError());
        return true;
      }
      const unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false);
      if (!unit || String(unit.status) !== "0") {
        sendJson(res, 409, { error: "Je hebt geen open Status 0-aanmelding." });
        return true;
      }
      if (unit.vehicleNumber) {
        await sendPortoState(res, state, person, unit);
        return true;
      }
      const secondsWaiting = pendingSeconds(unit, nowMs);
      const waitSeconds = Math.ceil((pendingAutoAssignMs / 1000) - secondsWaiting);
      if (waitSeconds > 0) {
        sendJson(res, 409, {
          error: `Automatisch aanmelden kan na ${pendingAutoAssignMs / 1000} seconden. Wacht nog ${waitSeconds} seconden.`,
          waitSeconds
        });
        return true;
      }
      const vehicleNumber = firstAvailableRegularVehicleNumber(state);
      if (!vehicleNumber) {
        sendJson(res, 409, { error: "Geen vrij roepnummer beschikbaar." });
        return true;
      }
      const range = vehicleRangeForNumber(state, vehicleNumber);
      Object.assign(unit, {
        name: person.name,
        rank: person.rank,
        serviceNumber: person.serviceNumber,
        phone: person.portoPhone || "",
        vehicleNumber,
        vehicleType: range?.vehicleType || "Dienst",
        reviewStatus: "auto-assigned",
        assignedById: "",
        assignedByName: "Automatische aanmelding",
        assignedAt: now,
        status: "1",
        statusDetail: "Beschikbaar",
        lastSeenAt: now,
        updatedAt: now
      });
      markPortoBrowserHeartbeat(unit, now);
      syncPortoLinkedNames(state, vehicleNumber);
      const duplicateUnitsClosed = closeDuplicateActiveUnitsForMember(state, person.id, unit.id, now);
      for (const duplicateVehicleNumber of vehicleNumbersFromUnits(duplicateUnitsClosed)) {
        syncPortoLinkedNames(state, duplicateVehicleNumber);
      }
      const affectedVehicleNumbers = [vehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)];
      const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
      await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto automatische indeling actief");
      await sendPortoState(res, state, person, unit);
      return true;
    }

    if (url.pathname === "/api/porto/duty-role" && req.method === "POST") {
      try {
        if (!dutyRoleDefinitions.length) {
          sendJson(res, 404, { error: "Dienstrollen zijn niet beschikbaar voor deze organisatie." });
          return true;
        }
        const context = await requireActivePerson(req, res);
        if (!context) return true;
        const { state, person } = context;
        ensurePortoVehicleRanges(state);
        state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
        const body = await readBody(req);
        const dutyRole = normalizedPortoDutyRole(body.dutyRole);
        if (String(body.dutyRole || "").trim() && !dutyRole) {
          sendJson(res, 400, { error: "Ongeldige dienstrol." });
          return true;
        }
        if (dutyRole && !canPersonUsePortoDutyRole(person, dutyRole)) {
          const role = dutyRoleDefinitions.find((entry) => entry.key === dutyRole);
          sendJson(res, 403, { error: role?.requiresManagementBypass ? `Alleen ${managementLabel} mag Burgerdienst gebruiken.` : `Je hebt ${role?.label || dutyRole} niet op je profiel.` });
          return true;
        }
        const role = dutyRoleDefinitions.find((entry) => entry.key === dutyRole);
        if (role?.requiresK9Name && !String(person.k9Name || "").trim()) {
          sendJson(res, 400, { error: "Vul eerst je K9-Naam in op je Porto-profiel." });
          return true;
        }
        const unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false && entry.vehicleNumber);
        if (!unit) {
          sendJson(res, 409, { error: "Je hebt eerst een actief porto-roepnummer nodig." });
          return true;
        }
        const now = new Date().toISOString();
        const changedUnits = new Map();
        if (dutyRole && !role?.allowMultiple) {
          for (const entry of state.portoUnits) {
            if (entry.id === unit.id || entry.active === false) continue;
            if (normalizedPortoDutyRole(entry.dutyRole) !== dutyRole) continue;
            entry.dutyRole = "";
            entry.updatedAt = now;
            changedUnits.set(entry.id, entry);
          }
        }
        unit.dutyRole = dutyRole;
        unit.updatedAt = now;
        changedUnits.set(unit.id, unit);
        await persistPortoState(state, { units: state.portoUnits });
        enqueuePortoDiscordNicknames(state, [...changedUnits.values()], dutyRole ? `${dutyRole} porto dienstrol aangenomen` : "Porto dienstrol neergelegd")
          .catch((error) => console.error(`[porto] Discord nickname queue voor dienstrol mislukt: ${error.message}`));
        await sendPortoState(res, state, person, unit);
      } catch (error) {
        console.error(`[porto] Dienstrol bijwerken mislukt: ${error.stack || error.message}`);
        sendJson(res, 500, { error: "Dienstrol kon niet worden opgeslagen. Controleer de porto logs voor details." });
      }
      return true;
    }

    if (url.pathname === "/api/porto/dev-test" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      if (!canUsePortoDevBypass(person)) {
        sendJson(res, 403, { error: "Dev test is alleen beschikbaar voor het dev-profiel." });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      sweepPortoPresence(state);
      const activeMemberIds = new Set(state.portoUnits.filter((unit) => unit.active !== false).map((unit) => unit.memberId));
      const candidates = (state.people || []).filter((entry) => isCurrentPerson(entry) && entry.id !== person.id && !activeMemberIds.has(entry.id));
      if (!candidates.length) {
        sendJson(res, 409, { error: "Geen actieve medewerkers beschikbaar voor een testaanmelding." });
        return true;
      }
      const picked = candidates[Math.floor(Math.random() * candidates.length)];
      const now = new Date().toISOString();
      state.portoUnits.push({
        id: crypto.randomUUID(),
        memberId: picked.id,
        name: picked.name,
        rank: picked.rank,
        serviceNumber: picked.serviceNumber,
        phone: picked.portoPhone || "",
        status: "0",
        statusDetail: `Aangemeld bij ${operatorLabel}`,
        linkedWith: [],
        reviewStatus: "dev-test",
        requestedAt: now,
        updatedAt: now,
        active: true,
        createdById: person.id,
        createdByName: person.name
      });
      await persistPortoState(state, { units: state.portoUnits });
      await sendPortoState(res, state, person, null, { devTestPerson: { id: picked.id, name: picked.name } });
      return true;
    }

    if (url.pathname === "/api/porto/vehicle" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const body = await readBody(req);
      const vehicleName = String(body.vehicleName || "").trim();
      const unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false && entry.vehicleNumber);
      if (!unit) {
        sendJson(res, 409, { error: `Je bent nog niet ingedeeld door ${operatorLabel}.` });
        return true;
      }
      const range = vehicleRangeForNumber(state, unit.vehicleNumber);
      if (!range || !(range.vehicles || []).includes(vehicleName)) {
        sendJson(res, 400, { error: "Kies een voertuig dat binnen jouw roepnummerreeks valt." });
        return true;
      }
      const now = new Date().toISOString();
      const vehicleDetails = vehicleDetailsForSelection(range, vehicleName);
      touchPortoPresence(state, person, new Date(now));
      for (const entry of state.portoUnits || []) {
        if (entry.active !== false && entry.vehicleNumber === unit.vehicleNumber) {
          entry.vehicleCode = vehicleDetails.vehicleCode;
          entry.vehicleType = vehicleDetails.vehicleType;
          entry.vehicleName = vehicleName;
          entry.updatedAt = now;
        }
      }
      await persistPortoState(state, { units: state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === unit.vehicleNumber) });
      await sendPortoState(res, state, person, state.portoUnits.find((entry) => entry.id === unit.id));
      return true;
    }

    if (url.pathname === "/api/porto/ops" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const body = await readBody(req);
      const action = String(body.action || "claim").trim();
      const cleanedOpsEligibility = closeIneligiblePortoOpsUnits(state);
      const currentOps = activePortoOps(state);
      if (action === "claim") {
        if (!canServePortoOps(person)) {
          if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
          sendJson(res, 403, { error: `Alleen medewerkers met ${operatorTraining}-training mogen ${operatorLabel} oppakken.` });
          return true;
        }
        if (currentOps && currentOps.memberId !== person.id) {
          if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
          sendJson(res, 409, { error: `${operatorLabel} is al in dienst: ${currentOps.name}.` });
          return true;
        }
        const nowIso = new Date().toISOString();
        clearRecentlyEnded(person.id);
        state.portoCurrentOps = { memberId: person.id, name: person.name, serviceNumber: person.serviceNumber, phone: person.portoPhone || "", startedAt: currentOps?.startedAt || nowIso, active: true };
        const unit = ensureOpsUnit(state, person, nowIso);
        const duplicateOpsUnitsClosed = closeDuplicateOpsUnits(state, person, unit, nowIso);
        const duplicateUnitsClosed = [
          ...duplicateOpsUnitsClosed,
          ...closeDuplicateActiveUnitsForMember(state, person.id, unit.id, nowIso)
        ];
        const affectedVehicleNumbers = [operatorVehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)];
        for (const vehicleNumber of affectedVehicleNumbers) syncPortoLinkedNames(state, vehicleNumber);
        const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
        await persistPortoState(state, { settings: true, units: state.portoUnits });
        await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, `Dubbele ${operatorLabel}-aanmelding gesloten`);
        await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, `${operatorLabel} roepnummer actief`);
        await sendPortoState(res, state, person, unit);
        return true;
      }
      if (action === "release") {
        if (!currentOps && cleanedOpsEligibility) {
          await persistPortoState(state, { settings: true, units: state.portoUnits });
          await sendPortoState(res, state, person, null);
          return true;
        }
        if (!canReleasePortoOps(person, currentOps)) {
          sendJson(res, 403, { error: `Alleen de huidige ${operatorLabel}, ${operatorLabel}-beheer of leiding kan ${operatorLabel} afsluiten.` });
          return true;
        }
        const endedAt = new Date().toISOString();
        const opsUnit = state.portoUnits.find((entry) => entry.memberId === currentOps.memberId && entry.active !== false && entry.vehicleNumber === operatorVehicleNumber);
        releaseCurrentOps(state, currentOps, person, endedAt, `${operatorLabel} neergelegd`);
        syncPortoLinkedNames(state, operatorVehicleNumber);
        const remainingOperatorUnits = activeUnitsForVehicle(state, operatorVehicleNumber);
        await persistPortoState(state, { settings: true, units: state.portoUnits });
        if (opsUnit) await enqueueNormalDiscordNicknames(state, [opsUnit], `${operatorLabel} dienst beeindigd`);
        await enqueuePortoDiscordNicknames(state, remainingOperatorUnits, `${operatorLabel} groep bijgewerkt`);
        await sendPortoState(res, state, person, null);
        return true;
      }
      sendJson(res, 400, { error: `Ongeldige ${operatorLabel} actie.` });
      return true;
    }

    if (url.pathname === "/api/porto/ops/close" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/porto/reassign" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      if (!canOperatePortoOps(person)) {
        sendJson(res, 403, { error: `Alleen ${operatorLabel}, operationele leiding of ${managementLabel} mag eenheden aanpassen.` });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const cleanedOpsEligibility = closeIneligiblePortoOpsUnits(state);
      const body = await readBody(req);
      const unitId = String(body.unitId || "").trim();
      let vehiclePrefix = String(body.vehiclePrefix || "").trim();
      const selectedVehicleName = String(body.vehicleName || "").trim();
      const linkToVehicleNumber = String(body.linkToVehicleNumber || "").trim();
      const exactVehicleNumber = String(body.vehicleNumber || "").trim();
      const discordChannelKey = String(body.discordChannelKey || "").trim();
      const hasDiscordChannelStatus = Object.prototype.hasOwnProperty.call(body, "discordChannelStatus");
      const discordChannelStatus = String(body.discordChannelStatus || "").trim().slice(0, 120);
      const newStatus = String(body.status || "").trim();
      const newStatusDetail = String(body.statusDetail || "").trim();
      const offDuty = Boolean(body.offDuty);
      const unlink = Boolean(body.unlink);
      const offDutyScope = String(body.offDutyScope || "vehicle").trim();
      const unit = state.portoUnits.find((entry) => entry.id === unitId && entry.active !== false && entry.vehicleNumber)
        || (offDuty && exactVehicleNumber ? state.portoUnits.find((entry) => entry.active !== false && entry.vehicleNumber === exactVehicleNumber) : null);
      if (!unit) {
        if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        sendJson(res, 404, { error: "Actieve eenheid niet gevonden." });
        return true;
      }
      if (!offDuty) clearRecentlyEnded(unit.memberId);
      const selectedVehicleRange = selectedVehicleName
        ? (state.portoVehicleRanges || []).find((candidate) => (candidate.vehicles || []).includes(selectedVehicleName))
        : null;
      if (selectedVehicleName && !selectedVehicleRange) {
        sendJson(res, 400, { error: "Kies een geldig voertuig." });
        return true;
      }
      if (selectedVehicleRange && !vehiclePrefix) vehiclePrefix = selectedVehicleRange.prefix;
      if (unlink) {
        const oldVehicleNumber = unit.vehicleNumber;
        const currentRange = vehicleRangeForNumber(state, oldVehicleNumber);
        if (!currentRange) {
          sendJson(res, 400, { error: "Geen voertuigreeks gevonden voor dit roepnummer." });
          return true;
        }
        const vehicleNumber = firstAvailableRegularVehicleNumber(state);
        if (!vehicleNumber) {
          sendJson(res, 409, { error: "Geen vrij roepnummer beschikbaar om deze persoon los te koppelen." });
          return true;
        }
        const targetRange = vehicleRangeForNumber(state, vehicleNumber) || currentRange;
        const now = new Date().toISOString();
        Object.assign(unit, {
          vehicleNumber,
          vehicleCode: targetRange.vehicleCode,
          vehicleType: targetRange.vehicleType,
          vehicleName: "",
          operatorSlot: "",
          forceCloseDuplicateMemberUnits: true,
          linkedWith: [],
          reviewStatus: "unlinked",
          assignedById: person.id,
          assignedByName: person.name,
          assignedAt: unit.assignedAt || now,
          updatedAt: now
        });
        const duplicateUnitsClosed = closeDuplicateActiveUnitsForMember(state, unit.memberId, unit.id, now);
        const affectedVehicleNumbers = [oldVehicleNumber, vehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)];
        syncPortoLinkedNames(state, oldVehicleNumber);
        syncPortoLinkedNames(state, vehicleNumber);
        for (const duplicateVehicleNumber of vehicleNumbersFromUnits(duplicateUnitsClosed)) {
          syncPortoLinkedNames(state, duplicateVehicleNumber);
        }
        const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
        await persistPortoState(state, { units: state.portoUnits });
        delete unit.forceCloseDuplicateMemberUnits;
        await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
        await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto losgekoppeld");
        await sendPortoState(res, state, person, unit);
        return true;
      }

      if (offDuty) {
        const oldVehicleNumber = exactVehicleNumber || unit.vehicleNumber;
        const endedAt = new Date().toISOString();
        const unitsToEnd = collectPortoOffDutyUnits(state, { unit, oldVehicleNumber, offDutyScope, operatorVehicleNumber });
        markRecentlyEndedUnits(unitsToEnd);
        const settingsChanged = releaseOpsIfEnded(state, unitsToEnd, person, endedAt, "Uit dienst");
        unitsToEnd.forEach((entry) => Object.assign(entry, {
          status: "8",
          statusDetail: "Uit dienst",
          active: false,
          vehicleNumber: "",
          vehicleCode: "",
          vehicleType: "",
          vehicleName: "",
          operatorSlot: "",
          dutyRole: "",
          linkedWith: [],
          endedById: person.id,
          endedByName: person.name,
          endedAt,
          updatedAt: endedAt
        }));
        unitsToEnd.forEach(clearPortoBrowserHeartbeat);
        syncPortoLinkedNames(state, oldVehicleNumber);
        const remainingVehicleUnits = affectedActiveVehicleUnits(state, [oldVehicleNumber]);
        await persistPortoState(state, { units: state.portoUnits, settings: settingsChanged });
        await enqueueNormalDiscordNicknames(state, unitsToEnd);
        await enqueuePortoDiscordNicknames(state, remainingVehicleUnits, "Porto groep bijgewerkt");
        const endedCurrentPerson = unitsToEnd.some((entry) => entry.memberId === person.id);
        const responseUnit = endedCurrentPerson ? null : state.portoUnits.find((entry) => entry.id === unit.id && entry.active !== false) || null;
        await sendPortoState(res, state, person, responseUnit, endedCurrentPerson ? { recentlyEnded: true } : {});
        return true;
      }
      if (discordChannelKey || hasDiscordChannelStatus) {
        const validChannelKeys = configuredPortoChannelKeys();
        const key = discordChannelKey || String(unit.discordChannelKey || "").trim();
        if (!key) {
          sendJson(res, 400, { error: "Kies eerst een Porto Discord-kanaal." });
          return true;
        }
        if (!validChannelKeys.has(key)) {
          sendJson(res, 400, { error: "Kies een geldig Porto Discord-kanaal." });
          return true;
        }
        const group = state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === unit.vehicleNumber);
        const statusTargets = hasDiscordChannelStatus
          ? state.portoUnits.filter((entry) => entry.active !== false && String(entry.discordChannelKey || "").trim() === key)
          : group;
        const entriesToUpdate = statusTargets.length ? statusTargets : group;
        const now = new Date().toISOString();
        if (hasDiscordChannelStatus) {
          for (const entry of entriesToUpdate) {
            if (!entry.discordChannelKey) entry.discordChannelKey = key;
            entry.discordChannelStatus = discordChannelStatus;
            entry.updatedAt = now;
            entry.discordChannelUpdatedById = person.id;
            entry.discordChannelUpdatedByName = person.name;
          }
          await persistPortoState(state, { units: entriesToUpdate });
          await enqueuePortoChannelStatus(key, discordChannelStatus);
          await enqueuePortoDiscordNicknames(state, entriesToUpdate, "Porto kanaalstatus aangepast");
        } else {
          const previousChannelKeys = new Set(group.map((entry) => String(entry.discordChannelKey || "").trim()).filter(Boolean));
          const carriedChannelStatus = group.map((entry) => String(entry.discordChannelStatus || "").trim()).find(Boolean) || "";
          const targetEntries = state.portoUnits.filter((entry) => entry.active !== false && String(entry.discordChannelKey || "").trim() === key && !group.includes(entry));
          for (const entry of group) {
            entry.discordChannelKey = key;
            if (carriedChannelStatus) entry.discordChannelStatus = carriedChannelStatus;
            entry.updatedAt = now;
            entry.discordChannelUpdatedById = person.id;
            entry.discordChannelUpdatedByName = person.name;
          }
          if (carriedChannelStatus) {
            for (const entry of targetEntries) {
              entry.discordChannelStatus = carriedChannelStatus;
              entry.updatedAt = now;
              entry.discordChannelUpdatedById = person.id;
              entry.discordChannelUpdatedByName = person.name;
            }
          }
          await persistPortoState(state, { units: [...new Set([...group, ...targetEntries])] });
          await enqueuePortoVoiceMove(state, group, key, `Porto kanaal handmatig gezet door ${person.name || operatorLabel}`);
          await enqueuePortoDiscordNicknames(state, group, "Porto kanaal aangepast");
          if (carriedChannelStatus) await enqueuePortoChannelStatus(key, carriedChannelStatus);
          for (const previousKey of previousChannelKeys) {
            if (previousKey !== key && !state.portoUnits.some((entry) => entry.active !== false && String(entry.discordChannelKey || "").trim() === previousKey)) {
              await enqueuePortoChannelStatus(previousKey, "", "Porto kanaal leeggemaakt");
            }
          }
        }
        await sendPortoState(res, state, person, unit);
        return true;
      }
      if (newStatus) {
        const allowedStatuses = new Set(["1", "2", "3", "4", "5", "6", "7"]);
        if (!allowedStatuses.has(newStatus)) {
          sendJson(res, 400, { error: "Kies een geldige status." });
          return true;
        }
        if (newStatus === "4" && newStatusDetail && !status4Reasons.has(newStatusDetail)) {
          sendJson(res, 400, { error: "Kies een geldige Status 4 reden." });
          return true;
        }
        const statusDefinition = { "1": "Beschikbaar", "2": "Aanrijdend", "3": "Ter plaatse", "4": "Niet beschikbaar", "5": "Transport aanvraag", "6": "Spraak aanvraag", "7": "Spraak aanvraag urgent" };
        const now = new Date().toISOString();
        const group = state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === unit.vehicleNumber);
        for (const entry of group) {
          entry.status = newStatus;
          entry.statusDetail = newStatus === "4" ? (newStatusDetail || "Niet beschikbaar") : statusDefinition[newStatus];
          entry.updatedAt = now;
          entry.statusUpdatedById = person.id;
          entry.statusUpdatedByName = person.name;
        }
        await persistPortoState(state, { units: state.portoUnits });
        await enqueuePortoDiscordNicknames(state, group, "Porto status aangepast");
        await sendPortoState(res, state, person, unit);
        return true;
      }

      const oldVehicleNumber = unit.vehicleNumber;
      const currentVehicleGroup = state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === oldVehicleNumber);
      let vehicleNumber = "";
      let range = null;
      let targetDiscordChannelKey = unit.discordChannelKey || "";
      if (exactVehicleNumber) {
        if (exactVehicleNumber === unit.vehicleNumber && !selectedVehicleName) {
          await sendPortoState(res, state, person, unit);
          return true;
        }
        range = vehicleRangeForNumber(state, exactVehicleNumber);
        if (!range) {
          sendJson(res, 400, { error: "Kies een geldig roepnummer." });
          return true;
        }
        const exactInUse = state.portoUnits.some((entry) => entry.active !== false && entry.vehicleNumber !== oldVehicleNumber && entry.vehicleNumber === exactVehicleNumber);
        if (exactInUse) {
          sendJson(res, 409, { error: "Dit roepnummer is al in gebruik." });
          return true;
        }
        vehicleNumber = exactVehicleNumber;
        unit.vehicleName = selectedVehicleName || "";
        unit.reviewStatus = selectedVehicleName ? "vehicle-changed" : "number-changed";
      } else if (linkToVehicleNumber) {
        if (linkToVehicleNumber === unit.vehicleNumber) {
          await sendPortoState(res, state, person, unit);
          return true;
        }
        const linkedGroup = state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === linkToVehicleNumber);
        if (!linkedGroup.length) {
          sendJson(res, 404, { error: "Koppelvoertuig niet gevonden." });
          return true;
        }
        if (linkedGroup.length >= 3) {
          sendJson(res, 409, { error: "Deze eenheid heeft al maximaal 3 personen." });
          return true;
        }
        vehicleNumber = linkToVehicleNumber;
        range = vehicleRangeForNumber(state, vehicleNumber);
        unit.vehicleName = linkedGroup[0]?.vehicleName || "";
        targetDiscordChannelKey = linkedGroup[0]?.discordChannelKey || "";
        unit.reviewStatus = "linked";
      } else {
        vehicleNumber = firstAvailableVehicleNumber(state, vehiclePrefix);
        if (!vehicleNumber) {
          sendJson(res, 409, { error: "Geen vrij voertuignummer beschikbaar in deze categorie." });
          return true;
        }
        range = vehicleRangeForNumber(state, vehicleNumber);
        unit.vehicleName = "";
        unit.reviewStatus = "reassigned";
      }
      if (!range) {
        sendJson(res, 400, { error: "Kies een geldige voertuigcategorie of koppeling." });
        return true;
      }
      if (selectedVehicleName && !(range.vehicles || []).includes(selectedVehicleName)) {
        sendJson(res, 400, { error: "Dit voertuig hoort niet bij dit roepnummer." });
        return true;
      }
      const now = new Date().toISOString();
      const unitsToMove = linkToVehicleNumber ? [unit] : (currentVehicleGroup.length ? currentVehicleGroup : [unit]);
      const duplicateUnitsClosed = [];
      const operatorLeadUnitId = vehicleNumber === operatorVehicleNumber && !linkToVehicleNumber ? unit.id : "";
      if (operatorLeadUnitId && !assertCanAssignOpsNumber(state, [unit], res)) return true;
      const vehicleDetails = selectedVehicleName
        ? vehicleDetailsForSelection(range, selectedVehicleName)
        : { vehicleCode: range.vehicleCode, vehicleType: range.vehicleType };
      unitsToMove.forEach((entry) => {
        Object.assign(entry, {
          vehicleNumber,
          vehicleCode: vehicleDetails.vehicleCode,
          vehicleType: vehicleDetails.vehicleType,
          vehicleName: selectedVehicleName || (linkToVehicleNumber ? entry.vehicleName : ""),
          operatorSlot: operatorSlotForTarget(entry, vehicleNumber, operatorLeadUnitId),
          discordChannelKey: targetDiscordChannelKey,
          reviewStatus: unit.reviewStatus,
          assignedById: person.id,
          assignedByName: person.name,
          assignedAt: entry.assignedAt || now,
          updatedAt: now,
          lastSeenAt: entry.lastSeenAt || now
        });
        closePendingPortoRequestsForMember(state, entry.memberId, entry.id);
        duplicateUnitsClosed.push(...closeDuplicateActiveUnitsForMember(state, entry.memberId, entry.id, now));
      });
      const affectedVehicleNumbers = [oldVehicleNumber, vehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)];
      syncPortoLinkedNames(state, oldVehicleNumber);
      syncPortoLinkedNames(state, vehicleNumber);
      for (const duplicateVehicleNumber of vehicleNumbersFromUnits(duplicateUnitsClosed)) {
        syncPortoLinkedNames(state, duplicateVehicleNumber);
      }
      const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, unitsToMove);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
      await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto roepnummer aangepast");
      await sendPortoState(res, state, person, unit);
      return true;
    }

    if (url.pathname === "/api/porto/assign" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      if (!canOperatePortoOps(person)) {
        sendJson(res, 403, { error: `Alleen ${operatorLabel}, operationele leiding of ${managementLabel} mag eenheden indelen.` });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const cleanedOpsEligibility = closeIneligiblePortoOpsUnits(state);
      const body = await readBody(req);
      const unitId = String(body.unitId || "").trim();
      const vehiclePrefix = String(body.vehiclePrefix || "").trim();
      const linkToVehicleNumber = String(body.linkToVehicleNumber || "").trim();
      const reject = Boolean(body.reject);
      const unit = state.portoUnits.find((entry) => entry.id === unitId && entry.active !== false);
      if (!unit) {
        if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        sendJson(res, 404, { error: "Aanmelding niet gevonden." });
        return true;
      }
      if (!reject) clearRecentlyEnded(unit.memberId);
      if (reject) {
        if (String(unit.status) !== "0" || unit.vehicleNumber) {
          sendJson(res, 409, { error: "Alleen open Status 0-aanmeldingen kunnen worden geweigerd." });
          return true;
        }
        const rejectedAt = new Date().toISOString();
        Object.assign(unit, {
          active: false,
          status: "8",
          statusDetail: `Geweigerd door ${operatorLabel}`,
          reviewStatus: "rejected",
          endedById: person.id,
          endedByName: person.name,
          endedAt: rejectedAt,
          updatedAt: rejectedAt
        });
        await persistPortoState(state, { units: state.portoUnits });
        await sendPortoState(res, state, person, unit);
        return true;
      }
      let vehicleNumber = "";
      let range = null;
      if (linkToVehicleNumber) {
        const linkedGroup = state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === linkToVehicleNumber);
        if (!linkedGroup.length) {
          sendJson(res, 404, { error: "Koppelvoertuig niet gevonden." });
          return true;
        }
        if (linkedGroup.length >= 3) {
          sendJson(res, 409, { error: "Deze eenheid heeft al maximaal 3 personen." });
          return true;
        }
        vehicleNumber = linkToVehicleNumber;
        range = vehicleRangeForNumber(state, vehicleNumber);
        unit.vehicleName = linkedGroup[0]?.vehicleName || "";
      } else {
        vehicleNumber = firstAvailableVehicleNumber(state, vehiclePrefix);
        if (!vehicleNumber) {
          sendJson(res, 409, { error: "Geen vrij voertuignummer beschikbaar in deze categorie." });
          return true;
        }
        range = vehicleRangeForNumber(state, vehicleNumber);
      }
      if (!range) {
        sendJson(res, 400, { error: "Kies een geldige voertuigcategorie of koppeling." });
        return true;
      }
      const operatorLeadUnitId = vehicleNumber === operatorVehicleNumber && !linkToVehicleNumber ? unit.id : "";
      if (operatorLeadUnitId && !assertCanAssignOpsNumber(state, [unit], res)) return true;
      const linkedStatusSource = linkToVehicleNumber
        ? state.portoUnits.find((entry) => entry.active !== false && entry.vehicleNumber === linkToVehicleNumber)
        : null;
      const statusDefinition = { "1": "Beschikbaar", "2": "Aanrijdend", "3": "Ter plaatse", "4": "Niet beschikbaar", "5": "Transport aanvraag", "6": "Spraak aanvraag", "7": "Spraak aanvraag urgent" };
      const currentStatus = String(unit.status || "");
      const unitHasActiveStatus = currentStatus && currentStatus !== "0" && currentStatus !== "8";
      const linkedStatus = String(linkedStatusSource?.status || "1");
      const targetStatus = unitHasActiveStatus ? currentStatus : linkedStatus;
      const targetStatusDetail = unitHasActiveStatus
        ? (unit.statusDetail || statusDefinition[targetStatus] || "Beschikbaar")
        : (linkedStatusSource?.statusDetail || statusDefinition[targetStatus] || "Beschikbaar");
      const assignedAt = unitHasActiveStatus && unit.assignedAt ? unit.assignedAt : new Date().toISOString();
      const targetDiscordChannelKey = linkToVehicleNumber ? (linkedStatusSource?.discordChannelKey || "") : "";
      Object.assign(unit, {
        vehicleNumber,
        vehicleCode: range.vehicleCode,
        vehicleType: range.vehicleType,
        operatorSlot: operatorSlotForTarget(unit, vehicleNumber, operatorLeadUnitId),
        discordChannelKey: targetDiscordChannelKey,
        discordChannelStatus: linkedStatusSource?.discordChannelStatus || "",
        reviewStatus: linkToVehicleNumber ? "linked" : "assigned",
        assignedById: person.id,
        assignedByName: person.name,
        assignedAt,
        status: targetStatus,
        statusDetail: targetStatusDetail
      });
      closePendingPortoRequestsForMember(state, unit.memberId, unit.id);
      const duplicateUnitsClosed = closeDuplicateActiveUnitsForMember(state, unit.memberId, unit.id, assignedAt);
      unit.updatedAt = unit.assignedAt;
      unit.lastSeenAt = unit.lastSeenAt || unit.assignedAt;
      const affectedVehicleNumbers = [vehicleNumber, ...vehicleNumbersFromUnits(duplicateUnitsClosed)];
      syncPortoLinkedNames(state, vehicleNumber);
      for (const duplicateVehicleNumber of vehicleNumbersFromUnits(duplicateUnitsClosed)) {
        syncPortoLinkedNames(state, duplicateVehicleNumber);
      }
      const unitsNeedingPortoSync = affectedActiveVehicleUnits(state, affectedVehicleNumbers, [unit]);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueueNormalDiscordNicknames(state, duplicateUnitsClosed, "Dubbele Porto-aanmelding gesloten");
      await enqueuePortoDiscordNicknames(state, unitsNeedingPortoSync, "Porto indeling actief");
      await sendPortoState(res, state, person, unit);
      return true;
    }

    return false;
  }

  handlePortoApi.startBrowserTimeoutMonitor = function startBrowserTimeoutMonitor() {
    if (portoBrowserTimeoutTimer || !portoBrowserTimeoutMs) return () => {};
    const run = () => {
      signOffTimedOutPortoBrowsers()
        .catch((error) => console.error(`[porto] Browser-timeout controle mislukt: ${error.message}`));
    };
    portoBrowserTimeoutTimer = setInterval(run, portoBrowserTimeoutCheckMs);
    portoBrowserTimeoutTimer.unref?.();
    setTimeout(run, Math.min(10000, portoBrowserTimeoutCheckMs)).unref?.();
    return () => {
      if (portoBrowserTimeoutTimer) clearInterval(portoBrowserTimeoutTimer);
      portoBrowserTimeoutTimer = null;
    };
  };

  return handlePortoApi;
}

module.exports = { createPortoRouteHandler, collectPortoOffDutyUnits, firstAvailableRegularPortoVehicleNumber };
