const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { buildDemoMeosPeople } = require(path.join(process.cwd(), "modules", "meos-demo-data"));
const { createDemoMeosStore } = require(path.join(process.cwd(), "modules", "meos-store-demo"));
const { createMeosStore, meosStoreConfigFromEnv } = require(path.join(process.cwd(), "modules", "meos-store"));
const { createFiveMMeosStore, mapPersonRow, mapVehicleRow } = require(path.join(process.cwd(), "modules", "meos-store-fivem"));

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

  const personBySlug = await store.getPerson("Damian-Kroes");
  assert.equal(personBySlug.name, "Damian Kroes");

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
    createdBy: { name: "Frank Bright" }
  });
  assert.equal(recordResult.record.sanction, "PV");
  assert.equal(recordResult.person.records[0].note, "Nieuwe testregistratie.");

  const noteResult = await store.addPersonNote("ernie-nugz", {
    date: "18 aug. 2026",
    author: "Frank Bright",
    note: "Nieuwe testnotitie.",
    createdBy: { name: "Frank Bright" }
  });
  assert.equal(noteResult.note.author, "Frank Bright");
  assert.equal(noteResult.person.notes[0].note, "Nieuwe testnotitie.");

  const person = await store.getPerson("ernie-nugz");
  assert.equal(person.records[0].note, "Nieuwe testregistratie.");
  assert.equal(person.notes[0].note, "Nieuwe testnotitie.");
});

test("MEOS store factory defaults to cached demo data", async () => {
  const config = meosStoreConfigFromEnv({
    MEOS_DATA_SOURCE: "",
    MEOS_CACHE_TTL_MS: "2500"
  });
  assert.equal(config.dataSource, "demo");
  assert.equal(config.cacheTtlMs, 2500);

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

test("MEOS FiveM scaffold maps view rows to MEOS shape", async () => {
  const person = mapPersonRow({
    citizenid: "citizen-1",
    full_name: "Test Speler",
    orp_bsn: "ORP-BSN-12345678",
    orp_fingerprint: "ORP-V-87654321",
    birth_date: "01-01-1999",
    licenses: '["Theorie","Auto"]'
  });
  assert.equal(person.id, "citizen-1");
  assert.equal(person.name, "Test Speler");
  assert.deepEqual(person.licenses, ["Theorie", "Auto"]);

  const vehicle = mapVehicleRow({
    plate: "ORP-001",
    owner_id: "citizen-1",
    model: "Karin Sultan",
    wok: true,
    stolen: false,
    apk_status: "Herkeuring nodig"
  });
  assert.equal(vehicle.plate, "ORP-001");
  assert.equal(vehicle.wok, "Ja");
  assert.equal(vehicle.stolen, "Nee");
  assert.equal(vehicle.apkStatus, "Herkeuring nodig");

  const store = createFiveMMeosStore({ driver: "mysql", databaseUrl: "mysql://readonly@example/meos" });
  await assert.rejects(() => store.snapshot(), /mysql2 is nog niet geinstalleerd/);
});
