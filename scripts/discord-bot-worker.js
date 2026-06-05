const { loadEnv, closePool, withClient } = require("../modules/db");
const { readPostgresState } = require("../modules/postgres-state");
const { createDiscordBotServices } = require("../modules/discord-bot");
const { nonRegularPortoDiscordChannel } = require("../modules/porto-discord-channels");
const {
  ensureDiscordSyncJobsTable,
  enqueueAllDiscordSync,
  enqueueDiscordSyncJob,
  claimDiscordSyncJobs,
  completeDiscordSyncJob,
  failDiscordSyncJob
} = require("../modules/discord-sync-jobs");

loadEnv();

const workerId = `discord-bot-${process.pid}`;
const dailySyncTime = String(process.env.DISCORD_DAILY_SYNC_TIME || "05:00").trim();
const dailySyncEnabled = String(process.env.DISCORD_DAILY_SYNC_ENABLED || "true").toLowerCase() !== "false";
const legacyIntervalSyncEnabled = String(process.env.DISCORD_LEGACY_INTERVAL_SYNC_ENABLED || "false").toLowerCase() === "true";
const syncIntervalMs = legacyIntervalSyncEnabled ? Number(process.env.DISCORD_NICKNAME_SYNC_INTERVAL_MS || 0) : 0;
const jobPollMs = Number(process.env.DISCORD_JOB_POLL_INTERVAL_MS || 5000);
const jobBatchSize = Number(process.env.DISCORD_JOB_BATCH_SIZE || 5);
const gatewayEnabled = String(process.env.DISCORD_GATEWAY_ENABLED || "true").toLowerCase() !== "false";
const guildMembersIntent = String(process.env.DISCORD_GATEWAY_GUILD_MEMBERS_INTENT || "false").toLowerCase() === "true";
const voiceStatesIntent = String(process.env.DISCORD_GATEWAY_VOICE_STATES_INTENT || "true").toLowerCase() !== "false";
const bot = createDiscordBotServices();
const nonRegularPortoDiscordChannelKey = nonRegularPortoDiscordChannel.key;
let stopping = false;
let gatewaySocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let hasGatewayVoiceSnapshot = false;
const gatewayVoiceStatesByUser = new Map();

function portoChannelKeyForDiscordChannelId(channelId) {
  const value = String(channelId || "");
  const entries = Object.entries(bot.configuredVoiceChannels?.() || {});
  return entries.find(([, id]) => String(id || "") === value)?.[0] || "";
}

function displayPortoChannelKeyForDiscordChannelId(channelId) {
  return portoChannelKeyForDiscordChannelId(channelId) || nonRegularPortoDiscordChannelKey;
}

function captureGatewayVoiceState(voiceState = {}) {
  const discordId = String(voiceState.user_id || "").trim();
  if (!discordId) return;
  gatewayVoiceStatesByUser.set(discordId, String(voiceState.channel_id || "").trim());
}

async function reconcilePortoVoiceChannelsFromGatewaySnapshot() {
  if (!hasGatewayVoiceSnapshot) return;
  await withClient(async (client) => {
    const result = await client.query(`
      select units.vehicle_number, people.discord_id
      from porto_units units
      left join people on people.id = units.member_id
      where units.active = true
        and coalesce(units.vehicle_number, '') <> ''
      order by units.vehicle_number, units.updated_at desc nulls last
    `);
    const vehicles = new Map();
    for (const row of result.rows) {
      const vehicleNumber = String(row.vehicle_number || "").trim();
      if (!vehicleNumber) continue;
      const discordIds = vehicles.get(vehicleNumber) || [];
      discordIds.push(String(row.discord_id || "").trim());
      vehicles.set(vehicleNumber, discordIds);
    }

    let changed = 0;
    for (const [vehicleNumber, discordIds] of vehicles.entries()) {
      const memberKeys = discordIds.map((discordId) => {
        if (!discordId) return nonRegularPortoDiscordChannelKey;
        return displayPortoChannelKeyForDiscordChannelId(gatewayVoiceStatesByUser.get(discordId) || "");
      });
      const regularKeys = new Set(memberKeys.filter((key) => key !== nonRegularPortoDiscordChannelKey));
      const hasNonRegularMember = memberKeys.some((key) => key === nonRegularPortoDiscordChannelKey);
      const targetKey = regularKeys.size === 1 && !hasNonRegularMember
        ? [...regularKeys][0]
        : nonRegularPortoDiscordChannelKey;

      const updateResult = await client.query(`
        update porto_units
        set
          raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('discordChannelKey', $2),
          updated_at = now()
        where active = true
          and vehicle_number = $1
          and coalesce(raw->>'discordChannelKey', '') <> $2
      `, [vehicleNumber, targetKey]);
      changed += updateResult.rowCount || 0;
    }

    if (changed > 0) {
      await client.query("select pg_notify($1, $2)", ["orp_app_events", JSON.stringify({
        scope: "porto",
        sourceId: workerId,
        serviceName: "discord-bot",
        at: new Date().toISOString()
      })]);
      console.log(`[discord-bot] Porto voice snapshot verwerkt: ${changed} unit(s) bijgewerkt.`);
    }
  });
}

