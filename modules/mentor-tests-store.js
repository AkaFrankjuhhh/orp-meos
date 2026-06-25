const crypto = require("node:crypto");
const { withTransaction, withClient } = require("./db");

const DEFAULT_MENTOR_TEST_QUESTIONS = [
  { id: "douane_gebieden", type: "textarea", label: "Wat zijn de douane gebieden?" },
  {
    id: "fouilleren",
    type: "checkbox",
    label: "Wanneer mag je fouilleren?",
    options: [
      "Als je iemand aanhoudt",
      "Als iemand te hard rijdt",
      "In een douanegebied",
      "Als iemand je uitscheldt",
      "Als je iemand insluit in de gevangenis",
      "Als iemand vervelend doet",
      "Als iemand geen ID kaart of rijbewijs wilt geven"
    ]
  },
  { id: "collega_neergeschoten", type: "textarea", label: "Je collega is neergeschoten, de verdachte stapt in de auto en gaat er vandoor, wat doe je?" },
  { id: "statussen", type: "textarea", label: "Wat zijn de statussen?" },
  { id: "rechten_aanhouding", type: "textarea", label: "Welke rechten lees je voor bij een aanhouding?" },
  { id: "uitdienst_spullen", type: "textarea", label: "Je bent uitdienst gegaan omdat je iets anders gaat doen, Mag jij bepaalde spullen uitdienst op zak hebben?" },
  { id: "pit_snelheid", type: "textarea", label: "Tot welke snelheid mag je pitten?" },
  { id: "steekwapen_wet", type: "textarea", label: "Onder welke wet in ons wetboek valt een steekwapen?" },
  { id: "huisvrede_lokaalvrede", type: "textarea", label: "Wat is het verschil tussen huisvredebreuk en lokaalvredebreuk?" },
  { id: "moord_doodslag", type: "textarea", label: "Wat is het verschil met moord en doodslag?" },
  { id: "wanneer_i8", type: "textarea", label: "Wanneer vul je een I8 in?" }
];

function templateSettingsKey(organization) {
  return `mentor_test_template:${organization || "defensie"}`;
}

function normalizeQuestionId(value, fallback) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function normalizeQuestion(question, index) {
  const label = String(question?.label || "").trim().slice(0, 500);
  if (!label) return null;
  const type = question?.type === "checkbox" ? "checkbox" : "textarea";
  const normalized = {
    id: normalizeQuestionId(question?.id || label, `vraag-${index + 1}`),
    type,
    label
  };
  if (type === "checkbox") {
    const seen = new Set();
    normalized.options = (Array.isArray(question?.options) ? question.options : [])
      .map((option) => String(option || "").trim().slice(0, 300))
      .filter((option) => {
        if (!option || seen.has(option)) return false;
        seen.add(option);
        return true;
      });
    if (!normalized.options.length) return null;
  } else {
    normalized.options = [];
  }
  return normalized;
}

function normalizeQuestions(rawQuestions) {
  const normalized = (Array.isArray(rawQuestions) ? rawQuestions : [])
    .map((question, index) => normalizeQuestion(question, index))
    .filter(Boolean);
  return normalized.length ? normalized : DEFAULT_MENTOR_TEST_QUESTIONS.map((question, index) => normalizeQuestion(question, index));
}

function questionsForClient(questions = DEFAULT_MENTOR_TEST_QUESTIONS) {
  return normalizeQuestions(questions).map((question) => ({
    id: question.id,
    type: question.type,
    label: question.label,
    options: Array.isArray(question.options) ? [...question.options] : []
  }));
}

function questionsFromRaw(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return questionsForClient(value.questions || value.mentorTestQuestions || DEFAULT_MENTOR_TEST_QUESTIONS);
}

async function loadQuestionTemplate(organization, client = null) {
  const runner = client
    ? (callback) => callback(client)
    : (callback) => withClient(callback);
  const result = await runner((activeClient) => activeClient.query(
    "select value from app_settings where key = $1 limit 1",
    [templateSettingsKey(organization)]
  ));
  return questionsForClient(result.rows[0]?.value?.questions || DEFAULT_MENTOR_TEST_QUESTIONS);
}

