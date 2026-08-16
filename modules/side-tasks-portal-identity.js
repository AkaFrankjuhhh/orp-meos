const { Pool } = require("pg");
const { organizationConfigs, normalizeOrganizationKey } = require("./organizations");

const pools = new Map();
let queryWarningLogged = false;
const dutchSurnameParticles = new Set([
  "aan", "bij", "de", "del", "den", "der", "des", "du", "het", "in", "la", "op", "ten", "ter", "tot", "uit", "van", "vanden", "ver", "voor"
]);

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
  const name = formatNameForDiscordNickname(person.name || person.discord_username || "");
  return `${prefix} ${name}`.trim().slice(0, 32).trim();
}

async function portalIdentityForDiscordId(discordId) {
  const normalizedDiscordId = String(discordId || "").trim();
  if (!normalizedDiscordId) return null;
  const priorities = splitList(process.env.SIDE_TASK_PORTAL_NICKNAME_PRIORITY, ["defensie", "politie"])
    .map(normalizeOrganizationKey);
  for (const organizationKey of priorities) {
    const pool = poolForOrganization(organizationKey);
    if (!pool) continue;
    try {
      const result = await pool.query(
        `select name, discord_username, rank, service_number, previous_service_number
         from people
         where discord_id = $1
           and lower(coalesce(status, 'Actief')) not in ('inactief', 'ontslagen', 'gearchiveerd', 'archief', 'blacklist', 'geblacklist')
         order by updated_at desc
         limit 1`,
        [normalizedDiscordId]
      );
      if (result.rows[0]) {
        const nickname = nicknameForPortalPerson(result.rows[0], organizationKey);
        if (nickname) return { organizationKey, nickname, person: result.rows[0] };
      }
    } catch (error) {
      if (!queryWarningLogged) {
        queryWarningLogged = true;
        console.warn(`Neventaken kon personeelsportaal-identiteit niet laden: ${error.message}`);
      }
    }
  }
  return null;
}

module.exports = { portalIdentityForDiscordId, nicknameForPortalPerson, hasPortalIdentityDatabase, formatNameForDiscordNickname };
