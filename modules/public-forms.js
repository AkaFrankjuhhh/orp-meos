const crypto = require("node:crypto");
const { URL } = require("node:url");
const { currentOrganization } = require("./organizations");

const organization = currentOrganization();
const publicFormDomain = organization.key === "politie" ? "orppolitie.nl" : "orpdefensie.nl";
const overheidPublicFormDomain = process.env.OVERHEID_PUBLIC_FORM_DOMAIN || "orpoverheid.nl";

function formHosts(...subdomains) {
  return subdomains.map((subdomain) => `${subdomain}.${publicFormDomain}`);
}

function overheidFormHosts(...subdomains) {
  return subdomains.map((subdomain) => `${subdomain}.${overheidPublicFormDomain}`);
}

const publicFormConfigs = {
  herintrede: {
    slug: "herintrede",
    hostnames: formHosts("herintrede"),
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
    hostnames: formHosts("overstap"),
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
    hostnames: overheidFormHosts("klachten"),
    title: "ORP - Klachtenformulier",
    subtitle: "Gebruik dit formulier om een klacht of melding richting Politie of Defensie Oranjestad door te geven.",
    accent: "#ef4444",
    webhookEnv: "DISCORD_FORM_KLACHTEN_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Volledige naam", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "organization", label: "Waar gaat de klacht over?", type: "select", required: true, options: ["Defensie", "Politie", "Beide / overheid", "Onbekend"] },
      { id: "category", label: "Categorie", type: "select", required: true, options: ["Klacht over medewerker", "Klacht over procedure", "Ongepast gedrag", "Overig"] },
      { id: "involved", label: "Betrokken persoon/personen", type: "text", required: false },
      { id: "description", label: "Beschrijf de klacht zo duidelijk mogelijk", type: "textarea", required: true },
      { id: "evidence", label: "Bewijs of links", type: "textarea", required: false },
      { id: "attachment", label: "Bijlage", type: "file", required: false, accept: ".png,.jpg,.jpeg,.webp", help: "Optioneel: voeg maximaal 1 foto toe als bewijs. Maximaal 8 MB. Links naar Medal/YouTube kunnen in het tekstveld." },
      { id: "desiredOutcome", label: "Wat zou voor jou een passende oplossing zijn?", type: "textarea", required: false }
    ]
  },
  otc: {
    slug: "otc",
    aliases: organization.key === "politie" ? ["trainer"] : [],
    hostnames: organization.key === "politie" ? formHosts("trainer") : formHosts("otc"),
    title: "ORP - OTC Aanmeldformulier",
    subtitle: "Aanmelding voor het opleidings- en trainingscentrum van Defensie Oranjestad.",
    accent: "#38bdf8",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_OTC_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", label: "Huidige rang", type: "text", required: true },
      { id: "motivation", label: "Waarom wil je deelnemen aan OTC?", type: "textarea", required: true },
      { id: "applicationType", label: "Training / Mentor", type: "checkboxGroup", required: true, options: [{ value: "trainer", label: "Trainer" }, { value: "mentor", label: "Mentor" }], help: "Je mag voor beide solliciteren." },
      { id: "trainerReason", label: "Waarom wil je trainer worden?", type: "textarea", required: true, showIf: { field: "applicationType", includes: "trainer" } },
      { id: "mentorReason", label: "Waarom wil je mentor worden?", type: "textarea", required: true, showIf: { field: "applicationType", includes: "mentor" } },
      { id: "experience", label: "Welke relevante ervaring heb je?", type: "textarea", required: false },
      { id: "weeklyAvailability", label: "Hoeveel tijd denk je hieraan gemiddeld te kunnen besteden per week?", type: "textarea", required: true },
      { id: "additionalNotes", label: "Heb je nog aanvullende opmerkingen?", type: "textarea", required: false }
    ]
  },
  hrb: {
    slug: "hrb",
    hostnames: formHosts("hrb"),
    title: "Eskadron Hoog Risico Beveiliging",
    subtitle: "Sollicitatieproces voor de functie operator binnen de HRB. Zorg dat je motivatie duidelijk op papier staat.",
    notice: "Eisen: minimale rang Wachtmeester, consequente inzet en motivatie, betrouwbaarheid, goede samenwerking en stressbestendigheid.",
    accent: "#64748b",
    internalOnly: true,
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
    hostnames: formHosts("w-s", "ws"),
    title: "ORP - Werving & Selectie",
    subtitle: "Aanmelding voor werkzaamheden binnen Werving & Selectie.",
    accent: "#f59e0b",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_WS_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", label: "Huidige rang", type: "text", required: true },
      { id: "motivation", label: "Waarom wil je bij W&S?", type: "textarea", required: true },
      { id: "experience", label: "Welke ervaring heb je met aannames of gesprekken?", type: "textarea", required: false }
    ]
  },
  hovj: {
    slug: "hovj",
    hostnames: formHosts("hovj"),
    title: "Sollicitatie hulpofficier van justitie (hOvJ)",
    subtitle: "Dit formulier dient voor het verzamelen van gegevens ten behoeve van de beoordeling van uw sollicitatie voor de functie van hulp Officier van Justitie.\n\nU wordt verzocht uw persoonlijke gegevens, ervaring en relevante competenties volledig en naar waarheid in te vullen. Tevens dient u uw motivatie toe te lichten.\n\nDe verstrekte informatie wordt uitsluitend gebruikt voor de selectieprocedure en vertrouwelijk behandeld.\n\nHet gebruik van AI wordt gecontroleerd. Let op uw taalgebruik en geef authentieke, eigen antwoorden.",
    notice: "Indien tijdens de selectie of proefperiode blijkt dat u niet over de vereiste competenties beschikt, kan dit alsnog leiden tot beëindiging van uw aanstelling.",
    accent: "#6d5dfc",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_HOVJ_WEBHOOK_URL",
    questions: [
      { id: "name", label: "1. Wat is je naam?", type: "text", required: true },
      { id: "rankServiceNumber", label: "2. Huidige rang en roepnummer?", type: "text", required: true },
      { id: "motivation", label: "3. Wat is je motivatie om hOvJ te worden?", type: "textarea", required: true },
      { id: "experience", label: "4. Heb je al ervaring als hOvJ?", type: "textarea", required: true },
      { id: "tasks", label: "5. Wat zijn volgens jou de belangrijkste taken van een hOvJ?", type: "textarea", required: true },
      { id: "whyYou", label: "6. Waarom moeten we jou aannemen en niet iemand anders als hOvJ?", type: "textarea", required: true },
      {
        id: "knowledgeIntro",
        label: "Kennis vragen",
        type: "section",
        help: "In deze sectie wordt uw kennis en inzicht in de rol van hulp Officier van Justitie beoordeeld. De vragen zijn gericht op uw begrip van bevoegdheden, procedures en besluitvorming. Van jou wordt verwacht dat je onderbouwde en realistische antwoorden geeft die aansluiten op je rol als hOvJ."
      },
      { id: "custody", label: "1. Wanneer mag een verdachte in verzekering worden gesteld?", type: "textarea", required: true },
      { id: "decisionDoubt", label: "2. Hoe ga je om met twijfel bij het nemen van een beslissing?", type: "textarea", required: true },
      { id: "lowEvidencePressure", label: "3. Je krijgt een verdachte aangeleverd met weinig bewijs, maar hoge druk vanuit de politie om door te pakken. Wat doe je?", type: "textarea", required: true },
      { id: "agentMisconduct", label: "4. Een agent heeft mogelijk onrechtmatig gehandeld. Hoe pak je dit aan als hOvJ?", type: "textarea", required: true },
      { id: "thermiteVehicle", label: "5. Bij een verdachte wordt in een voertuig thermiet aangetroffen. De advocaat stelt dat het voertuig eerder is gestolen en dat de thermiet door een derde is geplaatst. Hoe beoordeel je deze situatie en welke tegen argumenten gebruik je?", type: "textarea", required: true },
      { id: "robberyWeaponFound", label: "6. Iemand pleegt een plofkraak en word schuldig bevonden dat hij/zij die plofkraak pleegde en is aangetroffen met thermiet op zak. Voor welke overtredingen en misdrijven ga je deze persoon veroordelen en benoem de totale straf.", type: "textarea", required: true },
      {
        id: "insufficientEvidenceChoice",
        label: "7. Een verdachte is aangehouden voor een mogelijk strafbaar feit, maar tijdens het onderzoek blijkt dat er onvoldoende bewijs is om de betrokkenheid van de verdachte vast te stellen. Er zijn geen getuigenverklaringen en het beschikbare bewijsmateriaal is niet doorslaggevend.",
        type: "select",
        required: true,
        options: [
          "A= Kijken waar je hem minimaal voor kan veroordelen.",
          "B= De zaak doorzetten en de verdachte met zijn advocaat overtreffen in argumenten.",
          "C= De zaak seponeren.",
          "D= De strafzaak wordt beëindigd wegens onvoldoende grond."
        ]
      }
    ]
  }
};

