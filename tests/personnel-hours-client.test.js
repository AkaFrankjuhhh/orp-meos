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

test("manual hour entry wins over porto clock entries for the same person and week", () => {
  const context = loadHoursModuleWithState({
    hours: [
      { id: "porto-duty-a", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 0.2, source: "porto-duty-clock" },
      { id: "porto-duty-b", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 0.3, source: "porto-duty-clock" },
      { id: "manual-p1-2026-26", personId: "p1", weekYear: 2026, weekNumber: 26, hours: 4, source: "Handmatig" }
    ]
  });

  assert.equal(context.effectiveHourEntryFor("p1", 2026, 26).hours, 4);
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
