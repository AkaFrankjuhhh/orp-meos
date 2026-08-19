const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildDemoMeosPeople } = require(path.join(process.cwd(), "modules", "meos-demo-data"));
const { normalizeOrpBsn, normalizeOrpFingerprint, normalizeVehiclePlate } = require(path.join(process.cwd(), "modules", "meos-normalization"));
const { createDemoMeosStore } = require(path.join(process.cwd(), "modules", "meos-store-demo"));
const { CachedMeosStore, createMeosStore, meosStoreConfigFromEnv } = require(path.join(process.cwd(), "modules", "meos-store"));
const { createFiveMMeosStore, mapPersonRow, mapVehicleRow, sqlIdentifier } = require(path.join(process.cwd(), "modules", "meos-store-fivem"));

test("MEOS demo data lives outside the browser bundle", () => {
  const people = buildDemoMeosPeople();
  const demoPeople = people.slice(3);

  assert.equal(people.length, 53);
  assert.equal(demoPeople.length, 50);
  assert.ok(people.some((person) => person.bsn === "ORP-BSN-44499819"));
  assert.ok(people.some((person) => person.fingerprint === "ORP-V-38445989"));
});

test("MEOS demo store searches people, vehicles and arrest warrants", async () => {
  const store = createDemoMeosStore();

  const peopleByBsn = await store.listPeople({ query: "ORP-BSN-44499819", field: "bsn" });
  assert.equal(peopleByBsn.length, 1);
  assert.equal(peopleByBsn[0].name, "Ernie Nugz");

  const peopleByBsnDigits = await store.listPeople({ query: "44499819", field: "bsn" });
  assert.equal(peopleByBsnDigits.length, 1);
  assert.equal(peopleByBsnDigits[0].name, "Ernie Nugz");

  const peopleByFingerprintDigits = await store.listPeople({ query: "38445989", field: "fingerprint" });
  assert.equal(peopleByFingerprintDigits.length, 1);
  assert.equal(peopleByFingerprintDigits[0].name, "Ernie Nugz");

  const personBySlug = await store.getPerson("Damian-Kroes");
  assert.equal(personBySlug.name, "Damian Kroes");

  const personByFingerprintDigits = await store.getPerson("38445989");
  assert.equal(personByFingerprintDigits.name, "Ernie Nugz");

  const vehicles = await store.listVehicles({ query: "WFX 403" });
  assert.equal(vehicles.length, 1);
  assert.equal(vehicles[0].owner, "Ernie Nugz");
  assert.equal(vehicles[0].apkStatus, "Goedgekeurd");

  const vehicle = await store.getVehicle("FST-017");
  assert.equal(vehicle.stolen, "Ja");
  assert.equal(vehicle.stolenReason, "Aangifte diefstal bij Vespucci");

  const warrants = await store.listWarrants();
  assert.ok(warrants.length >= 10);
  assert.ok(warrants.some((warrant) => warrant.person.name === "Damian Kroes"));
});

test("MEOS demo store can add profile records and notes", async () => {
  const store = createDemoMeosStore();

  const recordResult = await store.addPersonRecord("ernie-nugz", {
    date: "18 aug. 2026",
    sanction: "PV",
    verbalist: "Frank Bright",
    note: "Nieuwe testregistratie.",
    source: "wetboek",
    articleIds: ["II-1"],
    createdBy: { name: "Frank Bright" }
  });
  assert.equal(recordResult.record.sanction, "PV");
  assert.deepEqual(recordResult.record.articleIds, ["II-1"]);
  assert.equal(recordResult.person.records[0].note, "Nieuwe testregistratie.");

  const noteResult = await store.addPersonNote("ernie-nugz", {
    date: "18 aug. 2026",
    author: "Frank Bright",
    note: "Nieuwe testnotitie.",
    createdBy: { name: "Frank Bright" }
  });
  assert.equal(noteResult.note.author, "Frank Bright");
  assert.equal(noteResult.person.notes[0].note, "Nieuwe testnotitie.");

  const fineResult = await store.addPersonFine("ernie-nugz", {
    fine: "Wetboek boete II-1",
    amount: "EUR 3.000",
    writtenAt: "18 aug. 2026",
    writtenBy: "Frank Bright",
    articleIds: ["II-1"],
    createdBy: { name: "Frank Bright" }
  });
  assert.equal(fineResult.fine.amount, "EUR 3.000");
  assert.deepEqual(fineResult.person.fines[0].articleIds, ["II-1"]);

  const person = await store.getPerson("ernie-nugz");
  assert.equal(person.records[0].note, "Nieuwe testregistratie.");
  assert.equal(person.notes[0].note, "Nieuwe testnotitie.");
  assert.equal(person.fines[0].fine, "Wetboek boete II-1");
});