const publicFormManagerBadges = {
  herintrede: ["Kader"],
  overstap: ["Kader"],
  klachten: ["Kader"],
  otc: ["OTC-Leiding", "Trainer-Leiding"],
  hrb: ["HRB-Leiding"],
  "w-s": ["W&S-Leiding"],
  hovj: ["OvJ"]
};

function replaceOrganizationText(value) {
  if (organization.key !== "politie" || typeof value !== "string") return value;
  return value
    .replaceAll("Defensie Oranjestad", "Politie Oranjestad")
    .replaceAll("Defensie", "Politie")
    .replaceAll("Marechaussee", "Politie")
    .replaceAll("Mar. 1ste klasse", "Agent");
}

function applyOrganizationTextToForm(config) {
  for (const key of ["title", "subtitle", "notice"]) {
    if (config[key]) config[key] = replaceOrganizationText(config[key]);
  }
  if (organization.key === "politie" && config.slug === "overstap") {
    config.subtitle = "Ben jij momenteel Defensie? Dan kan je via deze weg aangeven dat je wil overstappen. Let op dat je maximaal kan intreden op Agent.";
  }
  if (organization.key === "politie" && config.slug === "herintrede") {
    config.notice = "Houd er rekening mee dat jij niet terug komt op je oude rang. Ook dien je minimaal de rang Agent te zijn geweest en moet dit formulier binnen 6 maanden na ontslag ingediend zijn.";
    const previousRankQuestion = (config.questions || []).find((question) => question.id === "previousRank");
    if (previousRankQuestion) previousRankQuestion.options = [...organization.ranks];
  }
  for (const question of config.questions || []) {
    for (const key of ["label", "placeholder", "help"]) {
      if (question[key]) question[key] = replaceOrganizationText(question[key]);
    }
    if (Array.isArray(question.options)) {
      question.options = question.options.map((option) => typeof option === "string"
        ? replaceOrganizationText(option)
        : { ...option, label: replaceOrganizationText(option.label), value: replaceOrganizationText(option.value) });
    }
  }
}

