/* Defensie Personeelsportaal trainermodule: trainingslog, trainer-score en IBT-review. */

let selectedTrainerProfileId = "";
let selectedTrainerActorKey = "";
let trainerIbtReviewCache = null;
let trainerIbtReviewLoadPromise = null;
let trainerIbtReviewError = "";
let trainerIbtQuestionLabels = new Map();

const trainerReviewStatusLabels = {
  not_sent: "Niet verstuurd",
  sent: "Verstuurd",
  submitted: "Ingeleverd",
  approved: "Goedgekeurd",
  rejected: "Afgekeurd"
};

function resetTrainerIbtReviewCache() {
  trainerIbtReviewCache = null;
  trainerIbtReviewError = "";
}

function trainerEntryAddedTrainings(entry = {}) {
  const meta = entry.meta || {};
  const configuredTrainings = new Set(profileTrainings || []);
  const metaTrainings = Array.isArray(meta.addedTrainings)
    ? meta.addedTrainings.map((item) => String(item || "").trim()).filter((item) => item && configuredTrainings.has(item))
    : [];
  if (metaTrainings.length) return metaTrainings;

  const detailsTrainings = String(entry.details || "")
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.match(/^(.+?)\s+behaald$/i)?.[1]?.trim() || "")
    .filter((item) => item && configuredTrainings.has(item));
  if (detailsTrainings.length) return detailsTrainings;

  const approvedTraining = String(entry.action || "").match(/^(.+?)\s+toets goedgekeurd$/i)?.[1]?.trim() || "";
  return approvedTraining && configuredTrainings.has(approvedTraining) ? [approvedTraining] : [];
}

