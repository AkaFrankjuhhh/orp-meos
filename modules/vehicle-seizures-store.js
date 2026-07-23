const { withClient } = require("./db");

let sharedVehiclePool = null;
let vehicleSeizuresEnsured = false;

function trimText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function asDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sslConfig(value) {
  return String(value || "false").toLowerCase() === "true" ? { rejectUnauthorized: false } : false;
}

function vehicleDatabaseUrl() {
  return String(process.env.VEHICLE_SEIZURE_DATABASE_URL || "").trim();
}

function useDedicatedVehicleDatabase() {
  const dedicated = vehicleDatabaseUrl();
  return Boolean(dedicated && dedicated !== String(process.env.DATABASE_URL || "").trim());
}

function createVehiclePool() {
  if (sharedVehiclePool) return sharedVehiclePool;
  const { Pool } = require("pg");
  sharedVehiclePool = new Pool({
    connectionString: vehicleDatabaseUrl(),
    max: Math.max(1, Math.min(10, Number(process.env.VEHICLE_SEIZURE_DATABASE_POOL_MAX || 2))),
    idleTimeoutMillis: Number(process.env.VEHICLE_SEIZURE_DATABASE_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.VEHICLE_SEIZURE_DATABASE_POOL_CONNECT_MS || 10000),
    ssl: sslConfig(process.env.VEHICLE_SEIZURE_DATABASE_SSL || process.env.DATABASE_SSL)
  });
  sharedVehiclePool.on("error", (error) => {
    console.error("Vehicle seizure PostgreSQL pool error:", error.message || error);
  });
  return sharedVehiclePool;
}

async function withVehicleClient(callback) {
  if (!useDedicatedVehicleDatabase()) return withClient(callback);
  const pool = createVehiclePool();
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

async function closeVehiclePool() {
  if (!sharedVehiclePool) return;
  const pool = sharedVehiclePool;
  sharedVehiclePool = null;
  await pool.end();
}

function normalizeStatus(value) {
  const status = trimText(value, 40).toLowerCase();
  if (["vrijgegeven", "released", "afgerond", "gesloten"].includes(status)) return "Vrijgegeven";
  return "Actief";
}

function normalizeSeizure(input = {}) {
  const now = new Date().toISOString();
  const status = normalizeStatus(input.status);
  return {
    id: trimText(input.id, 80),
    organization: trimText(input.organization, 40),
    vehicle: trimText(input.vehicle, 160),
    plate: trimText(input.plate, 80),
    ownerName: trimText(input.ownerName, 160),
    location: trimText(input.location, 200),
    reason: trimText(input.reason, 1000),
    notes: trimText(input.notes, 1000),
    status,
    createdById: trimText(input.createdById, 80),
    createdByName: trimText(input.createdByName, 160),
    createdAt: input.createdAt || now,
    releasedById: trimText(input.releasedById, 80),
    releasedByName: trimText(input.releasedByName, 160),
    releasedAt: input.releasedAt || "",
    releaseReason: trimText(input.releaseReason, 1000),
    updatedAt: input.updatedAt || now
  };
}

function rowToSeizure(row = {}) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  return normalizeSeizure({
    ...raw,
    id: row.id || raw.id,
    organization: row.organization || raw.organization,
    vehicle: row.vehicle || raw.vehicle,
    plate: row.plate || raw.plate,
    ownerName: row.owner_name || raw.ownerName,
    location: row.location || raw.location,
    reason: row.reason || raw.reason,
    notes: row.notes || raw.notes,
    status: row.status || raw.status,
    createdById: row.created_by_id || raw.createdById,
    createdByName: row.created_by_name || raw.createdByName,
    createdAt: row.created_at || raw.createdAt,
    releasedById: row.released_by_id || raw.releasedById,
    releasedByName: row.released_by_name || raw.releasedByName,
    releasedAt: row.released_at || raw.releasedAt,
    releaseReason: row.release_reason || raw.releaseReason,
    updatedAt: row.updated_at || raw.updatedAt
  });
}

async function ensureVehicleSeizuresTable() {
  if (vehicleSeizuresEnsured) return;
  await withVehicleClient((client) => client.query(`
    create table if not exists vehicle_seizures (
      id text primary key,
      organization text not null,
      vehicle text not null,
      plate text not null,
      owner_name text not null,
      location text not null,
      reason text not null,
      notes text not null default '',
      status text not null default 'Actief',
      created_by_id text,
      created_by_name text,
      created_at timestamptz not null default now(),
      released_by_id text,
      released_by_name text,
      released_at timestamptz,
      release_reason text,
      raw jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `));
  await withVehicleClient((client) => client.query("create index if not exists vehicle_seizures_status_idx on vehicle_seizures(status, created_at desc)"));
  await withVehicleClient((client) => client.query("create index if not exists vehicle_seizures_created_at_idx on vehicle_seizures(created_at desc)"));
  await withVehicleClient((client) => client.query("create index if not exists vehicle_seizures_plate_idx on vehicle_seizures(plate)"));
  vehicleSeizuresEnsured = true;
}

