/* Defensie Personeelsportaal mentormodule: mentoroverzicht, checklist, traject en mentor-notities. */

let mentorLogDetailContext = null;
let mentorAuditDetailPersonId = "";
let mentorSelfTestCache = null;
let mentorTestsReviewCache = null;
let mentorTestTemplateCache = null;
let pendingMentorTestPersonId = "";
let mentorChecklistSavePromise = null;
let mentorChecklistSaveQueued = false;
let mentorChecklistSavePersonId = "";
const leadershipPeriodLabels = {
  week: "Afgelopen week",
  month: "Afgelopen maand",
  quarter: "Afgelopen 3 maanden",
  halfyear: "Afgelopen 6 maanden"
};

function resetMentorTestCaches() {
  mentorSelfTestCache = null;
  mentorTestsReviewCache = null;
  mentorTestTemplateCache = null;
}

function openMentorChecklist(profileId) {
  selectedMentorProfileId = profileId;
  renderMentorChecklist();
  setPage("mentor-checklist");
}

function canViewMentorLeadershipLog() {
  return Boolean(permissions.canViewMentorLeadershipLog || hasKaderAccess());
}

function canManageMentorChecklistTemplate() {
  return Boolean(permissions.canManageMentorChecklistTemplate || hasKaderAccess());
}

function canManageMentorTestTemplate() {
  return Boolean(permissions.canManageMentorTestTemplate || permissions.canUseDevTools);
}

