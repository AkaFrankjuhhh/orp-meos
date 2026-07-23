const { withClient } = require("./db");
const {
  PORTO_DUTY_HOURS_ENTERED_BY_ID,
  PORTO_DUTY_HOURS_SOURCE
} = require("./porto-duty-hours");
const { operationalWeekForDate } = require("./operational-weeks");

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

const PORTO_UNIT_FRESHNESS_FIELDS = ["updatedAt", "endedAt", "assignedAt", "requestedAt"];
const RUNTIME_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let lastRuntimeCleanupAt = 0;

function portoUnitFreshness(unit) {
  return Math.max(0, ...PORTO_UNIT_FRESHNESS_FIELDS.map((field) => timestampMs(unit?.[field])));
}

function portoUnitWriteTimestamp(unit, fallback = null) {
  for (const field of PORTO_UNIT_FRESHNESS_FIELDS) {
    const date = asDateTime(unit?.[field]);
    if (date) return date;
  }
  return fallback;
}

function closeStalePortoUnit(unit, nowIso, reason = "Dubbele Porto-aanmelding gesloten") {
  unit.active = false;
  unit.status = "8";
  unit.statusDetail = unit.statusDetail || reason;
  unit.vehicleNumber = "";
  unit.vehicleCode = "";
  unit.vehicleType = "";
  unit.vehicleName = "";
  unit.operatorSlot = "";
  unit.dutyRole = "";
  unit.linkedWith = [];
  unit.endedAt = unit.endedAt || nowIso;
  unit.updatedAt = nowIso;
  return unit;
}

function newerPortoUnit(a, b) {
  const aTime = portoUnitFreshness(a);
  const bTime = portoUnitFreshness(b);
  if (aTime !== bTime) return aTime > bTime ? a : b;
  const aActive = a?.active !== false;
  const bActive = b?.active !== false;
  if (aActive !== bActive) return aActive ? a : b;
  const aAssigned = Boolean(a?.vehicleNumber);
  const bAssigned = Boolean(b?.vehicleNumber);
  if (aAssigned !== bAssigned) return aAssigned ? a : b;
  return String(a?.id || "").localeCompare(String(b?.id || "")) >= 0 ? a : b;
}

function normalizePortoUnitsForWrite(units) {
  const nowIso = new Date().toISOString();
  const unitsById = new Map();
  for (const unit of units || []) {
    if (!unit?.id) continue;
    const copy = { ...unit };
    const previous = unitsById.get(copy.id);
    unitsById.set(copy.id, previous ? newerPortoUnit(previous, copy) : copy);
  }
  const uniqueUnits = [...unitsById.values()];
  const newestByMember = new Map();
  for (const unit of uniqueUnits) {
    if (!unit.memberId) continue;
    const previous = newestByMember.get(unit.memberId);
    newestByMember.set(unit.memberId, previous ? newerPortoUnit(previous, unit) : unit);
  }
  for (const unit of uniqueUnits) {
    if (!unit.memberId || unit.active === false) continue;
    const newest = newestByMember.get(unit.memberId);
    if (!newest || newest.id === unit.id) continue;
    closeStalePortoUnit(unit, nowIso);
  }
  return uniqueUnits;
}

async function cleanupRuntimePortoUnits(client, { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastRuntimeCleanupAt < RUNTIME_CLEANUP_INTERVAL_MS) return;
  lastRuntimeCleanupAt = now;
  await client.query(
    `delete from porto_units
     where active is not true
        or status = '8'
        or ended_at is not null`
  );
}

