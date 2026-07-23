// Defensie Personeelsportaal API-routes staan los van Porto, zodat beide websites apart kunnen groeien.
const crypto = require("node:crypto");
const { currentOrganization } = require("./organizations");
const {
  OVC_FUNCTION_BADGE,
  hasOvcFunctionBadge,
  isOvcFunctionBadge,
  normalizeOvcFunctionBadges
} = require("./ovc");
const {
  dateOnly,
  absenceIsActiveOnDate,
  normalizeAbsenceDrivenPeopleStatuses,
  applyManualAbsenceStatusSource
} = require("./absence-status");
const { markNotificationsRead, clearNotifications } = require("./notifications");
const {
  mentorChecklistStaleAfterReactivation,
  mentorReviewStateForStatus,
  mentorTestStaleAfterReactivation
} = require("./mentor-tests-logic");
const { setDiscordSyncStatus, syncStatusFromError } = require("./discord-sync-status");
const { isCurrentPerson } = require("./person-status");
const { missingPromotionRequirements } = require("./promotion-requirements");
const { publicFormFromSlug, publicFormTicketNumber } = require("./public-forms");

function createPersoneelsportaalRouteHandler(deps) {
  const organization = currentOrganization();
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";
  const portalTitle = organization.portalTitle || "Personeelsportaal";
  const qualificationRoleLabels = Object.keys(organization.discord?.qualificationRoleMappings || {});
  const trainingRequirementRoleLabels = Object.keys(organization.discord?.trainingRequirementRoleMappings || {});
  const {
    requireAuth,
    readState,
    writeState,
    readBody,
    sendJson,
    sendStateAfterMutation,
    hasKaderAccess,
    hasPermission,
    permissionsForAuth,
    stateForProfile,
    normalizeDiscordId,
    today,
    addMonths,
    autoSortServiceNumbers,
    getAvailableServiceNumbers,
    savePerson,
    promotePerson,
    demotePerson,
    assignFirstAvailableServiceNumber,
    normalizeMentorNotes,
    ranks,
    profileTrainings,
    profileOperational,
    extraFunctions,
    extraTasks,
    disciplineTypes,
    disciplineLabels,
    mentorRanks,
    mentorChecklistCount,
    mentorTrainingName,
    defaultRecruitRank,
    sendDiscordWebhook,
    absenceWebhookUrl,
    personnelWebhookUrl,
    buildAbsenceWebhookPayload,
    buildRecruitmentWebhookPayload,
    buildDismissalWebhookPayload,
    buildResignationFormWebhookPayload,
    buildBlacklistWebhookPayload,
    vehicleSeizureWebhookUrl,
    buildVehicleSeizureWebhookPayload,
    buildInvestigationWebhookPayload,
    mentorTestsStore,
    mentorTestWebhookUrl,
    buildMentorTestWebhookPayload,
    discordBot,
    enqueuePersonDiscordSync,
    enqueueDiscordSyncJob,
    publicFormsStore
  } = deps;

  const formsStorage = deps.formsStorage || { readState, writeState };
  const peopleStorage = deps.peopleStorage || { readState, writeState };
  const vehicleSeizuresStore = deps.vehicleSeizuresStore || null;

  const defaultMentorChecklistGroups = Array.isArray(organization.mentorChecklistGroups) && organization.mentorChecklistGroups.length
    ? organization.mentorChecklistGroups
    : [
        {
          title: "Praktijk",
          items: [
            "Leerling kent de rechten van een verdachte",
            "Leerling kan rustig handelen tijdens een incident",
            "Leerling weet hoe een verdachte staande gehouden wordt",
            "Leerling weet hoe een verdachte aangehouden wordt",
            "Leerling kan een BTGV uitvoeren",
            "Leerling kan zich professioneel opstellen",
            "Leerling heeft zijn vuurwapen op een correcte manier gebruikt"
          ]
        },
        {
          title: "Theorie",
          items: [
            "Leerling weet hoe MEOS werkt",
            "Leerling weet hoe een I8 ingevuld moet worden",
            "Leerling kan bewijzen opstellen",
            "Leerling kent de geweldsladder",
            "Leerling kent de douane gebieden",
            "Leerling kent de discord"
          ]
        }
      ];

  function slugId(value, fallback) {
    const slug = String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || fallback;
  }

  function mentorTemplateGroups(state) {
    const source = Array.isArray(state.mentorChecklistGroups) && state.mentorChecklistGroups.length
      ? state.mentorChecklistGroups
      : defaultMentorChecklistGroups;
    return source.map((group, groupIndex) => ({
      id: group.id || slugId(group.title, `groep-${groupIndex + 1}`),
      title: String(group.title || `Groep ${groupIndex + 1}`).trim(),
      items: (group.items || []).map((item, itemIndex) => {
        const label = typeof item === "string" ? item : item.label;
        return {
          id: typeof item === "object" && item?.id ? item.id : slugId(label, `punt-${groupIndex + 1}-${itemIndex + 1}`),
          label: String(label || "").trim()
        };
      }).filter((item) => item.label)
    })).filter((group) => group.items.length);
  }

  function mentorTemplateItems(state) {
    return mentorTemplateGroups(state).flatMap((group) => group.items);
  }

  function mentorChecklistItemsForTemplate(existing, templateItems) {
    const incoming = Array.isArray(existing?.items) ? existing.items : [];
    const byId = new Map();
    const byLabel = new Map();
    incoming.forEach((item, index) => {
      if (item && typeof item === "object") {
        if (item.id) byId.set(item.id, Boolean(item.checked));
        if (item.label) byLabel.set(item.label, Boolean(item.checked));
      } else {
        byLabel.set(templateItems[index]?.label || String(index), Boolean(item));
      }
    });
    const completed = Boolean(existing?.completed);
    return templateItems.map((item, index) => ({
      id: item.id,
      label: item.label,
      checked: completed || byId.get(item.id) || byLabel.get(item.label) || Boolean(incoming[index])
    }));
  }

  function normalizeMentorChecklistForState(person, state) {
    const templateItems = mentorTemplateItems(state);
    const existing = person.mentorChecklist || {};
    const staleAfterReactivation = mentorChecklistStaleAfterReactivation(person, existing);
    const items = mentorChecklistItemsForTemplate(staleAfterReactivation ? {} : existing, templateItems);
    const allItemsCompleted = !staleAfterReactivation && items.length > 0 && items.every((item) => item.checked);
    const testSent = !staleAfterReactivation && Boolean(existing.testSent);
    const testApproved = allItemsCompleted && testSent && Boolean(existing.testApproved);
    return {
      ...existing,
      completed: allItemsCompleted && testSent && testApproved,
      testSent,
      testApproved,
      items,
      audit: Array.isArray(existing.audit) ? existing.audit : [],
      testReadyNotifiedAt: staleAfterReactivation ? "" : existing.testReadyNotifiedAt || "",
      updatedAt: staleAfterReactivation ? "" : existing.updatedAt || "",
      updatedById: staleAfterReactivation ? "" : existing.updatedById || "",
      updatedByName: staleAfterReactivation ? "" : existing.updatedByName || ""
    };
  }

  function isMentorTrajectoryCompleted(person, state) {
    const checklist = normalizeMentorChecklistForState(person, state);
    const items = Array.isArray(checklist.items) ? checklist.items : [];
    return Boolean(checklist.completed)
      && items.length > 0
      && items.every((item) => Boolean(item.checked))
      && Boolean(checklist.testSent)
      && Boolean(checklist.testApproved);
  }

  function profileHasFunction(profile, label) {
    const badges = new Set([
      profile?.permRole,
      ...(profile?.extraFunctions || []),
      ...(profile?.badges || [])
    ].filter(Boolean));
    for (const mapping of organization.autoFunctionByRanks || []) {
      if (mapping.label === label && (mapping.ranks || []).includes(profile?.rank || "")) badges.add(mapping.label);
    }
    return badges.has(label);
  }

  function canBypassMentorPromotion(actor, permissions) {
    if (organization.key !== "politie") return false;
    return Boolean(permissions?.canUseDevTools) || profileHasFunction(actor, "Korpsleiding");
  }

  function promotionBlockReason(person, state, actor, permissions) {
    const currentIndex = ranks.indexOf(person.rank);
    const nextRank = currentIndex > 0 ? ranks[currentIndex - 1] : "";
    if (
      organization.key === "politie"
      && person.rank === "Aspirant"
      && nextRank === "Surveillant"
      && !isMentorTrajectoryCompleted(person, state)
      && !canBypassMentorPromotion(actor, permissions)
    ) {
      return "Promotie naar Surveillant kan pas als het mentor-traject volledig is afgerond.";
    }
    const missing = missingPromotionRequirements(organization, person, person.rank);
    if (missing.length) {
      return `Promotie naar ${nextRank} kan pas als deze vereisten behaald zijn: ${missing.join(", ")}.`;
    }
    return "";
  }

  function currentDateOnly() {
    return dateOnly(today()) || new Date().toISOString().slice(0, 10);
  }

  function absenceIsActiveToday(absence, current = currentDateOnly()) {
    return absenceIsActiveOnDate(absence, current);
  }

  async function normalizeAbsenceDrivenPeopleStatusesIfNeeded(state) {
    if (!Array.isArray(state?.people)) return;
    if (!normalizeAbsenceDrivenPeopleStatuses(state, currentDateOnly())) return;
    await Promise.resolve(peopleStorage.writeState(state));
  }

  async function readFormsState() {
    const state = await Promise.resolve(formsStorage.readState());
    await normalizeAbsenceDrivenPeopleStatusesIfNeeded(state);
    return state;
  }

  async function persistFormsStateMutation(state, targetedWrite) {
    if (typeof targetedWrite === "function") {
      await Promise.resolve(targetedWrite());
    } else {
      await Promise.resolve(formsStorage.writeState(state));
    }
  }

  function responseProfileId(auth, options = {}) {
    return options.profileId || auth.profile.id;
  }

  function currentPersonForAuth(state, auth) {
    const people = Array.isArray(state?.people) ? state.people : [];
    const authProfileId = auth?.profile?.id || "";
    const byProfileId = people.find((person) => person.id === authProfileId && isCurrentPerson(person));
    if (byProfileId) return byProfileId;

    const authDiscordId = normalizeDiscordId(auth?.session?.user?.id || auth?.profile?.discordId || "");
    if (!authDiscordId) return null;
    return people.find((person) => normalizeDiscordId(person.discordId || "") === authDiscordId && isCurrentPerson(person)) || null;
  }

  function sendFormsStateResponse(res, auth, state, options = {}) {
    const permissions = permissionsForAuth(auth, state);
    const profileId = responseProfileId(auth, options);
    sendJson(res, 200, {
      ok: true,
      state: stateForProfile(state, permissions, profileId),
      canViewLogbook: permissions.canViewLogbook,
      permissions
    });
  }

  async function sendFormsStateAfterMutation(res, auth, state, targetedWrite, options = {}) {
    await persistFormsStateMutation(state, targetedWrite);
    if (options.normalizeAbsences !== false) {
      await normalizeAbsenceDrivenPeopleStatusesIfNeeded(state);
    }
    sendFormsStateResponse(res, auth, state, options);
  }

  async function persistFormsActivityBestEffort(state, targetedWrite) {
    try {
      await persistFormsStateMutation(state, targetedWrite);
    } catch (error) {
      state.activity = state.activity || [];
      state.activity.push(`Activiteitlog bijwerken mislukt: ${error.message || "onbekende fout"}.`);
    }
  }

  async function readPeopleState() {
    const state = await Promise.resolve(peopleStorage.readState());
    if (vehicleSeizuresStore && typeof vehicleSeizuresStore.listSeizures === "function") {
      state.vehicleSeizures = await vehicleSeizuresStore.listSeizures({ limit: 500 });
    } else {
      state.vehicleSeizures = Array.isArray(state.vehicleSeizures) ? state.vehicleSeizures : [];
    }
    await normalizeAbsenceDrivenPeopleStatusesIfNeeded(state);
    return state;
  }

  async function persistPeopleStateMutation(state) {
    normalizeAbsenceDrivenPeopleStatuses(state, currentDateOnly());
    await Promise.resolve(peopleStorage.writeState(state));
  }

  function sendPeopleStateResponse(res, auth, state) {
    const permissions = permissionsForAuth(auth, state);
    sendJson(res, 200, {
      ok: true,
      state: stateForProfile(state, permissions, auth.profile.id),
      canViewLogbook: permissions.canViewLogbook,
      permissions
    });
  }

  async function sendPeopleStateAfterMutation(res, auth, state) {
    await persistPeopleStateMutation(state);
    sendPeopleStateResponse(res, auth, state);
  }

  async function refreshVehicleSeizuresOnState(state) {
    if (!vehicleSeizuresStore || typeof vehicleSeizuresStore.listSeizures !== "function") {
      state.vehicleSeizures = Array.isArray(state.vehicleSeizures) ? state.vehicleSeizures : [];
      return state.vehicleSeizures;
    }
    state.vehicleSeizures = await vehicleSeizuresStore.listSeizures({ limit: 500 });
    return state.vehicleSeizures;
  }

  async function sendVehicleSeizureWebhook(state, seizure, actor, event) {
    if (!vehicleSeizureWebhookUrl || !buildVehicleSeizureWebhookPayload) return;
    try {
      const webhookResult = await sendDiscordWebhook(
        vehicleSeizureWebhookUrl(),
        buildVehicleSeizureWebhookPayload(seizure, actor, event)
      );
      state.activity = state.activity || [];
      if (webhookResult?.ok) {
        state.activity.push(`Voertuiginbeslagname webhook verzonden voor ${seizure.plate || seizure.vehicle}.`);
      } else if (webhookResult && !webhookResult.skipped) {
        state.activity.push(`Voertuiginbeslagname webhook kon niet verzonden worden voor ${seizure.plate || seizure.vehicle}.`);
      }
    } catch (error) {
      state.activity = state.activity || [];
      state.activity.push(`Voertuiginbeslagname webhook kon niet verzonden worden voor ${seizure.plate || seizure.vehicle}.`);
    }
  }

  function activeBlacklistEntryForDiscordId(state, discordId) {
    const normalized = normalizeDiscordId(discordId);
    if (!normalized) return null;
    return (state.blacklist || []).find((entry) => normalizeDiscordId(entry.discordId) === normalized && !entry.revokedAt) || null;
  }

  function existingProfileForDiscordId(state, discordId, excludedPersonId = "") {
    const normalized = normalizeDiscordId(discordId);
    if (!normalized) return null;
    return (state.people || []).find((person) => (
      person.id !== excludedPersonId &&
      isCurrentPerson(person) &&
      normalizeDiscordId(person.discordId) === normalized
    )) || null;
  }

  function unlinkDeletedPersonReferences(state, person) {
    const personId = person?.id || "";
    if (!personId) return { hoursRemoved: 0, resignationUnlinked: 0, blacklistUnlinked: 0 };
    const previousHours = Array.isArray(state.hours) ? state.hours : [];
    state.hours = previousHours.filter((entry) => entry.personId !== personId);
    let resignationUnlinked = 0;
    state.resignationForms = (Array.isArray(state.resignationForms) ? state.resignationForms : []).map((entry) => {
      if (entry.memberId !== personId) return entry;
      resignationUnlinked += 1;
      return {
        ...entry,
        memberId: "",
        name: entry.name || person.name || "",
        rank: entry.rank || person.rank || "",
        serviceNumber: entry.serviceNumber || person.serviceNumber || ""
      };
    });
    let blacklistUnlinked = 0;
    state.blacklist = (Array.isArray(state.blacklist) ? state.blacklist : []).map((entry) => {
      if (entry.personId !== personId) return entry;
      blacklistUnlinked += 1;
      return {
        ...entry,
        personId: "",
        name: entry.name || person.name || "",
        discordId: entry.discordId || person.discordId || "",
        rank: entry.rank || person.rank || "",
        serviceNumber: entry.serviceNumber || person.serviceNumber || ""
      };
    });
    return {
      hoursRemoved: previousHours.length - state.hours.length,
      resignationUnlinked,
      blacklistUnlinked
    };
  }

  function canManageRankAction(permissions, person, action) {
    if (permissions.canManagePeople) return true;
    if (!permissions.canManagePersonnelRanks || !person) return false;
    const adjudantIndex = ranks.indexOf("Adjudant");
    const currentIndex = ranks.indexOf(person.rank);
    if (adjudantIndex < 0 || currentIndex < 0) return false;
    if (action === "promote") {
      const nextRank = ranks[currentIndex - 1];
      const nextIndex = ranks.indexOf(nextRank);
      return nextIndex >= adjudantIndex;
    }
    if (action === "demote") return currentIndex >= adjudantIndex;
    return false;
  }

  function canDismissPerson(permissions, person) {
    if (hasOvcFunctionBadge(person) && !person?.rank && !person?.serviceNumber) return false;
    if (permissions.canManagePeople) return true;
    if (permissions.canDismissPersonnel) return true;
    if (!permissions.canDismissPersonnelToAdjudant || !person) return false;
    const adjudantIndex = ranks.indexOf("Adjudant");
    const currentIndex = ranks.indexOf(person.rank);
    return adjudantIndex >= 0 && currentIndex >= adjudantIndex;
  }

  function dismissalMemberSnapshot(person, releasedNumber = "", releasedRank = "") {
    return {
      ...person,
      previousServiceNumber: releasedNumber || person?.previousServiceNumber || "",
      previousRank: releasedRank || person?.previousRank || "",
      rank: releasedRank || person?.rank || ""
    };
  }

  function normalizeSelectedExtraFunctions(items = []) {
    const allowed = new Set(extraFunctions);
    return normalizeOvcFunctionBadges(items)
      .filter((badge) => allowed.has(badge))
      .filter((badge, index, list) => list.indexOf(badge) === index);
  }

  function mergeOvcBadgeForActor(nextFunctions, previousFunctions, permissions) {
    const nextWithoutOvc = nextFunctions.filter((badge) => !isOvcFunctionBadge(badge));
    const previousHasOvc = previousFunctions.some(isOvcFunctionBadge);
    const nextHasOvc = nextFunctions.some(isOvcFunctionBadge);
    if (permissions.canManageOvcBadge) {
      return nextHasOvc ? [...nextWithoutOvc, OVC_FUNCTION_BADGE] : nextWithoutOvc;
    }
    return previousHasOvc ? [...nextWithoutOvc, OVC_FUNCTION_BADGE] : nextWithoutOvc;
  }

  function blacklistErrorMessage() {
    return "PERSOON IS GEBLACKLIST\nKan niet worden aangenomen";
  }

  async function sendBlacklistWebhook(state, entry, actor) {
    if (typeof buildBlacklistWebhookPayload !== "function") return;
    try {
      const webhookResult = await sendDiscordWebhook(
        personnelWebhookUrl("blacklist"),
        buildBlacklistWebhookPayload(entry, actor)
      );
      if (webhookResult.ok) {
        state.activity.push(`Blacklist webhook verzonden voor ${entry.name}.`);
      } else if (!webhookResult.skipped) {
        state.activity.push(`Blacklist webhook kon niet verzonden worden voor ${entry.name}.`);
      }
    } catch (error) {
      state.activity.push(`Blacklist webhook kon niet verzonden worden voor ${entry.name}.`);
    }
  }

  async function sendInvestigationWebhook(state, person, actor) {
    if (typeof buildInvestigationWebhookPayload !== "function") return;
    state.activity = state.activity || [];
    try {
      const webhookResult = await sendDiscordWebhook(
        personnelWebhookUrl("io"),
        buildInvestigationWebhookPayload(person, person.ioStatus, actor)
      );
      if (webhookResult.ok) {
        state.activity.push(`I.O webhook verzonden voor ${person.name}.`);
      } else if (!webhookResult.skipped) {
        state.activity.push(`I.O webhook kon niet verzonden worden voor ${person.name}.`);
      }
    } catch (error) {
      state.activity.push(`I.O webhook kon niet verzonden worden voor ${person.name}.`);
    }
  }

  function mentorTestsEnabledForOrganization() {
    return Boolean(mentorTestsStore && mentorRanks.length);
  }

  function canReviewMentorTests(permissions) {
    return Boolean(
      permissions.canManageMentorOverview ||
      permissions.canViewMentorLeadershipLog ||
      permissions.canManageMentorChecklistTemplate ||
      permissions.canUseDevTools
    );
  }

  function canManageMentorTestTemplate(permissions) {
    return Boolean(permissions.canManageMentorTestTemplate || permissions.canUseDevTools);
  }

  function mentorTestForClient(test, { includeAnswers = true } = {}) {
    if (!test) return null;
    const result = {
      id: test.id,
      organization: test.organization,
      personId: test.personId,
      personName: test.personName,
      serviceNumber: test.serviceNumber,
      rank: test.rank,
      status: test.status,
      sentByName: test.sentByName,
      sentAt: test.sentAt,
      submittedAt: test.submittedAt,
      reviewedByName: test.reviewedByName,
      reviewedAt: test.reviewedAt,
      reviewNote: test.reviewNote,
      questions: Array.isArray(test.questions) ? test.questions : []
    };
    if (includeAnswers) result.answers = test.answers || {};
    return result;
  }

  function setMentorTrainingCompletion(person, completed) {
    const shouldSyncMentorTraining = Boolean(mentorTrainingName && profileTrainings.includes(mentorTrainingName));
    if (!shouldSyncMentorTraining) return;
    person.completedTrainings = Array.isArray(person.completedTrainings) ? person.completedTrainings : [];
    if (completed && !person.completedTrainings.includes(mentorTrainingName)) {
      person.completedTrainings.push(mentorTrainingName);
    }
    if (!completed) {
      person.completedTrainings = person.completedTrainings.filter((item) => item !== mentorTrainingName);
    }
  }

  function setMentorTestChecklistState(person, state, { testSent, testApproved, completed, actor }) {
    const existing = normalizeMentorChecklistForState(person, state);
    const now = new Date().toISOString();
    person.mentorChecklist = {
      ...existing,
      completed: Boolean(completed),
      testSent: Boolean(testSent),
      testApproved: Boolean(testApproved),
      items: Array.isArray(existing.items) ? existing.items : [],
      notes: normalizeMentorNotes(existing),
      audit: Array.isArray(existing.audit) ? existing.audit : [],
      updatedAt: now,
      updatedById: actor?.id || "",
      updatedByName: actor?.name || ""
    };
    setMentorTrainingCompletion(person, Boolean(completed));
  }

  async function sendMentorTestWebhook(event, payload = {}) {
    if (typeof sendDiscordWebhook !== "function" || typeof mentorTestWebhookUrl !== "function" || typeof buildMentorTestWebhookPayload !== "function") return;
    const url = mentorTestWebhookUrl();
    if (!url) return;
    try {
      await sendDiscordWebhook(url, buildMentorTestWebhookPayload(event, payload));
    } catch (error) {
      // Webhookmeldingen mogen de toetsflow niet blokkeren.
    }
  }

  function discordNicknameSnapshot(state) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.buildServiceNickname !== "function") return new Map();
    return new Map(
      (state.people || [])
        .filter((person) => person.discordId && person.rank && person.serviceNumber)
        .map((person) => [person.id, discordBot.buildServiceNickname(person)])
    );
  }

  async function syncChangedDiscordNicknames(state, previousNicknames) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.syncNicknameForPerson !== "function") return;
    const changedPeople = (state.people || [])
      .filter((person) => isCurrentPerson(person) && person.discordId)
      .filter((person) => person.rank && person.serviceNumber)
      .filter((person) => previousNicknames.get(person.id) !== discordBot.buildServiceNickname(person));

    for (const person of changedPeople) {
      try {
        const activePortoUnit = (state.portoUnits || [])
          .filter((unit) => unit.active !== false && unit.memberId === person.id && unit.vehicleNumber)
          .sort((a, b) => Date.parse(b.updatedAt || b.assignedAt || b.requestedAt || 0) - Date.parse(a.updatedAt || a.assignedAt || a.requestedAt || 0))[0] || null;
        const activePortoUnitWithContext = activePortoUnit
          ? {
              ...activePortoUnit,
              isPortoOpsLead: Boolean(activePortoUnit.vehicleNumber === operatorVehicleNumber && state.portoCurrentOps?.active !== false && state.portoCurrentOps?.memberId === person.id)
            }
          : null;
        const result = activePortoUnit && typeof discordBot.syncPortoNicknameForPersonIfNeeded === "function"
          ? await discordBot.syncPortoNicknameForPersonIfNeeded(person, activePortoUnitWithContext, `${portalTitle} rangsymbool bijgewerkt tijdens Porto-dienst`)
          : await discordBot.syncNicknameForPerson(person);
        if (result?.ok) {
          state.activity = state.activity || [];
          const nickname = activePortoUnit && typeof discordBot.buildPortoNicknameDefault === "function"
            ? discordBot.buildPortoNicknameDefault(person, activePortoUnitWithContext)
            : discordBot.buildServiceNickname(person);
          state.activity.push(`Discord naam gesynchroniseerd voor ${person.name}: ${nickname}.`);
        }
      } catch (error) {
        state.activity = state.activity || [];
        state.activity.push(`Discord naam synchroniseren mislukt voor ${person.name}: ${error.message || "onbekende fout"}.`);
      }
    }
  }


  function discordRankRoleSnapshot(state) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.rankRoleIdForPerson !== "function") return new Map();
    return new Map(
      (state.people || [])
        .filter((person) => person.discordId && person.rank && person.serviceNumber)
        .map((person) => [person.id, `${person.discordId || ""}:${person.rank || ""}:${discordBot.rankRoleIdForPerson(person) || ""}`])
    );
  }

  async function syncChangedDiscordRankRoles(state, previousRankRoles) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.syncRankRoleForPerson !== "function") return;
    const changedPeople = (state.people || [])
      .filter((person) => isCurrentPerson(person) && person.discordId)
      .filter((person) => person.rank && person.serviceNumber)
      .filter((person) => previousRankRoles.get(person.id) !== `${person.discordId || ""}:${person.rank || ""}:${discordBot.rankRoleIdForPerson(person) || ""}`);

    for (const person of changedPeople) {
      try {
        const result = await discordBot.syncRankRoleForPerson(person);
        if (result?.ok && Array.isArray(result.changes) && result.changes.length) {
          state.activity = state.activity || [];
          state.activity.push(`Discord rangrol gesynchroniseerd voor ${person.name}: ${person.rank}.`);
        } else if (result?.skipped) {
          state.activity = state.activity || [];
          state.activity.push(`Discord rangrol overgeslagen voor ${person.name}: ${result.reason}`);
        }
      } catch (error) {
        state.activity = state.activity || [];
        state.activity.push(`Discord rangrol synchroniseren mislukt voor ${person.name}: ${error.message || "onbekende fout"}.`);
      }
    }
  }

  async function queuePersonDiscordSync(state, person, reason) {
    if (typeof enqueuePersonDiscordSync !== "function" || !person?.discordId) return;
    const allowMissingServiceNumber = reason === "person_dismiss";
    if (!allowMissingServiceNumber && (!person.rank || !person.serviceNumber)) {
      setDiscordSyncStatus(person, "skipped", "Rang of dienstnummer ontbreekt.", reason);
      return;
    }
    try {
      const isNewHire = ["recruitment_hire", "person_created"].includes(reason);
      const waitsForDiscordRoles = isNewHire || reason === "qualification_updated";
      const roleWaitMaxAttempts = Number(process.env.DISCORD_REQUIRED_ROLE_MAX_ATTEMPTS || 288);
      await enqueuePersonDiscordSync(person, reason, {
        // New recruits and qualification updates can race Discord role propagation.
        maxAttempts: waitsForDiscordRoles && Number.isFinite(roleWaitMaxAttempts) ? Math.max(1, Math.floor(roleWaitMaxAttempts)) : undefined
      });
      setDiscordSyncStatus(
        person,
        "retry_planned",
        waitsForDiscordRoles ? "Wacht op Discord rollen of eerstvolgende worker-run." : "Sync staat in wachtrij.",
        reason
      );
      state.activity = state.activity || [];
      state.activity.push(`Discord profielsync ingepland voor ${person.name}${waitsForDiscordRoles ? "; wacht indien nodig op Discord rollen" : ""}.`);
    } catch (error) {
      const syncStatus = syncStatusFromError(error);
      setDiscordSyncStatus(person, syncStatus.state, syncStatus.message, reason);
      state.activity = state.activity || [];
      state.activity.push(`Discord profielsync inplannen mislukt voor ${person.name}: ${error.message || "onbekende fout"}.`);
    }
  }

  async function queueChangedDiscordProfiles(state, previousNicknames, previousRankRoles, reason) {
    const queuedIds = new Set();
    if (typeof enqueuePersonDiscordSync !== "function") return queuedIds;
    const currentNicknames = discordNicknameSnapshot(state);
    const currentRankRoles = discordRankRoleSnapshot(state);
    const changedIds = new Set([
      ...[...currentNicknames.entries()]
        .filter(([personId, nickname]) => previousNicknames.get(personId) !== nickname)
        .map(([personId]) => personId),
      ...[...currentRankRoles.entries()]
        .filter(([personId, rankRole]) => previousRankRoles.get(personId) !== rankRole)
        .map(([personId]) => personId)
    ]);
    for (const person of state.people || []) {
      if (!changedIds.has(person.id) || !isCurrentPerson(person)) continue;
      await queuePersonDiscordSync(state, person, reason);
      queuedIds.add(person.id);
    }
    return queuedIds;
  }

  function absencePeriodText(absence) {
    return `${absence?.from || "-"} t/m ${absence?.to || "-"}`;
  }

  function buildAbsenceRegisteredDm(member, absence) {
    return [
      "Je afwezigheid is geregistreerd.",
      `Personeelslid: ${member?.serviceNumber || "-"} - ${member?.name || "Onbekend"}`,
      `Periode: ${absencePeriodText(absence)}`,
      `Status: ${absence?.status || "In afwachting"}`,
      absence?.reason ? `Reden: ${absence.reason}` : ""
    ].filter(Boolean).join("\n");
  }

  function buildAbsenceReviewedDm(member, absence, reviewer) {
    const statusText = String(absence?.status || "verwerkt").toLowerCase();
    return [
      `Je afwezigheid is ${statusText}.`,
      `Personeelslid: ${member?.serviceNumber || "-"} - ${member?.name || "Onbekend"}`,
      `Periode: ${absencePeriodText(absence)}`,
      reviewer?.name ? `Beoordeeld door: ${reviewer.name}` : ""
    ].filter(Boolean).join("\n");
  }

  function portalBaseUrl() {
    const configuredUrl = String(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || "").trim();
    if (configuredUrl) return configuredUrl.replace(/\/+$/, "");
    return organization.key === "politie" ? "https://orppolitie.nl" : "https://orpdefensie.nl";
  }

  function buildI8StatusDm(form, formNumber, status, reviewer) {
    const statusText = status === "approved"
      ? "goedgekeurd"
      : status === "rejected"
        ? "afgekeurd"
        : "in behandeling genomen";
    return [
      `Je I8 formulier ${formNumber} is ${statusText}.`,
      `Personeelslid: ${form?.serviceNumber || "-"} - ${form?.personName || "Onbekend"}`,
      reviewer?.name ? `Door: ${reviewer.name}` : "",
      form?.location ? `Locatie: ${form.location}` : "",
      status === "rejected" && form?.rejectionReason ? `Reden: ${form.rejectionReason}` : ""
    ].filter(Boolean).join("\n");
  }

  function buildMentorTestSentDm(person, actor) {
    return [
      "Je mentor-toets staat klaar.",
      `Personeelslid: ${person?.serviceNumber || "-"} - ${person?.name || "Onbekend"}`,
      actor?.name ? `Verstuurd door: ${actor.name}` : "",
      `Log in op ${portalBaseUrl()} en open Mentor-Toetsen om de toets te maken.`
    ].filter(Boolean).join("\n");
  }

  function ibtFormConfig() {
    return publicFormFromSlug("ibt");
  }

  function ibtTestFormUrl() {
    const config = ibtFormConfig();
    const configuredUrl = String(config?.canonicalUrl || "").trim();
    if (configuredUrl) return configuredUrl.replace(/\/+$/, "");
    const firstHostname = String(config?.hostnames?.[0] || "").trim();
    if (firstHostname) return `https://${firstHostname}`;
    return `${portalBaseUrl()}/forms/ibt`;
  }

  function buildIbtTestSentDm(person, actor) {
    return [
      "Je IBT-toets staat klaar.",
      `Personeelslid: ${person?.serviceNumber || "-"} - ${person?.name || "Onbekend"}`,
      actor?.name ? `Verstuurd door: ${actor.name}` : "",
      `Open ${ibtTestFormUrl()} om de toets te maken.`
    ].filter(Boolean).join("\n");
  }

  function truncateDiscordEmbedText(value, maxLength) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }

  function discordDmColorForReason(reason = "") {
    const text = String(reason || "").toLowerCase();
    if (text.includes("approved") || text.includes("reviewed") || text.includes("geregistreerd")) return 0x22c55e;
    if (text.includes("rejected") || text.includes("afgekeurd")) return 0xef4444;
    if (text.includes("i8")) return 0x3b82f6;
    if (text.includes("mentor")) return 0xf59e0b;
    return 0x5aa0f0;
  }

  function buildDiscordDmEmbed(content, reason = "") {
    const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const title = truncateDiscordEmbedText(lines.shift() || "Bericht van het personeelsportaal", 256);
    const fields = [];
    const descriptions = [];
    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator > 0 && fields.length < 25) {
        fields.push({
          name: truncateDiscordEmbedText(line.slice(0, separator), 256) || "-",
          value: truncateDiscordEmbedText(line.slice(separator + 1), 1024) || "-",
          inline: false
        });
      } else {
        descriptions.push(line);
      }
    }
    return [{
      title,
      description: descriptions.length ? truncateDiscordEmbedText(descriptions.join("\n"), 4096) : undefined,
      color: discordDmColorForReason(reason),
      fields,
      footer: { text: portalTitle },
      timestamp: new Date().toISOString()
    }];
  }

  async function queueDiscordDmForPerson(state, person, content, reason, activityMessages = null) {
    const discordId = normalizeDiscordId(person?.discordId || "");
    if (typeof enqueueDiscordSyncJob !== "function" || !discordId || !content) return false;
    try {
      await enqueueDiscordSyncJob("send_dm", {
        discordId,
        content: "",
        fallbackContent: content,
        embeds: buildDiscordDmEmbed(content, reason),
        reason
      }, { discordId, maxAttempts: 3 });
      const message = `Discord DM ingepland voor ${person.name || discordId}.`;
      state.activity = state.activity || [];
      state.activity.push(message);
      if (Array.isArray(activityMessages)) activityMessages.push(message);
      return true;
    } catch (error) {
      const message = `Discord DM inplannen mislukt voor ${person.name || discordId}: ${error.message || "onbekende fout"}.`;
      state.activity = state.activity || [];
      state.activity.push(message);
      if (Array.isArray(activityMessages)) activityMessages.push(message);
      return false;
    }
  }

  function hasCompletedTraining(person, training) {
    return (Array.isArray(person?.completedTrainings) ? person.completedTrainings : []).includes(training);
  }

  function isIbtRankEligible(person) {
    const minimumRankIndex = ranks.indexOf("Marechaussee 3de Klasser");
    const currentRankIndex = ranks.indexOf(person?.rank || "");
    if (minimumRankIndex < 0 || currentRankIndex < 0) return false;
    return currentRankIndex <= minimumRankIndex;
  }

  function isIbtCandidatePerson(person) {
    return isCurrentPerson(person) && isIbtRankEligible(person) && !hasCompletedTraining(person, "IBT");
  }

  function submittedByMatchesPerson(submittedBy = {}, person = {}) {
    if (submittedBy.id && person.id && submittedBy.id === person.id) return true;
    const submittedDiscordId = normalizeDiscordId(submittedBy.discordId || "");
    const personDiscordId = normalizeDiscordId(person.discordId || "");
    if (submittedDiscordId && personDiscordId && submittedDiscordId === personDiscordId) return true;
    if (submittedBy.serviceNumber && person.serviceNumber && submittedBy.serviceNumber === person.serviceNumber) return true;
    if (submittedBy.name && person.name && String(submittedBy.name).trim().toLowerCase() === String(person.name).trim().toLowerCase()) return true;
    return false;
  }

  function ibtReviewStatus(submission = {}) {
    const status = String(submission?.review?.status || "submitted").toLowerCase();
    return ["approved", "rejected"].includes(status) ? status : "submitted";
  }

  function ibtSubmissionDto(config, submission = {}) {
    return {
      id: submission.id,
      submissionNumber: publicFormTicketNumber(config, submission),
      formSlug: submission.formSlug,
      formTitle: submission.formTitle,
      submittedAt: submission.submittedAt,
      submittedBy: submission.submittedBy || null,
      answers: submission.answers || {},
      review: submission.review || { status: "submitted" }
    };
  }

  function latestIbtSubmissionForPerson(submissions, person) {
    return [...(Array.isArray(submissions) ? submissions : [])]
      .filter((submission) => submittedByMatchesPerson(submission.submittedBy || {}, person))
      .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))[0] || null;
  }

  function ibtCandidateRow(config, person, submission = null) {
    const submissionStatus = submission ? ibtReviewStatus(submission) : "";
    const profileStatus = String(person?.ibtTest?.status || "").toLowerCase();
    const sentAtTime = Date.parse(person?.ibtTest?.sentAt || "");
    const reviewedAtTime = Date.parse(submission?.review?.reviewedAt || submission?.submittedAt || "");
    const resentAfterRejection = submissionStatus === "rejected"
      && profileStatus === "sent"
      && Number.isFinite(sentAtTime)
      && (!Number.isFinite(reviewedAtTime) || sentAtTime > reviewedAtTime);
    const status = resentAfterRejection ? "sent" : submissionStatus || (profileStatus === "sent" ? "sent" : "not_sent");
    return {
      person: {
        id: person.id,
        name: person.name || "Onbekend",
        rank: person.rank || "",
        serviceNumber: person.serviceNumber || "",
        discordId: person.discordId || ""
      },
      status,
      sentAt: person?.ibtTest?.sentAt || "",
      sentByName: person?.ibtTest?.sentByName || "",
      formUrl: person?.ibtTest?.formUrl || ibtTestFormUrl(),
      submission: submission ? ibtSubmissionDto(config, submission) : null
    };
  }

  async function syncQualificationDiscordRoles(state, person, changedLabels) {
    if (!discordBot || !discordBot.isConfigured?.()) return;
    if (!person?.discordId) return;
    const shouldSyncQualificationRoles = changedLabels.some((label) => qualificationRoleLabels.includes(label))
      && typeof discordBot.syncQualificationRolesForPerson === "function";
    const shouldSyncTrainingRequirementRoles = changedLabels.some((label) => trainingRequirementRoleLabels.includes(label))
      && typeof discordBot.syncTrainingRequirementRolesForPerson === "function";
    if (!shouldSyncQualificationRoles && !shouldSyncTrainingRequirementRoles) return;
    try {
      const result = shouldSyncQualificationRoles
        ? await discordBot.syncQualificationRolesForPerson(
          person,
          `${portalTitle} kwalificatie aangepast`
        )
        : null;
      const trainingResult = shouldSyncTrainingRequirementRoles
        ? await discordBot.syncTrainingRequirementRolesForPerson(
          person,
          `${portalTitle} benodigde training aangepast`
        )
        : null;
      const changed = [result, trainingResult].some((entry) => entry?.ok && Array.isArray(entry.changes) && entry.changes.length);
      const skipped = [result, trainingResult].find((entry) => entry?.skipped);
      if (changed) {
        setDiscordSyncStatus(person, "synced", "Discord kwalificatierollen aangepast.", "qualification_direct");
        state.activity = state.activity || [];
        state.activity.push(`Discord kwalificatierollen gesynchroniseerd voor ${person.name}.`);
      } else if (skipped) {
        setDiscordSyncStatus(person, skipped.retryable ? "role_missing" : "skipped", skipped.reason, "qualification_direct");
        state.activity = state.activity || [];
        state.activity.push(`Discord kwalificatierollen overgeslagen voor ${person.name}: ${skipped.reason}`);
      } else if (result?.ok || trainingResult?.ok) {
        setDiscordSyncStatus(person, "synced", "Discord kwalificatierollen gecontroleerd.", "qualification_direct");
      }
    } catch (error) {
      state.activity = state.activity || [];
      state.activity.push(`Discord kwalificatierollen synchroniseren mislukt voor ${person.name}: ${error.message || "onbekende fout"}.`);
    }
  }

  function addPersonNotification(person, notification) {
    if (!person) return null;
    person.notifications = Array.isArray(person.notifications) ? person.notifications : [];
    const entry = {
      id: crypto.randomUUID(),
      type: notification.type || "info",
      title: notification.title || "Nieuwe melding",
      message: notification.message || "",
      createdAt: new Date().toISOString(),
      readAt: "",
      meta: notification.meta || {}
    };
    person.notifications.unshift(entry);
    person.notifications = person.notifications.slice(0, 80);
    return entry;
  }

  function addProfileLog(person, entry) {
    if (!person) return null;
    person.profileLog = Array.isArray(person.profileLog) ? person.profileLog : [];
    const actor = entry.actor || {};
    const logEntry = {
      id: crypto.randomUUID(),
      type: entry.type || "profile",
      action: entry.action || "Profiel bijgewerkt",
      details: entry.details || "",
      createdAt: new Date().toISOString(),
      actorId: actor.id || "",
      actorName: actor.name || "Onbekend",
      meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {}
    };
    person.profileLog.unshift(logEntry);
    person.profileLog = person.profileLog.slice(0, 150);
    return logEntry;
  }

  function i8NumberForServer(form, forms = []) {
    if (form?.i8Number) return String(form.i8Number).padStart(3, "0");
    const ordered = forms.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const index = ordered.findIndex((entry) => entry.id === form.id);
    return String(index >= 0 ? index + 1 : ordered.length + 1).padStart(3, "0");
  }

  function nextI8NumberForServer(forms = []) {
    const highest = forms.reduce((max, form, index) => {
      const value = Number.parseInt(form.i8Number || i8NumberForServer(form, forms) || index + 1, 10);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);
    return String(highest + 1).padStart(3, "0");
  }

  function normalizeI8Text(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function i8SubmissionMatchesBody(form, body) {
    return (
      normalizeI8Text(form.violenceDate) === normalizeI8Text(body.violenceDate) &&
      normalizeI8Text(form.violenceTime) === normalizeI8Text(body.violenceTime) &&
      normalizeI8Text(form.location) === normalizeI8Text(body.location) &&
      normalizeI8Text(form.opcoOvdName) === normalizeI8Text(body.opcoOvdName) &&
      normalizeI8Text(form.description) === normalizeI8Text(body.description) &&
      normalizeI8Text(form.forceUsed) === normalizeI8Text(body.forceUsed) &&
      normalizeI8Text(form.vehicleViolence) === normalizeI8Text(body.vehicleViolence) &&
      normalizeI8Text(form.thirdPartyInjury) === normalizeI8Text(body.thirdPartyInjury)
    );
  }

  function recentDuplicateI8Form(forms, member, body, createdAt) {
    const windowMs = 10 * 60 * 1000;
    const createdMs = Date.parse(createdAt);
    return (forms || []).find((form) => {
      if (form.personId !== member.id) return false;
      const formCreatedMs = Date.parse(form.createdAt || "");
      if (!Number.isFinite(createdMs) || !Number.isFinite(formCreatedMs)) return false;
      if (Math.abs(createdMs - formCreatedMs) > windowMs) return false;
      return i8SubmissionMatchesBody(form, body);
    }) || null;
  }

  async function persistPersonNotifications(person, state) {
    if (!person) return;
    if (typeof peopleStorage.writePersonNotifications === "function") {
      await Promise.resolve(peopleStorage.writePersonNotifications(person));
      return;
    }
    await Promise.resolve(peopleStorage.writeState(state));
  }



  function monthsActiveForServerPerson(person) {
    const start = new Date(`${person?.hiredDate || person?.rankHistory?.[0]?.date || person?.rankDate || today}T00:00:00`);
    if (Number.isNaN(start.getTime())) return 0;
    return Math.max(0, (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.4375));
  }

  function serviceStarAwardsForPerson(person) {
    const monthsActive = monthsActiveForServerPerson(person);
    return [
      { key: "bronze", title: "Bronze diensttijdster", months: 1.5 },
      { key: "silver", title: "Zilveren diensttijdster", months: 3 },
      { key: "gold", title: "Gouden diensttijdster", months: 6 },
      { key: "diamond", title: "Diamanten diensttijdster", months: 12 }
    ].filter((award) => monthsActive >= award.months);
  }

  async function ensureServiceStarNotifications(state, person) {
    if (!person) return false;
    person.serviceStarNotifications = Array.isArray(person.serviceStarNotifications) ? person.serviceStarNotifications : [];
    const known = new Set(person.serviceStarNotifications);
    const awards = serviceStarAwardsForPerson(person).filter((award) => !known.has(award.key));
    if (!awards.length) return false;
    for (const award of awards) {
      addPersonNotification(person, {
        type: "service-star",
        title: `${award.title} behaald`,
        message: `Je hebt ${award.title.toLowerCase()} behaald op basis van je diensttijd.`,
        meta: { award: award.key, profileId: person.id }
      });
      person.serviceStarNotifications.push(award.key);
    }
    await persistPersonNotifications(person, state);
    return true;
  }

  function isoWeekStart(weekYear, weekNumber) {
    const simple = new Date(Date.UTC(Number(weekYear), 0, 1 + (Number(weekNumber) - 1) * 7));
    const day = simple.getUTCDay() || 7;
    if (day <= 4) simple.setUTCDate(simple.getUTCDate() - day + 1);
    else simple.setUTCDate(simple.getUTCDate() + 8 - day);
    return simple;
  }

  function normalizeManualHourEntry(person, weekYear, weekNumber, hours, enteredBy) {
    const start = isoWeekStart(weekYear, weekNumber);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const cleanHours = Math.max(0, Math.min(99, Number(hours)));
    return {
      id: `manual-${person.id}-${weekYear}-${weekNumber}`,
      personId: person.id,
      discordId: person.discordId || "",
      job: "Handmatig",
      weekYear,
      weekNumber,
      hours: cleanHours,
      minutes: Math.round(cleanHours * 60),
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      source: "Handmatig",
      sessionId: `week-${weekYear}-${weekNumber}`,
      enteredById: enteredBy.id || "",
      enteredByName: enteredBy.name || "Onbekend",
      enteredAt: new Date().toISOString()
    };
  }

  function upsertStateHourEntry(state, entry) {
    state.hours = Array.isArray(state.hours) ? state.hours : [];
    const index = state.hours.findIndex((item) => item.id === entry.id);
    if (index >= 0) state.hours[index] = entry;
    else state.hours.push(entry);
  }

  function parseManualHoursValue(value) {
    if (value === null || value === undefined) return NaN;
    const normalized = typeof value === "string" ? value.trim().replace(",", ".") : value;
    if (normalized === "") return NaN;
    return Number(normalized);
  }

  async function handlePersoneelsportaalApi(req, res, url) {
    if (url.pathname === "/api/notifications/read" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const state = await readPeopleState();
      const person = (state.people || []).find((entry) => entry.id === auth.profile.id);
      if (!person) {
        sendJson(res, 404, { error: "Profiel niet gevonden." });
        return;
      }
      const now = new Date().toISOString();
      markNotificationsRead(person, now);
      await persistPersonNotifications(person, state);
      const permissions = permissionsForAuth(auth, state);
      sendJson(res, 200, {
        ok: true,
        state: stateForProfile(state, permissions, auth.profile.id),
        canViewLogbook: permissions.canViewLogbook,
        permissions
      });
      return;
    }
    if (url.pathname === "/api/notifications/clear" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const state = await readPeopleState();
      const person = (state.people || []).find((entry) => entry.id === auth.profile.id);
      if (!person) {
        sendJson(res, 404, { error: "Profiel niet gevonden." });
        return;
      }
      clearNotifications(person);
      await persistPersonNotifications(person, state);
      const permissions = permissionsForAuth(auth, state);
      sendJson(res, 200, {
        ok: true,
        state: stateForProfile(state, permissions, auth.profile.id),
        canViewLogbook: permissions.canViewLogbook,
        permissions
      });
      return;
    }

    if (url.pathname === "/api/vehicle-seizures" && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!vehicleSeizuresStore || typeof vehicleSeizuresStore.createSeizure !== "function") {
        sendJson(res, 503, { error: "Voertuiginbeslagname opslag is niet beschikbaar." });
        return;
      }
      const state = await readPeopleState();
      const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
      const body = await readBody(req);
      const vehicle = String(body.vehicle || "").trim();
      const plate = String(body.plate || "").trim();
      const ownerName = String(body.ownerName || "").trim();
      const location = String(body.location || "").trim();
      const reason = String(body.reason || "").trim();
      const notes = String(body.notes || "").trim();
      if (!vehicle || !plate || !ownerName || !location || !reason) {
        sendJson(res, 400, { error: "Voertuig, kenteken, eigenaar, locatie en reden zijn verplicht." });
        return;
      }
      const seizure = await vehicleSeizuresStore.createSeizure({
        id: crypto.randomUUID(),
        organization: organization.label || organization.key,
        vehicle,
        plate,
        ownerName,
        location,
        reason,
        notes,
        status: "Actief",
        createdById: actor?.id || auth.profile.id,
        createdByName: actor?.name || auth.profile.name || "Onbekend",
        createdAt: new Date().toISOString()
      });
      state.activity = state.activity || [];
      state.activity.push(`${actor?.name || auth.profile.name} heeft voertuig ${seizure.plate || seizure.vehicle} in beslag genomen.`);
      await sendVehicleSeizureWebhook(state, seizure, actor, "created");
      await refreshVehicleSeizuresOnState(state);
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }

    const vehicleSeizureStatusMatch = url.pathname.match(/^\/api\/vehicle-seizures\/([^/]+)\/status$/);
    if (vehicleSeizureStatusMatch && req.method === "POST") {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!vehicleSeizuresStore || typeof vehicleSeizuresStore.updateSeizureStatus !== "function") {
        sendJson(res, 503, { error: "Voertuiginbeslagname opslag is niet beschikbaar." });
        return;
      }
      const state = await readPeopleState();
      const permissions = permissionsForAuth(auth, state);
      if (!permissions.canManageVehicleSeizures) {
        sendJson(res, 403, { error: "Alleen leiding mag voertuigen vrijgeven." });
        return;
      }
      const seizureId = decodeURIComponent(vehicleSeizureStatusMatch[1]);
      const current = (state.vehicleSeizures || []).find((entry) => entry.id === seizureId);
      if (!current) {
        sendJson(res, 404, { error: "Voertuiginbeslagname niet gevonden." });
        return;
      }
      if (current.status === "Vrijgegeven") {
        sendJson(res, 409, { error: "Dit voertuig is al vrijgegeven." });
        return;
      }
      const body = await readBody(req);
      const status = String(body.status || "").trim();
      if (status !== "Vrijgegeven") {
        sendJson(res, 400, { error: "Alleen vrijgeven wordt ondersteund." });
        return;
      }
      const releaseReason = String(body.releaseReason || "Vrijgegeven.").trim();
      const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
      const released = await vehicleSeizuresStore.updateSeizureStatus(seizureId, {
        status: "Vrijgegeven",
        releasedById: actor?.id || auth.profile.id,
        releasedByName: actor?.name || auth.profile.name || "Onbekend",
        releasedAt: new Date().toISOString(),
        releaseReason
      });
      if (!released) {
        sendJson(res, 404, { error: "Voertuiginbeslagname niet gevonden." });
        return;
      }
      state.activity = state.activity || [];
      state.activity.push(`${actor?.name || auth.profile.name} heeft voertuig ${released.plate || released.vehicle} vrijgegeven.`);
      await sendVehicleSeizureWebhook(state, released, actor, "released");
      await refreshVehicleSeizuresOnState(state);
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }

    if (url.pathname === "/api/resignation-forms" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const body = await readBody(req);
    const member = (state.people || []).find((person) => person.id === auth.profile.id && isCurrentPerson(person));
    const reason = String(body.reason || "").trim();
    if (!member) {
      sendJson(res, 400, { error: "Profiel is verplicht om een ontslagformulier in te dienen." });
      return;
    }
    if (!reason) {
      sendJson(res, 400, { error: "Reden is verplicht." });
      return;
    }
    state.resignationForms = Array.isArray(state.resignationForms) ? state.resignationForms : [];
    state.activity = state.activity || [];
    const resignationForm = {
      id: crypto.randomUUID(),
      memberId: member.id,
      name: member.name,
      rank: member.rank,
      serviceNumber: member.serviceNumber,
      reason,
      status: "Ingediend",
      requestedAt: new Date().toISOString()
    };
    state.resignationForms.push(resignationForm);
    state.activity.push(`Ontslagformulier ingediend door ${member.name}.`);
    try {
      const webhookResult = await sendDiscordWebhook(
        personnelWebhookUrl("resignation"),
        buildResignationFormWebhookPayload(member, resignationForm)
      );
      if (webhookResult.ok) {
        state.activity.push(`Ontslagformulier webhook verzonden voor ${member.name}.`);
      } else if (!webhookResult.skipped) {
        state.activity.push(`Ontslagformulier webhook kon niet verzonden worden voor ${member.name}.`);
      }
    } catch (error) {
      state.activity.push(`Ontslagformulier webhook kon niet verzonden worden voor ${member.name}.`);
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }
  const resignationProcessMatch = url.pathname.match(/^\/api\/resignation-forms\/([^/]+)\/process$/);
  if (resignationProcessMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag ontslagformulieren verwerken." });
      return;
    }
    state.resignationForms = Array.isArray(state.resignationForms) ? state.resignationForms : [];
    const form = state.resignationForms.find((entry) => entry.id === decodeURIComponent(resignationProcessMatch[1]));
    if (!form) {
      sendJson(res, 404, { error: "Ontslagformulier niet gevonden." });
      return;
    }
    const processedBy = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    if (form.status === "Verwerkt") {
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === form.memberId && isCurrentPerson(entry));
    if (!person) {
      const archivedPerson = (state.people || []).find((entry) => entry.id === form.memberId && !isCurrentPerson(entry));
      if (!archivedPerson) {
        sendJson(res, 404, { error: "Personeelslid niet gevonden. Mogelijk is dit profiel al gearchiveerd." });
        return;
      }
      form.status = "Verwerkt";
      form.processedAt = form.processedAt || new Date().toISOString();
      form.processedById = form.processedById || processedBy.id;
      form.processedByName = form.processedByName || processedBy.name;
      form.name = form.name || archivedPerson.name || "";
      form.rank = form.rank || archivedPerson.previousRank || archivedPerson.rank || "";
      form.serviceNumber = form.serviceNumber || archivedPerson.previousServiceNumber || "";
      state.activity = state.activity || [];
      state.activity.push(`${processedBy.name} heeft een al gearchiveerd ontslagformulier van ${form.name || "onbekend"} afgerond.`);
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }

    const releasedNumber = person.serviceNumber || form.serviceNumber || person.previousServiceNumber || "";
    const releasedRank = person.rank || form.rank || person.previousRank || "";
    const dismissalMember = dismissalMemberSnapshot(person, releasedNumber, releasedRank);
    const todayValue = today();
    const reason = String(form.reason || "Ontslagformulier verwerkt.").trim();
    person.status = "Ontslagen";
    applyManualAbsenceStatusSource(person, person.status);
    person.dismissalDate = todayValue;
    person.dismissalReason = reason;
    person.archivedUntil = addMonths(todayValue, 6);
    if (releasedNumber) person.previousServiceNumber = releasedNumber;
    if (releasedRank) person.previousRank = releasedRank;
    person.serviceNumber = "";
    person.permRole = "Geen";
    form.status = "Verwerkt";
    form.processedAt = new Date().toISOString();
    form.processedById = processedBy.id;
    form.processedByName = processedBy.name;
    form.rank = form.rank || releasedRank;
    form.serviceNumber = form.serviceNumber || releasedNumber;
    state.activity = state.activity || [];
    state.activity.push(`${processedBy.name} heeft het ontslagformulier van ${person.name} verwerkt. Dienstnummer ${releasedNumber || "-"} is vrijgegeven.`);
    autoSortServiceNumbers(state);
    await persistPeopleStateMutation(state);
    try {
      const webhookResult = await sendDiscordWebhook(
        personnelWebhookUrl("dismissal"),
        buildDismissalWebhookPayload(dismissalMember, { reason, releasedNumber, date: todayValue, rank: releasedRank }, processedBy)
      );
      if (webhookResult.ok) {
        state.activity.push(`Ontslag webhook verzonden voor ${person.name}.`);
      } else if (!webhookResult.skipped) {
        state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
      }
    } catch (error) {
      state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }
  const resignationCancelMatch = url.pathname.match(/^\/api\/resignation-forms\/([^/]+)\/cancel$/);
  if (resignationCancelMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag ontslagformulieren annuleren." });
      return;
    }
    state.resignationForms = Array.isArray(state.resignationForms) ? state.resignationForms : [];
    const form = state.resignationForms.find((entry) => entry.id === decodeURIComponent(resignationCancelMatch[1]));
    if (!form) {
      sendJson(res, 404, { error: "Ontslagformulier niet gevonden." });
      return;
    }
    if (["Verwerkt", "Geannuleerd"].includes(form.status || "Ingediend")) {
      sendJson(res, 409, { error: "Dit ontslagformulier is al afgehandeld." });
      return;
    }
    const cancelledBy = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    form.status = "Geannuleerd";
    form.cancelledAt = new Date().toISOString();
    form.cancelledById = cancelledBy.id;
    form.cancelledByName = cancelledBy.name;
    state.activity = state.activity || [];
    state.activity.push(`${cancelledBy.name} heeft het ontslagformulier van ${form.name || "onbekend"} geannuleerd.`);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const resignationDeleteMatch = url.pathname.match(/^\/api\/resignation-forms\/([^/]+)\/delete$/);
  if (resignationDeleteMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag ontslagformulieren verwijderen." });
      return;
    }
    state.resignationForms = Array.isArray(state.resignationForms) ? state.resignationForms : [];
    const formId = decodeURIComponent(resignationDeleteMatch[1]);
    const form = state.resignationForms.find((entry) => entry.id === formId);
    if (!form) {
      sendJson(res, 404, { error: "Ontslagformulier niet gevonden." });
      return;
    }
    const deletedBy = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    state.resignationForms = state.resignationForms.filter((entry) => entry.id !== formId);
    state.deletedResignationFormIds = [...new Set([...(state.deletedResignationFormIds || []), formId])];
    state.activity = state.activity || [];
    state.activity.push(`${deletedBy.name} heeft het ontslagformulier van ${form.name || "onbekend"} verwijderd.`);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }
  if (url.pathname === "/api/absences" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readFormsState();
    const body = await readBody(req);
    const member = (state.people || []).find((person) => person.id === auth.profile.id && isCurrentPerson(person));
    if (!member || !body.from || !body.to) {
      sendJson(res, 400, { error: "Profiel, vanaf en tot zijn verplicht." });
      return;
    }
    state.absences = state.absences || [];
    state.activity = state.activity || [];
    const primaryActivityMessages = [];
    const pushPrimaryActivity = (message) => {
      state.activity.push(message);
      primaryActivityMessages.push(message);
    };
    const sideEffectMessages = [];
    const pushSideEffectActivity = (message) => {
      state.activity.push(message);
      sideEffectMessages.push(message);
    };
    const absence = {
      id: crypto.randomUUID(),
      memberId: member.id,
      name: member.name || "",
      rank: member.rank || "",
      serviceNumber: member.serviceNumber || "",
      from: body.from,
      to: body.to,
      reason: String(body.reason || "").trim(),
      status: "In afwachting",
      requestedAt: new Date().toISOString()
    };
    state.absences.push(absence);
    pushPrimaryActivity(`Afwezigheid geregistreerd voor ${member.name}.`);
    await persistFormsStateMutation(
      state,
      typeof formsStorage.createAbsence === "function" ? () => formsStorage.createAbsence(absence, primaryActivityMessages) : null
    );

    try {
      const webhookResult = await sendDiscordWebhook(
        absenceWebhookUrl(),
        buildAbsenceWebhookPayload(member, absence, auth.profile)
      );
      if (webhookResult.ok) {
        pushSideEffectActivity(`Afwezigheid webhook verzonden voor ${member.name}.`);
      } else if (!webhookResult.skipped) {
        pushSideEffectActivity(`Afwezigheid webhook kon niet verzonden worden voor ${member.name}.`);
      }
    } catch (error) {
      pushSideEffectActivity(`Afwezigheid webhook kon niet verzonden worden voor ${member.name}.`);
    }
    await queueDiscordDmForPerson(
      state,
      member,
      buildAbsenceRegisteredDm(member, absence),
      "absence_registered",
      sideEffectMessages
    );
    if (sideEffectMessages.length) {
      await persistFormsActivityBestEffort(
        state,
        typeof formsStorage.updateAbsence === "function" ? () => formsStorage.updateAbsence(absence, sideEffectMessages) : null
      );
    }
    sendFormsStateResponse(
      res,
      auth,
      state
    );
    return;
  }


  const absenceStatusMatch = url.pathname.match(/^\/api\/absences\/([^/]+)\/status$/);
  if (absenceStatusMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readFormsState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canReviewAbsences) {
      sendJson(res, 403, { error: "Alleen Kader, Hoofdofficier of Officiersraad mag afwezigheid beoordelen." });
      return;
    }
    const body = await readBody(req);
    const status = String(body.status || "").trim();
    if (!["Goedgekeurd", "Afgekeurd"].includes(status)) {
      sendJson(res, 400, { error: "Ongeldige afwezigheid status." });
      return;
    }
    state.absences = Array.isArray(state.absences) ? state.absences : [];
    const key = decodeURIComponent(absenceStatusMatch[1]);
    const numericIndex = /^\d+$/.test(key) ? Number(key) : -1;
    const absence = state.absences.find((entry) => entry.id === key) || state.absences[numericIndex];
    if (!absence) {
      sendJson(res, 404, { error: "Afwezigheid niet gevonden." });
      return;
    }
    if (!absence.id) absence.id = crypto.randomUUID();
    const reviewer = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    absence.status = status;
    absence.reviewedAt = new Date().toISOString();
    absence.reviewedById = reviewer.id;
    absence.reviewedByName = reviewer.name;
    const member = (state.people || []).find((entry) => entry.id === absence.memberId);
    const activityMessage = `${reviewer.name} heeft afwezigheid van ${member?.name || "Onbekend"} ${status.toLowerCase()}.`;
    const primaryActivityMessages = [activityMessage];
    const sideEffectMessages = [];
    const pushSideEffectActivity = (message) => {
      state.activity = state.activity || [];
      state.activity.push(message);
      sideEffectMessages.push(message);
    };
    state.activity = state.activity || [];
    state.activity.push(activityMessage);
    await persistFormsStateMutation(
      state,
      typeof formsStorage.updateAbsence === "function" ? () => formsStorage.updateAbsence(absence, primaryActivityMessages) : null
    );

    if (member) {
      addPersonNotification(member, {
        type: "absence",
        title: `Verlof ${status.toLowerCase()}`,
        message: `Je verlof van ${absence.from || "-"} t/m ${absence.to || "-"} is ${status.toLowerCase()} door ${reviewer.name}.`,
        meta: { absenceId: absence.id, status }
      });
      try {
        await persistPersonNotifications(member, state);
      } catch (error) {
        pushSideEffectActivity(`Notificatie opslaan mislukt voor ${member.name}: ${error.message || "onbekende fout"}.`);
      }
      await queueDiscordDmForPerson(
        state,
        member,
        buildAbsenceReviewedDm(member, absence, reviewer),
        "absence_reviewed",
        sideEffectMessages
      );
    }
    if (sideEffectMessages.length) {
      await persistFormsActivityBestEffort(
        state,
        typeof formsStorage.updateAbsence === "function" ? () => formsStorage.updateAbsence(absence, sideEffectMessages) : null
      );
    }
    sendFormsStateResponse(res, auth, state);
    return;
  }

  const absenceActionMatch = url.pathname.match(/^\/api\/absences\/([^/]+)$/);
  if (absenceActionMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readFormsState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag afwezigheid verwijderen." });
      return;
    }
    const body = await readBody(req);
    if (String(body.action || "").trim() !== "delete") {
      sendJson(res, 400, { error: "Ongeldige afwezigheid actie." });
      return;
    }
    state.absences = Array.isArray(state.absences) ? state.absences : [];
    const key = decodeURIComponent(absenceActionMatch[1]);
    const numericIndex = /^\d+$/.test(key) ? Number(key) : -1;
    const absenceIndex = state.absences.findIndex((entry) => entry.id === key);
    const index = absenceIndex >= 0 ? absenceIndex : numericIndex;
    if (index < 0 || index >= state.absences.length) {
      sendJson(res, 404, { error: "Afwezigheid niet gevonden." });
      return;
    }
    const [absence] = state.absences.splice(index, 1);
    const reviewer = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const member = (state.people || []).find((entry) => entry.id === absence.memberId);
    const activityMessage = `${reviewer.name} heeft afwezigheid van ${member?.name || "Onbekend"} verwijderd.`;
    state.activity = state.activity || [];
    state.activity.push(activityMessage);
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      absence.id && typeof formsStorage.deleteAbsence === "function" ? () => formsStorage.deleteAbsence(absence.id, [activityMessage]) : null
    );
    return;
  }
  if (url.pathname === "/api/i8-forms" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readFormsState();
    const body = await readBody(req);
    const member = currentPersonForAuth(state, auth);
    if (!member) {
      sendJson(res, 400, { error: "Profiel is verplicht om een I8 formulier op te stellen." });
      return;
    }
    const requiredFields = [
      "violenceDate",
      "violenceTime",
      "location",
      "opcoOvdName",
      "description",
      "forceUsed",
      "vehicleViolence",
      "thirdPartyInjury"
    ];
    const missingField = requiredFields.find((field) => !String(body[field] || "").trim());
    if (missingField || !body.truthConfirmed) {
      sendJson(res, 400, { error: "Vul alle verplichte I8 velden in en bevestig naar waarheid." });
      return;
    }

    const createdAt = new Date().toISOString();
    state.i8Forms = Array.isArray(state.i8Forms) ? state.i8Forms : [];
    const duplicateForm = recentDuplicateI8Form(state.i8Forms, member, body, createdAt);
    if (duplicateForm) {
      const permissions = permissionsForAuth(auth, state);
      sendJson(res, 200, {
        ok: true,
        duplicate: true,
        i8FormId: duplicateForm.id,
        i8Number: i8NumberForServer(duplicateForm, state.i8Forms),
        state: stateForProfile(state, permissions, member.id),
        canViewLogbook: permissions.canViewLogbook,
        permissions
      });
      return;
    }
    const form = {
      id: crypto.randomUUID(),
      i8Number: nextI8NumberForServer(state.i8Forms),
      personId: member.id,
      personName: member.name,
      serviceNumber: member.serviceNumber || "",
      rank: member.rank || "",
      violenceDate: String(body.violenceDate || "").trim(),
      violenceTime: String(body.violenceTime || "").trim(),
      location: String(body.location || "").trim(),
      opcoOvdName: String(body.opcoOvdName || "").trim(),
      description: String(body.description || "").trim(),
      forceUsed: String(body.forceUsed || "").trim(),
      vehicleViolence: String(body.vehicleViolence || "").trim(),
      thirdPartyInjury: String(body.thirdPartyInjury || "").trim(),
      truthConfirmed: true,
      status: "pending",
      createdAt,
      reviewedAt: "",
      reviewedById: "",
      reviewedByName: "",
      rejectionReason: ""
    };
    state.i8Forms.push(form);
    const activityMessage = `${member.name} heeft een I8 formulier ingediend.`;
    state.activity = state.activity || [];
    state.activity.push(activityMessage);
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.createI8Form === "function" ? () => formsStorage.createI8Form(form, [activityMessage]) : null,
      { normalizeAbsences: false, profileId: member.id }
    );
    return;
  }

  // Kader mag gekeurde I8 formulieren uit het archief verwijderen, inclusief activiteitlog.
  const i8DeleteMatch = url.pathname.match(/^\/api\/i8-forms\/([^/]+)\/delete$/);
  if (i8DeleteMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readFormsState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canManagePeople) {
      sendJson(res, 403, { error: "Alleen Kader mag I8 formulieren uit het archief verwijderen." });
      return;
    }
    state.i8Forms = Array.isArray(state.i8Forms) ? state.i8Forms : [];
    const formId = decodeURIComponent(i8DeleteMatch[1]);
    const formIndex = state.i8Forms.findIndex((entry) => entry.id === formId);
    if (formIndex < 0) {
      sendJson(res, 404, { error: "I8 formulier niet gevonden." });
      return;
    }
    const form = state.i8Forms[formIndex];
    if (!["approved", "rejected"].includes(form.status)) {
      sendJson(res, 400, { error: "Alleen gekeurde I8 formulieren kunnen uit het archief verwijderd worden." });
      return;
    }
    const reviewer = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const formNumber = i8NumberForServer(form, state.i8Forms);
    state.i8Forms.splice(formIndex, 1);
    state.activity = state.activity || [];
    const activityMessage = `${reviewer.name} heeft I8 ${formNumber} van ${form.personName || "Onbekend"} uit het archief verwijderd.`;
    state.activity.push(activityMessage);
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.deleteI8Form === "function" ? () => formsStorage.deleteI8Form(formId, [activityMessage]) : null
    );
    return;
  }

  const i8StatusMatch = url.pathname.match(/^\/api\/i8-forms\/([^/]+)\/status$/);
  if (i8StatusMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readFormsState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canReviewI8Forms) {
      sendJson(res, 403, { error: "Alleen (h)OvJ, Interne-Zaken of Kader mag I8 formulieren beoordelen." });
      return;
    }
    const body = await readBody(req);
    const status = String(body.status || "").trim();
    const rejectionReason = String(body.rejectionReason || "").trim();
    if (!["in_review", "approved", "rejected"].includes(status)) {
      sendJson(res, 400, { error: "Ongeldige I8 status." });
      return;
    }
    if (status === "rejected" && !rejectionReason) {
      sendJson(res, 400, { error: "Reden afkeuring is verplicht." });
      return;
    }
    state.i8Forms = Array.isArray(state.i8Forms) ? state.i8Forms : [];
    const form = state.i8Forms.find((entry) => entry.id === decodeURIComponent(i8StatusMatch[1]));
    if (!form) {
      sendJson(res, 404, { error: "I8 formulier niet gevonden." });
      return;
    }
    const reviewer = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const currentStatus = form.status || "pending";
    const isLeadReviewer = Boolean(permissions.canOverrideI8Forms || permissions.canLeadOvJ || permissions.canManagePeople);
    if (!isLeadReviewer) {
      if (currentStatus === "pending" && status !== "in_review") {
        sendJson(res, 403, { error: "hOvJ moet een I8 eerst in behandeling zetten voordat deze goedgekeurd of afgekeurd wordt." });
        return;
      }
      if (currentStatus === "in_review") {
        if (!form.reviewedById || form.reviewedById !== reviewer.id) {
          sendJson(res, 403, { error: `Dit I8 formulier is in behandeling door ${form.reviewedByName || "een andere beoordelaar"}. Alleen OVJ, Interne-Zaken of Kader kan dit overrulen.` });
          return;
        }
        if (!['approved', 'rejected'].includes(status)) {
          sendJson(res, 403, { error: "hOvJ kan een I8 die al in behandeling staat alleen goedkeuren of afkeuren." });
          return;
        }
      }
      if (["approved", "rejected"].includes(currentStatus)) {
        sendJson(res, 403, { error: "hOvJ kan een afgerond I8 formulier niet heropenen of aanpassen. Alleen OVJ, Interne-Zaken of Kader kan dit." });
        return;
      }
    }
    form.status = status;
    form.reviewedAt = new Date().toISOString();
    form.reviewedById = reviewer.id;
    form.reviewedByName = reviewer.name;
    form.rejectionReason = status === "rejected" ? rejectionReason : "";
    state.activity = state.activity || [];
    const actionLabel = status === "approved" ? "goedgekeurd" : status === "rejected" ? "afgekeurd" : "in behandeling gezet";
    const formNumber = i8NumberForServer(form, state.i8Forms);
    const activityMessage = `${reviewer.name} heeft I8 ${formNumber} van ${form.personName || "Onbekend"} ${actionLabel}.`;
    const activityMessages = [activityMessage];
    state.activity.push(activityMessage);
    const formOwner = (state.people || []).find((entry) => entry.id === form.personId);
    if (formOwner) {
      addPersonNotification(formOwner, {
        type: "i8",
        title: status === "in_review" ? `I8 ${formNumber} in behandeling` : `I8 ${formNumber} ${actionLabel}`,
        message: `Je I8 formulier ${formNumber} is ${actionLabel} door ${reviewer.name}.`,
        meta: { i8FormId: form.id, i8Number: formNumber, status }
      });
      await persistPersonNotifications(formOwner, state);
      await queueDiscordDmForPerson(
        state,
        formOwner,
        buildI8StatusDm(form, formNumber, status, reviewer),
        `i8_${status}`,
        activityMessages
      );
    }
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.updateI8Form === "function" ? () => formsStorage.updateI8Form(form, activityMessages) : null
    );
    return;
  }

  if (url.pathname === "/api/hours/week" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasPermission(auth, state, "canManageHours"))) {
      sendJson(res, 403, { error: "Alleen Kader, Hoofdofficier of Officiersraad mag diensturen invoeren." });
      return;
    }
    const body = await readBody(req);
    const weekYear = Number(body.weekYear);
    const weekNumber = Number(body.weekNumber);
    if (!Number.isInteger(weekYear) || !Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53) {
      sendJson(res, 400, { error: "Ongeldig weeknummer." });
      return;
    }
    const rawEntries = Array.isArray(body.entries) ? body.entries : [];
    const enteredBy = (state.people || []).find((person) => person.id === auth.profile.id) || auth.profile;
    const entries = [];
    for (const item of rawEntries) {
      const person = (state.people || []).find((entry) => entry.id === item.personId && isCurrentPerson(entry));
      if (!person) continue;
      const hours = parseManualHoursValue(item.hours);
      if (!Number.isFinite(hours) || hours < 0 || hours > 99) continue;
      const entry = normalizeManualHourEntry(person, weekYear, weekNumber, hours, enteredBy);
      upsertStateHourEntry(state, entry);
      entries.push(entry);
    }
    if (!entries.length) {
      sendJson(res, 400, { error: "Geen geldige urenregels meegegeven." });
      return;
    }
    state.activity = state.activity || [];
    const activityMessage = `${enteredBy.name} heeft diensturen ingevoerd voor week ${weekNumber} (${entries.length} regels).`;
    state.activity.push(activityMessage);
    if (typeof peopleStorage.writeManualHoursEntries === "function") {
      await peopleStorage.writeManualHoursEntries(entries, [activityMessage]);
    } else {
      await peopleStorage.writeState(state);
    }
    const latestState = await readPeopleState();
    const permissions = permissionsForAuth(auth, latestState);
    sendJson(res, 200, {
      ok: true,
      state: stateForProfile(latestState, permissions, auth.profile.id),
      canViewLogbook: permissions.canViewLogbook,
      permissions
    });
    return;
  }
  // W&S-aanname maakt bewust alleen basisprofielen aan; verdere details lopen via Personeel/profielbeheer.
  const blacklistPersonMatch = url.pathname.match(/^\/api\/blacklist\/people\/([^/]+)$/);
  if (blacklistPersonMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag de blacklist beheren." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(blacklistPersonMatch[1]));
    if (!person || !["Ontslagen", "Gearchiveerd"].includes(person.status)) {
      sendJson(res, 404, { error: "Archiefprofiel niet gevonden." });
      return;
    }
    const discordId = normalizeDiscordId(person.discordId);
    if (!discordId) {
      sendJson(res, 400, { error: "Dit archiefprofiel heeft geen Discord ID." });
      return;
    }
    const existing = activeBlacklistEntryForDiscordId(state, discordId);
    if (existing) {
      sendJson(res, 409, { error: "Deze Discord ID staat al op de blacklist." });
      return;
    }
    const body = await readBody(req);
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const entry = {
      id: crypto.randomUUID(),
      personId: person.id,
      name: person.name || "Onbekend",
      discordId,
      rank: person.rank || "",
      serviceNumber: person.previousServiceNumber || person.serviceNumber || "",
      reason: String(body.reason || person.dismissalReason || "Geen reden opgegeven.").trim(),
      blacklistedAt: new Date().toISOString(),
      blacklistedById: actor?.id || auth.profile.id,
      blacklistedByName: actor?.name || auth.profile.name || "Kader",
      revokedAt: "",
      revokedById: "",
      revokedByName: "",
      revokeReason: ""
    };
    state.blacklist = Array.isArray(state.blacklist) ? state.blacklist : [];
    state.activity = state.activity || [];
    state.blacklist.push(entry);
    state.activity.push(`${entry.name} is op de blacklist gezet door ${entry.blacklistedByName}.`);
    await sendBlacklistWebhook(state, entry, actor);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const blacklistRevokeMatch = url.pathname.match(/^\/api\/blacklist\/([^/]+)\/revoke$/);
  if (blacklistRevokeMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag de blacklist beheren." });
      return;
    }
    state.blacklist = Array.isArray(state.blacklist) ? state.blacklist : [];
    const entry = state.blacklist.find((item) => item.id === decodeURIComponent(blacklistRevokeMatch[1]));
    if (!entry) {
      sendJson(res, 404, { error: "Blacklist entry niet gevonden." });
      return;
    }
    if (entry.revokedAt) {
      sendJson(res, 409, { error: "Deze blacklist entry is al ingetrokken." });
      return;
    }
    const body = await readBody(req);
    const actor = (state.people || []).find((person) => person.id === auth.profile.id) || auth.profile;
    entry.revokedAt = new Date().toISOString();
    entry.revokedById = actor?.id || auth.profile.id;
    entry.revokedByName = actor?.name || auth.profile.name || "Kader";
    entry.revokeReason = String(body.reason || "Blacklist ingetrokken.").trim();
    state.activity = state.activity || [];
    state.activity.push(`Blacklist voor ${entry.name} is ingetrokken door ${entry.revokedByName}.`);
    await sendBlacklistWebhook(state, entry, actor);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  if (url.pathname === "/api/recruitment/hire" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasPermission(auth, state, "canRecruitPeople"))) {
      sendJson(res, 403, { error: "Alleen leiding, HR-bestuur of W&S mag personeel aannemen." });
      return;
    }

    const body = await readBody(req);
    const name = String(body.name || "").trim();
    const discordId = normalizeDiscordId(body.discordId);
    const hiredDate = String(body.hiredDate || today()).trim();
    if (!name || !discordId || !/^\d{4}-\d{2}-\d{2}$/.test(hiredDate)) {
      sendJson(res, 400, { error: "Naam, aangenomen op en Discord ID zijn verplicht." });
      return;
    }
    if (activeBlacklistEntryForDiscordId(state, discordId)) {
      sendJson(res, 409, { error: blacklistErrorMessage() });
      return;
    }

    const existingProfile = existingProfileForDiscordId(state, discordId);
    if (existingProfile) {
      sendJson(res, 409, { error: "Er bestaat al een actief profiel met deze Discord ID." });
      return;
    }
    const rank = defaultRecruitRank || ranks[ranks.length - 1];
    const requestedServiceNumber = String(body.serviceNumber || "").trim();
    const serviceNumber = requestedServiceNumber || getAvailableServiceNumbers(state, rank)[0];
    if (!serviceNumber) {
      sendJson(res, 409, { error: "Geen vrij dienstnummer beschikbaar voor de standaard aanname-rang." });
      return;
    }

    const previousNicknames = discordNicknameSnapshot(state);
    const previousRankRoles = discordRankRoleSnapshot(state);


    const result = savePerson(state, {
      name,
      discordId,
      rank,
      serviceNumber,
      hiredDate,
      rankDate: hiredDate,
      promotionDate: hiredDate
    });
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    applyManualAbsenceStatusSource(result.person, result.person.status);

    const recruiter = (state.people || []).find((person) => person.id === auth.profile.id) || auth.profile;
    state.activity = state.activity || [];
    state.activity.push(`${recruiter?.name || "W&S"} heeft ${name} aangenomen via W&S.`);
    try {
      const webhookResult = await sendDiscordWebhook(
        personnelWebhookUrl("hire"),
        buildRecruitmentWebhookPayload(result.person, recruiter)
      );
      if (webhookResult.ok) {
        state.activity.push(`Aanname webhook verzonden voor ${result.person.name}.`);
      } else if (!webhookResult.skipped) {
        state.activity.push(`Aanname webhook kon niet verzonden worden voor ${result.person.name}.`);
      }
    } catch (error) {
      state.activity.push(`Aanname webhook kon niet verzonden worden voor ${result.person.name}.`);
    }
    await persistPeopleStateMutation(state);
    await syncChangedDiscordNicknames(state, previousNicknames);
    await syncChangedDiscordRankRoles(state, previousRankRoles);
    await queuePersonDiscordSync(state, result.person, "recruitment_hire");

    await sendPeopleStateAfterMutation(res, auth, state);

    return;
  }

  if (url.pathname === "/api/people" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag personeel aanpassen." });
      return;
    }
    const body = await readBody(req);
    const personPayload = body.person || {};
    const existingBeforeSave = (state.people || []).find((person) => person.id === personPayload.id);
    const duplicateDiscordProfile = existingProfileForDiscordId(state, personPayload.discordId, personPayload.id);
    if (duplicateDiscordProfile) {
      sendJson(res, 409, { error: "Deze Discord ID is al gekoppeld aan een ander profiel." });
      return;
    }
    if (!existingBeforeSave && activeBlacklistEntryForDiscordId(state, personPayload.discordId)) {
      sendJson(res, 409, { error: blacklistErrorMessage() });
      return;
    }
    const previousNicknames = discordNicknameSnapshot(state);
    const previousRankRoles = discordRankRoleSnapshot(state);
    const result = savePerson(state, personPayload);
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    applyManualAbsenceStatusSource(result.person, result.person.status);
    // Nieuwe Kader-aanmaak gebruikt dezelfde aanname-webhook als W&S, zonder Discord ID in de embed.
    if (!existingBeforeSave) {
      const recruiter = (state.people || []).find((person) => person.id === auth.profile.id) || auth.profile;
      try {
        const webhookResult = await sendDiscordWebhook(
          personnelWebhookUrl("hire"),
          buildRecruitmentWebhookPayload(result.person, recruiter)
        );
        if (webhookResult.ok) {
          state.activity.push(`Aanname webhook verzonden voor ${result.person.name}.`);
        } else if (!webhookResult.skipped) {
          state.activity.push(`Aanname webhook kon niet verzonden worden voor ${result.person.name}.`);
        }
      } catch (error) {
        state.activity.push(`Aanname webhook kon niet verzonden worden voor ${result.person.name}.`);
      }
    }
    await persistPeopleStateMutation(state);
    await syncChangedDiscordNicknames(state, previousNicknames);
    await syncChangedDiscordRankRoles(state, previousRankRoles);
    await queuePersonDiscordSync(state, result.person, existingBeforeSave ? "person_updated" : "person_created");
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const updatePersonMatch = url.pathname.match(/^\/api\/people\/([^/]+)$/);
  if (updatePersonMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag personeel aanpassen." });
      return;
    }
    const body = await readBody(req);
    const duplicateDiscordProfile = existingProfileForDiscordId(state, body?.person?.discordId, decodeURIComponent(updatePersonMatch[1]));
    if (duplicateDiscordProfile) {
      sendJson(res, 409, { error: "Deze Discord ID is al gekoppeld aan een ander profiel." });
      return;
    }
    const previousNicknames = discordNicknameSnapshot(state);
    const previousRankRoles = discordRankRoleSnapshot(state);
    const result = savePerson(state, { ...(body.person || {}), id: decodeURIComponent(updatePersonMatch[1]) });
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    applyManualAbsenceStatusSource(result.person, result.person.status);
    await persistPeopleStateMutation(state);
    await syncChangedDiscordNicknames(state, previousNicknames);
    await syncChangedDiscordRankRoles(state, previousRankRoles);
    await queuePersonDiscordSync(state, result.person, "person_updated");
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const qualificationMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/qualifications$/);
  if (qualificationMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    const canManageAll = Boolean(permissions.canManageQualifications);
    const canRevokeIbt = Boolean(permissions.canRevokeIbt);
    if (!canManageAll && !canRevokeIbt) {
      sendJson(res, 403, { error: "Alleen Kader, Trainer of (h)OvJ mag deze training aanpassen." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(qualificationMatch[1]));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }
    const body = await readBody(req);
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const previousTrainingList = Array.isArray(person.completedTrainings) ? person.completedTrainings.filter((item) => profileTrainings.includes(item)) : [];
    const previousOperationalList = Array.isArray(person.completedOperational) ? person.completedOperational.filter((item) => profileOperational.includes(item)) : [];
    const previousTrainings = new Set(previousTrainingList);
    const previousOperational = new Set(previousOperationalList);
    const nextTrainings = (Array.isArray(body.completedTrainings) ? body.completedTrainings : []).filter((item) => profileTrainings.includes(item));
    const nextOperational = (Array.isArray(body.completedOperational) ? body.completedOperational : []).filter((item) => profileOperational.includes(item));
    const newTrainings = nextTrainings.filter((item) => !previousTrainings.has(item));
    const removedTrainings = previousTrainingList.filter((item) => !nextTrainings.includes(item));
    const newOperational = nextOperational.filter((item) => !previousOperational.has(item));
    const removedOperational = previousOperationalList.filter((item) => !nextOperational.includes(item));
    if (!canManageAll) {
      const onlyIbtRevoked = removedTrainings.length <= 1 && removedTrainings.every((item) => item === "IBT");
      if (newTrainings.length || newOperational.length || removedOperational.length || !onlyIbtRevoked) {
        sendJson(res, 403, { error: "(h)OvJ mag alleen een bestaande IBT training innemen." });
        return;
      }
    }
    person.completedTrainings = nextTrainings;
    person.completedOperational = nextOperational;
    for (const label of [...newTrainings, ...newOperational]) {
      addPersonNotification(person, {
        type: "training",
        title: "Kwalificatie behaald",
        message: `${label} is afgevinkt op je profiel.`,
        meta: { qualification: label }
      });
    }
    for (const label of [...removedTrainings, ...removedOperational]) {
      addPersonNotification(person, {
        type: "training",
        title: label === "IBT" ? "IBT ingenomen" : "Kwalificatie ingenomen",
        message: `${label} is ingenomen op je profiel door ${actor.name}.`,
        meta: { qualification: label, revoked: true }
      });
    }
    const changeDetails = [
      ...newTrainings.map((item) => `${item} behaald`),
      ...newOperational.map((item) => `${item} behaald`),
      ...removedTrainings.map((item) => `${item} ingenomen`),
      ...removedOperational.map((item) => `${item} ingenomen`)
    ];
    if (changeDetails.length) {
      addProfileLog(person, {
        actor,
        type: "qualification",
        action: "Kwalificaties aangepast",
        details: changeDetails.join(", "),
        meta: {
          addedTrainings: newTrainings,
          addedOperational: newOperational,
          removedTrainings,
          removedOperational
        }
      });
    }
    state.activity = state.activity || [];
    const activityMessage = changeDetails.length
      ? `${actor.name} wijzigde kwalificaties voor ${person.name}: ${changeDetails.join(", ")}.`
      : `Profiel kwalificaties bijgewerkt voor ${person.name}.`;
    const activityStartIndex = state.activity.length;
    state.activity.push(activityMessage);
    await syncQualificationDiscordRoles(state, person, [
      ...newTrainings,
      ...newOperational,
      ...removedTrainings,
      ...removedOperational
    ]);
    if (changeDetails.length) {
      await queuePersonDiscordSync(state, person, "qualification_updated");
    }
    const qualificationActivityMessages = state.activity.slice(activityStartIndex);
    if (typeof peopleStorage.writePersonQualifications === "function") {
      await Promise.resolve(peopleStorage.writePersonQualifications(person, qualificationActivityMessages));
      const nextPermissions = permissionsForAuth(auth, state);
      sendJson(res, 200, {
        ok: true,
        state: stateForProfile(state, nextPermissions, auth.profile.id),
        canViewLogbook: nextPermissions.canViewLogbook,
        permissions: nextPermissions
      });
      return;
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }
  const profileBadgesMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/profile-badges$/);
  if (profileBadgesMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canManageProfileBadges) {
      sendJson(res, 403, { error: "Alleen Kader, Hoofdofficier of Officiersraad mag functies en badges aanpassen." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(profileBadgesMatch[1]));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }
    const body = await readBody(req);
    const selectedFunctions = Array.isArray(body.extraFunctions) ? body.extraFunctions : [];
    const badges = Array.isArray(body.badges) ? body.badges : [];
    const previousFunctions = Array.isArray(person.extraFunctions) ? [...person.extraFunctions] : [];
    const previousBadges = Array.isArray(person.badges) ? [...person.badges] : [];
    // Alleen Kader mag de functie-badges Kader/Hoofdofficier/Officiersraad wijzigen.
    // Hoofdofficier en Officiersraad mogen wel taakbadges zoals hOvJ, Interne-Zaken en Trainer beheren.
    person.extraFunctions = permissions.canManagePeople
      ? mergeOvcBadgeForActor(normalizeSelectedExtraFunctions(selectedFunctions), previousFunctions, permissions)
      : previousFunctions;
    person.badges = badges.filter((badge) => extraTasks.includes(badge));
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const badgeChanges = [
      ...person.extraFunctions.filter((badge) => !previousFunctions.includes(badge)).map((badge) => `${badge} toegevoegd`),
      ...previousFunctions.filter((badge) => !person.extraFunctions.includes(badge)).map((badge) => `${badge} verwijderd`),
      ...person.badges.filter((badge) => !previousBadges.includes(badge)).map((badge) => `${badge} toegevoegd`),
      ...previousBadges.filter((badge) => !person.badges.includes(badge)).map((badge) => `${badge} verwijderd`)
    ];
    if (badgeChanges.length) {
      addProfileLog(person, {
        actor,
        type: "badges",
        action: "Functies en badges aangepast",
        details: badgeChanges.join(", ")
      });
    }
    state.activity = state.activity || [];
    state.activity.push(`Functies en badges bijgewerkt voor ${person.name}.`);
    if (badgeChanges.length) {
      await queuePersonDiscordSync(state, person, "badge_updated");
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const disciplineMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/discipline$/);
  if (disciplineMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canManageDiscipline && !permissions.canManageI8Discipline) {
      sendJson(res, 403, { error: "Alleen Kader, Interne-Zaken of (h)OvJ mag sancties registreren." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(disciplineMatch[1]) && isCurrentPerson(entry));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }
    const body = await readBody(req);
    const type = String(body.type || "").trim();
    const reason = String(body.reason || "").trim();
    if (!disciplineTypes.has(type)) {
      sendJson(res, 400, { error: "Ongeldig type strike of waarschuwing." });
      return;
    }
    if (!permissions.canManageDiscipline && !(permissions.canManageI8Discipline && type.startsWith("i8-"))) {
      sendJson(res, 403, { error: "(h)OvJ mag alleen I8 waarschuwingen en I8 strikes registreren." });
      return;
    }
    if (!reason) {
      sendJson(res, 400, { error: "Reden is verplicht." });
      return;
    }

    const issuedAt = new Date().toISOString();
    const issuer = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const entry = {
      id: crypto.randomUUID(),
      type,
      reason,
      issuedAt,
      issuedById: issuer.id,
      issuedByName: issuer.name,
      expiresAt: addMonths(issuedAt, 3)
    };
    person.discipline = Array.isArray(person.discipline) ? person.discipline : [];
    person.discipline.push(entry);
    state.activity = state.activity || [];
    const activityMessage = `${issuer.name} schreef ${disciplineLabels[type]} uit voor ${person.name}.`;
    state.activity.push(activityMessage);
    addProfileLog(person, {
      actor: issuer,
      type: "discipline",
      action: "Sanctie geregistreerd",
      details: `${disciplineLabels[type]}: ${reason}`
    });
    if (typeof peopleStorage.writePersonDiscipline === "function") {
      await Promise.resolve(peopleStorage.writePersonDiscipline(person, activityMessage));
      const permissions = permissionsForAuth(auth, state);
      sendJson(res, 200, {
        ok: true,
        state: stateForProfile(state, permissions, auth.profile.id),
        canViewLogbook: permissions.canViewLogbook,
        permissions
      });
      return;
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const disciplineEntryMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/discipline\/([^/]+)$/);
  if (disciplineEntryMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canManageDiscipline && !permissions.canManageI8Discipline) {
      sendJson(res, 403, { error: "Alleen Kader, Interne-Zaken of (h)OvJ mag sancties aanpassen." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(disciplineEntryMatch[1]) && isCurrentPerson(entry));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }
    person.discipline = Array.isArray(person.discipline) ? person.discipline : [];
    const disciplineId = decodeURIComponent(disciplineEntryMatch[2]);
    const entryIndex = person.discipline.findIndex((entry) => entry.id === disciplineId);
    if (entryIndex === -1) {
      sendJson(res, 404, { error: "Sanctie niet gevonden." });
      return;
    }

    const body = await readBody(req);
    const action = String(body.action || "update").trim();
    const issuer = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const entry = person.discipline[entryIndex];
    if (!permissions.canManageDiscipline && !String(entry.type || "").startsWith("i8-")) {
      sendJson(res, 403, { error: "(h)OvJ mag alleen I8 sancties aanpassen." });
      return;
    }
    if (action === "delete") {
      person.discipline.splice(entryIndex, 1);
      state.activity = state.activity || [];
      const activityMessage = `${issuer.name} verwijderde een sanctie van ${person.name}.`;
      state.activity.push(activityMessage);
      addProfileLog(person, {
        actor: issuer,
        type: "discipline",
        action: "Sanctie verwijderd",
        details: `${disciplineLabels[entry.type] || "Sanctie"}: ${entry.reason || "-"}`
      });
      if (typeof peopleStorage.writePersonDiscipline === "function") {
        await Promise.resolve(peopleStorage.writePersonDiscipline(person, activityMessage));
        const permissions = permissionsForAuth(auth, state);
        sendJson(res, 200, {
          ok: true,
          state: stateForProfile(state, permissions, auth.profile.id),
          canViewLogbook: permissions.canViewLogbook,
          permissions
        });
        return;
      }
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }

    const type = String(body.type || entry.type || "").trim();
    const reason = String(body.reason || "").trim();
    if (!disciplineTypes.has(type)) {
      sendJson(res, 400, { error: "Ongeldig type strike of waarschuwing." });
      return;
    }
    if (!permissions.canManageDiscipline && !(permissions.canManageI8Discipline && type.startsWith("i8-"))) {
      sendJson(res, 403, { error: "(h)OvJ mag alleen I8 waarschuwingen en I8 strikes registreren." });
      return;
    }
    if (!reason) {
      sendJson(res, 400, { error: "Reden is verplicht." });
      return;
    }
    entry.type = type;
    entry.reason = reason;
    entry.updatedAt = new Date().toISOString();
    entry.updatedById = issuer.id;
    entry.updatedByName = issuer.name;
    state.activity = state.activity || [];
    const activityMessage = `${issuer.name} paste een sanctie aan voor ${person.name}.`;
    state.activity.push(activityMessage);
    addProfileLog(person, {
      actor: issuer,
      type: "discipline",
      action: "Sanctie aangepast",
      details: `${disciplineLabels[type]}: ${reason}`
    });
    if (typeof peopleStorage.writePersonDiscipline === "function") {
      await Promise.resolve(peopleStorage.writePersonDiscipline(person, activityMessage));
      const permissions = permissionsForAuth(auth, state);
      sendJson(res, 200, {
        ok: true,
        state: stateForProfile(state, permissions, auth.profile.id),
        canViewLogbook: permissions.canViewLogbook,
        permissions
      });
      return;
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  if (url.pathname === "/api/trainer/ibt-tests" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const config = ibtFormConfig();
    if (!config) {
      sendJson(res, 404, { error: "IBT-toetsen zijn niet beschikbaar." });
      return;
    }
    if (!publicFormsStore || typeof publicFormsStore.listSubmissions !== "function") {
      sendJson(res, 503, { error: "IBT-toetsenoverzicht is niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canReviewTrainerIbtForms && !permissions.canUseDevTools) {
      sendJson(res, 403, { error: "Geen toegang tot IBT-toetsen." });
      return;
    }
    const submissions = await publicFormsStore.listSubmissions(config.slug, { limit: 1000 });
    const rows = (state.people || [])
      .filter(isIbtCandidatePerson)
      .map((person) => ibtCandidateRow(config, person, latestIbtSubmissionForPerson(submissions, person)))
      .filter((row) => row.status !== "approved")
      .sort((a, b) => {
        const statusOrder = { submitted: 0, not_sent: 1, sent: 2, rejected: 3 };
        const statusDelta = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
        if (statusDelta !== 0) return statusDelta;
        return String(a.person.serviceNumber || "zz").localeCompare(String(b.person.serviceNumber || "zz"), "nl", { numeric: true });
      });
    sendJson(res, 200, { ok: true, formUrl: ibtTestFormUrl(), rows });
    return;
  }

  if (url.pathname === "/api/trainer/ibt-tests/send" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const config = ibtFormConfig();
    if (!config) {
      sendJson(res, 404, { error: "IBT-toetsen zijn niet beschikbaar." });
      return;
    }
    if (!publicFormsStore || typeof publicFormsStore.listSubmissions !== "function") {
      sendJson(res, 503, { error: "IBT-toetsenoverzicht is niet beschikbaar." });
      return;
    }
    if (typeof enqueueDiscordSyncJob !== "function") {
      sendJson(res, 503, { error: "Discord DM-queue is niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canReviewTrainerIbtForms && !permissions.canUseDevTools) {
      sendJson(res, 403, { error: "Geen toegang om IBT-toetsen te versturen." });
      return;
    }
    const body = await readBody(req);
    const personId = String(body.personId || "").trim();
    const person = (state.people || []).find((entry) => entry.id === personId && isIbtCandidatePerson(entry));
    if (!person) {
      sendJson(res, 404, { error: "IBT-kandidaat niet gevonden of IBT is al afgevinkt." });
      return;
    }
    if (!normalizeDiscordId(person.discordId || "")) {
      sendJson(res, 400, { error: "Dit personeelslid heeft geen Discord ID op het profiel." });
      return;
    }
    const submissions = await publicFormsStore.listSubmissions(config.slug, { limit: 1000 });
    const latestSubmission = latestIbtSubmissionForPerson(submissions, person);
    const latestStatus = latestSubmission ? ibtReviewStatus(latestSubmission) : "";
    if (latestStatus === "submitted") {
      sendJson(res, 400, { error: "Deze IBT-toets is al ingeleverd en wacht op beoordeling." });
      return;
    }
    if (latestStatus === "approved") {
      sendJson(res, 400, { error: "Deze IBT-toets is al goedgekeurd." });
      return;
    }
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const now = new Date().toISOString();
    const isResend = Boolean(person.ibtTest?.sentAt || latestStatus === "rejected");
    const activityMessages = [];
    state.activity = state.activity || [];
    const activityMessage = `${actor.name || auth.profile.name} heeft een IBT-toets ${isResend ? "opnieuw " : ""}verstuurd naar ${person.name}.`;
    state.activity.push(activityMessage);
    activityMessages.push(activityMessage);
    person.ibtTest = {
      ...(person.ibtTest || {}),
      status: "sent",
      sentAt: now,
      sentById: actor.id || auth.profile.id || "",
      sentByName: actor.name || auth.profile.name || "Onbekend",
      formUrl: ibtTestFormUrl()
    };
    addProfileLog(person, {
      actor,
      type: "qualification",
      action: isResend ? "IBT-toets opnieuw verstuurd" : "IBT-toets verstuurd",
      details: "Toetslink is per Discord DM verstuurd.",
      meta: {
        training: "IBT",
        formUrl: person.ibtTest.formUrl
      }
    });
    const dmQueued = await queueDiscordDmForPerson(
      state,
      person,
      buildIbtTestSentDm(person, actor),
      isResend ? "ibt_test_resent" : "ibt_test_sent",
      activityMessages
    );
    if (!dmQueued) {
      sendJson(res, 500, { error: "Discord DM kon niet ingepland worden." });
      return;
    }
    if (typeof peopleStorage.writePersonQualifications === "function") {
      await Promise.resolve(peopleStorage.writePersonQualifications(person, activityMessages));
    } else {
      await persistPeopleStateMutation(state);
    }
    sendJson(res, 200, { ok: true, dmQueued, row: ibtCandidateRow(config, person, latestSubmission) });
    return;
  }

  if (url.pathname === "/api/mentor-tests/my" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const person = currentPersonForAuth(state, auth);
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Geen actief mentor-traject gevonden." });
      return;
    }
    const openTest = await mentorTestsStore.latestOpenForPerson(organization.key, person.id);
    const openTestIsStale = mentorTestStaleAfterReactivation(person, openTest);
    const test = openTestIsStale ? null : openTest;
    const latestTest = test || await mentorTestsStore.latestForPerson(organization.key, person.id);
    const latestTestIsStale = mentorTestStaleAfterReactivation(person, latestTest);
    let unavailableReason = "";
    if (!test && (openTestIsStale || latestTestIsStale)) {
      unavailableReason = "Je vorige mentor-toets hoort bij een ouder dienstverband. Mentor-Leiding moet na herintrede een nieuwe toets klaarzetten.";
    } else if (!test && latestTest?.status === "approved") {
      unavailableReason = "Je mentor-toets is al goedgekeurd.";
    } else if (!test && latestTest?.status === "rejected") {
      unavailableReason = "Je vorige mentor-toets is afgekeurd. Mentor-Leiding kan een nieuwe poging klaarzetten.";
    } else if (!test && latestTest?.status === "cancelled") {
      unavailableReason = "Je vorige mentor-toets is vervangen. Mentor-Leiding kan de actuele toets opnieuw sturen.";
    } else if (!test && latestTest?.status === "retracted") {
      unavailableReason = "Je mentor-toets is teruggetrokken. Mentor-Leiding kan een nieuwe toets klaarzetten.";
    }
    sendJson(res, 200, {
      ok: true,
      questions: test ? test.questions || [] : [],
      test: mentorTestForClient(test),
      latestTest: mentorTestForClient(latestTest, { includeAnswers: false }),
      unavailableReason
    });
    return;
  }

  if (url.pathname === "/api/mentor-tests/my/submit" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const person = currentPersonForAuth(state, auth);
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Geen actief mentor-traject gevonden." });
      return;
    }
    const openTest = await mentorTestsStore.latestOpenForPerson(organization.key, person.id);
    if (mentorTestStaleAfterReactivation(person, openTest)) {
      sendJson(res, 404, { error: "Er staat geen actuele mentor-toets klaar." });
      return;
    }
    const body = await readBody(req);
    try {
      const test = await mentorTestsStore.submit({
        organization: organization.key,
        personId: person.id,
        answers: body.answers || {}
      });
      await sendMentorTestWebhook("submitted", { person, actor: auth.profile, test });
      sendJson(res, 200, {
        ok: true,
        questions: test.questions || [],
        test: mentorTestForClient(test)
      });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets indienen is mislukt.", missing: error.missing || [] });
    }
    return;
  }

  if (url.pathname === "/api/mentor-tests" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canReviewMentorTests(permissions)) {
      sendJson(res, 403, { error: "Geen toegang tot mentor-toetsen." });
      return;
    }
    const tests = await mentorTestsStore.list(organization.key, 100);
    const questions = await mentorTestsStore.questionsForOrganization(organization.key);
    sendJson(res, 200, {
      ok: true,
      questions,
      tests: tests.map((test) => mentorTestForClient(test))
    });
    return;
  }

  if (url.pathname === "/api/mentor-tests/template" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canManageMentorTestTemplate(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen aan te passen." });
      return;
    }
    const questions = await mentorTestsStore.questionsForOrganization(organization.key);
    sendJson(res, 200, { ok: true, questions });
    return;
  }

  if (url.pathname === "/api/mentor-tests/template" && ["POST", "PUT"].includes(req.method)) {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canManageMentorTestTemplate(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen aan te passen." });
      return;
    }
    const body = await readBody(req);
    try {
      const questions = await mentorTestsStore.saveQuestions({
        organization: organization.key,
        questions: body.questions || []
      });
      sendJson(res, 200, { ok: true, questions });
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets opslaan is mislukt." });
    }
    return;
  }

  if (url.pathname === "/api/mentor-tests/send" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canReviewMentorTests(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen te sturen." });
      return;
    }
    const body = await readBody(req);
    const personId = String(body.personId || "").trim();
    const person = (state.people || []).find((entry) => entry.id === personId && isCurrentPerson(entry));
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Mentor-traject niet gevonden." });
      return;
    }
    const checklist = normalizeMentorChecklistForState(person, state);
    const allItemsCompleted = Array.isArray(checklist.items) && checklist.items.length > 0 && checklist.items.every((item) => item.checked);
    if (!allItemsCompleted) {
      sendJson(res, 400, { error: "Rond eerst de mentor-checklist af voordat je de toets stuurt." });
      return;
    }
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    try {
      const test = await mentorTestsStore.createOrReset({ organization: organization.key, person, actor });
      setMentorTestChecklistState(person, state, { testSent: true, testApproved: false, completed: false, actor });
      state.activity = state.activity || [];
      state.activity.push(`${actor.name || auth.profile.name} heeft een mentor-toets klaargezet voor ${person.name}.`);
      addProfileLog(person, {
        actor,
        type: "mentor",
        action: "Mentor-toets klaargezet",
        details: "Toets is beschikbaar voor de medewerker."
      });
      await sendMentorTestWebhook("sent", { person, actor, test });
      await queueDiscordDmForPerson(
        state,
        person,
        buildMentorTestSentDm(person, actor),
        "mentor_test_sent"
      );
      await sendPeopleStateAfterMutation(res, auth, state);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets sturen is mislukt." });
    }
    return;
  }

  if (url.pathname === "/api/mentor-tests/resend" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canReviewMentorTests(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen opnieuw te versturen." });
      return;
    }
    const body = await readBody(req);
    const personId = String(body.personId || "").trim();
    const person = (state.people || []).find((entry) => entry.id === personId && isCurrentPerson(entry));
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Mentor-traject niet gevonden." });
      return;
    }
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    try {
      const test = await mentorTestsStore.resendOpenForPerson({
        organization: organization.key,
        personId: person.id,
        actor
      });
      setMentorTestChecklistState(person, state, { testSent: true, testApproved: false, completed: false, actor });
      state.activity = state.activity || [];
      state.activity.push(`${actor.name || auth.profile.name} heeft de mentor-toets opnieuw verstuurd naar ${person.name}.`);
      addProfileLog(person, {
        actor,
        type: "mentor",
        action: "Mentor-toets opnieuw verstuurd",
        details: "Toets is opnieuw naar de medewerker gestuurd."
      });
      await sendMentorTestWebhook("resent", { person, actor, test });
      await queueDiscordDmForPerson(
        state,
        person,
        buildMentorTestSentDm(person, actor),
        "mentor_test_resent"
      );
      await sendPeopleStateAfterMutation(res, auth, state);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets opnieuw versturen is mislukt." });
    }
    return;
  }

  if (url.pathname === "/api/mentor-tests/retract" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canReviewMentorTests(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen terug te trekken." });
      return;
    }
    const body = await readBody(req);
    const personId = String(body.personId || "").trim();
    const person = (state.people || []).find((entry) => entry.id === personId && isCurrentPerson(entry));
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Mentor-traject niet gevonden." });
      return;
    }
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    try {
      const test = await mentorTestsStore.retractOpenForPerson({
        organization: organization.key,
        personId: person.id,
        actor
      });
      setMentorTestChecklistState(person, state, { testSent: false, testApproved: false, completed: false, actor });
      state.activity = state.activity || [];
      state.activity.push(`${actor.name || auth.profile.name} heeft de mentor-toets van ${person.name} teruggetrokken.`);
      addProfileLog(person, {
        actor,
        type: "mentor",
        action: "Mentor-toets teruggetrokken",
        details: "Toets kan opnieuw worden klaargezet."
      });
      await sendMentorTestWebhook("retracted", { person, actor, test });
      await sendPeopleStateAfterMutation(res, auth, state);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets terugtrekken is mislukt." });
    }
    return;
  }

  const mentorTestReviewMatch = url.pathname.match(/^\/api\/mentor-tests\/([^/]+)\/review$/);
  if (mentorTestReviewMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canReviewMentorTests(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen te beoordelen." });
      return;
    }
    const body = await readBody(req);
    const status = String(body.status || "").trim();
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    try {
      const test = await mentorTestsStore.review({
        organization: organization.key,
        id: decodeURIComponent(mentorTestReviewMatch[1]),
        status,
        actor,
        reviewNote: body.reviewNote || ""
      });
      const person = (state.people || []).find((entry) => entry.id === test.personId);
      if (person) {
        const reviewState = mentorReviewStateForStatus(status);
        const approved = reviewState.testApproved;
        setMentorTestChecklistState(person, state, {
          ...reviewState,
          actor
        });
        state.activity = state.activity || [];
        state.activity.push(`${actor.name || auth.profile.name} heeft de mentor-toets van ${person.name} ${approved ? "goedgekeurd" : "afgekeurd"}.`);
        addProfileLog(person, {
          actor,
          type: "mentor",
          action: approved ? "Mentor-toets goedgekeurd" : "Mentor-toets afgekeurd",
          details: approved ? "Mentor-traject afgerond." : "Nieuwe poging nodig."
        });
      }
      await sendMentorTestWebhook(status, { person, actor, test });
      await sendPeopleStateAfterMutation(res, auth, state);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets beoordelen is mislukt." });
    }
    return;
  }

  const mentorTestDeleteMatch = url.pathname.match(/^\/api\/mentor-tests\/([^/]+)\/delete$/);
  if (mentorTestDeleteMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!canReviewMentorTests(permissions)) {
      sendJson(res, 403, { error: "Geen toegang om mentor-toetsen te verwijderen." });
      return;
    }
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    try {
      const test = await mentorTestsStore.deleteTest({
        organization: organization.key,
        id: decodeURIComponent(mentorTestDeleteMatch[1])
      });
      const person = (state.people || []).find((entry) => entry.id === test.personId);
      if (person) {
        const latestTest = await mentorTestsStore.latestForPerson(organization.key, person.id);
        const latestReviewState = latestTest ? mentorReviewStateForStatus(latestTest.status) : null;
        setMentorTestChecklistState(person, state, {
          testSent: latestTest?.status === "sent" || latestTest?.status === "submitted",
          testApproved: Boolean(latestReviewState?.testApproved),
          completed: Boolean(latestReviewState?.completed),
          actor
        });
        state.activity = state.activity || [];
        state.activity.push(`${actor.name || auth.profile.name} heeft de mentor-toets van ${person.name} verwijderd.`);
        addProfileLog(person, {
          actor,
          type: "mentor",
          action: "Mentor-toets verwijderd",
          details: "Toets moet opnieuw worden klaargezet."
        });
      }
      await sendPeopleStateAfterMutation(res, auth, state);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets verwijderen is mislukt." });
    }
    return;
  }

  const mentorMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/mentor$/);
  if (mentorMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasPermission(auth, state, "canManageMentorOverview"))) {
      sendJson(res, 403, { error: "Alleen Kader of Mentor mag mentor-checklists aanpassen." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(mentorMatch[1]) && isCurrentPerson(entry));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }
    if (!mentorRanks.includes(person.rank)) {
      sendJson(res, 400, { error: `Mentor-checklist is alleen voor ${mentorRanks.join(", ")}.` });
      return;
    }

    const body = await readBody(req);
    const templateItems = mentorTemplateItems(state);
    const existing = normalizeMentorChecklistForState(person, state);
    const incomingItems = Array.isArray(body.items) ? body.items : existing.items || [];
    const previousById = new Map((existing.items || []).map((item) => [item.id, Boolean(item.checked)]));
    const incomingById = new Map();
    incomingItems.forEach((item, index) => {
      if (item && typeof item === "object") {
        incomingById.set(item.id || templateItems[index]?.id, Boolean(item.checked));
      } else if (templateItems[index]) {
        incomingById.set(templateItems[index].id, Boolean(item));
      }
    });
    const items = templateItems.map((item) => ({
      id: item.id,
      label: item.label,
      checked: incomingById.has(item.id) ? Boolean(incomingById.get(item.id)) : Boolean(previousById.get(item.id))
    }));
    const allItemsCompleted = items.length > 0 && items.every((item) => item.checked);
    const testSent = allItemsCompleted ? Boolean(existing.testSent) : false;
    const testApproved = allItemsCompleted && testSent ? Boolean(existing.testApproved) : false;
    const completed = allItemsCompleted && testSent && testApproved;
    const shouldNotifyMentorTestReady = allItemsCompleted && !testSent && !existing.testReadyNotifiedAt;
    const updatedAt = new Date().toISOString();
    const notes = normalizeMentorNotes(existing);
    const audit = Array.isArray(existing.audit) ? existing.audit : [];
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    for (const item of items) {
      const wasChecked = Boolean(previousById.get(item.id));
      if (item.checked !== wasChecked) {
        audit.push({
          id: crypto.randomUUID(),
          itemId: item.id,
          label: item.label,
          checked: item.checked,
          signedAt: updatedAt,
          signedById: actor.id || auth.profile.id,
          signedByName: actor.name || auth.profile.name
        });
      }
    }
    const newNote = String(body.newNote || "").trim();
    if (newNote) {
      notes.push({
        id: crypto.randomUUID(),
        text: newNote,
        createdAt: updatedAt,
        authorId: auth.profile.id,
        authorName: auth.profile.name
      });
    }
    person.mentorChecklist = {
      completed,
      testSent,
      testApproved,
      items,
      notes,
      audit,
      testReadyNotifiedAt: allItemsCompleted ? existing.testReadyNotifiedAt || (shouldNotifyMentorTestReady ? updatedAt : "") : "",
      updatedAt,
      updatedById: auth.profile.id,
      updatedByName: auth.profile.name
    };
    person.completedTrainings = Array.isArray(person.completedTrainings) ? person.completedTrainings : [];
    const shouldSyncMentorTraining = Boolean(mentorTrainingName && profileTrainings.includes(mentorTrainingName));
    if (shouldSyncMentorTraining && completed && !person.completedTrainings.includes(mentorTrainingName)) {
      person.completedTrainings.push(mentorTrainingName);
    }
    if (shouldSyncMentorTraining && !completed) {
      person.completedTrainings = person.completedTrainings.filter((item) => item !== mentorTrainingName);
    }
    state.activity = state.activity || [];
    state.activity.push(`Mentor-checklist bijgewerkt voor ${person.name}.`);
    if (shouldNotifyMentorTestReady) {
      state.activity.push(`${person.name} heeft alle mentor-traject opdrachten afgerond; mentor-toets kan worden klaargezet.`);
      await sendMentorTestWebhook("ready", { person, actor });
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  if (url.pathname === "/api/mentor-checklist-template" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    if (!permissions.canManageMentorChecklistTemplate) {
      sendJson(res, 403, { error: "Alleen Mentor-Leiding, OTC-Leiding of Kader mag de mentor-checklist aanpassen." });
      return;
    }
    const body = await readBody(req);
    const groups = Array.isArray(body.groups) ? body.groups : [];
    const normalizedGroups = groups.map((group, groupIndex) => ({
      id: group.id || slugId(group.title, `groep-${groupIndex + 1}`),
      title: String(group.title || `Groep ${groupIndex + 1}`).trim(),
      items: (group.items || []).map((item, itemIndex) => ({
        id: item.id || slugId(item.label, `punt-${groupIndex + 1}-${itemIndex + 1}`),
        label: String(item.label || "").trim()
      })).filter((item) => item.label)
    })).filter((group) => group.title && group.items.length);
    if (!normalizedGroups.length) {
      sendJson(res, 400, { error: "De checklist moet minimaal een groep met een regel bevatten." });
      return;
    }
    state.mentorChecklistGroups = normalizedGroups;
    for (const person of state.people || []) {
      if (!isCurrentPerson(person) || !mentorRanks.includes(person.rank)) continue;
      const checklist = normalizeMentorChecklistForState(person, state);
      if (!checklist.completed) {
        const allItemsCompleted = checklist.items.length > 0 && checklist.items.every((item) => item.checked);
        const testSent = allItemsCompleted ? Boolean(checklist.testSent) : false;
        const testApproved = allItemsCompleted && testSent ? Boolean(checklist.testApproved) : false;
        person.mentorChecklist = {
          ...checklist,
          completed: allItemsCompleted && testSent && testApproved,
          testSent,
          testApproved
        };
      }
    }
    state.activity = state.activity || [];
    state.activity.push(`${auth.profile.name} heeft de mentor-checklist template aangepast.`);
    if (typeof peopleStorage.writeMentorChecklistGroups === "function") {
      await Promise.resolve(peopleStorage.writeMentorChecklistGroups(state));
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }
  const personActionMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/(promote|demote|dismiss|restore|clear-history|delete-archive|io)$/);
  if (personActionMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const permissions = permissionsForAuth(auth, state);
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(personActionMatch[1]));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }

    const action = personActionMatch[2];
    const actor = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const actorIsOvcOnly = hasOvcFunctionBadge(actor) && !actor.rank && !actor.serviceNumber;
    if (["promote", "demote"].includes(action) && !canManageRankAction(permissions, person, action)) {
      sendJson(res, 403, { error: "Alleen Kader mag boven Adjudant aanpassen." });
      return;
    }
    if (action === "dismiss" && !canDismissPerson(permissions, person)) {
      sendJson(res, 403, { error: "Alleen leiding of HR-bestuur mag personeel ontslaan." });
      return;
    }
    if (action === "io" && !permissions.canManageInvestigationStatus) {
      sendJson(res, 403, { error: "Alleen Officiersraad, Hoofdofficier of Kader mag I.O aanpassen." });
      return;
    }
    if (!["promote", "demote", "dismiss", "io"].includes(action) && !permissions.canManagePeople) {
      sendJson(res, 403, { error: "Alleen Kader mag deze actie uitvoeren." });
      return;
    }
    if (action === "delete-archive" && actorIsOvcOnly && !permissions.canManageOvcBadge) {
      sendJson(res, 403, { error: "OVC mag profielen niet definitief uit het portaal verwijderen." });
      return;
    }
    if (action === "dismiss" && !isCurrentPerson(person)) {
      sendPeopleStateResponse(res, auth, state);
      return;
    }
    const body = await readBody(req);
    const previousNicknames = discordNicknameSnapshot(state);
    const previousRankRoles = discordRankRoleSnapshot(state);
    if (action === "promote") {
      const blockReason = promotionBlockReason(person, state, actor, permissions);
      if (blockReason) {
        sendJson(res, 400, { error: blockReason });
        return;
      }
    }
    if (action === "promote") {
      const result = promotePerson(state, person, { serviceNumber: body.serviceNumber, actor });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error || "Promotie is niet mogelijk voor deze rang." });
        return;
      }
    }
    if (action === "demote") {
      const result = demotePerson(state, person, { serviceNumber: body.serviceNumber, actor });
      if (!result.ok) {
        sendJson(res, 400, { error: result.error || "Degradatie is niet mogelijk voor deze rang." });
        return;
      }
    }
    if (action === "dismiss") {
      const reason = String(body.reason || "").trim();
      if (!reason) {
        sendJson(res, 400, { error: "Ontslagreden is verplicht." });
        return;
      }
      const hasOvcBadge = hasOvcFunctionBadge(person);
      const releasedNumber = person.serviceNumber || person.previousServiceNumber || "";
      const releasedRank = person.rank || person.previousRank || "";
      const dismissalMember = dismissalMemberSnapshot(person, releasedNumber, releasedRank);
      const todayValue = today();
      const dismissedBy = actor;
      person.dismissalDate = todayValue;
      person.dismissalReason = reason;
      person.archivedUntil = hasOvcBadge ? "" : addMonths(todayValue, 6);
      if (releasedNumber) person.previousServiceNumber = releasedNumber;
      if (releasedRank) person.previousRank = releasedRank;
      person.serviceNumber = "";
      if (hasOvcBadge) {
        person.status = "Actief";
        applyManualAbsenceStatusSource(person, person.status);
        person.rank = "";
        person.rankDate = "";
        person.promotionDate = "";
        person.extraFunctions = normalizeOvcFunctionBadges(person.extraFunctions || []);
      } else {
        person.status = "Ontslagen";
        applyManualAbsenceStatusSource(person, person.status);
      }
      person.permRole = "Geen";
      state.activity = state.activity || [];
      state.activity.push(
        hasOvcBadge
          ? `${person.name} is als medewerker ontslagen. OVC-toegang is behouden en dienstnummer ${releasedNumber || "-"} is vrijgegeven.`
          : `${person.name} is op ontslag gezet. Dienstnummer ${releasedNumber || "-"} is vrijgegeven.`
      );
      autoSortServiceNumbers(state);
      await persistPeopleStateMutation(state);
      try {
        const webhookResult = await sendDiscordWebhook(
          personnelWebhookUrl("dismissal"),
          buildDismissalWebhookPayload(dismissalMember, { reason, releasedNumber, date: todayValue, rank: releasedRank }, dismissedBy)
        );
        if (webhookResult.ok) {
          state.activity.push(`Ontslag webhook verzonden voor ${person.name}.`);
        } else if (!webhookResult.skipped) {
          state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
        }
      } catch (error) {
        state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
      }
    }
    if (action === "restore") {
      if (activeBlacklistEntryForDiscordId(state, person.discordId)) {
        sendJson(res, 409, { error: blacklistErrorMessage() });
        return;
      }
      const todayValue = today();
      const rank = String(body.rank || person.rank || "").trim();
      if (!ranks.includes(rank)) {
        sendJson(res, 400, { error: "Kies een geldige rang voor herintrede." });
        return;
      }
      person.rank = rank;
      person.hiredDate = todayValue;
      person.rankDate = todayValue;
      person.promotionDate = todayValue;
      person.status = "Actief";
      applyManualAbsenceStatusSource(person, person.status);
      person.reactivatedDate = todayValue;
      person.archivedUntil = "";
      person.dismissalReason = person.dismissalReason || "";
      assignFirstAvailableServiceNumber(state, person);
      person.rankHistory = person.rankHistory || [];
      person.rankHistory.push({ rank: person.rank, date: todayValue, serviceNumber: person.serviceNumber });
      if (mentorRanks.includes(person.rank)) {
        const existingMentorChecklist = person.mentorChecklist || {};
        person.mentorChecklist = {
          items: mentorChecklistItemsForTemplate({}, mentorTemplateItems(state)),
          notes: normalizeMentorNotes(existingMentorChecklist),
          audit: Array.isArray(existingMentorChecklist.audit) ? existingMentorChecklist.audit : [],
          completed: false,
          testSent: false,
          testApproved: false,
          testReadyNotifiedAt: "",
          updatedAt: new Date().toISOString(),
          updatedById: actor.id || auth.profile.id || "",
          updatedByName: actor.name || auth.profile.name || ""
        };
        setMentorTrainingCompletion(person, false);
      }
      state.activity = state.activity || [];
      state.activity.push(`${person.name} is teruggezet naar actief personeel als ${person.rank} met dienstnummer ${person.serviceNumber || "niet toegewezen"}.`);
      autoSortServiceNumbers(state);
    }
    if (action === "clear-history") {
      person.rankHistory = [];
      state.activity = state.activity || [];
      state.activity.push(`Rang geschiedenis gewist voor ${person.name}.`);
    }
    if (action === "io") {
      if (!isCurrentPerson(person)) {
        sendJson(res, 400, { error: "Alleen huidige medewerkers kunnen op I.O worden gezet." });
        return;
      }
      const now = new Date().toISOString();
      const actorName = actor.name || auth.profile.name || "Onbekend";
      const actorId = actor.id || auth.profile.id || "";
      state.activity = state.activity || [];
      if (body.active === false) {
        person.ioStatus = {
          active: false,
          clearedAt: now,
          clearedById: actorId,
          clearedByName: actorName
        };
        state.activity.push(`${person.name} is van I.O gehaald door ${actorName}.`);
        addProfileLog(person, {
          type: "profile",
          action: "I.O ingetrokken",
          details: `I.O status ingetrokken door ${actorName}.`,
          actor
        });
      } else {
        const reason = String(body.reason || "").trim();
        if (!reason) {
          sendJson(res, 400, { error: "Vul een reden in voor de I.O melding." });
          return;
        }
        person.ioStatus = {
          active: true,
          setAt: now,
          setById: actorId,
          setByName: actorName,
          reason
        };
        state.activity.push(`${person.name} is op I.O gezet door ${actorName}.`);
        addProfileLog(person, {
          type: "profile",
          action: "I.O melding",
          details: `Op I.O gezet door ${actorName}. Reden: ${reason}`,
          actor
        });
        await sendInvestigationWebhook(state, person, actor);
      }
    }
    if (action === "delete-archive") {
      if (hasOvcFunctionBadge(person)) {
        sendJson(res, 403, { error: "OVC-profielen kunnen niet uit het portaal verwijderd worden." });
        return;
      }
      if (!["Ontslagen", "Gearchiveerd"].includes(person.status)) {
        sendJson(res, 400, { error: "Alleen archiefprofielen kunnen definitief verwijderd worden." });
        return;
      }
      const removedName = person.name;
      const archiveIndex = state.people.findIndex((entry) => entry.id === person.id);
      if (archiveIndex < 0) {
        sendJson(res, 404, { error: "Personeels-archiefprofiel niet gevonden." });
        return;
      }
      const cleanup = unlinkDeletedPersonReferences(state, person);
      state.people.splice(archiveIndex, 1);
      state.deletedPersonIds = [...new Set([...(state.deletedPersonIds || []), person.id])];
      state.activity = state.activity || [];
      state.activity.push(`${removedName} is definitief verwijderd uit het archief.`);
      if (cleanup.hoursRemoved || cleanup.resignationUnlinked || cleanup.blacklistUnlinked) {
        state.activity.push(`Gekoppelde archiefgegevens van ${removedName} zijn opgeschoond.`);
      }
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }

    if (["promote", "demote"].includes(action)) {
      await persistPeopleStateMutation(state);
      const queuedIds = await queueChangedDiscordProfiles(state, previousNicknames, previousRankRoles, `person_${action}`);
      if (isCurrentPerson(person) && !queuedIds.has(person.id)) {
        await queuePersonDiscordSync(state, person, `person_${action}`);
      }
    } else if (action !== "io" && !(action === "dismiss" && hasOvcFunctionBadge(person))) {
      await syncChangedDiscordNicknames(state, previousNicknames);
      await syncChangedDiscordRankRoles(state, previousRankRoles);
    }
    const shouldQueueDismissSync = action === "dismiss" && !hasOvcFunctionBadge(person);
    const shouldQueueRestoreSync = isCurrentPerson(person) && ["restore", "reactivate"].includes(action);
    if (shouldQueueDismissSync || shouldQueueRestoreSync) {
      await persistPeopleStateMutation(state);
    }
    if (shouldQueueDismissSync) {
      await queuePersonDiscordSync(state, person, "person_dismiss");
    }
    if (shouldQueueRestoreSync) {
      await queuePersonDiscordSync(state, person, `person_${action}`);
    }
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const person = (state.people || []).find((entry) => entry.id === auth.profile.id);
    if (person) await ensureServiceStarNotifications(state, person);
    sendJson(res, 200, stateForProfile(state, permissionsForAuth(auth, state), auth.profile.id));
    return;
  }

  if (url.pathname === "/api/state" && req.method === "PUT") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    sendJson(res, 405, { error: "Gebruik de gerichte API routes in plaats van volledige state updates." });
    return;
  }

  if (url.pathname === "/api/logbook" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await Promise.resolve(readState());
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Geen toegang tot logboek" });
      return;
    }
    sendJson(res, 200, { activity: state.activity || [] });
    return;
  }


    return false;
  }

  return handlePersoneelsportaalApi;
}

module.exports = { createPersoneelsportaalRouteHandler };