async function updatePortoVoiceSnapshotFromGuild(guild = {}) {
  const targetGuildId = String(process.env.DISCORD_GUILD_ID || "").trim();
  const guildId = String(guild.id || "").trim();
  if (targetGuildId && guildId && guildId !== targetGuildId) return;
  const voiceStates = Array.isArray(guild.voice_states) ? guild.voice_states : [];
  if (!voiceStates.length && !Object.prototype.hasOwnProperty.call(guild, "voice_states")) return;
  gatewayVoiceStatesByUser.clear();
  for (const voiceState of voiceStates) captureGatewayVoiceState(voiceState);
  hasGatewayVoiceSnapshot = true;
  await reconcilePortoVoiceChannelsFromGatewaySnapshot();
}

async function updatePortoChannelStatusFromDiscord(channelId, status) {
  const channelKey = portoChannelKeyForDiscordChannelId(channelId);
  if (!channelKey) return;
  await withClient(async (client) => {
    await client.query(`
      update porto_units
      set
        raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('discordChannelStatus', $2),
        updated_at = now()
      where active = true
        and raw->>'discordChannelKey' = $1
    `, [channelKey, String(status || "")]);
    await client.query("select pg_notify($1, $2)", ["orp_app_events", JSON.stringify({
      scope: "porto",
      sourceId: workerId,
      serviceName: "discord-bot",
      at: new Date().toISOString()
    })]);
  });
}

async function updatePortoVoiceChannelFromDiscord(discordId, channelId) {
  const channelKey = displayPortoChannelKeyForDiscordChannelId(channelId);
  if (!discordId) return;
  await withClient(async (client) => {
    const unitResult = await client.query(`
      select units.vehicle_number
      from porto_units units
      join people on people.id = units.member_id
      where units.active = true
        and coalesce(units.vehicle_number, '') <> ''
        and people.discord_id = $1
      order by units.updated_at desc nulls last, units.assigned_at desc nulls last
      limit 1
    `, [String(discordId)]);
    const vehicleNumber = unitResult.rows[0]?.vehicle_number || "";
    if (!vehicleNumber) return;
    await client.query(`
      update porto_units
      set
        raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('discordChannelKey', $2),
        updated_at = now()
      where active = true
        and vehicle_number = $1
    `, [vehicleNumber, channelKey]);
    await client.query("select pg_notify($1, $2)", ["orp_app_events", JSON.stringify({
      scope: "porto",
      sourceId: workerId,
      serviceName: "discord-bot",
      at: new Date().toISOString()
    })]);
    console.log(`[discord-bot] Porto kanaal bijgewerkt vanuit Discord voice: ${vehicleNumber} -> ${channelKey}`);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextDailySyncDelayMs(timeText = "05:00", now = new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeText || "").trim());
  const hours = match ? Math.min(23, Math.max(0, Number(match[1]))) : 5;
  const minutes = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0;
  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function activePeopleForDiscord(state) {
  const activeWithDiscord = (state.people || [])
    .filter((person) => person.status === "Actief")
    .filter((person) => person.discordId)
    .filter((person) => !bot.isDiscordSyncExcludedPerson?.(person));
  const counts = new Map();
  activeWithDiscord.forEach((person) => counts.set(person.discordId, (counts.get(person.discordId) || 0) + 1));
  return activeWithDiscord
    .filter((person) => counts.get(person.discordId) === 1)
    .sort((a, b) => (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true }));
}

function activePortoUnitForPerson(state, person) {
  return (state.portoUnits || [])
    .filter((unit) => unit.active !== false && unit.memberId === person?.id && unit.vehicleNumber)
    .sort((a, b) => Date.parse(b.updatedAt || b.assignedAt || b.requestedAt || 0) - Date.parse(a.updatedAt || a.assignedAt || a.requestedAt || 0))[0] || null;
}

function unitWithPortoNicknameContext(state, unit) {
  if (!unit) return unit;
  const currentOpsMemberId = state.portoCurrentOps?.active === false ? "" : state.portoCurrentOps?.memberId;
  return {
    ...unit,
    isPortoOpsLead: Boolean(unit.vehicleNumber === "30-00" && currentOpsMemberId && currentOpsMemberId === unit.memberId)
  };
}

async function syncPerson(person, reason = "Discord bot worker sync") {
  if (!person?.discordId) return { skipped: true, reason: "Geen Discord ID" };
  const result = await bot.syncDiscordForPersonIfNeeded(person, reason);
  await sleep(350);
  return result;
}

async function syncPersonForState(state, person, reason = "Discord bot worker sync") {
  if (!person?.discordId) return { skipped: true, reason: "Geen Discord ID" };
  const portoUnit = activePortoUnitForPerson(state, person);
  if (portoUnit) {
    const nickname = await bot.syncPortoNicknameForPersonIfNeeded(person, unitWithPortoNicknameContext(state, portoUnit), `${reason}: Porto roepnummer`);
    const rankRole = await bot.syncRankRoleForPersonIfNeeded(person, reason);
    const qualificationRoles = await bot.syncQualificationRolesForPersonIfNeeded(person, reason);
    await sleep(350);
    return { ok: true, nickname, rankRole, qualificationRoles, porto: true };
  }
  return syncPerson(person, reason);
}

async function syncAllActive(reason = "Discord bot periodieke sync") {
  const state = await readPostgresState();
  const people = activePeopleForDiscord(state);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const person of people) {
    try {
      const result = await syncPersonForState(state, person, reason);
      if (result?.skipped) skipped += 1;
      else ok += 1;
    } catch (error) {
      failed += 1;
      console.error(`[discord-bot] sync mislukt voor ${person.serviceNumber || "-"} ${person.name || "Onbekend"}: ${error.message}`);
    }
  }
  return { ok, skipped, failed, total: people.length };
}