function mentorItemId(label, fallback) {
  const slug = String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function activeMentorChecklistGroups() {
  const configured = Array.isArray(state.mentorChecklistGroups) && state.mentorChecklistGroups.length
    ? state.mentorChecklistGroups
    : mentorChecklistGroups.map((group) => ({
        title: group.title,
        items: group.items.map((label, index) => ({ id: mentorItemId(label, `legacy-${index}`), label }))
      }));
  let index = 0;
  return configured
    .map((group, groupIndex) => ({
      id: group.id || mentorItemId(group.title, `groep-${groupIndex}`),
      title: String(group.title || `Groep ${groupIndex + 1}`).trim(),
      items: (Array.isArray(group.items) ? group.items : [])
        .map((item) => {
          const label = typeof item === "string" ? item : item?.label;
          const id = typeof item === "string" ? "" : item?.id;
          const normalized = {
            id: id || mentorItemId(label, `mentor-item-${index}`),
            label: String(label || "").trim()
          };
          index += 1;
          return normalized;
        })
        .filter((item) => item.label)
    }))
    .filter((group) => group.items.length);
}

function activeMentorChecklistItems() {
  return activeMentorChecklistGroups().flatMap((group) => group.items);
}

function activeMentorChecklistLabels() {
  return activeMentorChecklistItems().map((item) => item.label);
}

function mentorChecklistTimestamp(checklist = {}) {
  const parsed = Date.parse(
    checklist.updatedAt
      || checklist.completedAt
      || checklist.reviewedAt
      || checklist.sentAt
      || checklist.testReadyNotifiedAt
      || ""
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function mentorChecklistStaleAfterReactivation(person, checklist = {}) {
  const reactivatedAt = Date.parse(person?.reactivatedDate || "");
  if (!Number.isFinite(reactivatedAt)) return false;
  const checklistAt = mentorChecklistTimestamp(checklist);
  return checklistAt === null || checklistAt < reactivatedAt;
}

function mentorChecklistFor(person) {
  const checklist = person.mentorChecklist || {};
  const staleAfterReactivation = mentorChecklistStaleAfterReactivation(person, checklist);
  const items = Array.isArray(checklist.items) ? checklist.items : [];
  const notes = Array.isArray(checklist.notes)
    ? checklist.notes
    : String(checklist.notes || "").trim()
      ? [
          {
            text: String(checklist.notes).trim(),
            createdAt: checklist.updatedAt || "",
            authorName: checklist.updatedByName || "Onbekend"
          }
        ]
      : [];
  const templateItems = activeMentorChecklistItems();
  const legacyByIndex = items.map((item) => (typeof item === "object" ? Boolean(item.checked) : Boolean(item)));
  const checkedById = new Map(
    items
      .filter((item) => item && typeof item === "object")
      .map((item) => [item.id, Boolean(item.checked)])
  );
  const normalizedItems = templateItems.map((item, index) => ({
    id: item.id,
    label: item.label,
    checked: staleAfterReactivation
      ? false
      : checklist.completed
        ? true
        : (checkedById.has(item.id) ? checkedById.get(item.id) : Boolean(legacyByIndex[index]))
  }));
  const allItemsCompleted = !staleAfterReactivation
    && normalizedItems.length > 0
    && normalizedItems.every((item) => item.checked);
  const testSent = !staleAfterReactivation && Boolean(checklist.testSent);
  const testApproved = allItemsCompleted && testSent && Boolean(checklist.testApproved);
  return {
    completed: allItemsCompleted && testSent && testApproved,
    allItemsCompleted,
    testSent,
    testApproved,
    items: normalizedItems,
    notes,
    audit: Array.isArray(checklist.audit) ? checklist.audit : []
  };
}

function mentorPeople() {
  return state.people
    .filter((person) => person.status === "Actief" && mentorRanks.includes(person.rank))
    .filter((person) => !mentorChecklistFor(person).completed)
    .sort((a, b) => {
      const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
}

function mentorProgressColor(completed, total) {
  const ratio = total ? completed / total : 0;
  const hue = Math.round(4 + ratio * 126);
  const lightness = Math.round(43 + ratio * 7);
  return `hsl(${hue} 72% ${lightness}%)`;
}

function renderMentorProgressBars(completed, total) {
  const color = mentorProgressColor(completed, total);
  const ratio = total ? completed / total : 0;
  const filledBars = completed <= 0 ? 1 : Math.max(1, Math.ceil(ratio * 4));
  return `
    <span class="mentor-progress-wrap" title="${escapeHtml(completed)}/${escapeHtml(total)} voltooid">
      <span class="mentor-progress-mini" aria-label="${escapeHtml(completed)} van ${escapeHtml(total)} mentorpunten voltooid">
        ${Array.from({ length: 4 }, (_, index) => `<i class="${index < filledBars ? "done" : ""}" style="--mentor-progress-color:${color}"></i>`).join("")}
      </span>
      <b>${escapeHtml(completed)}/${escapeHtml(total)}</b>
    </span>
  `;
}

function renderMentorTestOverview(person, checklist) {
  if (checklist.testApproved) {
    return `
      <span class="mentor-test-overview" aria-label="Toetsstatus">
        <span class="mentor-test-status is-approved">Toets goedgekeurd</span>
      </span>
    `;
  }
  if (checklist.testSent) {
    return `
      <span class="mentor-test-overview" aria-label="Toetsstatus">
        <span class="mentor-test-status is-sent">Toets gestuurd</span>
      </span>
    `;
  }
  if (!checklist.allItemsCompleted) {
    return `
      <span class="mentor-test-overview is-locked" aria-label="Toetsstatus">
        <span class="mentor-test-status">Checklist eerst afronden</span>
      </span>
    `;
  }
  return `
    <span class="mentor-test-overview" aria-label="Toetsstatus">
      <button class="ghost small mentor-test-action" type="button" data-send-mentor-test="${escapeHtml(person.id)}">Toets sturen</button>
    </span>
  `;
}

function renderMentorOverview() {
  const container = $("#mentorOverviewList");
  if (!container) return;
  if (!canViewMentorOverview()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const editButton = $("#editMentorTemplateBtn");
  if (editButton) editButton.hidden = !canManageMentorChecklistTemplate();
  const query = $("#mentorSearchInput")?.value.toLowerCase() || "";
  const people = mentorPeople().filter((person) => `${person.name} ${person.rank} ${person.serviceNumber}`.toLowerCase().includes(query));
  const totalItems = activeMentorChecklistLabels().length;
  container.innerHTML = people.length
    ? `
      <div class="mentor-row mentor-row-head">
        <span>Naam</span>
        <span>Rang</span>
        <span>Aangenomen</span>
        <span>Voortgang</span>
        <span>Toets</span>
      </div>
      ${people
        .map((person) => {
          const checklist = mentorChecklistFor(person);
          const completedItems = checklist.items.filter((item) => item.checked).length;
          return `
            <div class="mentor-row mentor-row-button" role="button" tabindex="0" data-open-mentor="${person.id}" data-mentor-test-open="${
              checklist.testSent && !checklist.testApproved ? "true" : "false"
            }">
              <strong>${escapeHtml(person.name)}</strong>
              <span>${escapeHtml(person.rank)}</span>
              <span>${escapeHtml(formatDate(hiredDateFor(person)))}</span>
              ${renderMentorProgressBars(completedItems, totalItems)}
              ${renderMentorTestOverview(person, checklist)}
            </div>
          `;
        })
        .join("")}
    `
    : '<div class="feed-item">Geen medewerkers in mentorperiode gevonden.</div>';
  renderMentorPersonAudit();
}

function renderMentorNotes(notes = []) {
  return notes.length
    ? `
      ${notes
        .slice()
        .reverse()
        .map((note) => `
          <article class="mentor-note-card">
            <p>${escapeHtml(note.text || "-")}</p>
            <div class="mentor-note-meta">
              <span>Ondertekend door: ${escapeHtml(note.authorName || "Onbekend")}</span>
              <span>${escapeHtml(formatDateTime(note.createdAt))}</span>
            </div>
          </article>
        `)
        .join("")}
    `
    : '<div class="feed-item">Nog geen koppeldiensten opgeslagen.</div>';
}

function renderMentorChecklistItems(checklist, readOnly = false) {
  const checkedById = new Map(checklist.items.map((item) => [item.id, Boolean(item.checked)]));
  return activeMentorChecklistGroups()
    .map((group) => `
      <div class="mentor-check-header">${escapeHtml(group.title)}</div>
      ${group.items
        .map((item) => {
          const checked = checkedById.get(item.id);
          return `
            <label class="mentor-check-row ${readOnly ? "mentor-readonly-row" : ""} ${checked ? "is-completed" : ""}">
              <span>${escapeHtml(item.label)}</span>
              <input type="checkbox" ${readOnly ? "disabled" : `data-mentor-item="${escapeHtml(item.id)}"`} ${checked ? "checked" : ""} />
            </label>
          `;
        })
        .join("")}
    `)
    .join("");
}

function mentorChecklistItemsFromDom() {
  const checkedById = new Map($$("[data-mentor-item]").map((input) => [input.dataset.mentorItem, Boolean(input.checked)]));
  return activeMentorChecklistItems().map((item) => ({
    id: item.id,
    label: item.label,
    checked: Boolean(checkedById.get(item.id))
  }));
}

function isMentorChecklistSaveActive() {
  return Boolean(mentorChecklistSavePromise || mentorChecklistSaveQueued);
}

function applyMentorChecklistItemsOptimistically(personId, items) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person) return;
  const existing = mentorChecklistFor(person);
  const allItemsCompleted = items.length > 0 && items.every((item) => item.checked);
  person.mentorChecklist = {
    ...(person.mentorChecklist || {}),
    items,
    testSent: allItemsCompleted ? existing.testSent : false,
    testApproved: allItemsCompleted && existing.testSent ? existing.testApproved : false
  };
}

async function saveMentorChecklistItemsFromDom() {
  if (!selectedMentorProfileId || !canManageMentorOverview()) return false;
  mentorChecklistSaveQueued = true;
  mentorChecklistSavePersonId = selectedMentorProfileId;
  mentorChecklistEditingUntil = Date.now() + 3500;
  if (mentorChecklistSavePromise) return mentorChecklistSavePromise;

  mentorChecklistSavePromise = (async () => {
    let latestSaved = true;
    while (mentorChecklistSaveQueued) {
      mentorChecklistSaveQueued = false;
      const personId = mentorChecklistSavePersonId;
      const items = mentorChecklistItemsFromDom();
      applyMentorChecklistItemsOptimistically(personId, items);
      latestSaved = await saveMentorChecklist(personId, { items });
      if (!latestSaved) break;
      renderMentorOverview();
      renderMentorTrajectory();
    }
    return latestSaved;
  })().finally(() => {
    mentorChecklistSavePromise = null;
    mentorChecklistSavePersonId = "";
    mentorChecklistEditingUntil = Date.now() + 500;
  });

  return mentorChecklistSavePromise;
}

function renderMentorPersonAudit() {
  const container = $("#mentorPersonAudit");
  if (!container) return;
  if (!canViewMentorLeadershipLog()) {
    container.innerHTML = "";
    mentorAuditDetailPersonId = "";
    return;
  }
  const person = state.people.find((entry) => entry.id === mentorAuditDetailPersonId);
  if (!person) {
    container.innerHTML = '<div class="feed-item">Klik op een naam om het mentor-overzicht en logboek van die persoon te bekijken.</div>';
    return;
  }
  const checklist = mentorChecklistFor(person);
  const latestByItem = new Map();
  checklist.audit
    .slice()
    .sort((a, b) => new Date(a.signedAt || a.createdAt || 0) - new Date(b.signedAt || b.createdAt || 0))
    .forEach((entry) => {
      if (entry.checked) latestByItem.set(entry.itemId, entry);
    });
  container.innerHTML = `
    <article class="leadership-detail-row mentor-audit-summary">
      <strong>${escapeHtml(person.name)}</strong>
      <span>${escapeHtml(person.rank || "-")} - ${escapeHtml(person.serviceNumber || "-")}</span>
    </article>
    ${checklist.items
      .map((item) => {
        const signed = latestByItem.get(item.id);
        return `
          <article class="leadership-detail-row">
            <strong>${escapeHtml(item.label)}</strong>
            <span>${
              signed
                ? `Ondertekend door ${escapeHtml(signed.signedByName || "Onbekend")} ${escapeHtml(formatDateTime(signed.signedAt || signed.createdAt))}`
                : "Nog niet ondertekend"
            }</span>
          </article>
        `;
      })
      .join("")}
  `;
}

function selectMentorAuditPerson(personId) {
  mentorAuditDetailPersonId = personId;
  renderMentorPersonAudit();
}

function renderMentorChecklist() {
  const person = state.people.find((entry) => entry.id === selectedMentorProfileId && entry.status === "Actief");
  if (!person || !canViewMentorOverview()) {
    $("#mentorChecklistTitle").textContent = "Mentor-Checklist";
    $("#mentorChecklistSubtitle").textContent = "Geen medewerker geselecteerd.";
    $("#mentorChecklistItems").innerHTML = "";
    $("#mentorNotesLog").innerHTML = "";
    $("#mentorNotes").value = "";
    return;
  }
  const checklist = mentorChecklistFor(person);
  $("#mentorChecklistTitle").textContent = person.name;
  $("#mentorChecklistSubtitle").textContent = `${person.rank} - ${person.serviceNumber || "-"}`;
  $("#mentorChecklistItems").innerHTML = renderMentorChecklistItems(checklist);
  $("#mentorNotesLog").innerHTML = renderMentorNotes(checklist.notes);
  $("#mentorNotes").value = "";
}

function renderMentorTrajectory() {
  const subtitle = $("#mentorTrajectorySubtitle");
  const container = $("#mentorTrajectoryProgress");
  if (!subtitle || !container) return;
  const person = currentProfile();
  if (!person || !canViewOwnMentorTrajectory()) {
    subtitle.textContent = "Geen actief mentor-traject.";
    container.innerHTML = '<div class="feed-item">Je zit op dit moment niet in een mentor-traject.</div>';
    return;
  }

  const checklist = mentorChecklistFor(person);
  subtitle.textContent = `${person.rank} - ${person.serviceNumber || "-"}`;
  container.innerHTML = renderMentorChecklistItems(checklist, true);
}

async function saveMentorChecklist(personId, patch = {}) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person || !canManageMentorOverview()) return false;
  const checklist = mentorChecklistFor(person);
  const body = {
    items: patch.items || checklist.items
  };
  if ("newNote" in patch) body.newNote = patch.newNote;
  return runAction(`/api/people/${encodeURIComponent(personId)}/mentor`, body);
}

async function fetchMentorTestSelf() {
  const response = await fetch("/api/mentor-tests/my");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Mentor-toets laden is mislukt.");
  mentorSelfTestCache = payload;
  return payload;
}

async function fetchMentorTestsOverview() {
  const response = await fetch("/api/mentor-tests");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Mentor-toetsen laden is mislukt.");
  mentorTestsReviewCache = payload;
  return payload;
}

function mentorTestDraftStorageKey(test = mentorSelfTestCache?.test) {
  const testId = test?.id || "";
  const profileId = currentProfile()?.id || authProfile?.id || "unknown";
  return testId ? `orp-${organizationKey}-mentor-test-draft-${profileId}-${testId}` : "";
}

function mentorTestAnswersFromDom({ trimText = false } = {}) {
  const answers = {};
  $$("[data-mentor-question]").forEach((input) => {
    const id = input.dataset.mentorQuestion;
    if (!id) return;
    if (input.type === "checkbox") {
      if (!answers[id]) answers[id] = [];
      if (input.checked) answers[id].push(input.value);
      return;
    }
    answers[id] = trimText ? input.value.trim() : input.value;
  });
  return answers;
}

function mentorTestAnswersHaveInput(answers = {}) {
  return Object.values(answers).some((answer) => (
    Array.isArray(answer)
      ? answer.length > 0
      : String(answer || "").trim().length > 0
  ));
}

function saveMentorTestDraft() {
  const form = $("[data-mentor-test-self-form]");
  const test = mentorSelfTestCache?.test;
  const key = mentorTestDraftStorageKey(test);
  if (!form || !test || !key || test.status !== "sent") return;
  const draft = {
    testId: test.id,
    personId: test.personId,
    answers: mentorTestAnswersFromDom(),
    savedAt: new Date().toISOString()
  };
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Conceptopslag is een vangnet; de toets zelf moet normaal blijven werken.
  }
}

