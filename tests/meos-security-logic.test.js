const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { calculateWetboekPenalty, modifierForSelection } = require("../modules/meos-penalty-engine");
const { normalizeOrpBsn, normalizeOrpFingerprint } = require("../modules/meos-normalization");
const { normalizeProcessVerbal, updateProcessVerbal } = require("../modules/meos-process-verbals");
const { createDemoMeosStore } = require("../modules/meos-store-demo");
const { createFiveMMeosStore, mapPersonRow } = require("../modules/meos-store-fivem");

function wetboekFixture() {
  return {
    revision: 42,
    updatedAt: "2026-08-19T12:00:00.000Z",
    articles: [
      {
        id: "IV-2",
        title: "Gijzeling",
        category: "Geweldsdelicten",
        tables: [{ index: 0, type: "straf", rows: [{ Feit: "Eerste veroordeling", Celstraf: "10 maanden", Boete: "EUR 1.000" }] }]
      },
      {
        id: "V-3",
        title: "Steek- en slagwapens",
        category: "Wapens",
        tables: [{ index: 0, type: "straf", rows: [{ Feit: "Eerste veroordeling", Taakstraf: "50 uur", Boete: "EUR 500" }] }]
      }
    ]
  };
}

test("MEOS calculates Wetboek totals on official server rows", () => {
  const result = calculateWetboekPenalty(wetboekFixture(), [
    { articleId: "IV-2", tableIndex: 0, rowIndex: 0 },
    { articleId: "V-3", tableIndex: 0, rowIndex: 0 }
  ]);

  assert.equal(result.revision, 42);
  assert.equal(result.totals.fine, 1500);
  assert.equal(result.totals.jailMonths, 35);
  assert.equal(result.totals.taskHours, 0);
  assert.equal(result.totals.convertedTaskHours, 50);
  assert.equal(result.totals.taskToJailMonths, 25);
});

test("MEOS applies ambtenaar and poging modifiers additively per article", () => {
  assert.equal(modifierForSelection({ officialInDuty: true }).factor, 1.33);
  assert.equal(modifierForSelection({ attempted: true }).factor, 0.67);
  assert.equal(modifierForSelection({ officialInDuty: true, attempted: true }).factor, 1);

  const result = calculateWetboekPenalty(wetboekFixture(), [
    { articleId: "IV-2", tableIndex: 0, rowIndex: 0, officialInDuty: true },
    { articleId: "V-3", tableIndex: 0, rowIndex: 0, attempted: true }
  ]);
  assert.equal(result.totals.fine, 1665);
  assert.equal(result.totals.jailMonths, 30.1);
});

test("MEOS rejects stale or forged Wetboek selections", () => {
  assert.throws(
    () => calculateWetboekPenalty(wetboekFixture(), [{ articleId: "BESTAAT-NIET", tableIndex: 0, rowIndex: 0 }]),
    (error) => error.status === 409 && /bestaat niet meer/.test(error.message)
  );
});

test("MEOS only accepts the official BSN and fingerprint formats", () => {
  assert.equal(normalizeOrpBsn("44499819"), "ORP-BSN-44499819");
  assert.equal(normalizeOrpFingerprint("38445989"), "ORP-V-38445989");
  assert.equal(normalizeOrpBsn("citizen-123"), "");
  assert.equal(normalizeOrpFingerprint("steam:110000abc"), "");
});

test("MEOS composes structured PV documents server-side and locks final versions", () => {
  const processVerbal = normalizeProcessVerbal({
    type: "bevindingen",
    status: "concept",
    date: "19-08-2026",
    summary: "Eigen waarneming vastgelegd.",
    fields: { waarneming: "Ik zag het voertuig wegrijden." },
    document: "VERVALSTE CLIENTTEKST",
    createdBy: { discordId: "123", name: "Frank Bright", rank: "Brigadegeneraal", serviceNumber: "70-04" }
  });

  assert.match(processVerbal.document, /ORP OVERHEID/);
  assert.match(processVerbal.document, /Ik zag het voertuig wegrijden/);
  assert.doesNotMatch(processVerbal.document, /VERVALSTE CLIENTTEKST/);

  const finalized = updateProcessVerbal(processVerbal, { status: "definitief" }, { actorKey: "discord:123" });
  assert.equal(finalized.status, "definitief");
  assert.throws(
    () => updateProcessVerbal(finalized, { summary: "Aangepast" }, { actorKey: "discord:123" }),
    (error) => error.status === 409
  );
});

test("MEOS JSON fallback serializes concurrent dossier writes without data loss", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meos-concurrency-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const store = createFiveMMeosStore({
    driver: "postgres",
    databaseUrl: "postgres://readonly@example/meos",
    caseDataPath: path.join(tempDir, "case-data.json")
  });
  store.loadPeople = async () => [mapPersonRow({ id: "citizen-1", name: "Test Persoon", bsn: "1", fingerprint: "1" })];
  store.loadVehicles = async () => [];
  store.loadWarrants = async () => [];
  store.loadHouses = async () => [];

  await Promise.all(Array.from({ length: 20 }, (_, index) => store.addPersonNote("citizen-1", {
    date: "19-08-2026",
    author: "Test Agent",
    note: `Notitie ${index}`
  })));

  const person = await store.getPerson("citizen-1");
  assert.equal(person.notes.length, 20);
  assert.equal(new Set(person.notes.map((entry) => entry.note)).size, 20);
});

test("MEOS demo runtime data survives a service-store restart", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "meos-demo-persist-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const caseDataPath = path.join(tempDir, "case-data.json");
  const firstStore = createDemoMeosStore({ persistCaseData: true, caseDataPath });

  await firstStore.saveGeneralNote("discord:123", "Persoonlijke dashboardnotitie");
  const note = await firstStore.addPersonNote("ernie-nugz", {
    date: "19-08-2026",
    author: "Test Agent",
    note: "Blijft na herstart bestaan"
  });
  const combined = await firstStore.addPersonRecordWithFine("ernie-nugz", {
    date: "19-08-2026",
    sanction: "PV",
    note: "Duurzaam strafblad"
  }, {
    fine: "Testboete",
    amount: "EUR 250"
  });
  await firstStore.addProcessVerbal({
    type: "bevindingen",
    status: "concept",
    date: "19-08-2026",
    summary: "Duurzaam PV",
    createdBy: { discordId: "123", name: "Test Agent" }
  });

  const secondStore = createDemoMeosStore({ persistCaseData: true, caseDataPath });
  const person = await secondStore.getPerson("ernie-nugz");
  assert.ok(person.notes.some((entry) => entry.id === note.note.id));
  assert.ok(person.records.some((entry) => entry.id === combined.record.id));
  assert.ok(person.fines.some((entry) => entry.id === combined.fine.id));
  assert.equal((await secondStore.getGeneralNote("discord:123")).note, "Persoonlijke dashboardnotitie");
  assert.equal((await secondStore.listProcessVerbals({ actorKey: "discord:123" })).length, 1);

  await secondStore.deletePersonFine("ernie-nugz", combined.fine.id);
  const thirdStore = createDemoMeosStore({ persistCaseData: true, caseDataPath });
  assert.equal((await thirdStore.getPerson("ernie-nugz")).fines.some((entry) => entry.id === combined.fine.id), false);
});
