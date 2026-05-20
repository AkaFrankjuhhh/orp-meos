const PORTO_PRESENCE_TIMEOUT_MS = 15 * 60 * 1000;
const PORTO_PRESENCE_GRACE_MS = 5 * 60 * 1000;
const PORTO_HEARTBEAT_WRITE_MS = 60 * 1000;

function timestampMs(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function clearPortoAutoOffline(unit) {
  delete unit.autoOffline;
  delete unit.autoOfflineAt;
  delete unit.autoRemoveAt;
}

const defaultPortoVehicleRanges = [
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
].map(({ prefix, vehicleCode, vehicleType, vehicles }) => ({
  prefix,
  from: `${prefix}-01`,
  to: `${prefix}-10`,
  vehicleCode,
  vehicleType,
  vehicles: [...vehicles],
  numbers: Array.from({ length: 10 }, (_, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`)
}));

function createPortoServices() {
  function ensurePortoVehicleRanges(state) {
    const desired = defaultPortoVehicleRanges.map((range) => ({
      ...range,
      numbers: [...range.numbers]
    }));
    const current = JSON.stringify(state.portoVehicleRanges || null);
    const next = JSON.stringify(desired);
    if (current === next) return false;
    state.portoVehicleRanges = desired;
    return true;
  }

  function canUsePortoDevBypass(person) {
    return Boolean(
      person &&
        person.status === "Actief" &&
        (process.env.PORTO_DEV_BYPASS === "1" || person.name === "Frank Bright" || person.serviceNumber === "71-01")
    );
  }

  function canOperatePortoOps(person) {
    return Boolean(
      person &&
        person.status === "Actief" &&
        ((person.completedOperational || []).includes("OPS") || (person.extraFunctions || []).includes("Kader"))
    );
  }

  function activePortoOps(state) {
    const ops = state.portoCurrentOps;
    if (!ops || ops.active === false) return null;
    return ops;
  }

  function vehicleRangeForNumber(state, number) {
    const value = String(number || "").trim();
    return (state.portoVehicleRanges || []).find((range) => (range.numbers || []).includes(value)) || null;
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

  function sweepPortoPresence(state, now = new Date()) {
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    const nowMs = now.getTime();
    const nowIso = now.toISOString();
    const syncNumbers = new Set();
    let changed = false;

    for (const unit of state.portoUnits) {
      if (unit.active === false || !unit.vehicleNumber) continue;
      if (!unit.lastSeenAt) {
        unit.lastSeenAt = nowIso;
        changed = true;
        continue;
      }

      if (unit.autoOffline) {
        const removeMs = timestampMs(unit.autoRemoveAt);
        if (removeMs && nowMs >= removeMs) {
          const oldVehicleNumber = unit.vehicleNumber;
          Object.assign(unit, {
            status: "8",
            statusDetail: "Automatisch afgemeld",
            active: false,
            vehicleNumber: "",
            vehicleCode: "",
            vehicleType: "",
            vehicleName: "",
            linkedWith: [],
            endedByName: "Automatisch systeem",
            endedAt: nowIso,
            updatedAt: nowIso
          });
          clearPortoAutoOffline(unit);
          syncNumbers.add(oldVehicleNumber);
          changed = true;
        }
        continue;
      }

      if (nowMs - timestampMs(unit.lastSeenAt) >= PORTO_PRESENCE_TIMEOUT_MS) {
        unit.autoOffline = true;
        unit.autoOfflineAt = nowIso;
        unit.autoRemoveAt = new Date(nowMs + PORTO_PRESENCE_GRACE_MS).toISOString();
        unit.updatedAt = nowIso;
        changed = true;
      }
    }

    for (const number of syncNumbers) syncPortoLinkedNames(state, number);
    return changed;
  }

  function touchPortoPresence(state, person, now = new Date()) {
    if (!person) return false;
    const unit = (state.portoUnits || []).find((entry) => entry.memberId === person.id && entry.active !== false && entry.vehicleNumber);
    if (!unit) return false;
    const nowMs = now.getTime();
    const removeMs = timestampMs(unit.autoRemoveAt);
    if (unit.autoOffline && removeMs && nowMs >= removeMs) return false;
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

  function activePortoUnitGroups(state) {
    const groups = new Map();
    const peopleById = new Map((state.people || []).map((person) => [person.id, person]));
    for (const unit of state.portoUnits || []) {
      if (unit.active === false || !unit.vehicleNumber) continue;
      const range = vehicleRangeForNumber(state, unit.vehicleNumber);
      const current = groups.get(unit.vehicleNumber) || {
        vehicleNumber: unit.vehicleNumber,
        vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
        vehicleType: unit.vehicleType || range?.vehicleType || "",
        vehicleName: unit.vehicleName || "",
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
        autoOffline: Boolean(unit.autoOffline),
        autoOfflineAt: unit.autoOfflineAt || "",
        autoRemoveAt: unit.autoRemoveAt || ""
      });
      groups.set(unit.vehicleNumber, current);
    }
    return [...groups.values()]
      .map((group) => ({ ...group, autoOffline: group.members.length > 0 && group.members.every((member) => member.autoOffline) }))
      .sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber, "nl", { numeric: true }));
  }

  function decoratePortoUnit(state, unit) {
    if (!unit) return null;
    const range = vehicleRangeForNumber(state, unit.vehicleNumber);
    const members = unit.vehicleNumber
      ? (state.portoUnits || [])
          .filter((entry) => entry.active !== false && entry.vehicleNumber === unit.vehicleNumber)
          .map((entry) => ({
            id: entry.id,
            memberId: entry.memberId,
            name: entry.name,
            rank: entry.rank,
            serviceNumber: entry.serviceNumber,
            phone: entry.phone,
            vehicleNumber: entry.vehicleNumber,
            vehicleCode: entry.vehicleCode || range?.vehicleCode || "",
            vehicleType: entry.vehicleType,
            status: entry.status,
            statusDetail: entry.statusDetail,
            vehicleName: entry.vehicleName || "",
            autoOffline: Boolean(entry.autoOffline),
            autoOfflineAt: entry.autoOfflineAt || "",
            autoRemoveAt: entry.autoRemoveAt || ""
          }))
      : [{
          id: unit.id,
          memberId: unit.memberId,
          name: unit.name,
          rank: unit.rank,
          serviceNumber: unit.serviceNumber,
          phone: unit.phone,
          vehicleNumber: unit.vehicleNumber,
          vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
          vehicleType: unit.vehicleType,
          status: unit.status,
          statusDetail: unit.statusDetail,
          vehicleName: unit.vehicleName || "",
          autoOffline: Boolean(unit.autoOffline),
          autoOfflineAt: unit.autoOfflineAt || "",
          autoRemoveAt: unit.autoRemoveAt || ""
        }];
    return {
      ...unit,
      vehicleCode: unit.vehicleCode || range?.vehicleCode || "",
      vehicleType: unit.vehicleType || range?.vehicleType || "",
      vehicleChoices: range?.vehicles || [],
      unitMembers: members
    };
  }

  function portoOpsPayload(state, person) {
    ensurePortoVehicleRanges(state);
    state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
    const currentOps = activePortoOps(state);
    const peopleById = new Map((state.people || []).map((entry) => [entry.id, entry]));
    const canTakeOps = canOperatePortoOps(person);
    const canManageOps = canTakeOps && (!currentOps || currentOps.memberId === person.id || (person.extraFunctions || []).includes("Kader"));
    const opsRequests = canManageOps
      ? state.portoUnits
          .filter((unit) => unit.active !== false && String(unit.status) === "0" && !unit.vehicleNumber)
          .map((unit) => ({
            id: unit.id,
            memberId: unit.memberId,
            name: unit.name,
            rank: unit.rank,
            serviceNumber: unit.serviceNumber,
            phone: unit.phone,
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
      canTakeOps,
      canManageOps,
      opsRequests,
      availableVehicleRanges: canManageOps ? availablePortoVehicleNumbers(state) : [],
      linkableUnits: canManageOps ? linkablePortoUnits(state) : [],
      activeUnits: canManageOps ? activePortoUnitGroups(state) : []
    };
  }

  return {
    defaultPortoVehicleRanges,
    ensurePortoVehicleRanges,
    canUsePortoDevBypass,
    canOperatePortoOps,
    activePortoOps,
    vehicleRangeForNumber,
    availablePortoVehicleNumbers,
    linkablePortoUnits,
    firstAvailableVehicleNumber,
    syncPortoLinkedNames,
    sweepPortoPresence,
    touchPortoPresence,
    activePortoUnitGroups,
    decoratePortoUnit,
    portoOpsPayload
  };
}

module.exports = { createPortoServices };