function trainerQualificationRecords() {
  return (state.people || [])
    .flatMap((person) => (Array.isArray(person.profileLog) ? person.profileLog : [])
      .flatMap((entry) => trainerEntryAddedTrainings(entry).map((training) => ({
        person,
        entry,
        training,
        actorId: entry.actorId || "",
        actorName: entry.actorName || "Onbekend",
        createdAt: entry.createdAt || ""
      }))))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function trainerRecordsForPerson(personId) {
  return trainerQualificationRecords().filter((record) => record.person.id === personId);
}

function trainerSearchText(person, records = []) {
  return `${person.name || ""} ${person.rank || ""} ${person.serviceNumber || ""} ${records.map((record) => `${record.training} ${record.actorName}`).join(" ")}`.toLowerCase();
}

function trainerOverviewPeople() {
  const recordsByPerson = new Map();
  for (const record of trainerQualificationRecords()) {
    const list = recordsByPerson.get(record.person.id) || [];
    list.push(record);
    recordsByPerson.set(record.person.id, list);
  }
  const query = $("#trainerSearchInput")?.value.trim().toLowerCase() || "";
  return (state.people || [])
    .filter((person) => (typeof isCurrentProfile === "function" ? isCurrentProfile(person) : person.status === "Actief"))
    .map((person) => ({ person, records: recordsByPerson.get(person.id) || [] }))
    .filter((item) => !query || trainerSearchText(item.person, item.records).includes(query))
    .sort((a, b) => {
      const latestA = Date.parse(a.records[0]?.createdAt || "") || 0;
      const latestB = Date.parse(b.records[0]?.createdAt || "") || 0;
      if (latestA !== latestB) return latestB - latestA;
      return String(a.person.serviceNumber || "").localeCompare(String(b.person.serviceNumber || ""), "nl", { numeric: true });
    });
}

function renderTrainerStats(records = trainerQualificationRecords()) {
  const container = $("#trainerOverviewStats");
  if (!container) return;
  const trainers = new Set(records.map((record) => record.actorId || record.actorName).filter(Boolean));
  const pendingIbt = trainerIbtPendingReviewCount();
  container.innerHTML = `
    <div class="trainer-stat"><span>Afgevinkt</span><strong>${escapeHtml(String(records.length))}</strong></div>
    <div class="trainer-stat"><span>Trainers</span><strong>${escapeHtml(String(trainers.size))}</strong></div>
    <div class="trainer-stat"><span>IBT open</span><strong>${escapeHtml(String(pendingIbt))}</strong></div>
  `;
}

function renderTrainerPersonTrainingLog(personId = selectedTrainerProfileId) {
  const container = $("#trainerPersonTrainingLog");
  if (!container) return;
  if (!personId) {
    container.innerHTML = '<div class="feed-item">Geen trainingsregels geselecteerd.</div>';
    return;
  }
  const person = (state.people || []).find((entry) => entry.id === personId);
  const records = trainerRecordsForPerson(personId);
  container.innerHTML = records.length
    ? `
      <div class="trainer-detail-heading">
        <strong>${escapeHtml(person?.name || "Onbekend")}</strong>
        <span>${escapeHtml(person?.rank || "-")} - ${escapeHtml(person?.serviceNumber || "-")}</span>
      </div>
      ${records.map((record) => `
        <article class="leadership-detail-row trainer-training-row">
          <strong>${escapeHtml(record.training)} <span class="trainer-plus">+1</span></strong>
          <span>Afgevinkt door ${escapeHtml(record.actorName || "Onbekend")} op ${escapeHtml(formatDateTime(record.createdAt))}</span>
          <p>${escapeHtml(record.entry.details || record.entry.action || "-")}</p>
        </article>
      `).join("")}
    `
    : '<div class="feed-item">Nog geen trainingen afgevinkt voor deze medewerker.</div>';
}

function selectTrainerProfile(personId) {
  selectedTrainerProfileId = personId || "";
  renderTrainerOverview();
}

function renderTrainerOverview() {
  const list = $("#trainerOverviewList");
  if (!list) return;
  if (!canViewTrainerOverview()) {
    list.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    renderTrainerStats([]);
    renderTrainerPersonTrainingLog("");
    return;
  }
  const rows = trainerOverviewPeople();
  const recordTotal = rows.reduce((total, row) => total + row.records.length, 0);
  renderTrainerStats(trainerQualificationRecords());
  if (!rows.some((row) => row.person.id === selectedTrainerProfileId)) {
    selectedTrainerProfileId = rows.find((row) => row.records.length)?.person.id || rows[0]?.person.id || "";
  }
  list.innerHTML = rows.length
    ? `
      <div class="leadership-row leadership-row-head trainer-overview-row">
        <span>Naam</span>
        <span>Laatste afvink</span>
        <span>+1</span>
      </div>
      ${rows.map(({ person, records }) => {
        const latest = records[0];
        return `
          <button class="leadership-row leadership-row-button trainer-overview-row ${person.id === selectedTrainerProfileId ? "is-selected" : ""}" type="button" data-trainer-person="${escapeHtml(person.id)}">
            <strong>${escapeHtml(person.name || "Onbekend")}<small>${escapeHtml(person.rank || "-")} - ${escapeHtml(person.serviceNumber || "-")}</small></strong>
            <span>${latest ? `${escapeHtml(latest.training)} door ${escapeHtml(latest.actorName || "Onbekend")}` : "Geen afvinkingen"}</span>
            <span class="rank-count"><span>${escapeHtml(String(records.length))}</span></span>
          </button>
        `;
      }).join("")}
    `
    : '<div class="feed-item">Geen medewerkers gevonden.</div>';
  if (!recordTotal && rows.length) {
    selectedTrainerProfileId = selectedTrainerProfileId || rows[0].person.id;
  }
  renderTrainerPersonTrainingLog(selectedTrainerProfileId);
}

function trainerActorKey(record) {
  return record.actorId ? `id:${record.actorId}` : `name:${String(record.actorName || "Onbekend").toLowerCase()}`;
}

function trainerActorGroups() {
  const groups = new Map();
  for (const record of trainerQualificationRecords()) {
    const key = trainerActorKey(record);
    const existing = groups.get(key) || {
      key,
      actorName: record.actorName || "Onbekend",
      actorId: record.actorId || "",
      person: null,
      records: []
    };
    existing.records.push(record);
    groups.set(key, existing);
  }
  for (const group of groups.values()) {
    group.person = (state.people || []).find((person) => (
      (group.actorId && person.id === group.actorId) ||
      (!group.actorId && String(person.name || "").toLowerCase() === String(group.actorName || "").toLowerCase())
    )) || null;
  }
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length || a.actorName.localeCompare(b.actorName, "nl"));
}

