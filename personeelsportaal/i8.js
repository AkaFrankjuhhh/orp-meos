/* Defensie Personeelsportaal I8-module: eigen I8 formulieren, controle en archief. */

let i8ArchiveStatusFilter = "all";
let ovjLogDetailContext = null;
let pendingI8ArchiveRouteNumber = "";
const I8_DRAFT_FIELDS = [
  "i8Date",
  "i8Time",
  "i8Location",
  "i8OpcoOvd",
  "i8Description",
  "i8ForceUsed",
  "i8Vehicle",
  "i8Injury",
  "i8Truth"
];
const I8_DRAFT_DEFAULT_ONLY_FIELDS = new Set(["i8Date"]);

function canViewOvJLeadershipLog() {
  return Boolean(permissions.canViewOvJLeadershipLog || hasKaderAccess());
}

function i8StatusLabel(status) {
  return {
    pending: "In afwachting",
    in_review: "In behandeling",
    approved: "Goedgekeurd",
    rejected: "Afgekeurd"
  }[status || "pending"] || "In afwachting";
}

function i8StatusClass(status) {
  return {
    pending: "pending",
    in_review: "in-review",
    approved: "approved",
    rejected: "rejected"
  }[status || "pending"] || "pending";
}

function setI8Tab(tab) {
  activeI8Tab = tab === "create" ? "create" : "list";
  $$('[data-i8-tab]').forEach((button) => button.classList.toggle("active", button.dataset.i8Tab === activeI8Tab));
  $("#i8OwnPanel")?.classList.toggle("active", activeI8Tab === "list");
  $("#i8CreatePanel")?.classList.toggle("active", activeI8Tab === "create");
  if (activeI8Tab === "create" && $("#i8Name")) $("#i8Name").value = currentMemberName();
}

function currentMemberName() {
  return currentProfile()?.name || authProfile?.name || "-";
}

function i8DraftStorageKey() {
  const profileId = currentProfile()?.id || authProfile?.id || "unknown";
  return `orp-${organizationKey}-i8-draft-${profileId}`;
}

function i8FieldHasUserInput(fieldId) {
  const field = $(`#${fieldId}`);
  if (!field) return false;
  if (field.type === "checkbox") return field.checked;
  const value = String(field.value || "").trim();
  if (!value) return false;
  if (I8_DRAFT_DEFAULT_ONLY_FIELDS.has(fieldId)) return value !== today;
  return true;
}

function i8FormHasUserInput() {
  return I8_DRAFT_FIELDS.some((fieldId) => {
    return i8FieldHasUserInput(fieldId);
  });
}

function saveI8Draft() {
  const form = $("#i8Form");
  if (!form) return;
  const draft = {};
  I8_DRAFT_FIELDS.forEach((fieldId) => {
    const field = $(`#${fieldId}`);
    if (!field) return;
    draft[fieldId] = field.type === "checkbox" ? Boolean(field.checked) : field.value;
  });
  draft.savedAt = new Date().toISOString();
  try {
    localStorage.setItem(i8DraftStorageKey(), JSON.stringify(draft));
  } catch {
    // Draft opslaan is een vangnet; formulierinvoer zelf mag nooit stuklopen.
  }
}

function restoreI8Draft(options = {}) {
  const form = $("#i8Form");
  if (!form) return false;
  $("#i8Name").value = currentMemberName();
  const raw = localStorage.getItem(i8DraftStorageKey());
  if (!raw) {
    if (!$("#i8Date").value) $("#i8Date").value = today;
    form.dataset.i8DraftRestored = "true";
    return false;
  }
  if (!options.force && form.dataset.i8DraftRestored === "true" && i8FormHasUserInput()) return true;
  if (!options.force && form.dataset.i8DraftRestored !== "true" && i8FormHasUserInput()) return true;
  try {
    const draft = JSON.parse(raw);
    I8_DRAFT_FIELDS.forEach((fieldId) => {
      const field = $(`#${fieldId}`);
      if (!field || !(fieldId in draft)) return;
      if (field.type === "checkbox") {
        field.checked = Boolean(draft[fieldId]);
      } else {
        field.value = draft[fieldId] || "";
      }
    });
    if (!$("#i8Date").value) $("#i8Date").value = today;
    form.dataset.i8DraftRestored = "true";
    return true;
  } catch {
    localStorage.removeItem(i8DraftStorageKey());
    if (!$("#i8Date").value) $("#i8Date").value = today;
    form.dataset.i8DraftRestored = "true";
    return false;
  }
}

