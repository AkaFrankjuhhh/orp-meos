const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath, { override = false } = {}) {
  if (!fs.existsSync(filePath)) return false;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!value) continue;
    if (override || !process.env[key]) process.env[key] = value;
  }
  return true;
}

const root = path.join(__dirname, "..");
loadEnvFile(path.join(root, ".env"));

const requestedOrganization = String(
  process.env.ORP_ORGANIZATION || process.env.PORTAL_ORGANIZATION || process.env.ORGANIZATION || ""
).toLowerCase();

if (["politie", "police"].includes(requestedOrganization)) {
  loadEnvFile(path.join(root, ".env.politie"), { override: true });
}

const { currentOrganization, organizationMainRoleId } = require("../modules/organizations");
const { createDiscordBotServices } = require("../modules/discord-bot");

const organization = currentOrganization();
const bot = createDiscordBotServices();
const rankMappings = typeof bot.allRankRoleMappings === "function"
  ? bot.allRankRoleMappings()
  : Object.entries(bot.rankRoleEnvKeys || {}).map(([rank, envKey]) => ({ rank, envKey, roleId: process.env[envKey] || "" }));
const missingRankMappings = rankMappings.filter((mapping) => !String(mapping.roleId || "").trim());
const qualificationMappings = typeof bot.configuredQualificationRoleMappings === "function"
  ? bot.allQualificationRoleMappings()
  : [];
const missingQualificationMappings = typeof bot.missingQualificationRoleMappings === "function"
  ? bot.missingQualificationRoleMappings()
  : qualificationMappings.filter((mapping) => !String(mapping.roleId || "").trim());
const trainingRequirementMappings = typeof bot.allTrainingRequirementRoleMappings === "function"
  ? bot.allTrainingRequirementRoleMappings()
  : [];
const missingTrainingRequirementMappings = typeof bot.missingTrainingRequirementRoleMappings === "function"
  ? bot.missingTrainingRequirementRoleMappings()
  : trainingRequirementMappings.filter((mapping) => !String(mapping.roleId || "").trim());
const badgeMappings = typeof bot.allBadgeRoleMappings === "function"
  ? bot.allBadgeRoleMappings()
  : [];
const missingBadgeMappings = typeof bot.missingBadgeRoleMappings === "function"
  ? bot.missingBadgeRoleMappings()
  : badgeMappings.filter((mapping) => !String(mapping.roleId || "").trim());
const separatorMappings = typeof bot.allSeparatorRoleMappings === "function"
  ? bot.allSeparatorRoleMappings()
  : [];
const missingSeparatorMappings = typeof bot.missingSeparatorRoleMappings === "function"
  ? bot.missingSeparatorRoleMappings()
  : separatorMappings.filter((mapping) => !String(mapping.roleId || "").trim());

function roleCheck(group, label, envKey, roleId) {
  return {
    group,
    label: String(label || envKey || "Onbekend").trim(),
    envKey: String(envKey || "").trim(),
    roleId: String(roleId || "").trim()
  };
}

function configuredRoleChecks() {
  return [
    roleCheck("Hoofdrol", organization.requiredRoleLabel || organization.label || "Organisatie", organization.discord?.mainRole?.envKey, organizationMainRoleId(organization)),
    ...rankMappings.map((mapping) => roleCheck("Rangrol", mapping.rank, mapping.envKey, mapping.roleId)),
    ...qualificationMappings.map((mapping) => roleCheck("Kwalificatierol", mapping.label || mapping.qualification, mapping.envKey, mapping.roleId)),
    ...trainingRequirementMappings.map((mapping) => roleCheck("Benodigde trainingsrol", mapping.label || mapping.requirement, mapping.envKey, mapping.roleId)),
    ...badgeMappings.map((mapping) => roleCheck("Functie- en badgerol", mapping.label, mapping.envKey, mapping.roleId)),
    ...separatorMappings.map((mapping) => roleCheck("Scheidingsrol", mapping.label, mapping.envKey, mapping.roleId))
  ].filter((mapping) => mapping.roleId);
}

function parseDiscordJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function verifyConfiguredRoleIdsExist() {
  if (String(process.env.DISCORD_ROLE_CONFIG_CHECK_EXISTENCE || "true").toLowerCase() === "false") return;
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) {
    console.log("");
    console.log("Discord role-ID bestaan: overgeslagen, bot token of guild ID ontbreekt.");
    return;
  }

  const response = await fetch(`https://discord.com/api/v10/guilds/${process.env.DISCORD_GUILD_ID}/roles`, {
    headers: {
      Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`
    }
  });
  const text = await response.text();
  const data = text ? parseDiscordJson(text) : null;
  if (!response.ok) {
    console.log("");
    console.log(`Discord role-ID bestaan: controle mislukt (${response.status}) ${data?.message || text || ""}`.trim());
    process.exitCode = 1;
    return;
  }

  const guildRoleIds = new Set((Array.isArray(data) ? data : []).map((role) => String(role?.id || "").trim()).filter(Boolean));
  const invalidMappings = configuredRoleChecks().filter((mapping) => !guildRoleIds.has(mapping.roleId));
  console.log("");
  console.log("Discord role-ID bestaan:");
  if (!invalidMappings.length) {
    console.log("[ok] Alle ingestelde role IDs bestaan in de guild.");
    return;
  }

  for (const mapping of invalidMappings) {
    console.log(`[fout] ${mapping.group} ${mapping.label}: ${mapping.envKey}=${mapping.roleId} bestaat niet in guild ${process.env.DISCORD_GUILD_ID}.`);
  }
  process.exitCode = 1;
}

console.log(`Organisatie: ${organization.key}`);
console.log(`Hoofdrol: ${organizationMainRoleId(organization) || "NIET INGESTELD"}`);
console.log(`Bot token: ${process.env.DISCORD_BOT_TOKEN ? "ingesteld" : "NIET INGESTELD"}`);
console.log(`Guild ID: ${process.env.DISCORD_GUILD_ID || "NIET INGESTELD"}`);
console.log("");
console.log("Rangrollen:");

for (const mapping of rankMappings) {
  const state = mapping.roleId ? "ok" : "mist";
  const value = mapping.roleId ? `=${mapping.roleId}` : "";
  console.log(`[${state}] ${mapping.rank}: ${mapping.envKey}${value}`);
}

if (missingRankMappings.length) {
  console.log("");
  console.log("Ontbrekende rangrol env keys:");
  for (const mapping of missingRankMappings) {
    console.log(`${mapping.envKey}=`);
  }
  process.exitCode = 1;
}

console.log("");
console.log("Kwalificatierollen:");
if (!qualificationMappings.length) {
  console.log("[mist] Geen kwalificatierollen ingesteld.");
  process.exitCode = 1;
} else {
  for (const mapping of qualificationMappings) {
    const state = mapping.roleId ? "ok" : "mist";
    const value = mapping.roleId ? `=${mapping.roleId}` : "";
    console.log(`[${state}] ${mapping.qualification}: ${mapping.envKey}${value}`);
  }
}

if (missingQualificationMappings.length) {
  console.log("");
  console.log("Ontbrekende kwalificatierol env keys:");
  for (const mapping of missingQualificationMappings) {
    console.log(`${mapping.envKey}=`);
  }
  process.exitCode = 1;
}

if (trainingRequirementMappings.length) {
  console.log("");
  console.log("Benodigde trainingsrollen:");
  for (const mapping of trainingRequirementMappings) {
    const state = mapping.roleId ? "ok" : "mist";
    const value = mapping.roleId ? `=${mapping.roleId}` : "";
    console.log(`[${state}] ${mapping.label || mapping.requirement}: ${mapping.envKey}${value}`);
  }
}

if (missingTrainingRequirementMappings.length) {
  console.log("");
  console.log("Ontbrekende benodigde trainingsrol env keys:");
  for (const mapping of missingTrainingRequirementMappings) {
    console.log(`${mapping.envKey}=`);
  }
  process.exitCode = 1;
}

console.log("");
console.log("Functie- en badgerollen:");
if (!badgeMappings.length) {
  console.log("[mist] Geen functie- of badgerollen ingesteld.");
} else {
  for (const mapping of badgeMappings) {
    const state = mapping.roleId ? "ok" : "mist";
    const value = mapping.roleId ? `=${mapping.roleId}` : "";
    console.log(`[${state}] ${mapping.label}: ${mapping.envKey}${value}`);
  }
}

if (missingBadgeMappings.length) {
  console.log("");
  console.log("Ontbrekende functie- en badgerol env keys:");
  for (const mapping of missingBadgeMappings) {
    console.log(`${mapping.envKey}=`);
  }
  process.exitCode = 1;
}

if (separatorMappings.length) {
  console.log("");
  console.log("Scheidingsrollen:");
  for (const mapping of separatorMappings) {
    const state = mapping.roleId ? "ok" : "mist";
    const value = mapping.roleId ? `=${mapping.roleId}` : "";
    console.log(`[${state}] ${mapping.label}: ${mapping.envKey}${value}`);
  }
}

if (missingSeparatorMappings.length) {
  console.log("");
  console.log("Ontbrekende scheidingsrol env keys:");
  for (const mapping of missingSeparatorMappings) {
    console.log(`${mapping.envKey}=`);
  }
  process.exitCode = 1;
}

verifyConfiguredRoleIdsExist().catch((error) => {
  console.error(`Discord role-ID bestaan: controle mislukt: ${error.message}`);
  process.exitCode = 1;
});
