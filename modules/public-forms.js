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

function klachtenFormHosts() {
  return Array.from(new Set([
    ...overheidFormHosts("klachten"),
    "klachten.orpdefensie.nl",
    "klachten.orppolitie.nl"
  ]));
}

function interneKlachtFormHosts() {
  return Array.from(new Set([
    ...overheidFormHosts("interne-klacht", "interne-klachten"),
    ...formHosts("interne-klacht", "interne-klachten")
  ]));
}

function hovjFormHosts() {
  return Array.from(new Set([
    ...overheidFormHosts("hovj"),
    ...formHosts("hovj"),
    "hovj.orpdefensie.nl",
    "hovj.orppolitie.nl"
  ]));
}

function bsbFormHosts() {
  return Array.from(new Set([
    "bsb.orpdefensie.nl"
  ]));
}

function publicFormIconHref(config) {
  if (isComplaintForm(config)) return "/assets/orp-logo.png?v=20260613-form-branding";
  if (organization.key === "politie") return "/assets/politie-logo.png?v=20260613-form-branding";
  return "/assets/favicon.png?v=20260526";
}

function publicFormEyebrow(config) {
  if (isComplaintForm(config)) return "ORP Overheid";
  if (organization.key === "politie") return "ORP Politie Oranjestad";
  return "ORP Defensie Oranjestad";
}

