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
