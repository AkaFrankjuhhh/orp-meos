const { loadEnv } = require("../modules/db");
const { allSideTasks, hasAnyRole, hasMembershipRole, permissionsForTask, specialtiesForRoles } = require("../modules/side-tasks-config");
const { createSideTasksStore } = require("../modules/side-tasks-store");
const { portalIdentityForDiscordId } = require("../modules/side-tasks-portal-identity");

loadEnv();

const DISCORD_API_BASE = "https://discord.com/api/v10";
const guildId = String(process.env.SIDE_TASK_DISCORD_GUILD_ID || "").trim();
const botToken = String(process.env.SIDE_TASK_DISCORD_BOT_TOKEN || "").trim();
const mainGuildId = String(process.env.MAIN_GOVERNMENT_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || "").trim();
const mainBotToken = String(process.env.MAIN_GOVERNMENT_DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || "").trim();
const gatewayEnabled = String(process.env.SIDE_TASK_DISCORD_GATEWAY_ENABLED || "true").toLowerCase() !== "false";
const reconciliationIntervalMs = Math.max(60000, Number(process.env.SIDE_TASK_DISCORD_MEMBER_SYNC_INTERVAL_MS || 300000));
const workerId = `side-tasks-discord-${process.pid}`;
const store = createSideTasksStore();

let stopping = false;
let gatewaySocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;

function avatarUrl(user) {
  if (!user?.id || !user?.avatar) return "";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discordFetch(pathname, options = {}, token = botToken) {
  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || `Discord request mislukt (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function restoreMainPortalNickname(discordId) {
  if (!mainGuildId || !mainBotToken) return;
  const identity = await portalIdentityForDiscordId(discordId);
  if (!identity?.nickname) return;
  await discordFetch(`/guilds/${mainGuildId}/members/${discordId}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: identity.nickname })
  }, mainBotToken);
}

function memberPatch(task, discordMember, existing) {
  const user = discordMember.user || {};
  const roles = Array.isArray(discordMember.roles) ? discordMember.roles.map(String) : [];
  return {
    id: existing?.id,
    discordId: user.id,
    discordUsername: user.username || existing?.discordUsername || "",
    displayName: user.global_name || user.username || existing?.displayName || user.id,
    avatarUrl: avatarUrl(user) || existing?.avatarUrl || "",
    phone: existing?.phone || "",
    callSign: existing?.callSign || "",
    aliasName: existing?.aliasName || "",
    originalNickname: existing?.originalNickname || "",
    unitNumber: existing?.unitNumber || "",
    commandRole: existing?.commandRole || "",
    status: existing?.status || "8",
    statusDetail: existing?.statusDetail || "Uit dienst melden",
    specialties: specialtiesForRoles(task, roles),
    raw: {
      syncedBy: workerId,
      lastRoleSyncAt: new Date().toISOString(),
      lastKnownRoleIds: roles
    }
  };
}

async function syncDiscordMember(discordMember) {
  const discordId = String(discordMember?.user?.id || "").trim();
  if (!discordId) return;
  const roles = Array.isArray(discordMember.roles) ? discordMember.roles.map(String) : [];
  for (const task of allSideTasks()) {
    const existing = await store.findMemberByDiscordId(task.key, discordId);
    const hasMemberAccess = hasMembershipRole(task, roles);
    const permissions = permissionsForTask(task, roles, discordId);
    if (hasMemberAccess) {
      const patch = memberPatch(task, discordMember, existing);
      if (existing) {
        let updated = await store.upsertMember(task.key, patch);
        if (task.key === "DSI" && updated.commandRole) {
          const commandRoleIds = updated.commandRole === "ACO" ? task.roleIds.aco : task.roleIds.tco;
          if (!hasAnyRole(roles, commandRoleIds)) {
            updated = await store.assignDsiCommandRole(task.key, updated.id, "");
            console.log(`[${workerId}] DSI ${updated.discordId}: ${existing.commandRole} verwijderd wegens rolverlies.`);
          }
        }
        await store.clearAccessRevocation(task.key, discordId);
      } else {
        await store.restoreArchivedMember(task.key, discordId, patch);
      }
      continue;
    }
    if (existing) {
      await store.archiveMemberByDiscordId(task.key, discordId, "Discordrol voor deze neventaak verwijderd.");
      if (permissions.hasAccess) await store.clearAccessRevocation(task.key, discordId);
      if (task.key === "DSI") {
        try {
          await restoreMainPortalNickname(discordId);
        } catch (error) {
          console.warn(`[${workerId}] DSI hoofdnaam herstellen mislukt voor ${discordId}: ${error.message}`);
        }
      }
      console.log(`[${workerId}] ${task.key}: ${discordId} gearchiveerd wegens rolverlies.`);
    } else if (permissions.hasAccess) {
      await store.clearAccessRevocation(task.key, discordId);
    } else {
      await store.revokeAccess(task.key, discordId, "Discordrol voor deze neventaak ontbreekt.");
    }
  }
}

