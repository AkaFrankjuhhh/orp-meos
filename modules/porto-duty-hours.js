"use strict";

const { splitRangeByOperationalWeeks } = require("./operational-weeks");
const { isCurrentPerson } = require("./person-status");

const PORTO_DUTY_HOURS_SOURCE = "porto-duty-clock";
const PORTO_DUTY_HOURS_ENTERED_BY_ID = "system:porto-duty-clock";
const DEFAULT_PORTO_DUTY_HOURS_START_WEEK = "2026-W26";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function safeIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function asDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function parsePortoDutyHoursStartWeek(value) {
  if (!value) return null;
  if (typeof value === "object") {
    const weekYear = Number(value.weekYear ?? value.year);
    const weekNumber = Number(value.weekNumber ?? value.week);
    if (Number.isInteger(weekYear) && Number.isInteger(weekNumber) && weekNumber >= 1 && weekNumber <= 53) {
      return { weekYear, weekNumber };
    }
    return null;
  }
  const match = String(value).trim().match(/^(\d{4})\s*[-_/ ]?\s*w?(\d{1,2})$/i);
  if (!match) return null;
  const weekYear = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (!Number.isInteger(weekYear) || !Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53) return null;
  return { weekYear, weekNumber };
}

function weekIsBefore(weekYear, weekNumber, startWeek) {
  if (!startWeek) return false;
  const year = Number(weekYear);
  const week = Number(weekNumber);
  if (!Number.isInteger(year) || !Number.isInteger(week)) return false;
  if (year !== startWeek.weekYear) return year < startWeek.weekYear;
  return week < startWeek.weekNumber;
}

function isPortoDutyClockEntry(entry) {
  if (!entry) return false;
  if (entry.source === PORTO_DUTY_HOURS_SOURCE) return true;
  if (entry.enteredById === PORTO_DUTY_HOURS_ENTERED_BY_ID) return true;
  return String(entry.id || "").startsWith("porto-duty-");
}

function filterPortoDutyHourEntriesByStartWeek(entries, startWeekInput = DEFAULT_PORTO_DUTY_HOURS_START_WEEK) {
  if (!Array.isArray(entries)) return [];
  const startWeek = parsePortoDutyHoursStartWeek(startWeekInput);
  if (!startWeek) return entries;
  return entries.filter((entry) => {
    if (!isPortoDutyClockEntry(entry)) return true;
    return !weekIsBefore(entry.weekYear, entry.weekNumber, startWeek);
  });
}

function peopleIndexes(people) {
  const byId = new Map();
  const byDiscordId = new Map();
  const byServiceNumber = new Map();
  const byName = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    if (!person || !person.id) continue;
    byId.set(String(person.id), person);
    if (!isCurrentPerson(person)) continue;
    if (person.discordId) byDiscordId.set(normalize(person.discordId), person);
    if (person.serviceNumber) byServiceNumber.set(normalize(person.serviceNumber), person);
    if (person.name) byName.set(normalize(person.name), person);
  }
  return { byId, byDiscordId, byServiceNumber, byName };
}

function findPerson(reference, indexes) {
  if (!reference) return null;
  if (typeof reference === "string") {
    return indexes.byId.get(reference)
      || indexes.byServiceNumber.get(normalize(reference))
      || indexes.byDiscordId.get(normalize(reference))
      || indexes.byName.get(normalize(reference))
      || null;
  }
  const id = reference.personId || reference.memberId || reference.id;
  if (id && indexes.byId.has(String(id))) return indexes.byId.get(String(id));
  if (reference.discordId && indexes.byDiscordId.has(normalize(reference.discordId))) return indexes.byDiscordId.get(normalize(reference.discordId));
  if (reference.serviceNumber && indexes.byServiceNumber.has(normalize(reference.serviceNumber))) return indexes.byServiceNumber.get(normalize(reference.serviceNumber));
  if (reference.name && indexes.byName.has(normalize(reference.name))) return indexes.byName.get(normalize(reference.name));
  return null;
}

function groupedParticipantIdsByVehicle(units, indexes) {
  const byVehicle = new Map();
  for (const unit of Array.isArray(units) ? units : []) {
    const vehicleNumber = dutyVehicleNumberForUnit(unit);
    if (!vehicleNumber) continue;
    const person = findPerson(unit, indexes);
    if (!person?.id) continue;
    const current = byVehicle.get(vehicleNumber) || new Set();
    current.add(String(person.id));
    byVehicle.set(vehicleNumber, current);
  }
  return byVehicle;
}

