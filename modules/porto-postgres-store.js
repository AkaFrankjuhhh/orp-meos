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

function createPostgresPortoStore(options = {}) {
  const afterWrite = typeof options.afterWrite === "function" ? options.afterWrite : null;
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
        portoCurrentOps: settings.portoCurrentOps || null
      };
    });
  }

  async function writeState(state) {
    // Porto gebruikt in PostgreSQL-modus alleen deze tabellen/settings, zodat pManager-data niet onbedoeld wordt overschreven.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        const settingsResult = await client.query("select value from app_settings where key = 'main' for update");
        const currentSettings = settingsResult.rows[0]?.value || {};
        const nextSettings = {
          ...currentSettings,
          portoVehicleRanges: state.portoVehicleRanges || [],
          portoCurrentOps: state.portoCurrentOps || null
        };

        await client.query(
          "insert into app_settings(key, value, updated_at) values('main', $1::jsonb, now()) on conflict(key) do update set value = excluded.value, updated_at = now()",
          [json(nextSettings, {})]
        );

        for (const person of state.people || []) {
          await client.query("update people set porto_phone = $2, updated_at = now() where id = $1", [person.id, person.portoPhone || ""]);
        }

        await client.query("delete from porto_units");
        for (const unit of state.portoUnits || []) {
          await client.query(
            `insert into porto_units(
              id, member_id, name, rank, service_number, phone, status, status_detail,
              vehicle_number, vehicle_code, vehicle_type, vehicle_name, linked_with, active,
              requested_at, assigned_at, ended_at, last_seen_at, raw, updated_at
            ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19::jsonb,now())`,
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

        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return state;
  }

  return { readState, writeState };
}

module.exports = { createPostgresPortoStore };
