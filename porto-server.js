const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { createJsonStorage, createPostgresReadStorage } = require("./storage");
const { createAuthServices } = require("./modules/auth");
const { createPermissionServices } = require("./modules/permissions");
const { createPortoRouteHandler } = require("./modules/porto-routes");
const { createPostgresPortoStore } = require("./modules/porto-postgres-store");
const { createPersoneelsportaalDomain } = require("./modules/personeelsportaal-domain");
const { createSessionStore, sessionMaxAgeSeconds } = require("./modules/session-store");
const { createEventBus } = require("./modules/event-bus");
const { closePool, withClient } = require("./modules/db");

loadEnv();

const root = __dirname;
const dataPath = path.join(root, "data.json");
const storageMode = String(process.env.STORAGE_MODE || "json").toLowerCase();
const storage = storageMode === "postgres" ? createPostgresReadStorage() : createJsonStorage(dataPath);
const { readState, writeState } = storage;
const port = Number(process.env.PORTO_PORT || process.env.PORT || 3002);
const appBaseUrl = process.env.PORTO_APP_BASE_URL || process.env.APP_BASE_URL || `http://localhost:${port}`;
const sessions = createSessionStore();
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const eventBus = createEventBus();
const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const {
  profileTrainings,
  profileOperational,
  extraTasks,
  extraFunctions,
  stateForProfile
} = createPersoneelsportaalDomain();
const {
  permissionsForAuth,
  resolveSyncedPermRole
} = createPermissionServices({ extraFunctions, extraTasks, readState });

const requiredDiscordEnv = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_GUILD_ID",
  "DISCORD_DEFENSIE_ROLE_ID"
];

const {
  parseCookies,
  createSession,
  clearSession,
  getLoggedInProfile,
  avatarUrl,
  exchangeCode,
  getDiscordUser,
  getCurrentUserGuildMember
} = createAuthServices({ sessions, readState, discordConfigured, allowDevUnauth, sessionMaxAgeSeconds });

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

function discordConfigured() {
  return requiredDiscordEnv.every((key) => process.env[key]);
}

function allowDevUnauth() {
  return process.env.DEV_ALLOW_UNAUTH !== "false";
}

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
}

function configuredAppHost() {
  try {
    return new URL(appBaseUrl).host.toLowerCase();
  } catch (error) {
    return "";
  }
}

function isTrustedMutationOrigin(req) {
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const allowedHosts = new Set([requestHost(req), configuredAppHost()].filter(Boolean));
    return allowedHosts.has(originUrl.host.toLowerCase());
  } catch (error) {
    return false;
  }
}

function logServerError(label, error) {
  const message = `[${new Date().toISOString()}] ${label}: ${error?.stack || error?.message || error}\n`;
  fs.appendFile(path.join(root, "porto-server.run.log"), message, () => {});
}

