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

test("defensie new recruits have default Discord base roles configured", () => {
  const { organizationConfigs, organizationMainRoleId } = require("../modules/organizations");
  const defensie = organizationConfigs.defensie;

  assert.equal(organizationMainRoleId(defensie), "1423468016099918024");
  assert.deepEqual(defensie.discord.rankRoleEnvKeys["Marechaussee 4de Klasser"], {
    envKey: "DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID",
    defaultRoleId: "1423468808928104489"
  });
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
