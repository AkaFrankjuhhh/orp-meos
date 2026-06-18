const formState = {
  config: null,
  adminQuestions: [],
  currentPageIndex: 0,
  draftAnswers: {},
  draftKey: ""
};
let questionsChangeBound = false;
let questionsInputBound = false;

function $(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showMessage(text, tone = "ok") {
  const element = $("#formMessage");
  element.hidden = false;
  element.className = `form-message ${tone}`;
  element.textContent = text;
}

function hideMessage() {
  const element = $("#formMessage");
  if (element) element.hidden = true;
}

function setPageIcon(href) {
  if (!href) return;
  const icons = [...document.querySelectorAll("link[rel~='icon']")];
  if (!icons.length) {
    const link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/png";
    document.head.appendChild(link);
    icons.push(link);
  }
  icons.forEach((link) => {
    link.href = href;
  });
}

function showAuthErrorFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("authError");
  if (!code) return;
  const messages = {
    "rate-limited": "Discord blokkeert tijdelijk door te veel loginpogingen. Wacht 5 tot 10 minuten en probeer opnieuw.",
    "login-failed": "Aanmelden via Discord is mislukt. Probeer opnieuw of controleer de Discord-koppeling.",
    "no-role": "Je mist de juiste Discord rol om dit formulier te openen.",
    "no-profile": "Je Discord account is nog niet gekoppeld aan een actief personeelsprofiel."
  };
  showMessage(messages[code] || "Aanmelden via Discord is mislukt.", "error");
  params.delete("authError");
  const nextQuery = params.toString();
  window.history.replaceState({}, document.title, `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
}

function resizeAutoGrowingTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  const minHeight = Number.parseFloat(getComputedStyle(textarea).minHeight) || 0;
  textarea.style.height = `${Math.max(minHeight, textarea.scrollHeight)}px`;
}

function scheduleAutoGrowingTextareaResize(textarea) {
  if (!textarea || textarea.dataset.autoGrowQueued === "true") return;
  textarea.dataset.autoGrowQueued = "true";
  requestAnimationFrame(() => {
    textarea.dataset.autoGrowQueued = "false";
    resizeAutoGrowingTextarea(textarea);
  });
}

function bindAutoGrowingTextareas(root = document) {
  const scope = root || document;
  const textareas = scope.matches?.("textarea") ? [scope] : [...scope.querySelectorAll("textarea")];
  textareas.forEach((textarea) => {
    textarea.dataset.autoGrow = "true";
    resizeAutoGrowingTextarea(textarea);
    if (textarea.dataset.autoGrowBound === "true") return;
    textarea.dataset.autoGrowBound = "true";
    textarea.addEventListener("input", () => scheduleAutoGrowingTextareaResize(textarea));
  });
}

function conditionMatches(condition) {
  if (!condition?.field) return true;
  const checked = [...document.querySelectorAll(`[name="${CSS.escape(condition.field)}"]:checked`)].map((input) => input.value);
  if (checked.length) return condition.includes !== undefined ? checked.includes(condition.includes) : true;
  const field = $(`#field-${CSS.escape(condition.field)}`);
  const value = field ? field.value : formState.draftAnswers?.[condition.field];
  if (value === undefined) return false;
  if (condition.includes !== undefined) return Array.isArray(value) ? value.includes(condition.includes) : value === condition.includes;
  if (condition.equals !== undefined) return value === condition.equals;
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function updateConditionalFields() {
  document.querySelectorAll("[data-show-if]").forEach((field) => {
    const condition = JSON.parse(field.dataset.showIf || "{}");
    const visible = conditionMatches(condition);
    field.hidden = !visible;
    field.querySelectorAll("input, textarea, select").forEach((control) => {
      control.disabled = !visible;
    });
    if (visible) field.querySelectorAll("textarea").forEach(resizeAutoGrowingTextarea);
  });
}

const multilineQuestionIds = new Set([
  "motivation",
  "experience",
  "tasks",
  "whyYou",
  "custody",
  "decisionDoubt",
  "lowEvidencePressure",
  "agentMisconduct",
  "thermiteVehicle",
  "robberyWeaponFound",
  "leftReason",
  "returnReason",
  "switchReason",
  "goal",
  "knowledge",
  "description",
  "evidence",
  "desiredOutcome",
  "trainerReason",
  "mentorReason",
  "intro",
  "sideTasks",
  "strengths",
  "weaknesses",
  "whyAccept",
  "questions"
]);

function shouldRenderQuestionAsTextarea(question) {
  return question.type === "textarea" || multilineQuestionIds.has(question.id) || String(question.label || "").length >= 110;
}

function renderQuestion(question) {
  if (question.type === "section") {
    const help = question.help ? `<p>${escapeHtml(question.help)}</p>` : "";
    return `<section class="field-section"><h2>${escapeHtml(question.label)}</h2>${help}</section>`;
  }
  const required = question.required ? '<span class="required">*</span>' : "";
  const help = question.help ? `<p class="help">${escapeHtml(question.help)}</p>` : "";
  const common = `id="field-${escapeHtml(question.id)}" name="${escapeHtml(question.id)}" ${question.required ? "required" : ""}`;
  const showIf = question.showIf ? ` data-show-if='${escapeHtml(JSON.stringify(question.showIf))}' hidden` : "";
  let control = "";
  if (shouldRenderQuestionAsTextarea(question)) {
    control = `<textarea ${common} placeholder="${escapeHtml(question.placeholder || "")}"></textarea>`;
  } else if (question.type === "select") {
    const options = (question.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
    control = `<select ${common}><option value="">Kies een optie</option>${options}</select>`;
  } else if (question.type === "checkboxGroup") {
    const options = (question.options || []).map((option) => {
      const value = option.value || option;
      const label = option.label || option;
      return `<label class="checkbox-option"><input type="checkbox" name="${escapeHtml(question.id)}" value="${escapeHtml(value)}" /> <span>${escapeHtml(label)}</span></label>`;
    }).join("");
    control = `<div class="checkbox-group" id="field-${escapeHtml(question.id)}">${options}</div>`;
  } else if (question.type === "file") {
    control = `<input ${common} class="file-input" type="file" accept="${escapeHtml(question.accept || "")}" />`;
  } else {
    control = `<input ${common} type="text" placeholder="${escapeHtml(question.placeholder || "")}" />`;
  }
  return `<section class="field"${showIf}><label for="field-${escapeHtml(question.id)}">${escapeHtml(question.label)} ${required}</label>${help}${control}</section>`;
}

function hasFormPages() {
  return Array.isArray(formState.config?.pages) && formState.config.pages.length > 0;
}

function currentFormPage() {
  return hasFormPages() ? formState.config.pages[formState.currentPageIndex] : null;
}

function questionsForCurrentPage() {
  const questions = formState.config?.questions || [];
  const page = currentFormPage();
  if (!page) return questions;
  return questions.filter((question) => (question.page || formState.config.pages[0]?.id) === page.id);
}

function draftStorageKey(config) {
  if (!config?.slug) return "";
  return `orp-public-form-draft:${config.organizationKey || "defensie"}:${config.slug}`;
}

function loadDraftAnswers(config) {
  formState.draftKey = draftStorageKey(config);
  formState.draftAnswers = {};
  if (!formState.draftKey) return;
  try {
    const saved = localStorage.getItem(formState.draftKey);
    if (saved) formState.draftAnswers = JSON.parse(saved) || {};
  } catch {
    formState.draftAnswers = {};
  }
}

function saveDraftAnswers() {
  if (!formState.draftKey) return;
  try {
    localStorage.setItem(formState.draftKey, JSON.stringify(formState.draftAnswers || {}));
  } catch {
    // Draft-opslag is extra gemak; het formulier moet blijven werken als storage niet beschikbaar is.
  }
}

function clearDraftAnswers() {
  if (formState.draftKey) localStorage.removeItem(formState.draftKey);
  formState.draftAnswers = {};
}

function updateDraftFromVisibleFields() {
  for (const question of questionsForCurrentPage()) {
    if (question.type === "section" || question.type === "file") continue;
    if (question.showIf && !conditionMatches(question.showIf)) {
      delete formState.draftAnswers[question.id];
      continue;
    }
    if (question.type === "checkboxGroup") {
      const inputs = [...document.querySelectorAll(`[name="${CSS.escape(question.id)}"]`)];
      if (inputs.length) formState.draftAnswers[question.id] = inputs.filter((input) => input.checked).map((input) => input.value);
      continue;
    }
    const field = $(`#field-${CSS.escape(question.id)}`);
    if (field) formState.draftAnswers[question.id] = field.value;
  }
  saveDraftAnswers();
}

function restoreDraftValues(root = document) {
  const scope = root || document;
  for (const question of questionsForCurrentPage()) {
    if (question.type === "section" || question.type === "file") continue;
    const value = formState.draftAnswers?.[question.id];
    if (value === undefined) continue;
    if (question.type === "checkboxGroup") {
      const values = new Set(Array.isArray(value) ? value : [value]);
      scope.querySelectorAll(`[name="${CSS.escape(question.id)}"]`).forEach((input) => {
        input.checked = values.has(input.value);
      });
      continue;
    }
    const field = scope.querySelector(`#field-${CSS.escape(question.id)}`);
    if (field) field.value = value;
  }
}

function pageHeaderMarkup() {
  const page = currentFormPage();
  if (!page) return "";
  return `
    <section class="form-page-header">
      <p class="form-page-step">Pagina ${formState.currentPageIndex + 1} van ${formState.config.pages.length}</p>
      <h2>${escapeHtml(page.title || `Pagina ${formState.currentPageIndex + 1}`)}</h2>
      ${page.description ? `<p>${escapeHtml(page.description)}</p>` : ""}
    </section>
  `;
}

function updatePageButtons() {
  const previousButton = $("#previousPageButton");
  const nextButton = $("#nextPageButton");
  const submitButton = $("#submitButton");
  const multiPage = hasFormPages();
  if (previousButton) previousButton.hidden = !multiPage || formState.currentPageIndex <= 0;
  if (nextButton) nextButton.hidden = !multiPage || formState.currentPageIndex >= formState.config.pages.length - 1;
  if (submitButton) submitButton.hidden = multiPage && formState.currentPageIndex < formState.config.pages.length - 1;
}

function renderQuestions() {
  const questionsElement = $("#questions");
  questionsElement.innerHTML = `${pageHeaderMarkup()}${questionsForCurrentPage().map(renderQuestion).join("")}`;
  restoreDraftValues(questionsElement);
  bindAutoGrowingTextareas(questionsElement);
  updateConditionalFields();
  updatePageButtons();
}

function validateCurrentPage() {
  updateDraftFromVisibleFields();
  for (const question of questionsForCurrentPage()) {
    if (!question.required || question.type === "section") continue;
    if (question.showIf && !conditionMatches(question.showIf)) continue;
    if (question.type === "checkboxGroup") {
      const values = formState.draftAnswers[question.id];
      if (!Array.isArray(values) || values.length === 0) return false;
      continue;
    }
    if (question.type === "file") {
      const file = $(`#field-${CSS.escape(question.id)}`)?.files?.[0];
      if (!file) return false;
      continue;
    }
    if (!String(formState.draftAnswers[question.id] || "").trim()) return false;
  }
  return true;
}

function showLoginRequired(loginUrl, message) {
  document.body.dataset.formSlug = "internal-login";
  document.body.dataset.formOrg = "overheid";
  $("#formTitle").textContent = "Intern formulier";
  $("#formSubtitle").textContent = message || "Log in met Discord om dit interne formulier te openen.";
  $("#questions").innerHTML = `<a class="login-button" href="${escapeHtml(loginUrl)}">Aanmelden met Discord</a>`;
  $("#submitButton").hidden = true;
  $("#previousPageButton").hidden = true;
  $("#nextPageButton").hidden = true;
}


function adminMessage(text, tone = "ok") {
  const element = $("#formAdminMessage");
  if (!element) return;
  element.hidden = false;
  element.className = `form-message ${tone}`;
  element.textContent = text;
}

function renderFormAdmin(config) {
  const panel = $("#formAdminPanel");
  if (!panel) return;
  panel.hidden = !config.canManage;
  if (!config.canManage) return;
  $("#formAdminAccess").textContent = `Beheer via: ${(config.managerBadges || []).join(", ") || "Kader"}`;
  $("#adminFormTitle").value = config.editable?.title || config.title || "";
  $("#adminFormSubtitle").value = config.editable?.subtitle || "";
  $("#adminFormNotice").value = config.editable?.notice || "";
  $("#adminFormAccent").value = config.editable?.accent || config.accent || "#f59e0b";
  formState.adminQuestions = (config.editable?.questions || config.questions || []).map((question) => ({ ...question }));
  renderAdminQuestionEditor();
  bindAutoGrowingTextareas(panel);
}

function normalizeQuestionId(label, fallback = "vraag") {
  return String(label || fallback)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || fallback;
}

function uniqueQuestionId(baseId, currentIndex) {
  const used = new Set(formState.adminQuestions.map((question, index) => index === currentIndex ? "" : question.id).filter(Boolean));
  let id = baseId;
  let counter = 2;
  while (used.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }
  return id;
}

function renderAdminQuestionEditor() {
  const list = $("#adminQuestionList");
  if (!list) return;
  list.innerHTML = formState.adminQuestions.map((question, index) => {
    const optionsValue = Array.isArray(question.options)
      ? question.options.map((option) => typeof option === "object" ? (option.label || option.value || "") : option).join(", ")
      : "";
    const type = question.type || (multilineQuestionIds.has(question.id) ? "textarea" : "text");
    return `
      <article class="admin-question-card" data-question-index="${index}">
        <label>Vraagtekst<input class="admin-question-label" type="text" value="${escapeHtml(question.label || "")}" /></label>
        <label>Type
          <select class="admin-question-type">
            ${["text", "textarea", "select", "checkboxGroup", "file", "section"].map((option) => `<option value="${option}" ${type === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
          </select>
        </label>
        <label class="question-meta"><input class="admin-question-required" type="checkbox" ${question.required ? "checked" : ""} /> Verplicht</label>
        <button class="ghost-button admin-question-remove" type="button">Verwijder</button>
        <label class="question-options">Opties, gescheiden met komma's<input class="admin-question-options" type="text" value="${escapeHtml(optionsValue)}" ${["select", "checkboxGroup"].includes(type) ? "" : "disabled"} /></label>
      </article>
    `;
  }).join("");
}

function collectAdminQuestions() {
  const cards = [...document.querySelectorAll(".admin-question-card")];
  return cards.map((card, index) => {
    const previous = formState.adminQuestions[Number(card.dataset.questionIndex)] || {};
    const label = card.querySelector(".admin-question-label")?.value.trim() || `Vraag ${index + 1}`;
    const type = card.querySelector(".admin-question-type")?.value || "text";
    const id = uniqueQuestionId(previous.id || normalizeQuestionId(label, `vraag-${index + 1}`), index);
    const question = {
      ...previous,
      id,
      label,
      type,
      required: Boolean(card.querySelector(".admin-question-required")?.checked)
    };
    if (type === "select" || type === "checkboxGroup") {
      question.options = String(card.querySelector(".admin-question-options")?.value || "")
        .split(",")
        .map((option) => option.trim())
        .filter(Boolean);
    } else {
      delete question.options;
    }
    return question;
  });
}

async function saveFormAdmin(event) {
  event.preventDefault();
  if (!formState.config?.canManage) return;
  const questions = collectAdminQuestions();
  if (!questions.length) {
    adminMessage("Voeg minimaal 1 vraag toe.", "error");
    return;
  }
  const payload = {
    slug: formState.config.slug,
    config: {
      title: $("#adminFormTitle").value,
      subtitle: $("#adminFormSubtitle").value,
      notice: $("#adminFormNotice").value,
      accent: $("#adminFormAccent").value,
      questions
    }
  };
  const response = await fetch("/api/public-forms/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    adminMessage(data.error || "Formulier opslaan is mislukt.", "error");
    return;
  }
  formState.config = data.config;
  $("#formAdminForm").hidden = true;
  adminMessage("Formulier opgeslagen.", "ok");
  formState.config = data.config;
  applyLoadedConfig(data.config);
}

function bindFormAdmin() {
  $("#toggleFormAdmin")?.addEventListener("click", () => {
    const form = $("#formAdminForm");
    form.hidden = !form.hidden;
    if (!form.hidden) bindAutoGrowingTextareas(form);
  });
  $("#cancelFormAdmin")?.addEventListener("click", () => {
    $("#formAdminForm").hidden = true;
    renderFormAdmin(formState.config);
  });
  $("#addAdminQuestion")?.addEventListener("click", () => {
    if (document.querySelector(".admin-question-card")) formState.adminQuestions = collectAdminQuestions();
    formState.adminQuestions.push({ id: uniqueQuestionId("nieuwe-vraag", -1), label: "Nieuwe vraag", type: "text", required: false });
    renderAdminQuestionEditor();
  });
  $("#adminQuestionList")?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".admin-question-remove");
    if (!removeButton) return;
    const card = removeButton.closest(".admin-question-card");
    const index = Number(card?.dataset.questionIndex);
    if (!Number.isInteger(index)) return;
    formState.adminQuestions = collectAdminQuestions();
    formState.adminQuestions.splice(index, 1);
    renderAdminQuestionEditor();
  });
  $("#adminQuestionList")?.addEventListener("change", (event) => {
    if (!event.target.classList.contains("admin-question-type")) return;
    const card = event.target.closest(".admin-question-card");
    const options = card?.querySelector(".admin-question-options");
    if (options) options.disabled = !["select", "checkboxGroup"].includes(event.target.value);
  });
  $("#formAdminForm")?.addEventListener("submit", saveFormAdmin);
}

function applyLoadedConfig(config) {
  formState.config = config;
  formState.currentPageIndex = 0;
  loadDraftAnswers(config);
  document.body.dataset.formSlug = config.slug;
  document.body.dataset.formOrg = config.visualScope || config.organizationKey || "defensie";
  document.title = config.title;
  setPageIcon(config.iconHref);
  document.documentElement.style.setProperty("--accent", config.accent || "#f59e0b");
  $("#formEyebrow").textContent = config.eyebrow || "ORP Defensie Oranjestad";
  $("#formTitle").textContent = config.title;
  $("#formSubtitle").textContent = config.subtitle || "";
  const notice = $("#formNotice");
  notice.hidden = !config.notice;
  notice.textContent = config.notice || "";
  const questionsElement = $("#questions");
  if (!questionsChangeBound) {
    questionsElement.addEventListener("change", () => {
      updateConditionalFields();
      updateDraftFromVisibleFields();
    });
    questionsChangeBound = true;
  }
  if (!questionsInputBound) {
    questionsElement.addEventListener("input", (event) => {
      if (event.target.matches("input, textarea, select")) updateDraftFromVisibleFields();
    });
    questionsInputBound = true;
  }
  renderQuestions();
  renderFormAdmin(config);
}
async function loadForm() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const formQuery = pathParts[0] === "forms" && pathParts[1] ? `?form=${encodeURIComponent(pathParts[1])}` : "";
  const response = await fetch(`/api/public-forms/config${formQuery}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    showLoginRequired(data.loginUrl || "/api/auth/login", data.error);
    return;
  }
  if (!response.ok) throw new Error(data.error || "Formulier niet gevonden.");
  const config = data;
  formState.config = config;
  applyLoadedConfig(config);
}

function collectAnswers() {
  updateDraftFromVisibleFields();
  const answers = { ...(formState.draftAnswers || {}) };
  for (const question of formState.config.questions || []) {
    if (question.showIf && !conditionMatches(question.showIf)) continue;
    if (question.type === "file") continue;
    if (question.type === "checkboxGroup") {
      const inputs = [...document.querySelectorAll(`[name="${CSS.escape(question.id)}"]`)];
      if (inputs.length) answers[question.id] = inputs.filter((input) => input.checked).map((input) => input.value);
      continue;
    }
    const field = $(`#field-${CSS.escape(question.id)}`);
    if (field) answers[question.id] = field.value.trim();
  }
  return answers;
}

function formHasUpload() {
  return (formState.config?.questions || []).some((question) => question.type === "file");
}

function buildSubmitBody() {
  const answers = collectAnswers();
  if (!formHasUpload()) {
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: formState.config.slug, answers })
    };
  }

  const formData = new FormData();
  formData.append("slug", formState.config.slug);
  formData.append("answers", JSON.stringify(answers));
  for (const question of formState.config.questions || []) {
    if (question.type !== "file") continue;
    const file = $(`#field-${CSS.escape(question.id)}`)?.files?.[0];
    if (file) formData.append(question.id, file);
  }
  return { body: formData };
}

async function submitForm(event) {
  event.preventDefault();
  if (!formState.config) return;
  if ($("#website").value) return;
  if (hasFormPages() && !validateCurrentPage()) {
    showMessage("Vul de verplichte velden op deze pagina in voordat je verzendt.", "error");
    return;
  }
  const button = $("#submitButton");
  button.disabled = true;
  button.textContent = "Verzenden...";
  try {
    const requestBody = buildSubmitBody();
    const response = await fetch("/api/public-forms/submit", {
      method: "POST",
      ...requestBody
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && data.loginUrl) {
      showLoginRequired(data.loginUrl, data.error);
      return;
    }
    if (!response.ok) throw new Error(data.error || "Formulier verzenden is mislukt.");
    $("#publicForm").reset();
    clearDraftAnswers();
    formState.currentPageIndex = 0;
    renderQuestions();
    showMessage("Formulier ontvangen. De melding naar Discord wordt verwerkt.", "ok");
  } catch (error) {
    showMessage(error.message || "Formulier verzenden is mislukt.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Formulier verzenden";
  }
}

$("#publicForm").addEventListener("submit", submitForm);
$("#previousPageButton")?.addEventListener("click", () => {
  if (!hasFormPages()) return;
  updateDraftFromVisibleFields();
  formState.currentPageIndex = Math.max(0, formState.currentPageIndex - 1);
  hideMessage();
  renderQuestions();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
$("#nextPageButton")?.addEventListener("click", () => {
  if (!hasFormPages()) return;
  if (!validateCurrentPage()) {
    showMessage("Vul de verplichte velden op deze pagina in voordat je verder gaat.", "error");
    return;
  }
  formState.currentPageIndex = Math.min(formState.config.pages.length - 1, formState.currentPageIndex + 1);
  hideMessage();
  renderQuestions();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
bindFormAdmin();
showAuthErrorFromUrl();
loadForm().catch((error) => {
  $("#formTitle").textContent = "Formulier niet beschikbaar";
  $("#formSubtitle").textContent = "Controleer de link of probeer het later opnieuw.";
  showMessage(error.message, "error");
  $("#submitButton").disabled = true;
});




