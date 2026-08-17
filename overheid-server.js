const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { createHttpResponder, serveWhitelistedStatic } = require("./modules/http-security");
const { portalIdentityForDiscordId } = require("./modules/side-tasks-portal-identity");

loadEnv();

const port = Number(process.env.OVERHEID_PORT || process.env.PORT || 3020);
const appBaseUrl = process.env.OVERHEID_APP_BASE_URL || `http://localhost:${port}`;
const { writeHeadSecure, sendJson, sendHtml } = createHttpResponder({ appBaseUrl });

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
const meosRoleRoutes = [
  {
    key: "defensie",
    label: "Defensie MEOS",
    roleId: process.env.DISCORD_MEOS_ROLE_ID || process.env.DISCORD_DEFENSIE_MEOS_ROLE_ID || ""
  },
  {
    key: "politie",
    label: "Politie MEOS",
    roleId: process.env.DISCORD_POLITIE_MEOS_ROLE_ID || process.env.DISCORD_POLITIE_ROLE_ID || "1423471185391255705"
  }
];
const INTERNAL_COMPLAINT_RETURN_TO = "/forms/interne-klacht";
const internalComplaintHosts = new Set(["interne-klacht.orpoverheid.nl", "interne-klachten.orpoverheid.nl"]);
const oauthStateTtlMs = 10 * 60 * 1000;
const pendingOAuthStates = new Map();
const meosSessionCookieName = "orp_meos_session";
const meosSessionTtlMs = Number(process.env.MEOS_SESSION_MAX_AGE_SECONDS || 7 * 24 * 60 * 60) * 1000;
const meosSessions = new Map();

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

function serveMeosStatic(req, res, url) {
  const meosStaticPaths = new Set(["/", "/meos", "/meos.html", "/meos.css", "/meos.js"]);
  const isMeosAsset = url.pathname.startsWith("/assets/");
  if (isMeosHost(req)) {
    if (!meosStaticPaths.has(url.pathname) && !isMeosAsset) return false;
  } else if (!["/meos", "/meos.html", "/meos.css", "/meos.js"].includes(url.pathname)) {
    return false;
  }
  const requested = url.pathname === "/" || url.pathname === "/meos" ? "/meos.html" : url.pathname;
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

function meosHomeUrl(req) {
  return `${meosAppBaseUrl(req)}/`;
}

function discordConfigured() {
  return Boolean(
    process.env.DISCORD_CLIENT_ID &&
      process.env.DISCORD_CLIENT_SECRET &&
      process.env.DISCORD_GUILD_ID &&
      (roleRoutes.some((route) => route.roleId) || meosRoleRoutes.some((route) => route.roleId))
  );
}

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function devOverrideIds() {
  return new Set(String(process.env.DEV_OVERRIDE_DISCORD_IDS || "").split(/[,\s]+/).map(normalizeDiscordId).filter(Boolean));
}

function isDevOverride(userId) {
  return devOverrideIds().has(normalizeDiscordId(userId));
}

function matchingRoutesForRoles(routes, roles, userId) {
  return routes.filter((route) => route.roleId && (roles.has(route.roleId) || isDevOverride(userId)));
}

function uniqueRoutesByKey(routes) {
  const seen = new Set();
  return routes.filter((route) => {
    if (seen.has(route.key)) return false;
    seen.add(route.key);
    return true;
  });
}

function discordAvatarUrl(user) {
  if (!user?.id || !user?.avatar) return "/assets/politie-logo.png?v=20260613-form-branding";
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
    serviceNumber: "70-04",
    avatarUrl: discordAvatarUrl(user || {}),
    discordId: normalizeDiscordId(user?.id || ""),
    discordUsername: user?.username || "",
    organizationKey: "overheid"
  };
}

async function meosProfileForDiscordUser(user, matches = []) {
  const identity = await portalIdentityForDiscordId(user?.id);
  const person = identity?.person || {};
  const fallback = meosFallbackProfile(user);
  return {
    name: String(person.name || fallback.name).trim(),
    serviceNumber: String(person.service_number || person.previous_service_number || serviceNumberFromNickname(identity?.nickname) || fallback.serviceNumber).trim(),
    avatarUrl: discordAvatarUrl(user),
    discordId: normalizeDiscordId(user?.id || ""),
    discordUsername: user?.username || "",
    organizationKey: identity?.organizationKey || matches[0]?.key || "overheid"
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

async function handleRequest(req, res) {
  const url = new URL(req.url, requestBaseUrl(req));
  if (req.method === "GET" && serveMeosStatic(req, res, url)) return;

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
    const redirectUri = callbackUrl(req);
    const returnTo = "/meos";
    rememberOAuthState(state, {
      redirectUri,
      returnTo,
      surface: "meos",
      meosHomeUrl: meosHomeUrl(req)
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
      const redirectUri = rememberedState?.redirectUri || cookies.orp_overheid_redirect || callbackUrl(req);
      const returnTo = rememberedState?.returnTo || returnToFromCookie(req);
      const token = await exchangeCode(url.searchParams.get("code"), redirectUri);
      const user = await getDiscordUser(token.access_token);
      const member = await getGuildMember(token.access_token);
      const roles = new Set(member.roles || []);
      const matches = matchingRoutesForRoles(roleRoutes, roles, user.id);
      const isMeosLogin = rememberedState?.surface === "meos" || returnTo === "/meos";
      const meosMatches = isMeosLogin
        ? uniqueRoutesByKey([...matches, ...matchingRoutesForRoles(meosRoleRoutes, roles, user.id)])
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
        const profile = await meosProfileForDiscordUser(user, meosMatches);
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
