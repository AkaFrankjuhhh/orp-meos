const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { loadEnv } = require("./modules/db");
const { createSessionStore, sessionMaxAgeSeconds } = require("./modules/session-store");
const {
  sideTaskForHost,
  hasMembershipRole,
  specialtiesForRoles,
  permissionsForTask,
  statusOption,
  statusOptionsForTask
} = require("./modules/side-tasks-config");
const { createSideTasksStore } = require("./modules/side-tasks-store");
const { portalIdentityForDiscordId, hasPortalIdentityDatabase } = require("./modules/side-tasks-portal-identity");
const { createEventBus } = require("./modules/event-bus");
const { shouldSyncDsiNicknameForStatus, requireDsiIdentityForStatus } = require("./modules/side-tasks-dsi");
const {
  createHttpResponder,
  createJsonBodyReader,
  contentTypeForPath,
  requestHost,
  shouldRejectMutation
} = require("./modules/http-security");

loadEnv();

const PORT = Number(process.env.SIDE_TASK_PORT || 3030);
const APP_BASE_URL = process.env.SIDE_TASK_APP_BASE_URL || "https://dsi.orpoverheid.nl";
const ROOT = __dirname;
const COOKIE_NAME = process.env.SIDE_TASK_SESSION_COOKIE_NAME || "orp_side_tasks_session";
const OAUTH_COOKIE_NAME = process.env.SIDE_TASK_OAUTH_COOKIE_NAME || "orp_side_tasks_oauth";
const MAX_BODY_BYTES = Number(process.env.SIDE_TASK_MAX_BODY_BYTES || process.env.MAX_BODY_BYTES || 1048576);
const DISCORD_API_BASE = "https://discord.com/api/v10";
const NEVENTAKEN_GUILD_ID = process.env.SIDE_TASK_DISCORD_GUILD_ID || "";
const NEVENTAKEN_BOT_TOKEN = process.env.SIDE_TASK_DISCORD_BOT_TOKEN || "";
const MAIN_GUILD_ID = process.env.MAIN_GOVERNMENT_DISCORD_GUILD_ID || process.env.DISCORD_GUILD_ID || "";
const MAIN_BOT_TOKEN = process.env.MAIN_GOVERNMENT_DISCORD_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || "";

const sessions = createSessionStore();
const store = createSideTasksStore();
const eventBus = createEventBus();
const { writeHeadSecure, sendJson } = createHttpResponder({ appBaseUrl: APP_BASE_URL });
const readBody = createJsonBodyReader(MAX_BODY_BYTES);

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || "");
  return Object.fromEntries(cookieHeader.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function requestProtocol(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "https";
}

function externalBaseUrl(req) {
  return `${requestProtocol(req)}://${requestHost(req)}`;
}

function redirectUri(req) {
  return `${externalBaseUrl(req)}/auth/discord/callback`;
}

function cookieOptions(req, maxAgeSeconds = sessionMaxAgeSeconds()) {
  const secure = requestProtocol(req) === "https" || String(process.env.SESSION_COOKIE_SECURE || "false").toLowerCase() === "true";
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function setCookie(res, req, name, value, maxAgeSeconds) {
  const cookie = `${name}=${encodeURIComponent(value)}; ${cookieOptions(req, maxAgeSeconds)}`;
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
  } else if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
  } else {
    res.setHeader("Set-Cookie", [existing, cookie]);
  }
}

