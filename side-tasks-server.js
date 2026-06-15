const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { loadEnv } = require("./modules/db");
const { createSessionStore, sessionMaxAgeSeconds } = require("./modules/session-store");
const {
  SIDE_TASK_STATUS_OPTIONS,
  sideTaskForHost,
  specialtiesForRoles,
  permissionsForTask,
  statusOption
} = require("./modules/side-tasks-config");
const { createSideTasksStore } = require("./modules/side-tasks-store");
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
  return store.upsertMember(task.key, {
    id: existing?.id,
    discordId: sessionUser.id,
    discordUsername: sessionUser.username,
    displayName: sessionUser.displayName,
    avatarUrl: sessionUser.avatarUrl,
    phone: existing?.phone || "",
    callSign: existing?.callSign || "",
    aliasName: existing?.aliasName || "",
    originalNickname: existing?.originalNickname || "",
    status: existing?.status || "8",
    statusDetail: existing?.statusDetail || statusOption(existing?.status || "8").label,
    specialties: specialtiesForRoles(task, sessionUser.roles),
    raw: { lastLoginAt: new Date().toISOString() }
  });
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

function requireSession(req, res, task) {
  const session = sessionForRequest(req, task);
  if (!session) {
    jsonError(res, 401, "Niet ingelogd.");
    return null;
  }
  return session;
}

function sanitizeText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateStatus(value) {
  const status = String(value || "8");
  if (!SIDE_TASK_STATUS_OPTIONS.some((option) => option.value === status)) {
    const error = new Error("Ongeldige status.");
    error.status = 400;
    throw error;
  }
  return status;
}

async function applyDsiNicknameIfNeeded(task, member, nextStatus) {
  if (!task.allowAlias) return { member };
  if (nextStatus !== "8") {
    if (!member.callSign || !member.aliasName) {
      const error = new Error("Vul eerst je DSI roepnummer en schuilnaam in.");
      error.status = 400;
      throw error;
    }
    let originalNickname = member.originalNickname || "";
    if (!originalNickname) {
      const mainMember = await fetchMainGuildMember(member.discordId);
      originalNickname = mainMember?.nick || mainMember?.user?.global_name || mainMember?.user?.username || "";
      member = await store.updateMember(task.key, member.id, { originalNickname });
    }
    try {
      await patchMainGuildNickname(member.discordId, `[${member.callSign}] ${member.aliasName}`);
      return { member };
    } catch (error) {
      return { member, warning: nicknameSyncWarning(error) };
    }
  }
  if (member.originalNickname) {
    try {
      await patchMainGuildNickname(member.discordId, member.originalNickname);
    } catch (error) {
      return { member, warning: nicknameSyncWarning(error) };
    }
  }
  return { member };
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
    status: member.status,
    statusLabel: statusOption(member.status).label,
    statusColor: statusOption(member.status).color,
    isActive: statusOption(member.status).active,
    statusDetail: member.statusDetail,
    specialties: member.specialties,
    updatedAt: member.updatedAt
  };
}

function publicTask(task) {
  return {
    key: task.key,
    slug: task.slug,
    label: task.label,
    displayName: task.displayName,
    allowAlias: task.allowAlias,
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
    status: validateStatus(body.status || "8"),
    statusDetail: statusOption(body.status || "8").label,
    specialties: roles.length ? specialtiesForRoles(task, roles) : [],
    addedByDiscordId: actorId,
    raw: { addedAt: new Date().toISOString() }
  };
}