function restoreMentorTestDraft(options = {}) {
  const form = $("[data-mentor-test-self-form]");
  const test = mentorSelfTestCache?.test;
  const key = mentorTestDraftStorageKey(test);
  if (!form || !test || !key || test.status !== "sent") return false;
  if (!options.force && form.dataset.mentorTestDraftRestored === "true" && mentorTestAnswersHaveInput(mentorTestAnswersFromDom())) return true;
  let raw = "";
  try {
    raw = localStorage.getItem(key) || "";
  } catch {
    form.dataset.mentorTestDraftRestored = "true";
    return false;
  }
  if (!raw) {
    form.dataset.mentorTestDraftRestored = "true";
    return false;
  }
  try {
    const draft = JSON.parse(raw);
    if (draft.testId !== test.id || draft.personId !== test.personId) return false;
    const answers = draft.answers || {};
    $$("[data-mentor-question]").forEach((input) => {
      const id = input.dataset.mentorQuestion;
      if (!id || !(id in answers)) return;
      if (input.type === "checkbox") {
        input.checked = Array.isArray(answers[id]) && answers[id].includes(input.value);
      } else {
        input.value = answers[id] || "";
      }
    });
    form.dataset.mentorTestDraftRestored = "true";
    return true;
  } catch {
    localStorage.removeItem(key);
    form.dataset.mentorTestDraftRestored = "true";
    return false;
  }
}