function logAuthDebug(message, details = {}) {
  const safeDetails = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`)
    .join(" ");
  const line = `[${new Date().toISOString()}] porto-${message}${safeDetails ? ` ${safeDetails}` : ""}\n`;
  fs.appendFile(path.join(root, "auth.debug.log"), line, { encoding: "utf8" }, () => {});
}

function securityHeaders(contentType = "") {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin"
  };
  if (appBaseUrl.startsWith("https://")) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  if (contentType.includes("text/html")) {
    headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://cdn.discordapp.com https://*.discordapp.com",
      "connect-src 'self' https://discord.com https://discordapp.com",
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join("; ");
  }
  return headers;
}

function writeHeadSecure(res, status, headers = {}) {
  res.writeHead(status, { ...securityHeaders(headers["Content-Type"] || ""), ...headers });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  writeHeadSecure(res, status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  writeHeadSecure(res, status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function requireAuth(req, res) {
  const auth = getLoggedInProfile(req);
  if (!auth) {
    sendJson(res, 401, { error: "Niet ingelogd", loginUrl: "/api/auth/login" });
    return null;
  }
  return auth;
}

async function readRawBody(req, limitBytes) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > limitBytes) {
      const error = new Error("Request body is te groot.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const buffer = await readRawBody(req, maxBodyBytes);
  const body = buffer.toString("utf8");
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    const parseError = new Error("Ongeldige JSON body.");
    parseError.status = 400;
    throw parseError;
  }
}

function syncProfileFromDiscord(state, profile, user, member) {
  const roles = member.roles || [];
  profile.discordUsername = user.global_name || user.username;
  profile.avatar = avatarUrl(user);
  profile.discordRoles = roles;
  profile.lastDiscordSync = new Date().toISOString();
  profile.hasDefensieRole = roles.includes(process.env.DISCORD_DEFENSIE_ROLE_ID);
  profile.permRole = resolveSyncedPermRole(profile, roles, state);
}

function errorPage(title, message) {
  return `<!doctype html>
    <html lang="nl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:Segoe UI,system-ui,sans-serif}
          main{max-width:560px;padding:28px;background:#182235;border:1px solid #334155;border-radius:12px}
          a{color:#f59e0b}
        </style>
      </head>
      <body><main><h1>${title}</h1><p>${message}</p><p><a href="/">Terug naar Porto</a></p></main></body>
    </html>`;
}

function safeReturnPath(value) {
  const returnTo = String(value || "").trim();
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return "/";
  if (!/^\/[A-Za-z0-9/_?=&.%-]*$/.test(returnTo)) return "/";
  return returnTo;
}

function appendAuthError(returnTo, code) {
  const separator = returnTo.includes("?") ? "&" : "?";
  return `${returnTo}${separator}authError=${encodeURIComponent(code)}`;
}

function requestOriginForAuth(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || new URL(appBaseUrl).host;
  return `${proto}://${host}`;
}

function discordRedirectUriForRequest(req) {
  return `${requestOriginForAuth(req)}/auth/discord/callback`;
}

function redirectWithAuthError(req, res, code) {
  const cookies = parseCookies(req);
  const returnTo = safeReturnPath(cookies.orp_login_return || "/");
  res.writeHead(302, {
    Location: appendAuthError(returnTo, code),
    "Set-Cookie": [
      "orp_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "orp_oauth_redirect=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "orp_login_return=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    ]
  });
  res.end();
}

function afterStorageWrite(scope) {
  storage.resetStateCache?.();
  eventBus.publish(`${scope}:update`, { scope });
  eventBus.publish("state:update", { scope });
}

const portoStorage = storageMode === "postgres" ? createPostgresPortoStore({ afterWrite: () => afterStorageWrite("porto") }) : { readState, writeState };
const handlePortoApi = createPortoRouteHandler({
  requireAuth,
  readState: portoStorage.readState,
  writeState: portoStorage.writeState,
  writePortoSettings: portoStorage.writePortoSettings,
  writePortoPhone: portoStorage.writePortoPhone,
  writePortoUnits: portoStorage.writePortoUnits,
  readBody,
  sendJson
});

async function healthPayload() {
  const payload = {
    ok: true,
    service: "porto",
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    storageMode,
    database: { checked: storageMode === "postgres", ok: null }
  };
  if (storageMode === "postgres") {
    try {
      await withClient((client) => client.query("select 1"));
      payload.database.ok = true;
    } catch (error) {
      payload.ok = false;
      payload.status = "degraded";
      payload.database.ok = false;
      payload.database.error = "PostgreSQL niet bereikbaar";
    }
  }
  return payload;
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, await healthPayload());
    return;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    eventBus.addClient(req, res, auth.profile);
    return;
  }

  if (url.pathname === "/api/auth/login" && req.method === "GET") {
    if (!discordConfigured()) {
      sendHtml(res, 500, errorPage("Discord niet ingesteld", "Vul eerst .env met Discord client, guild en rol gegevens."));
      return;
    }
    const returnTo = safeReturnPath(url.searchParams.get("returnTo") || "/");
    const redirectUri = discordRedirectUriForRequest(req);
    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.members.read",
      state
    });
    res.writeHead(302, {
      Location: `https://discord.com/api/oauth2/authorize?${params}`,
      "Set-Cookie": [
        `orp_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
        `orp_oauth_redirect=${encodeURIComponent(redirectUri)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
        `orp_login_return=${encodeURIComponent(returnTo)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`
      ]
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    clearSession(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const auth = getLoggedInProfile(req);
    if (!auth) {
      sendJson(res, 401, { authenticated: false, loginUrl: "/api/auth/login" });
      return;
    }
    const state = await Promise.resolve(readState());
    const profile = (state.people || []).find((person) => person.id === auth.profile.id && person.status === "Actief") || auth.profile;
    auth.profile = profile;
    auth.session.profile = { ...profile };
    if (!auth.session.dev && typeof sessions.save === "function") sessions.save(auth.session.id, auth.session);
    sendJson(res, 200, {
      authenticated: true,
      profile,
      permissions: permissionsForAuth(auth, state),
      devMode: Boolean(auth.session.dev)
    });
    return;
  }

  if (["/api/auth/callback", "/auth/discord/callback"].includes(url.pathname) && req.method === "GET") {
    try {
      const cookies = parseCookies(req);
      const expectedState = cookies.orp_oauth_state;
      logAuthDebug("callback-start", { hasState: Boolean(expectedState), hasCode: Boolean(url.searchParams.get("code")) });
      if (!expectedState || expectedState !== url.searchParams.get("state")) {
        sendHtml(res, 400, errorPage("Login geweigerd", "De Discord login sessie klopt niet. Probeer opnieuw in te loggen."));
        return;
      }
      const redirectUri = cookies.orp_oauth_redirect || discordRedirectUriForRequest(req);
      const token = await exchangeCode(url.searchParams.get("code"), redirectUri);
      const user = await getDiscordUser(token.access_token);
      const member = await getCurrentUserGuildMember(token.access_token);
      if (!member.roles.includes(process.env.DISCORD_DEFENSIE_ROLE_ID)) {
        redirectWithAuthError(req, res, "no-role");
        return;
      }
      const state = await Promise.resolve(readState());
      const profile = (state.people || []).find((person) => person.discordId === user.id && person.status === "Actief");
      if (!profile) {
        redirectWithAuthError(req, res, "no-profile");
        return;
      }
      syncProfileFromDiscord(state, profile, user, member);
      await Promise.resolve(writeState(state));
      createSession(res, user, profile, { accessToken: token.access_token, roles: member.roles || [] });
      const sessionCookie = res.getHeader("Set-Cookie");
      res.writeHead(302, {
        Location: safeReturnPath(cookies.orp_login_return || "/"),
        "Set-Cookie": [
          "orp_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
          "orp_oauth_redirect=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
          "orp_login_return=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
          ...(Array.isArray(sessionCookie) ? sessionCookie : [sessionCookie].filter(Boolean))
        ]
      });
      res.end();
    } catch (error) {
      logServerError("Discord login failed", error);
      redirectWithAuthError(req, res, (error.status === 429 || /rate limit/i.test(error.message || "")) ? "rate-limited" : "login-failed");
    }
    return;
  }

  if (await handlePortoApi(req, res, url)) return;
  sendJson(res, 404, { error: "Porto API route niet gevonden" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/porto.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));
  const relativePath = path.relative(root, filePath);
  const normalizedRelative = relativePath.replaceAll("\\", "/");
  const isOutsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);
  const publicRootFiles = new Set(["porto.html", "porto.css", "porto.js", "shared.css", "shared-ui.js"]);
  const isAsset = normalizedRelative.startsWith("assets/");
  const isFeatureScript = /^porto\/[^/]+\.js$/.test(normalizedRelative);
  const isPublicRootFile = publicRootFiles.has(normalizedRelative);
  if (isOutsideRoot || (!isPublicRootFile && !isAsset && !isFeatureScript) || path.basename(filePath).startsWith(".")) {
    writeHeadSecure(res, 403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      writeHeadSecure(res, 404);
      res.end("Not found");
      return;
    }
    const extension = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml; charset=utf-8"
    }[extension] || "application/octet-stream";
    writeHeadSecure(res, 200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, appBaseUrl);
  try {
    if (stateChangingMethods.has(req.method) && !isTrustedMutationOrigin(req)) {
      sendJson(res, 403, { error: "Verzoek geweigerd: ongeldige herkomst." });
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/auth/discord/callback") {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, error.status || 500, { error: error.message });
  }
});

async function startServer() {
  await sessions.load?.();
  await sessions.cleanup?.();
  server.listen(port, () => {
    console.log(`Porto-Systeem draait op ${appBaseUrl}`);
    console.log(`Storage mode: ${storageMode}`);
    console.log(`Actieve sessies geladen: ${typeof sessions.size === "function" ? sessions.size() : "onbekend"}`);
  });
}

startServer().catch((error) => {
  logServerError("Porto server start failed", error);
  console.error(error);
  process.exit(1);
});

async function shutdown() {
  try {
    await closePool();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
