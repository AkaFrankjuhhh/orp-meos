const { loadEnv, closePool } = require("../modules/db");

loadEnv();

const { readPostgresState } = require("../modules/postgres-state");
const { createDiscordBotServices } = require("../modules/discord-bot");
const { currentOrganization, organizationMainRoleId } = require("../modules/organizations");
const { isCurrentPerson } = require("../modules/person-status");

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

function compactCallsign(value) {
  return compactSearchText(value).replace(/\s+/g, "-");
}

function looksLikeDiscordId(value) {
  return /^\d{15,25}$/.test(String(value || "").trim());
}

function looksLikeCallsign(value) {
  return /^\d{2}-\d{2}$/i.test(String(value || "").trim());
}

function personSearchValues(person) {
  return [
    person.name,
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

function personExactValues(person) {
  return [
    person.name,
    person.discordUsername,
    person.serviceNumber,
    person.previousServiceNumber,
    person.raw?.name,
    person.raw?.discordUsername
  ].map(compactSearchText).filter(Boolean);
}

function personMatchesExact(person, query) {
  const needle = compactSearchText(query);
  if (!needle) return false;
  if (looksLikeDiscordId(query) && String(person.discordId || "").trim() === String(query || "").trim()) return true;
  return personExactValues(person).some((value) => value === needle);
}

function personMatchesService(person, query) {
  const needle = compactCallsign(query);
  if (!needle) return false;
  return [person.serviceNumber, person.previousServiceNumber]
    .map(compactCallsign)
    .filter(Boolean)
    .some((value) => value === needle);
}

function personMatchesDiscord(person, query) {
  const needle = String(query || "").trim();
  if (!needle) return false;
  return String(person.discordId || "").trim() === needle;
}

function preferCurrentPeople(people = []) {
  const current = people.filter(isCurrentPerson);
  return current.length ? current : people;
}

function uniquePeople(people = []) {
  const seen = new Set();
  const unique = [];
  for (const person of people) {
    const key = person.id || person.discordId || `${person.serviceNumber || ""}:${person.name || ""}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(person);
  }
  return unique;
}

function discordMemberId(member) {
  return String(member?.user?.id || member?.id || "").trim();
}

function discordMemberSearchText(member) {
  return compactSearchText([
    member?.nick,
    member?.user?.global_name,
    member?.user?.username
  ].filter(Boolean).join(" "));
}

async function findPeopleByDiscordCallsign(bot, people, query) {
  if (typeof bot.searchGuildMembers !== "function") return [];
  const raw = String(query || "").trim();
  if (!raw) return [];

  const callsignPrefix = looksLikeCallsign(raw) ? raw.split("-")[0] : "";
  const variants = [
    raw,
    `[${raw}`,
    compactCallsign(raw),
    `[${compactCallsign(raw)}`,
    compactSearchText(raw),
    callsignPrefix,
    callsignPrefix ? `[${callsignPrefix}` : ""
  ].filter(Boolean);
  const seenVariants = [...new Set(variants)];
  const needle = compactSearchText(raw);
  const byDiscordId = new Map((people || [])
    .filter((person) => person.discordId)
    .map((person) => [String(person.discordId).trim(), person]));
  const matches = [];
  const seenPeople = new Set();

  for (const variant of seenVariants) {
    let result;
    try {
      result = await bot.searchGuildMembers(variant, callsignPrefix ? 100 : 10);
    } catch (_error) {
      continue;
    }
    if (result?.skipped || !Array.isArray(result?.data)) continue;
    for (const member of result.data) {
      if (needle && !discordMemberSearchText(member).includes(needle)) continue;
      const person = byDiscordId.get(discordMemberId(member));
      if (!person || seenPeople.has(person.id || person.discordId)) continue;
      seenPeople.add(person.id || person.discordId);
      matches.push(person);
    }
    if (matches.length) break;
  }

  return uniquePeople(preferCurrentPeople(matches));
}

async function resolvePersonMatches({ bot, people, query, serviceQuery, discordQuery }) {
  if (discordQuery) {
    return {
      mode: "Discord ID",
      matches: preferCurrentPeople(people.filter((person) => personMatchesDiscord(person, discordQuery)))
    };
  }

  if (serviceQuery) {
    const exactServiceMatches = preferCurrentPeople(people.filter((person) => personMatchesService(person, serviceQuery)));
    if (exactServiceMatches.length) return { mode: "dienstnummer", matches: exactServiceMatches };
    const discordMatches = await findPeopleByDiscordCallsign(bot, people, serviceQuery);
    if (discordMatches.length) return { mode: "Discord roepnummer", matches: discordMatches };
    return { mode: "dienstnummer", matches: [] };
  }

  const exactMatches = preferCurrentPeople(people.filter((person) => personMatchesExact(person, query)));
  if (exactMatches.length) return { mode: "exacte query", matches: exactMatches };

  const discordMatches = await findPeopleByDiscordCallsign(bot, people, query);
  if (discordMatches.length) return { mode: "Discord roepnummer", matches: discordMatches };

  if (looksLikeCallsign(query) || looksLikeDiscordId(query)) {
    return { mode: "roepnummer", matches: [] };
  }

  return {
    mode: "fuzzy query",
    matches: preferCurrentPeople(people.filter((person) => personMatches(person, query)))
  };
}

function roleListText(roleIds = []) {
  return roleIds.length ? roleIds.join(", ") : "-";
}

async function main() {
  const serviceQuery = argValue("--service");
  const discordQuery = argValue("--discord");
  const query = argValue("--query") || argValue("--person") || serviceQuery || discordQuery || process.argv[2] || "";
  const apply = process.argv.includes("--apply");
  if (!query || query === "--apply") {
    throw new Error("Gebruik: node scripts/discord-sync-person.js --query \"Orion\" [--apply], --service \"74-01\" of --discord \"123...\"");
  }

  const organization = currentOrganization();
  const bot = createDiscordBotServices();
  if (!bot.isConfigured()) {
    throw new Error("DISCORD_BOT_TOKEN en DISCORD_GUILD_ID moeten gevuld zijn.");
  }

  const state = await readPostgresState();
  const people = state.people || [];
  const { mode, matches } = await resolvePersonMatches({ bot, people, query, serviceQuery, discordQuery });
  if (!matches.length) {
    const firstToken = compactSearchText(query).split(/\s+/).find((part) => part.length >= 2) || compactSearchText(query);
    const candidates = firstToken
      ? people.filter((person) => personSearchValues(person).some((value) => value.includes(firstToken))).slice(0, 10)
      : [];
    if (candidates.length) {
      console.log(`Geen exacte match gevonden voor "${query}". Mogelijke profielen:`);
      for (const person of candidates) {
        console.log(`- ${person.serviceNumber || "-"} ${person.name || "-"} discord=${person.discordId || "-"} username=${person.discordUsername || "-"} status=${person.status || "-"}`);
      }
    }
    throw new Error(`Geen profiel gevonden voor "${query}". Probeer --service "dienstnummer", --query "roepnummer" of --discord "Discord ID".`);
  }
  const effectiveMatches = uniquePeople(preferCurrentPeople(matches));
  if (effectiveMatches.length > 1) {
    console.log(`Meerdere profielen gevonden voor "${query}":`);
    for (const person of effectiveMatches) {
      console.log(`- ${person.serviceNumber || "-"} ${person.name || "-"} discord=${person.discordId || "-"} status=${person.status || "-"}`);
    }
    throw new Error("Maak de query specifieker met --service of --discord.");
  }

  const person = effectiveMatches[0];
  console.log(`Zoekwijze: ${mode}`);
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
  const separatorMappings = typeof bot.allSeparatorRoleMappings === "function"
    ? bot.allSeparatorRoleMappings()
    : [];
  const configuredSeparatorMappings = separatorMappings.filter((mapping) => String(mapping.roleId || "").trim());
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
  const desiredMissingSeparatorConfig = separatorMappings
    .filter((mapping) => bot.separatorRoleMatchesPerson?.(mapping, person) && !String(mapping.roleId || "").trim());
  const desiredSeparatorRoleIds = configuredSeparatorMappings
    .filter((mapping) => bot.separatorRoleMatchesPerson?.(mapping, person))
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
  const missingSeparatorRoleIds = desiredSeparatorRoleIds.filter((roleId) => !currentRoleIds.includes(roleId));
  const extraManagedSeparatorRoleIds = configuredSeparatorMappings
    .map((mapping) => mapping.roleId)
    .filter((roleId) => currentRoleIds.includes(roleId) && !desiredSeparatorRoleIds.includes(roleId));

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
  if (separatorMappings.length) {
    console.log("");
    console.log("Scheidingsrol mappings:");
    for (const mapping of separatorMappings) {
      const desired = bot.separatorRoleMatchesPerson?.(mapping, person) ? "ja" : "nee";
      const configured = String(mapping.roleId || "").trim() ? "ja" : "nee";
      const current = mapping.roleId && currentRoleIds.includes(mapping.roleId) ? "ja" : "nee";
      console.log(`- ${mapping.label} (${mapping.envKey}=${mapping.roleId || "NIET INGESTELD"}) gewenst=${desired} configured=${configured} aanwezig=${current}`);
    }
    console.log("");
    console.log(`Ontbrekende gewenste scheidingsrollen: ${roleListText(missingSeparatorRoleIds)}`);
    console.log(`Gewenst maar niet geconfigureerde scheidingsrollen: ${roleListText(desiredMissingSeparatorConfig.map((mapping) => mapping.envKey))}`);
    console.log(`Extra beheerde scheidingsrollen: ${roleListText(extraManagedSeparatorRoleIds)}`);
  }

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