function clearMentorTestDraft(test = mentorSelfTestCache?.test) {
  const key = mentorTestDraftStorageKey(test);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch {
    // Als storage geblokkeerd is, is er niets server-kritisch om op te ruimen.
  }
}

function bindMentorTestDraftAutosave() {
  const form = $("[data-mentor-test-self-form]");
  if (!form || form.dataset.mentorTestDraftAutosave === "true") return;
  form.dataset.mentorTestDraftAutosave = "true";
  form.addEventListener("input", saveMentorTestDraft);
  form.addEventListener("change", saveMentorTestDraft);
}

function renderMentorQuestionInput(question, answers = {}) {
  const current = answers?.[question.id];
  if (question.type === "checkbox") {
    const selected = new Set(Array.isArray(current) ? current : []);
    return `
      <div class="mentor-test-options">
        ${(question.options || [])
          .map((option) => `
            <label class="mentor-test-option">
              <input type="checkbox" data-mentor-question="${escapeHtml(question.id)}" value="${escapeHtml(option)}" ${selected.has(option) ? "checked" : ""} />
              <span>${escapeHtml(option)}</span>
            </label>
          `)
          .join("")}
      </div>
    `;
  }
  return `<textarea data-mentor-question="${escapeHtml(question.id)}">${escapeHtml(String(current || ""))}</textarea>`;
}

function renderMentorTestPage() {
  const container = $("#mentorTestSelf");
  if (!container) return;
  if (!canViewOwnMentorTrajectory()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  if (mentorSelfTestCache === null) {
    container.innerHTML = '<div class="feed-item">Mentor-toets laden...</div>';
    fetchMentorTestSelf()
      .then(renderMentorTestPage)
      .catch((error) => {
        container.innerHTML = `<div class="feed-item">${escapeHtml(error.message || "Mentor-toets laden is mislukt.")}</div>`;
      });
    return;
  }

  const test = mentorSelfTestCache.test;
  if (!test) {
    const reason = mentorSelfTestCache.unavailableReason || "Er staat nog geen mentor-toets klaar.";
    const latestTest = mentorSelfTestCache.latestTest;
    container.innerHTML = `
      <div class="feed-item">
        <p>${escapeHtml(reason)}</p>
        ${latestTest?.status ? `<p class="muted">Laatste status: ${escapeHtml(mentorTestStatusLabel(latestTest.status))}.</p>` : ""}
      </div>
    `;
    return;
  }
  const questions = mentorSelfTestCache.questions || [];
  if (test.status === "submitted") {
    container.innerHTML = '<div class="feed-item">Je mentor-toets is ingediend. Mentor-Leiding beoordeelt je antwoorden.</div>';
    return;
  }
  if (test.status === "approved") {
    container.innerHTML = '<div class="feed-item">Je mentor-toets is goedgekeurd.</div>';
    return;
  }
  if (test.status === "rejected") {
    container.innerHTML = '<div class="feed-item">Je mentor-toets is afgekeurd. Mentor-Leiding kan een nieuwe poging klaarzetten.</div>';
    return;
  }

  container.innerHTML = `
    <form class="mentor-test-form" data-mentor-test-self-form>
      ${questions
        .map((question) => `
          <section class="mentor-test-question">
            <label>${escapeHtml(question.label)}</label>
            ${renderMentorQuestionInput(question, test.answers || {})}
          </section>
        `)
        .join("")}
      <div class="person-actions">
        <button class="primary" type="submit">Mentor-Toets indienen</button>
      </div>
    </form>
  `;
  restoreMentorTestDraft();
  bindMentorTestDraftAutosave();
}

async function submitOwnMentorTest() {
  saveMentorTestDraft();
  const submittedTest = mentorSelfTestCache?.test || null;
  const answers = mentorTestAnswersFromDom({ trimText: true });
  const response = await fetch("/api/mentor-tests/my/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers })
  }).catch(() => null);
  if (!response) {
    await showSiteNotice("Verbinding met de server mislukt.", "Mentor-Toets");
    return;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showSiteNotice(payload.error || "Mentor-Toets indienen is mislukt.", "Mentor-Toets");
    return;
  }
  clearMentorTestDraft(submittedTest);
  mentorSelfTestCache = payload;
  await showSiteNotice("Mentor-Toets ingediend.", "Mentor-Toets");
  renderMentorTestPage();
  mentorTestsReviewCache = null;
  renderMentorTestsOverview();
}

