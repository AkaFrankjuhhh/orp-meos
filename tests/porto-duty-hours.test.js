"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPortoDutyHourEntries } = require("../modules/porto-duty-hours");

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
