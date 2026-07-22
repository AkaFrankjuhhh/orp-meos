const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function withOrganization(key, fn) {
  const previous = process.env.ORP_ORGANIZATION;
  process.env.ORP_ORGANIZATION = key;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ORP_ORGANIZATION;
    else process.env.ORP_ORGANIZATION = previous;
  }
}

function loadPublicFormsForOrganization(key) {
  return withOrganization(key, () => {
    delete require.cache[require.resolve("../modules/organizations")];
    delete require.cache[require.resolve("../modules/public-forms")];
    const publicForms = require("../modules/public-forms");
    delete require.cache[require.resolve("../modules/organizations")];
    delete require.cache[require.resolve("../modules/public-forms")];
    return publicForms;
  });
}

test("discord worker uses organization porto operator number for lead nickname context", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");

  assert.match(code, /organization\.porto\?\.operatorVehicleNumber/);
  assert.doesNotMatch(code, /unit\.vehicleNumber === "30-00"/);
});

test("porto unlink assigns the next regular unit instead of reusing the operator range", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const unlinkBlock = code.slice(code.indexOf("if (unlink) {"), code.indexOf("if (offDuty) {"));

  assert.match(unlinkBlock, /firstAvailableRegularVehicleNumber\(state\)/);
  assert.doesNotMatch(unlinkBlock, /firstAvailableVehicleNumber\(state,\s*currentRange\.prefix\)/);
  assert.match(unlinkBlock, /const targetRange = vehicleRangeForNumber\(state, vehicleNumber\) \|\| currentRange/);
});

test("porto duty roles include K9 for police and defensie", () => {
  const routeCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const dutyUiCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const mainUiCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const opsUiCode = fs.readFileSync(path.join(process.cwd(), "porto", "ops.js"), "utf8");
  const postgresStoreCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-postgres-store.js"), "utf8");
  const postgresStateCode = fs.readFileSync(path.join(process.cwd(), "modules", "postgres-state.js"), "utf8");

  assert.match(routeCode, /\/api\/porto\/duty-role/);
  assert.match(routeCode, /key: "K9"[\s\S]*requiresK9Name: true/);
  assert.match(routeCode, /key: "K9_BEGELEIDER"[\s\S]*K9 Begeleider/);
  assert.match(routeCode, /Vul eerst je K9-Naam in op je Porto-profiel/);
  assert.match(routeCode, /canPersonUsePortoDutyRole/);
  assert.match(botCode, /K9: `K9-\$\{dutySuffix\}`/);
  assert.match(botCode, /K9_BEGELEIDER: `K9B-\$\{dutySuffix\}`/);
  assert.match(mainUiCode, /requiresK9Name: true/);
  assert.match(mainUiCode, /K9_BEGELEIDER/);
  assert.match(mainUiCode, /"OC overzicht"/);
  assert.match(dutyUiCode, /data-duty-role/);
  assert.match(postgresStoreCode, /"K9", "K9_BEGELEIDER"/);
  assert.match(postgresStateCode, /"K9", "K9_BEGELEIDER"/);
  assert.match(opsUiCode, /memberNameTitle/);
  assert.match(opsUiCode, /GEEN IBT/);
});

test("defensie new recruits have default Discord base roles configured", () => {
  const { organizationConfigs, organizationMainRoleId } = require("../modules/organizations");
  const defensie = organizationConfigs.defensie;

  assert.equal(organizationMainRoleId(defensie), "1423468016099918024");
  assert.deepEqual(defensie.discord.rankRoleEnvKeys["Marechaussee 4de Klasser"], {
    envKey: "DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID",
    defaultRoleId: "1423468808928104489"
  });
});

test("police and defensie expose K9 trainings in the profile", () => {
  const { organizationConfigs } = require("../modules/organizations");

  for (const key of ["defensie", "politie"]) {
    const trainings = organizationConfigs[key].profileTrainings;
    assert.ok(trainings.includes("K9"), `${key} mist K9 training`);
    assert.ok(trainings.includes("K9 Begeleider"), `${key} mist K9 Begeleider training`);
    assert.ok(trainings.indexOf("K9") < trainings.indexOf("K9 Begeleider"), `${key} K9 volgorde klopt niet`);
  }
});

