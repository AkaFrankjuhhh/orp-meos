"use strict";

const { normalize, slugFromValue } = require("./meos-demo-data");
const { createDemoMeosStore, normalizeLimit, personSearchFields, vehicleSearchFields } = require("./meos-store-demo");
const { createFiveMMeosStore } = require("./meos-store-fivem");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function meosStoreConfigFromEnv(env = process.env) {
  return {
    dataSource: String(env.MEOS_DATA_SOURCE || "demo").trim().toLowerCase(),
    cacheTtlMs: Math.max(0, Number(env.MEOS_CACHE_TTL_MS || 15000)),
    fivemDriver: String(env.MEOS_FIVEM_DB_DRIVER || "mysql").trim().toLowerCase(),
    fivemFramework: String(env.MEOS_FIVEM_FRAMEWORK || "custom").trim().toLowerCase()
  };
}

function activeArrestWarrantsFromPeople(people) {
  return people.flatMap((person) => (person.arrestWarrants || [])
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

function vehiclesFromPeople(people) {
  return people.flatMap((person) => (person.vehicles || []).map((vehicle) => ({
    ...vehicle,
    owner: vehicle.owner || person.name,
    ownerId: vehicle.ownerId || person.id,
    ownerSlug: vehicle.ownerSlug || slugFromValue(person.name)
  })));
}

function normalizeSnapshot(snapshot = {}, source = {}) {
  const people = Array.isArray(snapshot.people) ? snapshot.people : [];
  const vehicles = Array.isArray(snapshot.vehicles) && snapshot.vehicles.length ? snapshot.vehicles : vehiclesFromPeople(people);
  const warrants = Array.isArray(snapshot.warrants) && snapshot.warrants.length ? snapshot.warrants : activeArrestWarrantsFromPeople(people);
  return {
    dataSource: snapshot.dataSource || source,
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    people,
    vehicles,
    warrants
  };
}

class CachedMeosStore {
  constructor(store, options = {}) {
    this.store = store;
    this.cacheTtlMs = Math.max(0, Number(options.cacheTtlMs || 0));
    this.source = {
      ...(store.source || { type: "unknown", label: "MEOS data" }),
      cacheTtlMs: this.cacheTtlMs
    };
    this.cachedSnapshot = null;
    this.cachedAt = 0;
  }

  async snapshot() {
    const now = Date.now();
    if (this.cachedSnapshot && this.cacheTtlMs > 0 && now - this.cachedAt < this.cacheTtlMs) {
      return clone(this.cachedSnapshot);
    }
    const snapshot = normalizeSnapshot(await this.store.snapshot(), this.source);
    this.cachedSnapshot = snapshot;
    this.cachedAt = now;
    return clone(snapshot);
  }

  async listPeople(options = {}) {
    const query = normalize(options.query);
    const field = options.field || "all";
    const limit = normalizeLimit(options.limit);
    const { people } = await this.snapshot();
    const rows = query
      ? people.filter((person) => personSearchFields(person, field).some((value) => normalize(value).includes(query)))
      : people;
    return rows.slice(0, limit);
  }

  async getPerson(value) {
    const normalized = normalize(value);
    const slug = String(value || "").trim().toLowerCase();
    const { people } = await this.snapshot();
    return people.find((person) => normalize(person.id) === normalized
      || slugFromValue(person.name).toLowerCase() === slug
      || normalize(person.name) === normalized
      || normalize(person.bsn) === normalized
      || normalize(person.fingerprint) === normalized) || null;
  }

  async listVehicles(options = {}) {
    const query = normalize(options.query);
    const limit = normalizeLimit(options.limit);
    const { vehicles } = await this.snapshot();
    const rows = query
      ? vehicles.filter((vehicle) => vehicleSearchFields(vehicle).some((value) => normalize(value).includes(query)))
      : vehicles;
    return rows.slice(0, limit);
  }

  async getVehicle(value) {
    const normalized = normalize(value);
    const slug = String(value || "").trim().toLowerCase();
    const { vehicles } = await this.snapshot();
    return vehicles.find((vehicle) => normalize(vehicle.plate) === normalized
      || slugFromValue(vehicle.plate, "voertuig").toLowerCase() === slug
      || normalize(vehicle.vin) === normalized) || null;
  }

  async listWarrants(options = {}) {
    const limit = normalizeLimit(options.limit);
    const { warrants } = await this.snapshot();
    return warrants.slice(0, limit);
  }

  async search(options = {}) {
    const limit = normalizeLimit(options.limit, 8, 50);
    const query = options.query || "";
    const [people, vehicles] = await Promise.all([
      this.listPeople({ query, limit }),
      this.listVehicles({ query, limit })
    ]);
    return { people, vehicles };
  }
}

function createMeosStore(options = {}) {
  const config = { ...meosStoreConfigFromEnv(options.env), ...options };
  const storeOptions = {
    ...config,
    driver: config.driver || config.fivemDriver,
    framework: config.framework || config.fivemFramework
  };
  const baseStore = config.dataSource === "fivem"
    ? createFiveMMeosStore(storeOptions)
    : createDemoMeosStore(config);
  return new CachedMeosStore(baseStore, { cacheTtlMs: config.cacheTtlMs });
}

let defaultStore = null;
let defaultStoreKey = "";

function getMeosStore() {
  const config = meosStoreConfigFromEnv();
  const key = JSON.stringify(config);
  if (!defaultStore || defaultStoreKey !== key) {
    defaultStore = createMeosStore(config);
    defaultStoreKey = key;
  }
  return defaultStore;
}

module.exports = {
  CachedMeosStore,
  createMeosStore,
  getMeosStore,
  meosStoreConfigFromEnv,
  normalizeSnapshot
};
