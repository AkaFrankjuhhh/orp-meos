const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHoursModuleWithState(state) {
  const code = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "hours.js"), "utf8");
  const context = {
    state,
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
