"use strict";

const { normalize, slugFromValue } = require("./meos-demo-data");
const { createDemoMeosStore, normalizeLimit, personMatchesSearch, personSearchQueries, vehicleSearchFields } = require("./meos-store-demo");
const { createFiveMMeosStore } = require("./meos-store-fivem");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function meosStoreConfigFromEnv(env = process.env) {
  return {
    dataSource: String(env.MEOS_DATA_SOURCE || "demo").trim().toLowerCase(),
    cacheTtlMs: Math.max(0, Number(env.MEOS_CACHE_TTL_MS || 15000)),
    fivemDriver: String(env.MEOS_FIVEM_DB_DRIVER || "mysql").trim().toLowerCase(),
    fivemFramework: String(env.MEOS_FIVEM_FRAMEWORK || "custom").trim().toLowerCase(),
    fivemPlayersView: String(env.MEOS_FIVEM_PLAYERS_VIEW || env.MEOS_FIVEM_PEOPLE_VIEW || "meos_people_view").trim(),
    fivemVehiclesView: String(env.MEOS_FIVEM_VEHICLES_VIEW || "meos_vehicles_view").trim(),
    fivemHousingView: String(env.MEOS_FIVEM_HOUSING_VIEW || "meos_housing_view").trim(),
    fivemWarrantsView: String(env.MEOS_FIVEM_WARRANTS_VIEW || "meos_arrest_warrants_view").trim()
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

  clearCache() {
    this.cachedSnapshot = null;
    this.cachedAt = 0;
  }

  async listPeople(options = {}) {
    const query = String(options.query || "");
    const field = options.field || "all";
    const limit = normalizeLimit(options.limit);
    const { people } = await this.snapshot();
    const rows = query
      ? people.filter((person) => personMatchesSearch(person, field, query))
      : people;
    return rows.slice(0, limit);
  }

  async getPerson(value) {
    const normalized = normalize(value);
    const slug = String(value || "").trim().toLowerCase();
    const identityQueries = new Set(personSearchQueries(value, "all"));
    const { people } = await this.snapshot();
    return people.find((person) => normalize(person.id) === normalized
      || slugFromValue(person.name).toLowerCase() === slug
      || normalize(person.name) === normalized
      || normalize(person.bsn) === normalized
      || normalize(person.fingerprint) === normalized
      || identityQueries.has(normalize(person.bsn))
      || identityQueries.has(normalize(person.fingerprint))) || null;
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

  async addPersonRecord(personValue, record = {}) {
    if (typeof this.store.addPersonRecord !== "function") {
      const error = new Error("Deze MEOS databron ondersteunt nog geen strafblad-writes.");
      error.status = 501;
      throw error;
    }
    const result = await this.store.addPersonRecord(personValue, record);
    this.clearCache();
    return result;
  }

  async addPersonNote(personValue, note = {}) {
    if (typeof this.store.addPersonNote !== "function") {
      const error = new Error("Deze MEOS databron ondersteunt nog geen notitie-writes.");
      error.status = 501;
      throw error;
    }
    const result = await this.store.addPersonNote(personValue, note);
    this.clearCache();
    return result;
  }

  async addPersonFine(personValue, fine = {}) {
    if (typeof this.store.addPersonFine !== "function") {
      const error = new Error("Deze MEOS databron ondersteunt nog geen boete-writes.");
      error.status = 501;
      throw error;
    }
    const result = await this.store.addPersonFine(personValue, fine);
    this.clearCache();
    return result;
  }

  async deletePersonRecord(personValue, recordId) {
    if (typeof this.store.deletePersonRecord !== "function") {
      const error = new Error("Deze MEOS databron ondersteunt nog geen strafblad-verwijderingen.");
      error.status = 501;
      throw error;
    }
    const result = await this.store.deletePersonRecord(personValue, recordId);
    this.clearCache();
    return result;
  }

  async deletePersonNote(personValue, noteId) {
    if (typeof this.store.deletePersonNote !== "function") {
      const error = new Error("Deze MEOS databron ondersteunt nog geen notitie-verwijderingen.");
      error.status = 501;
      throw error;
    }
    const result = await this.store.deletePersonNote(personValue, noteId);
    this.clearCache();
    return result;
  }

  async deletePersonFine(personValue, fineId) {
    if (typeof this.store.deletePersonFine !== "function") {
      const error = new Error("Deze MEOS databron ondersteunt nog geen boete-verwijderingen.");
      error.status = 501;
      throw error;
    }
    const result = await this.store.deletePersonFine(personValue, fineId);
    this.clearCache();
    return result;
  }
}

function createMeosStore(options = {}) {
  const config = { ...meosStoreConfigFromEnv(options.env), ...options };
  const storeOptions = {
    ...config,
    driver: config.driver || config.fivemDriver,
    framework: config.framework || config.fivemFramework,
    playersView: config.playersView || config.fivemPlayersView,
    vehiclesView: config.vehiclesView || config.fivemVehiclesView,
    housingView: config.housingView || config.fivemHousingView,
    warrantsView: config.warrantsView || config.fivemWarrantsView
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
