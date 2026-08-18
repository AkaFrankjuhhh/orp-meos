const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { createHttpResponder, createJsonBodyReader, serveWhitelistedStatic, shouldRejectMutation } = require("./modules/http-security");
const { portalIdentityForDiscordId, hasPortalIdentityDatabase, portalPersonDisplayName } = require("./modules/side-tasks-portal-identity");
const { getMeosStore, meosStoreConfigFromEnv } = require("./modules/meos-store");

loadEnv();

const port = Number(process.env.OVERHEID_PORT || process.env.PORT || 3020);
const appBaseUrl = process.env.OVERHEID_APP_BASE_URL || `http://localhost:${port}`;
const { writeHeadSecure, sendJson, sendHtml } = createHttpResponder({ appBaseUrl });
const readMeosBody = createJsonBodyReader(Number(process.env.MEOS_MAX_BODY_BYTES || process.env.MAX_BODY_BYTES || 65536));

const roleRoutes = [
  {
    key: "defensie",
    label: "Defensie",
    roleId: process.env.DISCORD_DEFENSIE_ROLE_ID || "",
    targetUrl: process.env.OVERHEID_DEFENSIE_URL || process.env.DEFENSIE_APP_BASE_URL || "https://orpdefensie.nl"
  },
  {
    key: "politie",
    label: "Politie",
    roleId: process.env.DISCORD_POLITIE_ROLE_ID || "1423471185391255705",
    targetUrl: process.env.OVERHEID_POLITIE_URL || process.env.POLITIE_APP_BASE_URL || "https://orppolitie.nl"
  }
];
// MEOS negeert brede portal/env-rollen zoals DISCORD_POLITIE_MEOS_ROLE_ID en gebruikt alleen deze expliciete allowlist.
const meosRoleRoutes = [
  {
    key: "defensie",
    label: "Defensie MEOS",
    roleIds: ["1423468016099918024", "1425931664877551708"]
  },
  {
    key: "politie",
    label: "Politie MEOS",
    roleIds: ["1423471185391255705", "1425715749862772818"]
  }
];
const INTERNAL_COMPLAINT_RETURN_TO = "/forms/interne-klacht";
const internalComplaintHosts = new Set(["interne-klacht.orpoverheid.nl", "interne-klachten.orpoverheid.nl"]);
const oauthStateTtlMs = 10 * 60 * 1000;
const pendingOAuthStates = new Map();
const meosSessionCookieName = "orp_meos_session";
const meosSessionTtlMs = Number(process.env.MEOS_SESSION_MAX_AGE_SECONDS || 7 * 24 * 60 * 60) * 1000;
const meosSessions = new Map();
const meosRateLimitHits = new Map();

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        const key = part.slice(0, index);
        const value = part.slice(index + 1);
        try {
          return [key, decodeURIComponent(value)];
        } catch {
          return [key, value];
        }
      })
  );
}

function cleanupPendingOAuthStates() {
  const expiredBefore = Date.now() - oauthStateTtlMs;
  for (const [state, value] of pendingOAuthStates) {
    if (!value?.createdAt || value.createdAt < expiredBefore) pendingOAuthStates.delete(state);
  }
}

function rememberOAuthState(state, data) {
  cleanupPendingOAuthStates();
  pendingOAuthStates.set(state, {
    ...data,
    createdAt: Date.now()
  });
}

function takeOAuthState(state) {
  cleanupPendingOAuthStates();
  if (!state) return null;
  const value = pendingOAuthStates.get(state);
  if (value) pendingOAuthStates.delete(state);
  return value || null;
}

function cleanupMeosSessions() {
  const now = Date.now();
  for (const [sessionId, session] of meosSessions) {
    if (!session?.expiresAt || session.expiresAt <= now) meosSessions.delete(sessionId);
  }
}

function rememberMeosSession(profile) {
  cleanupMeosSessions();
  const sessionId = crypto.randomBytes(32).toString("hex");
  meosSessions.set(sessionId, {
    id: sessionId,
    profile,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + meosSessionTtlMs
  });
  return sessionId;
}

function getMeosSession(req) {
  cleanupMeosSessions();
  const cookies = parseCookies(req);
  const sessionId = String(cookies[meosSessionCookieName] || "").trim();
  if (!sessionId) return null;
  const session = meosSessions.get(sessionId);
  if (!session || session.expiresAt <= Date.now()) {
    meosSessions.delete(sessionId);
    return null;
  }
  return session;
}

function meosLoginUrlForRequest(req) {
  try {
    const url = new URL(req.url, requestBaseUrl(req));
    return `/api/meos/login?returnTo=${encodeURIComponent(safeMeosReturnTo(url.pathname))}`;
  } catch {
    return "/api/meos/login?returnTo=%2Fdashboard";
  }
}

function requireMeosApiSession(req, res) {
  const session = getMeosSession(req);
  if (session) return session;
  sendJson(res, 401, {
    authenticated: false,
    error: "MEOS login vereist.",
    loginUrl: meosLoginUrlForRequest(req)
  });
  return null;
}

function meosClientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function meosRateLimitAllows(req, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${meosClientIp(req) || "unknown"}`;
  const recent = (meosRateLimitHits.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    meosRateLimitHits.set(key, recent);
    return false;
  }
  recent.push(now);
  meosRateLimitHits.set(key, recent);
  return true;
}

function meosAuditLogPath() {
  const configured = String(process.env.MEOS_AUDIT_LOG_PATH || "meos-audit.log").trim();
  if (!configured || configured.toLowerCase() === "off") return "";
  return path.isAbsolute(configured) ? configured : path.join(__dirname, configured);
}

function appendMeosAudit(req, session, action, details = {}) {
  const filePath = meosAuditLogPath();
  if (!filePath) return;
  const entry = {
    at: new Date().toISOString(),
    action,
    path: req.url,
    host: forwardedHost(req),
    ip: meosClientIp(req),
    actor: {
      name: session?.profile?.name || "",
      discordId: session?.profile?.discordId || "",
      organizationKey: session?.profile?.organizationKey || ""
    },
    details
  };
  const line = `${JSON.stringify(entry)}\n`;
  fs.mkdir(path.dirname(filePath), { recursive: true }, (mkdirError) => {
    if (mkdirError) {
      console.error("MEOS audit map maken mislukt:", mkdirError.message || mkdirError);
      return;
    }
    fs.appendFile(filePath, line, (appendError) => {
      if (appendError) console.error("MEOS audit schrijven mislukt:", appendError.message || appendError);
    });
  });
}

function deleteMeosSession(req) {
  const cookies = parseCookies(req);
  const sessionId = String(cookies[meosSessionCookieName] || "").trim();
  if (sessionId) meosSessions.delete(sessionId);
}

function forwardedHost(req) {
  return String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
    .split(",")[0]
    .split(":")[0]
    .trim()
    .toLowerCase();
}

function isMeosHost(req) {
  const host = forwardedHost(req);
  return host === "meos.orpoverheid.nl" || host === "meos.orpdefensie.nl" || host === "meos.orppolitie.nl";
}

function isMeosPageRoute(pathname) {
  const firstSegment = String(pathname || "").split("/").filter(Boolean)[0]?.toLowerCase() || "";
  return ["dashboard", "personen", "voertuigen", "arrestatiebevelen", "at"].includes(firstSegment);
}

function serveMeosStatic(req, res, url) {
  const meosStaticPaths = new Set(["/", "/meos", "/meos.html", "/meos.css", "/meos.js"]);
  const isMeosAsset = url.pathname.startsWith("/assets/");
  const isMeosPage = isMeosPageRoute(url.pathname);
  const isMeosShell = ["/", "/meos", "/meos.html"].includes(url.pathname) || isMeosPage;
  if (isMeosHost(req)) {
    if (!meosStaticPaths.has(url.pathname) && !isMeosAsset && !isMeosPage) return false;
    if (isMeosShell && !getMeosSession(req)) {
      writeHeadSecure(res, 302, {
        Location: `/api/meos/login?returnTo=${encodeURIComponent(safeMeosReturnTo(url.pathname))}`
      });
      res.end();
      return true;
    }
  } else if (!["/meos", "/meos.html", "/meos.css", "/meos.js"].includes(url.pathname)) {
    return false;
  }
  const requested = url.pathname === "/" || url.pathname === "/meos" || isMeosPage ? "/meos.html" : url.pathname;
  const publicRootFiles = new Set(["meos.html", "meos.css", "meos.js"]);
  serveWhitelistedStatic({
    root: __dirname,
    requested,
    res,
    writeHeadSecure,
    publicRootFiles
  });
  return true;
}

function cookieDomainSuffix(req) {
  const host = forwardedHost(req);
  if (host === "orpoverheid.nl" || host.endsWith(".orpoverheid.nl")) return "; Domain=.orpoverheid.nl";
  return "";
}

function secureCookieSuffix(req) {
  const proto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
  return proto === "https" || String(appBaseUrl || "").startsWith("https://") ? "; Secure" : "";
}

function authCookie(name, value, maxAgeSeconds = 600, req = null) {
  return `${name}=${encodeURIComponent(String(value || ""))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${cookieDomainSuffix(req)}${secureCookieSuffix(req)}`;
}

function clearCookie(name, req = null) {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${cookieDomainSuffix(req)}${secureCookieSuffix(req)}`;
}

function clearHostCookie(name, req = null) {
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieSuffix(req)}`;
}

function clearOverheidCookies(names, req = null) {
  return names.flatMap((name) => [clearHostCookie(name, req), clearCookie(name, req)]);
}

function meosSessionCookie(sessionId, req = null) {
  return authCookie(meosSessionCookieName, sessionId, Math.floor(meosSessionTtlMs / 1000), req);
}

function clearMeosSessionCookie(req = null) {
  return clearCookie(meosSessionCookieName, req);
}

function choiceCookie(routes, req = null) {
  return authCookie("orp_overheid_choices", routes.map((route) => route.key).join(","), 120, req);
}

function returnToCookie(returnTo, req = null) {
  return authCookie("orp_overheid_return_to", safeReturnTo(returnTo), 120, req);
}

function safeReturnTo(value) {
  const path = String(value || "/").trim();
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

function choicesFromCookie(req) {
  const cookies = parseCookies(req);
  const keys = new Set(String(cookies.orp_overheid_choices || "").split(",").map((key) => key.trim()).filter(Boolean));
  if (!keys.size) return [];
  return roleRoutes.filter((route) => keys.has(route.key));
}

function returnToFromRequest(req, url) {
  const host = forwardedHost(req);
  if (internalComplaintHosts.has(host)) return INTERNAL_COMPLAINT_RETURN_TO;
  if (["/interne-klacht", "/interne-klachten"].includes(url.pathname)) return INTERNAL_COMPLAINT_RETURN_TO;
  return safeReturnTo(url.searchParams.get("returnTo") || "/");
}

function returnToFromCookie(req, fallback = "/") {
  const cookies = parseCookies(req);
  return safeReturnTo(cookies.orp_overheid_return_to || fallback);
}

function requestBaseUrl(req) {
  if (process.env.OVERHEID_APP_BASE_URL) return process.env.OVERHEID_APP_BASE_URL.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`).split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function callbackUrl(req) {
  return `${requestBaseUrl(req)}/auth/discord/callback`;
}