Object.values(publicFormConfigs).forEach(applyOrganizationTextToForm);

function clonePublicFormConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function managerBadgesForConfig(config) {
  return config?.managerBadges || publicFormManagerBadges[config?.slug] || ["Kader"];
}

function canManagePublicForm(profile, config) {
  if (!profile || !config) return false;
  const rank = profile.rank || "";
  const functionBadges = new Set([profile.permRole, ...(profile.extraFunctions || [])].filter(Boolean));
  for (const mapping of organization.autoFunctionByRanks || []) {
    if ((mapping.ranks || []).includes(rank)) functionBadges.add(mapping.label);
  }
  if ((organization.permissionAliases?.kader || ["Kader"]).some((badge) => functionBadges.has(badge))) return true;
  const taskBadges = new Set(profile.badges || []);
  return managerBadgesForConfig(config).some((badge) => functionBadges.has(badge) || taskBadges.has(badge));
}

function sanitizeQuestion(rawQuestion) {
  const allowedTypes = new Set(["text", "textarea", "select", "checkboxGroup", "file", "section"]);
  const id = normalizeSlug(rawQuestion?.id || rawQuestion?.label || "vraag").slice(0, 48);
  const label = String(rawQuestion?.label || "Vraag").trim().slice(0, 160);
  const type = allowedTypes.has(rawQuestion?.type) ? rawQuestion.type : "text";
  const question = {
    id,
    label,
    type,
    required: type === "section" ? false : Boolean(rawQuestion?.required)
  };
  if (rawQuestion?.placeholder) question.placeholder = String(rawQuestion.placeholder).trim().slice(0, 180);
  if (rawQuestion?.help) question.help = String(rawQuestion.help).trim().slice(0, 320);
  if (rawQuestion?.showIf && typeof rawQuestion.showIf === "object") {
    const field = String(rawQuestion.showIf.field || "").trim().slice(0, 48);
    if (field) {
      question.showIf = { field };
      if (rawQuestion.showIf.includes !== undefined) question.showIf.includes = String(rawQuestion.showIf.includes).slice(0, 80);
      if (rawQuestion.showIf.equals !== undefined) question.showIf.equals = String(rawQuestion.showIf.equals).slice(0, 80);
    }
  }
  if (["select", "checkboxGroup"].includes(type)) {
    question.options = (Array.isArray(rawQuestion?.options) ? rawQuestion.options : [])
      .slice(0, 40)
      .map((option) => typeof option === "object"
        ? { value: String(option.value || option.label || "").slice(0, 80), label: String(option.label || option.value || "").slice(0, 120) }
        : String(option || "").slice(0, 120))
      .filter((option) => typeof option === "string" ? option : option.value && option.label);
  }
  if (type === "file") question.accept = ".png,.jpg,.jpeg,.webp";
  return question;
}