function isComplaintForm(configOrSlug) {
  const slug = typeof configOrSlug === "string" ? configOrSlug : configOrSlug?.slug;
  return ["klachten", "interne-klacht"].includes(slug);
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
    hostnames: klachtenFormHosts(),
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
  "interne-klacht": {
    slug: "interne-klacht",
    aliases: ["interne-klachten", "interne-klachtformulier", "interne-klachtenformulier"],
    hostnames: interneKlachtFormHosts(),
    title: "ORP - Intern Klachtenformulier",
    subtitle: "Gebruik dit formulier voor interne klachten of meldingen tussen collega's binnen Politie en Defensie Oranjestad.",
    notice: "Deze melding is intern en wordt vertrouwelijk behandeld door de bevoegde leiding. Vul concreet in wat er is gebeurd en voeg bewijs toe als dat beschikbaar is.",
    accent: "#ef4444",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_INTERNE_KLACHT_WEBHOOK_URL",
    questions: [
      { id: "complaintType", label: "Waar gaat de interne klacht over?", type: "select", required: true, options: ["Gedrag van collega", "Samenwerking / communicatie", "Misbruik van bevoegdheden", "Integriteit", "Discriminatie of intimidatie", "Procedurele fout", "Overig"] },
      { id: "organization", label: "Welke organisatie is betrokken?", type: "select", required: true, options: ["Defensie", "Politie", "Beide / samenwerking"] },
      { id: "involvedColleague", label: "Over welke collega of collega's gaat de klacht?", type: "text", required: true, placeholder: "Naam, rang of roepnummer indien bekend" },
      { id: "incidentDate", label: "Wanneer is dit gebeurd?", type: "text", required: true, placeholder: "Datum en tijd, of zo nauwkeurig mogelijk" },
      { id: "location", label: "Waar is dit gebeurd?", type: "text", required: false, placeholder: "Locatie, porto-kanaal, Discord-kanaal of situatie" },
      { id: "description", label: "Beschrijf zo duidelijk mogelijk wat er is gebeurd", type: "textarea", required: true },
      { id: "impact", label: "Wat was de impact of waarom meld je dit?", type: "textarea", required: true },
      { id: "witnesses", label: "Zijn er getuigen?", type: "textarea", required: false, placeholder: "Namen of roepnummers indien bekend" },
      { id: "evidence", label: "Bewijs of links", type: "textarea", required: false, placeholder: "Medal, screenshots, Discord links of andere bewijslinks" },
      { id: "attachment", label: "Bijlage", type: "file", required: false, accept: ".png,.jpg,.jpeg,.webp", help: "Optioneel: voeg maximaal 1 foto toe als bewijs. Maximaal 8 MB." },
      { id: "desiredOutcome", label: "Wat zou volgens jou een passende vervolgstap zijn?", type: "textarea", required: false },
      { id: "confidentiality", label: "Vertrouwelijkheid", type: "checkboxGroup", required: false, options: [{ value: "vertrouwelijk", label: "Ik wil dat deze melding zo vertrouwelijk mogelijk behandeld wordt." }] },
      { id: "truth", label: "Bevestiging", type: "checkboxGroup", required: true, options: [{ value: "waarheid", label: "Ik verklaar dat ik dit formulier naar waarheid heb ingevuld." }] }
    ]
  },
  otc: {
    slug: organization.key === "politie" ? "trainer" : "otc",
    aliases: organization.key === "politie" ? ["otc"] : [],
    hostnames: organization.key === "politie" ? formHosts("trainer") : formHosts("otc"),
    title: organization.key === "politie" ? "ORP - Trainer Aanmeldformulier" : "ORP - OTC Aanmeldformulier",
    subtitle: organization.key === "politie" ? "Aanmelding voor trainer of mentor binnen Politie Oranjestad." : "Aanmelding voor het opleidings- en trainingscentrum van Defensie Oranjestad.",
    accent: "#38bdf8",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_OTC_WEBHOOK_URL",
    questions: [
      { id: "fullName", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", label: "Huidige rang", type: "text", required: true },
      { id: "motivation", label: organization.key === "politie" ? "Waarom wil je trainer of mentor worden?" : "Waarom wil je deelnemen aan OTC?", type: "textarea", required: true },
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
  bsb: {
    slug: "bsb",
    hostnames: bsbFormHosts(),
    title: "Brigade Speciale Beveiligingsopdrachten",
    subtitle: "Sollicitatieformulier voor deelname aan de BSB. Vul de intake en praktijkvragen volledig en naar waarheid in.",
    notice: "Dit formulier bestaat uit twee delen. Je antwoorden worden tijdelijk in deze browser opgeslagen zolang je het formulier nog niet hebt verzonden.",
    accent: "#2563eb",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_BSB_WEBHOOK_URL",
    pages: [
      {
        id: "intake",
        title: "Intake",
        description: "Dit zijn vragen over wie jij bent. Vanzelfsprekend gaat dit over ingame informatie."
      },
      {
        id: "situaties",
        title: "Praktijk Situaties",
        description: "Beantwoord de situaties vanuit jouw eigen inzicht, houding en manier van samenwerken."
      }
    ],
    questions: [
      { id: "name", page: "intake", label: "Wat is jouw naam", type: "text", required: true },
      { id: "rank", page: "intake", label: "Wat is jouw rang", type: "text", required: true },
      { id: "defenceTenure", page: "intake", label: "Hoelang ben je lid van Defensie", type: "text", required: true },
      { id: "strengths", page: "intake", label: "Noem 3 goede eigenschappen die van pas komen bij de BSB", type: "textarea", required: true },
      { id: "weaknesses", page: "intake", label: "Noem 3 mindere eigenschappen van jezelf", type: "textarea", required: true },
      { id: "motivation", page: "intake", label: "Waarom wil je juist bij de BSB werken?", type: "textarea", required: true },
      { id: "teamRole", page: "situaties", label: "Welke rol neem jij meestal aan binnen een team?", type: "textarea", required: true },
      { id: "disagreement", page: "situaties", label: "Je krijgt een opdracht waar je het persoonlijk niet mee eens bent. Wat doe je?", type: "textarea", required: true },
      { id: "suspiciousSituation", page: "situaties", label: "Tijdens een beveiligingsopdracht zie je iets verdachts. Hoe handel je?", type: "textarea", required: true }
    ]
  },
  ...(organization.key === "politie" ? {
    dsi: {
      slug: "dsi",
      hostnames: formHosts("dsi"),
      title: "Sollicitatieformulier - Oranjestad Roleplay",
      subtitle: "Bedankt voor je interesse in de Dienst Speciale Interventies (DSI). De DSI is een specialistische politie-eenheid die wordt ingezet bij situaties met een verhoogd risico, zoals vuurwapengevaarlijke verdachten, gijzelingen en andere tactische operaties.",
      notice: "Het invullen van dit formulier betekent niet automatisch dat je wordt aangenomen. Na beoordeling kun je worden uitgenodigd voor een gesprek, theorie-examen en praktijk selectie.",
      accent: "#2563eb",
      internalOnly: true,
      webhookEnv: "DISCORD_FORM_DSI_WEBHOOK_URL",
      pages: [
        {
          id: "persoonlijk",
          title: "Persoonlijke Gegevens"
        },
        {
          id: "motivatie",
          title: "Motivatie"
        },
        {
          id: "kennis",
          title: "Kennisvragen"
        },
        {
          id: "scenarios",
          title: "Scenario's"
        },
        {
          id: "porto",
          title: "Porto & Communicatie"
        }
      ],
      questions: [
        { id: "discordFullName", page: "persoonlijk", label: "Volledige Discord naam", type: "text", required: true },
        { id: "steamName", page: "persoonlijk", label: "Steamnaam", type: "text", required: true },
        { id: "inGameName", page: "persoonlijk", label: "In-game naam", type: "text", required: true },
        { id: "policeRank", page: "persoonlijk", label: "Rang binnen de Politie", type: "select", required: true, options: ["Agent", "Hoofdagent", "Brigadier", "Inspecteur", "Commissaris", "Anders"] },
        { id: "policeTenure", page: "persoonlijk", label: "Hoe lang ben je werkzaam bij de Politie?", type: "select", required: true, options: ["Minder dan 1 week", "1-2 weken", "2-4 weken", "1-3 maanden", "Langer dan 3 maanden"] },
        { id: "dsiMotivation", page: "motivatie", label: "Waarom wil jij onderdeel worden van de DSI?", type: "textarea", required: true },
        { id: "whyAccept", page: "motivatie", label: "Waarom moeten wij juist jou aannemen?", type: "textarea", required: true },
        { id: "dsiExpectation", page: "motivatie", label: "Wat verwacht jij van de DSI?", type: "textarea", required: true },
        { id: "operatorExpectation", page: "motivatie", label: "Wat denk jij dat de DSI van jou mag verwachten?", type: "textarea", required: true },
        { id: "dsiMeaning", page: "kennis", label: "Waar staat DSI voor?", type: "text", required: true },
        { id: "aotMeaning", page: "kennis", label: "Waar staat AOT voor?", type: "text", required: true },
        { id: "teamDifference", page: "kennis", label: "Wat is het verschil tussen een Arrestatieteam en een Observatieteam?", type: "textarea", required: true },
        { id: "operatorTraits", page: "kennis", label: "Noem minimaal drie eigenschappen die een DSI-operator moet bezitten.", type: "textarea", required: true },
        { id: "communicationImportance", page: "kennis", label: "Waarom is goede communicatie belangrijk tijdens een DSI-operatie?", type: "textarea", required: true },
        { id: "priorityChoice", page: "kennis", label: "Wat is volgens jou belangrijker?", type: "select", required: true, options: ["Zo snel mogelijk handelen", "Veilig en gecontroleerd handelen"] },
        { id: "priorityReason", page: "kennis", label: "Leg uit waarom je voor dit antwoord hebt gekozen.", type: "textarea", required: true },
        { id: "scenarioObservation", page: "scenarios", label: "Scenario 1 - Wat doe jij?", help: "Je bent onderdeel van het Arrestatieteam. Tijdens een observatie zie jij dat de verdachte onverwachts de woning verlaat. De Teamleider heeft nog geen toestemming gegeven om in te grijpen.", type: "textarea", required: true },
        { id: "scenarioColleagueInjured", page: "scenarios", label: "Scenario 2 - Wat is jouw eerste prioriteit?", help: "Tijdens een inval zie jij een collega gewond raken.", type: "textarea", required: true },
        { id: "scenarioDisagreement", page: "scenarios", label: "Scenario 3 - Hoe ga je hiermee om?", help: "Je bent het niet eens met een opdracht van de Teamleider.", type: "textarea", required: true },
        { id: "scenarioSurrender", page: "scenarios", label: "Scenario 4 - Hoe handel jij?", help: "Een verdachte werkt volledig mee en geeft zich direct over.", type: "textarea", required: true },
        { id: "portoWeaponReport", page: "porto", label: "Hoe meld jij dit over de porto?", help: "Je bent de 50-03. Je ziet dat de verdachte een vuurwapen trekt.", type: "textarea", required: true },
        { id: "portoShortClear", page: "porto", label: "Waarom moet portoverkeer tijdens een inzet kort en duidelijk zijn?", type: "textarea", required: true }
      ]
    }
  } : {}),
  "w-s": {
    slug: "w-s",
    aliases: ["w&s", "ws"],
    hostnames: formHosts("w-s", "ws"),
    title: "ORP - Werving & Selectie",
    subtitle: "Aanmelding voor werkzaamheden binnen Werving & Selectie.",
    accent: "#f59e0b",
    internalOnly: true,
    webhookEnv: "DISCORD_FORM_WS_WEBHOOK_URL",
    pages: [
      { id: "motivatie", title: "Motivatie" },
      { id: "ervaring", title: "Ervaring" },
      { id: "overig", title: "Overige informatie" }
    ],
    questions: [
      { id: "fullName", page: "motivatie", label: "Naam + achternaam (in-game)", type: "text", required: true },
      { id: "discord", page: "motivatie", label: "Discord naam + ID", type: "text", required: true },
      { id: "rank", page: "motivatie", label: "Huidige rang", type: "select", options: [...organization.ranks], required: true },
      { id: "motivationIntro", page: "motivatie", label: "Motivatie", type: "section" },
      { id: "motivation", page: "motivatie", label: "Waarom wil je deel uitmaken van Werving & Selectie?", type: "textarea", required: true },
      { id: "suitability", page: "motivatie", label: "Waarom denk jij dat jij geschikt bent voor deze functie? (Minimaal 100 woorden)", type: "textarea", required: true },
      { id: "appeal", page: "motivatie", label: "Wat spreekt jou het meeste aan binnen deze functie?", type: "textarea", required: true },
      { id: "experienceIntro", page: "ervaring", label: "Ervaring", type: "section" },
      { id: "organizationExperience", page: "ervaring", label: "Welke ervaring heb je binnen de organisatie die relevant is voor Werving & Selectie?", type: "textarea", required: true },
      { id: "selectionExperience", page: "ervaring", label: "Heb je eerder ervaring gehad met werving of selectie? Zo ja, beschrijf dit.", type: "textarea", required: true },
      { id: "otherInfoIntro", page: "overig", label: "Overige informatie", type: "section" },
      { id: "otherRemarks", page: "overig", label: "Nog overige opmerkingen?", type: "textarea", required: true }
    ]
  },
  hovj: {
    slug: "hovj",
    hostnames: hovjFormHosts(),
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
  "interne-klacht": ["Interne-Zaken", "IZ-Leiding"],
  otc: ["OTC-Leiding", "Trainer-Leiding"],
  trainer: ["Trainer-Leiding"],
  hrb: ["HRB-Leiding"],
  bsb: ["BSB-Leiding"],
  dsi: ["DSI-Leiding"],
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
  const visualScope = isComplaintForm(config) ? "overheid" : organization.key;
  return {
    slug: config.slug,
    organizationKey: organization.key,
    visualScope,
    title: config.title,
    eyebrow: publicFormEyebrow(config),
    subtitle: config.subtitle || "",
    notice: config.notice || "",
    accent: config.accent || "#f59e0b",
    iconHref: publicFormIconHref(config),
    internalOnly: Boolean(config.internalOnly),
    managerBadges: managerBadgesForConfig(config),
    canManage: canManagePublicForm(profile, config),
    questions,
    pages: config.pages || [],
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
  if (config?.slug === "interne-klacht") {
    return firstConfiguredEnv(
      "DISCORD_OVERHEID_FORM_INTERNE_KLACHT_WEBHOOK_URL",
      organizationWebhookEnvKey(config.webhookEnv),
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
  const embedTitle = isComplaintForm(config) ? config.title : `${submission.formScope || "Openbaar"} - Nieuwe inzending: ${config.title}`;
  const footerText = `Formulier: ${config.slug}`;
  const maxFields = 25;
  const maxEmbeds = 10;
  const maxEmbedChars = 5800;
  const maxFieldValueChars = 1000;
  const color = Number.parseInt(String(config.accent || "#f59e0b").replace("#", ""), 16) || 0xf59e0b;
  const embeds = [];
  let droppedFields = 0;

  function createEmbed() {
    if (embeds.length >= maxEmbeds) return null;
    const number = embeds.length + 1;
    const title = number === 1 ? embedTitle : `${embedTitle} - vervolg ${number}`;
    const embed = {
      title: truncateDiscordText(title, 256),
      color,
      fields: [],
      footer: { text: footerText },
      timestamp: submission.submittedAt,
      usedChars: title.length + footerText.length
    };
    embeds.push(embed);
    return embed;
  }

  function splitFieldValue(value) {
    const text = String(value || "-").trim() || "-";
    const chunks = [];
    let remaining = text;
    while (remaining.length > maxFieldValueChars) {
      let boundary = remaining.lastIndexOf("\n", maxFieldValueChars);
      if (boundary < Math.floor(maxFieldValueChars * 0.6)) boundary = remaining.lastIndexOf(" ", maxFieldValueChars);
      if (boundary < Math.floor(maxFieldValueChars * 0.6)) boundary = maxFieldValueChars;
      chunks.push(remaining.slice(0, boundary).trim());
      remaining = remaining.slice(boundary).trimStart();
    }
    chunks.push(remaining || "-");
    return chunks;
  }

  function addField(name, value) {
    const cleanName = truncateDiscordText(name, 220);
    const chunks = splitFieldValue(value);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunkName = chunks.length > 1 ? `${cleanName} (${index + 1}/${chunks.length})` : cleanName;
      const chunkValue = chunks[index];
      let embed = embeds[embeds.length - 1] || createEmbed();
      if (!embed) {
        droppedFields += 1;
        continue;
      }
      const fieldChars = chunkName.length + chunkValue.length;
      if (embed.fields.length >= maxFields || embed.usedChars + fieldChars > maxEmbedChars) {
        embed = createEmbed();
      }
      if (!embed) {
        droppedFields += 1;
        continue;
      }
      embed.fields.push({ name: chunkName, value: chunkValue, inline: false });
      embed.usedChars += fieldChars;
    }
  }

  function addSectionHeading(title) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) return;
    addField(`__${cleanTitle}__`, "\u200b");
  }

  if (submission.submittedBy) {
    const submittedBy = submission.submittedBy;
    const discordLine = submittedBy.discordUsername || submittedBy.discordId
      ? `${submittedBy.discordUsername || "Discord onbekend"} (${submittedBy.discordId || "ID onbekend"})`
      : "Discord onbekend";
    addField("Formulier ingediend door:", `${submittedBy.serviceNumber || "-"} - ${submittedBy.rank || "-"}\n${submittedBy.name || "-"}\n${discordLine}`);
  }

  // Klachten krijgen een vast zaaknummer bovenaan de Discord embed, zodat leiding dit makkelijk kan terugvinden.
  if (isComplaintForm(config)) {
    addField("Zaaknummer", formatCaseNumber(submission.caseNumber));
  }

  const pages = Array.isArray(config.pages) ? config.pages : [];
  if (pages.length) {
    const questionsByPage = new Map();
    for (const question of (config.questions || [])) {
      const pageId = question.page || pages[0]?.id || "";
      if (!questionsByPage.has(pageId)) questionsByPage.set(pageId, []);
      questionsByPage.get(pageId).push(question);
    }
    for (const page of pages) {
      const pageQuestions = questionsByPage.get(page.id) || [];
      if (!pageQuestions.length) continue;
      addSectionHeading(page.title || page.id);
      for (const question of pageQuestions) {
        if (question.type === "file" || !conditionMatches(question.showIf, submission.answers)) continue;
        const rawValue = submission.answers?.[question.id];
        const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue || "-";
        addField(question.label, value);
      }
    }
  } else {
    for (const question of (config.questions || [])) {
      if (question.type === "file" || !conditionMatches(question.showIf, submission.answers)) continue;
      const rawValue = submission.answers?.[question.id];
      const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue || "-";
      addField(question.label, value);
    }
  }

  if (submission.attachments?.length) {
    addField("Bijlage", submission.attachments.map((file) => `${file.filename} (${Math.round(file.size / 1024)} KB)`).join("\n"));
  }
  if (droppedFields) {
    const embed = embeds[embeds.length - 1];
    if (embed && embed.fields.length < maxFields) {
      embed.fields.push({
        name: "Let op",
        value: `${droppedFields} antwoorddeel/antwoorddelen pasten niet binnen de Discord-limiet van ${maxEmbeds} embeds. De volledige inzending staat in het portaal.`,
        inline: false
      });
    }
  }

  return {
    embeds: embeds.map(({ usedChars, ...embed }) => embed)
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
  formatCaseNumber,
  publicFormWebhookUrl,
  buildPublicFormWebhookPayload,
  mergePublicFormConfig,
  sanitizePublicFormOverride,
  canManagePublicForm,
  isComplaintForm
};
