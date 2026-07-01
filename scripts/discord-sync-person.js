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

function personMatches(person, query) {
  const needle = normalize(query);
  if (!needle) return false;
  return [
    person.id,
    person.name,
    person.discordId,
    person.serviceNumber
  ].some((value) => normalize(value).includes(needle));
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
  if (!matches.length) throw new Error(`Geen profiel gevonden voor "${query}".`);
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
  const mappings = bot.configuredQualificationRoleMappings();
  const desiredRoleIds = mappings
    .filter((mapping) => completed.has(mapping.qualification))
    .map((mapping) => mapping.roleId);
  const member = await bot.getGuildMember(person.discordId);
  if (member.skipped) throw new Error(member.reason || "Discord member kon niet worden opgehaald.");
  const currentRoleIds = (member.data?.roles || []).map(String);
  const missingRoleIds = desiredRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));
  const extraManagedRoleIds = mappings
    .map((mapping) => mapping.roleId)
    .filter((roleId) => currentRoleIds.includes(roleId) && !desiredRoleIds.includes(roleId));

  console.log(`Organisatie: ${organization.key}`);
  console.log(`Hoofdrol (${organization.requiredRoleLabel || organization.label}): ${organizationMainRoleId(organization) || "NIET INGESTELD"}`);
  console.log(`Profiel: ${person.serviceNumber || "-"} ${person.name || "-"} (${person.rank || "-"})`);
  console.log(`Discord ID: ${person.discordId || "-"}`);
  console.log(`Status: ${person.status || "-"}`);
  console.log(`Trainingen: ${roleListText(Array.from(completed))}`);
  console.log("");
  console.log("Kwalificatie mappings:");
  for (const mapping of mappings) {
    const desired = completed.has(mapping.qualification) ? "ja" : "nee";
    const current = currentRoleIds.includes(mapping.roleId) ? "ja" : "nee";
    console.log(`- ${mapping.qualification} -> ${mapping.label || mapping.qualification} (${mapping.envKey}=${mapping.roleId}) gewenst=${desired} aanwezig=${current}`);
  }
  console.log("");
  console.log(`Ontbrekende gewenste rollen: ${roleListText(missingRoleIds)}`);
  console.log(`Extra beheerde rollen: ${roleListText(extraManagedRoleIds)}`);

  if (!apply) {
    console.log("");
    console.log("Dry-run klaar. Voeg --apply toe om de kwalificatierollen echt te synchroniseren.");
    return;
  }

  const result = await bot.syncQualificationRolesForPerson(person, "Handmatige kwalificatie resync");
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
