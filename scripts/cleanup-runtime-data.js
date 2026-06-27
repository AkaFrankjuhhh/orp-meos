#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { loadEnv, withClient, closePool, databaseNameFromConnectionString } = require("../modules/db");
const {
  DEFAULT_PORTO_DUTY_HOURS_START_WEEK,
  parsePortoDutyHoursStartWeek
} = require("../modules/porto-duty-hours");

function parseArgs(argv) {
  const args = {
    apply: false,
    env: null,
    portoHours: 24,
    discordHours: 24,
    discordFailedDays: 14,
    staleRunningMinutes: 30,
    portoDutyStartWeek: null
  };

  for (const arg of argv) {
    if (arg === "--apply") args.apply = true;
    else if (arg.startsWith("--env=")) args.env = arg.slice("--env=".length);
    else if (arg.startsWith("--porto-hours=")) args.portoHours = Number(arg.slice("--porto-hours=".length));
    else if (arg.startsWith("--discord-hours=")) args.discordHours = Number(arg.slice("--discord-hours=".length));
    else if (arg.startsWith("--discord-failed-days=")) args.discordFailedDays = Number(arg.slice("--discord-failed-days=".length));
    else if (arg.startsWith("--stale-running-minutes=")) args.staleRunningMinutes = Number(arg.slice("--stale-running-minutes=".length));
    else if (arg.startsWith("--porto-duty-start-week=")) args.portoDutyStartWeek = arg.slice("--porto-duty-start-week=".length);
  }

  return args;
}

function cleanNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function loadEnvFile(fileName) {
  const envPath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(envPath)) {
    throw new Error(`Env bestand niet gevonden: ${envPath}`);
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function tableExists(client, tableName) {
  const result = await client.query("select to_regclass($1) as table_name", [`public.${tableName}`]);
  return Boolean(result.rows[0]?.table_name);
}

async function countRows(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0]?.count || 0);
}

