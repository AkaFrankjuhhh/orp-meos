const crypto = require("node:crypto");
const { withClient } = require("./db");

let ensuredDiscordSyncJobsTable = false;
let lastDiscordSyncCleanupAt = 0;

const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_RUNNING_RESET_MINUTES = 15;
const DEFAULT_DONE_RETENTION_HOURS = 24;
const DEFAULT_FAILED_RETENTION_DAYS = 14;

function safeJson(value, fallback = {}) {
  return value == null ? fallback : value;
}

function enabledFromEnv(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "nee", "no", "off"].includes(String(value).trim().toLowerCase());
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function collapsePendingDiscordSyncJobs(client, job, options = {}) {
  if (!enabledFromEnv(options.collapsePending ?? process.env.DISCORD_SYNC_COLLAPSE_PENDING_JOBS, true)) return;

  if (["sync_person", "porto_nickname"].includes(job.type) && (job.personId || job.discordId)) {
    await client.query(`
      DELETE FROM discord_sync_jobs
      WHERE status = 'pending'
        AND type = $1
        AND (
          ($2::text <> '' AND person_id = $2)
          OR ($3::text <> '' AND discord_id = $3)
        )
    `, [job.type, job.personId || "", job.discordId || ""]);
    if (job.type === "sync_person" && job.payload?.forceNormalNickname) {
      await client.query(`
        DELETE FROM discord_sync_jobs
        WHERE status = 'pending'
          AND type = 'porto_nickname'
          AND (
            ($1::text <> '' AND person_id = $1)
            OR ($2::text <> '' AND discord_id = $2)
          )
      `, [job.personId || "", job.discordId || ""]);
    }
    return;
  }

  if (job.type === "porto_channel_status") {
    const channelKey = String(job.payload?.channelKey || job.payload?.channelId || "").trim();
    if (!channelKey) return;
    await client.query(`
      DELETE FROM discord_sync_jobs
      WHERE status = 'pending'
        AND type = 'porto_channel_status'
        AND coalesce(payload->>'channelKey', payload->>'channelId', '') = $1
    `, [channelKey]);
    return;
  }

  if (job.type === "sync_all_active") {
    await client.query("DELETE FROM discord_sync_jobs WHERE status = 'pending' AND type = 'sync_all_active'");
  }
}

async function ensureDiscordSyncJobsTable() {
  if (ensuredDiscordSyncJobsTable) return;
  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS discord_sync_jobs (
        id uuid PRIMARY KEY,
        type text NOT NULL,
        person_id text REFERENCES people(id) ON DELETE SET NULL,
        discord_id text,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 5,
        last_error text,
        run_after timestamptz NOT NULL DEFAULT now(),
        locked_at timestamptz,
        locked_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS discord_sync_jobs_status_run_idx ON discord_sync_jobs(status, run_after, created_at)");
    await client.query("CREATE INDEX IF NOT EXISTS discord_sync_jobs_status_updated_idx ON discord_sync_jobs(status, updated_at DESC, created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS discord_sync_jobs_person_idx ON discord_sync_jobs(person_id, created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS discord_sync_jobs_discord_idx ON discord_sync_jobs(discord_id, created_at DESC)");
  });
  ensuredDiscordSyncJobsTable = true;
}

async function cleanupDiscordSyncJobs(client, { force = false } = {}) {
  const cleanupIntervalMs = positiveNumber(process.env.DISCORD_SYNC_CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL_MS);
  const now = Date.now();
  if (!force && now - lastDiscordSyncCleanupAt < cleanupIntervalMs) return;
  lastDiscordSyncCleanupAt = now;

  const runningResetMinutes = Math.max(1, positiveNumber(process.env.DISCORD_SYNC_RUNNING_RESET_MINUTES, DEFAULT_RUNNING_RESET_MINUTES));
  const doneRetentionHours = Math.max(1, positiveNumber(process.env.DISCORD_SYNC_DONE_RETENTION_HOURS, DEFAULT_DONE_RETENTION_HOURS));
  const failedRetentionDays = Math.max(1, positiveNumber(process.env.DISCORD_SYNC_FAILED_RETENTION_DAYS, DEFAULT_FAILED_RETENTION_DAYS));

  await client.query(`
    UPDATE discord_sync_jobs
    SET status = 'pending',
        locked_at = null,
        locked_by = null,
        run_after = now(),
        updated_at = now()
    WHERE status = 'running'
      AND locked_at < now() - ($1::int * interval '1 minute')
  `, [runningResetMinutes]);

  await client.query(`
    DELETE FROM discord_sync_jobs
    WHERE status = 'done'
      AND coalesce(completed_at, updated_at, created_at) < now() - ($1::int * interval '1 hour')
  `, [doneRetentionHours]);

  await client.query(`
    DELETE FROM discord_sync_jobs
    WHERE status = 'failed'
      AND updated_at < now() - ($1::int * interval '1 day')
  `, [failedRetentionDays]);
}

