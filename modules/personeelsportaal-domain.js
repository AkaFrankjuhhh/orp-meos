const crypto = require("node:crypto");

// Centrale Defensie Personeelsportaal domeinregels: rangen, dienstnummers, profieldata en mutaties.
const ranks = [
  "Luitenant-Generaal",
  "Generaal-Majoor",
  "Brigade-Generaal",
  "Kolonel",
  "Luitenant-Kolonel",
  "Majoor",
  "Kapitein",
  "Eerste-Luitenant",
  "Tweede-Luitenant",
  "Kornet",
  "Adjudant",
  "Opperwachtmeester",
  "Wachtmeester 1ste Klasser",
  "Wachtmeester",
  "Marechaussee 1ste Klasser",
  "Marechaussee 2de Klasser",
  "Marechaussee 3de Klasser",
  "Marechaussee 4de Klasser"
];

const rankWeight = new Map(ranks.map((rank, index) => [rank, ranks.length - index]));
const profileTrainings = ["BKV", "Mentor-Traject", "IBT", "TMO", "SIV", "ZULU", "OGM", "KW", "SMG"];
const profileOperational = ["OPS", "OPCO", "OVD"];
const extraTasks = ["Interne-Zaken", "OvJ", "hOvJ", "Trainer", "Mentor", "W&S", "Mentor-Leiding", "OTC-Leiding", "W&S-Leiding", "IZ-Leiding", "Trainer-Leiding", "DSI-Leiding", "DSI", "KLu-Leiding", "KLu", "DNR-Leiding", "DNR", "HRB-Leiding", "HRB"];
const extraFunctions = ["Kader", "Hoofdofficier", "Officiersraad"];
const restrictedTaskBadges = new Set(["DSI-Leiding", "DSI", "KLu-Leiding", "KLu", "DNR-Leiding", "DNR", "HRB-Leiding", "HRB"]);
const mentorRanks = ["Marechaussee 4de Klasser", "Marechaussee 3de Klasser", "Marechaussee 2de Klasser"];
const mentorTrainingName = "Mentor-Traject";
const mentorChecklistCount = 13;
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
  if (["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"].includes(rank)) {
    return { prefix: "70", min: 1, max: 5 };
  }
  if (["Kolonel", "Luitenant-Kolonel", "Majoor"].includes(rank)) {
    return { prefix: "71", min: 1, max: 15 };
  }
  if (["Kapitein", "Eerste-Luitenant", "Tweede-Luitenant", "Kornet"].includes(rank)) {
    return { prefix: "72", min: 1, max: 50 };
  }
  if (["Adjudant", "Opperwachtmeester", "Wachtmeester 1ste Klasser", "Wachtmeester"].includes(rank)) {
    return { prefix: "73", min: 1, max: 75 };
  }
  return { prefix: "74", min: 1, max: 100 };
}

function formatService(prefix, number) {
  return `${prefix}-${String(number).padStart(2, "0")}`;
}

function getAvailableServiceNumbers(state, rank, currentId = "") {
  const group = getGroupForRank(rank);
  const used = new Set(
    (state.people || [])
      .filter((person) => person.id !== currentId)
      .filter((person) => person.status === "Actief")
      .map((person) => person.serviceNumber)
      .filter(Boolean)
  );
  const numbers = [];
  for (let i = group.min; i <= group.max; i += 1) {
    const service = formatService(group.prefix, i);
    if (!used.has(service)) numbers.push(service);
  }
  return numbers;
}

function assignFirstAvailableServiceNumber(state, person) {
  const numbers = getAvailableServiceNumbers(state, person.rank, person.id);
  person.serviceNumber = numbers[0] || "";
}

function autoSortServiceNumbers(state) {
  const sortablePrefixes = ["70", "71", "72"];
  const todayValue = today();
  sortablePrefixes.forEach((prefix) => {
    const members = (state.people || [])
      .filter((person) => (person.serviceNumber || "").startsWith(`${prefix}-`) && person.status === "Actief")
      .sort((a, b) => {
        const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
        if (rankDelta !== 0) return rankDelta;
        return new Date(a.rankDate || 0) - new Date(b.rankDate || 0);
      });

    members.forEach((person, index) => {
      const nextNumber = formatService(prefix, index + 1);
      if (person.serviceNumber !== nextNumber) {
        person.serviceNumber = nextNumber;
        person.rankHistory = person.rankHistory || [];
        person.rankHistory.push({ rank: person.rank, date: todayValue, serviceNumber: nextNumber });
      }
    });
  });
}