function mentorTestStatusLabel(status) {
  if (status === "sent") return "Verstuurd";
  if (status === "submitted") return "Ingediend";
  if (status === "approved") return "Goedgekeurd";
  if (status === "rejected") return "Afgekeurd";
  if (status === "cancelled") return "Vervangen";
  if (status === "retracted") return "Teruggetrokken";
  return status || "-";
}

function formatMentorTestAnswer(question, answers = {}) {
  const answer = answers?.[question.id];
  if (Array.isArray(answer)) return answer.length ? answer.join(", ") : "-";
  return String(answer || "-");
}

function mentorTestStatusClass(status) {
  if (status === "approved") return "is-approved";
  if (status === "submitted" || status === "sent") return "is-sent";
  if (status === "rejected") return "is-rejected";
  return "";
}

function mentorTestById(testId) {
  return (mentorTestsReviewCache?.tests || []).find((entry) => entry.id === testId) || null;
}

function renderMentorTestDetail(test) {
  const defaultQuestions = mentorTestsReviewCache?.questions || [];
  const questions = Array.isArray(test.questions) && test.questions.length ? test.questions : defaultQuestions;
  const canDeleteTest = test.status !== "approved";
  const reviewActions = test.status === "submitted"
    ? `
      <button class="primary" type="button" data-review-mentor-test="${escapeHtml(test.id)}" data-review-status="approved">Goedkeuren</button>
      <button class="danger" type="button" data-review-mentor-test="${escapeHtml(test.id)}" data-review-status="rejected">Afkeuren</button>
    `
    : "";
  const deleteAction = canDeleteTest
    ? `<button class="ghost danger" type="button" data-delete-mentor-test="${escapeHtml(test.id)}">Verwijderen</button>`
    : "";
  return `
    <div class="mentor-test-detail">
      <div class="mentor-test-card-header">
        <div>
          <strong>${escapeHtml(test.personName || "Onbekend")}</strong>
          <p>${escapeHtml(test.rank || "-")} - ${escapeHtml(test.serviceNumber || "-")}</p>
        </div>
        <span class="mentor-test-status ${mentorTestStatusClass(test.status)}">${escapeHtml(mentorTestStatusLabel(test.status))}</span>
      </div>
      <div class="mentor-test-meta">
        <span>Verstuurd: ${escapeHtml(formatDateTime(test.sentAt))}</span>
        ${test.submittedAt ? `<span>Ingediend: ${escapeHtml(formatDateTime(test.submittedAt))}</span>` : ""}
        ${test.reviewedAt ? `<span>Beoordeeld: ${escapeHtml(formatDateTime(test.reviewedAt))}</span>` : ""}
      </div>
      ${test.answers && Object.keys(test.answers).length
        ? `
          <div class="mentor-test-answers">
            ${questions
              .map((question) => `
                <div class="mentor-test-answer">
                  <strong>${escapeHtml(question.label)}</strong>
                  <p>${escapeHtml(formatMentorTestAnswer(question, test.answers))}</p>
                </div>
              `)
              .join("")}
          </div>
        `
        : '<p class="muted">Nog niet ingediend.</p>'}
      ${reviewActions || deleteAction
        ? `
          <div class="mentor-test-actions">
            ${reviewActions}
            ${deleteAction}
          </div>
        `
        : ""}
    </div>
  `;
}

function openMentorTestDetailDialog(testId) {
  const test = mentorTestById(testId);
  const dialog = $("#mentorTestDetailDialog");
  const body = $("#mentorTestDetailBody");
  if (!test || !dialog || !body) return;
  $("#mentorTestDetailTitle").textContent = `${test.personName || "Onbekend"} - ${mentorTestStatusLabel(test.status)}`;
  body.innerHTML = renderMentorTestDetail(test);
  dialog.showModal();
}

