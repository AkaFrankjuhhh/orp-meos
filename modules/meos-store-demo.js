"use strict";

const { buildDemoMeosPeople, normalize, slugFromValue } = require("./meos-demo-data");
const { filterProcessVerbals, normalizeProcessVerbal, updateProcessVerbal } = require("./meos-process-verbals");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeLimit(value, fallback = 250, max = 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function personSearchFields(person, field = "all") {
  const fields = {
    name: [person.name],
    bsn: [person.bsn],
    fingerprint: [person.fingerprint],
    birthDate: [person.birthDate],
    all: [person.name, person.bsn, person.fingerprint, person.birthDate, person.status]
  };
  return fields[field] || fields.all;
}

function personSearchQueries(query, field = "all") {
  const raw = String(query || "").trim();
  const normalized = normalize(raw);
  const queries = new Set(normalized ? [normalized] : []);
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 4) {
    if (field === "bsn" || field === "all") queries.add(normalize(`ORP-BSN-${digits}`));
    if (field === "fingerprint" || field === "all") queries.add(normalize(`ORP-V-${digits}`));
  }
  return [...queries].filter(Boolean);
}

function searchTokens(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function editDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function fuzzyTokenMatches(queryToken, targetToken) {
  if (!queryToken || !targetToken) return false;
  if (targetToken.includes(queryToken) || queryToken.includes(targetToken)) return true;
  if (queryToken.length === 1) return targetToken.startsWith(queryToken);
  const tolerance = queryToken.length >= 6 ? 2 : 1;
  return editDistance(queryToken, targetToken) <= tolerance;
}

function fuzzyNameMatches(name, query) {
  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return true;
  const nameTokens = searchTokens(name);
  return queryTokens.every((queryToken) => nameTokens.some((targetToken) => fuzzyTokenMatches(queryToken, targetToken)));
}

function personMatchesSearch(person, field, query) {
  const queries = personSearchQueries(query, field);
  if (!queries.length) return true;
  if ((field === "name" || field === "all") && fuzzyNameMatches(person.name, query)) return true;
  return personSearchFields(person, field).some((value) => {
    const normalizedValue = normalize(value);
    return queries.some((candidate) => normalizedValue.includes(candidate));
  });
}

function vehicleSearchFields(vehicle) {
  return [
    vehicle.plate,
    vehicle.model,
    vehicle.owner,
    vehicle.primaryColor,
    vehicle.secondaryColor,
    vehicle.stolen,
    vehicle.stolenReason,
    vehicle.stolenDate,
    vehicle.impounded,
    vehicle.wok,
    vehicle.apkStatus,
    vehicle.vin
  ];
}

function vehicleSlug(vehicle) {
  return slugFromValue(vehicle?.plate || "voertuig", "voertuig");
}

function enrichVehicle(vehicle, person) {
  return {
    ...vehicle,
    owner: vehicle.owner || person.name,
    ownerId: person.id,
    ownerSlug: slugFromValue(person.name)
  };
}

function entryId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function fallbackEntryIndex(entryId, prefix) {
  const match = String(entryId || "").match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
  if (!match) return -1;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

function deleteFromPersonCollection(person, collection, entryId, fallbackPrefix) {
  const entries = Array.isArray(person[collection]) ? person[collection] : [];
  const normalizedId = normalize(entryId);
  let index = entries.findIndex((entry) => normalize(entry?.id) === normalizedId);
  if (index === -1) {
    const fallbackIndex = fallbackEntryIndex(entryId, fallbackPrefix);
    if (fallbackIndex >= 0 && fallbackIndex < entries.length) index = fallbackIndex;
  }
  if (index === -1) {
    const error = new Error("MEOS item niet gevonden.");
    error.status = 404;
    throw error;
  }
  const [deleted] = entries.splice(index, 1);
  person[collection] = entries;
  return deleted || null;
}

class DemoMeosStore {
  constructor(options = {}) {
    this.people = Array.isArray(options.people) ? clone(options.people) : buildDemoMeosPeople();
    this.processVerbals = Array.isArray(options.processVerbals) ? clone(options.processVerbals).map((entry) => normalizeProcessVerbal(entry)) : [];
    this.source = {
      type: "demo",
      label: "MEOS demo conceptdata",
      live: false
    };
  }

  allVehicles() {
    return this.people.flatMap((person) => (person.vehicles || []).map((vehicle) => enrichVehicle(vehicle, person)));
  }

  activeArrestWarrants() {
    return this.people.flatMap((person) => (person.arrestWarrants || [])
      .filter((warrant) => normalize(warrant.status || "actief") !== "gesloten")
      .map((warrant) => ({
        ...warrant,
        person: {
          id: person.id,
          name: person.name,
          bsn: person.bsn,
          fingerprint: person.fingerprint,
          birthDate: person.birthDate,
          status: person.status
        }
      })));
  }

  async listPeople(options = {}) {
    const query = String(options.query || "");
    const field = options.field || "all";
    const limit = normalizeLimit(options.limit);
    const rows = query
      ? this.people.filter((person) => personMatchesSearch(person, field, query))
      : this.people;
    return clone(rows.slice(0, limit));
  }

  async getPerson(value) {
    const person = this.findPersonRef(value);
    return person ? clone(person) : null;
  }

  findPersonRef(value) {
    const normalized = normalize(value);
    const slug = String(value || "").trim().toLowerCase();
    const identityQueries = new Set(personSearchQueries(value, "all"));
    return this.people.find((candidate) => {
      return normalize(candidate.id) === normalized
        || slugFromValue(candidate.name).toLowerCase() === slug
        || normalize(candidate.name) === normalized
        || normalize(candidate.bsn) === normalized
        || normalize(candidate.fingerprint) === normalized
        || identityQueries.has(normalize(candidate.bsn))
        || identityQueries.has(normalize(candidate.fingerprint));
    }) || null;
  }

  async listVehicles(options = {}) {
    const query = normalize(options.query);
    const limit = normalizeLimit(options.limit);
    const vehicles = this.allVehicles();
    const rows = query
      ? vehicles.filter((vehicle) => vehicleSearchFields(vehicle).some((value) => normalize(value).includes(query)))
      : vehicles;
    return clone(rows.slice(0, limit));
  }

  async getVehicle(value) {
    const normalized = normalize(value);
    const slug = String(value || "").trim().toLowerCase();
    const vehicle = this.allVehicles().find((candidate) => {
      return normalize(candidate.plate) === normalized
        || vehicleSlug(candidate).toLowerCase() === slug
        || normalize(candidate.vin) === normalized;
    });
    return vehicle ? clone(vehicle) : null;
  }

  async listWarrants(options = {}) {
    const limit = normalizeLimit(options.limit);
    return clone(this.activeArrestWarrants().slice(0, limit));
  }

  async search(options = {}) {
    const limit = normalizeLimit(options.limit, 8, 50);
    const query = options.query || "";
    const [people, vehicles] = await Promise.all([
      this.listPeople({ query, limit }),
      this.listVehicles({ query, limit })
    ]);
    return {
      people: people.slice(0, limit),
      vehicles: vehicles.slice(0, limit)
    };
  }

  async listProcessVerbals(options = {}) {
    return clone(filterProcessVerbals(this.processVerbals, options));
  }

  async addProcessVerbal(processVerbal = {}) {
    const nextProcessVerbal = normalizeProcessVerbal(processVerbal);
    this.processVerbals = [nextProcessVerbal, ...this.processVerbals];
    return { processVerbal: clone(nextProcessVerbal) };
  }

  async updateProcessVerbal(processVerbalId, patch = {}, options = {}) {
    const index = this.processVerbals.findIndex((entry) => normalize(entry.id) === normalize(processVerbalId));
    if (index === -1) {
      const error = new Error("Proces-verbaal niet gevonden.");
      error.status = 404;
      throw error;
    }
    const nextProcessVerbal = updateProcessVerbal(this.processVerbals[index], patch, options);
    this.processVerbals[index] = nextProcessVerbal;
    return { processVerbal: clone(nextProcessVerbal) };
  }

  async sourceHealth() {
    const vehicles = this.allVehicles();
    const warrants = this.activeArrestWarrants();
    const housingCount = this.people.reduce((total, person) => total + (Array.isArray(person.houses) ? person.houses.length : 0), 0);
    return {
      ok: true,
      status: "healthy",
      checkedAt: new Date().toISOString(),
      dataSource: this.source,
      configured: true,
      driver: "demo",
      framework: "demo",
      counts: {
        players: this.people.length,
        vehicles: vehicles.length,
        housing: housingCount,
        warrants: warrants.length
      },
      checks: [
        { key: "players", label: "Spelers", view: "demo.people", required: true, ok: true, available: true, missing: false, count: this.people.length },
        { key: "vehicles", label: "Voertuigen", view: "demo.vehicles", required: true, ok: true, available: true, missing: false, count: vehicles.length },
        { key: "housing", label: "Huisvestigingen", view: "demo.houses", required: false, ok: true, available: true, missing: false, count: housingCount },
        { key: "warrants", label: "Arrestatiebevelen", view: "demo.warrants", required: false, ok: true, available: true, missing: false, count: warrants.length }
      ],
      durationMs: 0
    };
  }

  async addPersonRecord(personValue, record = {}) {
    const person = this.findPersonRef(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const nextRecord = {
      id: record.id || entryId("PV"),
      date: String(record.date || "").trim(),
      sanction: String(record.sanction || "").trim(),
      verbalist: String(record.verbalist || "").trim(),
      note: String(record.note || "").trim(),
      source: String(record.source || "").trim(),
      articleIds: Array.isArray(record.articleIds) ? record.articleIds.map((value) => String(value || "").trim()).filter(Boolean) : [],
      articleSelections: Array.isArray(record.articleSelections) ? clone(record.articleSelections) : [],
      calculatedTotals: record.calculatedTotals && typeof record.calculatedTotals === "object" ? clone(record.calculatedTotals) : null,
      createdAt: new Date().toISOString(),
      createdBy: record.createdBy || null
    };
    person.records = [nextRecord, ...(person.records || [])];
    return {
      record: clone(nextRecord),
      person: clone(person)
    };
  }

  async addPersonNote(personValue, note = {}) {
    const person = this.findPersonRef(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const nextNote = {
      id: note.id || entryId("NT"),
      date: String(note.date || "").trim(),
      author: String(note.author || "").trim(),
      note: String(note.note || "").trim(),
      createdAt: new Date().toISOString(),
      createdBy: note.createdBy || null
    };
    person.notes = [nextNote, ...(person.notes || [])];
    return {
      note: clone(nextNote),
      person: clone(person)
    };
  }

  async addPersonFine(personValue, fine = {}) {
    const person = this.findPersonRef(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const nextFine = {
      id: fine.id || entryId("BT"),
      fine: String(fine.fine || "").trim(),
      amount: String(fine.amount || "").trim(),
      writtenAt: String(fine.writtenAt || "").trim(),
      writtenBy: String(fine.writtenBy || "").trim(),
      articleIds: Array.isArray(fine.articleIds) ? fine.articleIds.map((value) => String(value || "").trim()).filter(Boolean) : [],
      createdAt: new Date().toISOString(),
      createdBy: fine.createdBy || null
    };
    person.fines = [nextFine, ...(person.fines || [])];
    return {
      fine: clone(nextFine),
      person: clone(person)
    };
  }

  async deletePersonRecord(personValue, recordId) {
    const person = this.findPersonRef(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const deleted = deleteFromPersonCollection(person, "records", recordId, "record");
    return {
      deleted: { type: "record", id: recordId, entry: clone(deleted) },
      person: clone(person)
    };
  }

  async deletePersonNote(personValue, noteId) {
    const person = this.findPersonRef(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const deleted = deleteFromPersonCollection(person, "notes", noteId, "note");
    return {
      deleted: { type: "note", id: noteId, entry: clone(deleted) },
      person: clone(person)
    };
  }

  async deletePersonFine(personValue, fineId) {
    const person = this.findPersonRef(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const deleted = deleteFromPersonCollection(person, "fines", fineId, "fine");
    return {
      deleted: { type: "fine", id: fineId, entry: clone(deleted) },
      person: clone(person)
    };
  }

  async snapshot() {
    return {
      dataSource: this.source,
      generatedAt: new Date().toISOString(),
      people: clone(this.people),
      vehicles: clone(this.allVehicles()),
      warrants: clone(this.activeArrestWarrants())
    };
  }
}

function createDemoMeosStore(options = {}) {
  return new DemoMeosStore(options);
}

module.exports = {
  DemoMeosStore,
  createDemoMeosStore,
  normalizeLimit,
  personMatchesSearch,
  personSearchQueries,
  personSearchFields,
  fuzzyNameMatches,
  vehicleSearchFields,
  vehicleSlug
};
