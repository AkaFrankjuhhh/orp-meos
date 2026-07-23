const assert = require("node:assert/strict");
const test = require("node:test");

const {
  currentPersonByDiscordIdMap,
  findPersonByDiscordId,
  findPersonByIdOrDiscordId,
  preferCurrentPeople
} = require("../modules/people-identity");

test("people identity prefers current profiles over archived profiles for the same Discord ID", () => {
  const people = [
    { id: "old", name: "Beeps oud", discordId: "123", status: "Ontslagen", updatedAt: "2026-07-23T10:00:00Z" },
    { id: "current", name: "Beeps nieuw", discordId: "123", status: "Actief", updatedAt: "2026-07-22T10:00:00Z" }
  ];

  assert.equal(findPersonByDiscordId(people, "123").id, "current");
  assert.deepEqual(preferCurrentPeople(people).map((person) => person.id), ["current"]);
  assert.equal(currentPersonByDiscordIdMap(people).get("123").id, "current");
});

test("people identity keeps exact personId matches for archive-specific jobs", () => {
  const people = [
    { id: "old", discordId: "123", status: "Ontslagen" },
    { id: "current", discordId: "123", status: "Actief" }
  ];

  assert.equal(findPersonByIdOrDiscordId(people, { personId: "old", discordId: "123" }).id, "old");
  assert.equal(findPersonByIdOrDiscordId(people, { discordId: "123" }).id, "current");
});
