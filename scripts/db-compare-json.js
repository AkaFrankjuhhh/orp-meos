const fs = require("node:fs");
const path = require("node:path");
const { readPostgresState } = require("../modules/postgres-state");

const jsonPath = path.join(__dirname, "..", "data.json");

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  }
  return value;
}

function count(state, key) {
  return Array.isArray(state[key]) ? state[key].length : state[key] ? 1 : 0;
}

function byId(list = []) {
  return new Map(list.filter((entry) => entry && entry.id).map((entry) => [entry.id, entry]));
}

function diffIds(label, a, b) {
  const aIds = byId(a);
  const bIds = byId(b);
  const missingInDb = [...aIds.keys()].filter((id) => !bIds.has(id));
  const extraInDb = [...bIds.keys()].filter((id) => !aIds.has(id));
  if (missingInDb.length || extraInDb.length) {
    console.log(`${label}: id verschillen`);
    if (missingInDb.length) console.log(`  mist in database: ${missingInDb.slice(0, 10).join(", ")}`);
    if (extraInDb.length) console.log(`  extra in database: ${extraInDb.slice(0, 10).join(", ")}`);
    return false;
  }
  return true;
}

(async () => {
  const jsonState = JSON.parse(fs.readFileSync(jsonPath, "utf8").replace(/^\uFEFF/, ""));
  const dbState = await readPostgresState();
  const keys = ["people", "i8Forms", "absences", "resignationForms", "portoUnits", "hours", "activity"];
  let ok = true;

  console.log("Aantallen:");
  for (const key of keys) {
    const left = count(jsonState, key);
    const right = count(dbState, key);
    const match = left === right;
    ok = ok && match;
    console.log(`${match ? "OK" : "!!"} ${key}: data.json=${left} postgres=${right}`);
  }

  ok = diffIds("people", jsonState.people, dbState.people) && ok;
  ok = diffIds("i8Forms", jsonState.i8Forms, dbState.i8Forms) && ok;
  ok = diffIds("portoUnits", jsonState.portoUnits, dbState.portoUnits) && ok;

  const jsonDiscord = JSON.stringify(normalize(jsonState.discord || {}));
  const dbDiscord = JSON.stringify(normalize(dbState.discord || {}));
  if (jsonDiscord !== dbDiscord) {
    ok = false;
    console.log("discord settings verschillen");
  }

  if (!ok) process.exitCode = 1;
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
