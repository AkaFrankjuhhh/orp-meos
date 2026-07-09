const assert = require("node:assert/strict");
const test = require("node:test");

function loadDomainForOrganization(organizationKey) {
  const previous = process.env.ORP_ORGANIZATION;
  process.env.ORP_ORGANIZATION = organizationKey;
  delete require.cache[require.resolve("../modules/organizations")];
  delete require.cache[require.resolve("../modules/personeelsportaal-domain")];
  const { createPersoneelsportaalDomain } = require("../modules/personeelsportaal-domain");
  const domain = createPersoneelsportaalDomain();
  if (previous === undefined) delete process.env.ORP_ORGANIZATION;
  else process.env.ORP_ORGANIZATION = previous;
  delete require.cache[require.resolve("../modules/organizations")];
  delete require.cache[require.resolve("../modules/personeelsportaal-domain")];
  return domain;
}

test("police promotion assigns the next free number from the target rank range", () => {
  const { promotePerson } = loadDomainForOrganization("politie");
  const person = {
    id: "p1",
    name: "Agent Test",
    discordId: "123",
    rank: "Agent",
    serviceNumber: "27-27",
    status: "Actief",
    rankHistory: []
  };
  const state = { people: [person], activity: [] };

  const result = promotePerson(state, person);

  assert.equal(result.ok, true);
  assert.equal(person.rank, "Hoofdagent");
  assert.equal(person.serviceNumber, "26-53");
});

test("police can save a custom call sign in the correct rank prefix", () => {
  const { savePerson } = loadDomainForOrganization("politie");
  const state = { people: [], activity: [] };

  const result = savePerson(state, {
    id: "p1",
    name: "Hoofdagent Test",
    discordId: "123",
    rank: "Hoofdagent",
    serviceNumber: "26-99",
    hiredDate: "2026-06-29",
    rankDate: "2026-06-29",
    promotionDate: "2026-06-29"
  });

  assert.equal(result.error, undefined);
  assert.equal(result.person.serviceNumber, "26-99");
});

test("police edit rank automatically moves the call sign to the new rank range", () => {
  const { savePerson } = loadDomainForOrganization("politie");
  const state = {
    people: [{
      id: "p1",
      name: "Rang Wissel",
      discordId: "123",
      rank: "Hoofdagent",
      serviceNumber: "26-53",
      status: "Actief",
      hiredDate: "2026-06-29",
      rankDate: "2026-06-29",
      promotionDate: "2026-06-29",
      rankHistory: []
    }],
    activity: []
  };

  const result = savePerson(state, {
    id: "p1",
    name: "Rang Wissel",
    discordId: "123",
    rank: "Brigadier",
    serviceNumber: "26-53",
    hiredDate: "2026-06-29",
    rankDate: "2026-07-09",
    promotionDate: "2026-07-09"
  });

  assert.equal(result.error, undefined);
  assert.equal(result.person.rank, "Brigadier");
  assert.equal(result.person.serviceNumber, "25-33");
  assert.equal(result.person.rankHistory.at(-1).serviceNumber, "25-33");
});

test("police custom call sign must still match the rank prefix and be unique", () => {
  const { savePerson } = loadDomainForOrganization("politie");
  const state = {
    people: [{
      id: "p1",
      name: "Bestaand",
      discordId: "123",
      rank: "Hoofdagent",
      serviceNumber: "26-99",
      status: "Actief",
      rankHistory: []
    }],
    activity: []
  };

  const wrongPrefix = savePerson(state, {
    id: "p2",
    name: "Verkeerde Prefix",
    discordId: "456",
    rank: "Hoofdagent",
    serviceNumber: "27-99",
    hiredDate: "2026-06-29",
    rankDate: "2026-06-29",
    promotionDate: "2026-06-29"
  });
  const duplicate = savePerson(state, {
    id: "p3",
    name: "Dubbel",
    discordId: "789",
    rank: "Hoofdagent",
    serviceNumber: "26-99",
    hiredDate: "2026-06-29",
    rankDate: "2026-06-29",
    promotionDate: "2026-06-29"
  });

  assert.equal(wrongPrefix.error, "Dienstnummer hoort niet bij deze ranggroep.");
  assert.equal(duplicate.error, "Dienstnummer is al in gebruik.");
});

test("police startup migration moves only wrong prefixes to the rank range", () => {
  const { normalizeServiceNumbersForRankRanges } = loadDomainForOrganization("politie");
  const wrongPrefix = {
    id: "p1",
    name: "Hoofdagent Oud",
    discordId: "123",
    rank: "Hoofdagent",
    serviceNumber: "21-04",
    status: "Actief",
    rankHistory: []
  };
  const customCorrectPrefix = {
    id: "p2",
    name: "Hoofdagent Custom",
    discordId: "456",
    rank: "Hoofdagent",
    serviceNumber: "26-99",
    status: "Actief",
    rankHistory: []
  };
  const state = { people: [wrongPrefix, customCorrectPrefix], activity: [] };

  const changed = normalizeServiceNumbersForRankRanges(state, { actorName: "test" });

  assert.equal(changed.length, 1);
  assert.equal(wrongPrefix.serviceNumber, "26-53");
  assert.equal(customCorrectPrefix.serviceNumber, "26-99");
  assert.equal(wrongPrefix.rankHistory.at(-1).previousServiceNumber, "21-04");
});