async function saveQuestionTemplate({ organization, questions }) {
  const normalized = questionsForClient(questions);
  await withClient((client) => client.query(
    `insert into app_settings(key, value, updated_at)
     values($1, $2::jsonb, now())
     on conflict (key) do update
     set value = excluded.value,
         updated_at = excluded.updated_at`,
    [templateSettingsKey(organization), JSON.stringify({ questions: normalized })]
  ));
  return normalized;
}

function rowToTest(row) {
  if (!row) return null;
  return {
    id: row.id,
    organization: row.organization,
    personId: row.person_id,
    personName: row.person_name || "",
    serviceNumber: row.service_number || "",
    rank: row.rank || "",
    status: row.status || "sent",
    answers: row.answers || {},
    sentById: row.sent_by_id || "",
    sentByName: row.sent_by_name || "",
    sentAt: row.sent_at,
    submittedAt: row.submitted_at,
    reviewedById: row.reviewed_by_id || "",
    reviewedByName: row.reviewed_by_name || "",
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note || "",
    questions: questionsFromRaw(row.raw),
    updatedAt: row.updated_at
  };
}

function normalizeTextAnswer(value) {
  return String(value || "").trim().slice(0, 4000);
}

function normalizeAnswers(rawAnswers = {}, questions = DEFAULT_MENTOR_TEST_QUESTIONS) {
  const answers = {};
  for (const question of questionsForClient(questions)) {
    if (question.type === "checkbox") {
      const selected = Array.isArray(rawAnswers[question.id]) ? rawAnswers[question.id] : [];
      const allowed = new Set(question.options || []);
      answers[question.id] = selected
        .map((value) => String(value || "").trim())
        .filter((value, index, list) => value && allowed.has(value) && list.indexOf(value) === index);
    } else {
      answers[question.id] = normalizeTextAnswer(rawAnswers[question.id]);
    }
  }
  return answers;
}

function validateAnswers(rawAnswers = {}, questions = DEFAULT_MENTOR_TEST_QUESTIONS) {
  const normalizedQuestions = questionsForClient(questions);
  const answers = normalizeAnswers(rawAnswers, normalizedQuestions);
  const missing = normalizedQuestions.filter((question) => {
    const value = answers[question.id];
    return question.type === "checkbox" ? !Array.isArray(value) || value.length === 0 : !value;
  });
  return { ok: missing.length === 0, answers, missing };
}