async function syncByJob(job) {
  const state = await readPostgresState();
  if (job.type === "sync_all_active") {
    return syncAllActive(`Discord bot job ${job.id}: ${job.payload?.reason || "sync_all_active"}`);
  }

  if (job.type === "porto_voice_move") {
    return bot.moveMembersToVoice(job.payload?.discordIds || [job.discordId].filter(Boolean), job.payload?.channelKey || job.payload?.channelId, job.payload?.reason || "Porto voicekanaal aangepast");
  }

  if (job.type === "porto_channel_status") {
    return bot.setVoiceChannelStatus(job.payload?.channelKey || job.payload?.channelId, job.payload?.status || "", job.payload?.reason || "Porto kanaalstatus aangepast");
  }

  const person = (state.people || []).find((entry) => {
    if (job.personId && entry.id === job.personId) return true;
    if (job.discordId && String(entry.discordId || "") === String(job.discordId)) return true;
    return false;
  });
  if (!person || person.status !== "Actief") return { skipped: true, reason: "Geen actief portaalprofiel gevonden" };
  if (job.type === "porto_nickname") {
    const unit = (state.portoUnits || []).find((entry) => entry.id === job.payload?.unitId)
      || activePortoUnitForPerson(state, person);
    if (!unit) return syncPerson(person, `Discord bot job ${job.id}: Porto dienst beeindigd`);
    return bot.syncPortoNicknameForPersonIfNeeded(person, unitWithPortoNicknameContext(state, unit), `Discord bot job ${job.id}: Porto roepnummer`);
  }
  return syncPersonForState(state, person, `Discord bot job ${job.id}: ${job.payload?.reason || job.type}`);
}

async function processJobs() {
  if (stopping || !bot.isConfigured()) return;
  const jobs = await claimDiscordSyncJobs(workerId, jobBatchSize);
  for (const job of jobs) {
    try {
      const result = await syncByJob(job);
      await completeDiscordSyncJob(job.id, result);
      const resultText = result?.skipped
        ? `overgeslagen: ${result.reason || "geen reden"}`
        : result?.unchanged
          ? `ongewijzigd${result.nickname ? `: ${result.nickname}` : ""}`
          : result?.nickname
            ? `nickname: ${result.nickname}`
            : result?.ok
              ? "gelukt"
              : JSON.stringify(result || {}).slice(0, 500);
      console.log(`[discord-bot] job ${job.id} klaar (${job.type}) - ${resultText}`);
    } catch (error) {
      const retryDelayMs = Math.min(300000, 30000 * Math.max(1, job.attempts));
      await failDiscordSyncJob(job.id, error, { retryDelayMs });
      console.error(`[discord-bot] job ${job.id} mislukt: ${error.message}`);
    }
  }
}

async function runJobLoop() {
  while (!stopping) {
    try {
      await processJobs();
    } catch (error) {
      console.error(`[discord-bot] job loop fout: ${error.message}`);
    }
    await sleep(jobPollMs);
  }
}