async function deletePortoUnitIfCurrent(client, unit) {
  const incomingUpdatedAt = portoUnitWriteTimestamp(unit, new Date(0));
  await client.query(
    `delete from porto_units
     where id = $1
       and (
         coalesce($2::timestamptz, 'epoch'::timestamptz) >= coalesce(updated_at, 'epoch'::timestamptz)
         or $3::boolean is true
       )`,
    [unit.id, incomingUpdatedAt, unit.active === false || unit.status === "8" || Boolean(unit.endedAt)]
  );
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
  const raw = parseJson(row.raw, {});
  const active = row.active !== false;
  const vehicleNumber = row.vehicle_number || "";
  const operatorSlot = active && vehicleNumber ? String(raw.operatorSlot || "").trim() : "";
  const dutyRole = active && vehicleNumber && ["OVD", "OPCO", "K9", "K9_BEGELEIDER"].includes(String(raw.dutyRole || "").trim())
    ? String(raw.dutyRole).trim()
    : "";
  return {
    ...raw,
    id: row.id,
    memberId: row.member_id || "",
    name: row.name || "",
    rank: row.rank || "",
    serviceNumber: row.service_number || "",
    phone: row.phone || "",
    status: row.status || "",
    statusDetail: row.status_detail || "",
    vehicleNumber,
    vehicleCode: row.vehicle_code || "",
    vehicleType: row.vehicle_type || "",
    vehicleName: row.vehicle_name || "",
    operatorSlot,
    dutyRole,
    linkedWith: parseJson(row.linked_with, []),
    active,
    requestedAt: iso(row.requested_at),
    assignedAt: iso(row.assigned_at),
    endedAt: iso(row.ended_at),
    lastSeenAt: iso(row.last_seen_at),
    updatedAt: iso(row.updated_at)
  };
}

function hourEntryFromRow(row) {
  const raw = parseJson(row.raw, {});
  const minutes = Number(row.minutes || raw.minutes || raw.durationMinutes || 0);
  const hoursValue = row.hours_value != null ? Number(row.hours_value) : Number(raw.hours || raw.hoursValue || minutes / 60 || 0);
  return {
    ...raw,
    id: row.id,
    personId: row.person_id || raw.personId || "",
    discordId: row.discord_id || raw.discordId || "",
    job: row.job || raw.job || "",
    startedAt: iso(row.started_at) || raw.startedAt || "",
    endedAt: iso(row.ended_at) || raw.endedAt || "",
    minutes: Number.isFinite(minutes) ? minutes : 0,
    weekYear: row.week_year || raw.weekYear || null,
    weekNumber: row.week_number || raw.weekNumber || null,
    hours: Number.isFinite(hoursValue) ? hoursValue : 0,
    enteredById: row.entered_by_id || raw.enteredById || "",
    enteredByName: row.entered_by_name || raw.enteredByName || "",
    enteredAt: iso(row.entered_at) || raw.enteredAt || "",
    source: raw.source || ""
  };
}