function clearCookie(res, req, name) {
  setCookie(res, req, name, "", 0);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function jsonError(res, status, message, details = {}) {
  sendJson(res, status, { error: message, ...details });
}

function currentTask(req) {
  return sideTaskForHost(requestHost(req));
}

function avatarUrl(user) {
  if (!user || !user.id || !user.avatar) return "";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

async function discordFetch(pathname, options = {}, botToken = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (botToken) headers.Authorization = `Bot ${botToken}`;
  const response = await fetch(`${DISCORD_API_BASE}${pathname}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const error = new Error(typeof body === "string" ? body : body?.message || `Discord request mislukt (${response.status}).`);
    error.status = response.status;
    error.discordBody = body;
    throw error;
  }
  return body;
}

async function exchangeDiscordCode(req, code) {
  const body = new URLSearchParams({
    client_id: process.env.SIDE_TASK_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || "",
    client_secret: process.env.SIDE_TASK_DISCORD_CLIENT_SECRET || process.env.DISCORD_CLIENT_SECRET || "",
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(req)
  });
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Discord token request mislukt: ${response.status}`);
    error.status = response.status;
    error.discordBody = payload;
    throw error;
  }
  return payload;
}

async function fetchOAuthUser(accessToken) {
  const response = await fetch(`${DISCORD_API_BASE}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Discord gebruiker ophalen mislukt.");
    error.status = response.status;
    error.discordBody = payload;
    throw error;
  }
  return payload;
}

async function fetchOAuthGuildMember(accessToken) {
  if (!NEVENTAKEN_GUILD_ID) {
    const error = new Error("SIDE_TASK_DISCORD_GUILD_ID ontbreekt.");
    error.status = 500;
    throw error;
  }
  const response = await fetch(`${DISCORD_API_BASE}/users/@me/guilds/${NEVENTAKEN_GUILD_ID}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Je zit niet in de neventaken Discord of de rolcheck kan niet worden uitgevoerd.");
    error.status = response.status === 404 ? 403 : response.status;
    error.discordBody = payload;
    throw error;
  }
  return payload;
}

async function fetchBotGuildMember(discordId) {
  if (!NEVENTAKEN_GUILD_ID || !NEVENTAKEN_BOT_TOKEN) return null;
  try {
    return await discordFetch(`/guilds/${NEVENTAKEN_GUILD_ID}/members/${discordId}`, {}, NEVENTAKEN_BOT_TOKEN);
  } catch (error) {
    console.warn(`Neventaken Discord lid ophalen mislukt voor ${discordId}: ${error.message}`);
    return null;
  }
}

async function fetchMainGuildMember(discordId) {
  if (!MAIN_GUILD_ID || !MAIN_BOT_TOKEN) return null;
  return discordFetch(`/guilds/${MAIN_GUILD_ID}/members/${discordId}`, {}, MAIN_BOT_TOKEN);
}

async function patchMainGuildNickname(discordId, nickname) {
  if (!MAIN_GUILD_ID || !MAIN_BOT_TOKEN) {
    const error = new Error("Main overheid Discord bot/guild is niet ingesteld.");
    error.status = 500;
    throw error;
  }
  await discordFetch(`/guilds/${MAIN_GUILD_ID}/members/${discordId}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: nickname || null })
  }, MAIN_BOT_TOKEN);
}

function nicknameSyncWarning(error) {
  const message = String(error?.message || "");
  if (error?.status === 403 || /missing permissions/i.test(message)) {
    return "Status is opgeslagen, maar Discord kon de DSI-naam niet aanpassen. Controleer of de bot in de main overheid Discord Manage Nicknames heeft en boven deze gebruiker staat.";
  }
  if (error?.status === 404) {
    return "Status is opgeslagen, maar deze gebruiker is niet gevonden in de main overheid Discord.";
  }
  if (error?.status === 500) {
    return "Status is opgeslagen, maar de main overheid Discord bot/guild is niet ingesteld.";
  }
  return `Status is opgeslagen, maar Discord nickname sync mislukte: ${message || "onbekende fout"}`;
}

function buildSessionUser(user, guildMember, task, permissions) {
  const roles = Array.isArray(guildMember.roles) ? guildMember.roles.map(String) : [];
  return {
    id: user.id,
    username: user.username || "",
    globalName: user.global_name || "",
    displayName: user.global_name || user.username || user.id,
    avatarUrl: avatarUrl(user),
    taskKey: task.key,
    roles,
    permissions
  };
}

async function syncLoginMember(sessionUser, task) {
  const existing = await store.findMemberByDiscordId(task.key, sessionUser.id);
  const memberPatch = {
    id: existing?.id,
    discordId: sessionUser.id,
    discordUsername: sessionUser.username,
    displayName: sessionUser.displayName,
    avatarUrl: sessionUser.avatarUrl,
    phone: existing?.phone || "",
    callSign: existing?.callSign || "",
    aliasName: existing?.aliasName || "",
    originalNickname: existing?.originalNickname || "",
    unitNumber: existing?.unitNumber || "",
    commandRole: existing?.commandRole || "",
    status: existing?.status || "8",
    statusDetail: existing?.statusDetail || statusOption(existing?.status || "8").label,
    specialties: specialtiesForRoles(task, sessionUser.roles),
    raw: {
      lastLoginAt: new Date().toISOString(),
      lastKnownRoleIds: sessionUser.roles || []
    }
  };
  if (!existing) return store.restoreArchivedMember(task.key, sessionUser.id, memberPatch);
  const member = await store.syncMemberFromDiscord(task.key, memberPatch);
  await store.clearAccessRevocation(task.key, sessionUser.id);
  return member;
}

async function ensureSessionMember(task, session) {
  const existing = await store.findMemberByDiscordId(task.key, session.user.id);
  if (existing) return existing;
  if (!hasMembershipRole(task, session.roles || [])) return null;
  return syncLoginMember({
    ...session.user,
    roles: session.roles || []
  }, task);
}

function sessionForRequest(req, task) {
  const id = parseCookies(req)[COOKIE_NAME];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.taskKey !== task.key) return null;
  const permissions = permissionsForTask(task, session.roles || [], session.user?.id);
  if (!permissions.hasAccess) return null;
  return { id, ...session, permissions };
}

async function requireSession(req, res, task) {
  const session = sessionForRequest(req, task);
  if (!session) {
    jsonError(res, 401, "Niet ingelogd.");
    return null;
  }
  if (await store.isAccessRevoked(task.key, session.user.id)) {
    sessions.delete(session.id);
    jsonError(res, 401, "Je toegang tot deze neventaak is ingetrokken.");
    return null;
  }
  return session;
}

function sanitizeText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateStatus(task, value) {
  const status = String(value || "8");
  if (!statusOptionsForTask(task).some((option) => option.value === status)) {
    const error = new Error("Ongeldige status.");
    error.status = 400;
    throw error;
  }
  return status;
}

function publishSideTaskUpdate(task, reason, extra = {}) {
  eventBus.publish("side-task:update", {
    task: task.key,
    reason,
    ...extra
  });
}

async function applyDsiNicknameIfNeeded(task, member, nextStatus) {
  if (!task.allowAlias) return { member };
  if (nextStatus !== "8") {
    const displayNumber = (member.commandRole && member.unitNumber) || ((nextStatus === "1" || nextStatus === "4") && member.unitNumber)
      ? member.unitNumber
      : member.callSign;
    if (!displayNumber || !member.aliasName) {
      const error = new Error("Vul eerst je DSI roepnummer en schuilnaam in.");
      error.status = 400;
      throw error;
    }
    try {
      let originalNickname = member.originalNickname || "";
      if (!originalNickname) {
        const mainMember = await fetchMainGuildMember(member.discordId);
        originalNickname = mainMember?.nick || mainMember?.user?.global_name || mainMember?.user?.username || "";
        member = await store.updateMember(task.key, member.id, { originalNickname });
      }
      const commandPrefix = ["ACO", "TCO"].includes(member.commandRole) ? `${member.commandRole} ` : "";
      await patchMainGuildNickname(member.discordId, `${commandPrefix}[${displayNumber}] ${member.aliasName}`);
      return { member };
    } catch (error) {
      return { member, warning: nicknameSyncWarning(error) };
    }
  }
  const portalIdentity = await portalIdentityForDiscordId(member.discordId);
  if (!portalIdentity?.nickname) {
    const configurationHint = hasPortalIdentityDatabase()
      ? "Er is geen actief gekoppeld profiel gevonden in het personeelsportaal."
      : "De koppeling met de personeelsportaal-database is nog niet ingesteld.";
    return { member, warning: `Status is opgeslagen, maar Discordnaam is niet hersteld. ${configurationHint}` };
  }
  if (portalIdentity.nickname) {
    try {
      await patchMainGuildNickname(member.discordId, portalIdentity.nickname);
    } catch (error) {
      return { member, warning: nicknameSyncWarning(error) };
    }
  }
  return { member };
}

function shouldSyncAliasNicknameForStatus(task, status) {
  if (!task.allowAlias) return false;
  if (task.key === "DSI") return shouldSyncDsiNicknameForStatus(status);
  return ["1", "4", "8"].includes(String(status));
}

function normalizeAliasNumber(task, value) {
  const text = sanitizeText(value, 32);
  if (task.key === "DNR") {
    const match = /^DNR-(\d{1,3})$/i.exec(text);
    return match ? `DNR-${match[1].padStart(2, "0")}` : text.toUpperCase();
  }
  return text;
}

function rankNumberFromRoles(task, member) {
  const roles = new Set((member.raw?.lastKnownRoleIds || []).map(String));
  const rankNumbers = task.aliasProfile?.rankNumbers || {};
  for (const [rank, config] of Object.entries(rankNumbers)) {
    if (config.roleId && roles.has(String(config.roleId))) return { rank, number: String(config.number || "") };
  }
  return null;
}

function aliasNumberForTask(task, member, portalIdentity = null) {
  if (task.key === "KLU") {
    const rank = String(portalIdentity?.person?.rank || "").trim();
    const rankConfig = task.aliasProfile?.rankNumbers?.[rank] || null;
    const resolved = rankConfig ? { rank, number: String(rankConfig.number || "") } : rankNumberFromRoles(task, member);
    return resolved?.number ? `Eagle ${resolved.number}` : "";
  }
  if (task.key === "DSI") {
    const displayNumber = (member.commandRole && member.unitNumber) || (["1", "4"].includes(String(member.status)) && member.unitNumber)
      ? member.unitNumber
      : member.callSign;
    return displayNumber || "";
  }
  return normalizeAliasNumber(task, member.callSign);
}

function normalAliasName(member, portalIdentity = null) {
  const portalName = String(portalIdentity?.person?.name || "").trim();
  return portalName || member.displayName || member.discordUsername || "";
}

function validateAliasProfileForStatus(task, member, nextStatus, portalIdentity = null) {
  if (!task.allowAlias || String(nextStatus) === "8") return;
  if (task.key === "DSI") return requireDsiIdentityForStatus(member, nextStatus);
  const aliasProfile = task.aliasProfile || {};
  const number = aliasNumberForTask(task, member, portalIdentity);
  if (!number) {
    const error = new Error(`Vul eerst je ${aliasProfile.numberLabel || "roepnummer"} in en sla je profiel op.`);
    error.status = 400;
    throw error;
  }
  if (aliasProfile.numberPattern && !new RegExp(aliasProfile.numberPattern, "i").test(number)) {
    const error = new Error(aliasProfile.numberPatternHint || `Gebruik een geldig ${aliasProfile.numberLabel || "roepnummer"}.`);
    error.status = 400;
    throw error;
  }
  const undercover = Boolean(member.raw?.undercover);
  const needsAlias = Boolean(aliasProfile.aliasRequiredForActive || (aliasProfile.supportsUndercover && undercover));
  if (needsAlias && !String(member.aliasName || "").trim()) {
    const error = new Error(`Vul eerst je ${aliasProfile.aliasLabel || "schuilnaam"} in en sla je profiel op.`);
    error.status = 400;
    throw error;
  }
}

async function restorePortalNickname(member) {
  const portalIdentity = await portalIdentityForDiscordId(member.discordId);
  if (!portalIdentity?.nickname) {
    const configurationHint = hasPortalIdentityDatabase()
      ? "Er is geen actief gekoppeld profiel gevonden in het personeelsportaal."
      : "De koppeling met de personeelsportaal-database is nog niet ingesteld.";
    return { warning: `Status is opgeslagen, maar Discordnaam is niet hersteld. ${configurationHint}` };
  }
  try {
    await patchMainGuildNickname(member.discordId, portalIdentity.nickname);
    return {};
  } catch (error) {
    return { warning: nicknameSyncWarning(error) };
  }
}

async function applyAliasNicknameIfNeeded(task, member, nextStatus) {
  if (task.key === "DSI") return applyDsiNicknameIfNeeded(task, member, nextStatus);
  if (!task.allowAlias) return { member };
  if (String(nextStatus) === "8") {
    const restored = await restorePortalNickname(member);
    return { member, warning: restored.warning };
  }
  const portalIdentity = await portalIdentityForDiscordId(member.discordId);
  validateAliasProfileForStatus(task, member, nextStatus, portalIdentity);
  const number = aliasNumberForTask(task, member, portalIdentity);
  const undercover = Boolean(member.raw?.undercover);
  const displayName = task.aliasProfile?.supportsUndercover && !undercover
    ? normalAliasName(member, portalIdentity)
    : String(member.aliasName || "").trim() || normalAliasName(member, portalIdentity);
  const template = task.aliasProfile?.nicknameTemplate || "[{number}] {name}";
  const nickname = template
    .replaceAll("{number}", number)
    .replaceAll("{name}", displayName)
    .trim();
  try {
    let originalNickname = member.originalNickname || "";
    if (!originalNickname) {
      const mainMember = await fetchMainGuildMember(member.discordId);
      originalNickname = mainMember?.nick || mainMember?.user?.global_name || mainMember?.user?.username || "";
      member = await store.updateMember(task.key, member.id, { originalNickname });
    }
    await patchMainGuildNickname(member.discordId, nickname);
    return { member };
  } catch (error) {
    return { member, warning: nicknameSyncWarning(error) };
  }
}

function publicMember(member) {
  return {
    id: member.id,
    discordId: member.discordId,
    displayName: member.displayName,
    avatarUrl: member.avatarUrl,
    phone: member.phone,
    callSign: member.callSign,
    aliasName: member.aliasName,
    undercover: Boolean(member.raw?.undercover),
    unitNumber: member.unitNumber,
    commandRole: member.commandRole,
    status: member.status,
    statusLabel: statusOption(member.status).label,
    statusColor: statusOption(member.status).color,
    isActive: statusOption(member.status).active,
    statusDetail: member.statusDetail,
    specialties: member.specialties,
    updatedAt: member.updatedAt
  };
}

function publicArchive(archive) {
  const snapshot = archive.snapshot || {};
  return {
    id: archive.id,
    discordId: archive.discordId,
    displayName: snapshot.displayName || snapshot.discordUsername || archive.discordId,
    aliasName: snapshot.aliasName || "",
    callSign: snapshot.callSign || "",
    specialties: Array.isArray(snapshot.specialties) ? snapshot.specialties : [],
    reason: archive.reason || "",
    archivedAt: archive.archivedAt,
    restoredAt: archive.restoredAt
  };
}

function publicTask(task) {
  return {
    key: task.key,
    slug: task.slug,
    label: task.label,
    displayName: task.displayName,
    logoUrl: task.logoUrl || "",
    allowAlias: task.allowAlias,
    aliasProfile: task.aliasProfile ? {
      numberLabel: task.aliasProfile.numberLabel || "Roepnummer",
      numberPlaceholder: task.aliasProfile.numberPlaceholder || "",
      aliasLabel: task.aliasProfile.aliasLabel || "Schuilnaam",
      aliasPlaceholder: task.aliasProfile.aliasPlaceholder || "",
      supportsUndercover: Boolean(task.aliasProfile.supportsUndercover),
      numberSource: task.aliasProfile.numberSource || "manual"
    } : null,
    dsiUnits: task.dsiUnits || null,
    specialties: task.specialties.map((specialty) => ({ label: specialty.label }))
  };
}

function memberFromBotOrBody(task, body, botMember, actorId) {
  const roles = Array.isArray(botMember?.roles) ? botMember.roles.map(String) : [];
  const user = botMember?.user || {};
  return {
    discordId: sanitizeText(body.discordId, 32),
    discordUsername: user.username || "",
    displayName: sanitizeText(body.displayName || user.global_name || user.username || body.discordId),
    avatarUrl: avatarUrl(user),
    phone: sanitizeText(body.phone, 32),
    callSign: sanitizeText(body.callSign, 32),
    aliasName: sanitizeText(body.aliasName, 80),
    status: validateStatus(task, body.status || "8"),
    statusDetail: statusOption(body.status || "8").label,
    specialties: roles.length ? specialtiesForRoles(task, roles) : [],
    addedByDiscordId: actorId,
    raw: {
      addedAt: new Date().toISOString(),
      lastKnownRoleIds: roles
    }
  };
}

async function serveStatic(req, res, pathname) {
  const fileMap = new Map([
    ["/", "side-tasks.html"],
    ["/side-tasks.html", "side-tasks.html"],
    ["/side-tasks.css", "side-tasks.css"],
    ["/side-tasks.js", "side-tasks.js"],
    ["/client-guard.js", "client-guard.js"],
    ["/assets/dsi-logo.png", "assets/dsi-logo.png"],
    ["/assets/hrb-logo.png", "assets/hrb-logo.png"],
    ["/assets/klu-logo.png", "assets/klu-logo.png"],
    ["/assets/politie-logo.png", "assets/politie-logo.png"]
  ]);
  const fileName = fileMap.get(pathname);
  if (!fileName) return false;
  const filePath = path.join(ROOT, fileName);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      writeHeadSecure(res, 404);
      res.end("Not found");
      return;
    }
    writeHeadSecure(res, 200, {
      "Content-Type": contentTypeForPath(filePath),
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
  return true;
}

async function handleAuthLogin(req, res, task) {
  const clientId = process.env.SIDE_TASK_DISCORD_CLIENT_ID || process.env.DISCORD_CLIENT_ID || "";
  if (!clientId) return jsonError(res, 500, "SIDE_TASK_DISCORD_CLIENT_ID ontbreekt.");
  const state = crypto.randomBytes(24).toString("hex");
  setCookie(res, req, OAUTH_COOKIE_NAME, JSON.stringify({ state, taskKey: task.key }), 600);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "identify guilds.members.read",
    state
  });
  redirect(res, `${DISCORD_API_BASE}/oauth2/authorize?${params.toString()}`);
}

async function handleAuthCallback(req, res, task, url) {
  const oauthCookie = parseCookies(req)[OAUTH_COOKIE_NAME];
  let oauthState = null;
  try {
    oauthState = JSON.parse(oauthCookie || "{}");
  } catch {
    oauthState = null;
  }
  if (!oauthState || oauthState.state !== url.searchParams.get("state") || oauthState.taskKey !== task.key) {
    clearCookie(res, req, OAUTH_COOKIE_NAME);
    redirect(res, "/?authError=session");
    return;
  }
  clearCookie(res, req, OAUTH_COOKIE_NAME);
  try {
    const token = await exchangeDiscordCode(req, url.searchParams.get("code") || "");
    const user = await fetchOAuthUser(token.access_token);
    const guildMember = await fetchOAuthGuildMember(token.access_token);
    const roles = Array.isArray(guildMember.roles) ? guildMember.roles.map(String) : [];
    const permissions = permissionsForTask(task, roles, user.id);
    if (!permissions.hasAccess) {
      redirect(res, "/?authError=forbidden");
      return;
    }
    const sessionUser = buildSessionUser(user, guildMember, task, permissions);
    await syncLoginMember(sessionUser, task);
    const sessionId = crypto.randomBytes(32).toString("hex");
    sessions.set(sessionId, {
      taskKey: task.key,
      user: {
        id: sessionUser.id,
        username: sessionUser.username,
        displayName: sessionUser.displayName,
        avatarUrl: sessionUser.avatarUrl
      },
      roles: sessionUser.roles,
      createdAt: new Date().toISOString()
    });
    setCookie(res, req, COOKIE_NAME, sessionId);
    redirect(res, "/");
  } catch (error) {
    console.error(`Neventaken login mislukt: ${error.message}`);
    redirect(res, "/?authError=discord");
  }
}

async function handleApi(req, res, task, url) {
  if (shouldRejectMutation(req, APP_BASE_URL)) return jsonError(res, 403, "Ongeldige origin.");

  if (url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "side-tasks",
      task: task.key,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      sessions: typeof sessions.size === "function" ? sessions.size() : null,
      portalIdentityDatabase: hasPortalIdentityDatabase()
    });
  }

  if (url.pathname === "/api/auth/login" && req.method === "GET") return handleAuthLogin(req, res, task);
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const sessionId = parseCookies(req)[COOKIE_NAME];
    if (sessionId) sessions.delete(sessionId);
    clearCookie(res, req, COOKIE_NAME);
    return sendJson(res, 200, { ok: true });
  }

  const session = await requireSession(req, res, task);
  if (!session) return;

  if (url.pathname === "/api/events" && req.method === "GET") {
    return eventBus.addClient(req, res, { id: session.user.id, task: task.key });
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const member = await ensureSessionMember(task, session);
    return sendJson(res, 200, {
      user: session.user,
      task: publicTask(task),
      permissions: session.permissions,
      member: member ? publicMember(member) : null,
      statuses: statusOptionsForTask(task)
    });
  }

  if (url.pathname === "/api/side-tasks/members" && req.method === "GET") {
    const members = await store.listMembers(task.key);
    return sendJson(res, 200, { members: members.map(publicMember), statuses: statusOptionsForTask(task) });
  }

  if (url.pathname === "/api/side-tasks/archive" && req.method === "GET") {
    if (!session.permissions.canManageMembers) return jsonError(res, 403, "Geen beheerrechten.");
    const archives = await store.listArchives(task.key);
    return sendJson(res, 200, { archives: archives.map(publicArchive) });
  }

  const archiveMatch = url.pathname.match(/^\/api\/side-tasks\/archive\/([^/]+)$/);
  if (archiveMatch && req.method === "PATCH") {
    if (!session.permissions.canManageMembers) return jsonError(res, 403, "Geen beheerrechten.");
    const body = await readBody(req);
    const archive = await store.updateArchiveReason(
      task.key,
      decodeURIComponent(archiveMatch[1]),
      sanitizeText(body.reason, 400),
      session.user.id
    );
    if (!archive) return jsonError(res, 404, "Archiefrecord niet gevonden.");
    publishSideTaskUpdate(task, "archive-updated", { archiveId: archive.id });
    return sendJson(res, 200, { archive: publicArchive(archive) });
  }

  if (url.pathname === "/api/side-tasks/me/profile" && req.method === "POST") {
    const body = await readBody(req);
    const existing = await ensureSessionMember(task, session);
    if (!existing) return jsonError(res, 404, "Lid niet gevonden.");
    let member = await store.updateMemberProfile(task.key, existing.id, {
      callSign: task.aliasProfile?.numberSource === "rank" ? existing.callSign : normalizeAliasNumber(task, body.callSign),
      aliasName: sanitizeText(body.aliasName, 80),
      raw: {
        ...(task.aliasProfile?.supportsUndercover ? { undercover: Boolean(body.undercover) } : {})
      }
    });
    if (task.allowAlias) {
      console.log(`[side-tasks] ${task.key}-profiel opgeslagen voor ${member.discordId}: roepnummer=${member.callSign ? "ingesteld" : "leeg"}, schuilnaam=${member.aliasName ? "ingesteld" : "leeg"}.`);
    }
    // Een profielbewerking slaat uitsluitend profielgegevens op. De Discord-naam
    // verandert alleen tijdens de expliciete statusovergangen hieronder.
    publishSideTaskUpdate(task, "profile-updated", { memberId: member.id });
    return sendJson(res, 200, { member: publicMember(member) });
  }

  if (url.pathname === "/api/side-tasks/me/status" && req.method === "POST") {
    const body = await readBody(req);
    const status = validateStatus(task, body.status);
    let member = await ensureSessionMember(task, session);
    if (!member) return jsonError(res, 404, "Lid niet gevonden.");
    const aliasActivation = task.allowAlias && status !== "8";
    if (aliasActivation && (body.callSign !== undefined || body.aliasName !== undefined || body.undercover !== undefined)) {
      const profilePatch = {
        ...member,
        callSign: task.aliasProfile?.numberSource === "rank"
          ? member.callSign
          : body.callSign !== undefined ? normalizeAliasNumber(task, body.callSign) : member.callSign,
        aliasName: body.aliasName !== undefined ? sanitizeText(body.aliasName, 80) : member.aliasName,
        raw: {
          ...(member.raw || {}),
          ...(task.aliasProfile?.supportsUndercover && body.undercover !== undefined ? { undercover: Boolean(body.undercover) } : {})
        }
      };
      // Valideer voordat we opslaan: een incomplete browserdraft mag nooit
      // reeds opgeslagen profielgegevens leegmaken.
      const validationIdentity = task.aliasProfile?.numberSource === "rank" ? await portalIdentityForDiscordId(member.discordId) : null;
      validateAliasProfileForStatus(task, profilePatch, status, validationIdentity);
      member = await store.updateMemberProfile(task.key, member.id, profilePatch);
    }
    if (task.allowAlias) {
      const validationIdentity = task.aliasProfile?.numberSource === "rank" ? await portalIdentityForDiscordId(member.discordId) : null;
      validateAliasProfileForStatus(task, member, status, validationIdentity);
    }
    if (task.key === "DSI" && status === "1") {
      member = await store.assignDsiUnit(task.key, member.id);
    } else {
      const rankNumberIdentity = task.aliasProfile?.numberSource === "rank" && status !== "8"
        ? await portalIdentityForDiscordId(member.discordId)
        : null;
      member = await store.updateMember(task.key, member.id, {
        status,
        statusDetail: statusOption(status).label,
        callSign: task.aliasProfile?.numberSource === "rank" && status !== "8" ? aliasNumberForTask(task, member, rankNumberIdentity) : member.callSign,
        unitNumber: task.key === "DSI" && ["0", "8"].includes(status) && !member.commandRole ? "" : member.unitNumber,
        specialties: specialtiesForRoles(task, session.roles || [])
      });
    }
    if (task.key === "DSI") {
      console.log(`[side-tasks] DSI-status ${status} opgeslagen voor ${member.discordId}: roepnummer=${member.callSign ? "ingesteld" : "leeg"}, schuilnaam=${member.aliasName ? "ingesteld" : "leeg"}, eenheid=${member.unitNumber || "geen"}.`);
    }
    if (!shouldSyncAliasNicknameForStatus(task, status)) {
      publishSideTaskUpdate(task, "status-updated", { memberId: member.id, status });
      return sendJson(res, 200, { member: publicMember(member) });
    }
    const nicknameResult = await applyAliasNicknameIfNeeded(task, member, status);
    publishSideTaskUpdate(task, "status-updated", { memberId: nicknameResult.member.id, status });
    return sendJson(res, 200, { member: publicMember(nicknameResult.member), warning: nicknameResult.warning });
  }

  if (url.pathname === "/api/side-tasks/members" && req.method === "POST") {
    return jsonError(res, 405, "Leden worden automatisch vanuit Discord-rollen gesynchroniseerd.");
  }

  const dsiUnitMatch = url.pathname.match(/^\/api\/side-tasks\/dsi\/members\/([^/]+)\/unit$/);
  if (dsiUnitMatch && req.method === "POST") {
    if (task.key !== "DSI") return jsonError(res, 404, "Niet gevonden.");
    const member = await store.findMemberById(task.key, decodeURIComponent(dsiUnitMatch[1]));
    if (!member) return jsonError(res, 404, "DSI-lid niet gevonden.");
    const isOwnProfile = member.discordId === session.user.id;
    if (!isOwnProfile && !session.permissions.canManageDsiUnits) return jsonError(res, 403, "Alleen ACO, TCO of DSI-leiding kan andere leden indelen.");
    requireDsiIdentityForStatus(member, "1");
    const body = await readBody(req);
    const updated = await store.assignDsiUnit(task.key, member.id, sanitizeText(body.unitNumber, 16));
    const nicknameResult = await applyDsiNicknameIfNeeded(task, updated, updated.status);
    publishSideTaskUpdate(task, "dsi-unit-updated", { memberId: nicknameResult.member.id });
    return sendJson(res, 200, { member: publicMember(nicknameResult.member), warning: nicknameResult.warning });
  }

  const dsiSignOffMatch = url.pathname.match(/^\/api\/side-tasks\/dsi\/members\/([^/]+)\/sign-off$/);
  if (dsiSignOffMatch && req.method === "POST") {
    if (task.key !== "DSI") return jsonError(res, 404, "Niet gevonden.");
    const member = await store.findMemberById(task.key, decodeURIComponent(dsiSignOffMatch[1]));
    if (!member) return jsonError(res, 404, "DSI-lid niet gevonden.");
    const isOwnProfile = member.discordId === session.user.id;
    if (!isOwnProfile && !session.permissions.canManageDsiUnits) return jsonError(res, 403, "Alleen ACO, TCO of DSI-leiding kan andere leden afmelden.");
    const updated = await store.updateMember(task.key, member.id, {
      status: "8",
      statusDetail: statusOption("8").label,
      unitNumber: "",
      commandRole: "",
      specialties: member.specialties || []
    });
    const nicknameResult = await applyDsiNicknameIfNeeded(task, updated, "8");
    publishSideTaskUpdate(task, "dsi-member-signed-off", { memberId: nicknameResult.member.id, status: "8" });
    return sendJson(res, 200, { member: publicMember(nicknameResult.member), warning: nicknameResult.warning });
  }

  const dsiCommandMatch = url.pathname.match(/^\/api\/side-tasks\/dsi\/members\/([^/]+)\/command-role$/);
  if (dsiCommandMatch && req.method === "POST") {
    if (task.key !== "DSI") return jsonError(res, 404, "Niet gevonden.");
    if (!session.permissions.canAssignDsiCommand) return jsonError(res, 403, "Alleen DSI-leiding kan ACO/TCO toewijzen.");
    const body = await readBody(req);
    const commandRole = ["", "ACO", "TCO"].includes(String(body.commandRole || "").trim()) ? String(body.commandRole || "").trim() : null;
    if (commandRole === null) return jsonError(res, 400, "Ongeldige ACO/TCO-keuze.");
    const member = await store.findMemberById(task.key, decodeURIComponent(dsiCommandMatch[1]));
    if (!member) return jsonError(res, 404, "DSI-lid niet gevonden.");
    if (["0", "1"].includes(String(member.status))) requireDsiIdentityForStatus(member, member.status);
    if (commandRole) {
      const discordMember = await fetchBotGuildMember(member.discordId);
      const eligibleRoleIds = commandRole === "ACO" ? task.roleIds.aco : task.roleIds.tco;
      const liveRoleIds = Array.isArray(discordMember?.roles) ? discordMember.roles.map(String) : [];
      const storedRoleIds = Array.isArray(member.raw?.lastKnownRoleIds) ? member.raw.lastKnownRoleIds.map(String) : [];
      const verifiedRoleIds = liveRoleIds.length ? liveRoleIds : storedRoleIds;
      const hasEligibleRole = verifiedRoleIds.some((roleId) => eligibleRoleIds.includes(roleId));
      if (!hasEligibleRole) {
        const source = liveRoleIds.length ? "Discord" : "de laatste DSI-login";
        return jsonError(res, 403, `Dit lid heeft volgens ${source} niet de vereiste ${commandRole}-Discordrol. Laat het lid opnieuw inloggen nadat de rol is gegeven.`);
      }
    }
    const updated = await store.assignDsiCommandRole(task.key, member.id, commandRole);
    const nicknameResult = await applyDsiNicknameIfNeeded(task, updated, updated.status);
    publishSideTaskUpdate(task, "dsi-command-role-updated", { memberId: nicknameResult.member.id, commandRole });
    return sendJson(res, 200, { member: publicMember(nicknameResult.member), warning: nicknameResult.warning });
  }

  const memberMatch = url.pathname.match(/^\/api\/side-tasks\/members\/([^/]+)$/);
  if (memberMatch && req.method === "PATCH") {
    if (!session.permissions.canManageMembers) return jsonError(res, 403, "Geen beheerrechten.");
    const body = await readBody(req);
    const existing = await store.findMemberById(task.key, decodeURIComponent(memberMatch[1]));
    if (!existing) return jsonError(res, 404, "Lid niet gevonden.");
    const status = body.status ? validateStatus(task, body.status) : existing.status;
    const nextMemberProfile = {
      ...existing,
      callSign: task.aliasProfile?.numberSource === "rank"
        ? existing.callSign
        : body.callSign !== undefined ? normalizeAliasNumber(task, body.callSign) : existing.callSign,
      aliasName: body.aliasName !== undefined ? sanitizeText(body.aliasName, 80) : existing.aliasName,
      raw: {
        ...(existing.raw || {}),
        ...(task.aliasProfile?.supportsUndercover && body.undercover !== undefined ? { undercover: Boolean(body.undercover) } : {})
      }
    };
    if (task.allowAlias) {
      const validationIdentity = task.aliasProfile?.numberSource === "rank" ? await portalIdentityForDiscordId(existing.discordId) : null;
      validateAliasProfileForStatus(task, nextMemberProfile, status, validationIdentity);
    }
    const rankNumberIdentity = task.aliasProfile?.numberSource === "rank" && status !== "8"
      ? await portalIdentityForDiscordId(existing.discordId)
      : null;
    let member = await store.updateMember(task.key, existing.id, {
      displayName: body.displayName !== undefined ? sanitizeText(body.displayName, 120) : existing.displayName,
      phone: body.phone !== undefined ? sanitizeText(body.phone, 32) : existing.phone,
      callSign: task.aliasProfile?.numberSource === "rank"
        ? status !== "8" ? aliasNumberForTask(task, nextMemberProfile, rankNumberIdentity) : existing.callSign
        : body.callSign !== undefined ? normalizeAliasNumber(task, body.callSign) : existing.callSign,
      aliasName: body.aliasName !== undefined ? sanitizeText(body.aliasName, 80) : existing.aliasName,
      raw: nextMemberProfile.raw,
      status,
      statusDetail: statusOption(status).label,
      unitNumber: task.key === "DSI" && ["0", "8"].includes(status) && !existing.commandRole ? "" : existing.unitNumber
    });
    if (task.key === "DSI" && status === "1") {
      member = await store.assignDsiUnit(task.key, member.id);
    }
    if (!shouldSyncAliasNicknameForStatus(task, status)) {
      publishSideTaskUpdate(task, "member-updated", { memberId: member.id, status });
      return sendJson(res, 200, { member: publicMember(member) });
    }
    const nicknameResult = await applyAliasNicknameIfNeeded(task, member, status);
    publishSideTaskUpdate(task, "member-updated", { memberId: nicknameResult.member.id, status });
    return sendJson(res, 200, { member: publicMember(nicknameResult.member), warning: nicknameResult.warning });
  }

  if (memberMatch && req.method === "DELETE") {
    if (!session.permissions.canManageMembers) return jsonError(res, 403, "Geen beheerrechten.");
    const existing = await store.findMemberById(task.key, decodeURIComponent(memberMatch[1]));
    if (!existing) return jsonError(res, 404, "Lid niet gevonden.");
    if (task.allowAlias && existing.originalNickname) {
      try {
        await patchMainGuildNickname(existing.discordId, existing.originalNickname);
      } catch (error) {
        console.warn(`DSI nickname reset bij verwijderen mislukt: ${error.message}`);
      }
    }
    const deleted = await store.deleteMember(task.key, existing.id);
    publishSideTaskUpdate(task, "member-deleted", { memberId: deleted.id });
    return sendJson(res, 200, { member: publicMember(deleted) });
  }

  jsonError(res, 404, "Niet gevonden.");
}

async function handleRequest(req, res) {
  const task = currentTask(req);
  if (!task) {
    writeHeadSecure(res, 404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Onbekende neventaak host.");
    return;
  }
  const url = new URL(req.url, externalBaseUrl(req));
  try {
    if (url.pathname === "/auth/discord/callback") return await handleAuthCallback(req, res, task, url);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, task, url);
    if (await serveStatic(req, res, url.pathname)) return;
    writeHeadSecure(res, 404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    const status = Number(error.status || 500);
    if (status >= 500) console.error(error);
    jsonError(res, status, error.message || "Actie mislukt.");
  }
}

async function start() {
  await store.ensureSideTaskSchema();
  await sessions.load();
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`ORP Neventaken draait op ${APP_BASE_URL}`);
    console.log(`Poort: ${PORT}`);
    console.log(`Actieve sessies geladen: ${sessions.size()}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
