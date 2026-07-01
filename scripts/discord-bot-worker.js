const { loadEnv, closePool, withClient } = require("../modules/db");

loadEnv();

const { readPostgresState } = require("../modules/postgres-state");
const { createDiscordBotServices } = require("../modules/discord-bot");
const { currentOrganization } = require("../modules/organizations");
const { nonRegularPortoDiscordChannel } = require("../modules/porto-discord-channels");
const {
  buildDiscordLeaveLogPayload,
  collectDefensieLeaveLogRoleIds,
  discordLeaveLogWebhookUrl,
  discordMemberDisplayName,
  discordUserTag,
  memberHasAnyTrackedRole,
  sendDiscordLeaveLog
} = require("../modules/discord-leave-log");
const {
  ensureDiscordSyncJobsTable,
  enqueueAllDiscordSync,
  enqueueDiscordSyncJob,
  claimDiscordSyncJobs,
  completeDiscordSyncJob,
  failDiscordSyncJob
} = require("../modules/discord-sync-jobs");
const { setDiscordSyncStatus, syncStatusFromError } = require("../modules/discord-sync-status");

const workerId = `discord-bot-${process.pid}`;
const dailySyncTime = String(process.env.DISCORD_DAILY_SYNC_TIME || "05:00").trim();
const dailySyncEnabled = String(process.env.DISCORD_DAILY_SYNC_ENABLED || "true").toLowerCase() !== "false";
const legacyIntervalSyncEnabled = String(process.env.DISCORD_LEGACY_INTERVAL_SYNC_ENABLED || "false").toLowerCase() === "true";
const syncIntervalMs = legacyIntervalSyncEnabled ? Number(process.env.DISCORD_NICKNAME_SYNC_INTERVAL_MS || 0) : 0;
const jobPollMs = Number(process.env.DISCORD_JOB_POLL_INTERVAL_MS || 5000);
const jobBatchSize = Number(process.env.DISCORD_JOB_BATCH_SIZE || 5);
const requiredRoleRetryMs = Math.max(60000, Number(process.env.DISCORD_REQUIRED_ROLE_RETRY_MS || 300000));
const gatewayEnabled = String(process.env.DISCORD_GATEWAY_ENABLED || "true").toLowerCase() !== "false";
const organization = currentOrganization();
const leaveLogWebhookConfigured = Boolean(discordLeaveLogWebhookUrl(organization));
const guildMembersIntent = String(process.env.DISCORD_GATEWAY_GUILD_MEMBERS_INTENT || "false").toLowerCase() === "true" || leaveLogWebhookConfigured;
const voiceStatesIntent = String(process.env.DISCORD_GATEWAY_VOICE_STATES_INTENT || "true").toLowerCase() !== "false";
const bot = createDiscordBotServices();
const nonRegularPortoDiscordChannelKey = nonRegularPortoDiscordChannel.key;
const IZ_LEIDING_CHANNEL_ID = String(process.env.DISCORD_IZ_LEIDING_CHANNEL_ID || "1515083209132478596").trim();
const IZ_LEIDING_ROLE_ID = String(process.env.DISCORD_IZ_LEIDING_ROLE_ID || "1515080646806995045").trim();
const AUDIT_LOG_ACTION_MEMBER_KICK = 20;
const AUDIT_LOG_ACTION_MEMBER_BAN_ADD = 22;
const LEAVE_LOG_AUDIT_LOOKUP_DELAY_MS = 1200;
const LEAVE_LOG_AUDIT_LOOKUP_WINDOW_MS = 15000;
let stopping = false;
let gatewaySocket = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let hasGatewayVoiceSnapshot = false;
const gatewayVoiceStatesByUser = new Map();
const gatewayMemberRolesByUser = new Map();
let claimIzCommandRegistered = false;

function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function truncateDiscordContent(value, maxLength = 1900) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 20)).trim()}\n...`;
}

function interactionTokenRoute(interaction) {
  return `/interactions/${interaction.id}/${interaction.token}/callback`;
}

async function interactionCallback(interaction, body) {
  const response = await fetch(`https://discord.com/api/v10${interactionTokenRoute(interaction)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Interaction response mislukt: ${response.status} ${text}`.trim());
  }
}