test("MEOS demo store can delete records, notes and fines", async () => {
  const store = createDemoMeosStore();

  const recordDelete = await store.deletePersonRecord("ernie-nugz", "record-0");
  assert.equal(recordDelete.deleted.type, "record");
  assert.equal(recordDelete.person.records.length, 3);

  const noteDelete = await store.deletePersonNote("ernie-nugz", "note-0");
  assert.equal(noteDelete.deleted.type, "note");
  assert.equal(noteDelete.person.notes.length, 1);

  const fineDelete = await store.deletePersonFine("ernie-nugz", "fine-0");
  assert.equal(fineDelete.deleted.type, "fine");
  assert.equal(fineDelete.person.fines.length, 0);
});

test("MEOS store factory defaults to cached demo data", async () => {
  const config = meosStoreConfigFromEnv({
    MEOS_DATA_SOURCE: "",
    MEOS_CACHE_TTL_MS: "2500"
  });
  assert.equal(config.dataSource, "demo");
  assert.equal(config.cacheTtlMs, 2500);
  assert.equal(config.fivemDriver, "postgres");

  const store = createMeosStore({ dataSource: "demo", cacheTtlMs: 2500 });
  const snapshot = await store.snapshot();
  assert.equal(snapshot.dataSource.type, "demo");
  assert.equal(snapshot.people.length, 53);
  assert.ok(snapshot.vehicles.length >= 70);
  assert.ok(snapshot.warrants.length >= 10);

  const result = await store.addPersonNote("ernie-nugz", {
    date: "18 aug. 2026",
    author: "Frank Bright",
    note: "Cache wordt ververst.",
    createdBy: { name: "Frank Bright" }
  });
  assert.equal(result.person.notes[0].note, "Cache wordt ververst.");
  const updatedSnapshot = await store.snapshot();
  assert.equal(updatedSnapshot.people.find((person) => person.id === "ernie-nugz").notes[0].note, "Cache wordt ververst.");
});

test("MEOS datasource health reports demo counts and cache state", async () => {
  const store = createMeosStore({ dataSource: "demo", cacheTtlMs: 2500 });
  const health = await store.sourceHealth();

  assert.equal(health.ok, true);
  assert.equal(health.status, "healthy");
  assert.equal(health.dataSource.type, "demo");
  assert.equal(health.cache.ttlMs, 2500);
  assert.equal(health.counts.players, 53);
  assert.ok(health.counts.vehicles >= 70);
  assert.ok(health.checks.some((check) => check.key === "players" && check.required));
});

test("MEOS cached store keeps stale data when a live refresh fails", async () => {
  let fail = false;
  const baseStore = {
    source: { type: "test-live", label: "Test live", live: true },
    async snapshot() {
      if (fail) throw new Error("database offline");
      return {
        dataSource: this.source,
        people: [{ id: "p1", name: "Test Persoon", vehicles: [] }],
        vehicles: [],
        warrants: []
      };
    }
  };
  const store = new CachedMeosStore(baseStore, { cacheTtlMs: 0 });
  const first = await store.snapshot();
  assert.equal(first.people.length, 1);

  fail = true;
  const fallback = await store.snapshot();
  assert.equal(fallback.dataSource.stale, true);
  assert.match(fallback.dataSource.lastError.message, /database offline/);

  const health = await store.sourceHealth();
  assert.equal(health.cache.hasSnapshot, true);
  assert.match(health.cache.lastSnapshotError.message, /database offline/);
});