function sanitizePublicFormOverride(config, rawOverride = {}) {
  const override = {};
  for (const key of ["title", "subtitle", "notice", "accent"]) {
    if (rawOverride[key] !== undefined) override[key] = String(rawOverride[key] || "").trim().slice(0, key === "notice" ? 900 : 220);
  }
  if (override.accent && !/^#[0-9a-f]{6}$/i.test(override.accent)) override.accent = config.accent || "#f59e0b";
  if (Array.isArray(rawOverride.questions)) {
    override.questions = rawOverride.questions.slice(0, 40).map(sanitizeQuestion);
  }
  return override;
}

function mergePublicFormConfig(config, override = {}) {
  const merged = clonePublicFormConfig(config);
  for (const key of ["title", "subtitle", "notice", "accent"]) {
    if (override[key] !== undefined) merged[key] = override[key];
  }
  if (Array.isArray(override.questions)) merged.questions = override.questions.map(sanitizeQuestion);
  return merged;
}
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

function publicFormClientConfig(config, profile = null) {
  if (!config) return null;
  const profileBackedQuestionIds = new Set(["fullName", "discord"]);
  const questions = config.internalOnly && profile
    ? (config.questions || []).filter((question) => !profileBackedQuestionIds.has(question.id))
    : (config.questions || []);
  return {
    slug: config.slug,
    title: config.title,
    subtitle: config.subtitle || "",
    notice: config.notice || "",
    accent: config.accent || "#f59e0b",
    internalOnly: Boolean(config.internalOnly),
    managerBadges: managerBadgesForConfig(config),
    canManage: canManagePublicForm(profile, config),
    questions,
    editable: canManagePublicForm(profile, config) ? {
      title: config.title,
      subtitle: config.subtitle || "",
      notice: config.notice || "",
      accent: config.accent || "#f59e0b",
      questions: config.questions || []
    } : null
  };
}


function applyProfileAnswersToPublicForm(config, answers = {}, profile = null) {
  const nextAnswers = { ...(answers || {}) };
  if (!config?.internalOnly || !profile) return nextAnswers;
  nextAnswers.fullName = profile.name || "";
  nextAnswers.discord = profile.discordUsername
    ? `${profile.discordUsername} (${profile.discordId || "Discord ID onbekend"})`
    : (profile.discordId || "");
  return nextAnswers;
}
function conditionMatches(condition, answers = {}) {
  if (!condition?.field) return true;
  const value = answers[condition.field];
  if (condition.includes !== undefined) return Array.isArray(value) ? value.includes(condition.includes) : value === condition.includes;
  if (condition.equals !== undefined) return value === condition.equals;
  return Boolean(value);
}

function validatePublicFormSubmission(config, answers, files = []) {
  const cleanAnswers = {};
  const errors = [];
  const filesByField = new Map((files || []).map((file) => [file.fieldName, file]));

  for (const question of config.questions || []) {
    if (!conditionMatches(question.showIf, answers)) continue;

    if (question.type === "file") {
      const file = filesByField.get(question.id);
      if (question.required && !file) errors.push(`${question.label} is verplicht.`);
      if (file) cleanAnswers[question.id] = `${file.filename} (${Math.round(file.size / 1024)} KB)`;
      continue;
    }

    if (question.type === "checkboxGroup") {
      const allowedValues = new Set((question.options || []).map((option) => option.value || option));
      const values = (Array.isArray(answers?.[question.id]) ? answers[question.id] : []).map(String).filter((value) => allowedValues.has(value));
      if (question.required && !values.length) errors.push(`${question.label} is verplicht.`);
      cleanAnswers[question.id] = values;
      continue;
    }

    const value = String(answers?.[question.id] || "").trim();
    if (question.required && !value) errors.push(`${question.label} is verplicht.`);
    cleanAnswers[question.id] = value.slice(0, question.type === "textarea" ? 4000 : 500);
  }
  return { cleanAnswers, errors };
}

function createPublicFormSubmission(config, answers, req, files = [], submittedBy = null) {
  return {
    id: crypto.randomUUID(),
    formSlug: config.slug,
    formTitle: config.title,
    formScope: config.internalOnly ? "Intern" : "Openbaar",
    answers,
    submittedBy: submittedBy ? {
      id: submittedBy.id,
      name: submittedBy.name,
      rank: submittedBy.rank,
      serviceNumber: submittedBy.serviceNumber,
      discordId: submittedBy.discordId,
      discordUsername: submittedBy.discordUsername
    } : null,
    attachments: (files || []).map((file) => ({
      fieldName: file.fieldName,
      filename: file.filename,
      contentType: file.contentType,
      size: file.size
    })),
    submittedAt: new Date().toISOString(),
    ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 500)
  };
}

function firstConfiguredEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function organizationWebhookEnvKey(envKey) {
  const orgPrefix = String(organization.key || "defensie").trim().toUpperCase();
  const suffix = String(envKey || "").replace(/^DISCORD_/, "");
  return `DISCORD_${orgPrefix}_${suffix}`;
}

function publicFormWebhookUrl(config) {
  if (config?.slug === "klachten") {
    return firstConfiguredEnv(
      "DISCORD_OVERHEID_FORM_KLACHTEN_WEBHOOK_URL",
      config.webhookEnv,
      "DISCORD_PUBLIC_FORMS_WEBHOOK_URL"
    );
  }
  return firstConfiguredEnv(
    organizationWebhookEnvKey(config.webhookEnv),
    `DISCORD_${String(organization.key || "defensie").trim().toUpperCase()}_PUBLIC_FORMS_WEBHOOK_URL`,
    config.webhookEnv,
    "DISCORD_PUBLIC_FORMS_WEBHOOK_URL"
  );
}

function formatCaseNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? String(number).padStart(3, "0") : "-";
}

function truncateDiscordText(value, maxLength) {
  const text = String(value || "-").trim() || "-";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildPublicFormWebhookPayload(config, submission) {
  const embedTitle = config.slug === "klachten" ? config.title : `${submission.formScope || "Openbaar"} - Nieuwe inzending: ${config.title}`;
  const footerText = `Formulier: ${config.slug}`;
  const fields = [];
  const maxFields = 25;
  const maxTotalChars = 5600;
  let usedChars = embedTitle.length + footerText.length;

  function addField(name, value) {
    if (fields.length >= maxFields) return false;
    const cleanName = truncateDiscordText(name, 220);
    const remaining = maxTotalChars - usedChars - cleanName.length - 32;
    if (remaining < 80) return false;
    const cleanValue = truncateDiscordText(value, Math.min(900, remaining));
    fields.push({ name: cleanName, value: cleanValue, inline: false });
    usedChars += cleanName.length + cleanValue.length;
    return true;
  }

  if (submission.submittedBy) {
    const submittedBy = submission.submittedBy;
    const discordLine = submittedBy.discordUsername || submittedBy.discordId
      ? `${submittedBy.discordUsername || "Discord onbekend"} (${submittedBy.discordId || "ID onbekend"})`
      : "Discord onbekend";
    addField("Formulier ingediend door:", `${submittedBy.serviceNumber || "-"} - ${submittedBy.rank || "-"}\n${submittedBy.name || "-"}\n${discordLine}`);
  }

  // Klachten krijgen een vast zaaknummer bovenaan de Discord embed, zodat leiding dit makkelijk kan terugvinden.
  if (config.slug === "klachten") {
    fields.unshift({ name: "Zaaknummer", value: formatCaseNumber(submission.caseNumber), inline: false });
    usedChars += "Zaaknummer".length + formatCaseNumber(submission.caseNumber).length;
  }

  let truncatedOrSkipped = false;
  for (const question of (config.questions || [])) {
    if (question.type === "file" || !conditionMatches(question.showIf, submission.answers)) continue;
    const rawValue = submission.answers?.[question.id];
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue || "-";
    const beforeCount = fields.length;
    if (!addField(question.label, value)) {
      truncatedOrSkipped = true;
      break;
    }
    if (fields.length > beforeCount && String(value).length > String(fields[fields.length - 1].value).length) truncatedOrSkipped = true;
  }

  if (submission.attachments?.length) {
    if (!addField("Bijlage", submission.attachments.map((file) => `${file.filename} (${Math.round(file.size / 1024)} KB)`).join("\n"))) truncatedOrSkipped = true;
  }
  if (truncatedOrSkipped && fields.length < maxFields) {
    addField("Let op", "Een deel van de antwoorden is ingekort voor Discord. De volledige inzending staat opgeslagen in het portaal.");
  }

  return {
    embeds: [
      {
        title: embedTitle,
        color: Number.parseInt(String(config.accent || "#f59e0b").replace("#", ""), 16) || 0xf59e0b,
        fields,
        footer: { text: footerText },
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
  applyProfileAnswersToPublicForm,
  validatePublicFormSubmission,
  createPublicFormSubmission,
  publicFormWebhookUrl,
  buildPublicFormWebhookPayload,
  mergePublicFormConfig,
  sanitizePublicFormOverride,
  canManagePublicForm
};
