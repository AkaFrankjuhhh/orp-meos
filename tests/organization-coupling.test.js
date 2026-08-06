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

test("obsolete defensie extra leadership badges are not exposed", () => {
  const { organizationConfigs } = require("../modules/organizations");
  const defensie = organizationConfigs.defensie;
  const obsoleteBadges = ["Directie", "Teamchef", "Co\u00f6rdinator"];
  const separatorBadges = defensie.discord.separatorRoleMappings.flatMap((mapping) => mapping.badges || []);
  const staticDataCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal-data.js"), "utf8");

  for (const badge of obsoleteBadges) {
    assert.equal(defensie.extraFunctions.includes(badge), false);
    assert.equal(defensie.discord.functionRoleMappings.some((mapping) => mapping.label === badge), false);
    assert.equal(separatorBadges.includes(badge), false);
    assert.equal(staticDataCode.includes(`"${badge}"`), false);
  }
});

test("defensie department leadership badges share Discord roles", () => {
  const { organizationConfigs } = require("../modules/organizations");
  const defensie = organizationConfigs.defensie;
  const mappings = new Map(defensie.discord.taskRoleMappings.map((mapping) => [mapping.label, mapping]));

  for (const badge of ["Directie Operatie", "Teamchef Operatie", "Co\u00f6rdinator Operatie"]) {
    assert.equal(defensie.extraTasks.includes(badge), true, `${badge} mist in extraTasks`);
    assert.equal(mappings.get(badge)?.envKey, "DISCORD_OPERATIE_LEIDING_ROLE_ID");
    assert.equal(mappings.get(badge)?.defaultRoleId, "1426544464293527684");
  }

  for (const badge of ["Directie W&S", "Teamchef W&S", "Co\u00f6rdinator W&S"]) {
    assert.equal(defensie.extraTasks.includes(badge), true, `${badge} mist in extraTasks`);
    assert.equal(mappings.get(badge)?.envKey, "DISCORD_WS_MANAGEMENT_ROLE_ID");
    assert.equal(mappings.get(badge)?.defaultRoleId, "1425219423849152512");
  }

  for (const badge of ["Directie OTC", "Teamchef OTC", "Co\u00f6rdinator Mentor", "Co\u00f6rdinator Trainer"]) {
    assert.equal(defensie.extraTasks.includes(badge), true, `${badge} mist in extraTasks`);
    assert.equal(mappings.get(badge)?.envKey, "DISCORD_OTC_LEIDING_ROLE_ID");
    assert.deepEqual(mappings.get(badge)?.envFallbackKeys, ["DISCORD_OTC_MANAGEMENT_ROLE_ID"]);
    assert.equal(mappings.get(badge)?.defaultRoleId, "1425219424872300667");
  }

  assert.equal(mappings.get("OTC-Leiding")?.envKey, "DISCORD_OTC_LEIDING_ROLE_ID");
  assert.equal(mappings.get("OTC-Leiding")?.defaultRoleId, "1425219424872300667");
});

test("defensie OTC role helpers honor the legacy management env fallback", () => {
  const previousOrganization = process.env.ORP_ORGANIZATION;
  const previousPrimary = process.env.DISCORD_OTC_LEIDING_ROLE_ID;
  const previousFallback = process.env.DISCORD_OTC_MANAGEMENT_ROLE_ID;
  process.env.ORP_ORGANIZATION = "defensie";
  delete process.env.DISCORD_OTC_LEIDING_ROLE_ID;
  process.env.DISCORD_OTC_MANAGEMENT_ROLE_ID = "legacy-otc-role";
  delete require.cache[require.resolve("../modules/organizations")];
  delete require.cache[require.resolve("../modules/discord-bot")];

  try {
    const { createDiscordBotServices } = require("../modules/discord-bot");
    const mappings = createDiscordBotServices().configuredRoleMappings();
    assert.equal(mappings.find((mapping) => mapping.label === "Co\u00f6rdinator Trainer")?.roleId, "legacy-otc-role");
    assert.equal(mappings.find((mapping) => mapping.label === "Directie OTC")?.roleId, "legacy-otc-role");
  } finally {
    if (previousOrganization === undefined) delete process.env.ORP_ORGANIZATION;
    else process.env.ORP_ORGANIZATION = previousOrganization;
    if (previousPrimary === undefined) delete process.env.DISCORD_OTC_LEIDING_ROLE_ID;
    else process.env.DISCORD_OTC_LEIDING_ROLE_ID = previousPrimary;
    if (previousFallback === undefined) delete process.env.DISCORD_OTC_MANAGEMENT_ROLE_ID;
    else process.env.DISCORD_OTC_MANAGEMENT_ROLE_ID = previousFallback;
    delete require.cache[require.resolve("../modules/organizations")];
    delete require.cache[require.resolve("../modules/discord-bot")];
  }
});