function meosAppBaseUrl(req) {
  if (process.env.MEOS_APP_BASE_URL) return process.env.MEOS_APP_BASE_URL.replace(/\/+$/, "");
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`).split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function meosCallbackUrl(req) {
  const configured = String(process.env.MEOS_DISCORD_REDIRECT_URI || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${meosAppBaseUrl(req)}/auth/discord/callback`;
}

function safeMeosReturnTo(value) {
  const returnTo = safeReturnTo(value || "/dashboard");
  if (returnTo === "/" || returnTo === "/meos" || returnTo === "/meos.html") return "/dashboard";
  return isMeosPageRoute(returnTo) ? returnTo : "/dashboard";
}

function meosHomeUrl(req, returnTo = "/dashboard") {
  return `${meosAppBaseUrl(req)}${safeMeosReturnTo(returnTo)}`;
}

function discordConfigured() {
  return Boolean(
    process.env.DISCORD_CLIENT_ID &&
      process.env.DISCORD_CLIENT_SECRET &&
      process.env.DISCORD_GUILD_ID &&
      (roleRoutes.some((route) => route.roleId) || meosRoleRoutes.some((route) => route.roleIds?.length))
  );
}

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function envIdList(...keys) {
  return keys.flatMap((key) => String(process.env[key] || "").split(/[,\s]+/))
    .map(normalizeDiscordId)
    .filter(Boolean);
}

function devOverrideIds() {
  return new Set(String(process.env.DEV_OVERRIDE_DISCORD_IDS || "").split(/[,\s]+/).map(normalizeDiscordId).filter(Boolean));
}

function isDevOverride(userId) {
  return devOverrideIds().has(normalizeDiscordId(userId));
}

function routeRoleIds(route) {
  return Array.isArray(route.roleIds) ? route.roleIds : [route.roleId].filter(Boolean);
}

function matchingRoutesForRoles(routes, roles, userId) {
  return routes.filter((route) => routeRoleIds(route).some((roleId) => roles.has(roleId) || isDevOverride(userId)));
}