async function acknowledgeInteraction(interaction, content, ephemeral = true) {
  await interactionCallback(interaction, {
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0,
      allowed_mentions: { parse: [] }
    }
  });
}

async function deferInteraction(interaction, ephemeral = true) {
  await interactionCallback(interaction, {
    type: 5,
    data: {
      flags: ephemeral ? 64 : 0
    }
  });
}

async function editInteractionResponse(interaction, content) {
  const appId = String(process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || "").trim() || String(interaction.application_id || "");
  const response = await fetch(`https://discord.com/api/v10/webhooks/${appId}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Interaction edit mislukt: ${response.status} ${text}`.trim());
  }
}

function interactionHasRole(interaction, roleId) {
  const roles = interaction.member?.roles || [];
  return roles.map(String).includes(String(roleId));
}

function messageAuthorLabel(message = {}) {
  const memberName = message.member?.nick || message.member?.user?.global_name;
  const user = message.author || message.member?.user || {};
  return memberName || user.global_name || user.username || user.id || "Onbekend";
}

function formatTranscriptMessage(message = {}) {
  const createdAt = message.timestamp ? new Date(message.timestamp).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" }) : "-";
  const content = String(message.content || "").trim();
  const attachments = (message.attachments || [])
    .map((attachment) => attachment.url || attachment.proxy_url)
    .filter(Boolean);
  const embeds = (message.embeds || [])
    .map((embed, index) => embed.title || embed.description ? `[Embed ${index + 1}] ${[embed.title, embed.description].filter(Boolean).join(" - ")}` : `[Embed ${index + 1}]`)
    .filter(Boolean);
  return [
    `**${messageAuthorLabel(message)}** - ${createdAt}`,
    content || "_Geen tekst_",
    ...attachments.map((url) => `Bijlage: ${url}`),
    ...embeds
  ].join("\n");
}

