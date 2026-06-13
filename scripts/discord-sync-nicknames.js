const { loadEnv } = require("../modules/db");

loadEnv();

const { currentOrganization } = require("../modules/organizations");
const { readPostgresState } = require("../modules/postgres-state");
const { createDiscordBotServices } = require("../modules/discord-bot");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskDiscordId(value) {
  const id = String(value || "");
  if (id.length <= 6) return id ? "***" : "-";
  return `${id.slice(0, 3)}***${id.slice(-3)}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const organization = currentOrganization();
  const syncReason = `${organization.portalTitle || "Personeelsportaal"} bulk Discord profiel sync`;
  const bot = createDiscordBotServices();
  if (!bot.isConfigured()) {
    throw new Error("DISCORD_BOT_TOKEN en DISCORD_GUILD_ID moeten gevuld zijn.");
  }

  const state = await readPostgresState();
  const activeWithDiscord = (state.people || [])
    .filter((person) => person.status === "Actief")
    .filter((person) => person.discordId)
    .filter((person) => !bot.isDiscordSyncExcludedPerson?.(person));
  const discordIdCounts = new Map();
  for (const person of activeWithDiscord) {
    discordIdCounts.set(person.discordId, (discordIdCounts.get(person.discordId) || 0) + 1);
  }
  const duplicateDiscordIds = new Set([...discordIdCounts.entries()].filter(([, count]) => count > 1).map(([discordId]) => discordId));
  const people = activeWithDiscord
    .filter((person) => !duplicateDiscordIds.has(person.discordId))
    .sort((a, b) => (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true }));
  const duplicatePeople = activeWithDiscord
    .filter((person) => duplicateDiscordIds.has(person.discordId))
    .sort((a, b) => String(a.discordId).localeCompare(String(b.discordId)) || (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true }));

  console.log(`Discord profiel sync ${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`Actieve profielen met Discord ID: ${activeWithDiscord.length}`);
  console.log(`Unieke profielen voor sync: ${people.length}`);
  if (duplicatePeople.length) {
    console.log("Dubbele Discord IDs overgeslagen:");
    for (const person of duplicatePeople) {
      console.log(`[dubbel] ${maskDiscordId(person.discordId)} ${person.serviceNumber || "-"} ${person.name}`);
    }
  }

  let changed = 0;
  let skipped = duplicatePeople.length;
  let failed = 0;

  for (const person of people) {
    const nickname = bot.buildServiceNickname(person);
    const rankRoleId = bot.rankRoleIdForPerson?.(person) || "niet ingesteld";
    if (!apply) {
      console.log(`[dry] ${maskDiscordId(person.discordId)} ${person.serviceNumber || "-"} ${person.rank || "-"} -> ${nickname} | rangrol: ${rankRoleId}`);
      continue;
    }

    try {
      await bot.syncNicknameForPerson(person, syncReason);
      const roleResult = await bot.syncRankRoleForPerson?.(person, syncReason);
      changed += 1;
      const roleText = roleResult?.ok
        ? `${roleResult.changes?.length || 0} rolwijzigingen`
        : (roleResult?.skipped ? `rangrol overgeslagen: ${roleResult.reason}` : "rangrol niet beschikbaar");
      console.log(`[ok] ${person.serviceNumber || "-"} ${person.name} -> ${nickname} | ${roleText}`);
      await sleep(450);
    } catch (error) {
      failed += 1;
      const status = error.status ? `Discord ${error.status}` : "fout";
      console.log(`[mislukt] ${person.serviceNumber || "-"} ${person.name}: ${status} ${error.message || "onbekend"}`);
      if (error.status === 403) {
        console.log("  Tip: zet de botrol boven de leden en rangrollen, en geef de bot Manage Nicknames + Manage Roles.");
      }
      if (error.status === 429) {
        console.log("  Tip: Discord rate-limit bleef actief; draai de sync straks nog een keer.");
      }
      if (error.status === 404) {
        console.log("  Tip: controleer of deze Discord ID nog in de Discord server zit.");
      }
    }
  }

  if (!apply) {
    console.log("Dry-run klaar. Draai met --apply om Discord nicknames en rangrollen echt aan te passen.");
    return;
  }

  console.log(`Klaar. Gelukt: ${changed}, overgeslagen: ${skipped}, mislukt: ${failed}.`);
}

main().catch((error) => {
  console.error(`Discord profiel sync mislukt: ${error.message}`);
  process.exit(1);
});