function clearI8Draft() {
  try {
    localStorage.removeItem(i8DraftStorageKey());
  } catch {
    // Als storage geblokkeerd is, kan het formulier nog steeds normaal werken.
  }
}

function bindI8DraftAutosave() {
  const form = $("#i8Form");
  if (!form || form.dataset.i8DraftAutosave === "true") return;
  form.dataset.i8DraftAutosave = "true";
  form.addEventListener("input", saveI8Draft);
  form.addEventListener("change", saveI8Draft);
}

function resetI8Form(options = {}) {
  const form = $("#i8Form");
  if (!form) return;
  if (options.clearDraft !== false) clearI8Draft();
  form.reset();
  $("#i8Name").value = currentMemberName();
  $("#i8Date").value = today;
  form.dataset.i8DraftRestored = "true";
}

function i8NumberFor(form, forms = state.i8Forms || []) {
  if (form?.i8Number) return String(form.i8Number).padStart(3, "0");
  const ordered = forms
    .slice()
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const index = ordered.findIndex((entry) => entry.id === form.id);
  return String(index >= 0 ? index + 1 : ordered.length + 1).padStart(3, "0");
}

function normalizeI8RouteNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits ? digits.padStart(3, "0") : "";
}

function i8FormByNumber(value) {
  const number = normalizeI8RouteNumber(value);
  if (!number) return null;
  const forms = state.i8Forms || [];
  return forms.find((form) => i8NumberFor(form, forms) === number) || null;
}

function i8DateTime(form) {
  const date = formatDate(form.violenceDate);
  const time = form.violenceTime || "-";
  return `${date} ${time}`;
}

function canChangeI8Status(form) {
  if (!form || !canViewOvJChannels()) return false;
  if (!canReviewI8Forms()) return false;
  if (canOverrideI8Forms()) return true;
  const current = currentProfile();
  const status = form.status || "pending";
  if (status === "pending") return true;
  if (status === "in_review") return Boolean(current && form.reviewedById === current.id);
  return false;
}

function allowedI8StatusActions(form) {
  if (!canChangeI8Status(form)) return [];
  const currentStatus = form.status || "pending";
  const isLead = canOverrideI8Forms();
  const actions = [
    { status: "in_review", label: "In behandeling plaatsen", className: "ghost small in-review" },
    { status: "approved", label: "Goedkeuren", className: "ghost small approve" },
    { status: "rejected", label: "Afkeuren", className: "ghost small danger" }
  ];
  if (isLead) return actions.filter((action) => action.status !== currentStatus);
  if (currentStatus === "pending") return actions.filter((action) => action.status === "in_review");
  if (currentStatus === "in_review") return actions.filter((action) => ["approved", "rejected"].includes(action.status));
  return [];
}

function renderI8StatusActions(form) {
  const currentStatus = form.status || "pending";
  const actions = allowedI8StatusActions(form);
  if (!actions.length) {
    if (currentStatus === "in_review" && form.reviewedByName) {
      return `<div class="i8-lock-note">In behandeling door ${escapeHtml(form.reviewedByName)}. Alleen OVJ, Interne-Zaken of Kader kan dit overrulen.</div>`;
    }
    return "";
  }
  return `
    <div class="person-actions i8-actions i8-detail-actions">
      ${actions
        .map((action) => `<button class="${action.className}" type="button" data-i8-detail-status="${action.status}">${action.label}</button>`)
        .join("")}
    </div>
  `;
}
function renderI8ReviewRow(form, forms) {
  return `
    <article class="i8-compact-row" data-i8-open="${escapeHtml(form.id)}" role="button" tabindex="0">
      <span class="i8-number">${escapeHtml(i8NumberFor(form, forms))}</span>
      <div class="i8-compact-main">
        <strong>${escapeHtml(form.rank || "-")} - ${escapeHtml(form.personName || memberName(form.personId))}</strong>
        <span>${escapeHtml(form.location || "-")} - ${escapeHtml(i8DateTime(form))}</span>
        ${(form.status || "pending") === "in_review" ? `<span class="i8-inline-note">In behandeling door ${escapeHtml(form.reviewedByName || "-")}</span>` : ""}
      </div>
    </article>
  `;
}

