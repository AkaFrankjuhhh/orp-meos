"use strict";

const { splitRangeByOperationalWeeks } = require("./operational-weeks");

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

function peopleIndexes(people) {
  const byId = new Map();
  const byDiscordId = new Map();
  const byServiceNumber = new Map();
  const byName = new Map();
  for (const person of Array.isArray(people) ? people : []) {
    if (!person || !person.id) continue;
    byId.set(String(person.id), person);
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

function unitParticipants(unit, indexes) {
  const participants = [];
  const seen = new Set();
  const add = (person) => {
    if (!person || !person.id || seen.has(String(person.id))) return;
    seen.add(String(person.id));
    participants.push(person);
  };
  add(findPerson(unit, indexes));
  const linked = [
    ...(Array.isArray(unit.linkedWith) ? unit.linkedWith : []),
    ...(Array.isArray(unit.linkedMembers) ? unit.linkedMembers : []),
    ...(Array.isArray(unit.members) ? unit.members : [])
  ];
  for (const reference of linked) add(findPerson(reference, indexes));
  return participants;
}

function unitEndDate(unit, now) {
  const status = String(unit.status || "");
  const active = unit.active !== false && status !== "8";
  if (active) return now;
  return asDate(unit.endedAt) || asDate(unit.lastSeenAt) || asDate(unit.updatedAt) || now;
}

function buildPortoDutyHourEntries(state, options = {}) {
  const now = asDate(options.now) || new Date();
  const timeZone = options.timeZone || "Europe/Amsterdam";
  const units = Array.isArray(state?.portoUnits) ? state.portoUnits : [];
  const indexes = peopleIndexes(state?.people);
  const entries = [];
  for (const unit of units) {
    if (!unit) continue;
    const startedAt = asDate(unit.assignedAt);
    if (!startedAt) continue;
    const endedAt = unitEndDate(unit, now);
    if (!endedAt || endedAt <= startedAt) continue;
    const participants = unitParticipants(unit, indexes);
    if (!participants.length) continue;
    const segments = splitRangeByOperationalWeeks(startedAt, endedAt, { timeZone });
    for (const person of participants) {
      for (const segment of segments) {
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
          enteredById: "system:porto-duty-clock",
          enteredByName: "Porto diensturen klok",
          enteredAt: now.toISOString(),
          source: "porto-duty-clock",
          sourceUnitId: unit.id || "",
          sourceVehicleNumber: unit.vehicleNumber || ""
        });
      }
    }
  }
  return entries;
}

module.exports = { buildPortoDutyHourEntries };