test("police and defensie expose K9 trainings in the profile", () => {
  const { organizationConfigs } = require("../modules/organizations");

  for (const key of ["defensie", "politie"]) {
    const trainings = organizationConfigs[key].profileTrainings;
    assert.ok(trainings.includes("K9"), `${key} mist K9 training`);
    assert.ok(trainings.includes("K9 Begeleider"), `${key} mist K9 Begeleider training`);
    assert.ok(trainings.indexOf("K9") < trainings.indexOf("K9 Begeleider"), `${key} K9 volgorde klopt niet`);
  }

  const politie = organizationConfigs.politie;
  assert.deepEqual(politie.defaultRecruitCompletedTrainings, ["Basis"]);
  assert.equal(politie.profileTrainingLabels.NH, "Noodhulp (NH)");
  assert.equal(politie.profileTrainingLabels.OFF, "Off-Road (OFF)");
  assert.equal(politie.profileTrainingLabels.ME, "Mobiele Eenheid (ME)");
  for (const [training, envKey, roleId, label] of [
    ["NH", "DISCORD_POLITIE_NH_ROLE_ID", "1468340097010368747", "Noodhulp (NH)"],
    ["TLO", "DISCORD_POLITIE_TLO_ROLE_ID", "1492543958935539735", "TLO"],
    ["OFF", "DISCORD_POLITIE_OFF_ROLE_ID", "1468338856553353256", "Off-Road (OFF)"],
    ["SIV", "DISCORD_POLITIE_SIV_ROLE_ID", "1468339057489739878", "SIV"],
    ["TMO", "DISCORD_POLITIE_TMO_ROLE_ID", "1468342410403909644", "TMO"],
    ["ZULU", "DISCORD_POLITIE_ZULU_ROLE_ID", "1468340559696367659", "ZULU"],
    ["OGM", "DISCORD_POLITIE_OGM_ROLE_ID", "1468339159889350736", "OGM"],
    ["ME", "DISCORD_POLITIE_ME_ROLE_ID", "1468339400969683117", "Mobiele Eenheid (ME)"],
    ["K9", "DISCORD_POLITIE_K9_ROLE_ID", "1527746931827277904", "K9"],
    ["K9 Begeleider", "DISCORD_POLITIE_K9_BEGELEIDER_ROLE_ID", "1468339725709480138", "Hondenbegeleider"]
  ]) {
    assert.ok(politie.profileTrainings.includes(training), `politie mist ${training} training`);
    assert.equal(politie.discord.qualificationRoleMappings[training].envKey, envKey);
    assert.equal(politie.discord.qualificationRoleMappings[training].defaultRoleId || "", roleId);
    assert.equal(politie.discord.qualificationRoleMappings[training].label, label);
  }
  assert.ok(politie.profileTrainings.includes("IBT"), "politie mist IBT training");
  assert.equal(politie.discord.qualificationRoleMappings.IBT, undefined);
  assert.deepEqual(politie.discord.separatorRoleMappings.map((mapping) => [mapping.label, mapping.envKey, mapping.defaultRoleId, mapping.always]), [
    ["Rang", "DISCORD_POLITIE_SEPARATOR_RANG_ROLE_ID", "1423472054136606761", true],
    ["Specialisaties", "DISCORD_POLITIE_SEPARATOR_SPECIALISATIES_ROLE_ID", "1486666494464098426", true],
    ["Porto", "DISCORD_POLITIE_SEPARATOR_PORTO_ROLE_ID", "1459368187480244384", true]
  ]);
});

test("public form threads use the shared portal or government bot token", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "modules", "discord-webhooks.js"), "utf8");

  assert.match(code, /DISCORD_BOT_TOKEN/);
  assert.match(code, /MAIN_GOVERNMENT_DISCORD_BOT_TOKEN/);
});

