const assert = require("node:assert/strict");
const test = require("node:test");
const { missingPromotionRequirements } = require("../modules/promotion-requirements");
const { organizationConfigs } = require("../modules/organizations");
const { createDiscordBotServices } = require("../modules/discord-bot");

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

test("department leadership badges do not satisfy the regular promotion task requirement", () => {
  const person = {
    rank: "Wachtmeester",
    completedTrainings: ["BKV", "IBT", "Mentor-Traject", "KW", "TMO"],
    completedOperational: ["OPS"],
    badges: ["Directie Operatie", "Teamchef W&S", "Co\u00f6rdinator Trainer"]
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

test("Defensie Discord training-needed roles follow missing promotion trainings only", () => {
  const previousOrganization = process.env.ORP_ORGANIZATION;
  process.env.ORP_ORGANIZATION = "defensie";
  try {
    const bot = createDiscordBotServices();
    const newRecruit = {
      rank: "Marechaussee 4de Klasser",
      status: "Actief",
      completedTrainings: [],
      completedOperational: []
    };
    const bkvComplete = {
      ...newRecruit,
      completedTrainings: ["BKV"]
    };
    const marechausseeFirstClass = {
      rank: "Marechaussee 1ste Klasser",
      status: "Actief",
      completedTrainings: ["BKV", "IBT", "Mentor-Traject"],
      completedOperational: []
    };
    const marechausseeFirstClassKwDone = {
      ...marechausseeFirstClass,
      completedTrainings: [...marechausseeFirstClass.completedTrainings, "KW"]
    };

    assert.deepEqual(bot.missingTrainingRequirementsForPerson(newRecruit), ["BKV"]);
    assert.deepEqual(bot.missingTrainingRequirementsForPerson(bkvComplete), []);
    assert.deepEqual(bot.missingTrainingRequirementsForPerson(marechausseeFirstClass), ["KW"]);
    assert.deepEqual(bot.missingTrainingRequirementsForPerson(marechausseeFirstClassKwDone), []);
  } finally {
    if (previousOrganization === undefined) {
      delete process.env.ORP_ORGANIZATION;
    } else {
      process.env.ORP_ORGANIZATION = previousOrganization;
    }
  }
});