function createVehicleSeizuresStore({ storageMode, readState, writeState, afterWrite } = {}) {
  const usePostgres = storageMode === "postgres";

  async function listSeizures({ limit = 500 } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
    if (usePostgres) {
      await ensureVehicleSeizuresTable();
      const result = await withVehicleClient((client) => client.query(
        `select *
         from vehicle_seizures
         order by created_at desc, updated_at desc
         limit $1`,
        [safeLimit]
      ));
      return result.rows.map(rowToSeizure);
    }

    const state = await Promise.resolve(readState());
    return (Array.isArray(state.vehicleSeizures) ? state.vehicleSeizures : [])
      .map(normalizeSeizure)
      .sort((first, second) => new Date(second.createdAt || 0) - new Date(first.createdAt || 0))
      .slice(0, safeLimit);
  }

  async function createSeizure(input) {
    const seizure = normalizeSeizure(input);
    if (usePostgres) {
      await ensureVehicleSeizuresTable();
      await withVehicleClient((client) => client.query(
        `insert into vehicle_seizures(
          id, organization, vehicle, plate, owner_name, location, reason, notes, status,
          created_by_id, created_by_name, created_at, released_by_id, released_by_name,
          released_at, release_reason, raw, updated_at
        ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,now())`,
        [
          seizure.id,
          seizure.organization,
          seizure.vehicle,
          seizure.plate,
          seizure.ownerName,
          seizure.location,
          seizure.reason,
          seizure.notes,
          seizure.status,
          seizure.createdById,
          seizure.createdByName,
          asDateTime(seizure.createdAt),
          seizure.releasedById,
          seizure.releasedByName,
          asDateTime(seizure.releasedAt),
          seizure.releaseReason,
          JSON.stringify(seizure)
        ]
      ));
      afterWrite?.();
      return seizure;
    }

    const state = await Promise.resolve(readState());
    state.vehicleSeizures = Array.isArray(state.vehicleSeizures) ? state.vehicleSeizures : [];
    state.vehicleSeizures.unshift(seizure);
    await Promise.resolve(writeState(state));
    afterWrite?.();
    return seizure;
  }

  async function updateSeizureStatus(id, patch = {}) {
    const seizureId = trimText(id, 80);
    if (!seizureId) return null;
    const status = normalizeStatus(patch.status);
    const now = new Date().toISOString();
    const releasePatch = {
      status,
      releasedById: trimText(patch.releasedById, 80),
      releasedByName: trimText(patch.releasedByName, 160),
      releasedAt: status === "Vrijgegeven" ? (patch.releasedAt || now) : "",
      releaseReason: trimText(patch.releaseReason, 1000),
      updatedAt: now
    };

    if (usePostgres) {
      await ensureVehicleSeizuresTable();
      const result = await withVehicleClient(async (client) => {
        await client.query("begin");
        try {
          const currentResult = await client.query("select * from vehicle_seizures where id = $1 for update", [seizureId]);
          const current = rowToSeizure(currentResult.rows[0]);
          if (!current?.id) {
            await client.query("rollback");
            return null;
          }
          const next = normalizeSeizure({ ...current, ...releasePatch });
          const updateResult = await client.query(
            `update vehicle_seizures
             set status = $2,
                 released_by_id = $3,
                 released_by_name = $4,
                 released_at = $5,
                 release_reason = $6,
                 raw = $7::jsonb,
                 updated_at = now()
             where id = $1
             returning *`,
            [
              seizureId,
              next.status,
              next.releasedById,
              next.releasedByName,
              asDateTime(next.releasedAt),
              next.releaseReason,
              JSON.stringify(next)
            ]
          );
          await client.query("commit");
          return rowToSeizure(updateResult.rows[0]);
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
      if (result) afterWrite?.();
      return result;
    }

    const state = await Promise.resolve(readState());
    state.vehicleSeizures = Array.isArray(state.vehicleSeizures) ? state.vehicleSeizures : [];
    const index = state.vehicleSeizures.findIndex((item) => item.id === seizureId);
    if (index === -1) return null;
    state.vehicleSeizures[index] = normalizeSeizure({ ...state.vehicleSeizures[index], ...releasePatch });
    await Promise.resolve(writeState(state));
    afterWrite?.();
    return state.vehicleSeizures[index];
  }

  return {
    ensureVehicleSeizuresTable: usePostgres ? ensureVehicleSeizuresTable : async () => {},
    listSeizures,
    createSeizure,
    updateSeizureStatus,
    close: closeVehiclePool
  };
}

module.exports = { createVehicleSeizuresStore };
