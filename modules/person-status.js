const LOGIN_BLOCKED_STATUSES = new Set([
  "inactief",
  "ontslagen",
  "gearchiveerd",
  "archief",
  "blacklist",
  "geblacklist"
]);

function normalizedPersonStatus(person) {
  return String(person?.status || "Actief").trim();
}

function isActivePerson(person) {
  return normalizedPersonStatus(person) === "Actief";
}

function isCurrentPerson(person) {
  if (!person) return false;
  const status = normalizedPersonStatus(person).toLowerCase();
  if (!status) return true;
  return !LOGIN_BLOCKED_STATUSES.has(status);
}

function isPersonLoginEligible(person) {
  return isCurrentPerson(person);
}

module.exports = {
  normalizedPersonStatus,
  isActivePerson,
  isCurrentPerson,
  isPersonLoginEligible
};
