"use strict";

const PROCESS_VERBAL_TYPES = {
  bevindingen: {
    label: "Proces-verbaal van bevindingen",
    shortLabel: "Bevindingen"
  },
  aanhouding: {
    label: "Proces-verbaal van aanhouding",
    shortLabel: "Aanhouding"
  },
  verhoor: {
    label: "Proces-verbaal van verhoor",
    shortLabel: "Verhoor"
  },
  onderzoek: {
    label: "Proces-verbaal van onderzoek",
    shortLabel: "Onderzoek"
  },
  inbeslagneming: {
    label: "Proces-verbaal van inbeslagneming",
    shortLabel: "Inbeslagneming"
  },
  aangifte: {
    label: "Proces-verbaal van aangifte",
    shortLabel: "Aangifte"
  },
  relaas: {
    label: "Proces-verbaal van relaas",
    shortLabel: "Relaas"
  }
};

const PROCESS_VERBAL_FIELD_LABELS = {
  bevindingen: { incidentDate: "Datum incident", incidentTime: "Tijdstip", aanleiding: "Aanleiding", waarneming: "Eigen waarneming", betrokkenen: "Betrokkenen", vervolg: "Vervolgactie" },
  aanhouding: { arrestDate: "Datum aanhouding", arrestTime: "Tijdstip aanhouding", suspectName: "Verdachte", reason: "Reden aanhouding", method: "Wijze van aanhouding", forceUsed: "Geweldsmiddelen", transport: "Transport en overdracht" },
  verhoor: { hearingDate: "Datum verhoor", hearingTime: "Aanvang verhoor", heardPerson: "Gehoorde persoon", role: "Rol gehoorde", caution: "Cautie / mededeling", questionsAnswers: "Vragen en antwoorden", closing: "Afsluiting" },
  onderzoek: { researchDate: "Datum onderzoek", researchType: "Soort onderzoek", assignment: "Opdracht / aanleiding", method: "Werkwijze", findings: "Bevindingen", evidence: "Sporen / goederen", conclusion: "Conclusie" },
  inbeslagneming: { seizureDate: "Datum inbeslagneming", seizureTime: "Tijdstip", seizureLocation: "Locatie", seizedFrom: "In beslag genomen bij", reason: "Reden inbeslagneming", items: "Goederenlijst", storage: "Bewaring / overdracht" },
  aangifte: { reportDate: "Datum aangifte", reportTime: "Tijdstip", reporterName: "Aangever", victimName: "Slachtoffer", offense: "Strafbaar feit", statement: "Verklaring aangever", damage: "Schade / goederen", suspectInfo: "Verdachte / signalement" },
  relaas: { suspectName: "Verdachte", suspicion: "Verdenking", dossierSummary: "Dossieroverzicht", evidenceSummary: "Bewijs en stukken", legalSummary: "Wetboek / strafbare feiten", ovjAdvice: "Voor OVJ" }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, max = 500, fallback = "") {
  return String(value ?? fallback ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .slice(0, max);
}

function entryId(prefix = "PVG") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function processVerbalActorKey(createdBy = {}) {
  const discordId = String(createdBy.discordId || "").trim();
  if (discordId) return `discord:${discordId}`;
  const portalPersonId = String(createdBy.portalPersonId || "").trim();
  if (portalPersonId) return `portal:${portalPersonId}`;
  const serviceNumber = String(createdBy.serviceNumber || "").trim();
  if (serviceNumber) return `service:${normalizeKey(serviceNumber)}`;
  const name = String(createdBy.name || "").trim();
  return name ? `name:${normalizeKey(name)}` : "";
}

function normalizeProcessVerbalStatus(value) {
  const normalized = normalizeKey(value);
  return normalized === "definitief" || normalized === "final" || normalized === "closed"
    ? "definitief"
    : "concept";
}

function normalizeProcessVerbalType(value) {
  const normalized = normalizeKey(value);
  if (normalized.includes("aanhouding")) return "aanhouding";
  if (normalized.includes("verhoor")) return "verhoor";
  if (normalized.includes("onderzoek")) return "onderzoek";
  if (normalized.includes("inbeslag")) return "inbeslagneming";
  if (normalized.includes("aangifte")) return "aangifte";
  if (normalized.includes("relaas")) return "relaas";
  if (normalized.includes("bevinding")) return "bevindingen";
  return PROCESS_VERBAL_TYPES[value] ? value : "bevindingen";
}

function normalizeProcessVerbalFields(fields = {}) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  return Object.fromEntries(Object.entries(fields)
    .slice(0, 60)
    .map(([key, value]) => [text(key, 80), text(value, 2500)])
    .filter(([key]) => key));
}

