const crypto = require("node:crypto");
const { withClient } = require("./db");
const { statusOption } = require("./side-tasks-config");

let schemaReady = false;

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
    callSign: row.call_sign || "",
    aliasName: row.alias_name || "",
    originalNickname: row.original_nickname || "",
    status: row.status || "8",
    statusLabel: statusOption(row.status).label,
    statusDetail: row.status_detail || "",
    specialties: jsonArray(row.specialties),
    addedByDiscordId: row.added_by_discord_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function ensureSideTaskSchema() {
  if (schemaReady) return;
  await withClient(async (client) => {
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
    callSign: String(member.callSign || "").trim(),
    aliasName: String(member.aliasName || "").trim(),
    originalNickname: String(member.originalNickname || "").trim(),
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
    return withClient(async (client) => {
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
    return withClient(async (client) => {
      const result = await client.query(
        "select * from side_task_members where task_key = $1 and discord_id = $2 limit 1",
        [taskKey, String(discordId)]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  async function findMemberById(taskKey, id) {
    await ensureSideTaskSchema();
    return withClient(async (client) => {
      const result = await client.query(
        "select * from side_task_members where task_key = $1 and id = $2 limit 1",
        [taskKey, String(id)]
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
    return withClient(async (client) => {
      const result = await client.query(
        `insert into side_task_members (
          id, task_key, discord_id, discord_username, display_name, avatar_url,
          call_sign, alias_name, original_nickname, status, status_detail,
          specialties, added_by_discord_id, raw, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb, now())
        on conflict (task_key, discord_id) do update set
          discord_username = excluded.discord_username,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          call_sign = excluded.call_sign,
          alias_name = excluded.alias_name,
          original_nickname = case
            when excluded.original_nickname <> '' then excluded.original_nickname
            else side_task_members.original_nickname
          end,
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
          normalized.callSign,
          normalized.aliasName,
          normalized.originalNickname,
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

  async function deleteMember(taskKey, id) {
    await ensureSideTaskSchema();
    return withClient(async (client) => {
      const result = await client.query(
        "delete from side_task_members where task_key = $1 and id = $2 returning *",
        [taskKey, String(id)]
      );
      return memberFromRow(result.rows[0]);
    });
  }

  return {
    ensureSideTaskSchema,
    listMembers,
    findMemberByDiscordId,
    findMemberById,
    upsertMember,
    updateMember,
    deleteMember
  };
}

module.exports = { createSideTasksStore, ensureSideTaskSchema };
