const assert = require("node:assert/strict");
const test = require("node:test");
const { missingPromotionRequirements } = require("../modules/promotion-requirements");
const { organizationConfigs } = require("../modules/organizations");

test("Marechaussee 4de Klasser needs BKV before promotion to 3de Klasser", () => {
  const person = {
    rank: "Marechaussee 4de Klasser",
    completedTrainings: [],
    completedOperational: []
  };

  assert.deepEqual(
    missingPromotionRequirements(organizationConfigs.defensie, person, "Marechaussee 3de Klasser"),
    ["BKV"]
  );
});

test("Marechaussee 4de Klasser with BKV satisfies promotion training requirement", () => {
  const person = {
    rank: "Marechaussee 4de Klasser",
    completedTrainings: ["BKV"],
    completedOperational: []
  };

  assert.deepEqual(
    missingPromotionRequirements(organizationConfigs.defensie, person, "Marechaussee 3de Klasser"),
    []
  );
});