test("MEOS FiveM scaffold maps view rows to MEOS shape", async () => {
  const person = mapPersonRow({
    citizenid: "citizen-1",
    full_name: "Test Speler",
    orp_bsn: "12345678",
    orp_fingerprint: "87654321",
    birth_date: "01-01-1999",
    licenses: '["Theorie","Auto"]'
  });
  assert.equal(person.id, "citizen-1");
  assert.equal(person.name, "Test Speler");
  assert.equal(person.bsn, "ORP-BSN-12345678");
  assert.equal(person.fingerprint, "ORP-V-87654321");
  assert.deepEqual(person.licenses, ["Theorie", "Auto"]);

  const vehicle = mapVehicleRow({
    plate: "orp-001",
    owner_id: "citizen-1",
    model: "Karin Sultan",
    vin: "orp-sultan-001",
    wok: true,
    stolen: false,
    apk_status: "Herkeuring nodig"
  });
  assert.equal(vehicle.plate, "ORP-001");
  assert.equal(vehicle.vin, "ORP-SULTAN-001");
  assert.equal(vehicle.wok, "Ja");
  assert.equal(vehicle.stolen, "Nee");
  assert.equal(vehicle.apkStatus, "Herkeuring nodig");
  assert.equal(normalizeOrpBsn("44499819"), "ORP-BSN-44499819");
  assert.equal(normalizeOrpFingerprint("orp-v-38445989"), "ORP-V-38445989");
  assert.equal(normalizeVehiclePlate(" wfx 403 "), "WFX 403");

  const store = createFiveMMeosStore({ driver: "mysql", databaseUrl: "mysql://readonly@example/meos" });
  await assert.rejects(() => store.snapshot(), /mysql2 is nog niet geinstalleerd/);
  const health = await store.sourceHealth();
  assert.equal(health.ok, false);
  assert.equal(health.status, "unsupported_driver");
  assert.match(health.error, /mysql2 is nog niet geinstalleerd/);
  assert.equal(sqlIdentifier("orp_meos.people_view", "fallback_view"), "orp_meos.people_view");
  assert.equal(sqlIdentifier("people;drop table users", "fallback_view"), "fallback_view");
});

test("MEOS FiveM store writes dossier data outside the read-only FiveM views", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meos-case-"));
  const caseDataPath = path.join(tempDir, "case-data.json");
  const store = createFiveMMeosStore({
    driver: "postgres",
    databaseUrl: "postgres://readonly@example/meos",
    caseDataPath
  });
  store.loadPeople = async () => [mapPersonRow({
    id: "citizen-1",
    name: "Test Speler",
    bsn: "ORP-BSN-100",
    fingerprint: "ORP-V-100"
  })];
  store.loadVehicles = async () => [];
  store.loadWarrants = async () => [];
  store.loadHouses = async () => [];

  const recordResult = await store.addPersonRecord("citizen-1", {
    date: "18 aug. 2026",
    sanction: "PV",
    verbalist: "Frank Bright",
    note: "MEOS dossier blijft lokaal.",
    articleIds: ["II-1"]
  });
  assert.equal(recordResult.record.sanction, "PV");
  assert.equal(recordResult.person.records[0].note, "MEOS dossier blijft lokaal.");

  const noteResult = await store.addPersonNote("citizen-1", {
    date: "18 aug. 2026",
    author: "Frank Bright",
    note: "Lokale notitie."
  });
  assert.equal(noteResult.note.author, "Frank Bright");

  const fineResult = await store.addPersonFine("citizen-1", {
    fine: "Boete test",
    amount: "EUR 100",
    writtenAt: "18 aug. 2026",
    writtenBy: "Frank Bright"
  });
  assert.equal(fineResult.fine.amount, "EUR 100");

  const person = await store.getPerson("citizen-1");
  assert.equal(person.records.length, 1);
  assert.equal(person.notes.length, 1);
  assert.equal(person.fines.length, 1);

  await store.deletePersonFine("citizen-1", fineResult.fine.id);
  const updated = await store.getPerson("citizen-1");
  assert.equal(updated.fines.length, 0);

  const saved = JSON.parse(fs.readFileSync(caseDataPath, "utf8"));
  assert.equal(saved.people["citizen-1"].records[0].note, "MEOS dossier blijft lokaal.");
  assert.equal(store.source.caseDataPath, caseDataPath);
});
