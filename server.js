const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");
const { createJsonStorage, createPostgresReadStorage } = require("./storage");
const { createAuthServices } = require("./modules/auth");
const { createPermissionServices } = require("./modules/permissions");
const { createDiscordWebhookServices } = require("./modules/discord-webhooks");
const { createDiscordBotServices } = require("./modules/discord-bot");
const { createPortoRouteHandler } = require("./modules/porto-routes");
const { createPostgresPortoStore } = require("./modules/porto-postgres-store");
const { createPostgresFormsStore } = require("./modules/personeelsportaal-postgres-forms-store");
const { createPostgresPeopleStore } = require("./modules/personeelsportaal-postgres-people-store");
const { createPersoneelsportaalRouteHandler } = require("./modules/personeelsportaal-routes");
const { createPersoneelsportaalDomain } = require("./modules/personeelsportaal-domain");
const { withClient } = require("./modules/db");

loadEnv();

const root = __dirname;
const dataPath = path.join(root, "data.json");
const storageMode = String(process.env.STORAGE_MODE || "json").toLowerCase();
const storage = storageMode === "postgres" ? createPostgresReadStorage() : createJsonStorage(dataPath);
const { readState, writeState } = storage;
const port = Number(process.env.PORT || 3000);
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const sessions = new Map();
const {
  parseCookies,
  createSession,
  clearSession,
  getLoggedInProfile,
  avatarUrl,
  exchangeCode,
  getDiscordUser,
  getCurrentUserGuildMember
} = createAuthServices({ sessions, readState, discordConfigured, allowDevUnauth });

const {
  ranks,
  profileTrainings,
  profileOperational,
  extraTasks,
  extraFunctions,
  mentorRanks,
  mentorTrainingName,
  mentorChecklistCount,
  disciplineTypes,
  disciplineLabels,
  stateForProfile,
  today,
  formatDate,
  addMonths,
  getAvailableServiceNumbers,
  assignFirstAvailableServiceNumber,
  autoSortServiceNumbers,
  savePerson,
  promotePerson,
  demotePerson,
  normalizeMentorNotes
} = createPersoneelsportaalDomain();
const {
  permissionsForAuth,
  hasPermission,
  hasKaderAccess,
  resolveSyncedPermRole
} = createPermissionServices({ extraFunctions, extraTasks, readState });
const defaultFivemJobs = ["kmar", "defensie", "marechaussee", "koninklijke marechaussee"];
const requiredDiscordEnv = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "DISCORD_GUILD_ID",
  "DISCORD_DEFENSIE_ROLE_ID"
];

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
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