function assertValidServiceNumber(state, person) {
  const group = getGroupForRank(person.rank);
  const match = /^(\d{2})-(\d{2,3})$/.exec(person.serviceNumber || "");
  if (!match || match[1] !== group.prefix) {
    return "Dienstnummer hoort niet bij deze ranggroep.";
  }
  const value = Number(match[2]);
  if (value < group.min || value > group.max) {
    return "Dienstnummer valt buiten de toegestane reeks.";
  }
  const duplicate = (state.people || []).find(
    (entry) =>
      entry.id !== person.id &&
      entry.status === "Actief" &&
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
    discipline: existing?.discipline || [],
    mentorChecklist: existing?.mentorChecklist || { completed: false, testSent: false, testApproved: false, items: Array.from({ length: mentorChecklistCount }, () => false), notes: [] },
    status: existing?.status || "Actief",
    rankHistory: existing?.rankHistory || []
  };

  if (!person.name || !person.discordId || !ranks.includes(person.rank) || !person.serviceNumber) {
    return { error: "Naam, Discord ID, rang en dienstnummer zijn verplicht." };
  }

  const serviceError = assertValidServiceNumber(state, person);
  if (serviceError) return { error: serviceError };

  if (!existing || existing.rank !== person.rank || existing.serviceNumber !== person.serviceNumber) {
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
  return { person };
}

function promotePerson(state, person) {
  const currentIndex = ranks.indexOf(person.rank);
  if (currentIndex <= 0) return false;

  const previousRank = person.rank;
  const previousGroup = getGroupForRank(previousRank);
  const nextRank = ranks[currentIndex - 1];
  const nextGroup = getGroupForRank(nextRank);
  const todayValue = today();

  person.hiredDate = hiredDateFor(person, todayValue);
  person.rank = nextRank;
  person.rankDate = todayValue;
  person.promotionDate = todayValue;

  if (previousGroup.prefix !== nextGroup.prefix || !person.serviceNumber) {
    assignFirstAvailableServiceNumber(state, person);
  }

  person.rankHistory = person.rankHistory || [];
  person.rankHistory.push({ rank: person.rank, date: todayValue, serviceNumber: person.serviceNumber });
  state.activity = state.activity || [];
  state.activity.push(`${person.name} gepromoveerd van ${previousRank} naar ${nextRank}.`);
  autoSortServiceNumbers(state);
  return true;
}

function demotePerson(state, person) {
  const currentIndex = ranks.indexOf(person.rank);
  if (currentIndex === -1 || currentIndex >= ranks.length - 1) return false;

  const previousRank = person.rank;
  const previousGroup = getGroupForRank(previousRank);
  const nextRank = ranks[currentIndex + 1];
  const nextGroup = getGroupForRank(nextRank);
  const todayValue = today();

  person.hiredDate = hiredDateFor(person, todayValue);
  person.rank = nextRank;
  person.rankDate = todayValue;
  person.promotionDate = todayValue;

  if (previousGroup.prefix !== nextGroup.prefix || !person.serviceNumber) {
    assignFirstAvailableServiceNumber(state, person);
  }

  person.rankHistory = person.rankHistory || [];
  person.rankHistory.push({ rank: person.rank, date: todayValue, serviceNumber: person.serviceNumber });
  state.activity = state.activity || [];
  state.activity.push(`${person.name} gedegradeerd van ${previousRank} naar ${nextRank}.`);
  autoSortServiceNumbers(state);
  return true;
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

function stateForProfile(state, permissions, profileId = "") {
  const nextState = JSON.parse(JSON.stringify(state));
  const mentorItemCount = mentorChecklistItemCountForState(nextState);
  nextState.people = (nextState.people || []).map((person) => ({
    ...person,
    badges: person.id === profileId || permissions?.canViewRestrictedTaskBadges
      ? (Array.isArray(person.badges) ? person.badges : [])
      : (Array.isArray(person.badges) ? person.badges.filter((badge) => !restrictedTaskBadges.has(badge)) : []),
    notifications: person.id === profileId ? (Array.isArray(person.notifications) ? person.notifications : []) : [],
    profileLog: permissions?.canViewProfileAuditLog ? (Array.isArray(person.profileLog) ? person.profileLog : []) : []
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
    ranks,
    profileTrainings,
    profileOperational,
    extraTasks,
    extraFunctions,
    mentorRanks,
    mentorTrainingName,
    mentorChecklistCount,
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
    autoSortServiceNumbers,
    assertValidServiceNumber,
    savePerson,
    promotePerson,
    demotePerson,
    normalizeMentorNotes
  };
}

module.exports = { createPersoneelsportaalDomain };
