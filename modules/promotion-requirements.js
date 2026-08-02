const PROMOTION_TASK_REQUIREMENT_KEY = "__PROMOTION_TASK__";
const PROMOTION_TASK_REQUIREMENT_LABEL = "Mentor/Trainer/Interne-Zaken/hOvJ/W&S";
const MAJOR_LEADERSHIP_REQUIREMENT_KEY = "__MAJOR_LEADERSHIP__";
const MAJOR_LEADERSHIP_REQUIREMENT_LABEL = "OVJ/leidingfunctie";

const PROMOTION_TASK_BADGES = [
  "Mentor",
  "Mentor-Leiding",
  "Trainer",
  "Trainer-Leiding",
  "Interne-Zaken",
  "hOvJ",
  "W&S",
  "W&S-Leiding"
];

const MAJOR_LEADERSHIP_BADGES = [
  "OvJ",
  "OVJ",
  "hOvJ",
  "DSI-Leiding",
  "HRB-Leiding",
  "KLu-Leiding",
  "DNR-Leiding",
  "IZ-Leiding",
  "Interne-Zaken-Leiding",
  "Trainer-Leiding",
  "Mentor-Leiding",
  "W&S-Leiding",
  "OTC-Leiding"
];

function requirementName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function listRequirementValues(value) {
  if (Array.isArray(value)) return value.flatMap(listRequirementValues);
  if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (value && typeof value === "object") {
    return Object.values(value)
      .filter((entry) => typeof entry === "string" || Array.isArray(entry))
      .flatMap(listRequirementValues);
  }
  return [];
}

function completedTrainingNamesFor(person) {
  return new Set([
    ...listRequirementValues(person?.completedTrainings),
    ...listRequirementValues(person?.completedOperational)
  ].map(requirementName));
}

function badgeNamesFor(person) {
  return new Set([
    ...listRequirementValues(person?.badges),
    ...listRequirementValues(person?.extraTasks),
    ...listRequirementValues(person?.extraFunctions),
    ...listRequirementValues(person?.tasks)
  ].map(requirementName));
}

function hasAnyBadge(person, badges) {
  const names = badgeNamesFor(person);
  return badges.some((badge) => names.has(requirementName(badge)));
}

function promotionRequirementLabel(requirement) {
  if (requirement === PROMOTION_TASK_REQUIREMENT_KEY) return PROMOTION_TASK_REQUIREMENT_LABEL;
  if (requirement === MAJOR_LEADERSHIP_REQUIREMENT_KEY) return MAJOR_LEADERSHIP_REQUIREMENT_LABEL;
  return String(requirement || "");
}

function missingPromotionRequirements(organization, person, currentRank = person?.rank) {
  if (organization?.key !== "defensie" || !currentRank) return [];
  const requirements = organization.rankTrainingRequirements?.[currentRank] || [];
  if (!Array.isArray(requirements) || !requirements.length) return [];

  const completed = completedTrainingNamesFor(person);
  const missing = [];
  for (const requirement of requirements) {
    if (requirement === PROMOTION_TASK_REQUIREMENT_KEY) {
      if (!hasAnyBadge(person, PROMOTION_TASK_BADGES)) missing.push(PROMOTION_TASK_REQUIREMENT_LABEL);
      continue;
    }
    if (requirement === MAJOR_LEADERSHIP_REQUIREMENT_KEY) {
      if (!hasAnyBadge(person, MAJOR_LEADERSHIP_BADGES)) missing.push(MAJOR_LEADERSHIP_REQUIREMENT_LABEL);
      continue;
    }
    if (!completed.has(requirementName(requirement))) missing.push(promotionRequirementLabel(requirement));
  }
  return [...new Set(missing)];
}

module.exports = {
  missingPromotionRequirements,
  PROMOTION_TASK_REQUIREMENT_KEY,
  MAJOR_LEADERSHIP_REQUIREMENT_KEY
};
