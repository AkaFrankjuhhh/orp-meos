const formState = { config: null };

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

function renderQuestion(question) {
  const required = question.required ? '<span class="required">*</span>' : "";
  const help = question.help ? `<p class="help">${escapeHtml(question.help)}</p>` : "";
  const common = `id="field-${escapeHtml(question.id)}" name="${escapeHtml(question.id)}" ${question.required ? "required" : ""}`;
  let control = "";
  if (question.type === "textarea") {
    control = `<textarea ${common} placeholder="${escapeHtml(question.placeholder || "")}"></textarea>`;
  } else if (question.type === "select") {
    const options = (question.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
    control = `<select ${common}><option value="">Kies een optie</option>${options}</select>`;
  } else {
    control = `<input ${common} type="text" placeholder="${escapeHtml(question.placeholder || "")}" />`;
  }
  return `<section class="field"><label for="field-${escapeHtml(question.id)}">${escapeHtml(question.label)} ${required}</label>${help}${control}</section>`;
}

async function loadForm() {
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  const formQuery = pathParts[0] === "forms" && pathParts[1] ? `?form=${encodeURIComponent(pathParts[1])}` : "";
  const response = await fetch(`/api/public-forms/config${formQuery}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Formulier niet gevonden.");
  const config = await response.json();
  formState.config = config;
  document.title = config.title;
  document.documentElement.style.setProperty("--accent", config.accent || "#f59e0b");
  $("#formTitle").textContent = config.title;
  $("#formSubtitle").textContent = config.subtitle || "";
  const notice = $("#formNotice");
  if (config.notice) {
    notice.hidden = false;
    notice.textContent = config.notice;
  }
  $("#questions").innerHTML = (config.questions || []).map(renderQuestion).join("");
}

function collectAnswers() {
  const answers = {};
  for (const question of formState.config.questions || []) {
    answers[question.id] = $(`#field-${CSS.escape(question.id)}`)?.value?.trim() || "";
  }
  return answers;
}

async function submitForm(event) {
  event.preventDefault();
  if (!formState.config) return;
  if ($("#website").value) return;
  const button = $("#submitButton");
  button.disabled = true;
  button.textContent = "Verzenden...";
  try {
    const response = await fetch("/api/public-forms/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: formState.config.slug, answers: collectAnswers() })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Formulier verzenden is mislukt.");
    $("#publicForm").reset();
    showMessage("Formulier verzonden. Bedankt voor je inzending.", "ok");
  } catch (error) {
    showMessage(error.message || "Formulier verzenden is mislukt.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Formulier verzenden";
  }
}

$("#publicForm").addEventListener("submit", submitForm);
loadForm().catch((error) => {
  $("#formTitle").textContent = "Formulier niet beschikbaar";
  $("#formSubtitle").textContent = "Controleer de link of probeer het later opnieuw.";
  showMessage(error.message, "error");
  $("#submitButton").disabled = true;
});