function renderMentorTestsOverview() {
  const container = $("#mentorTestsList");
  if (!container) return;
  const editButton = $("#editMentorTestTemplateBtn");
  if (editButton) editButton.hidden = !canManageMentorTestTemplate();
  if (!canViewMentorLeadershipLog()) {
    container.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  if (mentorTestsReviewCache === null) {
    container.innerHTML = '<div class="feed-item">Mentor-toetsen laden...</div>';
    fetchMentorTestsOverview()
      .then(renderMentorTestsOverview)
      .catch((error) => {
        container.innerHTML = `<div class="feed-item">${escapeHtml(error.message || "Mentor-toetsen laden is mislukt.")}</div>`;
      });
    return;
  }

  const tests = mentorTestsReviewCache.tests || [];
  container.innerHTML = tests.length
    ? `
      <div class="mentor-test-list">
        <div class="mentor-test-row mentor-test-row-head">
          <span>Naam</span>
          <span>Rang</span>
          <span>Dienstnummer</span>
          <span>Ingediend</span>
          <span>Status</span>
        </div>
        ${tests
          .map((test) => `
            <button class="mentor-test-row mentor-test-row-button" type="button" data-open-mentor-test-detail="${escapeHtml(test.id)}">
              <strong>${escapeHtml(test.personName || "Onbekend")}</strong>
              <span>${escapeHtml(test.rank || "-")}</span>
              <span>${escapeHtml(test.serviceNumber || "-")}</span>
              <span>${escapeHtml(test.submittedAt ? formatDateTime(test.submittedAt) : "-")}</span>
              <span class="mentor-test-status ${mentorTestStatusClass(test.status)}">${escapeHtml(mentorTestStatusLabel(test.status))}</span>
            </button>
          `)
          .join("")}
      </div>
    `
    : '<div class="feed-item">Geen mentor-toetsen gevonden.</div>';
}

async function reviewMentorTest(testId, status) {
  const approved = status === "approved";
  const confirmed = await showSiteConfirm(
    approved ? "Mentor-toets goedkeuren en mentor-traject afronden?" : "Mentor-toets afkeuren en nieuwe poging nodig maken?",
    approved ? "Mentor-Toets goedkeuren" : "Mentor-Toets afkeuren"
  );
  if (!confirmed) return false;
  const ok = await runAction(`/api/mentor-tests/${encodeURIComponent(testId)}/review`, { status });
  if (!ok) return false;
  mentorTestsReviewCache = null;
  mentorSelfTestCache = null;
  renderMentorOverview();
  renderMentorTrajectory();
  renderMentorTestPage();
  renderMentorTestsOverview();
  return true;
}

async function deleteMentorTest(testId) {
  const test = (mentorTestsReviewCache?.tests || []).find((entry) => entry.id === testId);
  const name = test?.personName || "deze medewerker";
  const confirmed = await showSiteConfirm(
    `Mentor-toets van ${name} verwijderen? Daarna moet de toets opnieuw worden klaargezet.`,
    "Mentor-Toets verwijderen"
  );
  if (!confirmed) return false;
  const ok = await runAction(`/api/mentor-tests/${encodeURIComponent(testId)}/delete`);
  if (!ok) return false;
  mentorTestsReviewCache = null;
  mentorSelfTestCache = null;
  renderMentorOverview();
  renderMentorTrajectory();
  renderMentorTestPage();
  renderMentorTestsOverview();
  return true;
}

async function sendMentorTest(personId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person) return;
  const confirmed = await showSiteConfirm(`Mentor-toets klaarzetten voor ${person.name}?`, "Mentor-Toets sturen");
  if (!confirmed) return;
  const ok = await runAction("/api/mentor-tests/send", { personId });
  if (!ok) return;
  refreshMentorTestViews();
}

function refreshMentorTestViews() {
  mentorTestsReviewCache = null;
  mentorSelfTestCache = null;
  renderMentorOverview();
  renderMentorTestsOverview();
}

function hideMentorTestContextMenu() {
  const menu = $("#mentorTestContextMenu");
  if (!menu) return;
  menu.hidden = true;
  pendingMentorTestPersonId = "";
}

function openMentorTestContextMenu(event, personId) {
  const menu = $("#mentorTestContextMenu");
  if (!menu || !personId || !canViewMentorLeadershipLog()) return;
  pendingMentorTestPersonId = personId;
  menu.hidden = false;
  const width = menu.offsetWidth || 240;
  const height = menu.offsetHeight || 120;
  const left = Math.min(event.clientX, window.innerWidth - width - 12);
  const top = Math.min(event.clientY, window.innerHeight - height - 12);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

async function resendMentorTest(personId = pendingMentorTestPersonId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person) return;
  const confirmed = await showSiteConfirm(`Mentor-toets opnieuw versturen naar ${person.name}?`, "Toets opnieuw versturen");
  if (!confirmed) return;
  const ok = await runAction("/api/mentor-tests/resend", { personId });
  if (!ok) return;
  refreshMentorTestViews();
}

async function retractMentorTest(personId = pendingMentorTestPersonId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person) return;
  const confirmed = await showSiteConfirm(`Mentor-toets van ${person.name} terugtrekken?`, "Toets terugtrekken");
  if (!confirmed) return;
  const ok = await runAction("/api/mentor-tests/retract", { personId });
  if (!ok) return;
  refreshMentorTestViews();
}

async function handleMentorTestContextAction(action) {
  const personId = pendingMentorTestPersonId;
  hideMentorTestContextMenu();
  if (action === "resend") await resendMentorTest(personId);
  if (action === "retract") await retractMentorTest(personId);
}

async function fetchMentorTestTemplate() {
  const response = await fetch("/api/mentor-tests/template");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Mentor-toets template laden is mislukt.");
  mentorTestTemplateCache = Array.isArray(payload.questions) ? payload.questions : [];
  return mentorTestTemplateCache;
}