async function enqueueDiscordSyncJob(type, payload = {}, options = {}) {
  await ensureDiscordSyncJobsTable();
  const job = {
    id: crypto.randomUUID(),
    type: String(type || "sync_all_active"),
    personId: payload.personId || options.personId || null,
    discordId: payload.discordId || options.discordId || null,
    payload: safeJson(payload, {}),
    maxAttempts: Number(options.maxAttempts || 5),
    runAfter: options.runAfter || new Date()
  };
  await withClient(async (client) => {
    await collapsePendingDiscordSyncJobs(client, job, options);
    await client.query(`
      INSERT INTO discord_sync_jobs(id, type, person_id, discord_id, payload, max_attempts, run_after)
      VALUES($1, $2, $3, $4, $5::jsonb, $6, $7)
    `, [job.id, job.type, job.personId, job.discordId, JSON.stringify(job.payload), job.maxAttempts, job.runAfter]);
  });
  return job;
}

async function enqueuePersonDiscordSync(person, reason = "person_updated", options = {}) {
  if (!person?.id && !person?.discordId) return null;
  return enqueueDiscordSyncJob("sync_person", {
    personId: person.id || "",
    discordId: person.discordId || "",
    reason
  }, {
    personId: person.id || null,
    discordId: person.discordId || null,
    maxAttempts: options.maxAttempts,
    runAfter: options.runAfter,
    collapsePending: options.collapsePending
  });
}

async function enqueueAllDiscordSync(reason = "state_changed") {
  return enqueueDiscordSyncJob("sync_all_active", { reason });
}

async function claimDiscordSyncJobs(workerId, limit = 5) {
  await ensureDiscordSyncJobsTable();
  return withClient(async (client) => {
    try {
      await cleanupDiscordSyncJobs(client);
    } catch (error) {
      console.warn("Discord sync cleanup mislukt:", error?.message || error);
    }

    const result = await client.query(`
      WITH picked AS (
        SELECT id
        FROM discord_sync_jobs
        WHERE status = 'pending'
          AND run_after <= now()
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE discord_sync_jobs jobs
      SET status = 'running',
          attempts = attempts + 1,
          locked_at = now(),
          locked_by = $2,
          updated_at = now()
      FROM picked
      WHERE jobs.id = picked.id
      RETURNING jobs.*
    `, [Number(limit || 5), workerId]);
    return result.rows.map(mapJobRow);
  });
}

async function completeDiscordSyncJob(jobId, details = {}) {
  await withClient((client) => client.query(`
    UPDATE discord_sync_jobs
    SET status = 'done',
        payload = payload || $2::jsonb,
        updated_at = now(),
        completed_at = now(),
        last_error = null
    WHERE id = $1
  `, [jobId, JSON.stringify({ result: details })]));
}

async function failDiscordSyncJob(jobId, error, options = {}) {
  const message = String(error?.message || error || "Onbekende Discord sync fout").slice(0, 2000);
  const retryDelayMs = Number(options.retryDelayMs || 60000);
  await withClient((client) => client.query(`
    UPDATE discord_sync_jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
        last_error = $2,
        run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE now() + ($3 || ' milliseconds')::interval END,
        locked_at = null,
        locked_by = null,
        updated_at = now()
    WHERE id = $1
  `, [jobId, message, String(retryDelayMs)]));
}

function mapJobRow(row) {
  return {
    id: row.id,
    type: row.type,
    personId: row.person_id || "",
    discordId: row.discord_id || "",
    payload: row.payload || {},
    status: row.status,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts || 0),
    lastError: row.last_error || ""
  };
}

module.exports = {
  ensureDiscordSyncJobsTable,
  enqueueDiscordSyncJob,
  enqueuePersonDiscordSync,
  enqueueAllDiscordSync,
  claimDiscordSyncJobs,
  completeDiscordSyncJob,
  failDiscordSyncJob,
  cleanupDiscordSyncJobs
};
