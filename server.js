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
const { createPostgresFormsStore } = require("./modules/personeelsportaal-postgres-forms-store");
const { createPostgresPeopleStore } = require("./modules/personeelsportaal-postgres-people-store");
const { createMentorTestsStore } = require("./modules/mentor-tests-store");
const { createPersoneelsportaalRouteHandler } = require("./modules/personeelsportaal-routes");
const { createPersoneelsportaalDomain } = require("./modules/personeelsportaal-domain");
const { withClient, closePool, databaseNameFromConnectionString } = require("./modules/db");
const { createSessionStore, sessionMaxAgeSeconds } = require("./modules/session-store");
const { createEventBus } = require("./modules/event-bus");
const { createHttpResponder, createJsonBodyReader, readRawBody, serveWhitelistedStatic, shouldRejectMutation } = require("./modules/http-security");
const { createPostgresEventBridge } = require("./modules/postgres-event-bridge");
const { createPublicFormsStore } = require("./modules/public-forms-store");
const { startPortoDutyHoursJob } = require("./modules/porto-duty-hours-job");
const { enqueuePersonDiscordSync, enqueueDiscordSyncJob } = require("./modules/discord-sync-jobs");
const { normalizeDiscordId, isDevDiscordId } = require("./modules/ovc");
const { isPersonLoginEligible } = require("./modules/person-status");
const {
  currentOrganization,
  organizationMainRoleId,
  clientDataScript,
  portoClientDataScript,
  serviceNumberGroupForRank
} = require("./modules/organizations");
const {
  publicFormForRequest,
  publicFormFromSlug,
  publicFormClientConfig,
  applyProfileAnswersToPublicForm,
  validatePublicFormSubmission,
  createPublicFormSubmission,
  formatCaseNumber,
  isComplaintForm,
  publicFormWebhookUrl,
  buildPublicFormWebhookPayload,
  mergePublicFormConfig,
  sanitizePublicFormOverride,
  canManagePublicForm
} = require("./modules/public-forms");

loadEnv();

function enabledFromEnv(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "nee", "no", "off"].includes(String(value).trim().toLowerCase());
}

function intervalMsFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 60000 ? parsed : fallback;
}

const root = __dirname;
const organization = currentOrganization();
const dataPath = path.join(root, "data.json");
const storageMode = String(process.env.STORAGE_MODE || "json").toLowerCase();
const storage = storageMode === "postgres" ? createPostgresReadStorage() : createJsonStorage(dataPath);
const { readState, writeState } = storage;
const port = Number(process.env.PORT || 3000);
const appBaseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;
const portoBaseUrl = process.env.PORTO_APP_BASE_URL || "https://porto.orpdefensie.nl";
const sessions = createSessionStore();
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 1024 * 1024);
const publicFormMaxBodyBytes = Number(process.env.PUBLIC_FORM_MAX_BODY_BYTES || 9 * 1024 * 1024);
const publicFormMaxFileBytes = Number(process.env.PUBLIC_FORM_MAX_FILE_BYTES || 8 * 1024 * 1024);
const eventBus = createEventBus();
const postgresEventBridge = createPostgresEventBridge({
  enabled: storageMode === "postgres",
  serviceName: "portal",
  publishLocal: publishScopedEvent,
  logError: logServerError
});
let portoDutyHoursJob = null;
const publicFormRateLimit = new Map();
const { writeHeadSecure, sendJson, sendHtml } = createHttpResponder({ appBaseUrl });
const readBody = createJsonBodyReader(maxBodyBytes);
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

const {
  ranks,
  profileTrainings,
  profileOperational,
  extraTasks,
  extraFunctions,
  mentorRanks,
  mentorTrainingName,
  mentorChecklistCount,
  defaultRecruitRank,
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
const requiredDiscordEnv = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_REDIRECT_URI",
  "DISCORD_GUILD_ID"
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
  return requiredDiscordEnv.every((key) => process.env[key]) && Boolean(organizationMainRoleId(organization));
}

function allowDevUnauth() {
  return String(process.env.NODE_ENV || "development").toLowerCase() !== "production"
    && String(process.env.DEV_ALLOW_UNAUTH || "false").toLowerCase() === "true";
}