function allowedFivemJobs() {
  return (process.env.FIVEM_ALLOWED_JOBS || defaultFivemJobs.join(","))
    .split(",")
    .map((job) => job.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function isAllowedFivemJob(job) {
  return allowedFivemJobs().includes(String(job || "").trim().toLowerCase());
}

function minutesBetween(start, end) {
  const startedAt = new Date(start);
  const endedAt = new Date(end);
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) return 0;
  return Math.round((endedAt.getTime() - startedAt.getTime()) / 60000);
}

function logServerError(label, error) {
  const message = `[${new Date().toISOString()}] ${label}: ${error?.stack || error?.message || error}\n`;
  fs.appendFile(path.join(root, "server.run.log"), message, () => {});
}

function logAuthDebug(message, details = {}) {
  const safeDetails = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, "_")}`)
    .join(" ");
  const line = `[${new Date().toISOString()}] ${message}${safeDetails ? ` ${safeDetails}` : ""}\n`;
  fs.appendFile(path.join(root, "auth.debug.log"), line, { encoding: "utf8" }, () => {});
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}


function requireAuth(req, res) {
  const auth = getLoggedInProfile(req);
  if (!auth) {
    sendJson(res, 401, {
      error: "Niet ingelogd",
      loginUrl: "/api/auth/login"
    });
    return null;
  }
  return auth;
}

function requireFivemIngest(req, res) {
  const configuredSecret = process.env.FIVEM_INGEST_SECRET;
  if (!configuredSecret) {
    sendJson(res, 503, { error: "FiveM uren koppeling is nog niet geconfigureerd." });
    return false;
  }
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const providedSecret = req.headers["x-personeelsportaal-secret"] || bearerToken;
  if (providedSecret !== configuredSecret) {
    sendJson(res, 401, { error: "Ongeldige FiveM koppeling secret." });
    return false;
  }
  return true;
}

function syncProfileFromDiscord(state, profile, user, member) {
  const roles = member.roles || [];
  const previousRole = profile.permRole || "Geen";
  const nextRole = resolveSyncedPermRole(profile, roles, state);

  profile.discordUsername = user.global_name || user.username;
  profile.avatar = avatarUrl(user);
  profile.discordRoles = roles;
  profile.lastDiscordSync = new Date().toISOString();
  profile.hasDefensieRole = roles.includes(process.env.DISCORD_DEFENSIE_ROLE_ID);
  profile.permRole = nextRole;

  if (previousRole !== nextRole) {
    state.activity = state.activity || [];
    state.activity.push(`${profile.name} perm rol gesynct via Discord: ${previousRole} -> ${nextRole}.`);
  }
}


const {
  sendDiscordWebhook,
  absenceWebhookUrl,
  personnelWebhookUrl,
  buildAbsenceWebhookPayload,
  buildRecruitmentWebhookPayload,
  buildDismissalWebhookPayload,
  buildResignationFormWebhookPayload
} = createDiscordWebhookServices({ formatDate });
// Discord bot-acties blijven centraal: rollen, nicknames en Porto voice verplaatsingen.
const discordBot = createDiscordBotServices();

function sendStateAfterMutation(req, res, auth, state) {
  writeState(state);
  const permissions = permissionsForAuth(auth, state);
  sendJson(res, 200, {
    ok: true,
    state: stateForProfile(state, permissions, auth.profile.id),
    canViewLogbook: permissions.canViewLogbook,
    permissions
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

async function healthPayload() {
  const payload = {
    ok: true,
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


// Porto gebruikt in database-modus een directe PostgreSQL-store; de rest van Defensie Personeelsportaal blijft voorlopig via de centrale storage lopen.
const portoStorage = storageMode === "postgres" ? createPostgresPortoStore({ afterWrite: storage.resetStateCache }) : { readState, writeState };
const handlePortoApi = createPortoRouteHandler({
  requireAuth,
  readState: portoStorage.readState,
  writeState: portoStorage.writeState,
  readBody,
  sendJson
});
// Formulierstromen krijgen in database-modus hun eigen PostgreSQL-pad voor betere gelijktijdigheid.
const formsStorage = storageMode === "postgres" ? createPostgresFormsStore({ afterWrite: storage.resetStateCache }) : { readState, writeState };
// Personeel/profielen krijgen in database-modus ook hun eigen directe PostgreSQL-pad.
const peopleStorage = storageMode === "postgres" ? createPostgresPeopleStore({ afterWrite: storage.resetStateCache }) : { readState, writeState };
const handlePersoneelsportaalApi = createPersoneelsportaalRouteHandler({
  peopleStorage,
  formsStorage,
  requireAuth,
  requireFivemIngest,
  readState,
  writeState,
  readBody,
  sendJson,
  sendStateAfterMutation,
  hasKaderAccess,
  hasPermission,
  permissionsForAuth,
  stateForProfile,
  normalizeDiscordId,
  isAllowedFivemJob,
  minutesBetween,
  today,
  addMonths,
  autoSortServiceNumbers,
  getAvailableServiceNumbers,
  savePerson,
  promotePerson,
  demotePerson,
  assignFirstAvailableServiceNumber,
  normalizeMentorNotes,
  ranks,
  profileTrainings,
  profileOperational,
  extraFunctions,
  extraTasks,
  disciplineTypes,
  disciplineLabels,
  mentorRanks,
  mentorChecklistCount,
  mentorTrainingName,
  sendDiscordWebhook,
  absenceWebhookUrl,
  personnelWebhookUrl,
  buildAbsenceWebhookPayload,
  buildRecruitmentWebhookPayload,
  buildDismissalWebhookPayload,
  buildResignationFormWebhookPayload,
  discordBot
});
function errorPage(title, message) {
  return `<!doctype html>
    <html lang="nl">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d100d;color:#f1f3ed;font-family:Segoe UI,system-ui,sans-serif}
          main{max-width:560px;padding:28px;background:#151914;border:1px solid #30392d;border-radius:8px}
          a{color:#f18424}
        </style>
      </head>
      <body><main><h1>${title}</h1><p>${message}</p><p><a href="/">Terug naar het systeem</a></p></main></body>
    </html>`;
}

function safeReturnPath(value) {
  const returnTo = String(value || "").trim();
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return "/?login=1";
  if (!/^\/[A-Za-z0-9/_?=&.%-]*$/.test(returnTo)) return "/?login=1";
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
  const target = returnTo === "/?login=1" ? "/" : returnTo;
  res.writeHead(302, {
    Location: appendAuthError(target, code),
    "Set-Cookie": [
      "orp_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "orp_oauth_redirect=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
      "orp_login_return=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    ]
  });
  res.end();
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health" && req.method === "GET") {
    const payload = await healthPayload();
    sendJson(res, payload.ok ? 200 : 503, payload);
    return;
  }

  if (url.pathname === "/api/client-error" && req.method === "POST") {
    try {
      const body = await readBody(req);
      logAuthDebug("client-error", { message: body.message, source: body.source, line: body.line, page: body.page });
    } catch (error) {
      logAuthDebug("client-error-log-failed", { message: error.message });
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    sendJson(res, 200, {
      discordConfigured: discordConfigured(),
      devMode: !discordConfigured() && allowDevUnauth()
    });
    return;
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const auth = getLoggedInProfile(req);
    if (!auth) {
      const hasSessionCookie = Boolean(parseCookies(req).orp_session);
      logAuthDebug("auth-me-denied", { hasSessionCookie });
      sendJson(res, 401, {
        authenticated: false,
        loginUrl: "/api/auth/login",
        error: hasSessionCookie ? "Sessie niet gevonden op de server. Log opnieuw in." : "Niet ingelogd"
      });
      return;
    }
    if (!auth.session.dev && !auth.session.accessToken) {
      clearSession(req, res);
      sendJson(res, 401, {
        authenticated: false,
        loginUrl: "/api/auth/login",
        error: "Sessie moet opnieuw aanmelden voor Discord rol-sync"
      });
      return;
    }
    let authState = null;
    if (!auth.session.dev && auth.session.accessToken) {
      try {
        const state = await Promise.resolve(peopleStorage.readState());
        authState = state;
        const profile = (state.people || []).find((person) => person.id === auth.profile.id && person.status === "Actief");
        if (!profile) {
          clearSession(req, res);
          sendJson(res, 401, { authenticated: false, loginUrl: "/api/auth/login" });
          return;
        }
        const syncAgeMs = Date.now() - Number(auth.session.roleSyncedAt || 0);
        const canUseCachedRoles = Array.isArray(auth.session.roles) && auth.session.roles.length && syncAgeMs < 5 * 60 * 1000;
        if (canUseCachedRoles) {
          if (!auth.session.roles.includes(process.env.DISCORD_DEFENSIE_ROLE_ID)) {
            clearSession(req, res);
            sendJson(res, 403, { authenticated: false, error: "Geen Discord gekoppeld" });
            return;
          }
          auth.profile = profile;
        } else {
          const member = await getCurrentUserGuildMember(auth.session.accessToken);
          if (!member.roles.includes(process.env.DISCORD_DEFENSIE_ROLE_ID)) {
            clearSession(req, res);
            sendJson(res, 403, { authenticated: false, error: "Geen Discord gekoppeld" });
            return;
          }
          auth.session.roles = member.roles || [];
          auth.session.roleSyncedAt = Date.now();
          syncProfileFromDiscord(state, profile, auth.session.user, member);
          auth.profile = profile;
          await Promise.resolve(peopleStorage.writeState(state));
        }
      } catch (error) {
        if (error.status === 429 || /rate limit/i.test(error.message || "")) {
          sendJson(res, 429, { authenticated: false, loginUrl: "/api/auth/login", error: "Discord rate limit actief. Wacht even en probeer opnieuw." });
          return;
        }
        clearSession(req, res);
        sendJson(res, 401, { authenticated: false, loginUrl: "/api/auth/login" });
        return;
      }
    }
    const permissionState = authState || await Promise.resolve(peopleStorage.readState());
    const authPermissions = permissionsForAuth(auth, permissionState);
    auth.session.profile = { ...auth.profile };
    sendJson(res, 200, {
      authenticated: true,
      profile: auth.profile,
      canViewLogbook: authPermissions.canViewLogbook,
      permissions: authPermissions,
      devMode: Boolean(auth.session.dev)
    });
    return;
  }

  if (url.pathname === "/api/auth/login" && req.method === "GET") {
    if (!discordConfigured()) {
    sendHtml(res, 500, errorPage("Discord niet ingesteld", "Vul eerst .env met Discord client, guild en rol gegevens."));
      return;
    }
    const returnTo = safeReturnPath(url.searchParams.get("returnTo"));
    const redirectUri = discordRedirectUriForRequest(req);
    const state = crypto.randomBytes(16).toString("hex");
    const loginCookies = [
      `orp_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
      `orp_oauth_redirect=${encodeURIComponent(redirectUri)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`
    ];
    if (returnTo !== "/?login=1") {
      loginCookies.push(`orp_login_return=${encodeURIComponent(returnTo)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);
    }
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify guilds.members.read",
      state
    });
    res.writeHead(302, {
      Location: `https://discord.com/api/oauth2/authorize?${params}`,
      "Set-Cookie": loginCookies
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    clearSession(req, res);
    sendJson(res, 200, { ok: true });
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

      const redirectUri = cookies.orp_oauth_redirect || process.env.DISCORD_REDIRECT_URI;
      const token = await exchangeCode(url.searchParams.get("code"), redirectUri);
      const user = await getDiscordUser(token.access_token);
      const member = await getCurrentUserGuildMember(token.access_token);
      const hasDefensieRole = member.roles.includes(process.env.DISCORD_DEFENSIE_ROLE_ID);
      if (!hasDefensieRole) {
        logAuthDebug("callback-no-role", { userId: user.id });
        redirectWithAuthError(req, res, "no-role");
        return;
      }

      const state = await Promise.resolve(peopleStorage.readState());
      const profile = state.people.find((person) => person.discordId === user.id && person.status === "Actief");
      if (!profile) {
        logAuthDebug("callback-no-profile", { userId: user.id });
        redirectWithAuthError(req, res, "no-profile");
        return;
      }

      syncProfileFromDiscord(state, profile, user, member);
      await Promise.resolve(peopleStorage.writeState(state));
      createSession(res, user, profile, { accessToken: token.access_token, roles: member.roles || [] });
      const sessionCookie = res.getHeader("Set-Cookie");
      logAuthDebug("callback-success", { profileId: profile.id, name: profile.name, hasSessionCookie: Boolean(sessionCookie) });
      res.writeHead(302, {
        Location: safeReturnPath(cookies.orp_login_return),
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

  if (await handlePersoneelsportaalApi(req, res, url) !== false) return;

  sendJson(res, 404, { error: "API route niet gevonden" });
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(root, requested));
  const relativePath = path.relative(root, filePath);
  const isOutsideRoot = relativePath.startsWith("..") || path.isAbsolute(relativePath);
  const normalizedRelative = relativePath.replaceAll("\\", "/");
  const publicRootFiles = new Set(["index.html", "styles.css", "shared.css", "personeelsportaal.css", "porto.css", "app.js", "personeelsportaal-data.js", "porto.html", "porto.js", "shared-ui.js"]);
  const isAsset = normalizedRelative.startsWith("assets/");
  const isFeatureScript = /^(personeelsportaal|porto)\/[^/]+\.js$/.test(normalizedRelative);
  const isPublicRootFile = publicRootFiles.has(normalizedRelative);

  if (isOutsideRoot || (!isPublicRootFile && !isAsset && !isFeatureScript) || path.basename(filePath).startsWith(".")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
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
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, appBaseUrl);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/auth/discord/callback") {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Oranjestad Defensie draait op ${appBaseUrl}`);
  console.log(`Storage mode: ${storageMode}`);
  if (!discordConfigured()) {
    console.log("Discord is nog niet volledig ingesteld. DEV_ALLOW_UNAUTH bepaalt of lokale demo-toegang werkt.");
  }
});