async function upsertPortoUnit(client, unit) {
  if (unit.active === false || unit.status === "8" || unit.endedAt) {
    await deletePortoUnitIfCurrent(client, unit);
    return;
  }

  const rawUnit = { ...unit };
  delete rawUnit.forceCloseDuplicateMemberUnits;
  const incomingUpdatedAt = portoUnitWriteTimestamp(unit, new Date());
  if (unit.active !== false && unit.memberId) {
    if (unit.vehicleNumber) {
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
           raw = raw - 'operatorSlot' - 'dutyRole',
           linked_with = '[]'::jsonb,
           ended_at = coalesce(ended_at, now()),
           updated_at = now()
         where member_id = $1
           and id <> $2
           and active = true
           and (
             coalesce($3::timestamptz, 'epoch'::timestamptz) >= coalesce(updated_at, 'epoch'::timestamptz)
             or $4::boolean is true
           )`,
        [unit.memberId, unit.id, incomingUpdatedAt, unit.forceCloseDuplicateMemberUnits === true]
      );
    } else {
      const assignedResult = await client.query(
        `select id
         from porto_units
         where member_id = $1
           and id <> $2
           and active = true
           and coalesce(vehicle_number, '') <> ''
         limit 1`,
        [unit.memberId, unit.id]
      );
      if (assignedResult.rowCount) {
        unit.active = false;
        unit.status = "8";
        unit.statusDetail = "Status 0-aanmelding genegeerd: persoon is al ingedeeld";
        unit.endedAt = unit.endedAt || new Date().toISOString();
      }
    }
  }
  await client.query(
    `insert into porto_units(
      id, member_id, name, rank, service_number, phone, status, status_detail,
      vehicle_number, vehicle_code, vehicle_type, vehicle_name, linked_with, active,
      requested_at, assigned_at, ended_at, last_seen_at, raw, updated_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19::jsonb,$20)
    on conflict(id) do update set
      member_id = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.member_id else porto_units.member_id end,
      name = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.name else porto_units.name end,
      rank = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.rank else porto_units.rank end,
      service_number = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.service_number else porto_units.service_number end,
      phone = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.phone else porto_units.phone end,
      status = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.status else porto_units.status end,
      status_detail = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.status_detail else porto_units.status_detail end,
      vehicle_number = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.vehicle_number else porto_units.vehicle_number end,
      vehicle_code = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.vehicle_code else porto_units.vehicle_code end,
      vehicle_type = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.vehicle_type else porto_units.vehicle_type end,
      vehicle_name = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.vehicle_name else porto_units.vehicle_name end,
      linked_with = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.linked_with else porto_units.linked_with end,
      active = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.active else porto_units.active end,
      requested_at = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.requested_at else porto_units.requested_at end,
      assigned_at = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.assigned_at else porto_units.assigned_at end,
      ended_at = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.ended_at else porto_units.ended_at end,
      last_seen_at = greatest(coalesce(porto_units.last_seen_at, 'epoch'::timestamptz), coalesce(excluded.last_seen_at, 'epoch'::timestamptz)),
      raw = case when coalesce(excluded.updated_at, 'epoch'::timestamptz) >= coalesce(porto_units.updated_at, 'epoch'::timestamptz) then excluded.raw else porto_units.raw end,
      updated_at = greatest(coalesce(porto_units.updated_at, 'epoch'::timestamptz), coalesce(excluded.updated_at, 'epoch'::timestamptz))`,
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
      json(rawUnit, {}),
      incomingUpdatedAt
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
      await cleanupRuntimePortoUnits(client);
      const unitsResult = await client.query("select * from porto_units where active is true order by requested_at nulls last, id asc");
      const portoUnits = normalizePortoUnitsForWrite(unitsResult.rows.map(portoUnitFromRow));
      const dutyWeek = operationalWeekForDate(new Date(), { timeZone: process.env.PORTO_DUTY_HOURS_TIME_ZONE || "Europe/Amsterdam" });
      const hoursResult = await client.query(
        `select *
         from hours
         where week_year = $1
           and week_number = $2
           and (
             entered_by_id = $3
             or id like 'porto-duty-%'
             or raw->>'source' = $4
           )
         order by started_at nulls last, id asc`,
        [dutyWeek.weekYear, dutyWeek.weekNumber, PORTO_DUTY_HOURS_ENTERED_BY_ID, PORTO_DUTY_HOURS_SOURCE]
      );
      const hours = hoursResult.rows.map(hourEntryFromRow);

      return {
        people: peopleResult.rows.map(personFromRow),
        hours,
        portoUnits,
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

  async function doWritePortoPhone(personId, portoPhone, profilePatch = {}) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockPortoWrite(client);
        await client.query(
          "update people set porto_phone = $2, raw = coalesce(raw, '{}'::jsonb) || $3::jsonb, updated_at = now() where id = $1",
          [personId, portoPhone || "", JSON.stringify(profilePatch || {})]
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return { personId, portoPhone, profilePatch };
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
        await cleanupRuntimePortoUnits(client, { force: true });
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

  async function writePortoPhone(personId, portoPhone, profilePatch = {}) {
    return enqueuePortoWrite(() => doWritePortoPhone(personId, portoPhone, profilePatch));
  }

  async function writePortoUnits(units) {
    return enqueuePortoWrite(() => doWritePortoUnits(units));
  }

  async function writeState(state) {
    // Fallbackpad: upsert alleen bekende Porto units en instellingen, zonder de hele porto_units tabel te verwijderen.
    return enqueuePortoWrite(async () => {
      await doWritePortoSettings(state);
      for (const person of state.people || []) {
        await doWritePortoPhone(person.id, person.portoPhone || "", { k9Name: person.k9Name || "" });
      }
      await doWritePortoUnits(state.portoUnits || []);
      return state;
    });
  }

  return { readState, writeState, writePortoSettings, writePortoPhone, writePortoUnits };
}

module.exports = { createPostgresPortoStore };
