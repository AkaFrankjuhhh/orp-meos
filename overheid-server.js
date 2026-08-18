const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { createHttpResponder, createJsonBodyReader, serveWhitelistedStatic, shouldRejectMutation } = require("./modules/http-security");
const { portalIdentityForDiscordId, hasPortalIdentityDatabase, portalPersonDisplayName } = require("./modules/side-tasks-portal-identity");
const { createMeosApiRoutes } = require("./modules/meos-api-routes");
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
const defaultMeosDeleteRoleIds = ["1426544463043362937"];
const wetboekApiCache = new Map();

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
    method: req.method,
    path: req.url,
    host: forwardedHost(req),
    ip: meosClientIp(req),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
    actor: {
      name: session?.profile?.name || "",
      rank: session?.profile?.rank || "",
      serviceNumber: session?.profile?.serviceNumber || "",
      discordId: session?.profile?.discordId || "",
      discordUsername: session?.profile?.discordUsername || "",
      organizationKey: session?.profile?.organizationKey || "",
      portalPersonId: session?.profile?.portalPersonId || ""
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
  return ["dashboard", "personen", "voertuigen", "arrestatiebevelen", "databron", "at"].includes(firstSegment);
}

function serveMeosStatic(req, res, url) {
  const meosStaticPaths = new Set(["/", "/meos", "/meos.html", "/meos.css", "/meos.js"]);
  const isMeosAsset = url.pathname.startsWith("/assets/");
  const isMeosFeatureScript = /^\/meos\/(?:[^/]+|pages\/[^/]+)\.js$/.test(url.pathname);
  const isMeosPage = isMeosPageRoute(url.pathname);
  const isMeosShell = ["/", "/meos", "/meos.html"].includes(url.pathname) || isMeosPage;
  if (isMeosHost(req)) {
    if (!meosStaticPaths.has(url.pathname) && !isMeosAsset && !isMeosFeatureScript && !isMeosPage) return false;
    if (isMeosShell && !getMeosSession(req)) {
      writeHeadSecure(res, 302, {
        Location: `/api/meos/login?returnTo=${encodeURIComponent(safeMeosReturnTo(url.pathname))}`
      });
      res.end();
      return true;
    }
  } else if (!["/meos", "/meos.html", "/meos.css", "/meos.js"].includes(url.pathname) && !isMeosFeatureScript) {
    return false;
  }
  const requested = url.pathname === "/" || url.pathname === "/meos" || isMeosPage ? "/meos.html" : url.pathname;
  const publicRootFiles = new Set(["meos.html", "meos.css", "meos.js"]);
  serveWhitelistedStatic({
    root: __dirname,
    requested,
    res,
    writeHeadSecure,
    publicRootFiles,
    isAllowedFeatureScript: (relativePath) => /^meos\/(?:[^/]+|pages\/[^/]+)\.js$/.test(relativePath)
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
  const common = [
    ...defaultMeosDeleteRoleIds,
    ...envIdList("MEOS_DELETE_ROLE_IDS")
  ];
  const key = String(organizationKey || "").trim().toLowerCase();
  if (key === "defensie") {
    return [
      ...common,
      ...envIdList("MEOS_DEFENSIE_DELETE_ROLE_IDS", "DISCORD_KADER_ROLE_ID", "DISCORD_OVJ_ROLE_ID")
    ];
  }
  if (key === "politie") {
    return [
      ...common,
      ...envIdList("MEOS_POLITIE_DELETE_ROLE_IDS", "DISCORD_POLITIE_KORPSLEIDING_ROLE_ID", "DISCORD_POLITIE_OVJ_ROLE_ID")
    ];
  }
  return common;
}

function configuredMeosHealthRoleIds(organizationKey = "") {
  const common = envIdList("MEOS_HEALTH_ROLE_IDS");
  const key = String(organizationKey || "").trim().toLowerCase();
  if (key === "defensie") {
    return [
      ...common,
      ...envIdList("MEOS_DEFENSIE_HEALTH_ROLE_IDS", "DISCORD_KADER_ROLE_ID")
    ];
  }
  if (key === "politie") {
    return [
      ...common,
      ...envIdList("MEOS_POLITIE_HEALTH_ROLE_IDS", "DISCORD_POLITIE_KORPSLEIDING_ROLE_ID")
    ];
  }
  return common;
}

function meosPermissionsForMember(roles, organizations = [], userId = "") {
  const memberRoles = roles instanceof Set ? roles : new Set(roles || []);
  const organizationKeys = organizations.length ? organizations : ["overheid"];
  const deleteRoleIds = new Set(organizationKeys.flatMap((key) => configuredMeosDeleteRoleIds(key)));
  const healthRoleIds = new Set(organizationKeys.flatMap((key) => configuredMeosHealthRoleIds(key)));
  const canDeleteEntries = isDevOverride(userId) || [...deleteRoleIds].some((roleId) => memberRoles.has(roleId));
  const canViewDataHealth = isDevOverride(userId) || [...healthRoleIds].some((roleId) => memberRoles.has(roleId));
  return {
    canViewEntries: true,
    canWriteEntries: true,
    canDeleteEntries,
    canViewAudit: canDeleteEntries,
    canViewDataHealth
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
      canViewEntries: false,
      canWriteEntries: false,
      canDeleteEntries: false,
      canViewAudit: false,
      canViewDataHealth: false
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
    rank: session?.profile?.rank || "",
    serviceNumber: session?.profile?.serviceNumber || "",
    discordId: session?.profile?.discordId || "",
    organizationKey: session?.profile?.organizationKey || "",
    portalPersonId: session?.profile?.portalPersonId || ""
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

function meosArticleSelectionsFromBody(body = {}) {
  const selections = Array.isArray(body.articleSelections) ? body.articleSelections : [];
  return selections.slice(0, 20).map((selection) => ({
    articleId: meosText(selection?.articleId || selection?.id, "Wetboek artikel", { max: 40 }),
    tableIndex: meosText(selection?.tableIndex, "Wetboek tabel", { max: 20 }),
    rowIndex: meosText(selection?.rowIndex, "Wetboek strafregel", { max: 20 }),
    officialInDuty: Boolean(selection?.officialInDuty),
    attempted: Boolean(selection?.attempted)
  })).filter((selection) => selection.articleId);
}

function meosCalculatedTotalsFromBody(body = {}) {
  if (!body.calculatedTotals || typeof body.calculatedTotals !== "object") return null;
  const totals = body.calculatedTotals;
  return {
    fine: meosText(totals.fine, "Berekende boete", { max: 40 }),
    jailMonths: meosText(totals.jailMonths, "Berekende celstraf", { max: 40 }),
    taskHours: meosText(totals.taskHours, "Berekende taakstraf", { max: 40 }),
    drivingBanMonths: meosText(totals.drivingBanMonths, "Berekende rijontzegging", { max: 40 }),
    taskConverted: Boolean(totals.taskConverted)
  };
}

function meosRecordFromBody(body = {}, session = null) {
  return {
    date: meosText(body.date, "Datum", { max: 40, fallback: meosTodayDate() }),
    sanction: meosText(body.sanction, "Sanctie", { max: 80, required: true }),
    verbalist: meosText(body.verbalist, "Verbalisant", { max: 120, fallback: meosActorName(session) }),
    note: meosText(body.note, "Notitie", { max: 2000, required: true }),
    source: meosText(body.source, "Bron", { max: 80 }),
    articleIds: Array.isArray(body.articleIds) ? body.articleIds.map((value) => meosText(value, "Wetboek artikel", { max: 40 })).filter(Boolean).slice(0, 20) : [],
    articleSelections: meosArticleSelectionsFromBody(body),
    calculatedTotals: meosCalculatedTotalsFromBody(body),
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

function meosFineFromBody(body = {}, session = null) {
  return {
    fine: meosText(body.fine || body.title, "Boete", { max: 160, required: true }),
    amount: meosText(body.amount, "Bedrag", { max: 80, required: true }),
    writtenAt: meosText(body.writtenAt || body.date, "Uitgeschreven op", { max: 40, fallback: meosTodayDate() }),
    writtenBy: meosText(body.writtenBy || body.verbalist, "Uitgeschreven door", { max: 120, fallback: meosActorName(session) }),
    articleIds: Array.isArray(body.articleIds) ? body.articleIds.map((value) => meosText(value, "Wetboek artikel", { max: 40 })).filter(Boolean).slice(0, 20) : [],
    createdBy: meosCreatedBy(session)
  };
}

function meosShouldCreateFine(body = {}) {
  return body.createFine === true || String(body.createFine || "").toLowerCase() === "true";
}

function wetboekApiBaseUrl() {
  const configured = String(process.env.MEOS_WETBOEK_API_BASE_URL || "https://wetboek.orpoverheid.nl").trim();
  const baseUrl = new URL(configured || "https://wetboek.orpoverheid.nl");
  if (!["https:", "http:"].includes(baseUrl.protocol)) {
    const error = new Error("MEOS Wetboek API URL moet http of https zijn.");
    error.status = 500;
    throw error;
  }
  return baseUrl.toString().replace(/\/+$/, "");
}

function wetboekApiHeaders() {
  const apiKey = String(process.env.MEOS_WETBOEK_API_KEY || process.env.WETBOEK_MEOS_API_KEY || "").trim();
  return {
    Accept: "application/json",
    ...(apiKey ? { "X-Wetboek-Api-Key": apiKey } : {})
  };
}

async function fetchWetboekApiJson(apiPath) {
  const pathValue = String(apiPath || "/api/meos/articles");
  const cacheTtlMs = Math.max(0, Number(process.env.MEOS_WETBOEK_CACHE_TTL_MS || 5 * 60 * 1000));
  const timeoutMs = Math.max(1000, Number(process.env.MEOS_WETBOEK_TIMEOUT_MS || 8000));
  const cacheKey = pathValue;
  const now = Date.now();
  const cached = wetboekApiCache.get(cacheKey);
  if (cached && cacheTtlMs > 0 && now - cached.cachedAt < cacheTtlMs) return cached.payload;

  const targetUrl = new URL(pathValue, `${wetboekApiBaseUrl()}/`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetUrl, {
      headers: wetboekApiHeaders(),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || "Wetboek API gaf geen geldige JSON terug." };
    }
    if (!response.ok) {
      const error = new Error(payload?.error || payload?.message || `Wetboek API fout ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (cacheTtlMs > 0) wetboekApiCache.set(cacheKey, { cachedAt: now, payload });
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function sendMeosWetboekResponse(req, res, action, details, handler) {
  const session = requireMeosApiSession(req, res);
  if (!session) return true;
  try {
    const payload = await handler(session);
    appendMeosAudit(req, session, action, details);
    sendJson(res, 200, {
      ok: true,
      authenticated: true,
      ...payload
    });
  } catch (error) {
    console.error(`MEOS Wetboek API ${action} mislukt:`, error.message || error);
    sendJson(res, error.status || 502, {
      ok: false,
      error: error.message || "Wetboek data ophalen is mislukt."
    });
  }
  return true;
}

async function sendMeosStoreResponse(req, res, action, details, handler, options = {}) {
  const session = requireMeosApiSession(req, res);
  if (!session) return true;
  try {
    if (options.permission) requireMeosPermission(session, options.permission, options.permissionMessage);
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
      personId: payload.person?.id || "",
      personName: payload.person?.name || "",
      recordId: payload.record?.id || "",
      noteId: payload.note?.id || "",
      fineId: payload.fine?.id || "",
      deletedId: payload.deleted?.id || "",
      deletedType: payload.deleted?.type || "",
      articleIds: payload.record?.articleIds || payload.fine?.articleIds || [],
      calculatedTotals: payload.record?.calculatedTotals || null
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

const { handleMeosApiRoute } = createMeosApiRoutes({
  requireMeosApiSession,
  appendMeosAudit,
  sendJson,
  sendHtml,
  writeHeadSecure,
  getMeosStore,
  meosStoreConfigFromEnv,
  sendMeosStoreResponse,
  sendMeosWetboekResponse,
  sendMeosMutationResponse,
  fetchWetboekApiJson,
  meosPathParam,
  meosNestedPathParam,
  meosEntryPathParams,
  meosRecordFromBody,
  meosShouldCreateFine,
  meosFineFromBody,
  meosNoteFromBody,
  getMeosSession,
  meosFallbackProfile,
  deleteMeosSession,
  clearMeosSessionCookie,
  discordConfigured,
  meosCallbackUrl,
  safeMeosReturnTo,
  rememberOAuthState,
  meosHomeUrl,
  clearOverheidCookies,
  authCookie,
  returnToCookie,
  loginPage
});

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

  if (await handleMeosApiRoute(req, res, url)) return;

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
