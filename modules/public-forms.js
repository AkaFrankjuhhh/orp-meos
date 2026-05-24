const crypto = require("node:crypto");
const { URL } = require("node:url");

const publicFormConfigs = {
  herintrede: {
    slug: "herintrede",
    hostnames: ["herintrede.orpdefensie.nl"],
    title: "ORP - Herintredingsformulier Defensie",
    subtitle: "Ben jij in het verleden Defensie geweest? Dan kan je via deze weg aangeven dat je terug wil komen. We streven ernaar om binnen een week te reageren.",
    notice: "Houd er rekening mee dat jij niet terug komt op je oude rang. Ook dien je minimaal de rang Wachtmeester te zijn geweest en moet dit formulier binnen 6 maanden na ontslag ingediend zijn.",
    accent: "#f59e0b",
    webhookEnv: "DISCORD_FORM_HERINTREDE_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Volledige naam", type: "text", required: true, placeholder: "Voor- en achternaam" },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true, placeholder: "Naam#0000 / Discord ID" },
      { id: "previousRank", label: "Welke rang was je?", type: "select", required: true, options: ["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal", "Kolonel", "Luitenant-Kolonel", "Majoor", "Kapitein", "Eerste-Luitenant", "Tweede-Luitenant", "Kornet", "Adjudant", "Opperwachtmeester", "Wachtmeester 1ste Klasser", "Wachtmeester"] },
      { id: "leftReason", label: "Wat was de reden dat jij weg was gegaan?", type: "textarea", required: true, help: "LET OP: Was je ontslagen? Dan mag jij niet op deze manier herintreden." },
      { id: "returnReason", label: "Wat is de reden waarom je terug wil komen binnen Defensie?", type: "textarea", required: true }
    ]
  },
  overstap: {
    slug: "overstap",
    hostnames: ["overstap.orpdefensie.nl"],
    title: "ORP - Overstapformulier Defensie",
    subtitle: "Ben jij momenteel politie? Dan kan je via deze weg aangeven dat je wil overstappen. Let op dat je maximaal kan intreden op Mar. 1ste klasse.",
    accent: "#f59e0b",
    webhookEnv: "DISCORD_FORM_OVERSTAP_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Volledige naam", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "currentDepartment", label: "Waar ben je momenteel werkzaam?", type: "text", required: true, placeholder: "Bijv. Politie / eenheid" },
      { id: "switchReason", label: "Wat is de reden dat je wil overstappen naar Defensie?", type: "textarea", required: true },
      { id: "goal", label: "Wat wil je bereiken binnen Defensie?", type: "textarea", required: true },
      { id: "knowledge", label: "Wat weet je over Defensie?", type: "textarea", required: true }
    ]
  },
  klachten: {
    slug: "klachten",
    hostnames: ["klachten.orpdefensie.nl"],
    title: "ORP - Klachtenformulier Defensie",
    subtitle: "Gebruik dit formulier om een klacht of melding richting Defensie Oranjestad door te geven.",
    accent: "#ef4444",
    webhookEnv: "DISCORD_FORM_KLACHTEN_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Volledige naam", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "category", label: "Categorie", type: "select", required: true, options: ["Klacht over medewerker", "Klacht over procedure", "Ongepast gedrag", "Overig"] },
      { id: "involved", label: "Betrokken persoon/personen", type: "text", required: false },
      { id: "description", label: "Beschrijf de klacht zo duidelijk mogelijk", type: "textarea", required: true },
      { id: "evidence", label: "Bewijs of links", type: "textarea", required: false },
      { id: "desiredOutcome", label: "Wat zou voor jou een passende oplossing zijn?", type: "textarea", required: false }
    ]
  },
  otc: {
    slug: "otc",
    hostnames: ["otc.orpdefensie.nl"],
    title: "ORP - OTC Aanmeldformulier",
    subtitle: "Aanmelding voor het opleidings- en trainingscentrum van Defensie Oranjestad.",
    accent: "#38bdf8",
    webhookEnv: "DISCORD_FORM_OTC_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", label: "Huidige rang", type: "text", required: true },
      { id: "motivation", label: "Waarom wil je deelnemen aan OTC?", type: "textarea", required: true },
      { id: "experience", label: "Welke relevante ervaring heb je?", type: "textarea", required: false },
      { id: "availability", label: "Wanneer ben je beschikbaar?", type: "textarea", required: true }
    ]
  },
  hrb: {
    slug: "hrb",
    hostnames: ["hrb.orpdefensie.nl"],
    title: "Eskadron Hoog Risico Beveiliging",
    subtitle: "Sollicitatieproces voor de functie operator binnen de HRB. Zorg dat je motivatie duidelijk op papier staat.",
    notice: "Eisen: minimale rang Wachtmeester, consequente inzet en motivatie, betrouwbaarheid, goede samenwerking en stressbestendigheid.",
    accent: "#64748b",
    webhookEnv: "DISCORD_FORM_HRB_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "intro", label: "Vertel iets korts over jezelf", type: "textarea", required: true },
      { id: "sideTasks", label: "Heb je nog andere neventaken/functies, zo ja welke?", type: "textarea", required: true },
      { id: "knowledge", label: "Wat weet jij over de HRB?", type: "textarea", required: true },
      { id: "strengths", label: "Noem 3 goede eigenschappen van jezelf en leg deze uit.", type: "textarea", required: true },
      { id: "weaknesses", label: "Noem 3 slechte eigenschappen van jezelf die jou mogelijk in de weg kunnen zitten om bij de HRB te komen.", type: "textarea", required: true },
      { id: "motivation", label: "Wat is jouw motivatie om binnen de HRB te komen?", type: "textarea", required: true },
      { id: "whyAccept", label: "Waarom zouden wij jou moeten aannemen?", type: "textarea", required: true },
      { id: "goal", label: "Wat wil jij bereiken binnen de HRB?", type: "textarea", required: true },
      { id: "questions", label: "Heb jij nog verdere vragen en/of opmerkingen?", type: "textarea", required: false }
    ]
  },
  "w-s": {
    slug: "w-s",
    aliases: ["w&s", "ws"],
    hostnames: ["w-s.orpdefensie.nl", "ws.orpdefensie.nl"],
    title: "ORP - Werving & Selectie",
    subtitle: "Aanmelding voor werkzaamheden binnen Werving & Selectie.",
    accent: "#f59e0b",
    webhookEnv: "DISCORD_FORM_WS_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", label: "Huidige rang", type: "text", required: true },
      { id: "motivation", label: "Waarom wil je bij W&S?", type: "textarea", required: true },
      { id: "experience", label: "Welke ervaring heb je met aannames of gesprekken?", type: "textarea", required: false },
      { id: "availability", label: "Wanneer ben je beschikbaar voor W&S werkzaamheden?", type: "textarea", required: true }
    ]
  },
  hovj: {
    slug: "hovj",
    hostnames: ["hovj.orpdefensie.nl"],
    title: "ORP - hOvJ Aanmeldformulier",
    subtitle: "Aanmelding voor hOvJ werkzaamheden binnen Defensie Oranjestad.",
    accent: "#60a5fa",
    webhookEnv: "DISCORD_FORM_HOVJ_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", label: "Huidige rang", type: "text", required: true },
      { id: "i8Knowledge", label: "Wat weet jij over I8 formulieren?", type: "textarea", required: true },
      { id: "decisionMaking", label: "Hoe ga jij om met objectief beoordelen?", type: "textarea", required: true },
      { id: "motivation", label: "Waarom wil jij hOvJ worden?", type: "textarea", required: true }
    ]
  }
};