test("re-entry forms require submission within three months", () => {
  const defenceForms = loadPublicFormsForOrganization("defensie");
  const policeForms = loadPublicFormsForOrganization("politie");

  assert.match(defenceForms.publicFormFromSlug("herintrede").notice, /binnen 3 maanden na ontslag/);
  assert.match(policeForms.publicFormFromSlug("herintrede").notice, /binnen 3 maanden na ontslag/);
  assert.doesNotMatch(defenceForms.publicFormFromSlug("herintrede").notice, /6 maanden/);
  assert.doesNotMatch(policeForms.publicFormFromSlug("herintrede").notice, /6 maanden/);
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
  assert.equal(
    policeForms.publicFormFromSlug("klachten").systemNotice,
    "Let op: zonder bewijs wordt de zaak direct afgesloten."
  );
  assert.equal(
    policeForms.publicFormClientConfig(policeForms.publicFormFromSlug("klachten")).systemNotice,
    "Let op: zonder bewijs wordt de zaak direct afgesloten."
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

test("defensie officer leadership can manage I.O status", () => {
  withOrganization("defensie", () => {
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const organization = organizationConfigs.defensie;
    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });

    for (const permRole of ["Kader", "Hoofdofficier", "Officiersraad"]) {
      const permissions = services.permissionsForProfile({
        id: `defensie-${permRole}`,
        name: permRole,
        rank: "Wachtmeester",
        status: "Actief",
        permRole,
        badges: []
      });

      assert.equal(permissions.canManageInvestigationStatus, true, `${permRole} moet I.O kunnen aanpassen`);
    }
  });
});

test("OVC can view leadership pages without becoming Kader or Korpsleiding", () => {
  for (const key of ["defensie", "politie"]) {
    withOrganization(key, () => {
      const { organizationConfigs } = require("../modules/organizations");
      const { createPermissionServices } = require("../modules/permissions");
      const organization = organizationConfigs[key];
      const services = createPermissionServices({
        extraFunctions: organization.extraFunctions,
        extraTasks: organization.extraTasks,
        readState: () => ({ people: [] })
      });
      const permissions = services.permissionsForProfile({
        id: `${key}-ovc`,
        name: "OVC",
        rank: key === "politie" ? "Agent" : "Wachtmeester",
        status: "Actief",
        permRole: "OVC",
        badges: []
      });

      assert.equal(services.isKaderProfile({ permRole: "OVC", status: "Actief" }), false);
      assert.equal(permissions.canViewKaderPages, true);
      assert.equal(permissions.canManagePeople, false);
      assert.equal(permissions.canManagePersonnelRanks, false);
    });
  }
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

test("police board and HR can recruit and dismiss without full people management", () => {
  withOrganization("politie", () => {
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const organization = organizationConfigs.politie;
    assert.equal(organization.extraFunctions.includes("HR"), true);
    assert.equal(organization.extraTasks.includes("HR-Leiding"), true);
    assert.equal(organization.extraTasks.includes("HR-Assist. Leiding"), true);
    assert.equal(organization.extraTasks.includes("ME-Leiding"), true);
    assert.equal(organization.extraTasks.includes("ME-Assist. Leiding"), true);
    assert.equal(organization.sideTaskBadges.includes("Wijkagent-Leiding"), true);
    assert.equal(organization.sideTaskBadges.includes("Wijkagent-Assist. Leiding"), true);
    assert.equal(organization.sideTaskBadges.includes("Wijkagent"), true);
    assert.equal(organization.extraTasks.includes("OvJ-Assist. Leiding"), false);
    assert.equal(organization.extraTasks.includes("hOvJ-Assist. Leiding"), false);
    assert.equal(organization.discord.functionRoleMappings.some((mapping) => mapping.label === "HR" && mapping.envKey === "DISCORD_POLITIE_HR_ROLE_ID" && mapping.defaultRoleId === "1532700206175490200"), true);
    assert.equal(organization.discord.taskRoleMappings.some((mapping) => mapping.label === "HR-Leiding" && mapping.envKey === "DISCORD_POLITIE_HR_LEIDING_ROLE_ID" && mapping.defaultRoleId === "1532700114810835004"), true);
    assert.equal(organization.discord.taskRoleMappings.some((mapping) => mapping.label === "HR-Assist. Leiding" && mapping.envKey === "DISCORD_POLITIE_HR_ASSIST_LEIDING_ROLE_ID" && mapping.defaultRoleId === "1532700312333320244"), true);
    assert.equal(organization.discord.taskRoleMappings.some((mapping) => mapping.label === "ME-Leiding" && mapping.envKey === "DISCORD_POLITIE_ME_LEIDING_ROLE_ID" && mapping.defaultRoleId === "1514667369660944402"), true);
    assert.equal(organization.discord.taskRoleMappings.some((mapping) => mapping.label === "ME-Assist. Leiding" && mapping.envKey === "DISCORD_POLITIE_ME_ASSIST_LEIDING_ROLE_ID" && mapping.defaultRoleId === "1514667366540378112"), true);
    assert.equal(organization.discord.taskRoleMappings.some((mapping) => mapping.label === "Wijkagent" && mapping.envKey === "DISCORD_POLITIE_WIJKAGENT_ROLE_ID" && mapping.defaultRoleId === "1485639884252381316"), true);

    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });

    const profiles = [
      { id: "politie-inspecteur", name: "Inspecteur", rank: "Inspecteur", status: "Actief", permRole: "Geen", badges: [] },
      { id: "politie-hr", name: "HR", rank: "Agent", status: "Actief", permRole: "HR", badges: [] },
      { id: "politie-hr-leiding", name: "HR-Leiding", rank: "Agent", status: "Actief", permRole: "Geen", badges: ["HR-Leiding"] },
      { id: "politie-hr-assist", name: "HR-Assist", rank: "Agent", status: "Actief", permRole: "Geen", badges: ["HR-Assist. Leiding"] }
    ];

    for (const profile of profiles) {
      const permissions = services.permissionsForProfile(profile);
      assert.equal(permissions.canViewPersonnel, true);
      assert.equal(permissions.canViewRecruitment, true);
      assert.equal(permissions.canRecruitPeople, true);
      assert.equal(permissions.canDismissPersonnel, true);
      assert.equal(permissions.canManagePeople, false);
      assert.equal(permissions.canManagePersonnelRanks, false);
    }
  });
});

test("branch leadership can manage only its own profile badge", () => {
  for (const key of ["defensie", "politie"]) {
    withOrganization(key, () => {
      const { organizationConfigs } = require("../modules/organizations");
      const { createPermissionServices } = require("../modules/permissions");
      const organization = organizationConfigs[key];
      const services = createPermissionServices({
        extraFunctions: organization.extraFunctions,
        extraTasks: organization.extraTasks,
        readState: () => ({ people: [] })
      });
      const cases = [
        ["Trainer-Leiding", "Trainer"],
        ["Trainer-Assist. Leiding", "Trainer"],
        ["Mentor-Leiding", "Mentor"],
        ["Mentor-Assist. Leiding", "Mentor"],
        ["W&S-Leiding", "W&S"],
        ["W&S-Assist. Leiding", "W&S"],
        ["Directie W&S", "W&S"],
        ["Teamchef W&S", "W&S"],
        ["Co\u00f6rdinator W&S", "W&S"],
        ["Directie Operatie", "Operatie"],
        ["Teamchef Operatie", "Operatie"],
        ["Co\u00f6rdinator Operatie", "Operatie"],
        ["Co\u00f6rdinator Mentor", "Mentor"],
        ["Co\u00f6rdinator Trainer", "Trainer"],
        ["IZ-Leiding", "Interne-Zaken"],
        ["IZ-Assist. Leiding", "Interne-Zaken"],
        ["DSI-Leiding", "DSI"],
        ["KLu-Leiding", "KLu"],
        ["DNR-Leiding", "DNR"],
        ["Wijkagent-Leiding", "Wijkagent"],
        ["Wijkagent-Assist. Leiding", "Wijkagent"],
        ["VID-Leiding", "VID"],
        ["HRB-Leiding", "HRB"]
      ].filter(([leadershipBadge, targetBadge]) => organization.extraTasks.includes(leadershipBadge) && organization.extraTasks.includes(targetBadge));

      for (const [leadershipBadge, targetBadge] of cases) {
        const permissions = services.permissionsForProfile({
          id: `${key}-${leadershipBadge}`,
          name: leadershipBadge,
          rank: organization.ranks.at(-1),
          status: "Actief",
          permRole: "Geen",
          badges: [leadershipBadge]
        });

        assert.equal(permissions.canManageProfileBadges, true, `${key} ${leadershipBadge} should manage profile badges`);
        assert.equal(permissions.canManageAllProfileTaskBadges, false, `${key} ${leadershipBadge} should not manage all task badges`);
        assert.deepEqual(permissions.manageableProfileTaskBadges, [targetBadge]);
      }
    });
  }
});

test("defensie OTC department leadership can manage mentor and trainer badges", () => {
  withOrganization("defensie", () => {
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const organization = organizationConfigs.defensie;
    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });

    for (const badge of ["Directie OTC", "Teamchef OTC"]) {
      const permissions = services.permissionsForProfile({
        id: `defensie-${badge}`,
        name: badge,
        rank: "Wachtmeester",
        status: "Actief",
        permRole: "Geen",
        badges: [badge]
      });

      assert.equal(permissions.canManageProfileBadges, true);
      assert.deepEqual(permissions.manageableProfileTaskBadges, ["Mentor", "Trainer"]);
      assert.equal(permissions.canViewMentorOverview, true);
    }

    for (const [badge, manageableBadges] of [
      ["Co\u00f6rdinator Mentor", ["Mentor"]],
      ["Co\u00f6rdinator Trainer", ["Trainer"]]
    ]) {
      const permissions = services.permissionsForProfile({
        id: `defensie-${badge}`,
        name: badge,
        rank: "Wachtmeester",
        status: "Actief",
        permRole: "Geen",
        badges: [badge]
      });

      assert.equal(permissions.canManageProfileBadges, true);
      assert.deepEqual(permissions.manageableProfileTaskBadges, manageableBadges);
      assert.equal(permissions.canViewMentorOverview, true);
    }
  });
});

