const crypto = require("node:crypto");
const {
  currentOrganization,
  serviceNumberGroupForRank,
  serviceNumberGroupsForRank
} = require("./organizations");
const {
  hasOvcFunctionBadge,
  normalizeOvcFunctionBadges
} = require("./ovc");
const { isCurrentPerson } = require("./person-status");

// Centrale Personeelsportaal domeinregels: rangen, dienstnummers, profieldata en mutaties.
const organization = currentOrganization();
const ranks = organization.ranks;

const rankWeight = new Map(ranks.map((rank, index) => [rank, ranks.length - index]));
const profileTrainings = organization.profileTrainings;
const profileOperational = organization.profileOperational;
const extraTasks = organization.extraTasks;
const extraFunctions = organization.extraFunctions;
const restrictedTaskBadges = new Set(organization.restrictedTaskBadges || []);
const mentorRanks = organization.mentorRanks;
const mentorTrainingName = organization.mentorTrainingName;
const mentorChecklistCount = organization.mentorChecklistCount || 13;
const defaultRecruitRank = organization.defaultRecruitRank;
const disciplineTypes = new Set(["regular-warning", "regular-strike", "i8-warning", "i8-strike"]);
const disciplineLabels = {
  "regular-warning": "Offici\u00eble Waarschuwing",
  "regular-strike": "Strike",
  "i8-warning": "I8 Waarschuwing",
  "i8-strike": "I8 Strike"
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function hiredDateFor(person, fallback = today()) {
  return person.hiredDate || person.rankHistory?.[0]?.date || person.rankDate || person.promotionDate || fallback;
}

function formatDate(value) {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next.toISOString().slice(0, 10);
}

function getGroupForRank(rank) {
  return serviceNumberGroupForRank(organization, rank);
}

function getGroupsForRank(rank) {
  return serviceNumberGroupsForRank(organization, rank);
}

function sameServiceNumberGroup(first, second) {
  if (!first || !second) return false;
  return first.prefix === second.prefix && Number(first.min) === Number(second.min) && Number(first.max) === Number(second.max);
}

function isAutoSortedRank(rank) {
  const sortableRanks = new Set(organization.autoSortRanks || []);
  return getGroupsForRank(rank).some((group) => (
    group.autoSort && (!sortableRanks.size || sortableRanks.has(rank))
  ));
}

function requiresManualRankChangeServiceNumber(rank) {
  if (!organization.manualRankChangeServiceNumber) return false;
  if (organization.manualRankChangeServiceNumberForAllRanks) return true;
  return !isAutoSortedRank(rank);
}

function formatService(prefix, number) {
  return `${prefix}-${String(number).padStart(2, "0")}`;
}

function getAvailableServiceNumbers(state, rank, currentId = "", preferredPrefix = "") {
  const groups = getGroupsForRank(rank);
  const sortedGroups = preferredPrefix
    ? [...groups].sort((first, second) => {
        if (first.prefix === preferredPrefix && second.prefix !== preferredPrefix) return -1;
        if (second.prefix === preferredPrefix && first.prefix !== preferredPrefix) return 1;
        return 0;
      })
    : groups;
  const used = new Set(
    (state.people || [])
      .filter((person) => person.id !== currentId)
      .filter((person) => isCurrentPerson(person))
      .map((person) => person.serviceNumber)
      .filter(Boolean)
  );
  const numbers = [];
  for (const group of sortedGroups) {
    for (let i = group.min; i <= group.max; i += 1) {
      const service = formatService(group.prefix, i);
      if (!used.has(service)) numbers.push(service);
    }
  }
  return numbers;
}

function serviceNumberPrefix(serviceNumber) {
  const match = /^(\d{2})-\d{2,3}$/.exec(String(serviceNumber || "").trim());
  return match?.[1] || "";
}

function assignFirstAvailableServiceNumber(state, person, preferredPrefix = "") {
  const numbers = getAvailableServiceNumbers(state, person.rank, person.id, preferredPrefix);
  person.serviceNumber = numbers[0] || "";
}

function assignPreferredServiceNumberIfAvailable(state, person, preferredServiceNumber) {
  const serviceNumber = String(preferredServiceNumber || "").trim();
  if (!serviceNumber) return false;
  const numbers = new Set(getAvailableServiceNumbers(state, person.rank, person.id));
  if (!numbers.has(serviceNumber)) return false;
  person.serviceNumber = serviceNumber;
  return true;
}

function serviceNumberMatchesRank(person) {
  if (hasOvcFunctionBadge(person) && !person.rank && !person.serviceNumber) return true;
  const prefix = serviceNumberPrefix(person.serviceNumber);
  if (!prefix || !ranks.includes(person.rank)) return false;
  return getGroupsForRank(person.rank).some((group) => group.prefix === prefix);
}

function normalizeServiceNumbersForRankRanges(state, options = {}) {
  const actorName = String(options.actorName || "Systeem").trim() || "Systeem";
  const changed = [];
  const todayValue = today();
  state.people = Array.isArray(state.people) ? state.people : [];
  state.activity = Array.isArray(state.activity) ? state.activity : [];

  for (const person of state.people) {
    if (!isCurrentPerson(person) || !person.rank || !person.serviceNumber) continue;
    if (serviceNumberMatchesRank(person)) continue;
    const previousServiceNumber = person.serviceNumber;
    assignFirstAvailableServiceNumber(state, person);
    if (!person.serviceNumber || person.serviceNumber === previousServiceNumber) continue;
    person.rankHistory = Array.isArray(person.rankHistory) ? person.rankHistory : [];
    person.rankHistory.push({
      rank: person.rank,
      date: todayValue,
      serviceNumber: person.serviceNumber,
      action: "service-number-normalized",
      changedByName: actorName,
      previousServiceNumber
    });
    state.activity.push(`${person.name} automatisch verplaatst van roepnummer ${previousServiceNumber} naar ${person.serviceNumber}.`);
    changed.push({ person, previousServiceNumber, serviceNumber: person.serviceNumber });
  }

  return changed;
}

function applyRankChangeServiceNumber(state, person, previousGroup, nextGroup, previousPrefix, options = {}) {
  const requestedServiceNumber = String(options.serviceNumber || "").trim();
  const requiresManualNumber = requiresManualRankChangeServiceNumber(person.rank);

  if (requestedServiceNumber) {
    person.serviceNumber = requestedServiceNumber;
  } else if (requiresManualNumber) {
    return "Kies een dienstnummer voor deze rang.";
  } else if (!sameServiceNumberGroup(previousGroup, nextGroup) || !person.serviceNumber) {
    assignFirstAvailableServiceNumber(state, person, previousPrefix);
  }

  return assertValidServiceNumber(state, person);
}

function autoSortServiceNumbers(state) {
  const sortableGroups = (organization.serviceNumberGroups || []).filter((group) => group.autoSort);
  const sortableRanks = new Set(organization.autoSortRanks || []);
  const todayValue = today();
  sortableGroups.forEach((group) => {
    const groupRanks = new Set(group.ranks || []);
    const members = (state.people || [])
      .filter((person) => (person.serviceNumber || "").startsWith(`${group.prefix}-`) && isCurrentPerson(person))
      .filter((person) => !groupRanks.size || groupRanks.has(person.rank))
      .filter((person) => !sortableRanks.size || sortableRanks.has(person.rank))
      .sort((a, b) => {
        const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
        if (rankDelta !== 0) return rankDelta;
        return new Date(a.rankDate || 0) - new Date(b.rankDate || 0);
      });

    members.forEach((person, index) => {
      const nextSequence = group.min + index;
      if (group.max && nextSequence > group.max) return;
      const nextNumber = formatService(group.prefix, nextSequence);
      if (person.serviceNumber !== nextNumber) {
        person.serviceNumber = nextNumber;
        person.rankHistory = person.rankHistory || [];
        person.rankHistory.push({ rank: person.rank, date: todayValue, serviceNumber: nextNumber });
      }
    });
  });
}

function assertValidServiceNumber(state, person) {
  if (hasOvcFunctionBadge(person) && !person.rank && !person.serviceNumber) return "";
  const match = /^(\d{2})-(\d{2,3})$/.exec(person.serviceNumber || "");
  if (!match) {
    return "Dienstnummer hoort niet bij deze ranggroep.";
  }
  const groups = getGroupsForRank(person.rank);
  const group = groups.find((entry) => entry.prefix === match[1]);
  if (!group) return "Dienstnummer hoort niet bij deze ranggroep.";
  const value = Number(match[2]);
  const outsideConfiguredRange = value < group.min || value > group.max;
  if (outsideConfiguredRange && !organization.customServiceNumbers) {
    return "Dienstnummer valt buiten de toegestane reeks.";
  }
  const duplicate = (state.people || []).find(
    (entry) =>
      entry.id !== person.id &&
      isCurrentPerson(entry) &&
      entry.serviceNumber === person.serviceNumber
  );
  return duplicate ? "Dienstnummer is al in gebruik." : "";
}

function savePerson(state, payload) {
  const todayValue = today();
  const existing = (state.people || []).find((person) => person.id === payload.id);
  const person = {
    id: payload.id || crypto.randomUUID(),
    name: String(payload.name || "").trim(),
    discordId: String(payload.discordId || "").trim(),
    avatar: String(payload.avatar || "").trim(),
    rank: payload.rank,
    serviceNumber: payload.serviceNumber,
    permRole: existing?.permRole || "Geen",
    hiredDate: payload.hiredDate || (existing ? hiredDateFor(existing, todayValue) : todayValue),
    rankDate: payload.rankDate || todayValue,
    promotionDate: payload.promotionDate || todayValue,
    badges: Array.isArray(payload.badges) ? payload.badges.map((badge) => String(badge).trim()).filter(Boolean) : existing?.badges || [],
    extraFunctions: existing?.extraFunctions || [],
    tasks: String(payload.tasks || "").trim(),
    completedTrainings: existing?.completedTrainings || [],
    completedOperational: existing?.completedOperational || [],
    portoPhone: existing?.portoPhone || "",
    profileNote: existing?.profileNote || null,
    discipline: existing?.discipline || [],
    mentorChecklist: existing?.mentorChecklist || { completed: false, testSent: false, testApproved: false, items: Array.from({ length: mentorChecklistCount }, () => false), notes: [] },
    status: existing?.status || "Actief",
    rankHistory: existing?.rankHistory || []
  };
  person.extraFunctions = normalizeOvcFunctionBadges(person.extraFunctions);
  const requestedRank = person.rank;
  const requestedRankDate = person.rankDate;
  let requestedServiceNumber = person.serviceNumber;
  const isOvcOnlyProfile = hasOvcFunctionBadge(person) && !person.rank && !person.serviceNumber;

  if (
    organization.key === "politie" &&
    !existing &&
    !isOvcOnlyProfile &&
    ranks.includes(person.rank) &&
    !person.serviceNumber
  ) {
    assignFirstAvailableServiceNumber(state, person);
    requestedServiceNumber = person.serviceNumber;
  }

  if (
    organization.key === "politie" &&
    existing &&
    existing.rank !== person.rank &&
    !isOvcOnlyProfile &&
    ranks.includes(person.rank)
  ) {
    assignFirstAvailableServiceNumber(state, person);
    requestedServiceNumber = person.serviceNumber;
  }

  if (!person.name || !person.discordId || (!isOvcOnlyProfile && (!ranks.includes(person.rank) || !person.serviceNumber))) {
    return { error: "Naam, Discord ID, rang en dienstnummer zijn verplicht." };
  }

  const serviceError = assertValidServiceNumber(state, person);
  if (serviceError) return { error: serviceError };

  if (!isOvcOnlyProfile && (!existing || existing.rank !== person.rank || existing.serviceNumber !== person.serviceNumber)) {
    person.rankHistory.push({ rank: person.rank, date: person.rankDate, serviceNumber: person.serviceNumber });
  }

  state.people = state.people || [];
  state.activity = state.activity || [];
  if (existing) {
    Object.assign(existing, person);
    state.activity.push(`${person.name} bijgewerkt.`);
  } else {
    state.people.push(person);
    state.activity.push(`${person.name} toegevoegd als ${person.rank}.`);
  }
  autoSortServiceNumbers(state);
  if (!isAutoSortedRank(requestedRank)) {
    const savedPerson = state.people.find((entry) => entry.id === person.id);
    if (savedPerson && savedPerson.serviceNumber !== requestedServiceNumber) {
      savedPerson.serviceNumber = requestedServiceNumber;
      const lastHistory = savedPerson.rankHistory?.[savedPerson.rankHistory.length - 1];
      if (lastHistory && lastHistory.rank === requestedRank && lastHistory.date === requestedRankDate) {
        lastHistory.serviceNumber = requestedServiceNumber;
      }
    }
  }
  return { person };
}

function promotePerson(state, person, options = {}) {
  const currentIndex = ranks.indexOf(person.rank);
  if (currentIndex <= 0) return { ok: false };

  const previousRank = person.rank;
  const previousGroup = getGroupForRank(previousRank);
  const previousPrefix = serviceNumberPrefix(person.serviceNumber);
  const previousState = {
    rank: person.rank,
    serviceNumber: person.serviceNumber,
    rankDate: person.rankDate,
    promotionDate: person.promotionDate,
    hiredDate: person.hiredDate
  };
  const nextRank = ranks[currentIndex - 1];
  const nextGroup = getGroupForRank(nextRank);
  const todayValue = today();

  person.hiredDate = hiredDateFor(person, todayValue);
  person.rank = nextRank;
  person.rankDate = todayValue;
  person.promotionDate = todayValue;

  const serviceError = applyRankChangeServiceNumber(state, person, previousGroup, nextGroup, previousPrefix, options);
  if (serviceError) {
    Object.assign(person, previousState);
    return { ok: false, error: serviceError };
  }

  person.rankHistory = person.rankHistory || [];
  person.rankHistory.push({
    rank: person.rank,
    date: todayValue,
    serviceNumber: person.serviceNumber,
    action: "promote",
    changedById: String(options.actor?.id || ""),
    changedByName: String(options.actor?.name || options.actor?.displayName || "")
  });
  state.activity = state.activity || [];
  state.activity.push(`${person.name} gepromoveerd van ${previousRank} naar ${nextRank}.`);
  autoSortServiceNumbers(state);
  return { ok: true };
}

function demotePerson(state, person, options = {}) {
  const currentIndex = ranks.indexOf(person.rank);
  if (currentIndex === -1 || currentIndex >= ranks.length - 1) return { ok: false };

  const previousRank = person.rank;
  const previousGroup = getGroupForRank(previousRank);
  const previousPrefix = serviceNumberPrefix(person.serviceNumber);
  const previousState = {
    rank: person.rank,
    serviceNumber: person.serviceNumber,
    rankDate: person.rankDate,
    promotionDate: person.promotionDate,
    hiredDate: person.hiredDate
  };
  const nextRank = ranks[currentIndex + 1];
  const nextGroup = getGroupForRank(nextRank);
  const todayValue = today();

  person.hiredDate = hiredDateFor(person, todayValue);
  person.rank = nextRank;
  person.rankDate = todayValue;
  person.promotionDate = todayValue;

  const serviceError = applyRankChangeServiceNumber(state, person, previousGroup, nextGroup, previousPrefix, options);
  if (serviceError) {
    Object.assign(person, previousState);
    return { ok: false, error: serviceError };
  }

  person.rankHistory = person.rankHistory || [];
  person.rankHistory.push({
    rank: person.rank,
    date: todayValue,
    serviceNumber: person.serviceNumber,
    action: "demote",
    changedById: String(options.actor?.id || ""),
    changedByName: String(options.actor?.name || options.actor?.displayName || "")
  });
  state.activity = state.activity || [];
  state.activity.push(`${person.name} gedegradeerd van ${previousRank} naar ${nextRank}.`);
  autoSortServiceNumbers(state);
  return { ok: true };
}

function normalizeMentorNotes(checklist) {
  const notes = checklist?.notes;
  if (Array.isArray(notes)) {
    return notes
      .map((note) => ({
        id: note.id || crypto.randomUUID(),
        text: String(note.text || "").trim(),
        createdAt: note.createdAt || note.signedAt || note.updatedAt || "",
        authorId: note.authorId || note.signedById || note.updatedById || "",
        authorName: note.authorName || note.signedByName || note.updatedByName || "Onbekend"
      }))
      .filter((note) => note.text);
  }
  const text = String(notes || "").trim();
  if (!text) return [];
  return [
    {
      id: crypto.randomUUID(),
      text,
      createdAt: checklist?.updatedAt || "",
      authorId: checklist?.updatedById || "",
      authorName: checklist?.updatedByName || "Onbekend"
    }
  ];
}

function mentorChecklistItemCountForState(state) {
  const groups = Array.isArray(state?.mentorChecklistGroups) && state.mentorChecklistGroups.length ? state.mentorChecklistGroups : [];
  const count = groups.reduce((sum, group) => sum + (Array.isArray(group.items) ? group.items.length : 0), 0);
  return count || mentorChecklistCount;
}

function profileNoteForView(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { text, updatedAt: "", updatedByName: "" } : null;
  }
  if (typeof value !== "object") return null;
  const text = String(value.text || "").trim();
  if (!text) return null;
  return {
    text,
    updatedAt: value.updatedAt || "",
    updatedById: value.updatedById || "",
    updatedByName: value.updatedByName || ""
  };
}