function normalizeSlug(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["w&s", "wens", "ws"].includes(raw)) return "w-s";
  return raw.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function publicFormFromHost(hostHeader) {
  const host = String(hostHeader || "").split(":")[0].toLowerCase();
  return Object.values(publicFormConfigs).find((config) => (config.hostnames || []).includes(host)) || null;
}

function publicFormFromSlug(slug) {
  const normalized = normalizeSlug(slug);
  return Object.values(publicFormConfigs).find((config) => config.slug === normalized || (config.aliases || []).includes(normalized)) || null;
}

function publicFormForRequest(req, url) {
  return publicFormFromHost(req.headers["x-forwarded-host"] || req.headers.host) || publicFormFromSlug(url.searchParams.get("form") || url.pathname.split("/").filter(Boolean)[1]);
}

function publicFormClientConfig(config) {
  if (!config) return null;
  return {
    slug: config.slug,
    title: config.title,
    subtitle: config.subtitle || "",
    notice: config.notice || "",
    accent: config.accent || "#f59e0b",
    questions: config.questions || []
  };
}

function validatePublicFormSubmission(config, answers) {
  const cleanAnswers = {};
  const errors = [];
  for (const question of config.questions || []) {
    const value = String(answers?.[question.id] || "").trim();
    if (question.required && !value) errors.push(`${question.label} is verplicht.`);
    cleanAnswers[question.id] = value.slice(0, question.type === "textarea" ? 4000 : 500);
  }
  return { cleanAnswers, errors };
}

function createPublicFormSubmission(config, answers, req) {
  return {
    id: crypto.randomUUID(),
    formSlug: config.slug,
    formTitle: config.title,
    answers,
    submittedAt: new Date().toISOString(),
    ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500)
  };
}

function publicFormWebhookUrl(config) {
  return process.env[config.webhookEnv] || process.env.DISCORD_PUBLIC_FORMS_WEBHOOK_URL || "";
}

function buildPublicFormWebhookPayload(config, submission) {
  const fields = (config.questions || []).map((question) => {
    const value = submission.answers?.[question.id] || "-";
    return {
      name: question.label,
      value: value.length > 1024 ? `${value.slice(0, 1018)}...` : value,
      inline: false
    };
  });
  return {
    embeds: [
      {
        title: `Nieuwe inzending: ${config.title}`,
        color: Number.parseInt(String(config.accent || "#f59e0b").replace("#", ""), 16) || 0xf59e0b,
        fields,
        footer: { text: `Formulier: ${config.slug}` },
        timestamp: submission.submittedAt
      }
    ]
  };
}

module.exports = {
  publicFormConfigs,
  publicFormForRequest,
  publicFormFromSlug,
  publicFormClientConfig,
  validatePublicFormSubmission,
  createPublicFormSubmission,
  publicFormWebhookUrl,
  buildPublicFormWebhookPayload
};