function isDevOverrideDiscordId(discordId) {
  return isDevDiscordId(discordId);
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
    rankHistory: [{ rank, date: today(), serviceNumber: `${group.prefix}-00` }]
  };
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

function publishScopedEvent(scope, extra = {}) {
  eventBus.publish(`${scope}:update`, { scope, ...extra });
  eventBus.publish("state:update", { scope, ...extra });
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


function syncProfileFromDiscord(state, profile, user, member) {
  const roles = member.roles || [];
  const previousRole = profile.permRole || "Geen";
  const nextRole = resolveSyncedPermRole(profile, roles, state);

  profile.discordUsername = user.global_name || user.username;
  profile.avatar = avatarUrl(user);
  profile.discordRoles = roles;
  profile.lastDiscordSync = new Date().toISOString();
  profile.hasOrganizationRole = roles.includes(organizationMainRoleId(organization));
  profile.hasDefensieRole = profile.hasOrganizationRole;
  profile.permRole = nextRole;

  if (previousRole !== nextRole) {
    state.activity = state.activity || [];
    state.activity.push(`${profile.name} perm rol gesynct via Discord: ${previousRole} -> ${nextRole}.`);
  }
}


const {
  sendDiscordWebhook,
  sendDiscordWebhookWithMessageThread,
  absenceWebhookUrl,
  personnelWebhookUrl,
  buildAbsenceWebhookPayload,
  buildRecruitmentWebhookPayload,
  buildDismissalWebhookPayload,
  buildResignationFormWebhookPayload,
  buildBlacklistWebhookPayload,
  buildInvestigationWebhookPayload
} = createDiscordWebhookServices({ formatDate });
// Discord bot-acties blijven centraal: rollen, nicknames en Porto voice verplaatsingen.
const discordBot = createDiscordBotServices();

function mentorTestWebhookUrl() {
  const orgKey = String(organization?.key || "").toUpperCase();
  return process.env[`DISCORD_${orgKey}_MENTOR_TOETS_WEBHOOK_URL`] || process.env.DISCORD_MENTOR_TOETS_WEBHOOK_URL || "";
}

function buildMentorTestWebhookPayload(event, { person, actor, test } = {}) {
  const labels = {
    sent: "Toets klaargezet",
    resent: "Toets opnieuw verstuurd",
    submitted: "Toets ingediend",
    approved: "Toets goedgekeurd",
    rejected: "Toets afgekeurd",
    retracted: "Toets teruggetrokken"
  };
  const colors = {
    sent: 0xf59e0b,
    resent: 0xf97316,
    submitted: 0x3b82f6,
    approved: 0x22c55e,
    rejected: 0xef4444,
    retracted: 0x94a3b8
  };
  const label = labels[event] || "Mentor-toets";
  const serviceNumber = person?.serviceNumber || test?.serviceNumber || "";
  const fields = [
    {
      name: "Medewerker",
      value: `${person?.name || test?.personName || "Onbekend"}${serviceNumber ? ` (${serviceNumber})` : ""}`,
      inline: false
    },
    { name: "Status", value: label, inline: true },
    { name: "Door", value: actor?.name || test?.reviewedByName || test?.sentByName || "-", inline: true }
  ];
  if (test?.submittedAt) fields.push({ name: "Ingediend op", value: formatDate(test.submittedAt), inline: true });
  return {
    username: "Mentor-Toets",
    embeds: [
      {
        title: `Mentor-Toets - ${label}`,
        color: colors[event] || 0x94a3b8,
        fields,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

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

function parseMultipartDisposition(value = "") {
  const result = {};
  for (const part of value.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawValue.length) continue;
    result[rawKey.toLowerCase()] = rawValue.join("=").trim().replace(/^"|"$/g, "");
  }
  return result;
}

function sanitizeUploadFilename(filename) {
  return String(filename || "bijlage")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, 120) || "bijlage";
}

function parseMultipartForm(buffer, contentType) {
  const boundary = String(contentType || "").match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i)?.[1] || String(contentType || "").match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i)?.[2];
  if (!boundary) {
    const error = new Error("Multipart boundary ontbreekt.");
    error.status = 400;
    throw error;
  }

  const fields = {};
  const files = [];
  const raw = buffer.toString("binary");
  const parts = raw.split(`--${boundary}`).slice(1, -1);

  for (let part of parts) {
    if (part.startsWith("\r\n")) part = part.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2);
    const separator = part.indexOf("\r\n\r\n");
    if (separator === -1) continue;

    const headerText = part.slice(0, separator);
    const contentBinary = part.slice(separator + 4);
    const headers = new Map();
    for (const line of headerText.split("\r\n")) {
      const index = line.indexOf(":");
      if (index === -1) continue;
      headers.set(line.slice(0, index).toLowerCase(), line.slice(index + 1).trim());
    }

    const disposition = parseMultipartDisposition(headers.get("content-disposition") || "");
    if (!disposition.name) continue;

    if (disposition.filename) {
      const fileBuffer = Buffer.from(contentBinary, "binary");
      if (!fileBuffer.length) continue;
      files.push({
        fieldName: disposition.name,
        filename: sanitizeUploadFilename(disposition.filename),
        contentType: headers.get("content-type") || "application/octet-stream",
        size: fileBuffer.length,
        buffer: fileBuffer
      });
    } else {
      fields[disposition.name] = Buffer.from(contentBinary, "binary").toString("utf8");
    }
  }

  return { fields, files };
}


