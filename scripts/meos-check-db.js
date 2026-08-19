#!/usr/bin/env node
"use strict";

const { loadEnv } = require("../modules/db");
const { createFiveMMeosStore } = require("../modules/meos-store-fivem");

loadEnv();

function maskConnectionString(value) {
  if (!value) return "";
  return String(value).replace(/:[^:@/]+@/, ":***@");
}

function statusIcon(check) {
  if (check.ok) return "ok";
  if (check.missing && !check.required) return "optional-missing";
  return "fail";
}

function renderHealth(health) {
  console.log("MEOS FiveM databasecheck");
  console.log(`Status: ${health.status}${health.ok ? " (ok)" : " (actie nodig)"}`);
  console.log(`Driver: ${health.driver || "-"}`);
  console.log(`Framework: ${health.framework || "-"}`);
  console.log(`Database: ${maskConnectionString(process.env.MEOS_FIVEM_DATABASE_URL || "") || "-"}`);
  console.log(`Dossierbestand: ${health.caseDataPath || "-"}`);
  console.log("");
  console.log("Views:");
  for (const check of health.checks || []) {
    const count = Number.isFinite(check.count) ? `, ${check.count} regels` : "";
    const optional = check.required ? "verplicht" : "optioneel";
    const details = check.error ? `, ${check.error}` : "";
    console.log(`- ${statusIcon(check)} ${check.view} (${check.label}, ${optional}${count}${details})`);
  }
  if (health.error) {
    console.log("");
    console.log(`Fout: ${health.error}`);
  }
}

async function main() {
  const json = process.argv.includes("--json");
  const store = createFiveMMeosStore();
  try {
    const health = await store.sourceHealth();
    if (json) {
      console.log(JSON.stringify(health, null, 2));
    } else {
      renderHealth(health);
    }
    if (!health.ok) process.exitCode = 1;
  } finally {
    if (store.pool) await store.pool.end();
  }
}

main().catch((error) => {
  console.error(`MEOS databasecheck mislukt: ${error.message || error}`);
  process.exit(1);
});
