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

function isPersonLoginEligible(person) {
  if (!person) return false;
  const status = normalizedPersonStatus(person).toLowerCase();
  if (!status) return true;
  return !LOGIN_BLOCKED_STATUSES.has(status);
}

module.exports = {
  normalizedPersonStatus,
  isActivePerson,
  isPersonLoginEligible
};
