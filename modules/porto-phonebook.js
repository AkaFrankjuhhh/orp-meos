function serviceNumberSortValue(value) {
  const match = String(value || "").match(/^(\d+)-(\d+)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 1000 + Number(match[2]);
}

function compareServiceNumbers(left, right) {
  return serviceNumberSortValue(left) - serviceNumberSortValue(right);
}

function portoPhonebookPeople(state) {
  return (Array.isArray(state.people) ? state.people : [])
    .filter((person) => person && !["Ontslagen", "Gearchiveerd"].includes(person.status))
    .map((person) => ({
      id: person.id,
      rank: person.rank || "",
      name: person.name || "",
      serviceNumber: person.serviceNumber || "",
      phone: person.portoPhone || person.phone || ""
    }))
    .sort((left, right) => compareServiceNumbers(left.serviceNumber, right.serviceNumber) || left.name.localeCompare(right.name, "nl"));
}

module.exports = {
  serviceNumberSortValue,
  compareServiceNumbers,
  portoPhonebookPeople
};