function mentorTestTemplateDraftFromEditor() {
  return $$("#mentorTestTemplateEditor [data-mentor-test-question]")
    .map((row, index) => {
      const label = row.querySelector("[data-mentor-test-question-label]")?.value.trim() || "";
      const type = row.querySelector("[data-mentor-test-question-type]")?.value === "checkbox" ? "checkbox" : "textarea";
      const options = type === "checkbox"
        ? (row.querySelector("[data-mentor-test-question-options]")?.value || "")
            .split("\n")
            .map((value) => value.trim())
            .filter((value, optionIndex, list) => value && list.indexOf(value) === optionIndex)
        : [];
      if (!label) return null;
      return {
        id: row.dataset.mentorTestQuestionId || mentorItemId(label, `vraag-${index + 1}`),
        type,
        label,
        options
      };
    })
    .filter(Boolean);
}

function syncMentorTestTemplateOptions(row) {
  const isCheckbox = row.querySelector("[data-mentor-test-question-type]")?.value === "checkbox";
  const optionsWrap = row.querySelector("[data-mentor-test-options-wrap]");
  if (optionsWrap) optionsWrap.hidden = !isCheckbox;
}

function renderMentorTestTemplateEditor(questions = mentorTestTemplateCache || []) {
  const editor = $("#mentorTestTemplateEditor");
  if (!editor) return;
  const editable = questions.length
    ? questions
    : [{ id: "vraag-1", type: "textarea", label: "", options: [] }];
  editor.innerHTML = `
    ${editable
      .map((question, index) => `
        <section class="mentor-template-group" data-mentor-test-question data-mentor-test-question-id="${escapeHtml(question.id || `vraag-${index + 1}`)}">
          <div class="mentor-template-item-row">
            <strong>Vraag ${index + 1}</strong>
            <button class="ghost" type="button" data-remove-mentor-test-question>Verwijderen</button>
          </div>
          <label class="full">
            <span>Vraag</span>
            <textarea data-mentor-test-question-label rows="2">${escapeHtml(question.label || "")}</textarea>
          </label>
          <label>
            <span>Type</span>
            <select data-mentor-test-question-type>
              <option value="textarea" ${question.type === "checkbox" ? "" : "selected"}>Open tekst</option>
              <option value="checkbox" ${question.type === "checkbox" ? "selected" : ""}>Meerkeuze</option>
            </select>
          </label>
          <label class="full" data-mentor-test-options-wrap>
            <span>Meerkeuze-opties (1 per regel)</span>
            <textarea data-mentor-test-question-options rows="4">${escapeHtml((question.options || []).join("\n"))}</textarea>
          </label>
        </section>
      `)
      .join("")}
    <button class="ghost" type="button" data-add-mentor-test-question>Vraag toevoegen</button>
  `;
  $$("#mentorTestTemplateEditor [data-mentor-test-question]").forEach(syncMentorTestTemplateOptions);
}

async function openMentorTestTemplateDialog() {
  if (!canManageMentorTestTemplate()) return;
  try {
    if (mentorTestTemplateCache === null) await fetchMentorTestTemplate();
    renderMentorTestTemplateEditor();
    $("#mentorTestTemplateDialog")?.showModal();
  } catch (error) {
    await showSiteNotice(error.message || "Mentor-toets template laden is mislukt.", "Mentor-Toets");
  }
}

function handleMentorTestTemplateEditorClick(event) {
  if (event.target.closest("[data-add-mentor-test-question]")) {
    const questions = mentorTestTemplateDraftFromEditor();
    questions.push({ id: `vraag-${Date.now()}`, type: "textarea", label: "", options: [] });
    renderMentorTestTemplateEditor(questions);
    return;
  }
  const removeButton = event.target.closest("[data-remove-mentor-test-question]");
  if (!removeButton) return;
  const questions = mentorTestTemplateDraftFromEditor();
  const row = removeButton.closest("[data-mentor-test-question]");
  const rows = $$("#mentorTestTemplateEditor [data-mentor-test-question]");
  const index = rows.indexOf(row);
  if (index >= 0) questions.splice(index, 1);
  renderMentorTestTemplateEditor(questions.length ? questions : [{ id: "vraag-1", type: "textarea", label: "", options: [] }]);
}

function handleMentorTestTemplateEditorChange(event) {
  const row = event.target.closest("[data-mentor-test-question]");
  if (row && event.target.closest("[data-mentor-test-question-type]")) {
    syncMentorTestTemplateOptions(row);
  }
}

async function saveMentorTestTemplate() {
  if (!canManageMentorTestTemplate()) return;
  const questions = mentorTestTemplateDraftFromEditor();
  if (!questions.length) {
    await showSiteNotice("Laat minimaal een toetsvraag staan.", "Toets leeg");
    return;
  }
  const checkboxWithoutOptions = questions.find((question) => question.type === "checkbox" && !question.options.length);
  if (checkboxWithoutOptions) {
    await showSiteNotice("Vul bij elke meerkeuzevraag minimaal 1 antwoordoptie in.", "Meerkeuzevraag incompleet");
    return;
  }
  const response = await fetch("/api/mentor-tests/template", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ questions })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await showSiteNotice(payload.error || "Mentor-toets opslaan is mislukt.", "Actie mislukt");
    return;
  }
  mentorTestTemplateCache = Array.isArray(payload.questions) ? payload.questions : questions;
  mentorTestsReviewCache = null;
  mentorSelfTestCache = null;
  $("#mentorTestTemplateDialog")?.close();
  await showSiteNotice("Mentor-toets is opgeslagen.", "Opgeslagen");
  renderMentorTestsOverview();
  renderMentorTestPage();
}