function unitParticipants(unit, indexes, groupedIdsByVehicle = new Map()) {
  const participants = [];
  const seen = new Set();
  const add = (person) => {
    if (!person || !person.id || seen.has(String(person.id))) return;
    seen.add(String(person.id));
    participants.push(person);
  };
  const owner = findPerson(unit, indexes);
  add(owner);
  const vehicleNumber = dutyVehicleNumberForUnit(unit);
  const groupedIds = vehicleNumber ? groupedIdsByVehicle.get(vehicleNumber) : null;
  const linked = [
    ...(Array.isArray(unit.linkedWith) ? unit.linkedWith : []),
    ...(Array.isArray(unit.linkedMembers) ? unit.linkedMembers : []),
    ...(Array.isArray(unit.members) ? unit.members : [])
  ];
  for (const reference of linked) {
    const person = findPerson(reference, indexes);
    if (person?.id && groupedIds?.has(String(person.id)) && String(person.id) !== String(owner?.id || "")) continue;
    add(person);
  }
  return participants;
}

function unitEndDate(unit, now) {
  const status = String(unit.status || "");
  const active = unit.active !== false && status !== "8";
  if (active) return now;
  return asDate(unit.endedAt) || asDate(unit.lastSeenAt) || asDate(unit.updatedAt) || now;
}

function dutyVehicleNumberForUnit(unit) {
  return String(unit?.vehicleNumber || unit?.previousVehicleNumber || unit?.endedVehicleNumber || "").trim();
}

function buildPortoDutyHourEntries(state, options = {}) {
  const now = asDate(options.now) || new Date();
  const timeZone = options.timeZone || "Europe/Amsterdam";
  const startWeek = parsePortoDutyHoursStartWeek(options.startWeek);
  const units = Array.isArray(state?.portoUnits) ? state.portoUnits : [];
  const indexes = peopleIndexes(state?.people);
  const groupedIdsByVehicle = groupedParticipantIdsByVehicle(units, indexes);
  const entries = [];
  for (const unit of units) {
    if (!unit) continue;
    const startedAt = asDate(unit.assignedAt);
    if (!startedAt) continue;
    const endedAt = unitEndDate(unit, now);
    if (!endedAt || endedAt <= startedAt) continue;
    const participants = unitParticipants(unit, indexes, groupedIdsByVehicle);
    if (!participants.length) continue;
    const segments = splitRangeByOperationalWeeks(startedAt, endedAt, { timeZone });
    for (const person of participants) {
      for (const segment of segments) {
        if (weekIsBefore(segment.weekYear, segment.weekNumber, startWeek)) continue;
        const minutes = Number(segment.minutes || 0);
        if (minutes <= 0) continue;
        const id = [
          "porto-duty",
          safeIdPart(unit.id || unit.vehicleNumber || unit.serviceNumber || unit.name),
          safeIdPart(startedAt.toISOString()),
          safeIdPart(person.id),
          segment.weekYear,
          segment.weekNumber
        ].join("-");
        entries.push({
          id,
          personId: person.id,
          discordId: person.discordId || "",
          job: "Porto dienst",
          weekYear: segment.weekYear,
          weekNumber: segment.weekNumber,
          hours: Number((minutes / 60).toFixed(2)),
          minutes,
          startedAt: segment.startedAt.toISOString(),
          endedAt: segment.endedAt.toISOString(),
          enteredById: PORTO_DUTY_HOURS_ENTERED_BY_ID,
          enteredByName: "Porto diensturen klok",
          enteredAt: now.toISOString(),
          source: PORTO_DUTY_HOURS_SOURCE,
          sourceUnitId: unit.id || "",
          sourceVehicleNumber: dutyVehicleNumberForUnit(unit)
        });
      }
    }
  }
  return entries;
}

function portoDutyHourCleanupGroups(entries) {
  const groups = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isPortoDutyClockEntry(entry)) continue;
    const sourceUnitId = String(entry.sourceUnitId || "").trim();
    const weekYear = Number(entry.weekYear || 0);
    const weekNumber = Number(entry.weekNumber || 0);
    const id = String(entry.id || "").trim();
    if (!sourceUnitId || !Number.isInteger(weekYear) || !Number.isInteger(weekNumber) || !id) continue;
    const key = `${sourceUnitId}::${weekYear}::${weekNumber}`;
    const group = groups.get(key) || { sourceUnitId, weekYear, weekNumber, ids: new Set() };
    group.ids.add(id);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    ids: [...group.ids]
  }));
}

module.exports = {
  DEFAULT_PORTO_DUTY_HOURS_START_WEEK,
  PORTO_DUTY_HOURS_ENTERED_BY_ID,
  PORTO_DUTY_HOURS_SOURCE,
  buildPortoDutyHourEntries,
  filterPortoDutyHourEntriesByStartWeek,
  portoDutyHourCleanupGroups,
  parsePortoDutyHoursStartWeek
};