function renderTrainerLogbookDetails(group) {
  if (!group) return "";
  return `
    <div class="leadership-detail-list trainer-logbook-details">
      ${group.records.map((record) => `
        <article class="leadership-detail-row">
          <strong>${escapeHtml(record.person.name || "Onbekend")} - ${escapeHtml(record.training)} <span class="trainer-plus">+1</span></strong>
          <span>${escapeHtml(formatDateTime(record.createdAt))}</span>
          <p>${escapeHtml(record.entry.details || record.entry.action || "-")}</p>
        </article>
      `).join("")}
    </div>
  `;
}

function renderTrainerLogbook() {
  const list = $("#trainerLeadershipLogList");
  if (!list) return;
  if (!canViewTrainerLogbook()) {
    list.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const groups = trainerActorGroups();
  if (!groups.some((group) => group.key === selectedTrainerActorKey)) selectedTrainerActorKey = groups[0]?.key || "";
  list.innerHTML = groups.length
    ? `
      <div class="leadership-row leadership-row-head">
        <span>Trainer</span>
        <span>Rang</span>
        <span>+1</span>
      </div>
      ${groups.map((group) => `
        <button class="leadership-row leadership-row-button ${group.key === selectedTrainerActorKey ? "is-selected" : ""}" type="button" data-trainer-log-actor="${escapeHtml(group.key)}">
          <strong>${escapeHtml(group.actorName)}</strong>
          <span>${escapeHtml(group.person?.rank || "-")}</span>
          <span class="rank-count"><span>${escapeHtml(String(group.records.length))}</span></span>
        </button>
        ${group.key === selectedTrainerActorKey ? renderTrainerLogbookDetails(group) : ""}
      `).join("")}
    `
    : '<div class="feed-item">Nog geen trainer-afvinkingen gevonden.</div>';
}

function trainerSubmissionStatus(row = {}) {
  const status = String(row.status || row.review?.status || row.submission?.review?.status || "submitted").toLowerCase();
  return trainerReviewStatusLabels[status] ? status : "submitted";
}

function trainerIbtPendingReviewCount() {
  if (!canReviewTrainerIbtForms()) return 0;
  if (!Array.isArray(trainerIbtReviewCache)) {
    if (!trainerIbtReviewLoadPromise && serverBacked && authProfile) loadTrainerIbtReviews();
    return 0;
  }
  return trainerIbtReviewCache.filter((row) => trainerSubmissionStatus(row) === "submitted").length;
}

async function loadTrainerIbtReviews(force = false) {
  if (!canReviewTrainerIbtForms() || !serverBacked) return [];
  if (trainerIbtReviewLoadPromise && !force) return trainerIbtReviewLoadPromise;
  trainerIbtReviewLoadPromise = (async () => {
    try {
      const response = await fetch("/api/trainer/ibt-tests", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) {
        authProfile = null;
        resetPermissions();
        setLocked(true);
        trainerIbtReviewCache = [];
        trainerIbtReviewError = "Sessie verlopen.";
        return [];
      }
      if (!response.ok) {
        trainerIbtReviewCache = [];
        trainerIbtReviewError = payload.error || "IBT-toetsen konden niet geladen worden.";
        return [];
      }
      trainerIbtReviewCache = Array.isArray(payload.rows) ? payload.rows : [];
      try {
        const configResponse = await fetch("/api/public-forms/config?form=ibt", { cache: "no-store" });
        const configPayload = await configResponse.json().catch(() => ({}));
        const questions = Array.isArray(configPayload?.questions) ? configPayload.questions : [];
        trainerIbtQuestionLabels = new Map(questions.map((question) => [question.id, question.label || question.id]));
      } catch {
        trainerIbtQuestionLabels = new Map();
      }
      trainerIbtReviewError = "";
      return trainerIbtReviewCache;
    } catch (error) {
      trainerIbtReviewCache = [];
      trainerIbtReviewError = error.message || "IBT-toetsen konden niet geladen worden.";
      return [];
    }
  })().finally(() => {
    trainerIbtReviewLoadPromise = null;
    renderNavigationCounters();
    if (activePageId() === "trainer-ibt") renderTrainerIbtReviews();
  });
  return trainerIbtReviewLoadPromise;
}

function trainerIbtPersonLabel(person) {
  if (!person) return "Onbekend";
  const number = person.serviceNumber ? `${person.serviceNumber} - ` : "";
  return `${number}${person.name || "Onbekend"}`;
}

function trainerIbtAnswerValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value || "").trim();
}

