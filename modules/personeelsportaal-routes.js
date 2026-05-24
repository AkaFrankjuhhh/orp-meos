// Defensie Personeelsportaal API-routes staan los van Porto, zodat beide websites apart kunnen groeien.
const crypto = require("node:crypto");

function createPersoneelsportaalRouteHandler(deps) {
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
    sendDiscordWebhook,
    absenceWebhookUrl,
    personnelWebhookUrl,
    buildAbsenceWebhookPayload,
    buildRecruitmentWebhookPayload,
    buildDismissalWebhookPayload,
    buildResignationFormWebhookPayload,
    discordBot
  } = deps;

  const formsStorage = deps.formsStorage || { readState, writeState };
  const peopleStorage = deps.peopleStorage || { readState, writeState };

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

  function discordNicknameSnapshot(state) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.buildServiceNickname !== "function") return new Map();
    return new Map(
      (state.people || [])
        .filter((person) => person.discordId)
        .map((person) => [person.id, discordBot.buildServiceNickname(person)])
    );
  }

  async function syncChangedDiscordNicknames(state, previousNicknames) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.syncNicknameForPerson !== "function") return;
    const changedPeople = (state.people || [])
      .filter((person) => person.status === "Actief" && person.discordId)
      .filter((person) => previousNicknames.get(person.id) !== discordBot.buildServiceNickname(person));

    for (const person of changedPeople) {
      try {
        const result = await discordBot.syncNicknameForPerson(person);
        if (result?.ok) {
          state.activity = state.activity || [];
          state.activity.push(`Discord naam gesynchroniseerd voor ${person.name}: ${discordBot.buildServiceNickname(person)}.`);
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
        .filter((person) => person.discordId)
        .map((person) => [person.id, `${person.discordId || ""}:${discordBot.rankRoleIdForPerson(person) || ""}`])
    );
  }

  async function syncChangedDiscordRankRoles(state, previousRankRoles) {
    if (!discordBot || !discordBot.isConfigured?.() || typeof discordBot.syncRankRoleForPerson !== "function") return;
    const changedPeople = (state.people || [])
      .filter((person) => person.status === "Actief" && person.discordId)
      .filter((person) => previousRankRoles.get(person.id) !== `${person.discordId || ""}:${discordBot.rankRoleIdForPerson(person) || ""}`);

    for (const person of changedPeople) {
      try {
        const result = await discordBot.syncRankRoleForPerson(person);
        if (result?.ok && Array.isArray(result.changes) && result.changes.length) {
          state.activity = state.activity || [];
          state.activity.push(`Discord rangrol gesynchroniseerd voor ${person.name}: ${person.rank}.`);
        }
      } catch (error) {
        state.activity = state.activity || [];
        state.activity.push(`Discord rangrol synchroniseren mislukt voor ${person.name}: ${error.message || "onbekende fout"}.`);
      }
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
    const ordered = forms.slice().sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const index = ordered.findIndex((entry) => entry.id === form.id);
    return String(index >= 0 ? index + 1 : ordered.length + 1).padStart(3, "0");
  }

  async function persistPersonNotifications(person, state) {
    if (!person) return;
    if (typeof peopleStorage.writePersonNotifications === "function") {
      await Promise.resolve(peopleStorage.writePersonNotifications(person));
      return;
    }
    await Promise.resolve(peopleStorage.writeState(state));
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
    const cleanHours = Math.max(0, Math.min(99, Number(hours) || 0));
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
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag afwezigheid beoordelen." });
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
    const form = {
      id: crypto.randomUUID(),
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
    state.i8Forms = Array.isArray(state.i8Forms) ? state.i8Forms : [];
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
    if (!permissions.canViewOvJChannels) {
      sendJson(res, 403, { error: "Alleen (h)OvJ of Kader mag I8 formulieren beoordelen." });
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
    const isLeadReviewer = Boolean(permissions.canLeadOvJ || permissions.canManagePeople);
    if (!isLeadReviewer) {
      if (currentStatus === "pending" && status !== "in_review") {
        sendJson(res, 403, { error: "hOvJ moet een I8 eerst in behandeling zetten voordat deze goedgekeurd of afgekeurd wordt." });
        return;
      }
      if (currentStatus === "in_review") {
        if (!form.reviewedById || form.reviewedById !== reviewer.id) {
          sendJson(res, 403, { error: `Dit I8 formulier is in behandeling door ${form.reviewedByName || "een andere beoordelaar"}. Alleen OVJ of Kader kan dit overrulen.` });
          return;
        }
        if (!['approved', 'rejected'].includes(status)) {
          sendJson(res, 403, { error: "hOvJ kan een I8 die al in behandeling staat alleen goedkeuren of afkeuren." });
          return;
        }
      }
      if (["approved", "rejected"].includes(currentStatus)) {
        sendJson(res, 403, { error: "hOvJ kan een afgerond I8 formulier niet heropenen of aanpassen. Alleen OVJ of Kader kan dit." });
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
      const hours = Number(item.hours);
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

    const existingActive = (state.people || []).find((person) => person.discordId === discordId && person.status === "Actief");
    if (existingActive) {
      sendJson(res, 409, { error: "Er bestaat al een actief profiel met deze Discord ID." });
      return;
    }
    const existingArchived = (state.people || []).find((person) => person.discordId === discordId && person.status !== "Actief");
    if (existingArchived) {
      sendJson(res, 409, { error: "Deze Discord ID staat al in het personeels-archief. Gebruik Herintrede via Personeels-Archief." });
      return;
    }

    const rank = "Marechaussee 4de Klasser";
    const serviceNumber = getAvailableServiceNumbers(state, rank)[0];
    if (!serviceNumber) {
      sendJson(res, 409, { error: "Geen vrij dienstnummer beschikbaar in de 74-reeks." });
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
    const previousNicknames = discordNicknameSnapshot(state);
    const previousRankRoles = discordRankRoleSnapshot(state);
    const result = savePerson(state, { ...(body.person || {}), id: decodeURIComponent(updatePersonMatch[1]) });
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    await syncChangedDiscordNicknames(state, previousNicknames);
    await syncChangedDiscordRankRoles(state, previousRankRoles);
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
    state.activity.push(activityMessage);
    if (typeof peopleStorage.writePersonQualifications === "function") {
      await Promise.resolve(peopleStorage.writePersonQualifications(person, activityMessage));
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
      ? selectedFunctions.filter((badge) => extraFunctions.includes(badge))
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
    if (!(await hasPermission(auth, state, "canManageDiscipline"))) {
      sendJson(res, 403, { error: "Alleen Kader of Interne-Zaken mag strikes en waarschuwingen registreren." });
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
    if (!(await hasPermission(auth, state, "canManageDiscipline"))) {
      sendJson(res, 403, { error: "Alleen Kader of Interne-Zaken mag strikes en waarschuwingen aanpassen." });
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
      sendJson(res, 400, { error: "Mentor-checklist is alleen voor 4de, 3de en 2de klassers." });
      return;
    }

    const body = await readBody(req);
    const existing = person.mentorChecklist || {};
    const incomingItems = Array.isArray(body.items) ? body.items : existing.items || [];
    const items = Array.from({ length: mentorChecklistCount }, (_, index) => Boolean(incomingItems[index]));
    const allItemsCompleted = items.length === mentorChecklistCount && items.every(Boolean);
    const testSent = allItemsCompleted ? Boolean(body.testSent ?? existing.testSent) : false;
    const testApproved = allItemsCompleted && testSent ? Boolean(body.testApproved ?? existing.testApproved) : false;
    const completed = allItemsCompleted && testSent && testApproved;
    const updatedAt = new Date().toISOString();
    const notes = normalizeMentorNotes(existing);
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
      updatedAt,
      updatedById: auth.profile.id,
      updatedByName: auth.profile.name
    };
    person.completedTrainings = Array.isArray(person.completedTrainings) ? person.completedTrainings : [];
    if (completed && !person.completedTrainings.includes(mentorTrainingName)) {
      person.completedTrainings.push(mentorTrainingName);
    }
    if (!completed) {
      person.completedTrainings = person.completedTrainings.filter((item) => item !== mentorTrainingName);
    }
    state.activity = state.activity || [];
    state.activity.push(`Mentor-checklist bijgewerkt voor ${person.name}.`);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }
  const personActionMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/(promote|demote|dismiss|restore|clear-history|delete-archive)$/);
  if (personActionMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag deze actie uitvoeren." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(personActionMatch[1]));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }

    const action = personActionMatch[2];
    const body = await readBody(req);
    const previousNicknames = discordNicknameSnapshot(state);
    const previousRankRoles = discordRankRoleSnapshot(state);
    if (action === "promote" && !promotePerson(state, person)) {
      sendJson(res, 400, { error: "Promotie is niet mogelijk voor deze rang." });
      return;
    }
    if (action === "demote" && !demotePerson(state, person)) {
      sendJson(res, 400, { error: "Degradatie is niet mogelijk voor deze rang." });
      return;
    }
    if (action === "dismiss") {
      const reason = String(body.reason || "").trim();
      if (!reason) {
        sendJson(res, 400, { error: "Ontslagreden is verplicht." });
        return;
      }
      const releasedNumber = person.serviceNumber;
      const todayValue = today();
      const dismissedBy = (state.people || []).find((entry) => entry.id === auth.profile.id) || auth.profile;
      person.status = "Ontslagen";
      person.dismissalDate = todayValue;
      person.dismissalReason = reason;
      person.archivedUntil = addMonths(todayValue, 6);
      person.previousServiceNumber = releasedNumber;
      person.serviceNumber = "";
      person.permRole = "Geen";
      state.activity = state.activity || [];
      state.activity.push(`${person.name} is op ontslag gezet. Dienstnummer ${releasedNumber} is vrijgegeven.`);
      try {
        const webhookResult = await sendDiscordWebhook(
          personnelWebhookUrl("dismissal"),
          buildDismissalWebhookPayload(person, { reason, releasedNumber, date: todayValue }, dismissedBy)
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
    if (action === "delete-archive") {
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
      state.people.splice(archiveIndex, 1);
      state.activity = state.activity || [];
      state.activity.push(`${removedName} is definitief verwijderd uit het archief.`);
      await sendPeopleStateAfterMutation(res, auth, state);
      return;
    }

    await syncChangedDiscordNicknames(state, previousNicknames);
    await syncChangedDiscordRankRoles(state, previousRankRoles);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await Promise.resolve(readState());
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