function createMentorTestsStore() {
  async function latestForPerson(organization, personId) {
    const result = await withClient((client) => client.query(
      `select *
       from mentor_tests
       where organization = $1 and person_id = $2
       order by updated_at desc, sent_at desc
       limit 1`,
      [organization, personId]
    ));
    return rowToTest(result.rows[0]);
  }

  async function latestOpenForPerson(organization, personId) {
    const result = await withClient((client) => client.query(
      `select *
       from mentor_tests
       where organization = $1
         and person_id = $2
         and status in ('sent', 'submitted')
       order by updated_at desc, sent_at desc
       limit 1`,
      [organization, personId]
    ));
    return rowToTest(result.rows[0]);
  }

  async function list(organization, limit = 200) {
    const result = await withClient((client) => client.query(
      `select *
       from mentor_tests
       where organization = $1
       order by updated_at desc, sent_at desc
       limit $2`,
      [organization, Math.max(1, Math.min(500, Number(limit) || 200))]
    ));
    return result.rows.map(rowToTest);
  }

  async function createOrReset({ organization, person, actor }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    return withTransaction(async (client) => {
      const questions = await loadQuestionTemplate(organization, client);
      await client.query(
        `update mentor_tests
         set status = 'cancelled',
             updated_at = $3,
             reviewed_at = $3,
             reviewed_by_id = $4,
             reviewed_by_name = $5,
             review_note = 'Nieuwe mentor-toets gestuurd.'
         where organization = $1
           and person_id = $2
           and status in ('sent', 'submitted')`,
        [organization, person.id, now, actor.id || "", actor.name || ""]
      );
      const result = await client.query(
        `insert into mentor_tests(
          id, organization, person_id, person_name, service_number, rank,
          status, answers, sent_by_id, sent_by_name, sent_at, updated_at, raw
        )
        values($1, $2, $3, $4, $5, $6, 'sent', '{}'::jsonb, $7, $8, $9, $9, $10)
        returning *`,
        [
          id,
          organization,
          person.id,
          person.name || "",
          person.serviceNumber || "",
          person.rank || "",
          actor.id || "",
          actor.name || "",
          now,
          JSON.stringify({ questionVersion: 1, questions })
        ]
      );
      return rowToTest(result.rows[0]);
    });
  }

  async function resendOpenForPerson({ organization, personId, actor }) {
    const now = new Date().toISOString();
    const result = await withClient((client) => client.query(
      `update mentor_tests
       set status = 'sent',
           sent_by_id = $3,
           sent_by_name = $4,
           sent_at = $5,
           updated_at = $5
       where id = (
         select id
         from mentor_tests
         where organization = $1
           and person_id = $2
           and status in ('sent', 'submitted')
         order by updated_at desc, sent_at desc
         limit 1
       )
       returning *`,
      [organization, personId, actor?.id || "", actor?.name || "", now]
    ));
    if (!result.rows[0]) {
      const error = new Error("Er staat geen open mentor-toets klaar.");
      error.status = 404;
      throw error;
    }
    return rowToTest(result.rows[0]);
  }

  async function retractOpenForPerson({ organization, personId, actor }) {
    const now = new Date().toISOString();
    const result = await withClient((client) => client.query(
      `update mentor_tests
       set status = 'retracted',
           reviewed_by_id = $3,
           reviewed_by_name = $4,
           reviewed_at = $5,
           review_note = 'Mentor-toets teruggetrokken.',
           updated_at = $5
       where id = (
         select id
         from mentor_tests
         where organization = $1
           and person_id = $2
           and status in ('sent', 'submitted')
         order by updated_at desc, sent_at desc
         limit 1
       )
       returning *`,
      [organization, personId, actor?.id || "", actor?.name || "", now]
    ));
    if (!result.rows[0]) {
      const error = new Error("Er staat geen open mentor-toets klaar.");
      error.status = 404;
      throw error;
    }
    return rowToTest(result.rows[0]);
  }

  async function submit({ organization, personId, answers }) {
    const now = new Date().toISOString();
    return withTransaction(async (client) => {
      const openResult = await client.query(
        `select *
         from mentor_tests
         where organization = $1
           and person_id = $2
           and status = 'sent'
         order by sent_at desc
         limit 1`,
        [organization, personId]
      );
      const openTest = openResult.rows[0];
      if (!openTest) {
        const error = new Error("Er staat geen open mentor-toets klaar.");
        error.status = 404;
        throw error;
      }
      const questions = questionsFromRaw(openTest.raw);
      const validation = validateAnswers(answers, questions);
      if (!validation.ok) {
        const error = new Error("Niet alle verplichte vragen zijn ingevuld.");
        error.status = 400;
        error.missing = validation.missing.map((question) => question.id);
        throw error;
      }
      const result = await client.query(
        `update mentor_tests
         set status = 'submitted',
             answers = $2::jsonb,
             submitted_at = $3,
             updated_at = $3
         where id = $1
         returning *`,
        [openTest.id, JSON.stringify(validation.answers), now]
      );
      return rowToTest(result.rows[0]);
    });
  }

  async function review({ organization, id, status, actor, reviewNote = "" }) {
    if (!["approved", "rejected"].includes(status)) {
      const error = new Error("Ongeldige beoordeling.");
      error.status = 400;
      throw error;
    }
    const now = new Date().toISOString();
    const result = await withClient((client) => client.query(
      `update mentor_tests
       set status = $3,
           reviewed_by_id = $4,
           reviewed_by_name = $5,
           reviewed_at = $6,
           review_note = $7,
           updated_at = $6
       where organization = $1
         and id = $2
         and status = 'submitted'
       returning *`,
      [organization, id, status, actor.id || "", actor.name || "", now, String(reviewNote || "").trim().slice(0, 1000)]
    ));
    if (!result.rows[0]) {
      const error = new Error("Mentor-toets niet gevonden of al beoordeeld.");
      error.status = 404;
      throw error;
    }
    return rowToTest(result.rows[0]);
  }

  return {
    questionsForClient,
    questionsForOrganization: loadQuestionTemplate,
    saveQuestions: saveQuestionTemplate,
    validateAnswers,
    latestForPerson,
    latestOpenForPerson,
    list,
    createOrReset,
    resendOpenForPerson,
    retractOpenForPerson,
    submit,
    review
  };
}

module.exports = {
  createMentorTestsStore,
  questionsForClient,
  validateAnswers
};
