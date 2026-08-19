"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const { normalize, slugFromValue } = require("./meos-demo-data");
const {
  normalizeOrpBsn,
  normalizeOrpFingerprint,
  normalizeVehiclePlate,
  normalizeVehicleVin
} = require("./meos-normalization");
const { normalizeLimit, personMatchesSearch, personSearchQueries } = require("./meos-store-demo");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function sqlIdentifier(value, fallback) {
  const raw = String(value || fallback || "").trim();
  return /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(raw) ? raw : fallback;
}

function mapPersonRow(row = {}) {
  const name = row.name || row.full_name || row.firstname && row.lastname && `${row.firstname} ${row.lastname}` || "Onbekende speler";
  return {
    id: String(row.id || row.citizenid || row.identifier || slugFromValue(name)).trim(),
    name,
    gender: String(row.gender || row.sex || "-"),
    bsn: normalizeOrpBsn(row.bsn || row.orp_bsn || row.citizenid || ""),
    fingerprint: normalizeOrpFingerprint(row.fingerprint || row.orp_fingerprint || row.identifier || ""),
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
  const plate = normalizeVehiclePlate(row.plate || row.kenteken || "");
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
    vin: normalizeVehicleVin(row.vin || row.vehicle_id || "")
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

function mapHouseRow(row = {}) {
  return {
    id: String(row.id || row.house_id || row.property_id || row.pand_id || ""),
    personId: String(row.person_id || row.personId || row.owner_id || row.citizenid || row.identifier || ""),
    owner: String(row.owner || row.owner_name || row.eigenaar || ""),
    location: String(row.location || row.locatie || row.address || row.adres || ""),
    building: String(row.building || row.pand || row.house || row.property || ""),
    status: String(row.status || row.state || row.staat || "Actief")
  };
}

function searchVehicleFields(vehicle) {
  return [vehicle.plate, vehicle.model, vehicle.owner, vehicle.primaryColor, vehicle.secondaryColor, vehicle.vin];
}

function sanitizeHealthError(error) {
  return String(error?.message || error || "Onbekende databasefout").replace(/\s+/g, " ").slice(0, 240);
}

function entryId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function normalizeCaseData(data = {}) {
  const people = data.people && typeof data.people === "object" ? data.people : {};
  return { people };
}

function personCaseBucket(data, personId) {
  const key = String(personId || "").trim();
  if (!data.people[key]) data.people[key] = { records: [], notes: [], fines: [] };
  const bucket = data.people[key];
  bucket.records = Array.isArray(bucket.records) ? bucket.records : [];
  bucket.notes = Array.isArray(bucket.notes) ? bucket.notes : [];
  bucket.fines = Array.isArray(bucket.fines) ? bucket.fines : [];
  return bucket;
}

function fallbackEntryIndex(entryIdValue, prefix) {
  const match = String(entryIdValue || "").match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
  if (!match) return -1;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : -1;
}

function deleteCaseEntry(bucket, collection, entryIdValue, fallbackPrefix) {
  const entries = Array.isArray(bucket[collection]) ? bucket[collection] : [];
  const normalizedId = normalize(entryIdValue);
  let index = entries.findIndex((entry) => normalize(entry?.id) === normalizedId);
  if (index === -1) {
    const fallbackIndex = fallbackEntryIndex(entryIdValue, fallbackPrefix);
    if (fallbackIndex >= 0 && fallbackIndex < entries.length) index = fallbackIndex;
  }
  if (index === -1) {
    const error = new Error("MEOS item niet gevonden.");
    error.status = 404;
    throw error;
  }
  const [deleted] = entries.splice(index, 1);
  bucket[collection] = entries;
  return deleted || null;
}

class FiveMMeosStore {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.MEOS_FIVEM_DATABASE_URL || "";
    this.caseDataPath = path.resolve(options.caseDataPath || process.env.MEOS_CASE_DATA_PATH || "meos-case-data.json");
    this.driver = String(options.driver || process.env.MEOS_FIVEM_DB_DRIVER || "postgres").trim().toLowerCase();
    this.framework = String(options.framework || process.env.MEOS_FIVEM_FRAMEWORK || "custom").trim().toLowerCase();
    this.playersView = sqlIdentifier(options.playersView || process.env.MEOS_FIVEM_PLAYERS_VIEW || options.peopleView || process.env.MEOS_FIVEM_PEOPLE_VIEW, "meos_people_view");
    this.peopleView = this.playersView;
    this.vehiclesView = sqlIdentifier(options.vehiclesView || process.env.MEOS_FIVEM_VEHICLES_VIEW, "meos_vehicles_view");
    this.housingView = sqlIdentifier(options.housingView || process.env.MEOS_FIVEM_HOUSING_VIEW, "meos_housing_view");
    this.warrantsView = sqlIdentifier(options.warrantsView || process.env.MEOS_FIVEM_WARRANTS_VIEW, "meos_arrest_warrants_view");
    this.source = {
      type: "fivem",
      label: `FiveM ${this.framework} database`,
      live: true,
      driver: this.driver,
      caseDataPath: this.caseDataPath,
      views: {
        players: this.playersView,
        vehicles: this.vehiclesView,
        housing: this.housingView,
        warrants: this.warrantsView
      }
    };
    this.pool = null;
  }

  viewContracts() {
    return [
      {
        key: "players",
        label: "Spelers",
        view: this.playersView,
        required: true,
        columns: ["id", "name", "bsn", "fingerprint", "birth_date", "height", "status", "licenses"]
      },
      {
        key: "vehicles",
        label: "Voertuigen",
        view: this.vehiclesView,
        required: true,
        columns: ["plate", "owner_id", "owner", "model", "vin", "primary_color", "secondary_color", "pearl_color", "apk_status", "wok", "stolen", "stolen_reason", "stolen_date", "impounded", "service_vehicle"]
      },
      {
        key: "housing",
        label: "Huisvestigingen",
        view: this.housingView,
        required: false,
        columns: ["id", "person_id", "owner", "location", "building", "status"]
      },
      {
        key: "warrants",
        label: "Arrestatiebevelen",
        view: this.warrantsView,
        required: false,
        columns: ["id", "person_id", "person_name", "reason", "issued_at", "issued_by", "priority", "status", "instruction"]
      }
    ];
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

  async checkViewContract(contract) {
    const started = Date.now();
    const base = {
      key: contract.key,
      label: contract.label,
      view: contract.view,
      required: Boolean(contract.required),
      columns: contract.columns,
      ok: false,
      available: false,
      missing: false,
      count: null,
      durationMs: 0
    };
    try {
      await this.query(`select ${contract.columns.join(", ")} from ${contract.view} limit 1`);
      const rows = await this.query(`select count(*)::int as count from ${contract.view}`);
      return {
        ...base,
        ok: true,
        available: true,
        count: Number(rows[0]?.count || 0),
        durationMs: Date.now() - started
      };
    } catch (error) {
      const missing = this.isMissingOptionalView(error, contract.view);
      const optionalMissing = missing && !contract.required;
      return {
        ...base,
        ok: optionalMissing,
        available: false,
        missing,
        status: optionalMissing ? "missing_optional" : "error",
        error: sanitizeHealthError(error),
        durationMs: Date.now() - started
      };
    }
  }

  async sourceHealth() {
    const checkedAt = new Date().toISOString();
    const contracts = this.viewContracts();
    const base = {
      ok: false,
      status: "error",
      checkedAt,
      dataSource: this.source,
      configured: Boolean(this.databaseUrl),
      driver: this.driver,
      framework: this.framework,
      views: this.source.views,
      caseDataPath: this.caseDataPath,
      checks: [],
      counts: {},
      durationMs: 0
    };
    const started = Date.now();
    try {
      this.assertConfigured();
    } catch (error) {
      return {
        ...base,
        status: error.status === 501 ? "unsupported_driver" : "not_configured",
        error: sanitizeHealthError(error),
        durationMs: Date.now() - started
      };
    }

    const checks = await Promise.all(contracts.map((contract) => this.checkViewContract(contract)));
    const ok = checks.every((check) => check.ok);
    return {
      ...base,
      ok,
      status: ok ? "healthy" : "degraded",
      checks,
      counts: Object.fromEntries(checks.map((check) => [check.key, Number.isFinite(check.count) ? check.count : null])),
      missingOptionalViews: checks.filter((check) => !check.required && check.missing).map((check) => check.key),
      durationMs: Date.now() - started
    };
  }

  async loadPeople() {
    const rows = await this.query(`select * from ${this.playersView} order by name limit 1000`);
    return rows.map(mapPersonRow);
  }

  async loadVehicles() {
    const rows = await this.query(`select * from ${this.vehiclesView} order by plate limit 2000`);
    return rows.map(mapVehicleRow);
  }

  async loadWarrants() {
    try {
      const rows = await this.query(`select * from ${this.warrantsView} where coalesce(status, 'Actief') <> 'Gesloten' order by issued_at desc limit 500`);
      return rows.map(mapWarrantRow);
    } catch (error) {
      if (this.isMissingOptionalView(error, this.warrantsView)) return [];
      throw error;
    }
  }

  async loadHouses() {
    try {
      const rows = await this.query(`select * from ${this.housingView} order by location limit 2000`);
      return rows.map(mapHouseRow);
    } catch (error) {
      if (this.isMissingOptionalView(error, this.housingView)) return [];
      throw error;
    }
  }

  isMissingOptionalView(error, viewName) {
    return error?.code === "42P01" || String(error?.message || "").includes(viewName);
  }

  async readCaseData() {
    try {
      const content = await fs.readFile(this.caseDataPath, "utf8");
      return normalizeCaseData(JSON.parse(content));
    } catch (error) {
      if (error?.code === "ENOENT") return normalizeCaseData();
      throw error;
    }
  }

  async writeCaseData(data) {
    await fs.mkdir(path.dirname(this.caseDataPath), { recursive: true });
    const tempPath = `${this.caseDataPath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(normalizeCaseData(data), null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.caseDataPath);
  }

  mergeCaseData(people, caseData) {
    for (const person of people) {
      const bucket = caseData.people[person.id];
      if (!bucket) continue;
      person.records = [...asArray(bucket.records), ...asArray(person.records)];
      person.notes = [...asArray(bucket.notes), ...asArray(person.notes)];
      person.fines = [...asArray(bucket.fines), ...asArray(person.fines)];
    }
  }

  async snapshot() {
    const [people, vehicles, warrants, houses, caseData] = await Promise.all([
      this.loadPeople(),
      this.loadVehicles(),
      this.loadWarrants(),
      this.loadHouses(),
      this.readCaseData()
    ]);
    this.mergeCaseData(people, caseData);
    const peopleById = new Map(people.map((person) => [normalize(person.id), person]));
    const peopleByName = new Map(people.map((person) => [normalize(person.name), person]));
    for (const vehicle of vehicles) {
      const owner = peopleById.get(normalize(vehicle.ownerId)) || peopleByName.get(normalize(vehicle.owner));
      if (!owner) continue;
      vehicle.owner = vehicle.owner || owner.name;
      vehicle.ownerId = owner.id;
      owner.vehicles.push(vehicle);
    }
    for (const house of houses) {
      const owner = peopleById.get(normalize(house.personId)) || peopleByName.get(normalize(house.owner));
      if (!owner) continue;
      owner.houses.push({
        id: house.id,
        location: house.location,
        building: house.building,
        status: house.status
      });
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

  async addPersonRecord(personValue, record = {}) {
    const person = await this.getPerson(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const data = await this.readCaseData();
    const bucket = personCaseBucket(data, person.id);
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
    bucket.records = [nextRecord, ...bucket.records];
    await this.writeCaseData(data);
    return {
      record: clone(nextRecord),
      person: { ...person, records: [clone(nextRecord), ...asArray(person.records)] }
    };
  }

  async addPersonNote(personValue, note = {}) {
    const person = await this.getPerson(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const data = await this.readCaseData();
    const bucket = personCaseBucket(data, person.id);
    const nextNote = {
      id: note.id || entryId("NT"),
      date: String(note.date || "").trim(),
      author: String(note.author || "").trim(),
      note: String(note.note || "").trim(),
      createdAt: new Date().toISOString(),
      createdBy: note.createdBy || null
    };
    bucket.notes = [nextNote, ...bucket.notes];
    await this.writeCaseData(data);
    return {
      note: clone(nextNote),
      person: { ...person, notes: [clone(nextNote), ...asArray(person.notes)] }
    };
  }

  async addPersonFine(personValue, fine = {}) {
    const person = await this.getPerson(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const data = await this.readCaseData();
    const bucket = personCaseBucket(data, person.id);
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
    bucket.fines = [nextFine, ...bucket.fines];
    await this.writeCaseData(data);
    return {
      fine: clone(nextFine),
      person: { ...person, fines: [clone(nextFine), ...asArray(person.fines)] }
    };
  }

  async deletePersonRecord(personValue, recordId) {
    const person = await this.getPerson(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const data = await this.readCaseData();
    const bucket = personCaseBucket(data, person.id);
    const deleted = deleteCaseEntry(bucket, "records", recordId, "record");
    await this.writeCaseData(data);
    return {
      deleted: { type: "record", id: recordId, entry: clone(deleted) },
      person: { ...person, records: asArray(person.records).filter((record) => normalize(record?.id) !== normalize(recordId)) }
    };
  }

  async deletePersonNote(personValue, noteId) {
    const person = await this.getPerson(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const data = await this.readCaseData();
    const bucket = personCaseBucket(data, person.id);
    const deleted = deleteCaseEntry(bucket, "notes", noteId, "note");
    await this.writeCaseData(data);
    return {
      deleted: { type: "note", id: noteId, entry: clone(deleted) },
      person: { ...person, notes: asArray(person.notes).filter((note) => normalize(note?.id) !== normalize(noteId)) }
    };
  }

  async deletePersonFine(personValue, fineId) {
    const person = await this.getPerson(personValue);
    if (!person) {
      const error = new Error("Persoon niet gevonden.");
      error.status = 404;
      throw error;
    }
    const data = await this.readCaseData();
    const bucket = personCaseBucket(data, person.id);
    const deleted = deleteCaseEntry(bucket, "fines", fineId, "fine");
    await this.writeCaseData(data);
    return {
      deleted: { type: "fine", id: fineId, entry: clone(deleted) },
      person: { ...person, fines: asArray(person.fines).filter((fine) => normalize(fine?.id) !== normalize(fineId)) }
    };
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
  mapWarrantRow,
  mapHouseRow,
  sqlIdentifier
};
