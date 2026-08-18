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
