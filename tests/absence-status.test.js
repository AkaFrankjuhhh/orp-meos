const test = require("node:test");
const assert = require("node:assert/strict");
const {
  absenceIsActiveOnDate,
  normalizeAbsenceDrivenPeopleStatuses,
  applyManualAbsenceStatusSource
} = require("../modules/absence-status");

test("absence only changes status on or after start date", () => {
  const absence = { status: "Goedgekeurd", from: "2026-07-08", to: "2026-07-15", memberId: "p1" };

  assert.equal(absenceIsActiveOnDate(absence, "2026-07-07"), false);
  assert.equal(absenceIsActiveOnDate(absence, "2026-07-08"), true);
});

test("absence source does not overwrite manually absent people", () => {
  const state = { people: [{ id: "p1", status: "Afwezig", absenceStatusSource: "manual" }], absences: [] };

  assert.equal(normalizeAbsenceDrivenPeopleStatuses(state, "2026-07-08"), false);
  assert.equal(state.people[0].status, "Afwezig");
  assert.equal(state.people[0].absenceStatusSource, "manual");
});

test("absence source reverts only absence-driven statuses after end date", () => {
  const state = {
    people: [{ id: "p1", status: "Afwezig", absenceStatusSource: "absence" }],
    absences: [{ memberId: "p1", status: "Goedgekeurd", from: "2026-07-01", to: "2026-07-02" }]
  };

  assert.equal(normalizeAbsenceDrivenPeopleStatuses(state, "2026-07-03"), true);
  assert.equal(state.people[0].status, "Actief");
  assert.equal(state.people[0].absenceStatusSource, undefined);
});

test("manual absence helper marks manual status and clears when active", () => {
  const person = { status: "Afwezig" };

  assert.equal(applyManualAbsenceStatusSource(person), true);
  assert.equal(person.absenceStatusSource, "manual");

  person.status = "Actief";
  assert.equal(applyManualAbsenceStatusSource(person), true);
  assert.equal(person.absenceStatusSource, undefined);
});
