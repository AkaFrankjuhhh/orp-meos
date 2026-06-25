function dateOnly(value) {
  const text = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function absenceIsApproved(absence) {
  return String(absence?.status || "In afwachting") === "Goedgekeurd";
}

function absenceIsActiveOnDate(absence, currentDate = new Date().toISOString().slice(0, 10)) {
  const current = dateOnly(currentDate) || new Date().toISOString().slice(0, 10);
  const from = dateOnly(absence?.from);
  const to = dateOnly(absence?.to);
  return absenceIsApproved(absence) && Boolean(from && to && from <= current && current <= to);
}

function normalizeAbsenceDrivenPeopleStatuses(state, currentDate = new Date().toISOString().slice(0, 10)) {
  const current = dateOnly(currentDate) || new Date().toISOString().slice(0, 10);
  const activeAbsencePersonIds = new Set(
    (Array.isArray(state.absences) ? state.absences : [])
      .filter((absence) => absenceIsActiveOnDate(absence, current))
      .map((absence) => absence.memberId)
      .filter(Boolean)
  );
  let changed = false;
  for (const person of Array.isArray(state.people) ? state.people : []) {
    if (!person) continue;
    const hasActiveAbsence = activeAbsencePersonIds.has(person.id);
    const source = String(person.absenceStatusSource || "");
    if (hasActiveAbsence) {
      if (person.status === "Actief") {
        person.status = "Afwezig";
        person.absenceStatusSource = "absence";
        changed = true;
      } else if (person.status === "Afwezig" && !source) {
        person.absenceStatusSource = "absence";
        changed = true;
      }
    } else if (person.status === "Afwezig" && source === "absence") {
      person.status = "Actief";
      delete person.absenceStatusSource;
      changed = true;
    } else if (source === "absence" && person.status !== "Afwezig") {
      delete person.absenceStatusSource;
      changed = true;
    }
  }
  return changed;
}

function applyManualAbsenceStatusSource(person, status = person?.status) {
  if (!person) return false;
  const nextStatus = String(status || "");
  if (nextStatus === "Afwezig") {
    if (person.absenceStatusSource !== "manual") {
      person.absenceStatusSource = "manual";
      return true;
    }
    return false;
  }
  if (person.absenceStatusSource === "manual") {
    delete person.absenceStatusSource;
    return true;
  }
  return false;
}

module.exports = {
  dateOnly,
  absenceIsApproved,
  absenceIsActiveOnDate,
  normalizeAbsenceDrivenPeopleStatuses,
  applyManualAbsenceStatusSource
};