async function archiveDiscordMember(discordId, reason) {
  for (const task of allSideTasks()) {
    const archived = await store.archiveMemberByDiscordId(task.key, discordId, reason);
    if (archived && task.key === "DSI") {
      try {
        await restoreMainPortalNickname(discordId);
      } catch (error) {
        console.warn(`[${workerId}] DSI hoofdnaam herstellen mislukt voor ${discordId}: ${error.message}`);
      }
    }
    if (!archived) await store.revokeAccess(task.key, discordId, reason);
  }
}

async function fetchAllGuildMembers() {
  const members = [];
  let after = "0";
  while (!stopping) {
    const page = await discordFetch(`/guilds/${guildId}/members?limit=1000&after=${encodeURIComponent(after)}`);
    if (!Array.isArray(page) || !page.length) break;
    members.push(...page);
    after = String(page[page.length - 1]?.user?.id || "");
    if (page.length < 1000 || !after) break;
  }
  return members;
}

async function reconcileGuildMembers() {
  const members = await fetchAllGuildMembers();
  const byDiscordId = new Map(members.map((member) => [String(member.user?.id || ""), member]).filter(([id]) => id));
  for (const member of members) await syncDiscordMember(member);
  for (const task of allSideTasks()) {
    const activeMembers = await store.listMembers(task.key);
    for (const member of activeMembers) {
      if (!byDiscordId.has(member.discordId)) {
        await store.archiveMemberByDiscordId(task.key, member.discordId, "Lid is niet meer aanwezig in de Neventaken Discord.");
        console.log(`[${workerId}] ${task.key}: ${member.discordId} gearchiveerd wegens vertrek uit Discord.`);
      }
    }
  }
  console.log(`[${workerId}] rolcontrole voltooid voor ${members.length} Discord-leden.`);
}

function identifyPayload() {
  return {
    op: 2,
    d: {
      token: botToken,
      intents: 1 | 2,
      properties: {
        os: process.platform,
        browser: "orp-side-tasks-worker",
        device: "orp-side-tasks-worker"
      }
    }
  };
}

function sendGateway(payload) {
  if (gatewaySocket?.readyState === 1) gatewaySocket.send(JSON.stringify(payload));
}

function scheduleGatewayReconnect() {
  if (stopping || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectGateway();
  }, 5000);
}

function connectGateway() {
  if (!gatewayEnabled || typeof WebSocket === "undefined") return;
  try {
    gatewaySocket = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json");
  } catch (error) {
    console.error(`[${workerId}] Gateway start mislukt: ${error.message}`);
    scheduleGatewayReconnect();
    return;
  }
  gatewaySocket.addEventListener("open", () => console.log(`[${workerId}] Discord Gateway verbonden.`));
  gatewaySocket.addEventListener("message", async (event) => {
    try {
      const packet = JSON.parse(event.data || "{}");
      if (packet.op === 10) {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => sendGateway({ op: 1, d: null }), Number(packet.d?.heartbeat_interval || 45000));
        sendGateway(identifyPayload());
        return;
      }
      if (packet.op === 11) return;
      if (packet.t === "READY") {
        console.log(`[${workerId}] online als ${packet.d?.user?.username || "bot"}.`);
        return;
      }
      if (packet.t === "GUILD_MEMBER_REMOVE") {
        await archiveDiscordMember(String(packet.d?.user?.id || ""), "Lid heeft de Neventaken Discord verlaten.");
        return;
      }
      if (["GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE"].includes(packet.t)) {
        await syncDiscordMember(packet.d || {});
      }
    } catch (error) {
      console.error(`[${workerId}] Gateway-event mislukt: ${error.message}`);
    }
  });
  gatewaySocket.addEventListener("close", () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    scheduleGatewayReconnect();
  });
  gatewaySocket.addEventListener("error", () => console.error(`[${workerId}] Discord Gateway fout.`));
}

async function reconciliationLoop() {
  while (!stopping) {
    try {
      await reconcileGuildMembers();
    } catch (error) {
      console.error(`[${workerId}] rolcontrole mislukt: ${error.message}`);
    }
    await sleep(reconciliationIntervalMs);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try { gatewaySocket?.close?.(); } catch (_) {}
  process.exit(0);
}

async function main() {
  if (!guildId || !botToken) throw new Error("SIDE_TASK_DISCORD_GUILD_ID en SIDE_TASK_DISCORD_BOT_TOKEN moeten gevuld zijn.");
  await store.ensureSideTaskSchema();
  connectGateway();
  console.log(`[${workerId}] worker gestart; volledige rolcontrole elke ${Math.round(reconciliationIntervalMs / 60000)} minuut/minuten.`);
  await reconciliationLoop();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
main().catch((error) => {
  console.error(`[${workerId}] start mislukt: ${error.message}`);
  process.exit(1);
});
