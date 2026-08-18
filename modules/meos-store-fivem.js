"use strict";

const { normalize, slugFromValue } = require("./meos-demo-data");
const { normalizeLimit } = require("./meos-store-demo");

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function yesNo(value, fallback = "Nee") {
  if (typeof value === "boolean") return value ? "Ja" : "Nee";
  const normalized = normalize(value);
  if (["ja", "yes", "true", "1"].includes(normalized)) return "Ja";
  if (["nee", "no", "false", "0"].includes(normalized)) return "Nee";
  return String(value || fallback);
}

function mapPersonRow(row = {}) {
  const name = row.name || row.full_name || row.firstname && row.lastname && `${row.firstname} ${row.lastname}` || "Onbekende speler";
  return {
    id: String(row.id || row.citizenid || row.identifier || slugFromValue(name)).trim(),
    name,
    gender: String(row.gender || row.sex || "-"),
    bsn: String(row.bsn || row.orp_bsn || row.citizenid || ""),
    fingerprint: String(row.fingerprint || row.orp_fingerprint || row.identifier || ""),
    birthDate: String(row.birth_date || row.birthDate || row.dateofbirth || ""),
    height: String(row.height || row.length || ""),
    status: String(row.status || row.signalering || "Geen signalering"),
    licenses: asArray(row.licenses || row.rijbewijzen),
    vehicles: [],
    houses: asArray(row.houses || row.properties),
    records: asArray(row.records || row.strafbladen),
    notes: asArray(row.notes || row.notities),
    fines: asArray(row.fines || row.boetes),
    arrestWarrants: asArray(row.arrest_warrants || row.arrestWarrants)
  };
}

function mapVehicleRow(row = {}) {
  const plate = String(row.plate || row.kenteken || "").trim();
  return {
    plate,
    model: String(row.model || row.vehicle_model || row.voertuig || ""),
    ownerId: String(row.owner_id || row.ownerId || row.citizenid || row.identifier || ""),
    owner: String(row.owner || row.owner_name || row.eigenaar || ""),
    impounded: yesNo(row.impounded || row.inbeslaggenomen),
    wok: yesNo(row.wok || row.wok_status),
    apkStatus: String(row.apk_status || row.apkStatus || row.apk || ""),
    primaryColor: String(row.primary_color || row.primaryColor || row.kleur || ""),
    secondaryColor: String(row.secondary_color || row.secondaryColor || ""),
    pearlColor: String(row.pearl_color || row.pearlColor || ""),
    stolen: yesNo(row.stolen || row.gestolen),
    stolenReason: String(row.stolen_reason || row.stolenReason || row.gestolen_reden || ""),
    stolenDate: String(row.stolen_date || row.stolenDate || row.gestolen_datum || ""),
    serviceVehicle: yesNo(row.service_vehicle || row.serviceVehicle || row.dienst_auto),
    vin: String(row.vin || row.vehicle_id || "")
  };
}

function mapWarrantRow(row = {}) {
  return {
    id: String(row.id || row.warrant_id || row.bevelnummer || ""),
    reason: String(row.reason || row.reden || ""),
    issuedAt: String(row.issued_at || row.issuedAt || row.datum || ""),
    issuedBy: String(row.issued_by || row.issuedBy || row.uitgegeven_door || ""),
    priority: String(row.priority || row.prioriteit || "Normaal"),
    status: String(row.status || "Actief"),
    instruction: String(row.instruction || row.instructie || ""),
    personId: String(row.person_id || row.personId || row.owner_id || row.citizenid || row.identifier || ""),
    personName: String(row.person_name || row.personName || row.name || "")
  };
}

function searchPersonFields(person) {
  return [person.name, person.bsn, person.fingerprint, person.birthDate, person.status];
}

function searchVehicleFields(vehicle) {
  return [vehicle.plate, vehicle.model, vehicle.owner, vehicle.primaryColor, vehicle.secondaryColor, vehicle.vin];
}