function renderI8OwnRow(form, forms) {
  return `
    <article class="i8-archive-row" data-i8-open="${escapeHtml(form.id)}" role="button" tabindex="0">
      <div class="i8-archive-top">
        <span class="i8-number">${escapeHtml(i8NumberFor(form, forms))}</span>
        <div>
          <strong>${escapeHtml(form.rank || "-")} - ${escapeHtml(form.personName || memberName(form.personId))}</strong>
          <span>${escapeHtml(form.location || "-")} - ${escapeHtml(i8DateTime(form))}</span>
        </div>
        <span class="i8-status ${i8StatusClass(form.status)}">${escapeHtml(i8StatusLabel(form.status))}</span>
      </div>
      <div class="i8-review-meta">${renderI8StatusMeta(form)}</div>
    </article>
  `;
}

function i8NumberValue(form, forms = state.i8Forms || []) {
  return Number(i8NumberFor(form, forms)) || 0;
}

function i8ArchiveMatchesQuery(form, forms, query) {
  if (!query) return true;
  const haystack = [
    i8NumberFor(form, forms),
    form.rank,
    form.personName || memberName(form.personId),
    form.location,
    form.violenceDate,
    form.violenceTime,
    i8StatusLabel(form.status),
    form.reviewedByName
  ].join(" ").toLowerCase();
  return haystack.includes(query);
}

function renderI8ArchiveRow(form, forms) {
  return `
    <article class="i8-archive-row" data-i8-open="${escapeHtml(form.id)}" role="button" tabindex="0">
      <div class="i8-archive-top">
        <span class="i8-number">${escapeHtml(i8NumberFor(form, forms))}</span>
        <div>
          <strong>${escapeHtml(form.rank || "-")} - ${escapeHtml(form.personName || memberName(form.personId))}</strong>
          <span>${escapeHtml(form.location || "-")} - ${escapeHtml(i8DateTime(form))}</span>
        </div>
        <span class="i8-status ${i8StatusClass(form.status)}">${escapeHtml(i8StatusLabel(form.status))}</span>
      </div>
      <div class="i8-review-meta">${renderI8StatusMeta(form)}</div>
    </article>
  `;
}

function renderI8DetailField(label, value) {
  return `<span><b>${escapeHtml(label)}</b>${escapeHtml(value || "-")}</span>`;
}