test("public form threads use the shared portal or government bot token", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "modules", "discord-webhooks.js"), "utf8");

  assert.match(code, /DISCORD_BOT_TOKEN/);
  assert.match(code, /MAIN_GOVERNMENT_DISCORD_BOT_TOKEN/);
});

test("police has a DSI public form with police intake questions", () => {
  const policeForms = loadPublicFormsForOrganization("politie");
  const defenceForms = loadPublicFormsForOrganization("defensie");
  const dsi = policeForms.publicFormFromSlug("dsi");

  assert.ok(dsi);
  assert.equal(dsi.slug, "dsi");
  assert.deepEqual(dsi.hostnames, ["dsi.orppolitie.nl"]);
  assert.match(dsi.title, /Sollicitatieformulier/);
  assert.match(dsi.subtitle, /Dienst Speciale Interventies/);
  assert.equal(dsi.internalOnly, true);
  assert.equal(dsi.webhookEnv, "DISCORD_FORM_DSI_WEBHOOK_URL");
  assert.deepEqual(dsi.pages.map((page) => page.id), ["persoonlijk", "motivatie", "kennis", "scenarios", "porto"]);
  assert.equal(dsi.questions.length, 22);
  assert.ok(dsi.questions.find((question) => question.id === "policeRank")?.options.includes("Commissaris"));
  assert.ok(dsi.questions.find((question) => question.id === "portoWeaponReport")?.help.includes("50-03"));
  assert.notEqual(dsi.questions.length, policeForms.publicFormFromSlug("bsb").questions.length);
  assert.equal(defenceForms.publicFormFromSlug("dsi"), null);

  const answers = Object.fromEntries(dsi.questions.map((question) => [question.id, question.type === "select" ? question.options[0] : "Test"]));
  const payload = policeForms.buildPublicFormWebhookPayload(dsi, {
    formScope: "Intern",
    formSlug: "dsi",
    formTitle: dsi.title,
    answers,
    submittedBy: { name: "AkaFrank" },
    submittedAt: "2026-07-05T12:00:00.000Z"
  });
  const embedTitles = payload.embeds.map((embed) => embed.title);

  assert.ok(embedTitles.includes("Persoonlijke Gegevens"));
  assert.ok(embedTitles.includes("Motivatie"));
  assert.ok(embedTitles.includes("Kennisvragen"));
  assert.ok(embedTitles.includes("Scenario's"));
  assert.ok(embedTitles.includes("Porto & Communicatie"));
  assert.equal(policeForms.publicFormSubmissionThreadName(dsi, { submittedBy: { name: "AkaFrank" }, answers }), "DSI Sollicitatie AkaFrank");
  assert.equal(
    policeForms.publicFormSubmissionThreadName(policeForms.publicFormFromSlug("hovj"), { submittedBy: { name: "AkaFrank" }, answers: {} }),
    "Sollicitatie hulpofficier van justitie (hOvJ) AkaFrank"
  );
  assert.equal(
    policeForms.publicFormSubmissionThreadName(policeForms.publicFormFromSlug("klachten"), { caseNumber: 12 }),
    "zaaknummer 012"
  );
});