async function downloadMessageAttachments(message = {}) {
  const files = [];
  const failedUrls = [];
  for (const attachment of message.attachments || []) {
    const url = attachment.url || attachment.proxy_url;
    if (!url || files.length >= 10) continue;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`download status ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      files.push({
        buffer,
        filename: attachment.filename || `bijlage-${files.length + 1}`,
        contentType: attachment.content_type || "application/octet-stream"
      });
    } catch (error) {
      failedUrls.push(url);
    }
  }
  return { files, failedUrls };
}

function caseNumberFromMessage(message = {}, thread = {}) {
  const haystack = [message.content, thread.name]
    .map((value) => String(value || ""))
    .join(" ");
  const match = /(?:zaak(?:nummer)?|case)\s*[:#-]?\s*([A-Z0-9-]{3,})/i.exec(haystack)
    || /#([A-Z0-9-]{3,})/i.exec(haystack);
  return match?.[1] || thread.name || message.id || "Zaak";
}

async function fetchAllThreadMessages(threadId) {
  const all = [];
  let before = "";
  for (let page = 0; page < 20; page += 1) {
    const result = await bot.listMessages(threadId, { limit: 100, before });
    const messages = Array.isArray(result?.data) ? result.data : [];
    if (!messages.length) break;
    all.push(...messages);
    before = messages[messages.length - 1]?.id || "";
    if (messages.length < 100 || !before) break;
  }
  return all.sort((a, b) => Number(BigInt(a.id || 0) - BigInt(b.id || 0)));
}

async function postTranscriptToThread(threadId, messages = []) {
  let buffer = "";
  for (const message of messages) {
    const block = formatTranscriptMessage(message);
    const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
    if (hasAttachments) {
      if (buffer) {
        await bot.createMessage(threadId, { content: buffer, allowed_mentions: { parse: [] } }, "IZ zaak transcript");
        buffer = "";
      }
      const { files, failedUrls } = await downloadMessageAttachments(message);
      const content = failedUrls.length
        ? `${block}\n\nNiet opnieuw geuploade bijlage(s):\n${failedUrls.join("\n")}`
        : block;
      if (files.length) {
        await bot.createMessageWithFiles(threadId, { content: truncateDiscordContent(content), allowed_mentions: { parse: [] } }, files, "IZ zaak transcript bijlagen");
      } else {
        await bot.createMessage(threadId, { content: truncateDiscordContent(content), allowed_mentions: { parse: [] } }, "IZ zaak transcript bijlagen");
      }
      continue;
    }
    if ((buffer + "\n\n" + block).length > 1800) {
      if (buffer) await bot.createMessage(threadId, { content: buffer, allowed_mentions: { parse: [] } }, "IZ zaak transcript");
      buffer = block;
    } else {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
    }
  }
  if (buffer) await bot.createMessage(threadId, { content: buffer, allowed_mentions: { parse: [] } }, "IZ zaak transcript");
}

async function registerClaimIzCommand() {
  if (claimIzCommandRegistered || !IZ_LEIDING_CHANNEL_ID || !IZ_LEIDING_ROLE_ID) return;
  try {
    await bot.registerGuildCommand({
      name: "claimizleiding",
      description: "Draag deze zaak/thread over naar IZ-Leiding.",
      type: 1,
      dm_permission: false
    });
    claimIzCommandRegistered = true;
    console.log("[discord-bot] slash command /claimizleiding geregistreerd.");
  } catch (error) {
    console.error(`[discord-bot] slash command registreren mislukt: ${error.message}`);
  }
}

async function handleClaimIzLeadership(interaction) {
  if (!interactionHasRole(interaction, IZ_LEIDING_ROLE_ID)) {
    await acknowledgeInteraction(interaction, "Alleen IZ-Leiding mag deze zaak overnemen.", true);
    return;
  }
  await deferInteraction(interaction, true);
  const threadId = String(interaction.channel_id || "").trim();
  const threadResult = await bot.getChannel(threadId);
  const thread = threadResult?.data || {};
  if (![10, 11, 12].includes(Number(thread.type))) {
    await editInteractionResponse(interaction, "Gebruik dit command in de thread van de zaak.");
    return;
  }
  const parentChannelId = String(thread.parent_id || "").trim();
  const starterResult = parentChannelId ? await bot.getMessage(parentChannelId, threadId).catch(() => null) : null;
  const starterMessage = starterResult?.data || null;
  const caseNumber = caseNumberFromMessage(starterMessage || {}, thread);
  const claimText = `${caseNumber} is overgenomen door IZ-Leiding`;
  const summary = await bot.createMessage(IZ_LEIDING_CHANNEL_ID, {
    content: claimText,
    embeds: [{
      title: claimText,
      description: starterMessage?.content ? truncateDiscordContent(starterMessage.content, 3500) : `Originele thread: ${thread.name || threadId}`,
      color: 0x22c55e,
      fields: [
        { name: "Originele thread", value: thread.name || threadId, inline: false },
        { name: "Overgenomen door", value: `<@${interaction.member?.user?.id || interaction.user?.id || "onbekend"}>`, inline: true }
      ],
      timestamp: new Date().toISOString()
    }],
    allowed_mentions: { parse: [] }
  }, "IZ zaak overgenomen");
  const summaryMessageId = summary?.data?.id;
  if (!summaryMessageId) throw new Error("Kon geen nieuw IZ-Leiding bericht plaatsen.");
  const newThread = await bot.createThreadFromMessage(IZ_LEIDING_CHANNEL_ID, summaryMessageId, String(caseNumber).slice(0, 90), "IZ zaak thread aangemaakt");
  const newThreadId = newThread?.data?.id;
  if (!newThreadId) throw new Error("Kon geen nieuwe IZ-Leiding thread aanmaken.");
  const threadMessages = await fetchAllThreadMessages(threadId);
  const allMessages = starterMessage ? [starterMessage, ...threadMessages.filter((message) => message.id !== starterMessage.id)] : threadMessages;
  await postTranscriptToThread(newThreadId, allMessages);
  await bot.createMessage(newThreadId, {
    content: `Zaak volledig overgenomen door IZ-Leiding. Originele thread wordt verwijderd.`,
    allowed_mentions: { parse: [] }
  }, "IZ zaak overname afgerond");
  if (parentChannelId && starterMessage?.id) {
    await bot.deleteMessage(parentChannelId, starterMessage.id, "IZ zaak overgenomen").catch((error) => {
      console.warn(`[discord-bot] origineel zaakbericht verwijderen mislukt: ${error.message}`);
    });
  }
  await bot.deleteChannel(threadId, "IZ zaak overgenomen").catch((error) => {
    console.warn(`[discord-bot] originele thread verwijderen mislukt of was al verwijderd: ${error.message}`);
  });
  await editInteractionResponse(interaction, `${claimText}. Nieuwe thread: <#${newThreadId}>`);
}

async function handleInteractionCreate(interaction = {}) {
  if (interaction.type !== 2) return;
  const commandName = String(interaction.data?.name || "").toLowerCase();
  if (commandName !== "claimizleiding") return;
  try {
    await handleClaimIzLeadership(interaction);
  } catch (error) {
    console.error(`[discord-bot] /claimizleiding mislukt: ${error.message}`);
    try {
      await editInteractionResponse(interaction, `Overnemen mislukt: ${error.message}`);
    } catch (_) {
      await acknowledgeInteraction(interaction, `Overnemen mislukt: ${error.message}`, true).catch(() => {});
    }
  }
}

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

function captureGatewayMemberRoles(member = {}) {
  const discordId = String(member.user?.id || member.user_id || "").trim();
  if (!discordId || !Array.isArray(member.roles)) return;
  gatewayMemberRolesByUser.set(discordId, member.roles.map((roleId) => String(roleId || "").trim()).filter(Boolean));
}

function discordSnowflakeTimestampMs(id) {
  const value = String(id || "").trim();
  if (!/^\d+$/.test(value)) return 0;
  try {
    return Number((BigInt(value) >> 22n) + 1420070400000n);
  } catch {
    return 0;
  }
}

async function findRecentAuditLogEntryForTarget(discordId, actionType) {
  if (!discordId || typeof bot.getGuildAuditLogs !== "function") return null;
  try {
    const result = await bot.getGuildAuditLogs({ actionType, limit: 6 });
    const entries = Array.isArray(result?.data?.audit_log_entries) ? result.data.audit_log_entries : [];
    const now = Date.now();
    return entries.find((entry) => {
      if (String(entry?.target_id || "") !== String(discordId)) return false;
      const createdAt = discordSnowflakeTimestampMs(entry?.id);
      return createdAt > 0 && now - createdAt <= LEAVE_LOG_AUDIT_LOOKUP_WINDOW_MS;
    }) || null;
  } catch (error) {
    if (error?.status === 403) {
      console.warn("[discord-bot] leave-log audit lookup overgeslagen: bot mist View Audit Log permissie.");
      return null;
    }
    console.warn(`[discord-bot] leave-log audit lookup mislukt: ${error.message}`);
    return null;
  }
}

async function detectMemberRemovalReason(discordId) {
  if (!discordId) return "leave";
  await sleep(LEAVE_LOG_AUDIT_LOOKUP_DELAY_MS);
  const banEntry = await findRecentAuditLogEntryForTarget(discordId, AUDIT_LOG_ACTION_MEMBER_BAN_ADD);
  if (banEntry) return "ban";
  const kickEntry = await findRecentAuditLogEntryForTarget(discordId, AUDIT_LOG_ACTION_MEMBER_KICK);
  if (kickEntry) return "kick";
  return "leave";
}

async function findPortalPersonByDiscordId(discordId) {
  const normalizedDiscordId = String(discordId || "").trim();
  if (!normalizedDiscordId) return null;
  try {
    return await withClient(async (client) => {
      const result = await client.query(
        "select id, name, rank, service_number, status, discord_roles from people where discord_id = $1 limit 1",
        [normalizedDiscordId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        ...row,
        discordRoles: parseJsonValue(row.discord_roles, [])
      };
    });
  } catch (error) {
    console.error(`[discord-bot] leave-log personeelscheck mislukt: ${error.message}`);
    return null;
  }
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
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";
  return {
    ...unit,
    isPortoOpsLead: Boolean(unit.vehicleNumber === operatorVehicleNumber && currentOpsMemberId && currentOpsMemberId === unit.memberId)
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

async function updatePortalDiscordSyncStatus(person, state, message, reason) {
  if (!person?.id && !person?.discordId) return;
  setDiscordSyncStatus(person, state, message, reason);
  const statusPayload = person.discordSyncStatus || {};
  await withClient(async (client) => {
    await client.query(`
      update people
      set
        raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('discordSyncStatus', $3::jsonb),
        updated_at = now()
      where ($1 <> '' and id = $1)
         or ($2 <> '' and discord_id = $2)
    `, [person.id || "", person.discordId || "", JSON.stringify(statusPayload)]);
    await client.query("select pg_notify($1, $2)", ["orp_app_events", JSON.stringify({
      scope: "people",
      sourceId: workerId,
      serviceName: "discord-bot",
      at: new Date().toISOString()
    })]);
  });
}

function syncStatusMessageFromResult(result) {
  if (result?.skipped) return result.reason || "Discord sync overgeslagen.";
  if (result?.unchanged) return "Discord profiel was al actueel.";
  if (result?.ok) return "Discord profiel gesynchroniseerd.";
  return "Discord sync verwerkt.";
}

async function findPersonForSyncJob(job) {
  const state = await readPostgresState();
  return (state.people || []).find((entry) => {
    if (job.personId && entry.id === job.personId) return true;
    if (job.discordId && String(entry.discordId || "") === String(job.discordId)) return true;
    return false;
  }) || null;
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
  if (job.type === "send_dm") {
    return bot.sendDirectMessage(
      job.discordId || job.payload?.discordId,
      job.payload?.content || job.payload?.message || job.payload?.fallbackContent || "",
      { embeds: job.payload?.embeds || [] }
    );
  }

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
  if (job.type === "porto_nickname") {
    if (!person) return { skipped: true, reason: "Geen portaalprofiel gevonden" };
    const unit = (state.portoUnits || []).find((entry) => (
      entry.id === job.payload?.unitId
      && entry.active !== false
      && entry.memberId === person.id
      && entry.vehicleNumber
    ))
      || activePortoUnitForPerson(state, person);
    if (!unit) return syncPerson(person, `Discord bot job ${job.id}: Porto dienst beeindigd`);
    return bot.syncPortoNicknameForPersonIfNeeded(person, unitWithPortoNicknameContext(state, unit), `Discord bot job ${job.id}: Porto roepnummer`);
  }
  if (!person || person.status !== "Actief") return { skipped: true, reason: "Geen actief portaalprofiel gevonden" };
  return syncPersonForState(state, person, `Discord bot job ${job.id}: ${job.payload?.reason || job.type}`);
}

async function processJobs() {
  if (stopping || !bot.isConfigured()) return;
  const jobs = await claimDiscordSyncJobs(workerId, jobBatchSize);
  for (const job of jobs) {
    try {
      const result = await syncByJob(job);
      const roleWaitResult = [result, result?.nickname, result?.rankRole, result?.qualificationRoles]
        .find((entry) => entry?.retryable);
      if (roleWaitResult) {
        await failDiscordSyncJob(job.id, new Error(roleWaitResult.reason), { retryDelayMs: requiredRoleRetryMs });
        console.log(`[discord-bot] job ${job.id} wacht op organisatie-rol (${job.attempts}/${job.maxAttempts}) - ${roleWaitResult.reason}`);
        continue;
      }
      await completeDiscordSyncJob(job.id, result);
      const statusPerson = ["sync_person", "porto_nickname"].includes(job.type)
        ? await findPersonForSyncJob(job).catch(() => null)
        : null;
      if (statusPerson) {
        const stateName = result?.skipped ? "skipped" : "synced";
        await updatePortalDiscordSyncStatus(statusPerson, stateName, syncStatusMessageFromResult(result), job.payload?.reason || job.type);
      }
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
      const person = await findPersonForSyncJob(job).catch(() => null);
      if (person) {
        const syncStatus = syncStatusFromError(error);
        await updatePortalDiscordSyncStatus(person, syncStatus.state, syncStatus.message, job.payload?.reason || job.type).catch(() => {});
      }
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

async function handleGuildMemberRemove(member = {}) {
  const organization = currentOrganization();
  if (organization.key !== "defensie") return;
  const webhookUrl = discordLeaveLogWebhookUrl(organization);
  if (!webhookUrl) return;

  const discordId = String(member.user?.id || member.user_id || "").trim();
  const trackedRoleIds = collectDefensieLeaveLogRoleIds(organization);
  if (!trackedRoleIds.size) {
    console.warn("[discord-bot] leave-log overgeslagen: DISCORD_DEFENSIE_ROLE_ID ontbreekt of organisatie is geen defensie.");
    return;
  }
  const eventRoles = Array.isArray(member.roles) ? member.roles : [];
  const cachedRoles = discordId ? gatewayMemberRolesByUser.get(discordId) || [] : [];
  const portalPerson = discordId ? await findPortalPersonByDiscordId(discordId) : null;
  const storedRoles = Array.isArray(portalPerson?.discordRoles) ? portalPerson.discordRoles : [];
  const rolesToCheck = eventRoles.length ? eventRoles : (cachedRoles.length ? cachedRoles : storedRoles);
  const hadTrackedRole = memberHasAnyTrackedRole(rolesToCheck, trackedRoleIds);
  if (!hadTrackedRole) return;

  if (discordId) {
    gatewayMemberRolesByUser.delete(discordId);
    gatewayVoiceStatesByUser.delete(discordId);
  }

  const payloadMember = portalPerson?.name ? { ...member, nick: portalPerson.name } : member;
  const removalReason = await detectMemberRemovalReason(discordId);
  const result = await sendDiscordLeaveLog(webhookUrl, buildDiscordLeaveLogPayload(payloadMember, { reason: removalReason }));
  if (result?.ok) {
    console.log(`[discord-bot] leave-log verstuurd voor ${discordMemberDisplayName(payloadMember)} (${discordUserTag(member.user || {})}).`);
    return;
  }
  console.error(`[discord-bot] leave-log mislukt voor ${discordMemberDisplayName(payloadMember)}: ${result?.status || "onbekend"} ${result?.body || ""}`.trim());
}

function identifyPayload() {
  const intents = 1 | (guildMembersIntent ? 2 : 0) | (leaveLogWebhookConfigured ? 4 : 0) | (voiceStatesIntent ? 128 : 0);
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
      await registerClaimIzCommand();
      return;
    }
    if (packet.t === "INTERACTION_CREATE") {
      await handleInteractionCreate(packet.d || {});
      return;
    }
    if (packet.t === "GUILD_CREATE") {
      for (const member of packet.d?.members || []) captureGatewayMemberRoles(member);
      await updatePortoVoiceSnapshotFromGuild(packet.d || {});
      return;
    }
    if (packet.t === "GUILD_MEMBER_ADD") {
      captureGatewayMemberRoles(packet.d || {});
      const discordId = packet.d?.user?.id;
      if (discordId) await enqueueDiscordSyncJob("sync_person", { discordId, reason: "guild_member_add" }, { discordId });
    }
    if (packet.t === "GUILD_MEMBER_UPDATE") {
      captureGatewayMemberRoles(packet.d || {});
    }
    if (packet.t === "GUILD_MEMBER_REMOVE") {
      await handleGuildMemberRemove(packet.d || {});
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
