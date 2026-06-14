const DEFAULT_DEV_DISCORD_IDS = ["254572157126967296"];
const OVC_FUNCTION_BADGE = "OVC";
const OVC_FUNCTION_ALIASES = ["OVC", "Overheidscoordinator"];

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function normalizeFunctionBadge(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function configuredDevDiscordIds(env = process.env) {
  const values = [
    env.DEV_DISCORD_IDS,
    env.DEV_OVERRIDE_DISCORD_IDS,
    env.OVC_MANAGER_DISCORD_IDS,
    ...DEFAULT_DEV_DISCORD_IDS
  ];
  return new Set(
    values
      .join(",")
      .split(/[,\s]+/)
      .map(normalizeDiscordId)
      .filter(Boolean)
  );
}

function isDevDiscordId(discordId, env = process.env) {
  return configuredDevDiscordIds(env).has(normalizeDiscordId(discordId));
}

function isOvcFunctionBadge(value) {
  const normalized = normalizeFunctionBadge(value);
  return OVC_FUNCTION_ALIASES.some((alias) => normalizeFunctionBadge(alias) === normalized);
}

function canonicalizeFunctionBadge(value, allowedFunctions = []) {
  if (isOvcFunctionBadge(value)) return OVC_FUNCTION_BADGE;
  const normalized = normalizeFunctionBadge(value);
  return allowedFunctions.find((badge) => normalizeFunctionBadge(badge) === normalized) || "";
}

function hasOvcFunctionBadge(profile) {
  return [
    profile?.permRole,
    ...(Array.isArray(profile?.extraFunctions) ? profile.extraFunctions : [])
  ].some(isOvcFunctionBadge);
}

function normalizeOvcFunctionBadges(functions = []) {
  const seen = new Set();
  const normalized = [];
  for (const badge of functions || []) {
    const next = isOvcFunctionBadge(badge) ? OVC_FUNCTION_BADGE : String(badge || "").trim();
    if (!next || seen.has(next)) continue;
    seen.add(next);
    normalized.push(next);
  }
  return normalized;
}

module.exports = {
  OVC_FUNCTION_BADGE,
  configuredDevDiscordIds,
  isDevDiscordId,
  isOvcFunctionBadge,
  canonicalizeFunctionBadge,
  hasOvcFunctionBadge,
  normalizeOvcFunctionBadges,
  normalizeDiscordId,
  normalizeFunctionBadge
};