test("HR leadership can manage the police HR function without full people management", () => {
  withOrganization("politie", () => {
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const organization = organizationConfigs.politie;
    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });
    for (const badge of ["HR-Leiding", "HR-Assist. Leiding"]) {
      const permissions = services.permissionsForProfile({
        id: `politie-${badge}`,
        name: badge,
        rank: "Agent",
        status: "Actief",
        permRole: "Geen",
        badges: [badge]
      });

      assert.equal(permissions.canManageProfileBadges, true);
      assert.equal(permissions.canManagePeople, false);
      assert.deepEqual(permissions.manageableProfileFunctionBadges, ["HR"]);
    }
  });
});

test("branch leadership can see only manageable restricted badges", () => {
  withOrganization("defensie", () => {
    delete require.cache[require.resolve("../modules/organizations")];
    delete require.cache[require.resolve("../modules/permissions")];
    delete require.cache[require.resolve("../modules/personeelsportaal-domain")];
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const { createPersoneelsportaalDomain } = require("../modules/personeelsportaal-domain");
    const organization = organizationConfigs.defensie;
    const permissions = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    }).permissionsForProfile({
      id: "dsi-leiding",
      name: "DSI-Leiding",
      rank: "Marechaussee 1ste Klasser",
      status: "Actief",
      permRole: "Geen",
      badges: ["DSI-Leiding"]
    });
    const filtered = createPersoneelsportaalDomain().stateForProfile({
      people: [
        { id: "dsi-leiding", name: "DSI-Leiding", badges: ["DSI-Leiding"] },
        { id: "target", name: "Target", badges: ["DSI", "KLu", "Mentor"] }
      ]
    }, permissions, "dsi-leiding");
    const target = filtered.people.find((person) => person.id === "target");

    assert.deepEqual(target.badges, ["DSI", "Mentor"]);
  });
});

