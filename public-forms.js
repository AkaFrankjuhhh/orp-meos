const formState = { config: null };
let questionsChangeBound = false;

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
  if (!field) return false;
  if (condition.includes !== undefined) return field.value === condition.includes;
  if (condition.equals !== undefined) return field.value === condition.equals;
  return Boolean(field.value);
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

function showLoginRequired(loginUrl, message) {
  document.body.dataset.formSlug = "internal-login";
  $("#formTitle").textContent = "Interne vacature";
  $("#formSubtitle").textContent = message || "Log in met Discord om dit interne formulier te openen.";
  $("#questions").innerHTML = `<a class="login-button" href="${escapeHtml(loginUrl)}">Aanmelden met Discord</a>`;
  $("#submitButton").hidden = true;
}


function adminMessage(text, tone = "ok") {
  const element = $("#formAdminMessage");
  if (!element) return;
  element.hidden = false;
  element.className = `form-message ${tone}`;
  element.textContent = text;
}

function parseAdminQuestionsJson(value) {
  const text = String(value || "").replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(text || "[]");
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
  $("#adminFormQuestions").value = JSON.stringify(config.editable?.questions || config.questions || [], null, 2);
  bindAutoGrowingTextareas(panel);
}

async function saveFormAdmin(event) {
  event.preventDefault();
  if (!formState.config?.canManage) return;
  let questions = [];
  try {
    questions = parseAdminQuestionsJson($("#adminFormQuestions").value);
    if (!Array.isArray(questions)) throw new Error("Vragen moeten een JSON-array zijn.");
  } catch (error) {
    adminMessage("Vragen JSON is ongeldig. Controleer aanhalingstekens, haakjes en komma's.", "error");
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
  $("#formAdminForm")?.addEventListener("submit", saveFormAdmin);
}

function applyLoadedConfig(config) {
  document.body.dataset.formSlug = config.slug;
  document.title = config.title;
  document.documentElement.style.setProperty("--accent", config.accent || "#f59e0b");
  $("#formTitle").textContent = config.title;
  $("#formSubtitle").textContent = config.subtitle || "";
  const notice = $("#formNotice");
  notice.hidden = !config.notice;
  notice.textContent = config.notice || "";
  const questionsElement = $("#questions");
  questionsElement.innerHTML = (config.questions || []).map(renderQuestion).join("");
  if (!questionsChangeBound) {
    questionsElement.addEventListener("change", updateConditionalFields);
    questionsChangeBound = true;
  }
  bindAutoGrowingTextareas(questionsElement);
  updateConditionalFields();
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
  const answers = {};
  for (const question of formState.config.questions || []) {
    if (question.showIf && !conditionMatches(question.showIf)) continue;
    if (question.type === "file") continue;
    if (question.type === "checkboxGroup") {
      answers[question.id] = [...document.querySelectorAll(`[name="${CSS.escape(question.id)}"]:checked`)].map((input) => input.value);
      continue;
    }
    answers[question.id] = $(`#field-${CSS.escape(question.id)}`)?.value?.trim() || "";
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
    updateConditionalFields();
    bindAutoGrowingTextareas($("#questions"));
    showMessage("Formulier ontvangen. De melding naar Discord wordt verwerkt.", "ok");
  } catch (error) {
    showMessage(error.message || "Formulier verzenden is mislukt.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Formulier verzenden";
  }
}

$("#publicForm").addEventListener("submit", submitForm);
bindFormAdmin();
showAuthErrorFromUrl();
loadForm().catch((error) => {
  $("#formTitle").textContent = "Formulier niet beschikbaar";
  $("#formSubtitle").textContent = "Controleer de link of probeer het later opnieuw.";
  showMessage(error.message, "error");
  $("#submitButton").disabled = true;
});