function mentorTemplateDraftGroupsFromEditor() {
  return $$("#mentorTemplateEditor [data-template-group]").map((groupElement, groupIndex) => ({
    id: groupElement.dataset.templateGroupId || `groep-${groupIndex + 1}`,
    title: groupElement.querySelector("[data-template-group-title]")?.value.trim() || `Groep ${groupIndex + 1}`,
    items: [...groupElement.querySelectorAll("[data-template-item]")].map((row, itemIndex) => ({
      id: row.dataset.templateItemId || mentorItemId(row.querySelector("[data-template-item-label]")?.value, `regel-${groupIndex + 1}-${itemIndex + 1}`),
      label: row.querySelector("[data-template-item-label]")?.value.trim() || ""
    })).filter((item) => item.label)
  })).filter((group) => group.items.length);
}

function renderMentorTemplateEditor(groups = activeMentorChecklistGroups()) {
  const editor = $("#mentorTemplateEditor");
  if (!editor) return;
  editor.innerHTML = groups
    .map((group, groupIndex) => `
      <section class="mentor-template-group" data-template-group data-template-group-id="${escapeHtml(group.id || `groep-${groupIndex + 1}`)}">
        <label class="full">
          <span>Groep</span>
          <input type="text" data-template-group-title value="${escapeHtml(group.title)}" />
        </label>
        <div class="mentor-template-items">
          ${group.items
            .map((item) => `
              <div class="mentor-template-item-row" data-template-item data-template-item-id="${escapeHtml(item.id)}">
                <input type="text" data-template-item-label value="${escapeHtml(item.label)}" />
                <button class="ghost" type="button" data-remove-template-item>Verwijderen</button>
              </div>
            `)
            .join("")}
        </div>
        <button class="ghost" type="button" data-add-template-item>Regel toevoegen</button>
      </section>
    `)
    .join("");
}

function openMentorTemplateDialog() {
  if (!canManageMentorChecklistTemplate()) return;
  renderMentorTemplateEditor();
  $("#mentorTemplateDialog")?.showModal();
}

function periodStartDate(period) {
  const now = new Date();
  const start = new Date(now);
  if (period === "week") {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
  } else if (period === "month") {
    start.setDate(start.getDate() - 30);
  } else if (period === "quarter") {
    start.setDate(start.getDate() - 90);
  } else {
    start.setDate(start.getDate() - 180);
  }
  start.setHours(0, 0, 0, 0);
  return start;
}

function inLeadershipPeriod(dateValue, period) {
  if (period === "all") return true;
  const date = new Date(dateValue || 0);
  if (Number.isNaN(date.getTime())) return false;
  return date >= periodStartDate(period);
}

function mentorLogRowsForPerson(person, period = "halfyear") {
  return (state.people || [])
    .flatMap((trainee) => {
      const checklist = mentorChecklistFor(trainee);
      return checklist.notes.map((note) => ({ ...note, trainee }));
    })
    .filter((note) => (note.authorId && note.authorId === person.id) || (!note.authorId && note.authorName === person.name))
    .filter((note) => inLeadershipPeriod(note.createdAt, period))
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function isMentorLogPersonCurrent(person) {
  return typeof isCurrentProfile === "function" ? isCurrentProfile(person) : person.status === "Actief";
}

function mentorLogPeople() {
  return (state.people || [])
    .filter(isMentorLogPersonCurrent)
    .filter((person) => (person.badges || []).some((badge) => ["Mentor", "Mentor-Leiding"].includes(badge)))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "nl"));
}

function renderMentorLeadershipLog() {
  const list = $("#mentorLeadershipLogList");
  if (!list) return;
  if (!canViewMentorLeadershipLog()) {
    list.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const people = mentorLogPeople();
  list.innerHTML = people.length
    ? `
      <div class="leadership-row leadership-row-head">
        <span>Naam</span>
        <span>Rang</span>
        <span>Koppeldiensten</span>
      </div>
      ${people
        .map((person) => `
          <button class="leadership-row leadership-row-button" type="button" data-mentor-log-person="${escapeHtml(person.id)}">
            <strong>${escapeHtml(person.name)}</strong>
            <span>${escapeHtml(person.rank || "-")}</span>
            <span class="rank-count"><span>${mentorLogRowsForPerson(person, "all").length}</span></span>
          </button>
        `)
        .join("")}
    `
    : '<div class="feed-item">Geen mentoren gevonden.</div>';
}

function openMentorLogDetail(personId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person || !canViewMentorLeadershipLog()) return;
  mentorLogDetailContext = { personId };
  $("#leadershipLogTitle").textContent = `Mentor-log ${person.name}`;
  $("#leadershipLogSubtitle").textContent = `${person.rank || "-"} - ${person.serviceNumber || "-"}`;
  $("#leadershipLogPeriod").value = "week";
  renderMentorLogDetailRows();
  $("#leadershipLogDialog").showModal();
}

function renderMentorLogDetailRows() {
  if (!mentorLogDetailContext) return;
  const person = state.people.find((entry) => entry.id === mentorLogDetailContext.personId);
  const list = $("#leadershipLogRows");
  if (!person || !list) return;
  const period = $("#leadershipLogPeriod")?.value || "week";
  const rows = mentorLogRowsForPerson(person, period);
  list.innerHTML = rows.length
    ? rows.map((row) => `
      <article class="leadership-detail-row">
        <strong>${escapeHtml(row.trainee?.name || "Onbekend")}</strong>
        <span>${escapeHtml(formatDateTime(row.createdAt))} - ${escapeHtml(leadershipPeriodLabels[period])}</span>
        <p>${escapeHtml(row.text || "-")}</p>
      </article>
    `).join("")
    : '<div class="feed-item">Geen koppeldiensten gevonden voor deze periode.</div>';
}

window.DefensiePortalModules.registerFeature("mentor", { ready: true });
