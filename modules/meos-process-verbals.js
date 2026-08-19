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

function normalizeProcessVerbal(input = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const type = normalizeProcessVerbalType(input.type);
  const status = normalizeProcessVerbalStatus(input.status);
  const createdBy = input.createdBy && typeof input.createdBy === "object" ? clone(input.createdBy) : {};
  const createdByKey = text(input.createdByKey || options.actorKey || processVerbalActorKey(createdBy), 160);
  const finalizedAt = status === "definitief" ? text(input.finalizedAt || now, 80) : "";
  return {
    id: text(input.id || entryId(), 80),
    type,
    typeLabel: PROCESS_VERBAL_TYPES[type].label,
    title: text(input.title, 180, PROCESS_VERBAL_TYPES[type].label),
    status,
    date: text(input.date, 40),
    location: text(input.location, 160),
    caseNumber: text(input.caseNumber, 80),
    subjectName: text(input.subjectName, 160),
    subjectBsn: text(input.subjectBsn, 80),
    subjectFingerprint: text(input.subjectFingerprint, 80),
    summary: text(input.summary, 1000),
    fields: normalizeProcessVerbalFields(input.fields),
    document: text(input.document, 16000),
    createdAt: text(input.createdAt || now, 80),
    updatedAt: text(input.updatedAt || now, 80),
    finalizedAt,
    createdBy,
    createdByKey
  };
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
  return sortProcessVerbals(rows)
    .filter((row) => canViewProcessVerbal(row, options))
    .filter((row) => !hasTypeFilter || row.type === type)
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
  canEditProcessVerbal,
  canViewProcessVerbal,
  filterProcessVerbals,
  normalizeProcessVerbal,
  normalizeProcessVerbalStatus,
  normalizeProcessVerbalType,
  processVerbalActorKey,
  sortProcessVerbals,
  updateProcessVerbal
};
