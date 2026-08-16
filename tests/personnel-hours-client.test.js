const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHoursModuleWithState(state, globals = {}) {
  const code = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "hours.js"), "utf8");
  const context = {
    state,
    ...globals,
    window: {
      DefensiePortalModules: {
        registerFeature() {}
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

test("manual hour entry is used as a base and porto clock entries keep counting on top", () => {
  const context = loadHoursModuleWithState({
    hours: [
      { id: "porto-duty-a", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 0.2, source: "porto-duty-clock" },
      { id: "porto-duty-b", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 0.3, source: "porto-duty-clock" },
      { id: "manual-p1-2026-26", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 4, source: "Handmatig" }
    ]
  });

  const entry = context.effectiveHourEntryFor("p1", 2026, 26);
  assert.equal(entry.hours, 4.5);
  assert.equal(entry.manualHours, 4);
  assert.equal(entry.clockHours, 0.5);
});

test("porto clock entries are summed when no manual hour entry exists", () => {
  const context = loadHoursModuleWithState({
    hours: [
      { id: "porto-duty-a", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 0.2, source: "porto-duty-clock" },
      { id: "porto-duty-b", personId: "p1", weekYear: 2026, weekNumber: 26, minutes: 18, source: "porto-duty-clock" }
    ]
  });

  assert.equal(context.effectiveHourEntryFor("p1", 2026, 26).hours, 0.5);
});

test("overlapping porto clock intervals are counted once per person", () => {
  const context = loadHoursModuleWithState({
    hours: [
      {
        id: "porto-duty-u1-p1",
        personId: "p1",
        weekYear: 2026,
        weekNumber: 32,
        minutes: 270,
        startedAt: "2026-08-03T18:00:00.000Z",
        endedAt: "2026-08-03T22:30:00.000Z",
        source: "porto-duty-clock",
        sourceUnitId: "unit-a"
      },
      {
        id: "porto-duty-u2-p1",
        personId: "p1",
        weekYear: 2026,
        weekNumber: 32,
        minutes: 270,
        startedAt: "2026-08-03T18:00:00.000Z",
        endedAt: "2026-08-03T22:30:00.000Z",
        source: "porto-duty-clock",
        sourceUnitId: "unit-b"
      }
    ]
  });

  const entry = context.effectiveHourEntryFor("p1", 2026, 32);
  assert.equal(entry.hours, 4.5);
  assert.equal(entry.clockHours, 4.5);
});

test("month total ignores future weeks that are already saved in the same month", () => {
  const context = loadHoursModuleWithState({
    hours: [
      { id: "manual-p1-2026-23", personId: "p1", weekYear: 2026, weekNumber: 23, hours: 20.8, source: "Handmatig" },
      { id: "manual-p1-2026-24", personId: "p1", weekYear: 2026, weekNumber: 24, hours: 14.1, source: "Handmatig" },
      { id: "manual-p1-2026-25", personId: "p1", weekYear: 2026, weekNumber: 25, hours: 27.6, source: "Handmatig" },
      { id: "manual-p1-2026-26", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 15.8, source: "Handmatig" },
      { id: "manual-p1-2026-27", personId: "p1", weekYear: 2026, weekNumber: 27, hours: 4.4, source: "Handmatig" }
    ]
  });

  assert.equal(context.manualHoursForMonth({ id: "p1" }, new Date("2026-06-28T12:00:00Z")), 78.3);
});

test("operator hours are counted from porto duty clock entries", () => {
  const person = { id: "p1", name: "OPS Tester", serviceNumber: "70-01", completedOperational: ["OPS"] };
  const context = loadHoursModuleWithState({
    hours: [
      {
        id: "porto-duty-ops",
        personId: "p1",
        weekYear: 2026,
        weekNumber: 32,
        startedAt: "2026-08-03T10:00:00.000Z",
        endedAt: "2026-08-03T14:30:00.000Z",
        source: "porto-duty-clock",
        sourceVehicleNumber: "30-00"
      },
      {
        id: "porto-duty-normal",
        personId: "p1",
        weekYear: 2026,
        weekNumber: 32,
        startedAt: "2026-08-03T15:00:00.000Z",
        endedAt: "2026-08-03T20:00:00.000Z",
        source: "porto-duty-clock",
        sourceVehicleNumber: "30-01"
      }
    ],
    portoOpsLog: []
  }, {
    portalOperatorTraining: "OPS",
    portalOperatorVehicleNumber: "30-00"
  });

  assert.equal(context.opsHoursForWeek(person, { weekYear: 2026, weekNumber: 32 }), 4.5);
});

test("operator hours remain visible after current training state changes", () => {
  const person = { id: "p1", name: "OPS Tester", serviceNumber: "70-01", completedOperational: [] };
  const context = loadHoursModuleWithState({
    hours: [
      {
        id: "porto-duty-ops",
        personId: "p1",
        weekYear: 2026,
        weekNumber: 33,
        startedAt: "2026-08-16T14:30:00.000Z",
        endedAt: "2026-08-16T15:30:00.000Z",
        source: "porto-duty-clock",
        sourceVehicleNumber: "30-00"
      }
    ],
    portoOpsLog: [
      {
        id: "ops-log-extra-session",
        memberId: "p1",
        startedAt: "2026-08-16T16:00:00.000Z",
        endedAt: "2026-08-16T16:30:00.000Z",
        durationSeconds: 1800,
        endedByName: "Frank"
      }
    ]
  }, {
    portalOperatorTraining: "OPS",
    portalOperatorVehicleNumber: "30-00"
  });

  assert.equal(context.opsHoursForWeek(person, { weekYear: 2026, weekNumber: 33 }), 1.5);
});

test("operator hours merge old ops log entries with duty clock entries", () => {
  const person = { id: "p1", name: "OPS Tester", serviceNumber: "70-01", completedOperational: ["OPS"] };
  const context = loadHoursModuleWithState({
    hours: [
      {
        id: "porto-duty-ops",
        personId: "p1",
        weekYear: 2026,
        weekNumber: 32,
        startedAt: "2026-08-03T10:00:00.000Z",
        endedAt: "2026-08-03T12:00:00.000Z",
        source: "porto-duty-clock",
        sourceVehicleNumber: "30-00"
      }
    ],
    portoOpsLog: [
      {
        id: "ops-log-same-session",
        memberId: "p1",
        startedAt: "2026-08-03T10:00:00.000Z",
        endedAt: "2026-08-03T12:00:00.000Z",
        durationSeconds: 7200,
        endedByName: "Frank"
      },
      {
        id: "ops-log-extra-session",
        memberId: "p1",
        startedAt: "2026-08-04T10:00:00.000Z",
        endedAt: "2026-08-04T11:30:00.000Z",
        durationSeconds: 5400,
        endedByName: "Frank"
      }
    ]
  }, {
    portalOperatorTraining: "OPS",
    portalOperatorVehicleNumber: "30-00"
  });

  assert.equal(context.opsHoursForWeek(person, { weekYear: 2026, weekNumber: 32 }), 3.5);
});
