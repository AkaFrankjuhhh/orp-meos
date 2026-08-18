const { Pool } = require("pg");
const { organizationConfigs, normalizeOrganizationKey } = require("./organizations");

const pools = new Map();
let queryWarningLogged = false;
const dutchSurnameParticles = new Set([
  "aan", "bij", "de", "del", "den", "der", "des", "du", "het", "in", "la", "op", "ten", "ter", "tot", "uit", "van", "vanden", "ver", "voor"
]);
const activePortalStatusSql = "lower(coalesce(status, 'Actief')) not in ('inactief', 'ontslagen', 'gearchiveerd', 'archief', 'blacklist', 'geblacklist')";
const identityColumns = "id, name, discord_id, discord_username, avatar, rank, service_number, previous_service_number, status, raw, updated_at";

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function formatNameForDiscordNickname(name) {
  const parts = String(name || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const middleParts = parts.slice(1, -1);
  const hasSurnameParticle = middleParts.length > 0 && middleParts.every((part) => {
    const lower = part.toLowerCase();
    return dutchSurnameParticles.has(lower) || part === lower;
  });
  const surnameParticle = hasSurnameParticle ? `${middleParts.join(" ")} ` : "";
  return `${firstName} ${surnameParticle}${lastName.charAt(0).toUpperCase()}.`.trim();
}

function splitList(value, fallback = []) {
  const items = String(value || "")
    .split(/[;,\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function normalizeOrganizationPriority(value, fallback = []) {
  const source = Array.isArray(value) ? value : splitList(value, fallback);
  const seen = new Set();
  return source
    .map(normalizeOrganizationKey)
    .filter((key) => {
      if (!["defensie", "politie"].includes(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function databaseUrlForOrganization(key) {
  const normalized = normalizeOrganizationKey(key);
  const envKey = normalized === "politie"
    ? "SIDE_TASK_POLITIE_DATABASE_URL"
    : "SIDE_TASK_DEFENSIE_DATABASE_URL";
  return String(process.env[envKey] || "").trim();
}

function hasPortalIdentityDatabase() {
  return Boolean(databaseUrlForOrganization("defensie") || databaseUrlForOrganization("politie"));
}

function poolForOrganization(key) {
  const normalized = normalizeOrganizationKey(key);
  const connectionString = databaseUrlForOrganization(normalized);
  if (!connectionString) return null;
  if (pools.has(normalized)) return pools.get(normalized);
  const sslEnabled = String(process.env.SIDE_TASK_PORTAL_DATABASE_SSL || process.env.DATABASE_SSL || "false").toLowerCase() === "true";
  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: Number(process.env.SIDE_TASK_PORTAL_DATABASE_POOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.SIDE_TASK_PORTAL_DATABASE_POOL_CONNECT_MS || 5000),
    ssl: sslEnabled ? { rejectUnauthorized: false } : false
  });
  pool.on("error", (error) => console.error(`Neventaken ${normalized} identity pool error:`, error.message || error));
  pools.set(normalized, pool);
  return pool;
}

function nicknameForPortalPerson(person, organizationKey) {
  const organization = organizationConfigs[normalizeOrganizationKey(organizationKey)];
  if (!organization) return "";
  const serviceNumber = String(person.service_number || person.previous_service_number || "-").trim() || "-";
  const symbols = String(organization.discord?.nicknameSymbols?.[String(person.rank || "").trim()] || "").trim();
  const separator = typeof organization.discord?.nicknameSymbolSeparator === "string"
    ? organization.discord.nicknameSymbolSeparator
    : " ";
  const prefix = symbols ? `[${serviceNumber}${separator}${symbols}]` : `[${serviceNumber}]`;
  const name = formatNameForDiscordNickname(portalPersonDisplayName(person) || person.discord_username || "");
  return `${prefix} ${name}`.trim().slice(0, 32).trim();
}

function normalizeIdentityText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[`"'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function addNormalized(set, value) {
  const normalized = normalizeIdentityText(value);
  if (normalized) set.add(normalized);
}

function discordDisplayName(user = {}) {
  return String(user.global_name || user.display_name || user.username || "").trim();
}

function discordUsername(user = {}) {
  return String(user.global_name || user.display_name || user.username || "").trim();
}

function stripDiscordNicknamePrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:(?:ACO|TCO|CM|PLAVA)\s+)?(?:(?:OVD|OPCO|K9|K9B)-[KP]|BGD|HRB)\s+/i, "")
    .replace(/^\s*\[[^\]]+\]\s*/, "")
    .trim();
}

function serviceNumberFromDiscordNickname(value) {
  const text = String(value || "").trim();
  const bracketMatch = text.match(/^\[([^\]\s]+)(?:\s+[^\]]+)?\]/);
  if (bracketMatch) return bracketMatch[1].trim();
  const prefixMatch = text.match(/^([A-Za-z]{1,10}-\d{1,3}|\d{2}-\d{2})\b/);
  return prefixMatch ? prefixMatch[1].trim() : "";
}

function cleanPortalName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (!name || /^onbekend$/i.test(name)) return "";
  return stripDiscordNicknamePrefix(name);
}

function isCompactPortalName(value) {
  const name = cleanPortalName(value);
  if (!name) return true;
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return true;
  const last = parts[parts.length - 1];
  return parts.length === 2 && /^[A-Z]\.?$/.test(last);
}

function addPortalNameCandidate(candidates, value) {
  const name = cleanPortalName(value);
  if (name && !candidates.some((candidate) => normalizeIdentityText(candidate) === normalizeIdentityText(name))) {
    candidates.push(name);
  }
}

function portalPersonDisplayName(person = {}, options = {}) {
  const raw = parseJson(person.raw, {});
  const candidates = [];
  addPortalNameCandidate(candidates, raw.name);
  addPortalNameCandidate(candidates, raw.fullName);
  addPortalNameCandidate(candidates, raw.displayName);
  addPortalNameCandidate(candidates, raw.profile?.name);
  addPortalNameCandidate(candidates, person.name);
  addPortalNameCandidate(candidates, options.fallbackNickname);
  addPortalNameCandidate(candidates, raw.discordUsername);
  addPortalNameCandidate(candidates, raw.discord_username);
  addPortalNameCandidate(candidates, person.discord_username);

  return candidates.find((candidate) => !isCompactPortalName(candidate)) || candidates[0] || "";
}

function portalIdentitySearchHints(user = {}, member = {}) {
  const names = new Set();
  const usernames = new Set();
  const serviceNumbers = new Set();
  const memberUser = member?.user || {};
  const nickname = String(member?.nick || "").trim();
  const strippedNickname = stripDiscordNicknamePrefix(nickname);

  for (const value of [
    nickname,
    strippedNickname,
    discordDisplayName(user),
    discordDisplayName(memberUser)
  ]) {
    addNormalized(names, value);
  }

  for (const value of [
    discordUsername(user),
    discordUsername(memberUser),
    user.username,
    memberUser.username
  ]) {
    addNormalized(usernames, value);
  }

  for (const value of [nickname, strippedNickname]) {
    const serviceNumber = serviceNumberFromDiscordNickname(value);
    if (serviceNumber) serviceNumbers.add(serviceNumber);
  }

  return {
    names: [...names],
    usernames: [...usernames],
    serviceNumbers: [...serviceNumbers],
    singleTokenNames: [...names].filter((name) => name && !name.includes(" "))
  };
}

function firstIdentityToken(value) {
  return normalizeIdentityText(value).split(" ").filter(Boolean)[0] || "";
}

function portalPersonMatchesSearchHints(person, hints = {}) {
  const names = new Set(hints.names || []);
  const usernames = new Set(hints.usernames || []);
  const singleTokenNames = new Set(hints.singleTokenNames || []);
  const personDisplayName = portalPersonDisplayName(person);
  const personName = normalizeIdentityText(personDisplayName || person?.name || "");
  const formattedName = normalizeIdentityText(formatNameForDiscordNickname(personDisplayName || person?.name || ""));
  const personUsername = normalizeIdentityText(person?.discord_username || "");

  if (personName && names.has(personName)) return true;
  if (formattedName && names.has(formattedName)) return true;
  if (personUsername && (usernames.has(personUsername) || names.has(personUsername))) return true;
  const firstName = firstIdentityToken(personDisplayName || person?.name || "");
  return Boolean(firstName && singleTokenNames.has(firstName));
}

function uniquePortalPerson(rows = [], predicate = () => true) {
  const matches = rows.filter(predicate);
  const uniqueById = new Map(matches.map((row) => [String(row.id || ""), row]));
  return uniqueById.size === 1 ? [...uniqueById.values()][0] : null;
}

async function linkMissingPortalDiscordId(pool, person, discordId, user = {}) {
  const normalizedDiscordId = String(discordId || "").trim();
  if (!normalizedDiscordId || !person?.id || String(person.discord_id || "").trim()) return person;
  const result = await pool.query(
    `update people
     set
       discord_id = $2,
       discord_username = case when $3 <> '' then $3 else discord_username end,
       avatar = case when $4 <> '' then $4 else avatar end,
       updated_at = now()
     where id = $1
       and coalesce(trim(discord_id), '') = ''
     returning ${identityColumns}`,
    [
      person.id,
      normalizedDiscordId,
      discordUsername(user),
      user?.id && user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${String(user.avatar).startsWith("a_") ? "gif" : "png"}?size=128` : ""
    ]
  );
  return result.rows[0] || person;
}

async function findPortalIdentityByProfileHints(pool, organizationKey, discordId, hints, options = {}) {
  if (!hints.serviceNumbers.length && !hints.names.length && !hints.usernames.length) return null;

  if (hints.serviceNumbers.length) {
    const result = await pool.query(
      `select ${identityColumns}
       from people
       where ${activePortalStatusSql}
         and coalesce(trim(discord_id), '') = ''
         and (service_number = any($1::text[]) or previous_service_number = any($1::text[]))
       order by updated_at desc nulls last
       limit 5`,
      [hints.serviceNumbers]
    );
    const person = uniquePortalPerson(result.rows);
    if (person) {
      const linked = options.linkMissingDiscordId ? await linkMissingPortalDiscordId(pool, person, discordId, options.discordUser) : person;
      const nickname = nicknameForPortalPerson(linked, organizationKey);
      if (nickname) return { organizationKey, nickname, person: linked, linkedBy: "service_number" };
    }
  }

  const patternTokens = [...new Set([...hints.names, ...hints.usernames].map((value) => firstIdentityToken(value)).filter(Boolean))];
  if (!patternTokens.length) return null;
  const patterns = patternTokens.map((token) => `${token}%`);
  const result = await pool.query(
    `select ${identityColumns}
     from people
     where ${activePortalStatusSql}
       and coalesce(trim(discord_id), '') = ''
       and (lower(name) like any($1::text[]) or lower(discord_username) like any($1::text[]))
     order by updated_at desc nulls last
     limit 50`,
    [patterns]
  );
  const person = uniquePortalPerson(result.rows, (row) => portalPersonMatchesSearchHints(row, hints));
  if (!person) return null;
  const linked = options.linkMissingDiscordId ? await linkMissingPortalDiscordId(pool, person, discordId, options.discordUser) : person;
  const nickname = nicknameForPortalPerson(linked, organizationKey);
  return nickname ? { organizationKey, nickname, person: linked, linkedBy: "profile_hint" } : null;
}

async function portalIdentityForDiscordId(discordId, options = {}) {
  const normalizedDiscordId = String(discordId || "").trim();
  if (!normalizedDiscordId) return null;
  const priorities = normalizeOrganizationPriority(
    options.organizationPriority,
    normalizeOrganizationPriority(process.env.SIDE_TASK_PORTAL_NICKNAME_PRIORITY, ["defensie", "politie"])
  );
  const hints = portalIdentitySearchHints(options.discordUser, options.guildMember);
  for (const organizationKey of priorities) {
    const pool = poolForOrganization(organizationKey);
    if (!pool) continue;
    try {
      const result = await pool.query(
        `select ${identityColumns}
         from people
         where discord_id = $1
           and ${activePortalStatusSql}
         order by updated_at desc
         limit 1`,
        [normalizedDiscordId]
      );
      if (result.rows[0]) {
        const nickname = nicknameForPortalPerson(result.rows[0], organizationKey);
        if (nickname) return { organizationKey, nickname, person: result.rows[0] };
      }
      const hintedIdentity = await findPortalIdentityByProfileHints(pool, organizationKey, normalizedDiscordId, hints, options);
      if (hintedIdentity) return hintedIdentity;
    } catch (error) {
      if (!queryWarningLogged) {
        queryWarningLogged = true;
        console.warn(`Neventaken kon personeelsportaal-identiteit niet laden: ${error.message}`);
      }
    }
  }
  return null;
}

module.exports = {
  portalIdentityForDiscordId,
  nicknameForPortalPerson,
  hasPortalIdentityDatabase,
  formatNameForDiscordNickname,
  portalIdentitySearchHints,
  portalPersonDisplayName,
  portalPersonMatchesSearchHints,
  serviceNumberFromDiscordNickname,
  stripDiscordNicknamePrefix
};