test("defence has an IBT review form on the IBT toets domain", () => {
  const defenceForms = loadPublicFormsForOrganization("defensie");
  const policeForms = loadPublicFormsForOrganization("politie");
  const ibt = defenceForms.publicFormFromSlug("ibt");

  assert.ok(ibt);
  assert.equal(ibt.slug, "ibt");
  assert.deepEqual(ibt.hostnames, ["ibt-toets.orpdefensie.nl", "ibt.orpdefensie.nl"]);
  assert.equal(defenceForms.publicFormForRequest(
    { headers: { host: "ibt-toets.orpdefensie.nl" } },
    new URL("https://ibt-toets.orpdefensie.nl/")
  ).slug, "ibt");
  assert.equal(ibt.internalOnly, true);
  assert.equal(ibt.reviewable, true);
  assert.equal(ibt.reviewTraining, "IBT");
  assert.equal(ibt.reviewSurface, "portal");
  assert.deepEqual(ibt.reviewBadges, ["Trainer", "Trainer-Leiding"]);
  assert.equal(ibt.webhookEnv, "DISCORD_FORM_IBT_WEBHOOK_URL");
  assert.equal(ibt.questions.length, 12);
  assert.ok(ibt.questions.find((question) => question.id === "nameAndServiceNumber")?.profileBacked);
  assert.ok(ibt.questions.find((question) => question.id === "btgpMeaning"));
  assert.ok(ibt.questions.find((question) => question.id === "subsidiarity"));
  assert.equal(
    defenceForms.publicFormClientConfig(ibt, { name: "Rik Klomp", serviceNumber: "74-03" })
      .questions.some((question) => question.id === "nameAndServiceNumber"),
    false
  );
  assert.equal(
    defenceForms.applyProfileAnswersToPublicForm(ibt, {}, { name: "Rik Klomp", serviceNumber: "74-03" }).nameAndServiceNumber,
    "Rik Klomp - 74-03"
  );
  assert.equal(policeForms.publicFormFromSlug("ibt"), null);
});

test("VID form uses active confidants as preferred contact options", () => {
  const defenceForms = loadPublicFormsForOrganization("defensie");
  const vid = defenceForms.publicFormFromSlug("vid");
  const runtimeVid = defenceForms.withPublicFormRuntimeOptions(vid, {
    people: [
      { id: "vid-1", name: "Vera Integriteit", serviceNumber: "74-10", rank: "Majoor", status: "Actief", badges: ["VID"] },
      { id: "vid-2", name: "Levi Leiding", serviceNumber: "74-11", rank: "Kolonel", status: "Actief", badges: ["VID-Leiding"] },
      { id: "old-vid", name: "Oud VID", serviceNumber: "74-12", rank: "Kapitein", status: "Uit dienst", badges: ["VID"] },
      { id: "trainer", name: "Tessa Trainer", serviceNumber: "74-13", rank: "Kapitein", status: "Actief", badges: ["Trainer"] }
    ]
  });
  const preferredConfidant = runtimeVid.questions.find((question) => question.id === "preferredConfidant");

  assert.equal(preferredConfidant.type, "select");
  assert.deepEqual(preferredConfidant.options.map((option) => option.label), [
    "74-10 - Vera Integriteit (Majoor)",
    "74-11 - Levi Leiding (Kolonel)"
  ]);
  assert.equal(
    defenceForms.validatePublicFormSubmission(runtimeVid, { preferredConfidant: "Niemand uit de VID lijst" }).errors[0],
    "Eventueel voorkeur vertrouwenspersoon bevat een onbekende keuze."
  );
});

test("mentor tests are not hard-coded to defensie only", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");

  assert.doesNotMatch(code, /organization\.key === "defensie" && Boolean\(mentorTestsStore\)/);
  assert.match(code, /mentorTestsStore && mentorRanks\.length/);
});

test("police leadership can view I8, mentor and discipline without becoming OvJ reviewers", () => {
  withOrganization("politie", () => {
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const organization = organizationConfigs.politie;
    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });

    for (const permRole of ["Korpsleiding", "Bestuur"]) {
      const permissions = services.permissionsForProfile({
        id: `politie-${permRole}`,
        name: permRole,
        rank: "Agent",
        status: "Actief",
        permRole,
        badges: []
      });

      assert.equal(permissions.canViewOvJChannels, true);
      assert.equal(permissions.canReviewI8Forms, false);
      assert.equal(permissions.canViewMentorOverview, true);
      assert.equal(permissions.canViewAllDiscipline, true);
      assert.equal(permissions.canViewAllHours, true);
      assert.equal(permissions.canViewPersonnel, true);
    }
  });
});
