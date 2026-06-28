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
    missingPromotionRequirements(organizationConfigs.defensie, person, "Marechaussee 4de Klasser"),
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
    missingPromotionRequirements(organizationConfigs.defensie, person, "Marechaussee 4de Klasser"),
    []
  );
});

test("Wachtmeester needs promotion task badge before promotion to 1ste Klasser", () => {
  const person = {
    rank: "Wachtmeester",
    completedTrainings: ["BKV", "IBT", "Mentor-Traject", "KW", "TMO"],
    completedOperational: ["OPS"],
    badges: []
  };

  assert.deepEqual(
    missingPromotionRequirements(organizationConfigs.defensie, person, "Wachtmeester"),
    ["Mentor/Trainer/Interne-Zaken/hOvJ/W&S"]
  );
});

test("Marechaussee 1ste Klasser does not need promotion task badge before Wachtmeester", () => {
  const person = {
    rank: "Marechaussee 1ste Klasser",
    completedTrainings: ["BKV", "IBT", "Mentor-Traject", "KW"],
    completedOperational: [],
    badges: []
  };

  assert.deepEqual(
    missingPromotionRequirements(organizationConfigs.defensie, person, "Marechaussee 1ste Klasser"),
    []
  );
});