class FiveMMeosStore {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.MEOS_FIVEM_DATABASE_URL || "";
    this.driver = String(options.driver || process.env.MEOS_FIVEM_DB_DRIVER || "mysql").trim().toLowerCase();
    this.framework = String(options.framework || process.env.MEOS_FIVEM_FRAMEWORK || "custom").trim().toLowerCase();
    this.source = {
      type: "fivem",
      label: `FiveM ${this.framework} database`,
      live: true,
      driver: this.driver
    };
    this.pool = null;
  }

  assertConfigured() {
    if (!this.databaseUrl) {
      const error = new Error("MEOS_FIVEM_DATABASE_URL ontbreekt. Zet MEOS_DATA_SOURCE=demo of configureer een read-only FiveM database URL.");
      error.status = 503;
      throw error;
    }
    if (!["postgres", "postgresql"].includes(this.driver)) {
      const error = new Error("MEOS FiveM MySQL support is voorbereid maar mysql2 is nog niet geinstalleerd. Gebruik tijdelijk MEOS_FIVEM_DB_DRIVER=postgres met views, of voeg mysql2 toe.");
      error.status = 501;
      throw error;
    }
  }

  getPool() {
    this.assertConfigured();
    if (!this.pool) {
      const { Pool } = require("pg");
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        max: Number(process.env.MEOS_FIVEM_DATABASE_POOL_MAX || 2),
        idleTimeoutMillis: Number(process.env.MEOS_FIVEM_DATABASE_IDLE_MS || 30000),
        connectionTimeoutMillis: Number(process.env.MEOS_FIVEM_DATABASE_CONNECT_MS || 10000),
        ssl: String(process.env.MEOS_FIVEM_DATABASE_SSL || "false").toLowerCase() === "true" ? { rejectUnauthorized: false } : false
      });
    }
    return this.pool;
  }

  async query(sql, params = []) {
    const pool = this.getPool();
    const result = await pool.query(sql, params);
    return result.rows || [];
  }

  async loadPeople() {
    const rows = await this.query("select * from meos_people_view order by name limit 1000");
    return rows.map(mapPersonRow);
  }

  async loadVehicles() {
    const rows = await this.query("select * from meos_vehicles_view order by plate limit 2000");
    return rows.map(mapVehicleRow);
  }

  async loadWarrants() {
    try {
      const rows = await this.query("select * from meos_arrest_warrants_view where coalesce(status, 'Actief') <> 'Gesloten' order by issued_at desc limit 500");
      return rows.map(mapWarrantRow);
    } catch (error) {
      if (String(error.message || "").includes("meos_arrest_warrants_view")) return [];
      throw error;
    }
  }

  async snapshot() {
    const [people, vehicles, warrants] = await Promise.all([
      this.loadPeople(),
      this.loadVehicles(),
      this.loadWarrants()
    ]);
    const peopleById = new Map(people.map((person) => [normalize(person.id), person]));
    const peopleByName = new Map(people.map((person) => [normalize(person.name), person]));
    for (const vehicle of vehicles) {
      const owner = peopleById.get(normalize(vehicle.ownerId)) || peopleByName.get(normalize(vehicle.owner));
      if (!owner) continue;
      vehicle.owner = vehicle.owner || owner.name;
      vehicle.ownerId = owner.id;
      owner.vehicles.push(vehicle);
    }
    const warrantsWithPerson = warrants.map((warrant) => {
      const person = peopleById.get(normalize(warrant.personId)) || peopleByName.get(normalize(warrant.personName));
      return {
        ...warrant,
        person: person ? {
          id: person.id,
          name: person.name,
          bsn: person.bsn,
          fingerprint: person.fingerprint,
          birthDate: person.birthDate,
          status: person.status
        } : null
      };
    }).filter((warrant) => warrant.person);
    return {
      dataSource: this.source,
      generatedAt: new Date().toISOString(),
      people,
      vehicles,
      warrants: warrantsWithPerson
    };
  }

  async listPeople(options = {}) {
    const query = normalize(options.query);
    const field = options.field || "all";
    const limit = normalizeLimit(options.limit);
    const { people } = await this.snapshot();
    const rows = query
      ? people.filter((person) => {
        const values = field === "name" ? [person.name]
          : field === "bsn" ? [person.bsn]
            : field === "fingerprint" ? [person.fingerprint]
              : field === "birthDate" ? [person.birthDate]
                : searchPersonFields(person);
        return values.some((value) => normalize(value).includes(query));
      })
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
      ? vehicles.filter((vehicle) => searchVehicleFields(vehicle).some((value) => normalize(value).includes(query)))
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

function createFiveMMeosStore(options = {}) {
  return new FiveMMeosStore(options);
}

module.exports = {
  FiveMMeosStore,
  createFiveMMeosStore,
  mapPersonRow,
  mapVehicleRow,
  mapWarrantRow
};
