/* Defensie Personeelsportaal mentormodule: mentoroverzicht, checklist, traject en mentor-notities. */

let mentorLogDetailContext = null;
let mentorAuditDetailPersonId = "";
let mentorSelfTestCache = null;
let mentorTestsReviewCache = null;
const leadershipPeriodLabels = {
  week: "Afgelopen week",
  month: "Afgelopen maand",
  quarter: "Afgelopen 3 maanden",
  halfyear: "Afgelopen 6 maanden"
};

function resetMentorTestCaches() {
  mentorSelfTestCache = null;
  mentorTestsReviewCache = null;
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

function mentorChecklistFor(person) {
  const checklist = person.mentorChecklist || {};
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
    checked: checklist.completed ? true : (checkedById.has(item.id) ? checkedById.get(item.id) : Boolean(legacyByIndex[index]))
  }));
  const allItemsCompleted = normalizedItems.length > 0 && normalizedItems.every((item) => item.checked);
  const testSent = Boolean(checklist.testSent);
  const testApproved = Boolean(checklist.testApproved);
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
            <div class="mentor-row mentor-row-button" role="button" tabindex="0" data-open-mentor="${person.id}">
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

async function saveMentorChecklistItemsFromDom() {
  if (!selectedMentorProfileId || !canManageMentorOverview()) return false;
  const items = mentorChecklistItemsFromDom();
  const person = state.people.find((entry) => entry.id === selectedMentorProfileId);
  if (person) {
    const existing = mentorChecklistFor(person);
    const allItemsCompleted = items.length > 0 && items.every((item) => item.checked);
    person.mentorChecklist = {
      ...(person.mentorChecklist || {}),
      items,
      testSent: allItemsCompleted ? existing.testSent : false,
      testApproved: allItemsCompleted && existing.testSent ? existing.testApproved : false
    };
  }
  const saved = await saveMentorChecklist(selectedMentorProfileId, { items });
  if (saved) {
    renderMentorOverview();
    renderMentorTrajectory();
  }
  return saved;
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
    container.innerHTML = '<div class="feed-item">Er staat nog geen mentor-toets klaar.</div>';
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
}

async function submitOwnMentorTest() {
  const answers = {};
  $$("[data-mentor-question]").forEach((input) => {
    const id = input.dataset.mentorQuestion;
    if (!id) return;
    if (input.type === "checkbox") {
      if (!answers[id]) answers[id] = [];
      if (input.checked) answers[id].push(input.value);
      return;
    }
    answers[id] = input.value.trim();
  });
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
  return status || "-";
}

function formatMentorTestAnswer(question, answers = {}) {
  const answer = answers?.[question.id];
  if (Array.isArray(answer)) return answer.length ? answer.join(", ") : "-";
  return String(answer || "-");
}

function renderMentorTestsOverview() {
  const container = $("#mentorTestsList");
  if (!container) return;
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
  const defaultQuestions = mentorTestsReviewCache.questions || [];
  container.innerHTML = tests.length
    ? `
      <div class="mentor-test-cards">
        ${tests
          .map((test) => {
            const questions = Array.isArray(test.questions) && test.questions.length ? test.questions : defaultQuestions;
            return `
              <article class="mentor-test-card">
                <div class="mentor-test-card-header">
                  <div>
                    <strong>${escapeHtml(test.personName || "Onbekend")}</strong>
                    <p>${escapeHtml(test.rank || "-")} - ${escapeHtml(test.serviceNumber || "-")}</p>
                  </div>
                  <span class="mentor-test-status ${test.status === "approved" ? "is-approved" : test.status === "submitted" || test.status === "sent" ? "is-sent" : ""}">${escapeHtml(mentorTestStatusLabel(test.status))}</span>
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
                ${test.status === "submitted"
                  ? `
                    <div class="mentor-test-actions">
                      <button class="primary small" type="button" data-review-mentor-test="${escapeHtml(test.id)}" data-review-status="approved">Goedkeuren</button>
                      <button class="danger small" type="button" data-review-mentor-test="${escapeHtml(test.id)}" data-review-status="rejected">Afkeuren</button>
                    </div>
                  `
                  : ""}
              </article>
            `;
          })
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
  if (!confirmed) return;
  const ok = await runAction(`/api/mentor-tests/${encodeURIComponent(testId)}/review`, { status });
  if (!ok) return;
  mentorTestsReviewCache = null;
  mentorSelfTestCache = null;
  renderMentorOverview();
  renderMentorTrajectory();
  renderMentorTestPage();
  renderMentorTestsOverview();
}

async function sendMentorTest(personId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person) return;
  const confirmed = await showSiteConfirm(`Mentor-toets klaarzetten voor ${person.name}?`, "Mentor-Toets sturen");
  if (!confirmed) return;
  const ok = await runAction("/api/mentor-tests/send", { personId });
  if (!ok) return;
  mentorTestsReviewCache = null;
  mentorSelfTestCache = null;
  renderMentorOverview();
  renderMentorTestsOverview();
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

function mentorLogPeople() {
  return (state.people || [])
    .filter((person) => person.status === "Actief")
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