function renderTrainerIbtAnswers(answers = {}) {
  const rows = Object.entries(answers)
    .map(([key, value]) => ({ key, value: trainerIbtAnswerValue(value) }))
    .filter((row) => row.value);
  return rows.length
    ? `
      <dl class="trainer-ibt-answers">
        ${rows.map((row) => `
          <div>
            <dt>${escapeHtml(trainerIbtQuestionLabels.get(row.key) || row.key)}</dt>
            <dd>${escapeHtml(row.value)}</dd>
          </div>
        `).join("")}
      </dl>
    `
    : '<p class="muted">Geen antwoorden opgeslagen.</p>';
}

function trainerIbtStatusClass(status) {
  if (status === "sent") return "sent";
  if (status === "submitted") return "submitted";
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "not-sent";
}

function trainerIbtStatusLabel(status) {
  return trainerReviewStatusLabels[status] || status || "-";
}

function trainerIbtSubmittedAt(row = {}) {
  const status = trainerSubmissionStatus(row);
  return ["submitted", "approved", "rejected"].includes(status) ? row.submission?.submittedAt || "" : "";
}

function trainerIbtRowAction(row = {}) {
  const status = trainerSubmissionStatus(row);
  const personId = row.person?.id || "";
  if (status === "submitted" && row.submission?.id) {
    return `<button class="ghost small" type="button" data-open-trainer-ibt-detail="${escapeHtml(row.submission.id)}">Bekijken</button>`;
  }
  if (status === "sent") {
    return `<button class="ghost small" type="button" data-send-trainer-ibt="${escapeHtml(personId)}">Opnieuw versturen</button>`;
  }
  if (status === "rejected") {
    return `<button class="primary small" type="button" data-send-trainer-ibt="${escapeHtml(personId)}">Opnieuw versturen</button>`;
  }
  return `<button class="primary small" type="button" data-send-trainer-ibt="${escapeHtml(personId)}">Verstuur toets</button>`;
}

function renderTrainerIbtRow(row = {}) {
  const person = row.person || {};
  const status = trainerSubmissionStatus(row);
  return `
    <div class="trainer-ibt-row">
      <strong>${escapeHtml(person.name || "Onbekend")}</strong>
      <span>${escapeHtml(person.rank || "-")}</span>
      <span>${escapeHtml(person.serviceNumber || "-")}</span>
      <span>${escapeHtml(trainerIbtSubmittedAt(row) ? formatDateTime(trainerIbtSubmittedAt(row)) : "-")}</span>
      <span class="trainer-ibt-status ${escapeHtml(trainerIbtStatusClass(status))}">${escapeHtml(trainerIbtStatusLabel(status))}</span>
      <span class="trainer-ibt-row-actions">${trainerIbtRowAction(row)}</span>
    </div>
  `;
}

function trainerIbtRowBySubmissionId(submissionId) {
  return (trainerIbtReviewCache || []).find((row) => row.submission?.id === submissionId) || null;
}