function normalizeProcessVerbalRelated(related = {}) {
  if (!related || typeof related !== "object" || Array.isArray(related)) return {};
  return {
    personId: text(related.personId, 120),
    personName: text(related.personName, 160),
    personBirthDate: text(related.personBirthDate, 80),
    personBsn: text(related.personBsn, 80),
    personFingerprint: text(related.personFingerprint, 80),
    vehiclePlate: text(related.vehiclePlate, 40).toUpperCase(),
    vehicleLabel: text(related.vehicleLabel, 180),
    warrantId: text(related.warrantId, 120),
    warrantLabel: text(related.warrantLabel, 220),
    entryType: text(related.entryType, 40),
    entryId: text(related.entryId, 120),
    entryLabel: text(related.entryLabel, 220),
    parentProcessVerbalId: text(related.parentProcessVerbalId, 120),
    parentProcessVerbalTitle: text(related.parentProcessVerbalTitle, 220)
  };
}

function processVerbalDocument(input = {}) {
  const type = normalizeProcessVerbalType(input.type);
  const createdBy = input.createdBy || {};
  const fieldLabels = PROCESS_VERBAL_FIELD_LABELS[type] || {};
  const fieldLines = Object.entries(input.fields || {})
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${fieldLabels[key] || key}:\n${String(value).trim()}`);
  const related = input.related || {};
  const relatedLines = [
    ["Gekoppelde persoon", related.personName],
    ["BSN", related.personBsn],
    ["Vingerafdruk", related.personFingerprint],
    ["Geboortedatum", related.personBirthDate],
    ["Voertuig", related.vehiclePlate || related.vehicleLabel],
    ["Arrestatiebevel", related.warrantLabel || related.warrantId],
    ["Aanvullend op", related.parentProcessVerbalTitle || related.parentProcessVerbalId]
  ].filter(([, value]) => String(value || "").trim()).map(([label, value]) => `${label}: ${String(value).trim()}`);
  return [
    "ORP OVERHEID",
    "MEOS - PROCES-VERBAAL",
    PROCESS_VERBAL_TYPES[type].label.toUpperCase(),
    "",
    `PV-nummer: ${input.id || "Wordt automatisch toegekend"}`,
    `Status: ${normalizeProcessVerbalStatus(input.status) === "definitief" ? "Definitief" : "Concept"}`,
    `Datum opmaak: ${input.date || "-"}`,
    `Locatie: ${input.location || "-"}`,
    "",
    `Verbalisant: ${createdBy.name || "-"}`,
    `Rang / dienstnummer: ${[createdBy.rank, createdBy.serviceNumber].filter(Boolean).join(" / ") || "-"}`,
    "",
    input.subjectName ? `Betrokkene: ${input.subjectName}` : "",
    input.subjectBirthDate ? `Geboortedatum: ${input.subjectBirthDate}` : "",
    input.subjectBsn ? `BSN: ${input.subjectBsn}` : "",
    input.subjectFingerprint ? `Vingerafdruk: ${input.subjectFingerprint}` : "",
    relatedLines.length ? `\nKOPPELINGEN\n${relatedLines.join("\n")}` : "",
    fieldLines.length ? `\nBEVINDINGEN EN VERKLARINGEN\n${fieldLines.join("\n\n")}` : "",
    input.summary ? `\nSAMENVATTING\n${input.summary}` : "",
    "",
    "Naar waarheid opgemaakt binnen Oranjestad Roleplay.",
    `Verbalisant: ${createdBy.name || "-"}`
  ].filter((line) => line !== "").join("\n");
}

function validateFinalProcessVerbal(input = {}) {
  if (normalizeProcessVerbalStatus(input.status) !== "definitief") return;
  const hasContent = Boolean(String(input.summary || "").trim()
    || String(input.document || "").trim()
    || Object.values(input.fields || {}).some((value) => String(value || "").trim()));
  if (!String(input.date || "").trim() || !hasContent || !String(input.createdByKey || "").trim()) {
    const error = new Error("Een definitief proces-verbaal vereist een datum, inhoud en gekoppelde verbalisant.");
    error.status = 400;
    throw error;
  }
}

function normalizeProcessVerbal(input = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const type = normalizeProcessVerbalType(input.type);
  const status = normalizeProcessVerbalStatus(input.status);
  const createdBy = input.createdBy && typeof input.createdBy === "object" ? clone(input.createdBy) : {};
  const createdByKey = text(input.createdByKey || options.actorKey || processVerbalActorKey(createdBy), 160);
  const finalizedAt = status === "definitief" ? text(input.finalizedAt || now, 80) : "";
  const normalized = {
    id: text(input.id || entryId(), 80),
    type,
    typeLabel: PROCESS_VERBAL_TYPES[type].label,
    title: text(input.title, 180, PROCESS_VERBAL_TYPES[type].label),
    status,
    date: text(input.date, 40),
    location: text(input.location, 160),
    subjectName: text(input.subjectName, 160),
    subjectBirthDate: text(input.subjectBirthDate, 80),
    subjectBsn: text(input.subjectBsn, 80),
    subjectFingerprint: text(input.subjectFingerprint, 80),
    summary: text(input.summary, 1000),
    fields: normalizeProcessVerbalFields(input.fields),
    related: normalizeProcessVerbalRelated(input.related),
    document: text(input.document, 16000),
    createdAt: text(input.createdAt || now, 80),
    updatedAt: text(input.updatedAt || now, 80),
    finalizedAt,
    createdBy,
    createdByKey
  };
  validateFinalProcessVerbal(normalized);
  const hasStructuredContent = Boolean(normalized.summary || Object.values(normalized.fields).some(Boolean));
  if (hasStructuredContent || !normalized.document) {
    normalized.document = text(processVerbalDocument(normalized), 16000);
  }
  return normalized;
}

function canViewProcessVerbal(processVerbal = {}, options = {}) {
  if (options.includeAll) return true;
  const actorKey = text(options.actorKey, 160);
  return Boolean(actorKey && processVerbal.createdByKey && processVerbal.createdByKey === actorKey);
}

function canEditProcessVerbal(processVerbal = {}, options = {}) {
  return processVerbal.status !== "definitief" && canViewProcessVerbal(processVerbal, { actorKey: options.actorKey });
}

function sortProcessVerbals(rows = []) {
  return [...rows].sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")));
}

function filterProcessVerbals(rows = [], options = {}) {
  const requestedType = String(options.type || "").trim();
  const type = normalizeProcessVerbalType(requestedType);
  const hasTypeFilter = Boolean(requestedType && normalizeKey(requestedType) !== "all" && PROCESS_VERBAL_TYPES[type]);
  const author = normalizeKey(options.author || "");
  const query = normalizeKey(options.query || "");
  return sortProcessVerbals(rows)
    .filter((row) => canViewProcessVerbal(row, options))
    .filter((row) => !hasTypeFilter || row.type === type)
    .filter((row) => {
      if (!query) return true;
      const createdBy = row.createdBy || {};
      const related = row.related || {};
      const fieldText = Object.values(row.fields || {}).join(" ");
      return [
        row.id,
        row.typeLabel,
        row.title,
        row.status,
        row.date,
        row.location,
        row.subjectName,
        row.subjectBirthDate,
        row.subjectBsn,
        row.subjectFingerprint,
        row.summary,
        row.document,
        fieldText,
        createdBy.name,
        createdBy.rank,
        createdBy.serviceNumber,
        related.personName,
        related.personBirthDate,
        related.personBsn,
        related.personFingerprint,
        related.vehiclePlate,
        related.vehicleLabel,
        related.warrantId,
        related.warrantLabel,
        related.entryLabel,
        related.parentProcessVerbalTitle
      ].some((value) => normalizeKey(value).includes(query));
    })
    .filter((row) => {
      if (!author || !options.includeAll) return true;
      const createdBy = row.createdBy || {};
      return [createdBy.name, createdBy.rank, createdBy.serviceNumber, createdBy.organizationKey].some((value) => normalizeKey(value).includes(author));
    });
}

function updateProcessVerbal(existing = {}, patch = {}, options = {}) {
  if (!canEditProcessVerbal(existing, options)) {
    const error = new Error(existing.status === "definitief"
      ? "Een definitief proces-verbaal kan niet meer worden gewijzigd."
      : "Je mag alleen je eigen concept-PV wijzigen.");
    error.status = existing.status === "definitief" ? 409 : 403;
    throw error;
  }
  const now = new Date().toISOString();
  return normalizeProcessVerbal({
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    createdByKey: existing.createdByKey,
    updatedAt: now,
    finalizedAt: normalizeProcessVerbalStatus(patch.status || existing.status) === "definitief"
      ? existing.finalizedAt || now
      : ""
  }, { now });
}

module.exports = {
  PROCESS_VERBAL_TYPES,
  PROCESS_VERBAL_FIELD_LABELS,
  canEditProcessVerbal,
  canViewProcessVerbal,
  filterProcessVerbals,
  normalizeProcessVerbal,
  normalizeProcessVerbalRelated,
  normalizeProcessVerbalStatus,
  normalizeProcessVerbalType,
  processVerbalActorKey,
  processVerbalDocument,
  sortProcessVerbals,
  updateProcessVerbal
};
