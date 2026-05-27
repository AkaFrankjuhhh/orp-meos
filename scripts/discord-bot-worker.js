const { loadEnv, closePool } = require("../modules/db");
const { readPostgresState } = require("../modules/postgres-state");
const { createDiscordBotServices } = require("../modules/discord-bot");
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
const syncIntervalMs = Number(process.env.DISCORD_NICKNAME_SYNC_INTERVAL_MS || 300000);
const jobPollMs = Number(process.env.DISCORD_JOB_POLL_INTERVAL_MS || 5000);
const jobBatchSize = Number(process.env.DISCORD_JOB_BATCH_SIZE || 5);
const gatewayEnabled = String(process.env.DISCORD_GATEWAY_ENABLED || "true").toLowerCase() !== "false";
const guildMembersIntent = String(process.env.DISCORD_GATEWAY_GUILD_MEMBERS_INTENT || "false").toLowerCase() === "true";
const bot = createDiscordBotServices();
let stopping = false;
let gatewaySocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function activePeopleForDiscord(state) {
  const activeWithDiscord = (state.people || [])
    .filter((person) => person.status === "Actief")
    .filter((person) => person.discordId);
  const counts = new Map();
  activeWithDiscord.forEach((person) => counts.set(person.discordId, (counts.get(person.discordId) || 0) + 1));
  return activeWithDiscord
    .filter((person) => counts.get(person.discordId) === 1)
    .sort((a, b) => (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true }));
}

async function syncPerson(person, reason = "Discord bot worker sync") {
  if (!person?.discordId) return { skipped: true, reason: "Geen Discord ID" };
  const result = await bot.syncDiscordForPersonIfNeeded(person, reason);
  await sleep(350);
  return result;
}

async function syncAllActive(reason = "Discord bot periodieke sync") {
  const state = await readPostgresState();
  const people = activePeopleForDiscord(state);
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const person of people) {
    try {
      const result = await syncPerson(person, reason);
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

  const person = (state.people || []).find((entry) => {
    if (job.personId && entry.id === job.personId) return true;
    if (job.discordId && String(entry.discordId || "") === String(job.discordId)) return true;
    return false;
  });
  if (!person || person.status !== "Actief") return { skipped: true, reason: "Geen actief portaalprofiel gevonden" };
  return syncPerson(person, `Discord bot job ${job.id}: ${job.payload?.reason || job.type}`);
}

async function processJobs() {
  if (stopping || !bot.isConfigured()) return;
  const jobs = await claimDiscordSyncJobs(workerId, jobBatchSize);
  for (const job of jobs) {
    try {
      const result = await syncByJob(job);
      await completeDiscordSyncJob(job.id, result);
      console.log(`[discord-bot] job ${job.id} klaar (${job.type})`);
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
  await enqueueAllDiscordSync("worker_startup");
  while (!stopping) {
    await sleep(syncIntervalMs);
    if (stopping) break;
    try {
      await enqueueAllDiscordSync("periodic_sync");
    } catch (error) {
      console.error(`[discord-bot] periodieke sync enqueue mislukt: ${error.message}`);
    }
  }
}

function identifyPayload() {
  const intents = guildMembersIntent ? 1 | 2 : 1;
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
    if (packet.t === "GUILD_MEMBER_ADD") {
      const discordId = packet.d?.user?.id;
      if (discordId) await enqueueDiscordSyncJob("sync_person", { discordId, reason: "guild_member_add" }, { discordId });
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
  await Promise.all([runJobLoop(), runPeriodicSyncLoop()]);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

main().catch(async (error) => {
  console.error(`[discord-bot] start mislukt: ${error.message}`);
  await closePool().catch(() => {});
  process.exit(1);
});
