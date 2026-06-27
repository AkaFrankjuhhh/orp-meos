const {
  nonRegularPortoDiscordChannel,
  configuredPortoDiscordChannels
} = require("./porto-discord-channels");
const { currentOrganization } = require("./organizations");
const { isDevDiscordId } = require("./ovc");
const { isCurrentPerson } = require("./person-status");

const PORTO_HEARTBEAT_WRITE_MS = 60 * 1000;

function isDevOverrideProfile(person) {
  return Boolean(isCurrentPerson(person) && isDevDiscordId(person.discordId));
}

function timestampMs(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function clearPortoAutoOffline(unit) {
  delete unit.autoOffline;
  delete unit.autoOfflineAt;
  delete unit.autoRemoveAt;
}

const defensiePortoVehicleRangeDefinitions = [
  {
    prefix: "OPS",
    from: "30-00",
    to: "30-00",
    vehicleCode: "OPS",
    vehicleType: "OPS",
    vehicles: ["OPS"],
    numbers: ["30-00"]
  },
  {
    prefix: "30",
    vehicleCode: "NH",
    vehicleType: "Noodhulp",
    vehicles: ["NH - BF Serata", "NH - BF Wolf Variant", "NH - BF Sporttranser", "NH - BF Babadunde", "NH - BF Mobatunde", "ATV - BF Jogger", "ATV - BF Mobatunde", "ATV - BF Sporttranser"]
  },
  {
    prefix: "31",
    vehicleCode: "OFR",
    vehicleType: "Off-Road",
    vehicles: ["OFR - Karin Everon", "OFR - Karin Everon Strand", "OFR - Rebla"]
  },
  {
    prefix: "32",
    vehicleCode: "SIV",
    vehicleType: "SIV",
    vehicles: ["SIV - Obey Argento"]
  },
  {
    prefix: "33",
    vehicleCode: "TMO-Z",
    vehicleType: "Zware Motor",
    vehicles: ["TMO-Z - Guardian"]
  },
  {
    prefix: "34",
    vehicleCode: "TMO-L",
    vehicleType: "Lichte Motor",
    vehicles: ["TMO-L - Ubermacht"]
  },
  {
    prefix: "35",
    vehicleCode: "UM",
    vehicleType: "Ongemarkeerd",
    vehicles: ["UM - Wolf", "UM - Wolf R", "UM - BF Kanzler", "UM - BF Kanzler SRT", "UM - Schlagen SB", "UM - Zware Motor", "UM - Offroad Motor"]
  },
  {
    prefix: "36",
    vehicleCode: "Zulu",
    vehicleType: "Zulu",
    vehicles: ["ZULU"]
  },
  {
    prefix: "37",
    vehicleCode: "KW",
    vehicleType: "Kustwacht",
    vehicles: ["KW - Dinghy"]
  }
];

const politiePortoVehicleChoices = [
  { name: "SIV - Obey Argento", vehicleCode: "SIV", vehicleType: "SIV" },
  { name: "OFR - Karin Everon", vehicleCode: "OFF-ROAD", vehicleType: "Off-Road" },
  { name: "OFR - Karin Everon Strand", vehicleCode: "OFF-ROAD", vehicleType: "Off-Road" },
  { name: "OFR - Rebla", vehicleCode: "OFF-ROAD", vehicleType: "Off-Road" },
  { name: "ZULU", vehicleCode: "ZULU", vehicleType: "Zulu" },
  { name: "TMO-L - Ubermacht", vehicleCode: "TMO", vehicleType: "Motoren" },
  { name: "TMO-Z - Guardian", vehicleCode: "TMO", vehicleType: "Motoren" },
  { name: "OGM - Wolf", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" },
  { name: "OGM - Wolf R", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" },
  { name: "OGM - BF Kanzler", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" },
  { name: "OGM - BF Kanzler SRT", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" },
  { name: "OGM - Schlagen SB", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" },
  { name: "OGM - Zware Motor", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" },
  { name: "OGM - Offroad Motor", vehicleCode: "OGM", vehicleType: "Ongemarkeerd" }
];

const politiePortoVehicleRangeDefinitions = [
  {
    prefix: "OC",
    from: "20-00",
    to: "20-00",
    vehicleCode: "OC",
    vehicleType: "OC",
    vehicles: ["OC"],
    numbers: ["20-00"]
  },
  {
    prefix: "20",
    from: "20-01",
    to: "20-99",
    vehicleCode: "",
    vehicleType: "Politie-eenheid",
    vehicles: politiePortoVehicleChoices.map((vehicle) => vehicle.name),
    vehicleDetails: Object.fromEntries(politiePortoVehicleChoices.map((vehicle) => [vehicle.name, {
      vehicleCode: vehicle.vehicleCode,
      vehicleType: vehicle.vehicleType
    }])),
    numbers: Array.from({ length: 99 }, (_, index) => `20-${String(index + 1).padStart(2, "0")}`)
  }
];

function expandPortoVehicleRanges(definitions) {
  return definitions.map(({ prefix, from, to, vehicleCode, vehicleType, vehicles, vehicleDetails, numbers }) => ({
    prefix,
    from: from || `${prefix}-01`,
    to: to || `${prefix}-10`,
    vehicleCode,
    vehicleType,
    vehicles: [...vehicles],
    vehicleDetails: vehicleDetails ? { ...vehicleDetails } : undefined,
    numbers: numbers ? [...numbers] : Array.from({ length: 10 }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`)
  }));
}

function defaultPortoVehicleRangesForOrganization(organization = currentOrganization()) {
  return expandPortoVehicleRanges(organization.key === "politie" ? politiePortoVehicleRangeDefinitions : defensiePortoVehicleRangeDefinitions);
}

const defaultPortoVehicleRanges = defaultPortoVehicleRangesForOrganization();

function createPortoServices() {
  const organization = currentOrganization();
  const operatorLabel = organization.porto?.operatorLabel || organization.discord?.portoOperatorLabel || "OPS";
  const operatorTraining = organization.porto?.operatorTraining || operatorLabel;
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";

  function functionBadgesForPerson(person) {
    const badges = new Set([...(Array.isArray(person?.extraFunctions) ? person.extraFunctions : [])]);
    const rank = person?.rank || "";
    for (const mapping of organization.autoFunctionByRanks || []) {
      if ((mapping.ranks || []).includes(rank)) badges.add(mapping.label);
    }
    return badges;
  }

  function hasAnyFunctionBadge(person, aliases = []) {
    const badges = functionBadgesForPerson(person);
    return aliases.some((badge) => badges.has(badge));
  }

  function canManagePortoByFunction(person) {
    return hasAnyFunctionBadge(person, organization.permissionAliases?.kader || ["Kader"]);
  }

  function canViewPortoLogsByFunction(person) {
    return hasAnyFunctionBadge(person, [
      ...(organization.permissionAliases?.viewAsKader || ["Kader"]),
      ...(organization.permissionAliases?.hoofdofficier || ["Hoofdofficier"]),
      ...(organization.permissionAliases?.officiersraad || ["Officiersraad"])
    ]);
  }

  function ensurePortoVehicleRanges(state) {
    const desired = defaultPortoVehicleRangesForOrganization(organization).map((range) => ({
      ...range,
      numbers: [...range.numbers]
    }));
    const current = JSON.stringify(state.portoVehicleRanges || null);
    const next = JSON.stringify(desired);
    const rangesChanged = current !== next;
    state.portoVehicleRanges = desired;
    const unitsMigrated = migrateLegacyPolitiePortoUnits(state);
    return rangesChanged || unitsMigrated;
  }

  function migrateLegacyPolitiePortoUnits(state) {
    if (organization.key !== "politie") return false;
    const activeUnits = (state.portoUnits || []).filter((unit) => unit.active !== false && unit.vehicleNumber);
    if (!activeUnits.some((unit) => !/^20-\d{2}$/.test(String(unit.vehicleNumber || "")))) return false;

    const groups = new Map();
    for (const unit of activeUnits) {
      const key = String(unit.vehicleNumber || "");
      const group = groups.get(key) || [];
      group.push(unit);
      groups.set(key, group);
    }

    const currentOcId = String(state.portoCurrentOps?.active === false ? "" : state.portoCurrentOps?.memberId || "");
    const remappedNumbers = new Map();
    let nextRegularNumber = 1;
    const nextRegular = () => {
      while (nextRegularNumber <= 99) {
        const candidate = `20-${String(nextRegularNumber++).padStart(2, "0")}`;
        if (![...remappedNumbers.values()].includes(candidate)) return candidate;
      }
      return "";
    };

    for (const [oldNumber, group] of groups.entries()) {
      if (/^20-\d{2}$/.test(oldNumber)) continue;
      const isCurrentOc = oldNumber === "30-00" || group.some((unit) => String(unit.memberId || "") === currentOcId);
      const nextNumber = isCurrentOc ? "20-00" : nextRegular();
      if (!nextNumber) continue;
      remappedNumbers.set(oldNumber, nextNumber);
      for (const unit of group) {
        unit.vehicleNumber = nextNumber;
        if (nextNumber === "20-00") {
          unit.vehicleCode = "OC";
          unit.vehicleType = "OC";
          unit.vehicleName = "OC";
        }
        unit.updatedAt = new Date().toISOString();
      }
    }

    for (const number of new Set(remappedNumbers.values())) syncPortoLinkedNames(state, number);
    return remappedNumbers.size > 0;
  }

  function defaultDiscordChannelForUnit(unit) {
    return unit?.discordChannelKey || "";
  }

  function displayDiscordChannelKeyForUnit(unitGroup, configuredKeys) {
    const key = String(unitGroup?.discordChannelKey || "").trim();
    return key && configuredKeys.has(key) ? key : nonRegularPortoDiscordChannel.key;
  }

  function canUsePortoDevBypass(person) {
    return Boolean(
      person &&
        isCurrentPerson(person) &&
        isDevOverrideProfile(person)
    );
  }

  function hasCompletedOperational(person, value) {
    return Array.isArray(person?.completedOperational) && person.completedOperational.includes(value);
  }

  function canServePortoOps(person) {
    return Boolean(
      person &&
        isCurrentPerson(person) &&
        (hasCompletedOperational(person, operatorTraining) || isDevOverrideProfile(person))
    );
  }

  function canOperatePortoOps(person) {
    const operational = Array.isArray(person?.completedOperational) ? person.completedOperational : [];
    const badges = Array.isArray(person?.badges) ? person.badges : [];
    const functions = [...functionBadgesForPerson(person)];
    const opsValues = [...operational, ...badges, ...functions];
    const allowedOpsValues = new Set([
      ...(organization.profileOperational || ["OPS", "OPCO", "OVD"]),
      ...(organization.permissionAliases?.kader || ["Kader"])
    ]);
    return Boolean(
      person &&
        isCurrentPerson(person) &&
        (opsValues.some((item) => allowedOpsValues.has(item)) || canManagePortoByFunction(person) || isDevOverrideProfile(person))
    );
  }


  function canViewPortoOpsLog(person) {
    return isDevOverrideProfile(person) || canViewPortoLogsByFunction(person);
  }

  function activePortoOps(state) {
    const peopleById = new Map((state.people || []).map((person) => [person.id, person]));
    const ops = state.portoCurrentOps;
    if (ops && ops.active !== false && canServePortoOps(peopleById.get(ops.memberId))) return ops;
    const opsUnit = (state.portoUnits || []).find((unit) =>
      isPortoOperatorLeadUnit(state, unit, peopleById) && canServePortoOps(peopleById.get(unit?.memberId))
    );
    if (!opsUnit) return null;
    return {
      memberId: opsUnit.memberId || "",
      name: opsUnit.name || "Onbekend",
      serviceNumber: opsUnit.serviceNumber || "",
      phone: opsUnit.phone || "",
      startedAt: opsUnit.assignedAt || opsUnit.requestedAt || opsUnit.lastSeenAt || "",
      active: true,
      recoveredFromUnit: true
    };
  }

  function explicitOperatorSlot(unit) {
    const slot = String(unit?.operatorSlot || "").trim().toLowerCase();
    return slot === "lead" || slot === "support" ? slot : "";
  }

  function hasExplicitOperatorLead(state) {
    return (state.portoUnits || []).some((unit) =>
      unit.active !== false &&
      unit.vehicleNumber === operatorVehicleNumber &&
      explicitOperatorSlot(unit) === "lead"
    );
  }

  function legacyOperatorLeadUnit(state, peopleById = null) {
    const byId = peopleById || new Map((state.people || []).map((person) => [person.id, person]));
    const currentOps = state.portoCurrentOps;
    if (currentOps && currentOps.active !== false && canServePortoOps(byId.get(currentOps.memberId))) {
      return (state.portoUnits || []).find((unit) =>
        unit.active !== false &&
        unit.vehicleNumber === operatorVehicleNumber &&
        unit.memberId === currentOps.memberId
      ) || null;
    }
    if (hasExplicitOperatorLead(state)) return null;
    return (state.portoUnits || []).find((unit) =>
      unit.active !== false &&
      unit.vehicleNumber === operatorVehicleNumber &&
      explicitOperatorSlot(unit) !== "support" &&
      canServePortoOps(byId.get(unit.memberId))
    ) || null;
  }

  function isPortoOperatorLeadUnit(state, unit, peopleById = null) {
    if (!unit || unit.active === false || unit.vehicleNumber !== operatorVehicleNumber) return false;
    const slot = explicitOperatorSlot(unit);
    if (slot) return slot === "lead";
    const legacyLead = legacyOperatorLeadUnit(state, peopleById);
    return Boolean(legacyLead && legacyLead.id === unit.id);
  }

  function operatorSlotForDisplay(state, unit, peopleById = null) {
    if (!unit || unit.active === false || unit.vehicleNumber !== operatorVehicleNumber) return "";
    const slot = explicitOperatorSlot(unit);
    if (slot) return slot;
    return isPortoOperatorLeadUnit(state, unit, peopleById) ? "lead" : "support";
  }

  function vehicleRangeForNumber(state, number) {
    const value = String(number || "").trim();
    return (state.portoVehicleRanges || []).find((range) => (range.numbers || []).includes(value)) || null;
  }

  function vehicleDetailsForSelection(range, vehicleName) {
    const details = range?.vehicleDetails?.[String(vehicleName || "").trim()];
    return {
      vehicleCode: details?.vehicleCode ?? range?.vehicleCode ?? "",
      vehicleType: details?.vehicleType ?? range?.vehicleType ?? ""
    };
  }

  function availablePortoVehicleNumbers(state) {
    const used = new Set(
      (state.portoUnits || [])
        .filter((unit) => unit.active !== false && unit.vehicleNumber)
        .map((unit) => unit.vehicleNumber)
    );
    return (state.portoVehicleRanges || []).map((range) => ({
      prefix: range.prefix,
      vehicleCode: range.vehicleCode,
      vehicleType: range.vehicleType,
      from: range.from,
      to: range.to,
      numbers: (range.numbers || []).filter((number) => !used.has(number))
    }));
  }

  function linkablePortoUnits(state) {
    const groups = new Map();
    for (const unit of state.portoUnits || []) {
      if (unit.active === false || !unit.vehicleNumber) continue;
      const current = groups.get(unit.vehicleNumber) || {
        vehicleNumber: unit.vehicleNumber,
        vehicleCode: unit.vehicleCode,
        vehicleType: unit.vehicleType,
        vehicleName: unit.vehicleName || "",
        names: [],
        count: 0
      };
      current.names.push(unit.name);
      current.count += 1;
      groups.set(unit.vehicleNumber, current);
    }
    return [...groups.values()]
      .filter((group) => group.count < 3)
      .map((group) => ({
        vehicleNumber: group.vehicleNumber,
        vehicleCode: group.vehicleCode,
        vehicleType: group.vehicleType,
        vehicleName: group.vehicleName || "",
        count: group.count,
        label: `${group.vehicleNumber} - ${group.vehicleType} (${group.names.join(", ")})`
      }));
  }

  function firstAvailableVehicleNumber(state, prefix) {
    const range = (state.portoVehicleRanges || []).find((entry) => entry.prefix === prefix);
    if (!range) return null;
    const used = new Set(
      (state.portoUnits || [])
        .filter((unit) => unit.active !== false && unit.vehicleNumber)
        .map((unit) => unit.vehicleNumber)
    );
    return (range.numbers || []).find((number) => !used.has(number)) || null;
  }

  function syncPortoLinkedNames(state, vehicleNumber) {
    const group = (state.portoUnits || []).filter((unit) => unit.active !== false && unit.vehicleNumber === vehicleNumber);
    for (const unit of group) {
      unit.linkedWith = group.filter((entry) => entry.id !== unit.id).map((entry) => entry.name);
    }
  }

  function closeIneligiblePortoOpsUnits(state, nowIso = new Date().toISOString()) {
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    const peopleById = new Map((state.people || []).map((person) => [person.id, person]));
    let changed = false;

    const currentOps = state.portoCurrentOps;
    if (currentOps && currentOps.active !== false && !canServePortoOps(peopleById.get(currentOps.memberId))) {
      state.portoCurrentOps = {
        ...currentOps,
        active: false,
        endedAt: nowIso,
        endedReason: `${operatorTraining} training ontbreekt`
      };
      changed = true;
    }

    for (const unit of state.portoUnits) {
      if (unit.active === false || unit.vehicleNumber !== operatorVehicleNumber) continue;
      if (!isPortoOperatorLeadUnit(state, unit, peopleById)) continue;
      if (canServePortoOps(peopleById.get(unit.memberId))) {
        if (unit.operatorSlot !== "lead") {
          unit.operatorSlot = "lead";
          changed = true;
        }
        continue;
      }
      Object.assign(unit, {
        status: "8",
        statusDetail: `${operatorTraining} training ontbreekt`,
        active: false,
        vehicleNumber: "",
        vehicleCode: "",
        vehicleType: "",
        vehicleName: "",
        operatorSlot: "",
        linkedWith: [],
        endedAt: nowIso,
        updatedAt: nowIso
      });
      changed = true;
    }

    if (changed) syncPortoLinkedNames(state, operatorVehicleNumber);
    return changed;
  }

  function sweepPortoPresence(state, now = new Date()) {
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    const nowIso = now.toISOString();
    let changed = false;

    for (const unit of state.portoUnits) {
      if (unit.active === false || !unit.vehicleNumber) continue;
      if (!unit.lastSeenAt) {
        unit.lastSeenAt = nowIso;
        changed = true;
        continue;
      }
      if (unit.autoOffline || unit.autoOfflineAt || unit.autoRemoveAt) {
        clearPortoAutoOffline(unit);
        unit.updatedAt = nowIso;
        changed = true;
      }
    }

    return changed;
  }

  function touchPortoPresence(state, person, now = new Date()) {
    if (!person) return false;
    const unit = (state.portoUnits || []).find((entry) => entry.memberId === person.id && entry.active !== false && entry.vehicleNumber);
    if (!unit) return false;
    const nowMs = now.getTime();
    const wasOffline = Boolean(unit.autoOffline);
    const previousLastSeenAt = unit.lastSeenAt || "";
    const nowIso = now.toISOString();
    const shouldWriteHeartbeat = !previousLastSeenAt || nowMs - timestampMs(previousLastSeenAt) >= PORTO_HEARTBEAT_WRITE_MS;
    if (shouldWriteHeartbeat || wasOffline) unit.lastSeenAt = nowIso;
    if (wasOffline) {
      clearPortoAutoOffline(unit);
      unit.updatedAt = nowIso;
    }
    return wasOffline || shouldWriteHeartbeat;
  }

  function portoStatusSortRank(status) {
    const ranks = { "7": 0, "6": 1, "5": 2, "1": 3, "2": 4, "3": 5, "4": 6 };
    return Object.prototype.hasOwnProperty.call(ranks, String(status)) ? ranks[String(status)] : 7;
  }

  function comparePortoMembersByPriority(a, b) {
    const slotRank = (member) => member.operatorSlot === "lead" ? 0 : member.operatorSlot === "support" ? 1 : 2;
    const slotDelta = slotRank(a) - slotRank(b);
    if (slotDelta) return slotDelta;
    const statusDelta = portoStatusSortRank(a.status) - portoStatusSortRank(b.status);
    if (statusDelta) return statusDelta;
    return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
  }

  function portoGroupStatusSortRank(group) {
    const members = Array.isArray(group?.members) ? group.members : [];
    if (!members.length) return 7;
    return Math.min(...members.map((member) => portoStatusSortRank(member.status)));
  }

  function newerPortoUnit(a, b) {
    const aTime = timestampMs(a.updatedAt || a.assignedAt || a.requestedAt || a.lastSeenAt);
    const bTime = timestampMs(b.updatedAt || b.assignedAt || b.requestedAt || b.lastSeenAt);
    if (aTime !== bTime) return aTime > bTime ? a : b;
    return String(a.id || "").localeCompare(String(b.id || "")) >= 0 ? a : b;
  }

  function activePortoUnitGroups(state) {
    const groups = new Map();
    const peopleById = new Map((state.people || []).map((person) => [person.id, person]));
    const unitsByVehicleAndMember = new Map();
    for (const unit of state.portoUnits || []) {
      if (unit.active === false || !unit.vehicleNumber) continue;
      const dedupeKey = `${unit.vehicleNumber}::${unit.memberId || unit.id}`;
      const previous = unitsByVehicleAndMember.get(dedupeKey);
      unitsByVehicleAndMember.set(dedupeKey, previous ? newerPortoUnit(previous, unit) : unit);
    }
    for (const unit of unitsByVehicleAndMember.values()) {
      const range = vehicleRangeForNumber(state, unit.vehicleNumber);
      const current = groups.get(unit.vehicleNumber) || {
        vehicleNumber: unit.vehicleNumber,
        vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
        vehicleType: unit.vehicleType || range?.vehicleType || "",
        vehicleName: unit.vehicleName || "",
        discordChannelKey: defaultDiscordChannelForUnit(unit),
        discordChannelStatus: unit.discordChannelStatus || "",
        members: []
      };
      const person = peopleById.get(unit.memberId) || {};
      const completedTrainings = Array.isArray(person.completedTrainings) ? person.completedTrainings : [];
      const completedOperational = Array.isArray(person.completedOperational) ? person.completedOperational : [];
      current.members.push({
        id: unit.id,
        memberId: unit.memberId,
        name: unit.name,
        rank: unit.rank,
        serviceNumber: unit.serviceNumber,
        avatar: person.avatar || unit.avatar || "",
        phone: unit.phone,
        completedTrainings,
        completedOperational,
        specializations: [...completedTrainings, ...completedOperational],
        status: unit.status,
        statusDetail: unit.statusDetail,
        vehicleNumber: unit.vehicleNumber,
        vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
        vehicleType: unit.vehicleType || range?.vehicleType || "",
        vehicleName: unit.vehicleName || "",
        operatorSlot: operatorSlotForDisplay(state, unit, peopleById),
        discordChannelKey: defaultDiscordChannelForUnit(unit),
        discordChannelStatus: unit.discordChannelStatus || "",
      });
      groups.set(unit.vehicleNumber, current);
    }
    return [...groups.values()]
      .map((group) => {
        const members = group.members.slice().sort(comparePortoMembersByPriority);
        return { ...group, members };
      })
      .sort((a, b) => {
        const statusDelta = portoGroupStatusSortRank(a) - portoGroupStatusSortRank(b);
        if (statusDelta) return statusDelta;
        return a.vehicleNumber.localeCompare(b.vehicleNumber, "nl", { numeric: true });
      });
  }

  function decoratePortoUnit(state, unit) {
    if (!unit) return null;
    const range = vehicleRangeForNumber(state, unit.vehicleNumber);
    const peopleById = new Map((state.people || []).map((person) => [person.id, person]));
    const members = unit.vehicleNumber
      ? [...(state.portoUnits || [])
          .filter((entry) => entry.active !== false && entry.vehicleNumber === unit.vehicleNumber)
          .reduce((map, entry) => {
            const key = entry.memberId || entry.id;
            const previous = map.get(key);
            map.set(key, previous ? newerPortoUnit(previous, entry) : entry);
            return map;
          }, new Map())
          .values()]
          .map((entry) => ({
            id: entry.id,
            memberId: entry.memberId,
            name: entry.name,
            rank: entry.rank,
            serviceNumber: entry.serviceNumber,
            avatar: peopleById.get(entry.memberId)?.avatar || entry.avatar || "",
            phone: entry.phone,
            vehicleNumber: entry.vehicleNumber,
            vehicleCode: entry.vehicleCode || range?.vehicleCode || "",
            vehicleType: entry.vehicleType,
            status: entry.status,
            statusDetail: entry.statusDetail,
            vehicleName: entry.vehicleName || "",
            operatorSlot: operatorSlotForDisplay(state, entry, peopleById),
            discordChannelKey: defaultDiscordChannelForUnit(entry),
            discordChannelStatus: entry.discordChannelStatus || "",
          }))
      : [{
          id: unit.id,
          memberId: unit.memberId,
          name: unit.name,
          rank: unit.rank,
          serviceNumber: unit.serviceNumber,
          avatar: peopleById.get(unit.memberId)?.avatar || unit.avatar || "",
          phone: unit.phone,
          vehicleNumber: unit.vehicleNumber,
          vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
          vehicleType: unit.vehicleType,
          status: unit.status,
          statusDetail: unit.statusDetail,
          vehicleName: unit.vehicleName || "",
          operatorSlot: operatorSlotForDisplay(state, unit, peopleById),
          discordChannelKey: defaultDiscordChannelForUnit(unit),
          discordChannelStatus: unit.discordChannelStatus || "",
        }];
    return {
      ...unit,
      vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
      vehicleType: unit.vehicleType || range?.vehicleType || "",
      vehicleChoices: range?.vehicles || [],
      unitMembers: members
    };
  }

  function portoDiscordChannelGroups(state) {
    const configuredChannels = configuredPortoDiscordChannels();
    const configuredKeys = new Set(configuredChannels.filter((channel) => channel.configured).map((channel) => channel.key));
    const groupsByKey = new Map(configuredChannels.map((channel) => [channel.key, { ...channel, status: "", units: [] }]));
    for (const unitGroup of activePortoUnitGroups(state)) {
      const key = displayDiscordChannelKeyForUnit(unitGroup, configuredKeys);
      if (!groupsByKey.has(key)) groupsByKey.set(key, { ...nonRegularPortoDiscordChannel, status: "", units: [] });
      const current = groupsByKey.get(key);
      current.status = current.status || unitGroup.discordChannelStatus || "";
      current.units.push(unitGroup);
    }
    return [...groupsByKey.values()].filter((group) => group.units.length);
  }

  function portoOpsPayload(state, person) {
    ensurePortoVehicleRanges(state);
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    const currentOps = activePortoOps(state);
    if (currentOps && !currentOps.phone) {
      const opsPerson = (state.people || []).find((entry) => entry.id === currentOps.memberId);
      if (opsPerson?.portoPhone) currentOps.phone = opsPerson.portoPhone;
    }
    const peopleById = new Map((state.people || []).map((entry) => [entry.id, entry]));
    const assignedMemberIds = new Set(
      state.portoUnits
        .filter((unit) => unit.active !== false && unit.vehicleNumber)
        .map((unit) => unit.memberId)
        .filter(Boolean)
    );
    const canTakeOps = canServePortoOps(person);
    const canViewOpsLog = canViewPortoOpsLog(person);
    const canManageOps = canOperatePortoOps(person);
    const opsRequests = canManageOps
      ? state.portoUnits
          .filter((unit) => unit.active !== false && String(unit.status) === "0" && !unit.vehicleNumber && !assignedMemberIds.has(unit.memberId))
          .map((unit) => ({
            id: unit.id,
            memberId: unit.memberId,
            name: unit.name,
            rank: unit.rank,
            serviceNumber: unit.serviceNumber,
            avatar: peopleById.get(unit.memberId)?.avatar || unit.avatar || "",
            phone: unit.phone,
            requestNote: unit.requestNote || "",
            completedTrainings: Array.isArray(peopleById.get(unit.memberId)?.completedTrainings) ? peopleById.get(unit.memberId).completedTrainings : [],
            completedOperational: Array.isArray(peopleById.get(unit.memberId)?.completedOperational) ? peopleById.get(unit.memberId).completedOperational : [],
            specializations: [
              ...(Array.isArray(peopleById.get(unit.memberId)?.completedTrainings) ? peopleById.get(unit.memberId).completedTrainings : []),
              ...(Array.isArray(peopleById.get(unit.memberId)?.completedOperational) ? peopleById.get(unit.memberId).completedOperational : [])
            ],
            requestedAt: unit.requestedAt
          }))
      : [];
    return {
      currentOps,
      operatorLabel,
      operatorTraining,
      canTakeOps,
      canManageOps,
      canUseDevTools: canUsePortoDevBypass(person),
      opsRequests,
      availableVehicleRanges: canManageOps ? availablePortoVehicleNumbers(state) : [],
      linkableUnits: canManageOps ? linkablePortoUnits(state) : [],
      activeUnits: canManageOps ? activePortoUnitGroups(state) : [],
      discordChannels: canManageOps ? configuredPortoDiscordChannels() : [],
      discordChannelGroups: canManageOps ? portoDiscordChannelGroups(state) : [],
      mapEnabled: String(process.env.PORTO_MAP_ENABLED || "false").toLowerCase() === "true"
        && String(process.env.PORTO_MAP_VISIBLE || "false").toLowerCase() === "true",
      opsLog: canViewOpsLog ? (Array.isArray(state.portoOpsLog) ? state.portoOpsLog.slice(0, 80) : []) : []
    };
  }

  return {
    defaultPortoVehicleRanges,
    ensurePortoVehicleRanges,
    canUsePortoDevBypass,
    canServePortoOps,
    canOperatePortoOps,
    activePortoOps,
    isPortoOperatorLeadUnit,
    canViewPortoOpsLog,
    configuredPortoDiscordChannels,
    portoDiscordChannelGroups,
    vehicleRangeForNumber,
    vehicleDetailsForSelection,
    availablePortoVehicleNumbers,
    linkablePortoUnits,
    firstAvailableVehicleNumber,
    syncPortoLinkedNames,
    closeIneligiblePortoOpsUnits,
    sweepPortoPresence,
    touchPortoPresence,
    activePortoUnitGroups,
    decoratePortoUnit,
    portoOpsPayload
  };
}

module.exports = { createPortoServices };
