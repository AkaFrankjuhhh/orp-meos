"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const { normalizeProcessVerbal } = require("../modules/meos-process-verbals");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  return fs.readFile(envPath, "utf8").then((content) => {
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function entryId(type) {
  const prefix = type === "record" ? "PV" : type === "note" ? "NT" : "BT";
  return `${prefix}-MIG-${crypto.randomUUID()}`.toUpperCase();
}

function collectRows(data = {}) {
  const personEntries = [];
  const peopleBuckets = data.people && typeof data.people === "object" ? data.people : {};
  if (Array.isArray(data.demoPeople)) {
    for (const person of data.demoPeople) {
      peopleBuckets[String(person?.id || "")] = {
        records: person?.records,
        notes: person?.notes,
        fines: person?.fines
      };
    }
  }
  for (const [personId, bucket] of Object.entries(peopleBuckets)) {
    if (!personId) continue;
    for (const [collection, type] of [["records", "record"], ["notes", "note"], ["fines", "fine"]]) {
      for (const rawPayload of Array.isArray(bucket?.[collection]) ? bucket[collection] : []) {
        const payload = { ...rawPayload, id: String(rawPayload?.id || entryId(type)) };
        personEntries.push({ personId, type, payload });
      }
    }
  }
  const processVerbals = (Array.isArray(data.processVerbals) ? data.processVerbals : []).map((entry) => normalizeProcessVerbal(entry));
  const generalNotes = Object.entries(data.generalNotes || {}).map(([actorKey, note]) => ({ actorKey, note: String(note || "").slice(0, 2000) }));
  return { personEntries, processVerbals, generalNotes };
}

async function migrate(client, rows) {
  await client.query("begin");
  try {
    for (const entry of rows.personEntries) {
      await client.query(
        `insert into meos_person_entries(id, person_id, entry_type, payload, created_at)
         values($1,$2,$3,$4::jsonb,$5) on conflict(id) do nothing`,
        [entry.payload.id, entry.personId, entry.type, JSON.stringify(entry.payload), entry.payload.createdAt || new Date().toISOString()]
      );
    }
    for (const processVerbal of rows.processVerbals) {
      await client.query(
        `insert into meos_process_verbals(id, created_by_key, status, type, payload, created_at, updated_at)
         values($1,$2,$3,$4,$5::jsonb,$6,$7) on conflict(id) do nothing`,
        [
          processVerbal.id,
          processVerbal.createdByKey,
          processVerbal.status,
          processVerbal.type,
          JSON.stringify(processVerbal),
          processVerbal.createdAt,
          processVerbal.updatedAt
        ]
      );
    }
    for (const note of rows.generalNotes) {
      await client.query(
        `insert into meos_general_notes(actor_key, note, updated_at) values($1,$2,now())
         on conflict(actor_key) do update set note=excluded.note, updated_at=now()`,
        [note.actorKey, note.note]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function main() {
  await loadEnv();
  const apply = process.argv.includes("--apply");
  const sourcePath = path.resolve(process.env.MEOS_CASE_DATA_PATH || "meos-case-data.json");
  let sourceContent = "";
  try {
    sourceContent = await fs.readFile(sourcePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT" || apply) throw error;
  }
  const data = sourceContent ? JSON.parse(sourceContent) : {};
  const rows = collectRows(data);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    sourcePath,
    sourceExists: Boolean(sourceContent),
    personEntries: rows.personEntries.length,
    processVerbals: rows.processVerbals.length,
    generalNotes: rows.generalNotes.length
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    console.log(sourceContent
      ? "Geen data geschreven. Gebruik --apply nadat db/meos-schema.sql is uitgevoerd."
      : "Geen JSON dossierbestand gevonden; er hoeft momenteel niets gemigreerd te worden.");
    return;
  }

  const databaseUrl = String(process.env.MEOS_CASE_DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("MEOS_CASE_DATABASE_URL ontbreekt.");
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    application_name: "orp-meos-case-migration",
    ssl: String(process.env.MEOS_CASE_DATABASE_SSL || "false").toLowerCase() === "true"
      ? { rejectUnauthorized: String(process.env.MEOS_CASE_DATABASE_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false" }
      : false
  });
  try {
    const client = await pool.connect();
    try {
      await migrate(client, rows);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify({ ...summary, completed: true }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`MEOS migratie mislukt: ${error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = { collectRows, migrate };