function renderTrainerIbtDetail(row) {
  const submission = row?.submission || {};
  const person = row?.person || submission.submittedBy || {};
  const status = trainerSubmissionStatus(row);
  const reviewedBy = submission.review?.reviewedBy;
  const reviewedAt = submission.review?.reviewedAt || "";
  const canReview = status === "submitted";
  return `
    <div class="trainer-ibt-detail">
      <div class="mentor-test-card-header">
        <div>
          <strong>${escapeHtml(trainerIbtPersonLabel(person))}</strong>
          <p>${escapeHtml(person.rank || "-")} - ${escapeHtml(submission.submissionNumber || submission.id || "-")}</p>
        </div>
        <span class="trainer-ibt-status ${escapeHtml(trainerIbtStatusClass(status))}">${escapeHtml(trainerIbtStatusLabel(status))}</span>
      </div>
      <div class="mentor-test-meta">
        ${row?.sentAt ? `<span>Verstuurd: ${escapeHtml(formatDateTime(row.sentAt))}</span>` : ""}
        ${submission.submittedAt ? `<span>Ingeleverd: ${escapeHtml(formatDateTime(submission.submittedAt))}</span>` : ""}
        ${reviewedAt ? `<span>Beoordeeld: ${escapeHtml(formatDateTime(reviewedAt))}</span>` : ""}
        ${reviewedBy ? `<span>Door: ${escapeHtml(trainerIbtPersonLabel(reviewedBy))}</span>` : ""}
      </div>
      ${renderTrainerIbtAnswers(submission.answers || {})}
      ${canReview ? `
        <div class="mentor-test-actions">
          <button class="primary" type="button" data-review-trainer-ibt="${escapeHtml(submission.id)}" data-review-status="approved">Goedkeuren</button>
          <button class="danger" type="button" data-review-trainer-ibt="${escapeHtml(submission.id)}" data-review-status="rejected">Afkeuren</button>
        </div>
      ` : ""}
    </div>
  `;
}

function openTrainerIbtDetailDialog(submissionId) {
  const row = trainerIbtRowBySubmissionId(submissionId);
  const dialog = $("#trainerIbtDetailDialog");
  const body = $("#trainerIbtDetailBody");
  if (!row || !dialog || !body) return;
  $("#trainerIbtDetailTitle").textContent = `${row.person?.name || "Onbekend"} - ${trainerIbtStatusLabel(trainerSubmissionStatus(row))}`;
  body.innerHTML = renderTrainerIbtDetail(row);
  dialog.showModal();
}

function closeTrainerIbtDetailDialog() {
  const dialog = $("#trainerIbtDetailDialog");
  if (dialog?.open) dialog.close();
}