async function applyCount(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  args.portoHours = cleanNumber(args.portoHours, 24);
  args.discordHours = cleanNumber(args.discordHours, 24);
  args.discordFailedDays = cleanNumber(args.discordFailedDays, 14);
  args.staleRunningMinutes = cleanNumber(args.staleRunningMinutes, 30);

  if (args.env) loadEnvFile(args.env);
  else loadEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ontbreekt. Laad eerst de juiste .env.");
  }

  args.portoDutyStartWeek = args.portoDutyStartWeek
    || process.env.PORTO_DUTY_HOURS_START_WEEK
    || DEFAULT_PORTO_DUTY_HOURS_START_WEEK;
  const portoDutyStartWeek = parsePortoDutyHoursStartWeek(args.portoDutyStartWeek);

  console.log(args.apply ? "Runtime data cleanup wordt toegepast." : "Runtime data cleanup dry-run.");
  console.log(`Database: ${databaseNameFromConnectionString(process.env.DATABASE_URL) || "-"}`);

  await withClient(async (client) => {
    const hasPortoUnits = await tableExists(client, "porto_units");
    const hasDiscordJobs = await tableExists(client, "discord_sync_jobs");
    const hasHours = await tableExists(client, "hours");

    if (hasPortoUnits) {
      const duplicateActiveSql = `
        select count(*)::int as count
        from (
          select id,
            row_number() over (
              partition by member_id
              order by coalesce(updated_at, last_seen_at, assigned_at, requested_at, now()) desc, id desc
            ) as row_number
          from porto_units
          where active is true
            and member_id is not null
            and member_id <> ''
        ) ranked
        where row_number > 1
      `;
      const duplicateActiveCount = await countRows(client, duplicateActiveSql);
      const closedDuplicates = args.apply
        ? await applyCount(client, `
            with ranked as (
              select id,
                row_number() over (
                  partition by member_id
                  order by coalesce(updated_at, last_seen_at, assigned_at, requested_at, now()) desc, id desc
                ) as row_number
              from porto_units
              where active is true
                and member_id is not null
                and member_id <> ''
            ),
            updated as (
              update porto_units units
              set active = false,
                  ended_at = coalesce(units.ended_at, now()),
                  updated_at = now()
              from ranked
              where units.id = ranked.id
                and ranked.row_number > 1
              returning units.id
            )
            select count(*)::int as count from updated
          `)
        : duplicateActiveCount;
      console.log(`${args.apply ? "Gesloten" : "Te sluiten"} dubbele actieve Porto-rijen: ${closedDuplicates}`);

      const oldInactiveWhere = `
        active is not true
        and coalesce(ended_at, updated_at, last_seen_at, assigned_at, requested_at, now()) <= now() - ($1::text || ' hours')::interval
      `;
      const oldInactiveCount = await countRows(client, `select count(*)::int as count from porto_units where ${oldInactiveWhere}`, [String(args.portoHours)]);
      const deletedInactive = args.apply
        ? await applyCount(client, `
            with deleted as (
              delete from porto_units
              where ${oldInactiveWhere}
              returning id
            )
            select count(*)::int as count from deleted
          `, [String(args.portoHours)])
        : oldInactiveCount;
      console.log(`${args.apply ? "Verwijderde" : "Te verwijderen"} oude inactieve Porto-rijen: ${deletedInactive}`);
    } else {
      console.log("porto_units tabel niet gevonden, overgeslagen.");
    }

    if (hasHours && portoDutyStartWeek) {
      const oldPortoDutyWhere = `
        (
          entered_by_id = 'system:porto-duty-clock'
          or id like 'porto-duty-%'
        )
        and (
          week_year < $1
          or (week_year = $1 and week_number < $2)
        )
      `;
      const oldPortoDutyParams = [portoDutyStartWeek.weekYear, portoDutyStartWeek.weekNumber];
      const oldPortoDutyCount = await countRows(client, `select count(*)::int as count from hours where ${oldPortoDutyWhere}`, oldPortoDutyParams);
      const deletedOldPortoDuty = args.apply
        ? await applyCount(client, `
            with deleted as (
              delete from hours
              where ${oldPortoDutyWhere}
              returning id
            )
            select count(*)::int as count from deleted
          `, oldPortoDutyParams)
        : oldPortoDutyCount;
      console.log(`${args.apply ? "Verwijderde" : "Te verwijderen"} oude Porto-klokuren voor ${args.portoDutyStartWeek}: ${deletedOldPortoDuty}`);
    } else if (!hasHours) {
      console.log("hours tabel niet gevonden, Porto-klokuren overgeslagen.");
    } else {
      console.log(`PORTO_DUTY_HOURS_START_WEEK ongeldig (${args.portoDutyStartWeek}), Porto-klokuren overgeslagen.`);
    }

    if (hasDiscordJobs) {
      const staleRunningWhere = "status = 'running' and locked_at <= now() - ($1::text || ' minutes')::interval";
      const staleRunningCount = await countRows(client, `select count(*)::int as count from discord_sync_jobs where ${staleRunningWhere}`, [String(args.staleRunningMinutes)]);
      const resetRunning = args.apply
        ? await applyCount(client, `
            with updated as (
              update discord_sync_jobs
              set status = 'pending',
                  locked_at = null,
                  locked_by = null,
                  updated_at = now()
              where ${staleRunningWhere}
              returning id
            )
            select count(*)::int as count from updated
          `, [String(args.staleRunningMinutes)])
        : staleRunningCount;
      console.log(`${args.apply ? "Teruggezet" : "Terug te zetten"} vastgelopen Discord sync-jobs: ${resetRunning}`);

      const doneWhere = "status = 'done' and coalesce(completed_at, updated_at, created_at) <= now() - ($1::text || ' hours')::interval";
      const doneCount = await countRows(client, `select count(*)::int as count from discord_sync_jobs where ${doneWhere}`, [String(args.discordHours)]);
      const deletedDone = args.apply
        ? await applyCount(client, `
            with deleted as (
              delete from discord_sync_jobs
              where ${doneWhere}
              returning id
            )
            select count(*)::int as count from deleted
          `, [String(args.discordHours)])
        : doneCount;
      console.log(`${args.apply ? "Verwijderde" : "Te verwijderen"} afgeronde Discord sync-jobs: ${deletedDone}`);

      const failedWhere = "status = 'failed' and coalesce(updated_at, created_at) <= now() - ($1::text || ' days')::interval";
      const failedCount = await countRows(client, `select count(*)::int as count from discord_sync_jobs where ${failedWhere}`, [String(args.discordFailedDays)]);
      const deletedFailed = args.apply
        ? await applyCount(client, `
            with deleted as (
              delete from discord_sync_jobs
              where ${failedWhere}
              returning id
            )
            select count(*)::int as count from deleted
          `, [String(args.discordFailedDays)])
        : failedCount;
      console.log(`${args.apply ? "Verwijderde" : "Te verwijderen"} oude mislukte Discord sync-jobs: ${deletedFailed}`);
    } else {
      console.log("discord_sync_jobs tabel niet gevonden, overgeslagen.");
    }
  });

  if (!args.apply) {
    console.log("Dry-run klaar. Voeg --apply toe om echt op te ruimen.");
  }

  await closePool();
}

main().catch(async (error) => {
  console.error(`Runtime cleanup mislukt: ${error.message}`);
  await closePool().catch(() => {});
  process.exit(1);
});
