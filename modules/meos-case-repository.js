"use strict";

const { filterProcessVerbals, normalizeProcessVerbal, updateProcessVerbal } = require("./meos-process-verbals");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class PostgresMeosCaseRepository {
  constructor(options = {}) {
    this.databaseUrl = String(options.databaseUrl || process.env.MEOS_CASE_DATABASE_URL || "").trim();
    this.pool = null;
  }

  getPool() {
    if (!this.databaseUrl) {
      const error = new Error("MEOS_CASE_DATABASE_URL ontbreekt.");
      error.status = 503;
      throw error;
    }
    if (!this.pool) {
      const { Pool } = require("pg");
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        max: Math.max(1, Number(process.env.MEOS_CASE_DATABASE_POOL_MAX || 4)),
        idleTimeoutMillis: Number(process.env.MEOS_CASE_DATABASE_IDLE_MS || 30000),
        connectionTimeoutMillis: Number(process.env.MEOS_CASE_DATABASE_CONNECT_MS || 10000),
        statement_timeout: Number(process.env.MEOS_CASE_DATABASE_STATEMENT_TIMEOUT_MS || 10000),
        application_name: "orp-meos-cases",
        ssl: String(process.env.MEOS_CASE_DATABASE_SSL || "false").toLowerCase() === "true"
          ? { rejectUnauthorized: String(process.env.MEOS_CASE_DATABASE_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false" }
          : false
      });
    }
    return this.pool;
  }

  async withTransaction(callback) {
    const client = await this.getPool().connect();
    try {
      await client.query("begin");
      const result = await callback(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    const result = await this.getPool().query(
      `select
         to_regclass('public.meos_person_entries') is not null as person_entries,
         to_regclass('public.meos_process_verbals') is not null as process_verbals,
         to_regclass('public.meos_general_notes') is not null as general_notes`
    );
    const tables = result.rows[0] || {};
    return {
      ok: Boolean(tables.person_entries && tables.process_verbals && tables.general_notes),
      tables
    };
  }

  async loadCaseData(personIds = []) {
    const ids = [...new Set(personIds.map((value) => String(value || "").trim()).filter(Boolean))];
    const people = {};
    if (!ids.length) return { people, processVerbals: [], generalNotes: {} };
    const result = await this.getPool().query(
      `select person_id, entry_type, payload from meos_person_entries
       where person_id = any($1::text[]) order by created_at desc`,
      [ids]
    );
    for (const row of result.rows) {
      if (!people[row.person_id]) people[row.person_id] = { records: [], notes: [], fines: [] };
      const collection = row.entry_type === "record" ? "records" : row.entry_type === "note" ? "notes" : "fines";
      people[row.person_id][collection].push(row.payload || {});
    }
    return { people, processVerbals: [], generalNotes: {} };
  }

  async listProcessVerbals(options = {}) {
    const includeAll = Boolean(options.includeAll);
    const actorKey = String(options.actorKey || "").trim();
    const result = await this.getPool().query(
      `select payload from meos_process_verbals
       where ($1::boolean = true or created_by_key = $2)
       order by updated_at desc limit 1000`,
      [includeAll, actorKey]
    );
    return clone(filterProcessVerbals(result.rows.map((row) => normalizeProcessVerbal(row.payload || {})), options));
  }

  async addProcessVerbal(processVerbal) {
    const normalized = normalizeProcessVerbal(processVerbal);
    await this.getPool().query(
      `insert into meos_process_verbals(id, created_by_key, status, type, payload, created_at, updated_at)
       values($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [normalized.id, normalized.createdByKey, normalized.status, normalized.type, JSON.stringify(normalized), normalized.createdAt, normalized.updatedAt]
    );
    return clone(normalized);
  }

  async updateProcessVerbal(id, patch, options = {}) {
    return this.withTransaction(async (client) => {
      const current = await client.query("select payload from meos_process_verbals where id = $1 for update", [id]);
      if (!current.rows[0]) {
        const error = new Error("Proces-verbaal niet gevonden.");
        error.status = 404;
        throw error;
      }
      const updated = updateProcessVerbal(normalizeProcessVerbal(current.rows[0].payload), patch, options);
      await client.query(
        `update meos_process_verbals set status=$2, type=$3, payload=$4::jsonb, updated_at=$5 where id=$1`,
        [id, updated.status, updated.type, JSON.stringify(updated), updated.updatedAt]
      );
      return clone(updated);
    });
  }

  async addPersonEntries(personId, entries = []) {
    return this.withTransaction(async (client) => {
      for (const entry of entries) {
        await client.query(
          `insert into meos_person_entries(id, person_id, entry_type, payload, created_at)
           values($1,$2,$3,$4::jsonb,$5)`,
          [entry.payload.id, personId, entry.type, JSON.stringify(entry.payload), entry.payload.createdAt || new Date().toISOString()]
        );
      }
      return entries.map((entry) => clone(entry.payload));
    });
  }

  async deletePersonEntry(personId, entryType, entryId) {
    const result = await this.getPool().query(
      `delete from meos_person_entries where id=$1 and person_id=$2 and entry_type=$3 returning payload`,
      [entryId, personId, entryType]
    );
    if (!result.rows[0]) {
      const error = new Error("MEOS item niet gevonden.");
      error.status = 404;
      throw error;
    }
    return clone(result.rows[0].payload);
  }

  async getGeneralNote(actorKey) {
    const result = await this.getPool().query("select note from meos_general_notes where actor_key=$1", [actorKey]);
    return String(result.rows[0]?.note || "");
  }

  async saveGeneralNote(actorKey, note) {
    const value = String(note || "").trim().slice(0, 2000);
    await this.getPool().query(
      `insert into meos_general_notes(actor_key, note, updated_at) values($1,$2,now())
       on conflict(actor_key) do update set note=excluded.note, updated_at=now()`,
      [actorKey, value]
    );
    return value;
  }
}

function createPostgresMeosCaseRepository(options = {}) {
  return new PostgresMeosCaseRepository(options);
}

module.exports = { PostgresMeosCaseRepository, createPostgresMeosCaseRepository };