function renderTrainerIbtReviews() {
  const list = $("#trainerIbtReviewList");
  if (!list) return;
  if (!canReviewTrainerIbtForms()) {
    list.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  if (!Array.isArray(trainerIbtReviewCache)) {
    list.innerHTML = '<div class="feed-item">IBT-toetsen laden...</div>';
    loadTrainerIbtReviews();
    return;
  }
  if (trainerIbtReviewError) {
    list.innerHTML = `<div class="feed-item">${escapeHtml(trainerIbtReviewError)}</div>`;
    return;
  }
  const ordered = [...trainerIbtReviewCache].sort((a, b) => {
    const statusOrder = { submitted: 0, not_sent: 1, sent: 2, rejected: 3 };
    const statusDelta = (statusOrder[trainerSubmissionStatus(a)] ?? 9) - (statusOrder[trainerSubmissionStatus(b)] ?? 9);
    if (statusDelta !== 0) return statusDelta;
    return String(a.person?.serviceNumber || "zz").localeCompare(String(b.person?.serviceNumber || "zz"), "nl", { numeric: true });
  });
  list.innerHTML = ordered.length
    ? `
      <div class="trainer-ibt-table">
        <div class="trainer-ibt-row trainer-ibt-row-head">
          <span>Naam</span>
          <span>Rang</span>
          <span>Dienstnummer</span>
          <span>Ingediend</span>
          <span>Status</span>
          <span>Actie</span>
        </div>
        ${ordered.map(renderTrainerIbtRow).join("")}
      </div>
    `
    : '<div class="feed-item">Geen IBT-kandidaten gevonden.</div>';
}

async function sendTrainerIbtTest(personId) {
  if (!personId || !canReviewTrainerIbtForms()) return false;
  const row = (trainerIbtReviewCache || []).find((entry) => entry.person?.id === personId);
  const confirmed = await showSiteConfirm(
    `IBT-toets versturen naar ${row?.person?.name || "dit personeelslid"} via Discord DM?`,
    "IBT-Toets versturen"
  );
  if (!confirmed) return false;
  const response = await fetch("/api/trainer/ibt-tests/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personId })
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    authProfile = null;
    resetPermissions();
    setLocked(true);
    await showSiteNotice("Je sessie is verlopen. Log opnieuw in en probeer het daarna opnieuw.", "Opnieuw inloggen");
    return false;
  }
  if (!response.ok) {
    await showSiteNotice(payload.error || "IBT-toets versturen is mislukt.", "Actie mislukt");
    return false;
  }
  resetTrainerIbtReviewCache();
  await loadTrainerIbtReviews(true);
  renderNavigationCounters();
  await showSiteNotice("IBT-toets is via Discord verstuurd.", "Verstuurd");
  return true;
}

async function reviewTrainerIbtSubmission(submissionId, status) {
  if (!submissionId || !canReviewTrainerIbtForms()) return false;
  const approved = status === "approved";
  const confirmed = await showSiteConfirm(
    approved ? "IBT-toets goedkeuren en IBT automatisch afvinken?" : "IBT-toets afkeuren?",
    approved ? "IBT-Toets goedkeuren" : "IBT-Toets afkeuren"
  );
  if (!confirmed) return false;
  const response = await fetch(`/api/public-forms/submissions/${encodeURIComponent(submissionId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "ibt", status })
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    authProfile = null;
    resetPermissions();
    setLocked(true);
    await showSiteNotice("Je sessie is verlopen. Log opnieuw in en probeer het daarna opnieuw.", "Opnieuw inloggen");
    return false;
  }
  if (!response.ok) {
    await showSiteNotice(payload.error || "IBT-toets beoordelen is mislukt.", "Actie mislukt");
    return false;
  }
  closeTrainerIbtDetailDialog();
  resetTrainerIbtReviewCache();
  await loadTrainerIbtReviews(true);
  renderNavigationCounters();
  if (status === "approved") {
    const loaded = await loadState();
    if (loaded) renderLiveScope("state");
  }
  return true;
}

function bindTrainerEvents() {
  $("#trainerSearchInput")?.addEventListener("input", renderTrainerOverview);
  $("#trainerOverviewList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-trainer-person]");
    if (row) selectTrainerProfile(row.dataset.trainerPerson);
  });
  $("#trainerOverviewList")?.addEventListener("keydown", (event) => {
    if (!event.target.matches("[data-trainer-person]")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    selectTrainerProfile(event.target.dataset.trainerPerson);
  });
  $("#trainerLeadershipLogList")?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-trainer-log-actor]");
    if (!row) return;
    selectedTrainerActorKey = row.dataset.trainerLogActor || "";
    renderTrainerLogbook();
  });
  $("#refreshTrainerIbtBtn")?.addEventListener("click", () => {
    resetTrainerIbtReviewCache();
    renderTrainerIbtReviews();
  });
  $("#trainerIbtReviewList")?.addEventListener("click", (event) => {
    const sendButton = event.target.closest("[data-send-trainer-ibt]");
    if (sendButton) {
      sendTrainerIbtTest(sendButton.dataset.sendTrainerIbt);
      return;
    }
    const detailButton = event.target.closest("[data-open-trainer-ibt-detail]");
    if (detailButton) {
      openTrainerIbtDetailDialog(detailButton.dataset.openTrainerIbtDetail);
    }
  });
  $("#trainerIbtDetailBody")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-review-trainer-ibt]");
    if (!button) return;
    reviewTrainerIbtSubmission(button.dataset.reviewTrainerIbt, button.dataset.reviewStatus);
  });
  $("#closeTrainerIbtDetailDialog")?.addEventListener("click", closeTrainerIbtDetailDialog);
}

window.DefensiePortalModules.registerFeature("trainer", { ready: true });