test("profile notes are scoped to self unless leadership may view all", () => {
  withOrganization("defensie", () => {
    delete require.cache[require.resolve("../modules/organizations")];
    delete require.cache[require.resolve("../modules/permissions")];
    delete require.cache[require.resolve("../modules/personeelsportaal-domain")];
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const { createPersoneelsportaalDomain } = require("../modules/personeelsportaal-domain");
    const organization = organizationConfigs.defensie;
    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });
    const state = {
      people: [
        { id: "self", name: "Eigen", extraFunctions: [], badges: [], profileNote: { text: "Eigen notitie" } },
        { id: "target", name: "Doelwit", extraFunctions: [], badges: [], profileNote: { text: "Niet zichtbaar" } }
      ]
    };
    const normalPermissions = services.permissionsForProfile({
      id: "self",
      name: "Eigen",
      rank: "Marechaussee 2de Klasser",
      status: "Actief",
      permRole: "Geen",
      extraFunctions: [],
      badges: []
    });
    const domain = createPersoneelsportaalDomain();
    const saved = domain.savePerson(state, {
      id: "self",
      name: "Eigen",
      discordId: "123",
      rank: "Marechaussee 2de Klasser",
      serviceNumber: "74-01"
    });
    assert.equal(saved.person.profileNote.text, "Eigen notitie");

    const normalFiltered = domain.stateForProfile(state, normalPermissions, "self");

    assert.equal(normalFiltered.people.find((person) => person.id === "self").profileNote.text, "Eigen notitie");
    assert.equal(normalFiltered.people.find((person) => person.id === "target").profileNote, null);

    const officerPermissions = services.permissionsForProfile({
      id: "self",
      name: "Officier",
      rank: "Marechaussee 2de Klasser",
      status: "Actief",
      permRole: "Geen",
      extraFunctions: ["Officiersraad"],
      badges: []
    });
    const officerFiltered = domain.stateForProfile(state, officerPermissions, "self");

    assert.equal(officerFiltered.people.find((person) => person.id === "target").profileNote.text, "Niet zichtbaar");
  });
});
