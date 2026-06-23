const crypto = require("node:crypto");
const { withTransaction, withClient } = require("./db");

const MENTOR_TEST_QUESTIONS = [
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

function questionsForClient() {
  return MENTOR_TEST_QUESTIONS.map((question) => ({
    id: question.id,
    type: question.type,
    label: question.label,
    options: Array.isArray(question.options) ? [...question.options] : []
  }));
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
    updatedAt: row.updated_at
  };
}

function normalizeTextAnswer(value) {
  return String(value || "").trim().slice(0, 4000);
}

function normalizeAnswers(rawAnswers = {}) {
  const answers = {};
  for (const question of MENTOR_TEST_QUESTIONS) {
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

function validateAnswers(rawAnswers = {}) {
  const answers = normalizeAnswers(rawAnswers);
  const missing = MENTOR_TEST_QUESTIONS.filter((question) => {
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
          JSON.stringify({ questionVersion: 1 })
        ]
      );
      return rowToTest(result.rows[0]);
    });
  }

  async function submit({ organization, personId, answers }) {
    const validation = validateAnswers(answers);
    if (!validation.ok) {
      const error = new Error("Niet alle verplichte vragen zijn ingevuld.");
      error.status = 400;
      error.missing = validation.missing.map((question) => question.id);
      throw error;
    }
    const now = new Date().toISOString();
    const result = await withClient((client) => client.query(
      `with picked as (
         select id
         from mentor_tests
         where organization = $1
           and person_id = $2
           and status = 'sent'
         order by sent_at desc
         limit 1
       )
       update mentor_tests
       set status = 'submitted',
           answers = $3::jsonb,
           submitted_at = $4,
           updated_at = $4
       where id in (select id from picked)
       returning *`,
      [organization, personId, JSON.stringify(validation.answers), now]
    ));
    if (!result.rows[0]) {
      const error = new Error("Er staat geen open mentor-toets klaar.");
      error.status = 404;
      throw error;
    }
    return rowToTest(result.rows[0]);
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
    validateAnswers,
    latestForPerson,
    latestOpenForPerson,
    list,
    createOrReset,
    submit,
    review
  };
}

module.exports = {
  createMentorTestsStore,
  questionsForClient,
  validateAnswers
};