function stateForProfile(state, permissions, profileId = "") {
  const nextState = JSON.parse(JSON.stringify(state));
  const mentorItemCount = mentorChecklistItemCountForState(nextState);
  const manageableRestrictedTaskBadges = new Set(permissions?.manageableProfileTaskBadges || []);
  nextState.people = (nextState.people || []).map((person) => ({
    ...person,
    badges: person.id === profileId || permissions?.canViewRestrictedTaskBadges
      ? (Array.isArray(person.badges) ? person.badges : [])
      : (Array.isArray(person.badges) ? person.badges.filter((badge) => !restrictedTaskBadges.has(badge) || manageableRestrictedTaskBadges.has(badge)) : []),
    notifications: person.id === profileId ? (Array.isArray(person.notifications) ? person.notifications : []) : [],
    profileLog: permissions?.canViewProfileAuditLog ? (Array.isArray(person.profileLog) ? person.profileLog : []) : [],
    profileNote: person.id === profileId || permissions?.canViewAllProfileNotes
      ? profileNoteForView(person.profileNote)
      : null
  }));
  if (!permissions?.canViewLogbook) {
    nextState.activity = [];
  }
  if (!permissions?.canViewAllHours) {
    nextState.portoOpsLog = (nextState.portoOpsLog || []).filter((entry) => entry.memberId === profileId);
  }
  if (!permissions?.canViewAllHours) {
    nextState.hours = (nextState.hours || []).filter((entry) => entry.personId === profileId);
  }
  nextState.i8Forms = Array.isArray(nextState.i8Forms) ? nextState.i8Forms : [];
  if (!permissions?.canViewOvJChannels) {
    nextState.i8Forms = nextState.i8Forms.filter((form) => form.personId === profileId);
  }
  nextState.resignationForms = Array.isArray(nextState.resignationForms) ? nextState.resignationForms : [];
  if (!permissions?.canViewResignationOverview) {
    nextState.resignationForms = nextState.resignationForms.filter((form) => form.memberId === profileId);
  }
  nextState.blacklist = Array.isArray(nextState.blacklist) ? nextState.blacklist : [];
  if (!permissions?.canViewBlacklist) {
    nextState.blacklist = [];
  }
  nextState.vehicleSeizures = Array.isArray(nextState.vehicleSeizures) ? nextState.vehicleSeizures : [];
  if (!permissions?.canViewAllDiscipline) {
    const allowedTypes = permissions?.canViewI8Discipline ? new Set(["i8-warning", "i8-strike"]) : new Set();
    nextState.people = (nextState.people || []).map((person) => ({
      ...person,
      discipline: person.id === profileId
        ? (person.discipline || [])
        : (person.discipline || []).filter((entry) => allowedTypes.has(entry.type))
    }));
  }
  if (!permissions?.canViewMentorOverview) {
    nextState.people = (nextState.people || []).map((person) => {
      const checklist = person.mentorChecklist || {};
      const isOwnMentorTrajectory = person.id === profileId && mentorRanks.includes(person.rank);
      return {
        ...person,
        mentorChecklist: {
          completed: Boolean(checklist.completed),
          items: isOwnMentorTrajectory && Array.isArray(checklist.items)
            ? Array.from({ length: mentorItemCount }, (_, index) => {
                const item = checklist.items[index];
                return typeof item === "object" ? Boolean(item.checked) : Boolean(item);
              })
            : [],
          notes: permissions?.canViewMentorLeadershipLog ? normalizeMentorNotes(checklist) : ""
        }
      };
    });
  } else if (!permissions?.canViewMentorLeadershipLog) {
    nextState.people = (nextState.people || []).map((person) => ({
      ...person,
      mentorChecklist: {
        ...(person.mentorChecklist || {}),
        audit: []
      }
    }));
  }
  return nextState;
}

function createPersoneelsportaalDomain() {
  return {
    organization,
    ranks,
    profileTrainings,
    profileOperational,
    extraTasks,
    extraFunctions,
    mentorRanks,
    mentorTrainingName,
    mentorChecklistCount,
    defaultRecruitRank,
    disciplineTypes,
    disciplineLabels,
    stateForProfile,
    today,
    hiredDateFor,
    formatDate,
    addMonths,
    getGroupForRank,
    formatService,
    getAvailableServiceNumbers,
    assignFirstAvailableServiceNumber,
    assignPreferredServiceNumberIfAvailable,
    serviceNumberMatchesRank,
    normalizeServiceNumbersForRankRanges,
    autoSortServiceNumbers,
    assertValidServiceNumber,
    savePerson,
    promotePerson,
    demotePerson,
    normalizeMentorNotes
  };
}

module.exports = { createPersoneelsportaalDomain };