function syncI8ArchiveDetailRoute(form, mode = "push") {
  if (!form || activePageId() !== "i8-archief") return;
  const number = i8NumberFor(form, state.i8Forms || []);
  const nextPath = `/i8-archief/${number}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === nextPath) return;
  window.history[mode === "replace" ? "replaceState" : "pushState"]({ page: "i8-archief", i8Number: number }, "", nextPath);
}

function restoreI8ArchiveRoute(mode = "push") {
  const currentPath = window.location.pathname.replace(/\/+$/, "");
  if (!/^\/i8-archief\/[^/]+$/i.test(currentPath)) return;
  window.history[mode === "replace" ? "replaceState" : "pushState"]({ page: "i8-archief" }, "", "/i8-archief");
}

function closeI8DetailDialog(options = {}) {
  $("#i8DetailDialog")?.close();
  if (options.restoreRoute !== false) restoreI8ArchiveRoute("push");
}

function openI8DetailDialog(formId, options = {}) {
  const forms = state.i8Forms || [];
  const form = forms.find((entry) => entry.id === formId);
  if (!form) return;
  $("#i8DetailTitle").textContent = `I8 formulier ${i8NumberFor(form, forms)}`;
  $("#i8DetailBody").innerHTML = `
    <div data-i8-detail-form="${escapeHtml(form.id)}" class="i8-detail-content">
      <div class="i8-card-head">
        <div>
          <strong>${escapeHtml(form.rank || "-")} - ${escapeHtml(form.personName || memberName(form.personId))}</strong>
          <span>${escapeHtml(i8DateTime(form))}</span>
        </div>
        <span class="i8-status ${i8StatusClass(form.status)}">${escapeHtml(i8StatusLabel(form.status))}</span>
      </div>
      <div class="i8-card-grid">
        ${renderI8DetailField("Locatie", form.location)}
        ${renderI8DetailField("OPS - OVD/OPCO", form.opcoOvdName)}
        ${renderI8DetailField("Geweldsmiddel", form.forceUsed)}
        ${renderI8DetailField("Voertuig", form.vehicleViolence)}
        ${renderI8DetailField("Letsel derden", form.thirdPartyInjury)}
        ${renderI8DetailField("Ingediend", formatDateTime(form.createdAt))}
      </div>
      <div class="i8-description">
        <b>Beschrijving</b>
        <p>${escapeHtml(form.description || "-")}</p>
      </div>
      ${(form.status || "pending") === "rejected" ? `
        <div class="i8-description i8-rejection-reason">
          <b>Reden afkeuring</b>
          <p>${escapeHtml(form.rejectionReason || "Geen reden opgegeven.")}</p>
        </div>` : ""}
      <div class="i8-review-meta">${renderI8StatusMeta(form)}</div>
      ${renderI8StatusActions(form)}
    </div>
  `;
  $("#i8DetailDialog").showModal();
  if (options.syncArchiveUrl) syncI8ArchiveDetailRoute(form, options.routeMode || "push");
}

async function openI8ArchiveNumberFromRoute(value) {
  const number = normalizeI8RouteNumber(value);
  if (!number) return false;
  if (!canViewOvJChannels()) return false;
  const form = i8FormByNumber(number);
  if (!form || !["approved", "rejected"].includes(form.status)) {
    await showSiteNotice(`I8 ${number} is niet gevonden in het archief.`, "I8 niet gevonden");
    return false;
  }
  openI8DetailDialog(form.id, { syncArchiveUrl: false });
  return true;
}

function handleI8ArchiveRoute(route) {
  const number = route?.page === "i8-archief" ? normalizeI8RouteNumber(route.i8Number) : "";
  pendingI8ArchiveRouteNumber = number;
  if (!number) {
    if ($("#i8DetailDialog")?.open && route?.page === "i8-archief") {
      $("#i8DetailDialog").close();
    }
    return;
  }
  if (!canViewOvJChannels()) {
    showSiteNotice("Geen toegang tot dit I8 formulier.", "Geen toegang");
    return;
  }
  openI8ArchiveNumberFromRoute(number).then((opened) => {
    if (opened && pendingI8ArchiveRouteNumber === number) pendingI8ArchiveRouteNumber = "";
  });
}

function openI8DetailFromEvent(event) {
  if (event.target.closest("button")) return;
  const row = event.target.closest("[data-i8-open]");
  if (!row) return;
  openI8DetailDialog(row.dataset.i8Open, { syncArchiveUrl: Boolean(row.closest("#i8ArchiveList")) });
}

function hideI8ArchiveContextMenu() {
  const menu = $("#i8ArchiveContextMenu");
  if (!menu) return;
  menu.hidden = true;
  pendingI8ArchiveDeleteId = "";
}

function openI8ArchiveContextMenu(event, formId) {
  if (!formId || !hasKaderAccess()) return;
  pendingI8ArchiveDeleteId = formId;
  const menu = $("#i8ArchiveContextMenu");
  if (!menu) return;
  menu.hidden = false;
  const width = menu.offsetWidth || 190;
  const height = menu.offsetHeight || 52;
  const left = Math.min(event.clientX, window.innerWidth - width - 8);
  const top = Math.min(event.clientY, window.innerHeight - height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function renderI8StatusMeta(form) {
  if (!form.reviewedByName) return "Nog niet beoordeeld.";
  const prefix = (form.status || "pending") === "in_review" ? "In behandeling door" : "Ondertekend door";
  return `${prefix}: ${escapeHtml(form.reviewedByName)} op ${escapeHtml(formatDateTime(form.reviewedAt))}`;
}

function setI8ArchiveStatusFilter(value) {
  i8ArchiveStatusFilter = ["approved", "all", "rejected"].includes(value) ? value : "all";
  $$('[data-i8-archive-status]').forEach((button) => button.classList.toggle("active", button.dataset.i8ArchiveStatus === i8ArchiveStatusFilter));
  renderI8Forms();
}

function renderI8Forms() {
  const current = currentProfile();
  const ownList = $("#i8OwnList");
  const ownSummary = $("#i8OwnSummary");
  const reviewList = $("#i8ReviewList");
  const archiveList = $("#i8ArchiveList");
  if ($("#i8Name")) $("#i8Name").value = currentMemberName();
  bindI8DraftAutosave();
  restoreI8Draft();
  setI8Tab(activeI8Tab);
  $$('[data-i8-archive-status]').forEach((button) => button.classList.toggle("active", button.dataset.i8ArchiveStatus === i8ArchiveStatusFilter));

  const forms = Array.isArray(state.i8Forms) ? state.i8Forms : [];
  if (ownList) {
    const ownForms = forms
      .filter((form) => current && form.personId === current.id)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (ownSummary) {
      ownSummary.innerHTML = `
        <span>Totaal aantal eigen I8's</span>
        <strong>${escapeHtml(String(ownForms.length))}</strong>
      `;
    }
    ownList.innerHTML = ownForms.length
      ? ownForms.map((form) => renderI8OwnRow(form, forms)).join("")
      : '<div class="feed-item">Je hebt nog geen I8 formulieren ingediend.</div>';
  }

  if (reviewList) {
    if (!canViewOvJChannels()) {
      reviewList.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    } else {
      const reviewForms = forms
        .filter((form) => ["pending", "in_review"].includes(form.status || "pending"))
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
      reviewList.innerHTML = reviewForms.length
        ? reviewForms.map((form) => renderI8ReviewRow(form, forms)).join("")
        : '<div class="feed-item">Geen openstaande I8 formulieren om te controleren.</div>';
    }
  }

  if (archiveList) {
    if (!canViewOvJChannels()) {
      archiveList.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    } else {
      const archiveQuery = $("#i8ArchiveSearchInput")?.value.toLowerCase().trim() || "";
      const archivedForms = forms
        .filter((form) => ["approved", "rejected"].includes(form.status))
        .filter((form) => i8ArchiveStatusFilter === "all" || form.status === i8ArchiveStatusFilter)
        .filter((form) => i8ArchiveMatchesQuery(form, forms, archiveQuery))
        .sort((a, b) => i8NumberValue(b, forms) - i8NumberValue(a, forms));
      archiveList.innerHTML = archivedForms.length
        ? archivedForms.map((form) => renderI8ArchiveRow(form, forms)).join("")
        : '<div class="feed-item">Geen gekeurde I8 formulieren in het archief.</div>';
    }
  }
  if (pendingI8ArchiveRouteNumber && canViewOvJChannels()) {
    const number = pendingI8ArchiveRouteNumber;
    openI8ArchiveNumberFromRoute(number).then((opened) => {
      if (opened && pendingI8ArchiveRouteNumber === number) pendingI8ArchiveRouteNumber = "";
    });
  }
}

function openI8ReviewDialog(formId, status) {
  const form = (state.i8Forms || []).find((entry) => entry.id === formId);
  if (!form || !canViewOvJChannels()) return;
  pendingI8ReviewAction = { formId, status };
  const labels = {
    in_review: { title: "I8 in behandeling", action: "in behandeling plaatsen", button: "In behandeling", className: "primary in-review" },
    approved: { title: "I8 goedkeuren", action: "goedkeuren", button: "Goedkeuren", className: "primary approve" },
    rejected: { title: "I8 afkeuren", action: "afkeuren", button: "Afkeuren", className: "primary danger" }
  };
  const config = labels[status] || labels.in_review;
  const button = $("#confirmI8ReviewDialog");
  $("#i8ReviewFormId").value = formId;
  $("#i8ReviewStatus").value = status;
  $("#i8ReviewTitle").textContent = config.title;
  $("#i8ReviewText").textContent = `Weet je zeker dat je het I8 formulier van ${form.personName || memberName(form.personId)} wil ${config.action}?`;
  const reasonField = $("#i8RejectReasonField");
  const reasonInput = $("#i8RejectReason");
  if (reasonField && reasonInput) {
    reasonField.hidden = status !== "rejected";
    reasonInput.required = status === "rejected";
    reasonInput.value = "";
  }
  button.textContent = config.button;
  button.className = config.className;
  $("#i8ReviewDialog").showModal();
  if (status === "rejected") reasonInput?.focus();
}

function reviewedI8FormsForPerson(person, period = "halfyear") {
  return (state.i8Forms || [])
    .filter((form) => ["approved", "rejected"].includes(form.status))
    .filter((form) => (form.reviewedById && form.reviewedById === person.id) || (!form.reviewedById && form.reviewedByName === person.name))
    .filter((form) => inLeadershipPeriod(form.reviewedAt, period))
    .sort((a, b) => new Date(b.reviewedAt || 0) - new Date(a.reviewedAt || 0));
}

function ovjLogPeople() {
  return (state.people || [])
    .filter((person) => person.status === "Actief")
    .filter((person) => (person.badges || []).some((badge) => ["OvJ", "hOvJ"].includes(badge)))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "nl"));
}

function renderOvJLeadershipLog() {
  const list = $("#ovjLeadershipLogList");
  if (!list) return;
  if (!canViewOvJLeadershipLog()) {
    list.innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const people = ovjLogPeople();
  list.innerHTML = people.length
    ? `
      <div class="leadership-row leadership-row-head">
        <span>Naam</span>
        <span>Rang</span>
        <span>Gekeurde I8</span>
      </div>
      ${people
        .map((person) => `
          <button class="leadership-row leadership-row-button" type="button" data-ovj-log-person="${escapeHtml(person.id)}">
            <strong>${escapeHtml(person.name)}</strong>
            <span>${escapeHtml(person.rank || "-")}</span>
            <span class="rank-count"><span>${reviewedI8FormsForPerson(person, "all").length}</span></span>
          </button>
        `)
        .join("")}
    `
    : '<div class="feed-item">Geen OvJ/hOvJ medewerkers gevonden.</div>';
}

function openOvJLogDetail(personId) {
  const person = state.people.find((entry) => entry.id === personId);
  if (!person || !canViewOvJLeadershipLog()) return;
  ovjLogDetailContext = { personId };
  if (typeof mentorLogDetailContext !== "undefined") mentorLogDetailContext = null;
  $("#leadershipLogTitle").textContent = `hOvJ-log ${person.name}`;
  $("#leadershipLogSubtitle").textContent = `${person.rank || "-"} - ${person.serviceNumber || "-"}`;
  $("#leadershipLogPeriod").value = "week";
  renderOvJLogDetailRows();
  $("#leadershipLogDialog").showModal();
}

function renderOvJLogDetailRows() {
  if (!ovjLogDetailContext) return;
  const person = state.people.find((entry) => entry.id === ovjLogDetailContext.personId);
  const list = $("#leadershipLogRows");
  if (!person || !list) return;
  const period = $("#leadershipLogPeriod")?.value || "week";
  const rows = reviewedI8FormsForPerson(person, period);
  const forms = state.i8Forms || [];
  list.innerHTML = rows.length
    ? rows.map((form) => `
      <article class="leadership-detail-row" data-i8-open="${escapeHtml(form.id)}" role="button" tabindex="0">
        <strong>I8 ${escapeHtml(i8NumberFor(form, forms))} - ${escapeHtml(form.personName || memberName(form.personId))}</strong>
        <span>${escapeHtml(i8StatusLabel(form.status))} op ${escapeHtml(formatDateTime(form.reviewedAt))}</span>
        <p>${escapeHtml(form.location || "-")} - ${escapeHtml(i8DateTime(form))}</p>
      </article>
    `).join("")
    : '<div class="feed-item">Geen gekeurde I8 formulieren gevonden voor deze periode.</div>';
}

window.DefensiePortalModules.registerFeature("i8", { ready: true });
