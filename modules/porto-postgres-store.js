const { withClient } = require("./db");

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function iso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function asDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function json(value, fallback) {
  return JSON.stringify(value == null ? fallback : value);
}

function timestampMs(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function newerPortoUnit(a, b) {
  const aTime = timestampMs(a.updatedAt || a.assignedAt || a.requestedAt || a.lastSeenAt);
  const bTime = timestampMs(b.updatedAt || b.assignedAt || b.requestedAt || b.lastSeenAt);
  if (aTime !== bTime) return aTime > bTime ? a : b;
  return String(a.id || "").localeCompare(String(b.id || "")) >= 0 ? a : b;
}

function normalizePortoUnitsForWrite(units) {
  const uniqueUnits = [...new Map((units || []).filter((unit) => unit?.id).map((unit) => [unit.id, { ...unit }])).values()];
  const activeByMember = new Map();
  for (const unit of uniqueUnits) {
    if (unit.active === false || !unit.memberId) continue;
    const previous = activeByMember.get(unit.memberId);
    activeByMember.set(unit.memberId, previous ? newerPortoUnit(previous, unit) : unit);
  }
  for (const unit of uniqueUnits) {
    if (unit.active === false || !unit.memberId) continue;
    const keeper = activeByMember.get(unit.memberId);
    if (!keeper || keeper.id === unit.id) continue;
    unit.active = false;
    unit.status = "8";
    unit.statusDetail = unit.statusDetail || "Dubbele Porto-aanmelding gesloten";
    unit.vehicleNumber = "";
    unit.vehicleCode = "";
    unit.vehicleType = "";
    unit.vehicleName = "";
    unit.linkedWith = [];
    unit.endedAt = unit.endedAt || new Date().toISOString();
  }
  return uniqueUnits;
}

function personFromRow(row) {
  return {
    ...parseJson(row.raw, {}),
    id: row.id,
    name: row.name,
    discordId: row.discord_id || "",
    discordUsername: row.discord_username || "",
    avatar: row.avatar || "",
    rank: row.rank || "",
    serviceNumber: row.service_number || "",
    permRole: row.perm_role || "Geen",
    rankDate: row.rank_date || "",
    promotionDate: row.promotion_date || "",
    hiredDate: row.hired_date || "",
    status: row.status || "Actief",
    tasks: row.tasks || "",
    previousServiceNumber: row.previous_service_number || "",
    dismissalDate: row.dismissal_date || "",
    dismissalReason: row.dismissal_reason || "",
    archivedUntil: row.archived_until || "",
    reactivatedDate: row.reactivated_date || "",
    portoPhone: row.porto_phone || "",
    discordRoles: parseJson(row.discord_roles, []),
    completedTrainings: parseJson(row.completed_trainings, []),
    completedOperational: parseJson(row.completed_operational, []),
    badges: parseJson(row.badges, []),
    extraFunctions: parseJson(row.extra_functions, []),
    rankHistory: parseJson(row.rank_history, []),
    discipline: parseJson(row.discipline, []),
    mentorChecklist: parseJson(row.mentor_checklist, {})
  };
}

function portoUnitFromRow(row) {
  return {
    ...parseJson(row.raw, {}),
    id: row.id,
    memberId: row.member_id || "",
    name: row.name || "",
    rank: row.rank || "",
    serviceNumber: row.service_number || "",
    phone: row.phone || "",
    status: row.status || "",
    statusDetail: row.status_detail || "",
    vehicleNumber: row.vehicle_number || "",
    vehicleCode: row.vehicle_code || "",
    vehicleType: row.vehicle_type || "",
    vehicleName: row.vehicle_name || "",
    linkedWith: parseJson(row.linked_with, []),
    active: row.active !== false,
    requestedAt: iso(row.requested_at),
    assignedAt: iso(row.assigned_at),
    endedAt: iso(row.ended_at),
    lastSeenAt: iso(row.last_seen_at)
  };
}

async function upsertPortoUnit(client, unit) {
  if (unit.active !== false && unit.memberId) {
    await client.query(
      `update porto_units
       set
         active = false,
         status = '8',
         status_detail = 'Dubbele Porto-aanmelding automatisch gesloten',
         vehicle_number = '',
         vehicle_code = '',
         vehicle_type = '',
         vehicle_name = '',
         linked_with = '[]'::jsonb,
         ended_at = coalesce(ended_at, now()),
         updated_at = now()
       where member_id = $1
         and id <> $2
         and active = true`,
      [unit.memberId, unit.id]
    );
  }
  await client.query(
    `insert into porto_units(
      id, member_id, name, rank, service_number, phone, status, status_detail,
      vehicle_number, vehicle_code, vehicle_type, vehicle_name, linked_with, active,
      requested_at, assigned_at, ended_at, last_seen_at, raw, updated_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19::jsonb,now())
    on conflict(id) do update set
      member_id = excluded.member_id,
      name = excluded.name,
      rank = excluded.rank,
      service_number = excluded.service_number,
      phone = excluded.phone,
      status = excluded.status,
      status_detail = excluded.status_detail,
      vehicle_number = excluded.vehicle_number,
      vehicle_code = excluded.vehicle_code,
      vehicle_type = excluded.vehicle_type,
      vehicle_name = excluded.vehicle_name,
      linked_with = excluded.linked_with,
      active = excluded.active,
      requested_at = excluded.requested_at,
      assigned_at = excluded.assigned_at,
      ended_at = excluded.ended_at,
      last_seen_at = excluded.last_seen_at,
      raw = excluded.raw,
      updated_at = now()`,
    [
      unit.id,
      unit.memberId || null,
      unit.name || "",
      unit.rank || "",
      unit.serviceNumber || "",
      unit.phone || "",
      unit.status || "",
      unit.statusDetail || "",
      unit.vehicleNumber || "",
      unit.vehicleCode || "",
      unit.vehicleType || "",
      unit.vehicleName || "",
      json(unit.linkedWith, []),
      unit.active !== false,
      asDateTime(unit.requestedAt),
      asDateTime(unit.assignedAt),
      asDateTime(unit.endedAt),
      asDateTime(unit.lastSeenAt),
      json(unit, {})
    ]
  );
}

function createPostgresPortoStore(options = {}) {
  const afterWrite = typeof options.afterWrite === "function" ? options.afterWrite : null;
  let writeQueue = Promise.resolve();

  function enqueuePortoWrite(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => {});
    return run;
  }

  async function lockPortoWrite(client) {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", ["porto-write"]);
  }

  async function readState() {
    return withClient(async (client) => {
      const settingsResult = await client.query("select value from app_settings where key = 'main'");
      const settings = settingsResult.rows[0]?.value || {};
      const peopleResult = await client.query("select * from people order by name asc");
      const unitsResult = await client.query("select * from porto_units order by requested_at nulls last, id asc");

      return {
        people: peopleResult.rows.map(personFromRow),
        portoUnits: unitsResult.rows.map(portoUnitFromRow),
        portoVehicleRanges: settings.portoVehicleRanges || [],
        portoCurrentOps: settings.portoCurrentOps || null,
        portoOpsLog: settings.portoOpsLog || []
      };
    });
  }

  async function doWritePortoSettings(state) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockPortoWrite(client);
        const settingsResult = await client.query("select value from app_settings where key = 'main' for update");
        const currentSettings = settingsResult.rows[0]?.value || {};
        const nextSettings = {
          ...currentSettings,
          portoVehicleRanges: state.portoVehicleRanges || [],
          portoCurrentOps: state.portoCurrentOps || null,
          portoOpsLog: state.portoOpsLog || []
        };
        await client.query(
          "insert into app_settings(key, value, updated_at) values('main', $1::jsonb, now()) on conflict(key) do update set value = excluded.value, updated_at = now()",
          [json(nextSettings, {})]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return state;
  }

  async function doWritePortoPhone(personId, portoPhone) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockPortoWrite(client);
        await client.query("update people set porto_phone = $2, updated_at = now() where id = $1", [personId, portoPhone || ""]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return { personId, portoPhone };
  }

  async function doWritePortoUnits(units) {
    const uniqueUnits = normalizePortoUnitsForWrite(units);
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockPortoWrite(client);
        for (const unit of uniqueUnits) {
          await upsertPortoUnit(client, unit);
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return uniqueUnits;
  }

  async function writePortoSettings(state) {
    return enqueuePortoWrite(() => doWritePortoSettings(state));
  }

  async function writePortoPhone(personId, portoPhone) {
    return enqueuePortoWrite(() => doWritePortoPhone(personId, portoPhone));
  }

  async function writePortoUnits(units) {
    return enqueuePortoWrite(() => doWritePortoUnits(units));
  }

  async function writeState(state) {
    // Fallbackpad: upsert alleen bekende Porto units en instellingen, zonder de hele porto_units tabel te verwijderen.
    return enqueuePortoWrite(async () => {
      await doWritePortoSettings(state);
      for (const person of state.people || []) {
        await doWritePortoPhone(person.id, person.portoPhone || "");
      }
      await doWritePortoUnits(state.portoUnits || []);
      return state;
    });
  }

  return { readState, writeState, writePortoSettings, writePortoPhone, writePortoUnits };
}

module.exports = { createPostgresPortoStore };
