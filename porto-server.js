const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { createJsonStorage, createPostgresReadStorage } = require("./storage");
const { createAuthServices } = require("./modules/auth");
const { createDiscordBotServices } = require("./modules/discord-bot");
const { createPermissionServices } = require("./modules/permissions");
const { createPortoRouteHandler } = require("./modules/porto-routes");
const { createPostgresPortoStore } = require("./modules/porto-postgres-store");
const { createPersoneelsportaalDomain } = require("./modules/personeelsportaal-domain");
const { createSessionStore, sessionMaxAgeSeconds } = require("./modules/session-store");
const { createEventBus } = require("./modules/event-bus");
const { createHttpResponder, createJsonBodyReader, serveWhitelistedStatic, shouldRejectMutation } = require("./modules/http-security");
const { createPostgresEventBridge } = require("./modules/postgres-event-bridge");
const { closePool, withClient, databaseNameFromConnectionString } = require("./modules/db");
const { isPersonLoginEligible } = require("./modules/person-status");
const { canUsePortalLogin } = require("./modules/portal-auth-rules");
const {
  currentOrganization,
  organizationMainRoleId,
  portoClientDataScript,
  serviceNumberGroupForRank
} = require("./modules/organizations");

loadEnv();

const root = __dirname;
const organization = currentOrganization();
const dataPath = path.join(root, "data.json");
const storageMode = String(process.env.STORAGE_MODE || "json").toLowerCase();
const storage = storageMode === "postgres" ? createPostgresReadStorage() : createJsonStorage(dataPath);
const { readState, writeState } = storage;
const port = Number(process.env.PORTO_PORT || process.env.PORT || 3002);
const appBaseUrl = process.env.PORTO_APP_BASE_URL || process.env.APP_BASE_URL || `http://localhost:${port}`;
const sessions = createSessionStore();
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const eventBus = createEventBus();
const postgresEventBridge = createPostgresEventBridge({
  enabled: storageMode === "postgres",
  serviceName: "porto",
  publishLocal: publishScopedEvent,
  logError: logServerError
});
const { writeHeadSecure, sendJson, sendHtml } = createHttpResponder({ appBaseUrl });
const readBody = createJsonBodyReader(maxBodyBytes);
const discordBot = createDiscordBotServices();

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
  "DISCORD_GUILD_ID"
];

const {
  parseCookies,
  createSession,
  clearSession,
  authCookie,
  clearAuthCookie,
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
  return requiredDiscordEnv.every((key) => process.env[key]) && Boolean(organizationMainRoleId(organization));
}

function allowDevUnauth() {
  return String(process.env.NODE_ENV || "development").toLowerCase() !== "production"
    && String(process.env.DEV_ALLOW_UNAUTH || "false").toLowerCase() === "true";
}

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function configuredDevDiscordIds() {
  return new Set(String(process.env.DEV_OVERRIDE_DISCORD_IDS || "").split(/[,\s]+/).map(normalizeDiscordId).filter(Boolean));
}

function isDevOverrideDiscordId(discordId) {
  return configuredDevDiscordIds().has(normalizeDiscordId(discordId));
}

function syntheticDevProfile(user) {
  const rank = organization.ranks[0];
  const group = serviceNumberGroupForRank(organization, rank);
  return {
    id: `dev-${normalizeDiscordId(user.id)}`,
    name: user.global_name || user.username || "Dev beheerder",
    discordId: normalizeDiscordId(user.id),
    discordUsername: user.global_name || user.username || "",
    avatar: avatarUrl(user),
    rank,
    serviceNumber: `${group.prefix}-00`,
    permRole: organization.permissionAliases?.kader?.[0] || "Kader",
    extraFunctions: [],
    badges: [],
    completedTrainings: [],
    completedOperational: [],
    status: "Actief",
    rankHistory: [{ rank, date: new Date().toISOString().slice(0, 10), serviceNumber: `${group.prefix}-00` }]
  };
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

function publishScopedEvent(scope, extra = {}) {
  eventBus.publish(`${scope}:update`, { scope, ...extra });
  eventBus.publish("state:update", { scope, ...extra });
}

function requireAuth(req, res) {
  const auth = getLoggedInProfile(req);
  if (!auth) {
    sendJson(res, 401, { error: "Niet ingelogd", loginUrl: "/api/auth/login" });
    return null;
  }
  return auth;
}

function syncProfileFromDiscord(state, profile, user, member, options = {}) {
  const roles = member.roles || [];
  const shouldSyncPermissionRole = options.syncPermissionRole !== false;
  profile.discordUsername = user.global_name || user.username;
  profile.avatar = avatarUrl(user);
  profile.discordRoles = roles;
  profile.lastDiscordSync = new Date().toISOString();
  profile.hasOrganizationRole = roles.includes(organizationMainRoleId(organization));
  profile.hasDefensieRole = profile.hasOrganizationRole;
  profile.permRole = shouldSyncPermissionRole ? resolveSyncedPermRole(profile, roles, state) : (profile.permRole || "Geen");
}

async function persistDiscordProfileSync(state, profile) {
  if (storageMode !== "postgres") {
    await Promise.resolve(writeState(state));
    return;
  }
  await withClient(async (client) => {
    const result = await client.query(`
      update people
      set
        discord_username = $2,
        avatar = $3,
        discord_roles = $4::jsonb,
        perm_role = $5,
        raw = $6::jsonb,
        updated_at = now()
      where id = $1
    `, [
      profile.id,
      profile.discordUsername || "",
      profile.avatar || "",
      JSON.stringify(profile.discordRoles || []),
      profile.permRole || "Geen",
      JSON.stringify(profile)
    ]);
    if (result.rowCount !== 1) {
      throw new Error("Profiel niet gevonden voor Porto Discord sync.");
    }
  });
  afterStorageWrite("people");
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
      clearAuthCookie("orp_oauth_state"),
      clearAuthCookie("orp_oauth_redirect"),
      clearAuthCookie("orp_login_return")
    ]
  });
  res.end();
}

