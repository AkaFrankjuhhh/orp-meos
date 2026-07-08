const { loadEnv, closePool } = require("../modules/db");

loadEnv();

const { readPostgresState } = require("../modules/postgres-state");
const { createDiscordBotServices } = require("../modules/discord-bot");
const { currentOrganization, organizationMainRoleId } = require("../modules/organizations");

function argValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compactSearchText(value) {
  return normalize(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function personSearchValues(person) {
  return [
    person.id,
    person.name,
    person.discordId,
    person.discordUsername,
    person.serviceNumber,
    person.previousServiceNumber,
    person.raw?.name,
    person.raw?.discordUsername
  ].map(compactSearchText).filter(Boolean);
}

function personMatches(person, query) {
  const needle = compactSearchText(query);
  if (!needle) return false;
  const values = personSearchValues(person);
  if (values.some((value) => value.includes(needle))) return true;
  const parts = needle.split(/\s+/).filter((part) => part.length >= 2);
  if (!parts.length) return false;
  return values.some((value) => parts.every((part) => value.includes(part)));
}

function roleListText(roleIds = []) {
  return roleIds.length ? roleIds.join(", ") : "-";
}

async function main() {
  const query = argValue("--query") || argValue("--person") || argValue("--service") || argValue("--discord") || process.argv[2] || "";
  const apply = process.argv.includes("--apply");
  if (!query || query === "--apply") {
    throw new Error("Gebruik: node scripts/discord-sync-person.js --query \"Orion\" [--apply]");
  }

  const organization = currentOrganization();
  const bot = createDiscordBotServices();
  if (!bot.isConfigured()) {
    throw new Error("DISCORD_BOT_TOKEN en DISCORD_GUILD_ID moeten gevuld zijn.");
  }

  const state = await readPostgresState();
  const matches = (state.people || []).filter((person) => personMatches(person, query));
  if (!matches.length) {
    const firstToken = compactSearchText(query).split(/\s+/).find((part) => part.length >= 2) || compactSearchText(query);
    const candidates = firstToken
      ? (state.people || []).filter((person) => personSearchValues(person).some((value) => value.includes(firstToken))).slice(0, 10)
      : [];
    if (candidates.length) {
      console.log(`Geen exacte match gevonden voor "${query}". Mogelijke profielen:`);
      for (const person of candidates) {
        console.log(`- ${person.serviceNumber || "-"} ${person.name || "-"} discord=${person.discordId || "-"} username=${person.discordUsername || "-"} status=${person.status || "-"}`);
      }
    }
    throw new Error(`Geen profiel gevonden voor "${query}". Probeer --query "dienstnummer" of --discord "Discord ID".`);
  }
  if (matches.length > 1) {
    console.log(`Meerdere profielen gevonden voor "${query}":`);
    for (const person of matches) {
      console.log(`- ${person.serviceNumber || "-"} ${person.name || "-"} discord=${person.discordId || "-"} status=${person.status || "-"}`);
    }
    throw new Error("Maak de query specifieker met --service of --discord.");
  }

  const person = matches[0];
  const completed = new Set([
    ...(Array.isArray(person.completedTrainings) ? person.completedTrainings : []),
    ...(Array.isArray(person.completedOperational) ? person.completedOperational : [])
  ].map(String));
  const allMappings = typeof bot.allQualificationRoleMappings === "function"
    ? bot.allQualificationRoleMappings()
    : bot.configuredQualificationRoleMappings();
  const configuredMappings = allMappings.filter((mapping) => String(mapping.roleId || "").trim());
  const rankMappings = typeof bot.allRankRoleMappings === "function"
    ? bot.allRankRoleMappings()
    : bot.configuredRankRoleMappings();
  const configuredRankMappings = rankMappings.filter((mapping) => String(mapping.roleId || "").trim());
  const badgeMappings = typeof bot.allBadgeRoleMappings === "function"
    ? bot.allBadgeRoleMappings()
    : [];
  const configuredBadgeMappings = badgeMappings.filter((mapping) => String(mapping.roleId || "").trim());
  const trainingRequirementMappings = typeof bot.allTrainingRequirementRoleMappings === "function"
    ? bot.allTrainingRequirementRoleMappings()
    : [];
  const configuredTrainingRequirementMappings = trainingRequirementMappings.filter((mapping) => String(mapping.roleId || "").trim());
  const desiredRankRoleId = bot.rankRoleIdForPerson?.(person) || "";
  const desiredMissingConfig = allMappings.filter((mapping) => completed.has(mapping.qualification) && !String(mapping.roleId || "").trim());
  const desiredRoleIds = configuredMappings
    .filter((mapping) => completed.has(mapping.qualification))
    .map((mapping) => mapping.roleId);
  const missingTrainingRequirements = new Set(
    typeof bot.missingTrainingRequirementsForPerson === "function"
      ? bot.missingTrainingRequirementsForPerson(person)
      : []
  );
  const desiredMissingTrainingConfig = trainingRequirementMappings
    .filter((mapping) => missingTrainingRequirements.has(mapping.requirement) && !String(mapping.roleId || "").trim());
  const desiredTrainingRequirementRoleIds = configuredTrainingRequirementMappings
    .filter((mapping) => missingTrainingRequirements.has(mapping.requirement))
    .map((mapping) => mapping.roleId);
  const assignedBadges = new Set([
    person.permRole,
    ...(Array.isArray(person.extraFunctions) ? person.extraFunctions : []),
    ...(Array.isArray(person.badges) ? person.badges : [])
  ].map((item) => String(item || "").trim()).filter(Boolean));
  for (const mapping of organization.autoFunctionByRanks || []) {
    if ((mapping.ranks || []).includes(person.rank || "")) assignedBadges.add(mapping.label);
  }
  const desiredMissingBadgeConfig = badgeMappings.filter((mapping) => assignedBadges.has(mapping.label) && !String(mapping.roleId || "").trim());
  const desiredBadgeRoleIds = configuredBadgeMappings
    .filter((mapping) => assignedBadges.has(mapping.label))
    .map((mapping) => mapping.roleId);
  const member = await bot.getGuildMember(person.discordId);
  if (member.skipped) throw new Error(member.reason || "Discord member kon niet worden opgehaald.");
  const currentRoleIds = (member.data?.roles || []).map(String);
  const missingRankRoleIds = desiredRankRoleId && !currentRoleIds.includes(desiredRankRoleId) ? [desiredRankRoleId] : [];
  const extraManagedRankRoleIds = configuredRankMappings
    .map((mapping) => mapping.roleId)
    .filter((roleId) => currentRoleIds.includes(roleId) && roleId !== desiredRankRoleId);
  const missingRoleIds = desiredRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));
  const extraManagedRoleIds = configuredMappings
    .map((mapping) => mapping.roleId)
    .filter((roleId) => currentRoleIds.includes(roleId) && !desiredRoleIds.includes(roleId));
  const missingTrainingRequirementRoleIds = desiredTrainingRequirementRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));
  const extraManagedTrainingRequirementRoleIds = configuredTrainingRequirementMappings
    .map((mapping) => mapping.roleId)
    .filter((roleId) => currentRoleIds.includes(roleId) && !desiredTrainingRequirementRoleIds.includes(roleId));
  const missingBadgeRoleIds = desiredBadgeRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));
  const extraManagedBadgeRoleIds = configuredBadgeMappings
    .map((mapping) => mapping.roleId)
    .filter((roleId) => currentRoleIds.includes(roleId) && !desiredBadgeRoleIds.includes(roleId));

  console.log(`Organisatie: ${organization.key}`);
  console.log(`Hoofdrol (${organization.requiredRoleLabel || organization.label}): ${organizationMainRoleId(organization) || "NIET INGESTELD"}`);
  console.log(`Profiel: ${person.serviceNumber || "-"} ${person.name || "-"} (${person.rank || "-"})`);
  console.log(`Discord ID: ${person.discordId || "-"}`);
  console.log(`Status: ${person.status || "-"}`);
  console.log(`Trainingen: ${roleListText(Array.from(completed))}`);
  console.log(`Functies/badges: ${roleListText(Array.from(assignedBadges))}`);
  console.log("");
  console.log("Rangrol mapping:");
  for (const mapping of rankMappings) {
    if (mapping.rank !== person.rank) continue;
    const configured = String(mapping.roleId || "").trim() ? "ja" : "nee";
    const current = mapping.roleId && currentRoleIds.includes(mapping.roleId) ? "ja" : "nee";
    console.log(`- ${mapping.rank} (${mapping.envKey}=${mapping.roleId || "NIET INGESTELD"}) gewenst=ja configured=${configured} aanwezig=${current}`);
  }
  console.log(`Ontbrekende rangrol: ${roleListText(missingRankRoleIds)}`);
  console.log(`Extra beheerde rangrollen: ${roleListText(extraManagedRankRoleIds)}`);
  console.log("");
  console.log("Kwalificatie mappings:");
  for (const mapping of allMappings) {
    const desired = completed.has(mapping.qualification) ? "ja" : "nee";
    const configured = String(mapping.roleId || "").trim() ? "ja" : "nee";
    const current = mapping.roleId && currentRoleIds.includes(mapping.roleId) ? "ja" : "nee";
    console.log(`- ${mapping.qualification} -> ${mapping.label || mapping.qualification} (${mapping.envKey}=${mapping.roleId || "NIET INGESTELD"}) gewenst=${desired} configured=${configured} aanwezig=${current}`);
  }
  console.log("");
  console.log(`Ontbrekende gewenste rollen: ${roleListText(missingRoleIds)}`);
  console.log(`Gewenst maar niet geconfigureerd: ${roleListText(desiredMissingConfig.map((mapping) => mapping.envKey))}`);
  console.log(`Extra beheerde rollen: ${roleListText(extraManagedRoleIds)}`);
  console.log("");
  if (trainingRequirementMappings.length) {
    console.log("Benodigde training mappings:");
    for (const mapping of trainingRequirementMappings) {
      const desired = missingTrainingRequirements.has(mapping.requirement) ? "ja" : "nee";
      const configured = String(mapping.roleId || "").trim() ? "ja" : "nee";
      const current = mapping.roleId && currentRoleIds.includes(mapping.roleId) ? "ja" : "nee";
      console.log(`- ${mapping.requirement} -> ${mapping.label || mapping.requirement} (${mapping.envKey}=${mapping.roleId || "NIET INGESTELD"}) nodig=${desired} configured=${configured} aanwezig=${current}`);
    }
    console.log("");
    console.log(`Ontbrekende benodigde trainingsrollen: ${roleListText(missingTrainingRequirementRoleIds)}`);
    console.log(`Benodigd maar niet geconfigureerd: ${roleListText(desiredMissingTrainingConfig.map((mapping) => mapping.envKey))}`);
    console.log(`Extra beheerde benodigde trainingsrollen: ${roleListText(extraManagedTrainingRequirementRoleIds)}`);
    console.log("");
  }
  console.log("Functie- en badge mappings:");
  for (const mapping of badgeMappings) {
    const desired = assignedBadges.has(mapping.label) ? "ja" : "nee";
    const configured = String(mapping.roleId || "").trim() ? "ja" : "nee";
    const current = mapping.roleId && currentRoleIds.includes(mapping.roleId) ? "ja" : "nee";
    console.log(`- ${mapping.label} (${mapping.envKey}=${mapping.roleId || "NIET INGESTELD"}) gewenst=${desired} configured=${configured} aanwezig=${current}`);
  }
  console.log("");
  console.log(`Ontbrekende gewenste functie-/badgerollen: ${roleListText(missingBadgeRoleIds)}`);
  console.log(`Gewenst maar niet geconfigureerde functie-/badgerollen: ${roleListText(desiredMissingBadgeConfig.map((mapping) => mapping.envKey))}`);
  console.log(`Extra beheerde functie-/badgerollen: ${roleListText(extraManagedBadgeRoleIds)}`);

  if (!apply) {
    console.log("");
    console.log("Dry-run klaar. Voeg --apply toe om naam, rangrol en kwalificatierollen echt te synchroniseren.");
    return;
  }

  const result = await bot.syncDiscordForPersonIfNeeded(person, "Handmatige Discord profiel resync");
  console.log("");
  console.log("Sync resultaat:");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(`Discord persoon-sync mislukt: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool().catch(() => {});
  });