async function serveStatic(req, res, pathname) {
  const fileMap = new Map([
    ["/", "side-tasks.html"],
    ["/side-tasks.html", "side-tasks.html"],
    ["/side-tasks.css", "side-tasks.css"],
    ["/side-tasks.js", "side-tasks.js"],
    ["/assets/dsi-logo.png", "assets/dsi-logo.png"]
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
    return sendJson(res, 200, { ok: true, service: "side-tasks", task: task.key, timestamp: new Date().toISOString() });
  }

  if (url.pathname === "/api/auth/login" && req.method === "GET") return handleAuthLogin(req, res, task);
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const sessionId = parseCookies(req)[COOKIE_NAME];
    if (sessionId) sessions.delete(sessionId);
    clearCookie(res, req, COOKIE_NAME);
    return sendJson(res, 200, { ok: true });
  }

  const session = requireSession(req, res, task);
  if (!session) return;

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const member = await store.findMemberByDiscordId(task.key, session.user.id);
    return sendJson(res, 200, {
      user: session.user,
      task: publicTask(task),
      permissions: session.permissions,
      member: member ? publicMember(member) : null,
      statuses: SIDE_TASK_STATUS_OPTIONS
    });
  }

  if (url.pathname === "/api/side-tasks/members" && req.method === "GET") {
    const members = await store.listMembers(task.key);
    return sendJson(res, 200, { members: members.map(publicMember), statuses: SIDE_TASK_STATUS_OPTIONS });
  }

  if (url.pathname === "/api/side-tasks/me/profile" && req.method === "POST") {
    const body = await readBody(req);
    const existing = await store.findMemberByDiscordId(task.key, session.user.id);
    if (!existing) return jsonError(res, 404, "Lid niet gevonden.");
    const member = await store.updateMember(task.key, existing.id, {
      phone: sanitizeText(body.phone, 32),
      callSign: sanitizeText(body.callSign, 32),
      aliasName: sanitizeText(body.aliasName, 80)
    });
    return sendJson(res, 200, { member: publicMember(member) });
  }

  if (url.pathname === "/api/side-tasks/me/status" && req.method === "POST") {
    const body = await readBody(req);
    const status = validateStatus(body.status);
    let member = await store.findMemberByDiscordId(task.key, session.user.id);
    if (!member) return jsonError(res, 404, "Lid niet gevonden.");
    member = await store.updateMember(task.key, member.id, {
      status,
      statusDetail: statusOption(status).label,
      specialties: specialtiesForRoles(task, session.roles || [])
    });
    const nicknameResult = await applyDsiNicknameIfNeeded(task, member, status);
    return sendJson(res, 200, { member: publicMember(nicknameResult.member), warning: nicknameResult.warning });
  }

  if (url.pathname === "/api/side-tasks/members" && req.method === "POST") {
    if (!session.permissions.canManageMembers) return jsonError(res, 403, "Geen beheerrechten.");
    const body = await readBody(req);
    const discordId = sanitizeText(body.discordId, 32);
    if (!discordId) return jsonError(res, 400, "Discord ID ontbreekt.");
    const botMember = await fetchBotGuildMember(discordId);
    const member = await store.upsertMember(task.key, memberFromBotOrBody(task, body, botMember, session.user.id));
    return sendJson(res, 201, { member: publicMember(member) });
  }

  const memberMatch = url.pathname.match(/^\/api\/side-tasks\/members\/([^/]+)$/);
  if (memberMatch && req.method === "PATCH") {
    if (!session.permissions.canManageMembers) return jsonError(res, 403, "Geen beheerrechten.");
    const body = await readBody(req);
    const existing = await store.findMemberById(task.key, decodeURIComponent(memberMatch[1]));
    if (!existing) return jsonError(res, 404, "Lid niet gevonden.");
    const status = body.status ? validateStatus(body.status) : existing.status;
    let member = await store.updateMember(task.key, existing.id, {
      displayName: body.displayName !== undefined ? sanitizeText(body.displayName, 120) : existing.displayName,
      phone: body.phone !== undefined ? sanitizeText(body.phone, 32) : existing.phone,
      callSign: body.callSign !== undefined ? sanitizeText(body.callSign, 32) : existing.callSign,
      aliasName: body.aliasName !== undefined ? sanitizeText(body.aliasName, 80) : existing.aliasName,
      status,
      statusDetail: statusOption(status).label
    });
    const nicknameResult = await applyDsiNicknameIfNeeded(task, member, status);
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
