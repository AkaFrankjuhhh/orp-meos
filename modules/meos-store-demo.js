"use strict";

const { buildDemoMeosPeople, normalize, slugFromValue } = require("./meos-demo-data");

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

function personMatchesSearch(person, field, query) {
  const queries = personSearchQueries(query, field);
  if (!queries.length) return true;
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
  vehicleSearchFields,
  vehicleSlug
};
