const test = require("node:test");
const assert = require("node:assert/strict");

const { createPersoneelsportaalRouteHandler } = require("../modules/personeelsportaal-routes");
const { createDiscordWebhookServices } = require("../modules/discord-webhooks");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createRouteHarness(initialState) {
  let storedState = clone(initialState);
  let requestBody = {};
  const webhookPayloads = [];
  const discordSyncJobs = [];
  const { buildDismissalWebhookPayload } = createDiscordWebhookServices({ formatDate: (value) => value });

  const handler = createPersoneelsportaalRouteHandler({
    requireAuth: () => ({ profile: { id: "actor-1", name: "Lynn Moosdijk" } }),
    readState: () => clone(storedState),
    writeState: (state) => {
      storedState = clone(state);
    },
    readBody: () => clone(requestBody),
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.payload = payload;
    },
    hasKaderAccess: () => true,
    hasPermission: () => true,
    permissionsForAuth: () => ({ canManagePeople: true }),
    stateForProfile: (state) => state,
    normalizeDiscordId: (value) => String(value || "").trim(),
    today: () => "2026-07-19",
    addMonths: () => "2027-01-19",
    autoSortServiceNumbers: () => {},
    getAvailableServiceNumbers: () => [],
    savePerson: () => ({ ok: true }),
    promotePerson: () => ({ ok: true }),
    demotePerson: () => ({ ok: true }),
    assignFirstAvailableServiceNumber: (state, person) => {
      if (!person.serviceNumber) person.serviceNumber = person.previousServiceNumber || "74-24";
    },
    normalizeMentorNotes: (value) => value,
    ranks: ["Generaal", "Adjudant", "Marechaussee 2de Klasser"],
    profileTrainings: [],
    profileOperational: [],
    extraFunctions: [],
    extraTasks: [],
    disciplineTypes: [],
    disciplineLabels: {},
    mentorRanks: [],
    mentorChecklistCount: 0,
    mentorTrainingName: "",
    defaultRecruitRank: "Marechaussee 2de Klasser",
    sendDiscordWebhook: async (url, payload) => {
      webhookPayloads.push({ url, payload });
      return { ok: true, status: 204 };
    },
    absenceWebhookUrl: () => "",
    personnelWebhookUrl: () => "https://discord.example/webhook",
    buildAbsenceWebhookPayload: () => ({}),
    buildRecruitmentWebhookPayload: () => ({}),
    buildDismissalWebhookPayload,
    buildResignationFormWebhookPayload: () => ({}),
    buildBlacklistWebhookPayload: () => ({}),
    buildInvestigationWebhookPayload: () => ({}),
    discordBot: null,
    enqueuePersonDiscordSync: async (person, reason, options) => {
      discordSyncJobs.push({ person: clone(person), reason, options: clone(options || {}) });
    }
  });

  return {
    handler,
    webhookPayloads,
    discordSyncJobs,
    state: () => clone(storedState),
    setBody: (body) => {
      requestBody = clone(body);
    }
  };
}

async function post(handler, path) {
  const res = {};
  await handler({ method: "POST", url: path }, res, new URL(path, "http://localhost"));
  return res;
}

test("direct dismissal is idempotent and keeps the released service number", async () => {
  const harness = createRouteHarness({
    people: [
      { id: "actor-1", name: "Lynn Moosdijk", rank: "Generaal", serviceNumber: "00-01", status: "Actief" },
      {
        id: "person-1",
        name: "Kevlar de Jong",
        avatar: "https://cdn.example/kevlar.png",
        rank: "Marechaussee 2de Klasser",
        serviceNumber: "74-33",
        status: "Actief",
        permRole: "Medewerker"
      }
    ],
    activity: []
  });
  harness.setBody({ reason: "inactief" });

  const first = await post(harness.handler, "/api/people/person-1/dismiss");
  const afterFirst = harness.state().people.find((person) => person.id === "person-1");

  assert.equal(first.statusCode, 200);
  assert.equal(harness.webhookPayloads.length, 1);
  assert.equal(afterFirst.status, "Ontslagen");
  assert.equal(afterFirst.serviceNumber, "");
  assert.equal(afterFirst.previousServiceNumber, "74-33");
  assert.equal(
    harness.webhookPayloads[0].payload.embeds[0].fields.find((field) => field.name === "Personeelslid").value,
    "74-33 - Kevlar de Jong"
  );

  const second = await post(harness.handler, "/api/people/person-1/dismiss");
  const afterSecond = harness.state().people.find((person) => person.id === "person-1");

  assert.equal(second.statusCode, 200);
  assert.equal(harness.webhookPayloads.length, 1);
  assert.equal(afterSecond.previousServiceNumber, "74-33");
});

test("dismissal webhook avoids markdown list formatting when no service number is known", () => {
  const { buildDismissalWebhookPayload } = createDiscordWebhookServices({ formatDate: (value) => value });

  const payload = buildDismissalWebhookPayload(
    { name: "Kevlar de Jong", previousServiceNumber: "" },
    { releasedNumber: "", date: "2026-07-19", reason: "inactief" },
    { name: "Lynn Moosdijk" }
  );

  const memberField = payload.embeds[0].fields.find((field) => field.name === "Personeelslid");
  assert.equal(memberField.value, "Geen roepnummer - Kevlar de Jong");
  assert.doesNotMatch(memberField.value, /^- - /);
});

test("restored personnel queues Discord profile sync with role propagation retries", async () => {
  const harness = createRouteHarness({
    people: [
      { id: "actor-1", name: "Lynn Moosdijk", rank: "Generaal", serviceNumber: "00-01", status: "Actief" },
      {
        id: "person-1",
        name: "Beeps Valenti",
        discordId: "1142183276845469697",
        rank: "Marechaussee 1ste Klasser",
        previousServiceNumber: "74-24",
        serviceNumber: "",
        status: "Ontslagen",
        permRole: "Geen"
      }
    ],
    activity: []
  });
  harness.setBody({ rank: "Marechaussee 2de Klasser" });

  const response = await post(harness.handler, "/api/people/person-1/restore");
  const restoredPerson = harness.state().people.find((person) => person.id === "person-1");

  assert.equal(response.statusCode, 200);
  assert.equal(restoredPerson.status, "Actief");
  assert.equal(restoredPerson.rank, "Marechaussee 2de Klasser");
  assert.equal(restoredPerson.serviceNumber, "74-24");
  assert.equal(harness.discordSyncJobs.length, 1);
  assert.equal(harness.discordSyncJobs[0].reason, "person_restore");
  assert.equal(harness.discordSyncJobs[0].options.maxAttempts, 288);
});