function meosOrganizationPriority(matches = []) {
  const seen = new Set();
  return matches
    .map((route) => String(route?.key || "").trim().toLowerCase())
    .filter((key) => {
      if (!["defensie", "politie"].includes(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function configuredMeosDeleteRoleIds(organizationKey = "") {
  const common = envIdList("MEOS_DELETE_ROLE_IDS");
  const key = String(organizationKey || "").trim().toLowerCase();
  if (key === "defensie") {
    return [
      ...common,
      ...envIdList("MEOS_DEFENSIE_DELETE_ROLE_IDS", "DISCORD_KADER_ROLE_ID")
    ];
  }
  if (key === "politie") {
    return [
      ...common,
      ...envIdList("MEOS_POLITIE_DELETE_ROLE_IDS", "DISCORD_POLITIE_KORPSLEIDING_ROLE_ID")
    ];
  }
  return common;
}

function meosPermissionsForMember(roles, organizations = [], userId = "") {
  const memberRoles = roles instanceof Set ? roles : new Set(roles || []);
  const organizationKeys = organizations.length ? organizations : ["overheid"];
  const deleteRoleIds = new Set(organizationKeys.flatMap((key) => configuredMeosDeleteRoleIds(key)));
  return {
    canDeleteEntries: isDevOverride(userId) || [...deleteRoleIds].some((roleId) => memberRoles.has(roleId))
  };
}

function discordAvatarUrl(user) {
  if (!user?.id || !user?.avatar) return "/assets/meos-logo.png?v=20260818-site-logo";
  const extension = String(user.avatar).startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

function serviceNumberFromNickname(nickname) {
  const match = String(nickname || "").match(/^\[([^\]\s]+)(?:\s+[^\]]+)?\]/);
  return match ? match[1] : "";
}

function meosFallbackProfile(user = null) {
  return {
    name: user?.global_name || user?.username || "Frank Bright",
    rank: "Brigadegeneraal",
    serviceNumber: "70-04",
    avatarUrl: discordAvatarUrl(user || {}),
    discordId: normalizeDiscordId(user?.id || ""),
    discordUsername: user?.username || "",
    organizationKey: "overheid",
    permissions: {
      canDeleteEntries: false
    }
  };
}

function allowMeosDemoProfileFallback() {
  const requiresPortalIdentity = String(process.env.MEOS_REQUIRE_PORTAL_IDENTITY || "true").toLowerCase() !== "false";
  return !requiresPortalIdentity
    && !hasPortalIdentityDatabase()
    && String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
}

async function meosProfileForDiscordUser(user, matches = [], member = {}) {
  const organizationPriority = meosOrganizationPriority(matches);
  const identity = await portalIdentityForDiscordId(user?.id, {
    organizationPriority,
    discordUser: user,
    guildMember: member,
    linkMissingDiscordId: true
  });
  if (!identity && !allowMeosDemoProfileFallback()) return null;
  const person = identity?.person || {};
  const fallback = meosFallbackProfile(user);
  const portalName = portalPersonDisplayName(person, {
    fallbackNickname: member?.nick || identity?.nickname || ""
  });
  return {
    name: String(portalName || fallback.name).trim(),
    rank: String(person.rank || fallback.rank || "").trim(),
    serviceNumber: String(person.service_number || person.previous_service_number || serviceNumberFromNickname(identity?.nickname) || fallback.serviceNumber).trim(),
    avatarUrl: discordAvatarUrl(user),
    discordId: normalizeDiscordId(user?.id || ""),
    discordUsername: user?.username || "",
    organizationKey: identity?.organizationKey || organizationPriority[0] || "overheid",
    matchedOrganizations: organizationPriority,
    portalPersonId: String(person.id || "").trim(),
    identityLinkedBy: String(identity?.linkedBy || (identity ? "discord_id" : "fallback")).trim(),
    portalNickname: String(identity?.nickname || "").trim()
  };
}

async function discordFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text || `Discord API fout ${response.status}` };
  }
  if (!response.ok) {
    const error = new Error(body?.message || body?.error_description || `Discord API fout ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function exchangeCode(code, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });
  return discordFetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
}

async function getDiscordUser(accessToken) {
  return discordFetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

async function getGuildMember(accessToken) {
  return discordFetch(`https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

function targetLoginUrl(route, returnTo = "/") {
  const target = String(route.targetUrl || "").replace(/\/+$/, "");
  return `${target}/api/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

function shouldOpenReturnToDirectly(returnTo) {
  return safeReturnTo(returnTo) === INTERNAL_COMPLAINT_RETURN_TO;
}

function targetPortalUrl(route, returnTo = "/") {
  if (!shouldOpenReturnToDirectly(returnTo)) return targetLoginUrl(route, returnTo);
  const target = String(route.targetUrl || "").replace(/\/+$/, "");
  return `${target}${safeReturnTo(returnTo)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function page({ title, subtitle, body, error = "" }) {
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | ORP Overheid</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, Segoe UI, system-ui, sans-serif; background: #08111f; color: #f8fbff; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background-image: linear-gradient(90deg, rgba(3, 8, 14, .26), rgba(3, 8, 14, .04) 34%, rgba(3, 8, 14, .18) 65%, rgba(3, 8, 14, .30)), radial-gradient(circle at 50% 50%, rgba(8, 17, 31, .18), rgba(3, 7, 12, .46) 55%, rgba(3, 7, 12, .72)), url("/assets/orp-overheid-background.png?v=20260614-modern-login"); background-position: center; background-size: cover; background-repeat: no-repeat; background-attachment: fixed; }
    main { width: min(680px, calc(100vw - 32px)); padding: 34px; border: 1px solid rgba(135, 171, 219, .32); border-radius: 18px; background: rgba(10, 20, 35, .82); box-shadow: 0 28px 90px rgba(0,0,0,.48); backdrop-filter: blur(14px); }
    .eyebrow { margin: 0 0 12px; color: #93b7e5; font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: .04em; }
    h1 { margin: 0; font-size: clamp(34px, 6vw, 58px); line-height: 1; }
    p { color: #c8d7ec; line-height: 1.55; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px; }
    a, button { appearance: none; border: 0; border-radius: 12px; padding: 14px 18px; background: #ff8a00; color: #fff; font-weight: 900; text-decoration: none; cursor: pointer; font: inherit; }
    a.secondary { background: #15243b; border: 1px solid rgba(149, 180, 222, .34); }
    .error { margin-top: 22px; padding: 14px 16px; border-radius: 12px; background: rgba(255, 79, 79, .12); border: 1px solid rgba(255, 79, 79, .42); color: #ffdada; font-weight: 800; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">ORP Overheid</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    ${body}
  </main>
</body>
</html>`;
}

function loginPage(error = "") {
  return page({
    title: "Aanmelden",
    subtitle: "Log in met Discord. Daarna sturen wij je automatisch door naar het portaal van jouw organisatie.",
    error,
    body: '<div class="actions"><a href="/api/auth/login">Aanmelden met Discord</a></div>'
  });
}

function choicePage(routes, returnTo = "/") {
  return page({
    title: "Kies organisatie",
    subtitle: "Je hebt toegang tot meerdere organisaties. Kies welk portaal je wilt openen.",
    body: `<div class="actions">${routes.map((route) => `<a href="${escapeHtml(targetPortalUrl(route, returnTo))}">${escapeHtml(route.label)} openen</a>`).join("")}</div>`
  });
}

function meosPathParam(pathname, prefix) {
  const raw = String(pathname || "").slice(prefix.length).replace(/^\/+/, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function meosNestedPathParam(pathname, prefix, suffix) {
  const text = String(pathname || "");
  if (!text.startsWith(prefix) || !text.endsWith(suffix)) return "";
  const raw = text.slice(prefix.length, text.length - suffix.length).replace(/^\/+|\/+$/g, "");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function meosEntryPathParams(pathname, collection) {
  const prefix = "/api/meos/people/";
  const marker = `/${collection}/`;
  const text = String(pathname || "");
  if (!text.startsWith(prefix)) return { person: "", entryId: "" };
  const rest = text.slice(prefix.length);
  const index = rest.indexOf(marker);
  if (index === -1) return { person: "", entryId: "" };
  const rawPerson = rest.slice(0, index);
  const rawEntryId = rest.slice(index + marker.length);
  try {
    return {
      person: decodeURIComponent(rawPerson),
      entryId: decodeURIComponent(rawEntryId)
    };
  } catch {
    return { person: rawPerson, entryId: rawEntryId };
  }
}

function meosTodayDate() {
  const date = new Date();
  const months = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function meosText(value, field, options = {}) {
  const max = Number(options.max || 500);
  const required = Boolean(options.required);
  const fallback = options.fallback || "";
  const raw = String(value ?? "").trim();
  const text = (raw || String(fallback || "").trim()).replace(/\r\n/g, "\n");
  if (required && !text) {
    const error = new Error(`${field} is verplicht.`);
    error.status = 400;
    throw error;
  }
  if (text.length > max) {
    const error = new Error(`${field} mag maximaal ${max} tekens bevatten.`);
    error.status = 400;
    throw error;
  }
  return text;
}

function meosActorName(session) {
  return String(session?.profile?.name || session?.profile?.discordUsername || "MEOS").trim() || "MEOS";
}

function meosCreatedBy(session) {
  return {
    name: meosActorName(session),
    discordId: session?.profile?.discordId || "",
    organizationKey: session?.profile?.organizationKey || ""
  };
}

function meosHasPermission(session, permission) {
  return Boolean(session?.profile?.permissions?.[permission]);
}

function requireMeosPermission(session, permission, message) {
  if (meosHasPermission(session, permission)) return;
  const error = new Error(message || "Je hebt geen MEOS rechten voor deze actie.");
  error.status = 403;
  throw error;
}

function meosRecordFromBody(body = {}, session = null) {
  return {
    date: meosText(body.date, "Datum", { max: 40, fallback: meosTodayDate() }),
    sanction: meosText(body.sanction, "Sanctie", { max: 80, required: true }),
    verbalist: meosText(body.verbalist, "Verbalisant", { max: 120, fallback: meosActorName(session) }),
    note: meosText(body.note, "Notitie", { max: 2000, required: true }),
    createdBy: meosCreatedBy(session)
  };
}

function meosNoteFromBody(body = {}, session = null) {
  return {
    date: meosText(body.date, "Datum", { max: 40, fallback: meosTodayDate() }),
    author: meosText(body.author, "Verbalisant", { max: 120, fallback: meosActorName(session) }),
    note: meosText(body.note, "Notitie", { max: 2000, required: true }),
    createdBy: meosCreatedBy(session)
  };
}

async function sendMeosStoreResponse(req, res, action, details, handler) {
  const session = requireMeosApiSession(req, res);
  if (!session) return true;
  try {
    const payload = await handler(getMeosStore(), session);
    appendMeosAudit(req, session, action, details);
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      ...payload
    });
  } catch (error) {
    console.error(`MEOS API ${action} mislukt:`, error.message || error);
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || "MEOS data ophalen is mislukt."
    });
  }
  return true;
}

async function sendMeosMutationResponse(req, res, action, details, handler, options = {}) {
  const session = requireMeosApiSession(req, res);
  if (!session) return true;
  try {
    if (options.permission) requireMeosPermission(session, options.permission, options.permissionMessage);
    const body = options.readBody === false ? {} : await readMeosBody(req);
    const payload = await handler(getMeosStore(), session, body);
    appendMeosAudit(req, session, action, {
      ...details,
      recordId: payload.record?.id || "",
      noteId: payload.note?.id || "",
      deletedId: payload.deleted?.id || ""
    });
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      ...payload
    });
  } catch (error) {
    console.error(`MEOS API ${action} mislukt:`, error.message || error);
    sendJson(res, error.status || 500, {
      ok: false,
      error: error.message || "MEOS wijziging opslaan is mislukt."
    });
  }
  return true;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, requestBaseUrl(req));
  if (req.method === "GET" && serveMeosStatic(req, res, url)) return;

  if (shouldRejectMutation(req, appBaseUrl)) {
    sendJson(res, 403, { ok: false, error: "Ongeldige origin." });
    return;
  }

  if (url.pathname === "/api/meos/login" && !meosRateLimitAllows(
    req,
    "meos-login",
    Number(process.env.MEOS_LOGIN_RATE_LIMIT_MAX || 30),
    Number(process.env.MEOS_LOGIN_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000)
  )) {
    sendJson(res, 429, { ok: false, error: "Te veel MEOS loginpogingen. Wacht even en probeer opnieuw." });
    return;
  }

  if (url.pathname.startsWith("/api/meos/") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !meosRateLimitAllows(
    req,
    "meos-mutation",
    Number(process.env.MEOS_MUTATION_RATE_LIMIT_MAX || 60),
    Number(process.env.MEOS_MUTATION_RATE_LIMIT_WINDOW_MS || 60 * 1000)
  )) {
    sendJson(res, 429, { ok: false, error: "Te veel MEOS wijzigingen kort achter elkaar." });
    return;
  }

  if (url.pathname === "/assets/orp-overheid-background.png" && req.method === "GET") {
    const assetPath = path.join(__dirname, "assets", "orp-overheid-background.png");
    fs.readFile(assetPath, (error, data) => {
      if (error) {
        writeHeadSecure(res, 404);
        res.end("Not found");
        return;
      }
      writeHeadSecure(res, 200, {
        "Content-Type": "image/png",
        "Content-Length": Buffer.byteLength(data),
        "Cache-Control": "no-store"
      });
      res.end(data);
    });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      service: "overheid-router",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      configuredRoutes: roleRoutes.filter((route) => route.roleId).map((route) => route.key)
    });
    return;
  }

  if (url.pathname === "/api/meos/session/debug" && req.method === "GET") {
    const session = requireMeosApiSession(req, res);
    if (!session) return;
    appendMeosAudit(req, session, "session.debug", {});
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      dataSource: meosStoreConfigFromEnv(),
      session: {
        createdAt: session.createdAt,
        expiresAt: new Date(session.expiresAt).toISOString()
      },
      profile: {
        name: session.profile?.name || "",
        rank: session.profile?.rank || "",
        serviceNumber: session.profile?.serviceNumber || "",
        organizationKey: session.profile?.organizationKey || "",
        matchedOrganizations: session.profile?.matchedOrganizations || [],
        discordId: session.profile?.discordId || "",
        discordUsername: session.profile?.discordUsername || "",
        portalPersonId: session.profile?.portalPersonId || "",
        identityLinkedBy: session.profile?.identityLinkedBy || "",
        portalNickname: session.profile?.portalNickname || "",
        permissions: session.profile?.permissions || {}
      }
    });
    return;
  }

  if (url.pathname === "/api/meos/data" && req.method === "GET") {
    await sendMeosStoreResponse(req, res, "data.snapshot", {}, async (store) => {
      const snapshot = await store.snapshot();
      return { data: snapshot };
    });
    return;
  }

  if (url.pathname === "/api/meos/people" && req.method === "GET") {
    const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
    const field = url.searchParams.get("field") || "all";
    const limit = url.searchParams.get("limit") || "";
    await sendMeosStoreResponse(req, res, "people.list", { query, field, limit }, async (store) => ({
      people: await store.listPeople({ query, field, limit })
    }));
    return;
  }

  if (url.pathname.startsWith("/api/meos/people/") && req.method === "GET") {
    const value = meosPathParam(url.pathname, "/api/meos/people/");
    await sendMeosStoreResponse(req, res, "people.detail", { value }, async (store) => {
      const person = await store.getPerson(value);
      if (!person) {
        const error = new Error("Persoon niet gevonden.");
        error.status = 404;
        throw error;
      }
      return { person };
    });
    return;
  }

  if (url.pathname.startsWith("/api/meos/people/") && url.pathname.endsWith("/records") && req.method === "POST") {
    const value = meosNestedPathParam(url.pathname, "/api/meos/people/", "/records");
    await sendMeosMutationResponse(req, res, "records.add", { person: value }, async (store, session, body) => {
      return store.addPersonRecord(value, meosRecordFromBody(body, session));
    });
    return;
  }

  if (url.pathname.startsWith("/api/meos/people/") && url.pathname.endsWith("/notes") && req.method === "POST") {
    const value = meosNestedPathParam(url.pathname, "/api/meos/people/", "/notes");
    await sendMeosMutationResponse(req, res, "notes.add", { person: value }, async (store, session, body) => {
      return store.addPersonNote(value, meosNoteFromBody(body, session));
    });
    return;
  }

  if (url.pathname.startsWith("/api/meos/people/") && url.pathname.includes("/records/") && req.method === "DELETE") {
    const { person, entryId } = meosEntryPathParams(url.pathname, "records");
    await sendMeosMutationResponse(req, res, "records.delete", { person, entryId }, async (store) => {
      return store.deletePersonRecord(person, entryId);
    }, {
      readBody: false,
      permission: "canDeleteEntries",
      permissionMessage: "Alleen kader of korpsleiding kan strafbladen verwijderen."
    });
    return;
  }

  if (url.pathname.startsWith("/api/meos/people/") && url.pathname.includes("/notes/") && req.method === "DELETE") {
    const { person, entryId } = meosEntryPathParams(url.pathname, "notes");
    await sendMeosMutationResponse(req, res, "notes.delete", { person, entryId }, async (store) => {
      return store.deletePersonNote(person, entryId);
    }, {
      readBody: false,
      permission: "canDeleteEntries",
      permissionMessage: "Alleen kader of korpsleiding kan notities verwijderen."
    });
    return;
  }

  if (url.pathname.startsWith("/api/meos/people/") && url.pathname.includes("/fines/") && req.method === "DELETE") {
    const { person, entryId } = meosEntryPathParams(url.pathname, "fines");
    await sendMeosMutationResponse(req, res, "fines.delete", { person, entryId }, async (store) => {
      return store.deletePersonFine(person, entryId);
    }, {
      readBody: false,
      permission: "canDeleteEntries",
      permissionMessage: "Alleen kader of korpsleiding kan boetes verwijderen."
    });
    return;
  }

  if (url.pathname === "/api/meos/vehicles" && req.method === "GET") {
    const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
    const limit = url.searchParams.get("limit") || "";
    await sendMeosStoreResponse(req, res, "vehicles.list", { query, limit }, async (store) => ({
      vehicles: await store.listVehicles({ query, limit })
    }));
    return;
  }

  if (url.pathname.startsWith("/api/meos/vehicles/") && req.method === "GET") {
    const value = meosPathParam(url.pathname, "/api/meos/vehicles/");
    await sendMeosStoreResponse(req, res, "vehicles.detail", { value }, async (store) => {
      const vehicle = await store.getVehicle(value);
      if (!vehicle) {
        const error = new Error("Voertuig niet gevonden.");
        error.status = 404;
        throw error;
      }
      return { vehicle };
    });
    return;
  }

  if (url.pathname === "/api/meos/warrants" && req.method === "GET") {
    const limit = url.searchParams.get("limit") || "";
    await sendMeosStoreResponse(req, res, "warrants.list", { limit }, async (store) => ({
      warrants: await store.listWarrants({ limit })
    }));
    return;
  }

  if (url.pathname === "/api/meos/search" && req.method === "GET") {
    const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
    const limit = url.searchParams.get("limit") || "";
    await sendMeosStoreResponse(req, res, "search", { query, limit }, async (store) => ({
      results: await store.search({ query, limit })
    }));
    return;
  }

  if (url.pathname === "/api/meos/session" && req.method === "GET") {
    const session = getMeosSession(req);
    sendJson(res, 200, {
      authenticated: Boolean(session),
      profile: session?.profile || meosFallbackProfile()
    });
    return;
  }

  if (url.pathname === "/api/meos/logout" && req.method === "POST") {
    deleteMeosSession(req);
    writeHeadSecure(res, 204, {
      "Set-Cookie": clearMeosSessionCookie(req)
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/meos/login" && req.method === "GET") {
    if (!discordConfigured()) {
      sendHtml(res, 500, loginPage("Discord of organisatie rollen ontbreken in .env."));
      return;
    }
    const state = crypto.randomBytes(24).toString("hex");
    const redirectUri = meosCallbackUrl(req);
    const returnTo = safeMeosReturnTo(url.searchParams.get("returnTo") || "/dashboard");
    rememberOAuthState(state, {
      redirectUri,
      returnTo,
      surface: "meos",
      meosHomeUrl: meosHomeUrl(req, returnTo)
    });
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.members.read",
      state
    });
    writeHeadSecure(res, 302, {
      Location: `https://discord.com/api/oauth2/authorize?${params}`,
      "Set-Cookie": [
        ...clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_return_to", "orp_overheid_choices"], req),
        authCookie("orp_overheid_state", state, 600, req),
        authCookie("orp_overheid_redirect", redirectUri, 600, req),
        returnToCookie(returnTo, req)
      ]
    });
    res.end();
    return;
  }

  if (url.pathname === "/" && req.method === "GET") {
    const choices = choicesFromCookie(req);
    if (choices.length) {
      const returnTo = returnToFromCookie(req);
      writeHeadSecure(res, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Set-Cookie": clearOverheidCookies(["orp_overheid_choices", "orp_overheid_return_to"], req)
      });
      res.end(choicePage(choices, returnTo));
      return;
    }
    sendHtml(res, 200, loginPage());
    return;
  }

  if (url.pathname === "/api/auth/login" && req.method === "GET") {
    if (isMeosHost(req)) {
      const returnTo = safeMeosReturnTo(url.searchParams.get("returnTo") || "/dashboard");
      writeHeadSecure(res, 302, {
        Location: `/api/meos/login?returnTo=${encodeURIComponent(returnTo)}`
      });
      res.end();
      return;
    }
    if (!discordConfigured()) {
      sendHtml(res, 500, loginPage("Discord of organisatie rollen ontbreken in .env."));
      return;
    }
    const state = crypto.randomBytes(24).toString("hex");
    const redirectUri = callbackUrl(req);
    const returnTo = returnToFromRequest(req, url);
    rememberOAuthState(state, { redirectUri, returnTo });
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.members.read",
      state
    });
    writeHeadSecure(res, 302, {
      Location: `https://discord.com/api/oauth2/authorize?${params}`,
      "Set-Cookie": [
        ...clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_return_to", "orp_overheid_choices"], req),
        authCookie("orp_overheid_state", state, 600, req),
        authCookie("orp_overheid_redirect", redirectUri, 600, req),
        returnToCookie(returnTo, req)
      ]
    });
    res.end();
    return;
  }

  if (url.pathname === "/auth/discord/callback" && req.method === "GET") {
    try {
      const cookies = parseCookies(req);
      const returnedState = url.searchParams.get("state");
      const rememberedState = takeOAuthState(returnedState);
      const expectedState = cookies.orp_overheid_state;
      if (!rememberedState && (!expectedState || expectedState !== returnedState)) {
        writeHeadSecure(res, 400, {
          "Content-Type": "text/html; charset=utf-8",
          "Set-Cookie": clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_return_to", "orp_overheid_choices"], req)
        });
        res.end(loginPage("Discord login sessie klopt niet. Probeer opnieuw."));
        return;
      }
      const returnTo = rememberedState?.returnTo || returnToFromCookie(req);
      const isMeosLogin = rememberedState?.surface === "meos" || isMeosHost(req) || returnTo === "/meos";
      const redirectUri = rememberedState?.redirectUri || (isMeosLogin ? meosCallbackUrl(req) : cookies.orp_overheid_redirect || callbackUrl(req));
      const token = await exchangeCode(url.searchParams.get("code"), redirectUri);
      const user = await getDiscordUser(token.access_token);
      const member = await getGuildMember(token.access_token);
      const roles = new Set(member.roles || []);
      const matches = matchingRoutesForRoles(roleRoutes, roles, user.id);
      const meosMatches = isMeosLogin
        ? matchingRoutesForRoles(meosRoleRoutes, roles, user.id)
        : [];

      if (isMeosLogin && !meosMatches.length) {
        sendHtml(res, 403, loginPage("Geen MEOS-, Defensie- of Politie-rol gevonden op Discord."));
        return;
      }

      if (!isMeosLogin && !matches.length) {
        sendHtml(res, 403, loginPage("Geen Defensie- of Politie-rol gevonden op Discord."));
        return;
      }

      if (isMeosLogin) {
        const profile = await meosProfileForDiscordUser(user, meosMatches, member);
        if (!profile) {
          sendHtml(res, 403, loginPage("Geen actief personeelsprofiel gevonden in Defensie of Politie voor jouw Discord-account."));
          return;
        }
        profile.permissions = meosPermissionsForMember(roles, profile.matchedOrganizations || meosOrganizationPriority(meosMatches), user.id);
        const sessionId = rememberMeosSession(profile);
        writeHeadSecure(res, 302, {
          Location: rememberedState?.meosHomeUrl || meosHomeUrl(req),
          "Set-Cookie": [
            ...clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_return_to", "orp_overheid_choices"], req),
            meosSessionCookie(sessionId, req)
          ]
        });
        res.end();
        return;
      }

      if (matches.length === 1) {
        writeHeadSecure(res, 302, {
          Location: targetPortalUrl(matches[0], returnTo),
          "Set-Cookie": clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_return_to"], req)
        });
        res.end();
        return;
      }

      writeHeadSecure(res, 302, {
        Location: "/",
        "Set-Cookie": [
          ...clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_choices", "orp_overheid_return_to"], req),
          choiceCookie(matches, req),
          returnToCookie(returnTo, req)
        ]
      });
      res.end();
      return;
    } catch (error) {
      console.error("Overheid router Discord login mislukt:", error.message || error);
      sendHtml(res, 500, loginPage("Aanmelden via Discord is mislukt. Controleer callback URL, client secret en rollen."));
      return;
    }
  }

  sendHtml(res, 404, loginPage("Pagina niet gevonden."));
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error("Overheid router fout:", error.message || error);
    sendJson(res, 500, { error: "Interne serverfout" });
  });
});

server.listen(port, () => {
  console.log(`ORP Overheid router draait op ${appBaseUrl}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
