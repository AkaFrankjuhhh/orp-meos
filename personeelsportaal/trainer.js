/* Defensie Personeelsportaal trainermodule: trainingslog, trainer-score en IBT-review. */

let selectedTrainerProfileId = "";
let selectedTrainerActorKey = "";
let trainerIbtReviewCache = null;
let trainerIbtReviewLoadPromise = null;
let trainerIbtReviewError = "";
let trainerIbtQuestionLabels = new Map();

const trainerReviewStatusLabels = {
  submitted: "Ingediend",
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

function trainerSubmissionStatus(submission = {}) {
  return String(submission.review?.status || "submitted").toLowerCase();
}

function trainerIbtPendingReviewCount() {
  if (!canReviewTrainerIbtForms()) return 0;
  if (!Array.isArray(trainerIbtReviewCache)) {
    if (!trainerIbtReviewLoadPromise && serverBacked && authProfile) loadTrainerIbtReviews();
    return 0;
  }
  return trainerIbtReviewCache.filter((submission) => trainerSubmissionStatus(submission) === "submitted").length;
}

async function loadTrainerIbtReviews(force = false) {
  if (!canReviewTrainerIbtForms() || !serverBacked) return [];
  if (trainerIbtReviewLoadPromise && !force) return trainerIbtReviewLoadPromise;
  trainerIbtReviewLoadPromise = (async () => {
    try {
      const response = await fetch("/api/public-forms/submissions?slug=ibt", { cache: "no-store" });
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
      trainerIbtReviewCache = Array.isArray(payload.submissions) ? payload.submissions : [];
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

function renderTrainerIbtSubmission(submission) {
  const status = trainerSubmissionStatus(submission);
  const submitter = submission.submittedBy || {};
  const reviewedBy = submission.review?.reviewedBy;
  const reviewedAt = submission.review?.reviewedAt || "";
  const canReview = status === "submitted";
  return `
    <article class="trainer-ibt-card ${escapeHtml(status)}">
      <div class="trainer-ibt-card-head">
        <div>
          <div class="trainer-ibt-meta">
            <span class="trainer-ibt-number">${escapeHtml(submission.submissionNumber || submission.id || "-")}</span>
            <span class="trainer-ibt-status ${escapeHtml(status)}">${escapeHtml(trainerReviewStatusLabels[status] || status)}</span>
          </div>
          <h3>${escapeHtml(trainerIbtPersonLabel(submitter))}</h3>
          <p>${escapeHtml(submitter.rank || "-")} - ${escapeHtml(formatDateTime(submission.submittedAt))}</p>
        </div>
        <div class="trainer-ibt-actions">
          ${canReview ? `
            <button class="primary small" type="button" data-review-trainer-ibt="${escapeHtml(submission.id)}" data-review-status="approved">Goedkeuren</button>
            <button class="ghost small danger-soft" type="button" data-review-trainer-ibt="${escapeHtml(submission.id)}" data-review-status="rejected">Afkeuren</button>
          ` : `
            <span>${escapeHtml(reviewedBy ? `Door ${trainerIbtPersonLabel(reviewedBy)}` : "Afgerond")}</span>
            ${reviewedAt ? `<span>${escapeHtml(formatDateTime(reviewedAt))}</span>` : ""}
          `}
        </div>
      </div>
      ${renderTrainerIbtAnswers(submission.answers || {})}
    </article>
  `;
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
    const statusDelta = (trainerSubmissionStatus(a) === "submitted" ? 0 : 1) - (trainerSubmissionStatus(b) === "submitted" ? 0 : 1);
    if (statusDelta !== 0) return statusDelta;
    return new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0);
  });
  list.innerHTML = ordered.length
    ? ordered.map(renderTrainerIbtSubmission).join("")
    : '<div class="feed-item">Geen IBT-toetsen gevonden.</div>';
}

async function reviewTrainerIbtSubmission(submissionId, status) {
  if (!submissionId || !canReviewTrainerIbtForms()) return false;
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
  if (Array.isArray(trainerIbtReviewCache) && payload.submission) {
    trainerIbtReviewCache = trainerIbtReviewCache.map((submission) => submission.id === payload.submission.id ? payload.submission : submission);
  }
  renderTrainerIbtReviews();
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
    const button = event.target.closest("[data-review-trainer-ibt]");
    if (!button) return;
    reviewTrainerIbtSubmission(button.dataset.reviewTrainerIbt, button.dataset.reviewStatus);
  });
}

window.DefensiePortalModules.registerFeature("trainer", { ready: true });
