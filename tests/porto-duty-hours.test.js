"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPortoDutyHourEntries,
  filterPortoDutyHourEntriesByStartWeek,
  portoDutyHourCleanupGroups
} = require("../modules/porto-duty-hours");

test("porto diensturen splitsen over operationele weekgrens en nemen gekoppelde leden mee", () => {
  const state = {
    people: [
      { id: "p1", name: "Frank Bright", serviceNumber: "70-04", discordId: "1" },
      { id: "p2", name: "Jan Versteeg", serviceNumber: "71-01", discordId: "2" }
    ],
    portoUnits: [
      {
        id: "unit-30-01",
        memberId: "p1",
        status: "1",
        assignedAt: "2026-06-21T16:30:00.000Z",
        linkedWith: ["p2"]
      }
    ]
  };

  const entries = buildPortoDutyHourEntries(state, {
    now: "2026-06-21T18:30:00.000Z",
    timeZone: "Europe/Amsterdam"
  });

  assert.equal(entries.length, 4);
  const p1Week25 = entries.find((entry) => entry.personId === "p1" && entry.weekNumber === 25);
  const p1Week26 = entries.find((entry) => entry.personId === "p1" && entry.weekNumber === 26);
  const p2Week25 = entries.find((entry) => entry.personId === "p2" && entry.weekNumber === 25);
  const p2Week26 = entries.find((entry) => entry.personId === "p2" && entry.weekNumber === 26);

  assert.equal(p1Week25.minutes, 30);
  assert.equal(p1Week26.minutes, 90);
  assert.equal(p2Week25.minutes, 30);
  assert.equal(p2Week26.minutes, 90);
  assert.equal(p1Week25.source, "porto-duty-clock");
  assert.match(p1Week25.id, /^porto-duty-unit-30-01-/);
});

test("porto diensturen gebruiken endedAt en slaan units zonder starttijd over", () => {
  const state = {
    people: [{ id: "p1", name: "Frank Bright", serviceNumber: "70-04", discordId: "1" }],
    portoUnits: [
      {
        id: "unit-30-00",
        memberId: "p1",
        status: "8",
        assignedAt: "2026-06-22T10:00:00.000Z",
        endedAt: "2026-06-22T11:15:00.000Z"
      },
      {
        id: "unit-30-01",
        memberId: "p1",
        status: "0"
      }
    ]
  };

  const entries = buildPortoDutyHourEntries(state, {
    now: "2026-06-22T12:00:00.000Z",
    timeZone: "Europe/Amsterdam"
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].minutes, 75);
  assert.equal(entries[0].hours, 1.25);
  assert.equal(entries[0].job, "Porto dienst");
});

test("porto diensturen tellen gekoppelde leden niet dubbel wanneer iedereen een eigen unit heeft", () => {
  const state = {
    people: [
      { id: "p1", name: "Jan Versteeg", serviceNumber: "71-01", discordId: "1" },
      { id: "p2", name: "Harry Geerlings", serviceNumber: "73-12", discordId: "2" }
    ],
    portoUnits: [
      {
        id: "unit-30-01-p1",
        memberId: "p1",
        vehicleNumber: "30-01",
        status: "1",
        assignedAt: "2026-08-03T10:00:00.000Z",
        linkedWith: ["Harry Geerlings"]
      },
      {
        id: "unit-30-01-p2",
        memberId: "p2",
        vehicleNumber: "30-01",
        status: "1",
        assignedAt: "2026-08-03T10:00:00.000Z",
        linkedWith: ["Jan Versteeg"]
      }
    ]
  };

  const entries = buildPortoDutyHourEntries(state, {
    now: "2026-08-03T12:00:00.000Z",
    timeZone: "Europe/Amsterdam"
  });

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => [entry.personId, entry.minutes]).sort(), [
    ["p1", 120],
    ["p2", 120]
  ]);
});

test("porto diensturen tellen pas vanaf ingestelde startweek", () => {
  const state = {
    people: [{ id: "p1", name: "Frank Bright", serviceNumber: "70-04", discordId: "1" }],
    portoUnits: [
      {
        id: "unit-30-01",
        memberId: "p1",
        status: "1",
        assignedAt: "2026-06-21T16:30:00.000Z"
      }
    ]
  };

  const entries = buildPortoDutyHourEntries(state, {
    now: "2026-06-21T18:30:00.000Z",
    timeZone: "Europe/Amsterdam",
    startWeek: "2026-W26"
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].weekYear, 2026);
  assert.equal(entries[0].weekNumber, 26);
  assert.equal(entries[0].minutes, 90);
});

test("oude porto-klokuren worden gefilterd maar handmatige uren blijven", () => {
  const entries = [
    { id: "manual-week-25", weekYear: 2026, weekNumber: 25, hours: 12, source: "manual" },
    { id: "porto-duty-old", weekYear: 2026, weekNumber: 25, hours: 3, source: "porto-duty-clock" },
    { id: "porto-duty-new", weekYear: 2026, weekNumber: 26, hours: 1, source: "porto-duty-clock" }
  ];

  assert.deepEqual(
    filterPortoDutyHourEntriesByStartWeek(entries, "2026-W26").map((entry) => entry.id),
    ["manual-week-25", "porto-duty-new"]
  );
});

test("porto duty cleanup groups target stale rows for the same source unit and week", () => {
  const groups = portoDutyHourCleanupGroups([
    { id: "porto-duty-u1-a", personId: "p1", sourceUnitId: "u1", weekYear: 2026, weekNumber: 32, source: "porto-duty-clock" },
    { id: "porto-duty-u1-b", personId: "p2", sourceUnitId: "u1", weekYear: 2026, weekNumber: 32, source: "porto-duty-clock" },
    { id: "manual", personId: "p1", sourceUnitId: "u1", weekYear: 2026, weekNumber: 32, source: "manual" }
  ]);

  assert.deepEqual(groups, [
    { sourceUnitId: "u1", weekYear: 2026, weekNumber: 32, ids: ["porto-duty-u1-a", "porto-duty-u1-b"] }
  ]);
});
