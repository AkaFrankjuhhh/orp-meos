const crypto = require("node:crypto");
const { createPortoServices } = require("./porto");
const { enqueueDiscordSyncJob } = require("./discord-sync-jobs");
const { currentOrganization } = require("./organizations");
const { allSideTasks } = require("./side-tasks-config");
const { createSideTasksStore } = require("./side-tasks-store");
const { portoPhonebookPeople } = require("./porto-phonebook");
const { isCurrentPerson } = require("./person-status");

function activePersonForAuth(state, auth) {
  return (state.people || []).find((entry) => entry.id === auth.profile.id && isCurrentPerson(entry));
}

function createPortoRouteHandler({ requireAuth, readState, writeState, writePortoSettings, writePortoPhone, writePortoUnits, readBody, sendJson, discordBot }) {
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
  const {
    ensurePortoVehicleRanges,
    canUsePortoDevBypass,
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
    : 90000;
  const recentlyEndedPortoMembers = new Map();

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

  function recentlyEndedError() {
    return {
      error: "Uitdienstmelding wordt nog verwerkt. Wacht kort voordat je opnieuw aanmeldt.",
      code: "porto_recently_ended"
    };
  }

  function timestampMs(value) {
    const time = Date.parse(value || "");
    return Number.isFinite(time) ? time : 0;
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
    return new Date(Date.now() + 1500);
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

  function unitWithPortoNicknameContext(state, unit) {
    if (!unit) return unit;
    return {
      ...unit,
      isPortoOpsLead: isPortoOperatorLeadUnit(state, unit)
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
    for (const unit of units || []) {
      const person = byId.get(unit.memberId);
      if (!person?.discordId) continue;
      await enqueueDiscordSyncJob("porto_nickname", {
        personId: person.id,
        discordId: person.discordId,
        unitId: unit.id,
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
    for (const unit of units || []) {
      const person = byId.get(unit.memberId);
      if (!person?.discordId) continue;
      await enqueueDiscordSyncJob("sync_person", {
        personId: person.id,
        discordId: person.discordId,
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

  async function persistPortoState(state, options = {}) {
    const units = options.units || null;
    const settings = Boolean(options.settings);
    const phonePerson = options.phonePerson || null;
    if (typeof writePortoUnits === "function" || typeof writePortoSettings === "function" || typeof writePortoPhone === "function") {
      if (settings && typeof writePortoSettings === "function") await Promise.resolve(writePortoSettings(state));
      if (phonePerson && typeof writePortoPhone === "function") await Promise.resolve(writePortoPhone(phonePerson.id, phonePerson.portoPhone || ""));
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
    let changed = false;
    for (const entry of state.portoUnits || []) {
      if (
        entry.id !== keepUnit.id &&
        entry.memberId === person.id &&
        entry.active !== false &&
        entry.vehicleNumber === operatorVehicleNumber
      ) {
        entry.active = false;
        entry.status = "8";
        entry.statusDetail = `Dubbele ${operatorLabel}-aanmelding gesloten`;
        entry.vehicleNumber = "";
        entry.vehicleCode = "";
        entry.vehicleType = "";
        entry.vehicleName = "";
        entry.operatorSlot = "";
        entry.linkedWith = [];
        entry.endedAt = nowIso;
        entry.updatedAt = nowIso;
        changed = true;
      }
    }
    return changed;
  }

  function closeDuplicateActiveUnitsForMember(state, memberId, keepUnitId = "", nowIso = new Date().toISOString()) {
    if (!memberId) return false;
    const activeUnits = (state.portoUnits || []).filter((entry) => entry.memberId === memberId && entry.active !== false);
    if (activeUnits.length <= 1) return false;
    const keepUnit = activeUnits.find((entry) => entry.id === keepUnitId) || activeUnits
      .slice()
      .reduce((best, entry) => preferredActiveUnit(best, entry), activeUnits[0]);
    let changed = false;
    for (const entry of activeUnits) {
      if (entry.id === keepUnit.id) continue;
      entry.active = false;
      entry.status = "8";
      entry.statusDetail = "Dubbele Porto-aanmelding gesloten";
      entry.vehicleNumber = "";
      entry.vehicleCode = "";
      entry.vehicleType = "";
      entry.vehicleName = "";
      entry.operatorSlot = "";
      entry.linkedWith = [];
      entry.endedAt = nowIso;
      entry.updatedAt = nowIso;
      changed = true;
    }
    return changed;
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
        endedById: endedBy.id || "",
        endedByName: endedBy.name || "Onbekend",
        endedAt,
        updatedAt: endedAt
      });
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

  async function maintainPortoPresence(state, person, { touch = true } = {}) {
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
    if (currentOps && !currentOpsRecentlyEnded) {
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
    const payload = {
      ...extra,
      unit: decoratePortoUnit(state, unit),
      profile: person,
      vehicleRanges: state.portoVehicleRanges,
      phonebook: portoPhonebookPeople(state),
      ...portoOpsPayload(state, person)
    };
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
      person.portoPhone = String(body.portoPhone || "").trim().slice(0, 40);
      const { unitsChanged, settingsChanged } = refreshActivePortoPhoneForPerson(state, person);
      await persistPortoState(state, {
        phonePerson: person,
        units: unitsChanged ? state.portoUnits : null,
        settings: settingsChanged
      });
      const recentlyEnded = isRecentlyEnded(person.id);
      const unit = recentlyEnded ? null : state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      await sendPortoState(res, state, person, unit, recentlyEnded ? { recentlyEnded: true } : {});
      return true;
    }

    if (url.pathname === "/api/porto/status" && req.method === "GET") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const rangesChanged = ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const skipPresenceMaintain = isRecentlyEnded(person.id);
      if (!skipPresenceMaintain) await maintainPortoPresence(state, person, { touch: false });
      if (rangesChanged) await persistPortoState(state, { units: state.portoUnits, settings: true });
      const unit = skipPresenceMaintain ? null : state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      await sendPortoState(res, state, person, unit, skipPresenceMaintain ? { recentlyEnded: true } : {});
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
      const detail = status === "4" ? String(body.detail || "").trim() : "";
      if (detail && !status4Reasons.has(detail)) {
        sendJson(res, 400, { error: "Ongeldige Status 4 reden." });
        return true;
      }
      const requestNote = status === "0" ? String(body.requestNote || "").trim().slice(0, 240) : "";
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const now = new Date().toISOString();
      sweepPortoPresence(state);
      const changedByOpsEligibility = closeIneligiblePortoOpsUnits(state, now);
      let unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false);
      const recentlyEnded = isRecentlyEnded(person.id);
      if (recentlyEnded && status !== "8") {
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
        unit.reviewStatus = "pending";
        unit.requestedAt = unit.requestedAt || now;
        unit.requestNote = requestNote;
      }
      if (status === "8") {
        const personKey = portoMemberKey(person.id);
        const endedUnits = state.portoUnits.filter((entry) => (
          portoMemberKey(entry.memberId) === personKey && entry.active !== false
        ));
        if (!endedUnits.some((entry) => entry.id === unit.id)) endedUnits.push(unit);
        const releasedVehicleNumbers = new Set(endedUnits.map((entry) => entry.vehicleNumber).filter(Boolean));
        markRecentlyEndedUnits(endedUnits);
        const opsReleased = releaseOpsIfEnded(state, endedUnits, person, now, "Uit dienst");
        settingsChanged = settingsChanged || opsReleased;
        for (const endedUnit of endedUnits) {
          Object.assign(endedUnit, {
            status: "8",
            statusDetail: "Uit dienst",
            active: false,
            endedAt: now,
            updatedAt: now
          });
        }
        for (const releasedVehicleNumber of releasedVehicleNumbers) syncPortoLinkedNames(state, releasedVehicleNumber);
        await enqueueNormalDiscordNicknames(state, endedUnits);
      } else {
        closeDuplicateActiveUnitsForMember(state, person.id, unit.id, now);
        await enqueuePortoDiscordNicknames(state, [unit], "Porto status aangepast");
      }
      await persistPortoState(state, { units: state.portoUnits, settings: settingsChanged });
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
      const vehicleNumber = unit.vehicleNumber || firstAvailableVehicleNumber(state, "30") || availablePortoVehicleNumbers(state).flatMap((range) => range.numbers || [])[0];
      if (!vehicleNumber) {
        sendJson(res, 409, { error: "Geen vrij testvoertuignummer beschikbaar." });
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
        assignedAt: now,
        status: "1",
        statusDetail: "Beschikbaar",
        lastSeenAt: now,
        updatedAt: now
      });
      syncPortoLinkedNames(state, vehicleNumber);
      await persistPortoState(state, { units: state.portoUnits });
      await sendPortoState(res, state, person, unit);
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
        if (isRecentlyEnded(person.id)) {
          if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
          sendJson(res, 409, recentlyEndedError());
          return true;
        }
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
        state.portoCurrentOps = { memberId: person.id, name: person.name, serviceNumber: person.serviceNumber, phone: person.portoPhone || "", startedAt: currentOps?.startedAt || nowIso, active: true };
        const unit = ensureOpsUnit(state, person, nowIso);
        closeDuplicateOpsUnits(state, person, unit, nowIso);
        closeDuplicateActiveUnitsForMember(state, person.id, unit.id, nowIso);
        await persistPortoState(state, { settings: true, units: state.portoUnits });
        await enqueuePortoDiscordNicknames(state, [unit], `${operatorLabel} roepnummer actief`);
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
        await persistPortoState(state, { settings: true, units: state.portoUnits });
        if (opsUnit) await enqueueNormalDiscordNicknames(state, [opsUnit], `${operatorLabel} dienst beeindigd`);
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
      if (!offDuty && isRecentlyEnded(unit.memberId)) {
        if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        sendJson(res, 409, recentlyEndedError());
        return true;
      }
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
        const vehicleNumber = firstAvailableVehicleNumber(state, currentRange.prefix);
        if (!vehicleNumber) {
          sendJson(res, 409, { error: "Geen vrij roepnummer beschikbaar om deze persoon los te koppelen." });
          return true;
        }
        const now = new Date().toISOString();
        Object.assign(unit, {
          vehicleNumber,
          vehicleCode: currentRange.vehicleCode,
          vehicleType: currentRange.vehicleType,
          vehicleName: "",
          operatorSlot: "",
          linkedWith: [],
          reviewStatus: "unlinked",
          assignedById: person.id,
          assignedByName: person.name,
          assignedAt: now,
          updatedAt: now
        });
        syncPortoLinkedNames(state, oldVehicleNumber);
        syncPortoLinkedNames(state, vehicleNumber);
        await persistPortoState(state, { units: state.portoUnits });
        await sendPortoState(res, state, person, unit);
        return true;
      }

      if (offDuty) {
        const oldVehicleNumber = exactVehicleNumber || unit.vehicleNumber;
        const endedAt = new Date().toISOString();
        const unitsToEnd = offDutyScope === "member" || oldVehicleNumber === operatorVehicleNumber
          ? [unit]
          : state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === oldVehicleNumber);
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
          linkedWith: [],
          endedById: person.id,
          endedByName: person.name,
          endedAt,
          updatedAt: endedAt
        }));
        syncPortoLinkedNames(state, oldVehicleNumber);
        await persistPortoState(state, { units: state.portoUnits, settings: settingsChanged });
        await enqueueNormalDiscordNicknames(state, unitsToEnd);
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
          assignedAt: now,
          updatedAt: now,
          lastSeenAt: entry.lastSeenAt || now
        });
        closePendingPortoRequestsForMember(state, entry.memberId, entry.id);
        closeDuplicateActiveUnitsForMember(state, entry.memberId, entry.id, now);
      });
      syncPortoLinkedNames(state, oldVehicleNumber);
      syncPortoLinkedNames(state, vehicleNumber);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueuePortoDiscordNicknames(state, unitsToMove, "Porto roepnummer aangepast");
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
      if (!reject && isRecentlyEnded(unit.memberId)) {
        if (cleanedOpsEligibility) await persistPortoState(state, { settings: true, units: state.portoUnits });
        sendJson(res, 409, recentlyEndedError());
        return true;
      }
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
      const assignedAt = new Date().toISOString();
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
      closeDuplicateActiveUnitsForMember(state, unit.memberId, unit.id, assignedAt);
      unit.updatedAt = unit.assignedAt;
      unit.lastSeenAt = unit.lastSeenAt || unit.assignedAt;
      syncPortoLinkedNames(state, vehicleNumber);
      await persistPortoState(state, { units: state.portoUnits });
      await enqueuePortoDiscordNicknames(state, [unit], "Porto indeling actief");
      await sendPortoState(res, state, person, unit);
      return true;
    }

    return false;
  }

  return handlePortoApi;
}

module.exports = { createPortoRouteHandler };
