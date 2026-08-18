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
    const query = normalize(options.query);
    const field = options.field || "all";
    const limit = normalizeLimit(options.limit);
    const rows = query
      ? this.people.filter((person) => personSearchFields(person, field).some((value) => normalize(value).includes(query)))
      : this.people;
    return clone(rows.slice(0, limit));
  }

  async getPerson(value) {
    const normalized = normalize(value);
    const slug = String(value || "").trim().toLowerCase();
    const person = this.people.find((candidate) => {
      return normalize(candidate.id) === normalized
        || slugFromValue(candidate.name).toLowerCase() === slug
        || normalize(candidate.name) === normalized
        || normalize(candidate.bsn) === normalized
        || normalize(candidate.fingerprint) === normalized;
    });
    return person ? clone(person) : null;
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
  personSearchFields,
  vehicleSearchFields,
  vehicleSlug
};