function hasAllowedImageSignature(file) {
  const buffer = file?.buffer || Buffer.alloc(0);
  const type = String(file?.contentType || "").toLowerCase();
  if (type === "image/png") return buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (type === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (type === "image/webp") return buffer.length >= 12 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP";
  return false;
}
function validatePublicFormFiles(config, files = []) {
  const errors = [];
  const fileQuestions = new Set((config.questions || []).filter((question) => question.type === "file").map((question) => question.id));
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  const cleanFiles = [];

  for (const file of files || []) {
    if (!fileQuestions.has(file.fieldName)) continue;
    if (cleanFiles.length >= 1) {
      errors.push("Je kan maximaal 1 bijlage meesturen.");
      break;
    }
    if (file.size > publicFormMaxFileBytes) {
      errors.push(`Bijlage is te groot. Maximaal ${Math.round(publicFormMaxFileBytes / 1024 / 1024)} MB.`);
      continue;
    }
    const extension = path.extname(file.filename || "").toLowerCase();
    if (!allowedTypes.has(file.contentType) || !allowedExtensions.has(extension) || !hasAllowedImageSignature(file)) {
      errors.push("Dit bestandstype is niet toegestaan. Gebruik alleen een foto: PNG, JPG/JPEG of WebP.");
      continue;
    }
    cleanFiles.push(file);
  }

  return { cleanFiles, errors };
}

async function readPublicFormSubmitBody(req) {
  const contentType = String(req.headers["content-type"] || "");
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    const { fields, files } = parseMultipartForm(await readRawBody(req, publicFormMaxBodyBytes), contentType);
    return {
      slug: fields.slug || "",
      answers: fields.answers ? JSON.parse(fields.answers) : {},
      files
    };
  }
  return { ...(await readBody(req)), files: [] };
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


function afterStorageWrite(scope) {
  storage.resetStateCache?.();
  publishScopedEvent(scope);
  postgresEventBridge.notify(scope).catch((error) => logServerError(`Postgres event notify failed for ${scope}`, error));
}
// Formulierstromen krijgen in database-modus hun eigen PostgreSQL-pad voor betere gelijktijdigheid.
const formsStorage = storageMode === "postgres" ? createPostgresFormsStore({ afterWrite: () => afterStorageWrite("forms") }) : { readState, writeState };
// Personeel/profielen krijgen in database-modus ook hun eigen directe PostgreSQL-pad.
const peopleStorage = storageMode === "postgres" ? createPostgresPeopleStore({ afterWrite: () => afterStorageWrite("people") }) : { readState, writeState };
const publicFormsStore = createPublicFormsStore({ storageMode, readState, writeState, afterWrite: () => afterStorageWrite("public-forms") });
const mentorTestsStore = storageMode === "postgres" ? createMentorTestsStore() : null;
const handlePersoneelsportaalApi = createPersoneelsportaalRouteHandler({
  peopleStorage,
  formsStorage,
  requireAuth,
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
  defaultRecruitRank,
  sendDiscordWebhook,
  absenceWebhookUrl,
  personnelWebhookUrl,
  buildAbsenceWebhookPayload,
  buildRecruitmentWebhookPayload,
  buildDismissalWebhookPayload,
  buildResignationFormWebhookPayload,
  buildBlacklistWebhookPayload,
  buildInvestigationWebhookPayload,
  mentorTestsStore,
  mentorTestWebhookUrl,
  buildMentorTestWebhookPayload,
  discordBot,
  enqueuePersonDiscordSync: storageMode === "postgres" ? enqueuePersonDiscordSync : null,
  enqueueDiscordSyncJob: storageMode === "postgres" ? enqueueDiscordSyncJob : null
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

function publicFormRateLimitKey(req, slug) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  return `${slug}:${ip}`;
}

function publicFormRateLimitAllows(req, slug) {
  const key = publicFormRateLimitKey(req, slug);
  const now = Date.now();
  const recent = (publicFormRateLimit.get(key) || []).filter((timestamp) => now - timestamp < 10 * 60 * 1000);
  if (recent.length >= 5) {
    publicFormRateLimit.set(key, recent);
    return false;
  }
  recent.push(now);
  publicFormRateLimit.set(key, recent);
  return true;
}

function publicFormLoginUrl(config) {
  const base = String(process.env.APP_BASE_URL || appBaseUrl || "").replace(/\/$/, "") || "";
  return `${base}/api/auth/login?returnTo=/forms/${encodeURIComponent(config.slug)}`;
}


async function resolvePublicFormConfig(baseConfig) {
  if (!baseConfig) return null;
  const override = await publicFormsStore.readConfigOverride?.(baseConfig.slug);
  return mergePublicFormConfig(baseConfig, override || {});
}

function sendPublicFormWebhookInBackground(config, submission, files = []) {
  Promise.resolve().then(async () => {
    let webhookResult;
    try {
      const webhookUrl = publicFormWebhookUrl(config);
      const payload = buildPublicFormWebhookPayload(config, submission);
      webhookResult = isComplaintForm(config)
        ? await sendDiscordWebhookWithMessageThread(webhookUrl, payload, files, `zaaknummer ${formatCaseNumber(submission.caseNumber)}`)
        : await sendDiscordWebhook(webhookUrl, payload, files);
    } catch (error) {
      logServerError(`Public form webhook failed for ${config.slug}`, error);
      webhookResult = { ok: false, status: "error", error: error.message || "webhook failed" };
    }
    if (webhookResult && !webhookResult.ok && !webhookResult.skipped) {
      logServerError(`Public form webhook rejected for ${config.slug}`, new Error(`status=${webhookResult.status || "unknown"} body=${webhookResult.body || webhookResult.error || ""}`));
    }
    if (isComplaintForm(config) && webhookResult?.ok && webhookResult.thread && !webhookResult.thread.ok && !webhookResult.thread.skipped) {
      logServerError(`Public form complaint thread failed for ${submission.caseNumber || submission.id}`, new Error(`status=${webhookResult.thread.status || "unknown"} body=${webhookResult.thread.body || webhookResult.thread.error || ""}`));
    }
    try {
      await publicFormsStore.saveSubmission(submission, webhookResult);
    } catch (error) {
      logServerError(`Public form webhook status save failed for ${config.slug}`, error);
    }
  });
}

function requirePublicFormAccess(req, res, config) {
  if (!config?.internalOnly) return { profile: null, session: null };
  const auth = getLoggedInProfile(req);
  if (auth) return auth;
  sendJson(res, 401, {
    error: "Dit is een intern formulier. Log in met Discord om dit formulier te openen.",
    loginUrl: publicFormLoginUrl(config)
  });
  return null;
}

async function handlePublicFormsApi(req, res, url) {
  if (!url.pathname.startsWith("/api/public-forms/")) return false;

  if (url.pathname === "/api/public-forms/config" && req.method === "GET") {
    const baseConfig = publicFormForRequest(req, url);
    if (!baseConfig) {
      sendJson(res, 404, { error: "Formulier niet gevonden" });
      return true;
    }
    const config = await resolvePublicFormConfig(baseConfig);
    const formAuth = requirePublicFormAccess(req, res, config);
    if (!formAuth) return true;
    sendJson(res, 200, publicFormClientConfig(config, formAuth.profile));
    return true;
  }

  if (url.pathname === "/api/public-forms/config" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return true;
    const body = await readBody(req);
    const baseConfig = publicFormFromSlug(body.slug) || publicFormForRequest(req, url);
    if (!baseConfig) {
      sendJson(res, 404, { error: "Formulier niet gevonden" });
      return true;
    }
    const currentConfig = await resolvePublicFormConfig(baseConfig);
    const state = await Promise.resolve(peopleStorage.readState());
    const profile = (state.people || []).find((person) => person.id === auth.profile.id) || auth.profile;
    if (!canManagePublicForm(profile, currentConfig)) {
      sendJson(res, 403, { error: "Je hebt geen leidingrechten voor dit formulier." });
      return true;
    }
    const override = sanitizePublicFormOverride(baseConfig, body.config || {});
    await publicFormsStore.saveConfigOverride(baseConfig.slug, override, profile);
    const updatedConfig = mergePublicFormConfig(baseConfig, override);
    sendJson(res, 200, { ok: true, config: publicFormClientConfig(updatedConfig, profile) });
    return true;
  }

  if (url.pathname === "/api/public-forms/submit" && req.method === "POST") {
    const body = await readPublicFormSubmitBody(req);
    const baseConfig = publicFormFromSlug(body.slug) || publicFormForRequest(req, url);
    if (!baseConfig) {
      sendJson(res, 404, { error: "Formulier niet gevonden" });
      return true;
    }
    const config = await resolvePublicFormConfig(baseConfig);
    const formAuth = requirePublicFormAccess(req, res, config);
    if (!formAuth) return true;
    if (!publicFormRateLimitAllows(req, config.slug)) {
      sendJson(res, 429, { error: "Te veel inzendingen achter elkaar. Probeer het later opnieuw." });
      return true;
    }
    const fileValidation = validatePublicFormFiles(config, body.files || []);
    if (fileValidation.errors.length) {
      sendJson(res, 400, { error: fileValidation.errors[0], errors: fileValidation.errors });
      return true;
    }
    const profileAnswers = applyProfileAnswersToPublicForm(config, body.answers || {}, formAuth.profile);
    const { cleanAnswers, errors } = validatePublicFormSubmission(config, profileAnswers, fileValidation.cleanFiles);
    if (errors.length) {
      sendJson(res, 400, { error: errors[0], errors });
      return true;
    }
    const submission = createPublicFormSubmission(config, cleanAnswers, req, fileValidation.cleanFiles, formAuth.profile);
    // Sla elke inzending eerst op. Zo verdwijnt een sollicitatie niet als Discord/webhook tijdelijk faalt.
    await publicFormsStore.saveSubmission(submission, { pending: true });
    sendPublicFormWebhookInBackground(config, submission, fileValidation.cleanFiles);
    sendJson(res, 200, { ok: true, id: submission.id, caseNumber: submission.caseNumber || null, webhook: "pending" });
    return true;
  }

  sendJson(res, 404, { error: "Publieke formulierroute niet gevonden" });
  return true;
}
function redirectWithAuthError(req, res, code) {
  const cookies = parseCookies(req);
  const returnTo = safeReturnPath(cookies.orp_login_return || "/");
  const target = returnTo === "/?login=1" ? "/" : returnTo;
  res.writeHead(302, {
    Location: appendAuthError(target, code),
    "Set-Cookie": [
      clearAuthCookie("orp_oauth_state"),
      clearAuthCookie("orp_oauth_redirect"),
      clearAuthCookie("orp_login_return")
    ]
  });
  res.end();
}

function redirectToPorto(res, targetPath = "/porto.html") {
  const safePath = String(targetPath || "/porto.html").startsWith("/") ? targetPath : "/porto.html";
  res.writeHead(302, { Location: `${portoBaseUrl.replace(/\/$/, "")}${safePath}` });
  res.end();
}

function requestHostname(req) {
  return String(req.headers.host || "").split(":")[0].trim().toLowerCase();
}

function redirectPublicFormAlias(req, res, url) {
  const host = requestHostname(req);
  const canonicalDomain = process.env.OVERHEID_PUBLIC_FORM_DOMAIN || "orpoverheid.nl";
  const aliases = {
    "klachten.orpdefensie.nl": `https://klachten.${canonicalDomain}`,
    "klachten.orppolitie.nl": `https://klachten.${canonicalDomain}`,
    "interne-klacht.orpdefensie.nl": `https://interne-klacht.${canonicalDomain}`,
    "interne-klachten.orpdefensie.nl": `https://interne-klacht.${canonicalDomain}`,
    "interne-klacht.orppolitie.nl": `https://interne-klacht.${canonicalDomain}`,
    "interne-klachten.orppolitie.nl": `https://interne-klacht.${canonicalDomain}`
  };
  const targetBase = aliases[host];
  if (!targetBase) return false;
  res.writeHead(308, {
    Location: `${targetBase}${url.pathname}${url.search}`,
    "Cache-Control": "no-store"
  });
  res.end();
  return true;
}

async function handleApi(req, res, url) {
  if (await handlePublicFormsApi(req, res, url)) return;
  if (url.pathname.startsWith("/api/porto/")) {
    sendJson(res, 409, {
      error: `Porto draait als eigen service. Open ${portoBaseUrl}.`,
      portoUrl: portoBaseUrl
    });
    return;
  }
  if (url.pathname === "/api/events" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    eventBus.addClient(req, res, auth.profile);
    return;
  }
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
      if (hasSessionCookie) clearSession(req, res);
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
        let profile = (state.people || []).find((person) => person.id === auth.profile.id && isPersonLoginEligible(person));
        if (!profile && isDevOverrideDiscordId(auth.profile.discordId)) profile = auth.profile;
        if (!profile) {
          clearSession(req, res);
          sendJson(res, 401, { authenticated: false, loginUrl: "/api/auth/login" });
          return;
        }
        const syncAgeMs = Date.now() - Number(auth.session.roleSyncedAt || 0);
        const canUseCachedRoles = Array.isArray(auth.session.roles) && auth.session.roles.length && syncAgeMs < 5 * 60 * 1000;
        if (canUseCachedRoles) {
          if (!auth.session.roles.includes(organizationMainRoleId(organization)) && !isDevOverrideDiscordId(profile.discordId)) {
            clearSession(req, res);
            sendJson(res, 403, { authenticated: false, error: "Geen Discord gekoppeld" });
            return;
          }
          auth.profile = profile;
        } else {
          const member = await getCurrentUserGuildMember(auth.session.accessToken);
          if (!member.roles.includes(organizationMainRoleId(organization)) && !isDevOverrideDiscordId(profile.discordId)) {
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
    if (!auth.session.dev && typeof sessions.save === "function") sessions.save(auth.session.id, auth.session);
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
      authCookie("orp_oauth_state", state, 600),
      authCookie("orp_oauth_redirect", redirectUri, 600)
    ];
    if (returnTo !== "/?login=1") {
      loginCookies.push(authCookie("orp_login_return", returnTo, 600));
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
      const hasOrganizationRole = member.roles.includes(organizationMainRoleId(organization));
      if (!hasOrganizationRole && !isDevOverrideDiscordId(user.id)) {
        logAuthDebug("callback-no-role", { userId: user.id });
        redirectWithAuthError(req, res, "no-role");
        return;
      }

      const state = await Promise.resolve(peopleStorage.readState());
      const profile = state.people.find((person) => person.discordId === user.id && isPersonLoginEligible(person)) || (isDevOverrideDiscordId(user.id) ? syntheticDevProfile(user) : null);
      if (!profile) {
        logAuthDebug("callback-no-profile", { userId: user.id });
        redirectWithAuthError(req, res, "no-profile");
        return;
      }

      if (!String(profile.id || "").startsWith("dev-")) {
        syncProfileFromDiscord(state, profile, user, member);
        await Promise.resolve(peopleStorage.writeState(state));
      }
      createSession(res, user, profile, { accessToken: token.access_token, roles: member.roles || [] });
      const sessionCookie = res.getHeader("Set-Cookie");
      logAuthDebug("callback-success", { profileId: profile.id, name: profile.name, hasSessionCookie: Boolean(sessionCookie) });
      res.writeHead(302, {
        Location: safeReturnPath(cookies.orp_login_return),
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

  if (await handlePersoneelsportaalApi(req, res, url) !== false) return;

  sendJson(res, 404, { error: "API route niet gevonden" });
}

function serveStatic(req, res, url) {
  const firstSegment = url.pathname.split("/").filter(Boolean)[0] || "";
  if (["porto", "porto.html"].includes(firstSegment.toLowerCase())) {
    redirectToPorto(res, url.pathname === "/porto.html" ? "/porto.html" : url.pathname);
    return;
  }
  const publicFormConfig = publicFormForRequest(req, url);
  const portalRouteRoots = new Set(["dashboard", "medewerkers", "mijn-profiel", "afwezigheid", "i8-formulier", "ontslag-formulier", "i8-controleren", "i8-archief", "mentor-overzicht", "mentor-traject", "mentor-toets", "mentor-toetsen", "mentor-checklist", "mentor-logboek", "hovj-logboek", "personeel-aannemen", "personeel", "afwezigheid-overzicht", "ontslag-overzicht", "ops-tijden", "personeels-archief", "logboek"]);
  const publicFormAssets = new Set(["/public-forms.css", "/public-forms.js", "/client-guard.js"]);
  const requested = publicFormConfig ? (publicFormAssets.has(url.pathname) || url.pathname.startsWith("/assets/") ? url.pathname : "/public-forms.html") : url.pathname === "/" || portalRouteRoots.has(firstSegment.toLowerCase()) ? "/index.html" : url.pathname;
  if (requested === "/personeelsportaal-data.js") {
    writeHeadSecure(res, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(clientDataScript(organization));
    return;
  }
  if (requested === "/porto-config.js") {
    writeHeadSecure(res, 200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    });
    res.end(portoClientDataScript(organization));
    return;
  }
  const publicRootFiles = new Set(["index.html", "styles.css", "shared.css", "personeelsportaal.css", "app.js", "personeelsportaal-data.js", "porto-config.js", "shared-ui.js", "client-guard.js", "portal-loader-failsafe.js", "boot-failsafe.js", "public-forms.html", "public-forms.css", "public-forms.js"]);
  serveWhitelistedStatic({
    root,
    requested,
    res,
    writeHeadSecure,
    publicRootFiles,
    isAllowedFeatureScript: (relativePath) => /^personeelsportaal\/[^/]+\.js$/.test(relativePath)
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, appBaseUrl);
  try {
    if (redirectPublicFormAlias(req, res, url)) return;
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
    sendJson(res, error.status || 500, { error: error.message });
  }
});

async function startServer() {
  await sessions.load?.();
  await sessions.cleanup?.();
  if (storageMode === "postgres") await publicFormsStore.ensurePublicFormsTable?.();
  await postgresEventBridge.start();
  portoDutyHoursJob = startPortoDutyHoursJob({
    enabled: storageMode === "postgres" && enabledFromEnv(process.env.PORTO_DUTY_HOURS_ENABLED, true),
    readState: peopleStorage.readState,
    writeHourEntries: peopleStorage.writeHourEntries,
    intervalMs: intervalMsFromEnv(process.env.PORTO_DUTY_HOURS_INTERVAL_MS, 10 * 60 * 1000),
    timeZone: process.env.PORTO_DUTY_HOURS_TIME_ZONE || "Europe/Amsterdam",
    startWeek: process.env.PORTO_DUTY_HOURS_START_WEEK || "2026-W26",
    logError: (error) => logServerError("Porto diensturen klok mislukt", error)
  });
  server.listen(port, () => {
    console.log(`${organization.portalTitle} draait op ${appBaseUrl}`);
    console.log(`Organisatie: ${organization.key}`);
    console.log(`Storage mode: ${storageMode}`);
    console.log(`Porto diensturen klok: ${portoDutyHoursJob?.isEnabled?.() ? "aan" : "uit"}`);
    if (storageMode === "postgres") console.log(`Database: ${databaseNameFromConnectionString(process.env.DATABASE_URL) || "onbekend"}`);
    console.log(`Actieve sessies geladen: ${typeof sessions.size === "function" ? sessions.size() : "onbekend"}`);
    if (!discordConfigured()) {
      console.log("Discord is nog niet volledig ingesteld. DEV_ALLOW_UNAUTH bepaalt of lokale demo-toegang werkt.");
    }
  });
}

startServer().catch((error) => {
  logServerError("Server start failed", error);
  console.error(error);
  process.exit(1);
});




async function shutdown() {
  try {
    portoDutyHoursJob?.stop?.();
    await postgresEventBridge.stop();
    await closePool();
  } finally {
    process.exit(0);
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
