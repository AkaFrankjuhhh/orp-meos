const crypto = require("node:crypto");
const { createPortoServices } = require("./porto");

function activePersonForAuth(state, auth) {
  return (state.people || []).find((entry) => entry.id === auth.profile.id && entry.status === "Actief");
}

function createPortoRouteHandler({ requireAuth, readState, writeState, writePortoSettings, writePortoPhone, writePortoUnits, readBody, sendJson }) {
  const {
    ensurePortoVehicleRanges,
    canUsePortoDevBypass,
    canOperatePortoOps,
    activePortoOps,
    vehicleRangeForNumber,
    availablePortoVehicleNumbers,
    firstAvailableVehicleNumber,
    syncPortoLinkedNames,
    sweepPortoPresence,
    touchPortoPresence,
    decoratePortoUnit,
    portoOpsPayload
  } = createPortoServices();

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

  async function maintainPortoPresence(state, person, { touch = true } = {}) {
    const changedBySweep = sweepPortoPresence(state);
    const changedByTouch = touch ? touchPortoPresence(state, person) : false;
    if (changedBySweep || changedByTouch) await persistPortoState(state, { units: state.portoUnits });
    return changedBySweep || changedByTouch;
  }

  async function sendPortoState(res, state, person, unit = null, extra = {}) {
    await maintainPortoPresence(state, person);
    sendJson(res, 200, {
      ...extra,
      unit: decoratePortoUnit(state, unit),
      profile: person,
      vehicleRanges: state.portoVehicleRanges,
      ...portoOpsPayload(state, person)
    });
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

    if (url.pathname === "/api/porto/profile" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const body = await readBody(req);
      person.portoPhone = String(body.portoPhone || "").trim().slice(0, 40);
      await persistPortoState(state, { phonePerson: person });
      sendJson(res, 200, { profile: person });
      return true;
    }

    if (url.pathname === "/api/porto/status" && req.method === "GET") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const vehicleRangesChanged = ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const presenceChanged = await maintainPortoPresence(state, person);
      const unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false) || null;
      if (vehicleRangesChanged && !presenceChanged) await persistPortoState(state, { settings: true });
      await sendPortoState(res, state, person, unit);
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
      if (!new Set(["", "Afhandeling", "In hoofd", "Overige"]).has(detail)) {
        sendJson(res, 400, { error: "Ongeldige Status 4 reden." });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const now = new Date().toISOString();
      sweepPortoPresence(state);
      let unit = state.portoUnits.find((entry) => entry.memberId === person.id && entry.active !== false);
      if (!unit && status !== "0") {
        sendJson(res, 409, { error: "Je moet eerst Status 0 doen voordat OPS je kan indelen." });
        return true;
      }
      if (unit && !unit.vehicleNumber && !["0", "8"].includes(status)) {
        sendJson(res, 409, { error: "Wacht op OPS-indeling voordat je deze status gebruikt." });
        return true;
      }
      if (!unit) {
        unit = { id: crypto.randomUUID(), memberId: person.id, linkedWith: [], reviewStatus: "pending", requestedAt: now, active: true };
        state.portoUnits.push(unit);
      }
      Object.assign(unit, {
        name: person.name,
        rank: person.rank,
        serviceNumber: person.serviceNumber,
        phone: person.portoPhone || "",
        status,
        statusDetail: status === "0" ? "Aangemeld bij OPS" : detail,
        lastSeenAt: now,
        updatedAt: now
      });
      delete unit.autoOffline;
      delete unit.autoOfflineAt;
      delete unit.autoRemoveAt;
      if (status === "0") {
        unit.reviewStatus = "pending";
        unit.requestedAt = unit.requestedAt || now;
      }
      if (status === "8") {
        const releasedVehicleNumber = unit.vehicleNumber;
        unit.active = false;
        unit.endedAt = now;
        if (releasedVehicleNumber) syncPortoLinkedNames(state, releasedVehicleNumber);
      }
      await persistPortoState(state, { units: state.portoUnits });
      await sendPortoState(res, state, person, unit);
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
      const ops = activePortoOps(state);
      const isKader = (person.extraFunctions || []).includes("Kader");
      if (!canUsePortoDevBypass(person) && (!ops || (ops.memberId !== person.id && !isKader))) {
        sendJson(res, 403, { error: "Alleen de huidige OPS, Kader of het dev-profiel mag testaanmeldingen maken." });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      sweepPortoPresence(state);
      const activeMemberIds = new Set(state.portoUnits.filter((unit) => unit.active !== false).map((unit) => unit.memberId));
      const candidates = (state.people || []).filter((entry) => entry.status === "Actief" && entry.id !== person.id && !activeMemberIds.has(entry.id));
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
        statusDetail: "Aangemeld bij OPS",
        linkedWith: [],
        reviewStatus: "dev-test",
        requestedAt: now,
        updatedAt: now,
        active: true,
        createdById: person.id,
        createdByName: person.name
      });
      await persistPortoState(state, { units: state.portoUnits });
      sendJson(res, 200, { devTestPerson: { id: picked.id, name: picked.name }, vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
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
        sendJson(res, 409, { error: "Je bent nog niet ingedeeld door OPS." });
        return true;
      }
      const range = vehicleRangeForNumber(state, unit.vehicleNumber);
      if (!range || !(range.vehicles || []).includes(vehicleName)) {
        sendJson(res, 400, { error: "Kies een voertuig dat binnen jouw roepnummerreeks valt." });
        return true;
      }
      const now = new Date().toISOString();
      touchPortoPresence(state, person, new Date(now));
      for (const entry of state.portoUnits || []) {
        if (entry.active !== false && entry.vehicleNumber === unit.vehicleNumber) {
          entry.vehicleCode = range.vehicleCode;
          entry.vehicleType = range.vehicleType;
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
      if (!canOperatePortoOps(person)) {
        sendJson(res, 403, { error: "Alleen medewerkers met OPS-bevoegdheid mogen OPS oppakken." });
        return true;
      }
      const body = await readBody(req);
      const action = String(body.action || "claim").trim();
      const currentOps = activePortoOps(state);
      if (action === "claim") {
        if (currentOps && currentOps.memberId !== person.id) {
          sendJson(res, 409, { error: `OPS is al in dienst: ${currentOps.name}.` });
          return true;
        }
        state.portoCurrentOps = { memberId: person.id, name: person.name, serviceNumber: person.serviceNumber, startedAt: currentOps?.startedAt || new Date().toISOString(), active: true };
        await persistPortoState(state, { settings: true });
        sendJson(res, 200, portoOpsPayload(state, person));
        return true;
      }
      if (action === "release") {
        if (!currentOps || (currentOps.memberId !== person.id && !(person.extraFunctions || []).includes("Kader"))) {
          sendJson(res, 403, { error: "Alleen de huidige OPS of Kader kan OPS afsluiten." });
          return true;
        }
        state.portoCurrentOps = { ...currentOps, active: false, endedAt: new Date().toISOString() };
        await persistPortoState(state, { settings: true });
        sendJson(res, 200, portoOpsPayload(state, person));
        return true;
      }
      sendJson(res, 400, { error: "Ongeldige OPS actie." });
      return true;
    }

    if (url.pathname === "/api/porto/reassign" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const ops = activePortoOps(state);
      const isKader = (person.extraFunctions || []).includes("Kader");
      if (!ops || (ops.memberId !== person.id && !isKader)) {
        sendJson(res, 403, { error: "Alleen de huidige OPS mag eenheden aanpassen." });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const body = await readBody(req);
      const unitId = String(body.unitId || "").trim();
      const vehiclePrefix = String(body.vehiclePrefix || "").trim();
      const linkToVehicleNumber = String(body.linkToVehicleNumber || "").trim();
      const exactVehicleNumber = String(body.vehicleNumber || "").trim();
      const newStatus = String(body.status || "").trim();
      const newStatusDetail = String(body.statusDetail || "").trim();
      const offDuty = Boolean(body.offDuty);
      const offDutyScope = String(body.offDutyScope || "vehicle").trim();
      const unit = state.portoUnits.find((entry) => entry.id === unitId && entry.active !== false && entry.vehicleNumber)
        || (offDuty && exactVehicleNumber ? state.portoUnits.find((entry) => entry.active !== false && entry.vehicleNumber === exactVehicleNumber) : null);
      if (!unit) {
        sendJson(res, 404, { error: "Actieve eenheid niet gevonden." });
        return true;
      }
      if (offDuty) {
        const oldVehicleNumber = exactVehicleNumber || unit.vehicleNumber;
        const endedAt = new Date().toISOString();
        const unitsToEnd = offDutyScope === "member"
          ? [unit]
          : state.portoUnits.filter((entry) => entry.active !== false && entry.vehicleNumber === oldVehicleNumber);
        unitsToEnd.forEach((entry) => Object.assign(entry, {
          status: "8",
          statusDetail: "Uit dienst",
          active: false,
          vehicleNumber: "",
          vehicleCode: "",
          vehicleType: "",
          vehicleName: "",
          linkedWith: [],
          endedById: person.id,
          endedByName: person.name,
          endedAt,
          updatedAt: endedAt
        }));
        syncPortoLinkedNames(state, oldVehicleNumber);
        await persistPortoState(state, { units: state.portoUnits });
        sendJson(res, 200, { unit: decoratePortoUnit(state, unit), vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
        return true;
      }
      if (newStatus) {
        const allowedStatuses = new Set(["1", "2", "3", "4", "5", "6", "7"]);
        if (!allowedStatuses.has(newStatus)) {
          sendJson(res, 400, { error: "Kies een geldige status." });
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
        sendJson(res, 200, { unit: decoratePortoUnit(state, unit), vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
        return true;
      }

      const oldVehicleNumber = unit.vehicleNumber;
      let vehicleNumber = "";
      let range = null;
      if (exactVehicleNumber) {
        if (exactVehicleNumber === unit.vehicleNumber) {
          sendJson(res, 200, { unit: decoratePortoUnit(state, unit), vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
          return true;
        }
        range = vehicleRangeForNumber(state, exactVehicleNumber);
        if (!range) {
          sendJson(res, 400, { error: "Kies een geldig roepnummer." });
          return true;
        }
        const exactInUse = state.portoUnits.some((entry) => entry.active !== false && entry.id !== unit.id && entry.vehicleNumber === exactVehicleNumber);
        if (exactInUse) {
          sendJson(res, 409, { error: "Dit roepnummer is al in gebruik." });
          return true;
        }
        vehicleNumber = exactVehicleNumber;
        unit.vehicleName = "";
        unit.reviewStatus = "number-changed";
      } else if (linkToVehicleNumber) {
        if (linkToVehicleNumber === unit.vehicleNumber) {
          sendJson(res, 200, { unit: decoratePortoUnit(state, unit), vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
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
      Object.assign(unit, { vehicleNumber, vehicleCode: range.vehicleCode, vehicleType: range.vehicleType, assignedById: person.id, assignedByName: person.name, assignedAt: new Date().toISOString() });
      unit.updatedAt = unit.assignedAt;
      unit.lastSeenAt = unit.lastSeenAt || unit.assignedAt;
      syncPortoLinkedNames(state, oldVehicleNumber);
      syncPortoLinkedNames(state, vehicleNumber);
      await persistPortoState(state, { units: state.portoUnits });
      sendJson(res, 200, { unit: decoratePortoUnit(state, unit), vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
      return true;
    }

    if (url.pathname === "/api/porto/assign" && req.method === "POST") {
      const context = await requireActivePerson(req, res);
      if (!context) return true;
      const { state, person } = context;
      const ops = activePortoOps(state);
      const isKader = (person.extraFunctions || []).includes("Kader");
      if (!ops || (ops.memberId !== person.id && !isKader)) {
        sendJson(res, 403, { error: "Alleen de huidige OPS mag eenheden indelen." });
        return true;
      }
      ensurePortoVehicleRanges(state);
      state.portoUnits = Array.isArray(state.portoUnits) ? state.portoUnits : [];
      const body = await readBody(req);
      const unitId = String(body.unitId || "").trim();
      const vehiclePrefix = String(body.vehiclePrefix || "").trim();
      const linkToVehicleNumber = String(body.linkToVehicleNumber || "").trim();
      const unit = state.portoUnits.find((entry) => entry.id === unitId && entry.active !== false);
      if (!unit) {
        sendJson(res, 404, { error: "Aanmelding niet gevonden." });
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
      Object.assign(unit, {
        vehicleNumber,
        vehicleCode: range.vehicleCode,
        vehicleType: range.vehicleType,
        reviewStatus: linkToVehicleNumber ? "linked" : "assigned",
        assignedById: person.id,
        assignedByName: person.name,
        assignedAt: new Date().toISOString(),
        status: "1",
        statusDetail: "Beschikbaar"
      });
      unit.updatedAt = unit.assignedAt;
      unit.lastSeenAt = unit.lastSeenAt || unit.assignedAt;
      syncPortoLinkedNames(state, vehicleNumber);
      await persistPortoState(state, { units: state.portoUnits });
      sendJson(res, 200, { unit: decoratePortoUnit(state, unit), vehicleRanges: state.portoVehicleRanges, ...portoOpsPayload(state, person) });
      return true;
    }

    return false;
  }

  return handlePortoApi;
}

module.exports = { createPortoRouteHandler };




