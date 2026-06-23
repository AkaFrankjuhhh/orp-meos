// Defensie Personeelsportaal API-routes staan los van Porto, zodat beide websites apart kunnen groeien.
const crypto = require("node:crypto");
const { currentOrganization } = require("./organizations");
const { questionsForClient } = require("./mentor-tests-store");
const {
  OVC_FUNCTION_BADGE,
  hasOvcFunctionBadge,
  isOvcFunctionBadge,
  normalizeOvcFunctionBadges
} = require("./ovc");

function createPersoneelsportaalRouteHandler(deps) {
  const organization = currentOrganization();
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";
  const portalTitle = organization.portalTitle || "Personeelsportaal";
  const qualificationRoleLabels = Object.keys(organization.discord?.qualificationRoleMappings || {});
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
    mentorTestsStore,
    mentorTestWebhookUrl,
    buildMentorTestWebhookPayload,
    discordBot,
    enqueuePersonDiscordSync
  } = deps;

  const formsStorage = deps.formsStorage || { readState, writeState };
  const peopleStorage = deps.peopleStorage || { readState, writeState };

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
    return {
      ...existing,
      items: mentorChecklistItemsForTemplate(existing, templateItems),
      audit: Array.isArray(existing.audit) ? existing.audit : []
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
    const badges = new Set([profile?.permRole, ...(profile?.extraFunctions || [])].filter(Boolean));
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
    return "";
  }

  async function readFormsState() {
    return Promise.resolve(formsStorage.readState());
  }

  async function sendFormsStateAfterMutation(res, auth, state, targetedWrite) {
    if (typeof targetedWrite === "function") {
      await Promise.resolve(targetedWrite());
    } else {
      await Promise.resolve(formsStorage.writeState(state));
    }
    const permissions = permissionsForAuth(auth, state);
    sendJson(res, 200, {
      ok: true,
      state: stateForProfile(state, permissions, auth.profile.id),
      canViewLogbook: permissions.canViewLogbook,
      permissions
    });
  }

  async function readPeopleState() {
    return Promise.resolve(peopleStorage.readState());
  }

  async function sendPeopleStateAfterMutation(res, auth, state) {
    await Promise.resolve(peopleStorage.writeState(state));
    const permissions = permissionsForAuth(auth, state);
    sendJson(res, 200, {
      ok: true,
      state: stateForProfile(state, permissions, auth.profile.id),
      canViewLogbook: permissions.canViewLogbook,
      permissions
    });
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
      person.id !== excludedPersonId && normalizeDiscordId(person.discordId) === normalized
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
    if (!permissions.canDismissPersonnelToAdjudant || !person) return false;
    const adjudantIndex = ranks.indexOf("Adjudant");
    const currentIndex = ranks.indexOf(person.rank);
    return adjudantIndex >= 0 && currentIndex >= adjudantIndex;
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

  function mentorTestsEnabledForOrganization() {
    return organization.key === "defensie" && Boolean(mentorTestsStore);
  }

  function canReviewMentorTests(permissions) {
    return Boolean(
      permissions.canManageMentorOverview ||
      permissions.canViewMentorLeadershipLog ||
      permissions.canManageMentorChecklistTemplate ||
      permissions.canUseDevTools
    );
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
      reviewNote: test.reviewNote
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
      .filter((person) => person.status === "Actief" && person.discordId)
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
      .filter((person) => person.status === "Actief" && person.discordId)
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
    if (!person.rank || !person.serviceNumber) return;
    try {
      const isNewHire = ["recruitment_hire", "person_created"].includes(reason);
      const roleWaitMaxAttempts = Number(process.env.DISCORD_REQUIRED_ROLE_MAX_ATTEMPTS || 288);
      await enqueuePersonDiscordSync(person, reason, {
        // New recruits often receive their organization role shortly after their portal profile.
        maxAttempts: isNewHire && Number.isFinite(roleWaitMaxAttempts) ? Math.max(1, Math.floor(roleWaitMaxAttempts)) : undefined
      });
      state.activity = state.activity || [];
      state.activity.push(`Discord profielsync ingepland voor ${person.name}${isNewHire ? "; wacht indien nodig op de organisatie-rol" : ""}.`);
    } catch (error) {
      state.activity = state.activity || [];
      state.activity.push(`Discord profielsync inplannen mislukt voor ${person.name}: ${error.message || "onbekende fout"}.`);
    }
  }

  async function syncQualificationDiscordRoles(state, person, changedLabels) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.syncQualificationRolesForPerson !== "function") return;
    if (!person?.discordId || !changedLabels.some((label) => qualificationRoleLabels.includes(label))) return;
    try {
      const result = await discordBot.syncQualificationRolesForPerson(
        person,
        `${portalTitle} kwalificatie aangepast`
      );
      if (result?.ok && Array.isArray(result.changes) && result.changes.length) {
        state.activity = state.activity || [];
        state.activity.push(`Discord kwalificatierollen gesynchroniseerd voor ${person.name}.`);
      } else if (result?.skipped) {
        state.activity = state.activity || [];
        state.activity.push(`Discord kwalificatierollen overgeslagen voor ${person.name}: ${result.reason}`);
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
      actorName: actor.name || "Onbekend"
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
      person.notifications = (Array.isArray(person.notifications) ? person.notifications : []).map((notification) => ({
        ...notification,
        readAt: notification.readAt || now
      }));
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
      person.notifications = [];
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

    if (url.pathname === "/api/resignation-forms" && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    const body = await readBody(req);
    const member = (state.people || []).find((person) => person.id === auth.profile.id && person.status === "Actief");
    const reason = String(body.reason || "").trim();
    if (!member) {
      sendJson(res, 400, { error: "Actief profiel is verplicht om een ontslagformulier in te dienen." });
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
    if (form.status === "Verwerkt") {
      sendJson(res, 409, { error: "Dit ontslagformulier is al verwerkt." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === form.memberId && entry.status === "Actief");
    if (!person) {
      sendJson(res, 404, { error: "Actief personeelslid niet gevonden. Mogelijk is dit profiel al gearchiveerd." });
      return;
    }

    const processedBy = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
    const releasedNumber = person.serviceNumber || form.serviceNumber || "";
    const todayValue = today();
    const reason = String(form.reason || "Ontslagformulier verwerkt.").trim();
    person.status = "Ontslagen";
    person.dismissalDate = todayValue;
    person.dismissalReason = reason;
    person.archivedUntil = addMonths(todayValue, 6);
    person.previousServiceNumber = releasedNumber;
    person.serviceNumber = "";
    person.permRole = "Geen";
    form.status = "Verwerkt";
    form.processedAt = new Date().toISOString();
    form.processedById = processedBy.id;
    form.processedByName = processedBy.name;
    state.activity = state.activity || [];
    state.activity.push(`${processedBy.name} heeft het ontslagformulier van ${person.name} verwerkt. Dienstnummer ${releasedNumber || "-"} is vrijgegeven.`);
    try {
      const webhookResult = await sendDiscordWebhook(
        personnelWebhookUrl("dismissal"),
        buildDismissalWebhookPayload(person, { reason, releasedNumber, date: todayValue }, processedBy)
      );
      if (webhookResult.ok) {
        state.activity.push(`Ontslag webhook verzonden voor ${person.name}.`);
      } else if (!webhookResult.skipped) {
        state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
      }
    } catch (error) {
      state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
    }
    autoSortServiceNumbers(state);
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
    const member = (state.people || []).find((person) => person.id === auth.profile.id && person.status === "Actief");
    if (!member || !body.from || !body.to) {
      sendJson(res, 400, { error: "Actief profiel, vanaf en tot zijn verplicht." });
      return;
    }
    state.absences = state.absences || [];
    state.activity = state.activity || [];
    const activityMessages = [];
    const pushActivity = (message) => {
      state.activity.push(message);
      activityMessages.push(message);
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
    pushActivity(`Afwezigheid geregistreerd voor ${member.name}.`);
    try {
      const webhookResult = await sendDiscordWebhook(
        absenceWebhookUrl(),
        buildAbsenceWebhookPayload(member, absence, auth.profile)
      );
      if (webhookResult.ok) {
        pushActivity(`Afwezigheid webhook verzonden voor ${member.name}.`);
      } else if (!webhookResult.skipped) {
        pushActivity(`Afwezigheid webhook kon niet verzonden worden voor ${member.name}.`);
      }
    } catch (error) {
      pushActivity(`Afwezigheid webhook kon niet verzonden worden voor ${member.name}.`);
    }
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.createAbsence === "function" ? () => formsStorage.createAbsence(absence, activityMessages) : null
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
    state.activity = state.activity || [];
    state.activity.push(activityMessage);
    if (member) {
      addPersonNotification(member, {
        type: "absence",
        title: `Verlof ${status.toLowerCase()}`,
        message: `Je verlof van ${absence.from || "-"} t/m ${absence.to || "-"} is ${status.toLowerCase()} door ${reviewer.name}.`,
        meta: { absenceId: absence.id, status }
      });
      await persistPersonNotifications(member, state);
    }
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.updateAbsence === "function" ? () => formsStorage.updateAbsence(absence, [activityMessage]) : null
    );
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
    const member = (state.people || []).find((person) => person.id === auth.profile.id && person.status === "Actief");
    if (!member) {
      sendJson(res, 400, { error: "Actief profiel is verplicht om een I8 formulier op te stellen." });
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
        state: stateForProfile(state, permissions, auth.profile.id),
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
      typeof formsStorage.createI8Form === "function" ? () => formsStorage.createI8Form(form, [activityMessage]) : null
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
    }
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.updateI8Form === "function" ? () => formsStorage.updateI8Form(form, [activityMessage]) : null
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
      const person = (state.people || []).find((entry) => entry.id === item.personId && entry.status === "Actief");
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
      sendJson(res, 403, { error: "Alleen Kader of W&S mag personeel aannemen." });
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
      sendJson(res, 409, { error: "Er bestaat al een profiel met deze Discord ID. Heractiveer het bestaande profiel in plaats van een tweede profiel aan te maken." });
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
        details: changeDetails.join(", ")
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
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(disciplineMatch[1]) && entry.status === "Actief");
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
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(disciplineEntryMatch[1]) && entry.status === "Actief");
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

  if (url.pathname === "/api/mentor-tests/my" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!mentorTestsEnabledForOrganization()) {
      sendJson(res, 404, { error: "Mentor-toetsen zijn niet beschikbaar." });
      return;
    }
    const state = await readPeopleState();
    const discordId = normalizeDiscordId(auth.profile.discordId);
    const person = (state.people || []).find((entry) =>
      entry.status === "Actief" &&
      (entry.id === auth.profile.id || normalizeDiscordId(entry.discordId) === discordId)
    );
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Geen actief mentor-traject gevonden." });
      return;
    }
    const test = await mentorTestsStore.latestOpenForPerson(organization.key, person.id);
    sendJson(res, 200, {
      ok: true,
      questions: test ? questionsForClient() : [],
      test: mentorTestForClient(test)
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
    const discordId = normalizeDiscordId(auth.profile.discordId);
    const person = (state.people || []).find((entry) =>
      entry.status === "Actief" &&
      (entry.id === auth.profile.id || normalizeDiscordId(entry.discordId) === discordId)
    );
    if (!person || !mentorRanks.includes(person.rank)) {
      sendJson(res, 404, { error: "Geen actief mentor-traject gevonden." });
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
        questions: questionsForClient(),
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
    sendJson(res, 200, {
      ok: true,
      questions: questionsForClient(),
      tests: tests.map((test) => mentorTestForClient(test))
    });
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
    const person = (state.people || []).find((entry) => entry.id === personId && entry.status === "Actief");
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
      await sendPeopleStateAfterMutation(res, auth, state);
    } catch (error) {
      sendJson(res, error.status || 500, { error: error.message || "Mentor-toets sturen is mislukt." });
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
        const approved = status === "approved";
        setMentorTestChecklistState(person, state, {
          testSent: approved,
          testApproved: approved,
          completed: approved,
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

  const mentorMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/mentor$/);
  if (mentorMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasPermission(auth, state, "canManageMentorOverview"))) {
      sendJson(res, 403, { error: "Alleen Kader of Mentor mag mentor-checklists aanpassen." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(mentorMatch[1]) && entry.status === "Actief");
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
      if (person.status !== "Actief" || !mentorRanks.includes(person.rank)) continue;
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
      sendJson(res, 403, { error: "Alleen Kader of Hoofdofficier mag tot en met Adjudant ontslaan." });
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
      const releasedNumber = person.serviceNumber;
      const releasedRank = person.rank;
      const todayValue = today();
      const dismissedBy = actor;
      person.dismissalDate = todayValue;
      person.dismissalReason = reason;
      person.archivedUntil = hasOvcBadge ? "" : addMonths(todayValue, 6);
      person.previousServiceNumber = releasedNumber;
      person.previousRank = releasedRank || person.previousRank || "";
      person.serviceNumber = "";
      if (hasOvcBadge) {
        person.status = "Actief";
        person.rank = "";
        person.rankDate = "";
        person.promotionDate = "";
        person.extraFunctions = normalizeOvcFunctionBadges(person.extraFunctions || []);
      } else {
        person.status = "Ontslagen";
      }
      person.permRole = "Geen";
      state.activity = state.activity || [];
      state.activity.push(
        hasOvcBadge
          ? `${person.name} is als medewerker ontslagen. OVC-toegang is behouden en dienstnummer ${releasedNumber || "-"} is vrijgegeven.`
          : `${person.name} is op ontslag gezet. Dienstnummer ${releasedNumber} is vrijgegeven.`
      );
      try {
        const webhookResult = await sendDiscordWebhook(
          personnelWebhookUrl("dismissal"),
          buildDismissalWebhookPayload(person, { reason, releasedNumber, date: todayValue, rank: releasedRank }, dismissedBy)
        );
        if (webhookResult.ok) {
          state.activity.push(`Ontslag webhook verzonden voor ${person.name}.`);
        } else if (!webhookResult.skipped) {
          state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
        }
      } catch (error) {
        state.activity.push(`Ontslag webhook kon niet verzonden worden voor ${person.name}.`);
      }
      autoSortServiceNumbers(state);
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
      person.reactivatedDate = todayValue;
      person.archivedUntil = "";
      person.dismissalReason = person.dismissalReason || "";
      assignFirstAvailableServiceNumber(state, person);
      person.rankHistory = person.rankHistory || [];
      person.rankHistory.push({ rank: person.rank, date: todayValue, serviceNumber: person.serviceNumber });
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
      if (person.status !== "Actief") {
        sendJson(res, 400, { error: "Alleen actieve medewerkers kunnen op I.O worden gezet." });
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
        person.ioStatus = {
          active: true,
          setAt: now,
          setById: actorId,
          setByName: actorName
        };
        state.activity.push(`${person.name} is op I.O gezet door ${actorName}.`);
        addProfileLog(person, {
          type: "profile",
          action: "I.O melding",
          details: `Op I.O gezet door ${actorName}.`,
          actor
        });
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

    if (action !== "io" && !(action === "dismiss" && hasOvcFunctionBadge(person))) {
      await syncChangedDiscordNicknames(state, previousNicknames);
      await syncChangedDiscordRankRoles(state, previousRankRoles);
    }
    if (person.status === "Actief" && ["promote", "demote", "reactivate"].includes(action)) {
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
