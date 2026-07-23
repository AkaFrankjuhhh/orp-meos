const { normalizeDiscordId } = require("./ovc");
const { isCurrentPerson } = require("./person-status");

function personUpdatedAtMs(person) {
  const value = person?.updatedAt || person?.updated_at || person?.reactivatedDate || person?.hiredDate || person?.rankDate || person?.promotionDate || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function preferCurrentPeople(people = []) {
  const list = Array.isArray(people) ? people.filter(Boolean) : [];
  const current = list.filter(isCurrentPerson);
  return current.length ? current : list;
}

function sortedIdentityCandidates(people = []) {
  return [...preferCurrentPeople(people)].sort((first, second) => {
    const firstCurrent = isCurrentPerson(first) ? 1 : 0;
    const secondCurrent = isCurrentPerson(second) ? 1 : 0;
    if (firstCurrent !== secondCurrent) return secondCurrent - firstCurrent;
    return personUpdatedAtMs(second) - personUpdatedAtMs(first);
  });
}

function findPersonByDiscordId(people = [], discordId, options = {}) {
  const normalized = normalizeDiscordId(discordId);
  if (!normalized) return null;
  const matches = (Array.isArray(people) ? people : [])
    .filter((person) => normalizeDiscordId(person?.discordId || person?.discord_id || "") === normalized);
  const candidates = options.currentOnly ? matches.filter(isCurrentPerson) : sortedIdentityCandidates(matches);
  return candidates[0] || null;
}

function findPersonByIdOrDiscordId(people = [], { personId = "", discordId = "" } = {}) {
  const list = Array.isArray(people) ? people : [];
  if (personId) {
    const byId = list.find((person) => String(person?.id || "") === String(personId));
    if (byId) return byId;
  }
  return findPersonByDiscordId(list, discordId);
}

function currentPersonByDiscordIdMap(people = []) {
  const byDiscordId = new Map();
  for (const person of sortedIdentityCandidates(people).filter(isCurrentPerson)) {
    const discordId = normalizeDiscordId(person?.discordId || "");
    if (!discordId || byDiscordId.has(discordId)) continue;
    byDiscordId.set(discordId, person);
  }
  return byDiscordId;
}

module.exports = {
  currentPersonByDiscordIdMap,
  findPersonByDiscordId,
  findPersonByIdOrDiscordId,
  preferCurrentPeople,
  sortedIdentityCandidates
};
