// Defensie Personeelsportaal API-routes staan los van Porto, zodat beide websites apart kunnen groeien.
const crypto = require("node:crypto");

function createPersoneelsportaalRouteHandler(deps) {
  const {
    requireAuth,
    requireFivemIngest,
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
    isAllowedFivemJob,
    minutesBetween,
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

  async function handlePersoneelsportaalApi(req, res, url) {
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
    const isKader = Boolean(permissions.canManagePeople);
    if (currentStatus === "in_review" && form.reviewedById && form.reviewedById !== reviewer.id && !isKader) {
      sendJson(res, 403, { error: `Dit I8 formulier is in behandeling door ${form.reviewedByName || "een andere beoordelaar"}. Alleen Kader kan dit overrulen.` });
      return;
    }
    form.status = status;
    form.reviewedAt = new Date().toISOString();
    form.reviewedById = reviewer.id;
    form.reviewedByName = reviewer.name;
    form.rejectionReason = status === "rejected" ? rejectionReason : "";
    state.activity = state.activity || [];
    const actionLabel = status === "approved" ? "goedgekeurd" : status === "rejected" ? "afgekeurd" : "in behandeling gezet";
    const activityMessage = `${reviewer.name} heeft I8 formulier van ${form.personName || "Onbekend"} ${actionLabel}.`;
    state.activity.push(activityMessage);
    await sendFormsStateAfterMutation(
      res,
      auth,
      state,
      typeof formsStorage.updateI8Form === "function" ? () => formsStorage.updateI8Form(form, [activityMessage]) : null
    );
    return;
  }  if (url.pathname === "/api/fivem/hours" && req.method === "POST") {
    if (!requireFivemIngest(req, res)) return;
    const state = await readPeopleState();
    const body = await readBody(req);
    const discordId = normalizeDiscordId(body.discordId);
    const job = String(body.job || body.activeJob || "").trim();
    if (!discordId) {
      sendJson(res, 400, { error: "discordId is verplicht." });
      return;
    }
    if (!isAllowedFivemJob(job)) {
      sendJson(res, 200, { ok: true, tracked: false, reason: "Job telt niet mee voor Defensie diensturen." });
      return;
    }

    const person = (state.people || []).find((entry) => entry.discordId === discordId && entry.status === "Actief");
    if (!person) {
      sendJson(res, 404, { error: "Geen actief Defensie Personeelsportaal-profiel gevonden voor deze Discord ID." });
      return;
    }

    const startedAt = body.startedAt || body.startTime || new Date().toISOString();
    const endedAt = body.endedAt || body.endTime || new Date().toISOString();
    const minutes = Math.round(Number(body.durationMinutes || body.minutes || minutesBetween(startedAt, endedAt)));
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) {
      sendJson(res, 400, { error: "Ongeldige duur. Geef minuten of start/eindtijd mee." });
      return;
    }

    const source = String(body.source || "FiveM").trim();
    const sessionId = String(body.sessionId || body.id || "").trim();
    state.hours = Array.isArray(state.hours) ? state.hours : [];
    const existing = sessionId
      ? state.hours.find((entry) => entry.source === source && entry.sessionId === sessionId)
      : null;
    const hourEntry = {
      id: existing?.id || crypto.randomUUID(),
      personId: person.id,
      discordId,
      job,
      minutes,
      startedAt,
      endedAt,
      source,
      sessionId,
      syncedAt: new Date().toISOString()
    };
    if (existing) {
      Object.assign(existing, hourEntry);
    } else {
      state.hours.push(hourEntry);
    }
    await Promise.resolve(peopleStorage.writeState(state));
    sendJson(res, 200, {
      ok: true,
      tracked: true,
      person: { id: person.id, name: person.name, serviceNumber: person.serviceNumber },
      minutes
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
    const previousNicknames = discordNicknameSnapshot(state);
    const result = savePerson(state, body.person || {});
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    await syncChangedDiscordNicknames(state, previousNicknames);
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
    const result = savePerson(state, { ...(body.person || {}), id: decodeURIComponent(updatePersonMatch[1]) });
    if (result.error) {
      sendJson(res, 400, { error: result.error });
      return;
    }
    await syncChangedDiscordNicknames(state, previousNicknames);
    await sendPeopleStateAfterMutation(res, auth, state);
    return;
  }

  const qualificationMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/qualifications$/);
  if (qualificationMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasPermission(auth, state, "canManageQualifications"))) {
      sendJson(res, 403, { error: "Alleen Kader of Trainer mag trainingen aanpassen." });
      return;
    }
    const person = (state.people || []).find((entry) => entry.id === decodeURIComponent(qualificationMatch[1]));
    if (!person) {
      sendJson(res, 404, { error: "Personeelslid niet gevonden." });
      return;
    }
    const body = await readBody(req);
    const completedTrainings = Array.isArray(body.completedTrainings) ? body.completedTrainings : [];
    const completedOperational = Array.isArray(body.completedOperational) ? body.completedOperational : [];
    person.completedTrainings = completedTrainings.filter((item) => profileTrainings.includes(item));
    person.completedOperational = completedOperational.filter((item) => profileOperational.includes(item));
    state.activity = state.activity || [];
    const activityMessage = `Profiel kwalificaties bijgewerkt voor ${person.name}.`;
    state.activity.push(activityMessage);
    if (typeof peopleStorage.writePersonQualifications === "function") {
      await Promise.resolve(peopleStorage.writePersonQualifications(person, activityMessage));
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

  const profileBadgesMatch = url.pathname.match(/^\/api\/people\/([^/]+)\/profile-badges$/);
  if (profileBadgesMatch && req.method === "POST") {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const state = await readPeopleState();
    if (!(await hasKaderAccess(auth, state))) {
      sendJson(res, 403, { error: "Alleen Kader mag functies en badges aanpassen." });
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
    person.extraFunctions = selectedFunctions.filter((badge) => extraFunctions.includes(badge));
    person.badges = badges.filter((badge) => extraTasks.includes(badge));
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
    state.activity.push(`${issuer.name} schreef ${disciplineLabels[type]} uit voor ${person.name}.`);
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
      state.activity.push(`${issuer.name} verwijderde een sanctie van ${person.name}.`);
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
    state.activity.push(`${issuer.name} paste een sanctie aan voor ${person.name}.`);
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
    const completed = items.length === mentorChecklistCount && items.every(Boolean);
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


