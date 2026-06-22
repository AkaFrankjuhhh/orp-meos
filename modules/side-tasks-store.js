const crypto = require("node:crypto");
const { withClient } = require("./db");
const { sideTaskForKey, statusOption } = require("./side-tasks-config");

let schemaReady = false;
let sideTaskPool = null;
const DSI_COMMAND_UNITS = Object.freeze({ TCO: "24-01", ACO: "24-02" });
const DSI_FIRST_REGULAR_UNIT = 3;
const DSI_UNIT_CAPACITY = Number(sideTaskForKey("DSI")?.dsiUnits?.capacity || 3);

function sideTaskDatabaseUrl() {
  return String(process.env.SIDE_TASK_DATABASE_URL || "").trim();
}

function sideTaskDatabaseConfig() {
  const connectionString = sideTaskDatabaseUrl();
  if (!connectionString) return null;
  const sslEnabled = String(process.env.SIDE_TASK_DATABASE_SSL || process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  const configuredMax = Number(process.env.SIDE_TASK_DATABASE_POOL_MAX || 2);
  return {
    connectionString,
    max: Number.isFinite(configuredMax) ? Math.min(Math.max(Math.floor(configuredMax), 1), 8) : 2,
    idleTimeoutMillis: Number(process.env.SIDE_TASK_DATABASE_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.SIDE_TASK_DATABASE_POOL_CONNECT_MS || 10000),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false
  };
}

function createSideTaskPool() {
  if (sideTaskPool) return sideTaskPool;
  const config = sideTaskDatabaseConfig();
  if (!config) return null;
  const { Pool } = require("pg");
  sideTaskPool = new Pool(config);
  sideTaskPool.on("error", (error) => {
    console.error("Neventaken PostgreSQL pool error:", error.message || error);
  });
  return sideTaskPool;
}

async function withSideTaskClient(callback) {
  const pool = createSideTaskPool();
  if (!pool) return withClient(callback);
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function memberFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskKey: row.task_key,
    discordId: row.discord_id,
    discordUsername: row.discord_username || "",
    displayName: row.display_name || "",
    avatarUrl: row.avatar_url || "",
    phone: row.phone || "",
    callSign: row.call_sign || "",
    aliasName: row.alias_name || "",
    originalNickname: row.original_nickname || "",
    unitNumber: row.unit_number || "",
    commandRole: row.command_role || "",
    status: row.status || "8",
    statusLabel: statusOption(row.status).label,
    statusDetail: row.status_detail || "",
    specialties: jsonArray(row.specialties),
    raw: row.raw && typeof row.raw === "object" ? row.raw : {},
    addedByDiscordId: row.added_by_discord_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureSideTaskSchema() {
  if (schemaReady) return;
  await withSideTaskClient(async (client) => {
    await client.query(`
      create table if not exists app_sessions (
        id text primary key,
        payload jsonb not null default '{}'::jsonb,
        expires_at timestamptz not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query("create index if not exists app_sessions_expires_at_idx on app_sessions(expires_at)");
    await client.query(`
      create table if not exists side_task_members (
        id text primary key,
        task_key text not null,
        discord_id text not null,
        discord_username text not null default '',
        display_name text not null default '',
        avatar_url text not null default '',
        phone text not null default '',
        call_sign text not null default '',
        alias_name text not null default '',
        original_nickname text not null default '',
        status text not null default '8',
        status_detail text not null default 'Niet aanwezig',
        specialties jsonb not null default '[]'::jsonb,
        added_by_discord_id text not null default '',
        raw jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create unique index if not exists side_task_members_task_discord_uidx
      on side_task_members(task_key, discord_id)
    `);
    await client.query(`
      create index if not exists side_task_members_task_status_idx
      on side_task_members(task_key, status, updated_at desc)
    `);
    await client.query("alter table side_task_members add column if not exists phone text not null default ''");
    await client.query("alter table side_task_members add column if not exists unit_number text not null default ''");
    await client.query("alter table side_task_members add column if not exists command_role text not null default ''");
    await client.query("create index if not exists side_task_members_task_unit_idx on side_task_members(task_key, unit_number) where unit_number <> ''");
    await client.query("create unique index if not exists side_task_members_task_command_role_uidx on side_task_members(task_key, command_role) where command_role <> ''");
    await client.query(`
      create table if not exists side_task_member_archive (
        id text primary key,
        task_key text not null,
        member_id text not null,
        discord_id text not null,
        snapshot jsonb not null default '{}'::jsonb,
        reason text not null default '',
        archived_by_discord_id text not null default '',
        archived_at timestamptz not null default now(),
        restored_at timestamptz
      )
    `);
    await client.query("create index if not exists side_task_member_archive_task_archived_idx on side_task_member_archive(task_key, archived_at desc)");
    await client.query("create index if not exists side_task_member_archive_task_discord_idx on side_task_member_archive(task_key, discord_id, archived_at desc)");
    await client.query(`
      create table if not exists side_task_access_revocations (
        task_key text not null,
        discord_id text not null,
        reason text not null default '',
        revoked_at timestamptz not null default now(),
        primary key (task_key, discord_id)
      )
    `);
  });
  schemaReady = true;
}

function normalizeMember(taskKey, member) {
  const status = String(member.status || "8");
  return {
    id: member.id || crypto.randomUUID(),
    taskKey,
    discordId: String(member.discordId || "").trim(),
    discordUsername: String(member.discordUsername || "").trim(),
    displayName: String(member.displayName || "").trim(),
    avatarUrl: String(member.avatarUrl || "").trim(),
    phone: String(member.phone || "").trim(),
    callSign: String(member.callSign || "").trim(),
    aliasName: String(member.aliasName || "").trim(),
    originalNickname: String(member.originalNickname || "").trim(),
    unitNumber: String(member.unitNumber || "").trim(),
    commandRole: ["ACO", "TCO"].includes(String(member.commandRole || "").trim()) ? String(member.commandRole).trim() : "",
    status,
    statusDetail: String(member.statusDetail || statusOption(status).label).trim(),
    specialties: Array.isArray(member.specialties) ? member.specialties : [],
    addedByDiscordId: String(member.addedByDiscordId || "").trim(),
    raw: member.raw && typeof member.raw === "object" ? member.raw : {}
  };
}

function createSideTasksStore() {
  async function listMembers(taskKey) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        `select * from side_task_members
         where task_key = $1
         order by case when status = '8' then 1 else 0 end, call_sign nulls last, display_name, discord_id`,
        [taskKey]
      );
      return result.rows.map(memberFromRow);
    });
  }

  async function findMemberByDiscordId(taskKey, discordId) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        "select * from side_task_members where task_key = $1 and discord_id = $2 limit 1",
        [taskKey, String(discordId)]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  async function findMemberById(taskKey, id) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        "select * from side_task_members where task_key = $1 and id = $2 limit 1",
        [taskKey, String(id)]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  async function findActiveDsiNicknameMember(discordId) {
    const normalizedDiscordId = String(discordId || "").trim();
    if (!normalizedDiscordId) return null;
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        `select * from side_task_members
         where task_key = 'DSI'
           and discord_id = $1
           and status in ('0', '1', '4')
         limit 1`,
        [normalizedDiscordId]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  async function upsertMember(taskKey, member) {
    await ensureSideTaskSchema();
    const normalized = normalizeMember(taskKey, member);
    if (!normalized.discordId) {
      const error = new Error("Discord ID ontbreekt.");
      error.status = 400;
      throw error;
    }
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        `insert into side_task_members (
          id, task_key, discord_id, discord_username, display_name, avatar_url,
          phone, call_sign, alias_name, original_nickname, unit_number, command_role, status, status_detail,
          specialties, added_by_discord_id, raw, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17::jsonb, now())
        on conflict (task_key, discord_id) do update set
          discord_username = excluded.discord_username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          -- Discord synchronisaties kennen deze handmatig beheerde profielvelden
          -- niet altijd. Bewaar bestaande waarden wanneer de sync niets aanlevert.
          phone = case
            when excluded.phone <> '' then excluded.phone
            else side_task_members.phone
          end,
          call_sign = case
            when excluded.call_sign <> '' then excluded.call_sign
            else side_task_members.call_sign
          end,
          alias_name = case
            when excluded.alias_name <> '' then excluded.alias_name
            else side_task_members.alias_name
          end,
          original_nickname = case
            when excluded.original_nickname <> '' then excluded.original_nickname
            else side_task_members.original_nickname
          end,
          unit_number = excluded.unit_number,
          command_role = excluded.command_role,
          status = excluded.status,
          status_detail = excluded.status_detail,
          specialties = excluded.specialties,
          raw = side_task_members.raw || excluded.raw,
          updated_at = now()
        returning *`,
        [
          normalized.id,
          normalized.taskKey,
          normalized.discordId,
          normalized.discordUsername,
          normalized.displayName,
          normalized.avatarUrl,
          normalized.phone,
          normalized.callSign,
          normalized.aliasName,
          normalized.originalNickname,
          normalized.unitNumber,
          normalized.commandRole,
          normalized.status,
          normalized.statusDetail,
          JSON.stringify(normalized.specialties),
          normalized.addedByDiscordId,
          JSON.stringify(normalized.raw)
        ]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  async function syncMemberFromDiscord(taskKey, member) {
    await ensureSideTaskSchema();
    const normalized = normalizeMember(taskKey, member);
    if (!normalized.discordId) {
      const error = new Error("Discord ID ontbreekt.");
      error.status = 400;
      throw error;
    }
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        `insert into side_task_members (
          id, task_key, discord_id, discord_username, display_name, avatar_url,
          phone, call_sign, alias_name, original_nickname, unit_number, command_role, status, status_detail,
          specialties, added_by_discord_id, raw, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17::jsonb, now())
        on conflict (task_key, discord_id) do update set
          discord_username = excluded.discord_username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          specialties = excluded.specialties,
          raw = side_task_members.raw || excluded.raw,
          updated_at = now()
        returning *`,
        [
          normalized.id,
          normalized.taskKey,
          normalized.discordId,
          normalized.discordUsername,
          normalized.displayName,
          normalized.avatarUrl,
          normalized.phone,
          normalized.callSign,
          normalized.aliasName,
          normalized.originalNickname,
          normalized.unitNumber,
          normalized.commandRole,
          normalized.status,
          normalized.statusDetail,
          JSON.stringify(normalized.specialties),
          normalized.addedByDiscordId,
          JSON.stringify(normalized.raw)
        ]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  async function updateMember(taskKey, id, patch) {
    const existing = await findMemberById(taskKey, id);
    if (!existing) {
      const error = new Error("Lid niet gevonden.");
      error.status = 404;
      throw error;
    }
    return upsertMember(taskKey, { ...existing, ...patch, id: existing.id, discordId: existing.discordId });
  }

  async function updateMemberProfile(taskKey, id, patch) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        `update side_task_members
         set call_sign = $3,
             alias_name = $4,
             updated_at = now()
         where task_key = $1 and id = $2
         returning *`,
        [
          taskKey,
          String(id),
          String(patch.callSign || "").trim(),
          String(patch.aliasName || "").trim()
        ]
      );
      const member = memberFromRow(result.rows[0]);
      if (member) return member;
      const error = new Error("Lid niet gevonden.");
      error.status = 404;
      throw error;
    });
  }

  async function deleteMember(taskKey, id) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        "delete from side_task_members where task_key = $1 and id = $2 returning *",
        [taskKey, String(id)]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  function archiveFromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      taskKey: row.task_key,
      memberId: row.member_id,
      discordId: row.discord_id,
      snapshot: row.snapshot && typeof row.snapshot === "object" ? row.snapshot : {},
      reason: row.reason || "",
      archivedByDiscordId: row.archived_by_discord_id || "",
      archivedAt: row.archived_at,
      restoredAt: row.restored_at
    };
  }

  async function listArchives(taskKey) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        "select * from side_task_member_archive where task_key = $1 and restored_at is null order by archived_at desc",
        [taskKey]
      );
      return result.rows.map(archiveFromRow);
    });
  }

  async function archiveMemberByDiscordId(taskKey, discordId, reason = "", archivedByDiscordId = "") {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      await client.query("begin");
      try {
        const memberResult = await client.query(
          "select * from side_task_members where task_key = $1 and discord_id = $2 for update",
          [taskKey, String(discordId)]
        );
        const member = memberFromRow(memberResult.rows[0]);
        if (!member) {
          await client.query("commit");
          return null;
        }
        await client.query("delete from side_task_members where task_key = $1 and discord_id = $2", [taskKey, String(discordId)]);
        const archiveResult = await client.query(
          `insert into side_task_member_archive (
            id, task_key, member_id, discord_id, snapshot, reason, archived_by_discord_id
          ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
          returning *`,
          [crypto.randomUUID(), taskKey, member.id, member.discordId, JSON.stringify(member), String(reason || ""), String(archivedByDiscordId || "")]
        );
        await client.query("delete from app_sessions where payload->>'taskKey' = $1 and payload->'user'->>'id' = $2", [taskKey, member.discordId]);
        await client.query(
          `insert into side_task_access_revocations (task_key, discord_id, reason)
           values ($1, $2, $3)
           on conflict (task_key, discord_id) do update set reason = excluded.reason, revoked_at = now()`,
          [taskKey, member.discordId, String(reason || "")]
        );
        await client.query("commit");
        return archiveFromRow(archiveResult.rows[0]);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  }

  async function restoreArchivedMember(taskKey, discordId, patch = {}) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const archiveResult = await client.query(
        `select * from side_task_member_archive
         where task_key = $1 and discord_id = $2
         order by archived_at desc limit 1`,
        [taskKey, String(discordId)]
      );
      const archive = archiveFromRow(archiveResult.rows[0]);
      const snapshot = archive?.snapshot || {};
      const member = await upsertMember(taskKey, {
        ...snapshot,
        ...patch,
        id: snapshot.id || crypto.randomUUID(),
        discordId: String(discordId),
        status: "8",
        statusDetail: statusOption("8").label,
        unitNumber: "",
        commandRole: ""
      });
      if (archive) {
        await client.query("update side_task_member_archive set restored_at = now() where id = $1", [archive.id]);
      }
      await client.query("delete from side_task_access_revocations where task_key = $1 and discord_id = $2", [taskKey, String(discordId)]);
      return member;
    });
  }

  async function updateArchiveReason(taskKey, archiveId, reason, actorDiscordId = "") {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        `update side_task_member_archive
         set reason = $3, archived_by_discord_id = case when $4 <> '' then $4 else archived_by_discord_id end
         where task_key = $1 and id = $2
         returning *`,
        [taskKey, String(archiveId), String(reason || "").trim(), String(actorDiscordId || "")]
      );
      return archiveFromRow(result.rows[0]);
    });
  }

  async function revokeAccess(taskKey, discordId, reason = "") {
    await ensureSideTaskSchema();
    return withSideTaskClient((client) => client.query(
      `insert into side_task_access_revocations (task_key, discord_id, reason)
       values ($1, $2, $3)
       on conflict (task_key, discord_id) do update set reason = excluded.reason, revoked_at = now()`,
      [taskKey, String(discordId), String(reason || "")]
    ));
  }

  async function clearAccessRevocation(taskKey, discordId) {
    await ensureSideTaskSchema();
    return withSideTaskClient((client) => client.query(
      "delete from side_task_access_revocations where task_key = $1 and discord_id = $2",
      [taskKey, String(discordId)]
    ));
  }

  async function isAccessRevoked(taskKey, discordId) {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      const result = await client.query(
        "select 1 from side_task_access_revocations where task_key = $1 and discord_id = $2 limit 1",
        [taskKey, String(discordId)]
      );
      return result.rows.length > 0;
    });
  }

  function dsiUnitNumber(number) {
    const match = /^24-(\d{1,2})$/.exec(String(number || "").trim());
    if (!match) return "";
    const suffix = Number(match[1]);
    return suffix >= 1 && suffix <= 99 ? `24-${String(suffix).padStart(2, "0")}` : "";
  }

  function isReservedDsiUnit(unitNumber) {
    return Object.values(DSI_COMMAND_UNITS).includes(unitNumber);
  }

  async function assignDsiUnit(taskKey, memberId, requestedUnitNumber = "") {
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`side-task-dsi-units:${taskKey}`]);
        const memberResult = await client.query("select * from side_task_members where task_key = $1 and id = $2 for update", [taskKey, String(memberId)]);
        const member = memberFromRow(memberResult.rows[0]);
        if (!member) {
          const error = new Error("DSI-lid niet gevonden.");
          error.status = 404;
          throw error;
        }
        const commandUnit = DSI_COMMAND_UNITS[member.commandRole] || "";
        let unitNumber = commandUnit || dsiUnitNumber(requestedUnitNumber);
        if (requestedUnitNumber && !unitNumber) {
          const error = new Error("Kies een geldig 24-nummer.");
          error.status = 400;
          throw error;
        }
        if (requestedUnitNumber && isReservedDsiUnit(unitNumber) && !commandUnit) {
          const error = new Error("24-01 en 24-02 zijn gereserveerd voor TCO/ACO. Reguliere DSI-nummers beginnen bij 24-03.");
          error.status = 403;
          throw error;
        }
        const activeUnits = await client.query(
          "select unit_number, count(*)::int as count from side_task_members where task_key = $1 and status <> '8' and unit_number <> '' group by unit_number",
          [taskKey]
        );
        const counts = new Map(activeUnits.rows.map((row) => [row.unit_number, Number(row.count || 0)]));
        if (!unitNumber && !requestedUnitNumber && member.status !== "8" && member.unitNumber) {
          unitNumber = member.unitNumber;
        }
        if (unitNumber) {
          const ownUnit = member.status !== "8" ? member.unitNumber : "";
          const existingCount = counts.get(unitNumber) || 0;
          if (unitNumber !== ownUnit && existingCount >= DSI_UNIT_CAPACITY) {
            const error = new Error(`Deze 24-eenheid heeft al maximaal ${DSI_UNIT_CAPACITY} leden.`);
            error.status = 409;
            throw error;
          }
          if (!counts.has(unitNumber) && requestedUnitNumber) {
            const error = new Error("Koppel aan een bestaande 24-eenheid.");
            error.status = 404;
            throw error;
          }
        } else {
          for (let index = DSI_FIRST_REGULAR_UNIT; index <= 99; index += 1) {
            const candidate = `24-${String(index).padStart(2, "0")}`;
            if (!counts.has(candidate)) {
              unitNumber = candidate;
              break;
            }
          }
          if (!unitNumber) {
            const error = new Error("Geen vrij 24-nummer beschikbaar.");
            error.status = 409;
            throw error;
          }
        }
        const result = await client.query(
          "update side_task_members set unit_number = $3, status = '1', status_detail = 'Beschikbaar', updated_at = now() where task_key = $1 and id = $2 returning *",
          [taskKey, String(memberId), unitNumber]
        );
        await client.query("commit");
        return memberFromRow(result.rows[0]);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  }

  async function assignDsiCommandRole(taskKey, memberId, commandRole) {
    const normalizedRole = ["ACO", "TCO"].includes(String(commandRole || "").trim()) ? String(commandRole).trim() : "";
    await ensureSideTaskSchema();
    return withSideTaskClient(async (client) => {
      await client.query("begin");
      try {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`side-task-dsi-command:${taskKey}`]);
        const memberResult = await client.query("select * from side_task_members where task_key = $1 and id = $2 for update", [taskKey, String(memberId)]);
        const member = memberFromRow(memberResult.rows[0]);
        if (!member) {
          const error = new Error("DSI-lid niet gevonden.");
          error.status = 404;
          throw error;
        }

        if (!normalizedRole) {
          let replacementUnitNumber = "";
          const remainsInService = !["0", "8"].includes(member.status);
          if (remainsInService) {
            const activeUnits = await client.query(
              `select unit_number, count(*)::int as count
               from side_task_members
               where task_key = $1 and id <> $2 and status <> '8' and unit_number <> ''
               group by unit_number`,
              [taskKey, String(memberId)]
            );
            const usedUnits = new Set(activeUnits.rows.map((row) => row.unit_number));
            for (let index = DSI_FIRST_REGULAR_UNIT; index <= 99; index += 1) {
              const candidate = `24-${String(index).padStart(2, "0")}`;
              if (!usedUnits.has(candidate)) {
                replacementUnitNumber = candidate;
                break;
              }
            }
            if (!replacementUnitNumber) {
              const error = new Error("Geen vrij regulier 24-nummer beschikbaar.");
              error.status = 409;
              throw error;
            }
          }
          const result = await client.query(
            `update side_task_members
             set command_role = '', unit_number = $3,
                 updated_at = now()
             where task_key = $1 and id = $2
             returning *`,
            [taskKey, String(memberId), replacementUnitNumber]
          );
          await client.query("commit");
          return memberFromRow(result.rows[0]);
        }

        const occupied = await client.query(
          "select id from side_task_members where task_key = $1 and command_role = $2 and id <> $3 limit 1 for update",
          [taskKey, normalizedRole, String(memberId)]
        );
        if (occupied.rows.length) {
          const error = new Error(`${normalizedRole} is al toegewezen. Verwijder eerst de huidige ${normalizedRole}.`);
          error.status = 409;
          throw error;
        }

        const result = await client.query(
          "update side_task_members set command_role = $3, unit_number = $4, updated_at = now() where task_key = $1 and id = $2 returning *",
          [taskKey, String(memberId), normalizedRole, DSI_COMMAND_UNITS[normalizedRole]]
        );
        await client.query("commit");
        return memberFromRow(result.rows[0]);
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      }
    });
  }

  return {
    ensureSideTaskSchema,
    listMembers,
    findMemberByDiscordId,
    findMemberById,
    findActiveDsiNicknameMember,
    upsertMember,
    syncMemberFromDiscord,
    updateMember,
    updateMemberProfile,
    assignDsiUnit,
    assignDsiCommandRole,
    deleteMember,
    listArchives,
    archiveMemberByDiscordId,
    restoreArchivedMember,
    updateArchiveReason,
    revokeAccess,
    clearAccessRevocation,
    isAccessRevoked
  };
}

module.exports = { createSideTasksStore, ensureSideTaskSchema };