async function runPeriodicSyncLoop() {
  if (dailySyncEnabled) {
    while (!stopping) {
      await sleep(nextDailySyncDelayMs(dailySyncTime));
      if (stopping) break;
      try {
        await enqueueAllDiscordSync(`daily_${dailySyncTime}`);
      } catch (error) {
        console.error(`[discord-bot] dagelijkse sync enqueue mislukt: ${error.message}`);
      }
    }
    return;
  }

  if (!syncIntervalMs) return;
  while (!stopping) {
    await sleep(syncIntervalMs);
    if (stopping) break;
    try {
      await enqueueAllDiscordSync("legacy_periodic_sync");
    } catch (error) {
      console.error(`[discord-bot] periodieke sync enqueue mislukt: ${error.message}`);
    }
  }
}

function identifyPayload() {
  const intents = 1 | (guildMembersIntent ? 2 : 0) | (voiceStatesIntent ? 128 : 0);
  return {
    op: 2,
    d: {
      token: process.env.DISCORD_BOT_TOKEN,
      intents,
      properties: {
        os: process.platform,
        browser: "orp-defensie-bot",
        device: "orp-defensie-bot"
      },
      presence: {
        status: "online",
        activities: [{ name: "ORP Defensie", type: 3 }],
        afk: false
      }
    }
  };
}

function sendGateway(payload) {
  if (!gatewaySocket || gatewaySocket.readyState !== 1) return;
  gatewaySocket.send(JSON.stringify(payload));
}

function scheduleGatewayReconnect() {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectGateway();
  }, 5000);
}

function connectGateway() {
  if (!gatewayEnabled || typeof WebSocket === "undefined" || !process.env.DISCORD_BOT_TOKEN) return;
  try {
    gatewaySocket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
  } catch (error) {
    console.error(`[discord-bot] gateway start mislukt: ${error.message}`);
    scheduleGatewayReconnect();
    return;
  }

  gatewaySocket.addEventListener("open", () => console.log("[discord-bot] Discord Gateway verbonden."));
  gatewaySocket.addEventListener("message", async (event) => {
    const packet = JSON.parse(event.data || "{}");
    if (packet.op === 10) {
      const interval = Number(packet.d?.heartbeat_interval || 45000);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => sendGateway({ op: 1, d: null }), interval);
      sendGateway(identifyPayload());
      return;
    }
    if (packet.op === 11) return;
    if (packet.t === "READY") {
      console.log(`[discord-bot] online als ${packet.d?.user?.username || "bot"}.`);
      return;
    }
    if (packet.t === "GUILD_CREATE") {
      await updatePortoVoiceSnapshotFromGuild(packet.d || {});
      return;
    }
    if (packet.t === "GUILD_MEMBER_ADD") {
      const discordId = packet.d?.user?.id;
      if (discordId) await enqueueDiscordSyncJob("sync_person", { discordId, reason: "guild_member_add" }, { discordId });
    }
    if (["CHANNEL_UPDATE", "VOICE_CHANNEL_STATUS_UPDATE"].includes(packet.t)) {
      const channelId = packet.d?.id || packet.d?.channel_id;
      if (channelId && Object.prototype.hasOwnProperty.call(packet.d || {}, "status")) {
        await updatePortoChannelStatusFromDiscord(channelId, packet.d?.status || "");
      }
    }
    if (packet.t === "VOICE_STATE_UPDATE") {
      captureGatewayVoiceState(packet.d || {});
      if (hasGatewayVoiceSnapshot) {
        await reconcilePortoVoiceChannelsFromGatewaySnapshot();
      } else {
        await updatePortoVoiceChannelFromDiscord(packet.d?.user_id || "", packet.d?.channel_id || "");
      }
    }
  });
  gatewaySocket.addEventListener("close", () => {
    console.log("[discord-bot] Discord Gateway gesloten, reconnect volgt.");
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    scheduleGatewayReconnect();
  });
  gatewaySocket.addEventListener("error", () => {
    console.error("[discord-bot] Discord Gateway fout.");
  });
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  try { gatewaySocket?.close?.(); } catch (_) {}
  await closePool().catch(() => {});
  process.exit(0);
}

async function main() {
  if (!bot.isConfigured()) throw new Error("DISCORD_BOT_TOKEN en DISCORD_GUILD_ID moeten gevuld zijn.");
  await ensureDiscordSyncJobsTable();
  connectGateway();
  console.log(`[discord-bot] worker gestart: ${workerId}`);
  if (dailySyncEnabled) {
    console.log(`[discord-bot] dagelijkse Discord sync gepland om ${dailySyncTime}.`);
  } else if (syncIntervalMs) {
    console.log(`[discord-bot] legacy interval sync actief elke ${syncIntervalMs}ms.`);
  }
  await Promise.all([runJobLoop(), runPeriodicSyncLoop()]);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error(`[discord-bot] start mislukt: ${error.message}`);
  await closePool().catch(() => {});
  process.exit(1);
});