function afterStorageWrite(scope) {
  storage.resetStateCache?.();
  publishScopedEvent(scope);
  postgresEventBridge.notify(scope).catch((error) => logServerError(`Postgres event notify failed for ${scope}`, error));
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
  sendJson,
  discordBot
});

async function healthPayload() {
  const payload = {
    ok: true,
    service: "porto",
    organization: organization.key,
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    storageMode,
    sessions: typeof sessions.size === "function" ? sessions.size() : null,
    eventBridge: postgresEventBridge.status?.() || { enabled: false },
    database: {
      checked: storageMode === "postgres",
      ok: null,
      name: storageMode === "postgres" ? databaseNameFromConnectionString(process.env.DATABASE_URL) || "" : ""
    }
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
        authCookie("orp_oauth_state", state, 600),
        authCookie("orp_oauth_redirect", redirectUri, 600),
        authCookie("orp_login_return", returnTo, 600)
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
      if (parseCookies(req).orp_session) clearSession(req, res);
      sendJson(res, 401, { authenticated: false, loginUrl: "/api/auth/login" });
      return;
    }
    const state = await Promise.resolve(readState());
    let profile = (state.people || []).find((person) => person.id === auth.profile.id && isPersonLoginEligible(person)) || null;
    if (!profile && isDevOverrideDiscordId(auth.profile.discordId)) profile = auth.profile;
    if (!profile) {
      clearSession(req, res);
      sendJson(res, 401, { authenticated: false, loginUrl: "/api/auth/login" });
      return;
    }
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
      const state = await Promise.resolve(readState());
      const loginDiscordId = normalizeDiscordId(user.id);
      const profile = (state.people || []).find((person) => normalizeDiscordId(person.discordId) === loginDiscordId && isPersonLoginEligible(person)) || (isDevOverrideDiscordId(user.id) ? syntheticDevProfile(user) : null);
      if (!profile) {
        redirectWithAuthError(req, res, "no-profile");
        return;
      }
      const hasOrganizationRole = member.roles.includes(organizationMainRoleId(organization));
      const hasPortalLogin = canUsePortalLogin({
        profile,
        discordId: user.id,
        roles: member.roles || [],
        organizationRoleId: organizationMainRoleId(organization),
        devOverride: isDevOverrideDiscordId(user.id)
      });
      if (!hasPortalLogin) {
        redirectWithAuthError(req, res, "no-role");
        return;
      }
      if (!String(profile.id || "").startsWith("dev-")) {
        syncProfileFromDiscord(state, profile, user, member, { syncPermissionRole: hasOrganizationRole });
        await persistDiscordProfileSync(state, profile);
      }
      createSession(res, user, profile, { accessToken: token.access_token, roles: member.roles || [] });
      const sessionCookie = res.getHeader("Set-Cookie");
      res.writeHead(302, {
        Location: safeReturnPath(cookies.orp_login_return || "/"),
        "Set-Cookie": [
          clearAuthCookie("orp_oauth_state"),
          clearAuthCookie("orp_oauth_redirect"),
          clearAuthCookie("orp_login_return"),
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
  if (requested === "/porto-config.js") {
    writeHeadSecure(res, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(portoClientDataScript(organization));
    return;
  }
  const publicRootFiles = new Set(["porto.html", "porto.css", "porto.js", "porto-config.js", "shared.css", "shared-ui.js", "client-guard.js"]);
  serveWhitelistedStatic({
    root,
    requested,
    res,
    writeHeadSecure,
    publicRootFiles,
    isAllowedFeatureScript: (relativePath) => /^porto\/[^/]+\.js$/.test(relativePath)
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, appBaseUrl);
  try {
    if (shouldRejectMutation(req, appBaseUrl)) {
      sendJson(res, 403, { error: "Verzoek geweigerd: ongeldige herkomst." });
      return;
    }
    if (url.pathname.startsWith("/api/") || url.pathname === "/auth/discord/callback") {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    logServerError(`Request failed ${req.method} ${url.pathname}`, error);
    sendJson(res, error.status || 500, { error: error.message });
  }
});

async function startServer() {
  await sessions.load?.();
  await sessions.cleanup?.();
  await postgresEventBridge.start();
  server.listen(port, () => {
    console.log(`${organization.label} Porto-Systeem draait op ${appBaseUrl}`);
    console.log(`Organisatie: ${organization.key}`);
    console.log(`Storage mode: ${storageMode}`);
    if (storageMode === "postgres") console.log(`Database: ${databaseNameFromConnectionString(process.env.DATABASE_URL) || "onbekend"}`);
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
    await postgresEventBridge.stop();
    await closePool();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
