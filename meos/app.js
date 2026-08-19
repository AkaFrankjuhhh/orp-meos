import { apiJson, setMeosCsrfToken } from "./api.js";
import {
  $,
  $$,
  asArray,
  escapeHtml,
  formPayload,
  fuzzyNameMatches,
  normalize,
  normalizeImageInputFiles,
  shouldNormalizeImageInput,
  todayMeosDate
} from "./core.js";
import { renderDataHealthHtml } from "./pages/databron.js";

(function () {
  let people = [];
  let activePage = "dashboard";
  let activePersonId = "";
  let activeVehiclePlate = "";
  let meosDataLoaded = false;
  let meosDataError = "";
  let meosDataSource = null;
  let meosDataHealth = null;
  let meosDataHealthLoading = false;
  let meosDataHealthError = "";
  let currentMeosProfile = null;
  const themeStorageKey = "orp-meos-theme";
  const defaultMeosProfile = {
    name: "Frank Bright",
    rank: "Brigadegeneraal",
    serviceNumber: "70-04",
    avatarUrl: "/assets/meos-logo.png?v=20260818-site-logo",
    permissions: {
      canViewEntries: false,
      canWriteEntries: false,
      canDeleteEntries: false,
      canViewDataHealth: false
    }
  };
  const wetboekRecordState = {
    personId: "",
    articles: [],
    loaded: false,
    loading: false,
    error: "",
    formError: "",
    query: "",
    category: "all",
    articleModifiers: {},
    selected: [],
    date: "",
    sanction: "PV",
    extraNote: "",
    createFine: false,
    fineAmount: "",
    busy: false
  };

  function personSlug(person) {
    const raw = String(person?.name || person?.id || "persoon").trim();
    const slug = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "persoon";
  }

  function vehicleSlug(vehicle) {
    const raw = String(vehicle?.plate || "voertuig").trim();
    const slug = raw
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "voertuig";
  }

  function personIsWanted(person) {
    return normalize(person?.status).includes("gezocht");
  }

  function preferredTheme() {
    let stored = "";
    try {
      stored = String(localStorage.getItem(themeStorageKey) || "").trim();
    } catch {
      stored = "";
    }
    if (stored === "dark" || stored === "light") return stored;
    return "light";
  }

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.meosTheme = nextTheme;
    const toggle = $("#meosThemeToggle");
    if (toggle) toggle.checked = nextTheme === "dark";
  }

  function setTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    try {
      localStorage.setItem(themeStorageKey, nextTheme);
    } catch {
      // Dark mode is a preference; the interface should still work if storage is blocked.
    }
    applyTheme(nextTheme);
  }

  function profileFullName(profile) {
    return String(profile?.name || defaultMeosProfile.name).trim() || defaultMeosProfile.name;
  }

  function profileMetaLine(profile) {
    return [profile.rank, profile.serviceNumber].map((value) => String(value || "").trim()).filter(Boolean).join(" \u00b7 ");
  }

  function canDeleteMeosEntries() {
    return Boolean(currentMeosProfile?.permissions?.canDeleteEntries);
  }

  function canWriteMeosEntries() {
    return Boolean(currentMeosProfile?.permissions?.canWriteEntries);
  }

  function canViewDataHealth() {
    return Boolean(currentMeosProfile?.permissions?.canViewDataHealth);
  }

  function updateDataHealthAccess() {
    const allowed = canViewDataHealth();
    $$("[data-health-only]").forEach((element) => {
      element.hidden = !allowed;
    });
    if (!allowed) {
      meosDataHealth = null;
      meosDataHealthError = "";
      if (activePage === "databron") setPage("dashboard", { updateUrl: false });
    }
  }

  function renderDashboardProfile(profile) {
    const fullName = profileFullName(profile);
    const title = $("#dashboardTitle");
    const welcome = $("#dashboardWelcomeLine");
    if (title) title.textContent = `Welkom ${fullName}.`;
    if (welcome) welcome.textContent = `Hallo ${fullName}, welkom in MEOS vandaag.`;
  }

  function renderMeosProfile(profile = defaultMeosProfile, authenticated = false) {
    const nextProfile = { ...defaultMeosProfile, ...(profile || {}) };
    currentMeosProfile = nextProfile;
    const avatar = $("#meosProfileAvatar");
    const name = $("#meosProfileName");
    const meta = $("#meosProfileMeta");
    const login = $("#meosProfileLogin");
    const logout = $("#meosProfileLogout");
    if (avatar) avatar.src = nextProfile.avatarUrl || defaultMeosProfile.avatarUrl;
    if (name) name.textContent = profileFullName(nextProfile);
    if (meta) meta.textContent = profileMetaLine(nextProfile);
    if (login) login.hidden = authenticated;
    if (logout) logout.hidden = !authenticated;
    renderDashboardProfile(nextProfile);
    updateDataHealthAccess();
  }

  async function loadMeosSession() {
    try {
      const response = await fetch("/api/meos/session", {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(`MEOS sessie ophalen mislukt (${response.status})`);
      const payload = await response.json();
      setMeosCsrfToken(payload.csrfToken || "");
      renderMeosProfile(payload.profile, Boolean(payload.authenticated));
    } catch {
      setMeosCsrfToken("");
      renderMeosProfile(defaultMeosProfile, false);
    }
  }

  async function logoutMeosProfile() {
    const logout = $("#meosProfileLogout");
    if (logout) logout.disabled = true;
    try {
      await apiJson("/api/meos/logout", { method: "POST" });
      setMeosCsrfToken("");
      renderMeosProfile(defaultMeosProfile, false);
    } finally {
      if (logout) logout.disabled = false;
    }
  }

  function normalizePersonData(person) {
    const vehicles = Array.isArray(person?.vehicles) ? person.vehicles : [];
    return {
      ...person,
      id: person?.id || personSlug(person),
      name: person?.name || "Onbekende persoon",
      licenses: Array.isArray(person?.licenses) ? person.licenses : [],
      vehicles: vehicles.map((vehicle) => ({
        ...vehicle,
        owner: vehicle.owner || person?.name || "Onbekende persoon"
      })),
      houses: Array.isArray(person?.houses) ? person.houses : [],
      records: Array.isArray(person?.records) ? person.records : [],
      notes: Array.isArray(person?.notes) ? person.notes : [],
      fines: Array.isArray(person?.fines) ? person.fines : [],
      arrestWarrants: Array.isArray(person?.arrestWarrants) ? person.arrestWarrants : []
    };
  }

  function setMeosPeople(nextPeople) {
    people = Array.isArray(nextPeople) ? nextPeople.map(normalizePersonData) : [];
    activePersonId = findPerson(activePersonId)?.id || people[0]?.id || "";
    activeVehiclePlate = findVehicle(activeVehiclePlate)?.plate || allVehicles()[0]?.plate || "";
  }

  function renderDataLoading() {
    const loading = '<div class="meos-empty">MEOS data laden...</div>';
    if ($("#personResults")) $("#personResults").innerHTML = loading;
    if ($("#vehicleResults")) $("#vehicleResults").innerHTML = loading;
    if ($("#warrantOverview")) $("#warrantOverview").innerHTML = loading;
    if ($("#dashboardSearchPreview")) $("#dashboardSearchPreview").innerHTML = loading;
  }

  function renderDataError(error) {
    const message = escapeHtml(error?.message || "MEOS data kon niet worden geladen.");
    const content = `<div class="meos-empty">MEOS data niet beschikbaar: ${message}</div>`;
    if ($("#personResults")) $("#personResults").innerHTML = content;
    if ($("#vehicleResults")) $("#vehicleResults").innerHTML = content;
    if ($("#warrantOverview")) $("#warrantOverview").innerHTML = content;
    if ($("#dashboardSearchPreview")) $("#dashboardSearchPreview").innerHTML = content;
  }

  function renderDataSourceStatus() {
    const syncLine = $("#dashboardSyncLine");
    if (!syncLine) return;
    const label = meosDataSource?.label || "MEOS data";
    const live = meosDataSource?.live ? "live" : "conceptdata";
    const stale = meosDataSource?.stale ? "laatste cache" : live;
    syncLine.textContent = `Laatste synchronisatie: ${label} (${stale}).`;
  }

  function renderDataHealth() {
    const target = $("#dataHealthView");
    if (!target) return;
    target.innerHTML = renderDataHealthHtml({
      health: meosDataHealth,
      loading: meosDataHealthLoading,
      error: meosDataHealthError,
      canView: canViewDataHealth()
    });
  }

  async function loadDataHealth(force = false) {
    if (!canViewDataHealth()) {
      renderDataHealth();
      return;
    }
    if (meosDataHealthLoading) return;
    if (meosDataHealth && !force) {
      renderDataHealth();
      return;
    }
    meosDataHealthLoading = true;
    meosDataHealthError = "";
    renderDataHealth();
    try {
      const payload = await apiJson("/api/meos/data-health");
      meosDataHealth = payload.health || null;
    } catch (error) {
      meosDataHealthError = error.message || "Databronstatus ophalen is mislukt.";
    } finally {
      meosDataHealthLoading = false;
      renderDataHealth();
    }
  }

  function currentVerbalistName() {
    return profileFullName(currentMeosProfile || defaultMeosProfile);
  }

  function normalizeWetboekArticles(payload = {}) {
    const wetboek = payload.wetboek || payload;
    const rows = Array.isArray(wetboek.articles) ? wetboek.articles : [];
    return rows.map((article, index) => ({
      ...article,
      id: String(article.id || article.articleId || `artikel-${index + 1}`).trim(),
      title: String(article.title || article.heading || "Onbekend artikel").trim(),
      category: String(article.category || article.sectionLabel || "Overig").trim(),
      sectionLabel: String(article.sectionLabel || "").trim(),
      contentText: String(article.contentText || article.text || "").trim(),
      tables: asArray(article.tables).map((table, tableIndex) => ({
        ...table,
        index: table.index ?? tableIndex,
        type: String(table.type || "table").trim(),
        rows: asArray(table.rows)
      }))
    })).filter((article) => article.id);
  }

  async function loadWetboekArticles() {
    if (wetboekRecordState.loaded || wetboekRecordState.loading) return;
    wetboekRecordState.loading = true;
    wetboekRecordState.error = "";
    renderWetboekRecordModal();
    try {
      const payload = await apiJson("/api/meos/wetboek/articles");
      wetboekRecordState.articles = normalizeWetboekArticles(payload);
      wetboekRecordState.loaded = true;
    } catch (error) {
      wetboekRecordState.error = error.message || "Wetboek kon niet worden geladen.";
    } finally {
      wetboekRecordState.loading = false;
      renderWetboekRecordModal();
    }
  }

  function wetboekArticleById(articleId) {
    return wetboekRecordState.articles.find((article) => article.id === articleId) || null;
  }

  function wetboekArticleSearchText(article) {
    const tableText = asArray(article.tables).flatMap((table) => asArray(table.rows).flatMap((row) => Object.values(row || {}))).join(" ");
    return [article.id, article.title, article.heading, article.category, article.sectionLabel, article.contentText, tableText].join(" ");
  }

  function wetboekCategories() {
    return [...new Set(wetboekRecordState.articles.map((article) => article.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "nl"));
  }

  function filteredWetboekArticles() {
    const query = normalize(wetboekRecordState.query);
    const category = wetboekRecordState.category;
    return wetboekRecordState.articles.filter((article) => {
      const categoryMatches = !category || category === "all" || article.category === category;
      const queryMatches = !query || normalize(wetboekArticleSearchText(article)).includes(query);
      return categoryMatches && queryMatches;
    });
  }

  function wetboekPenaltyParts(row = {}) {
    return [
      ["Celstraf", row.Celstraf],
      ["Taakstraf", row.Taakstraf],
      ["Boete", row.Boete || row.Bedrag],
      ["Rijontzegging", row.Rijontzegging || row.Rijverbod],
      ["Inbeslagname", row.Inbeslagname]
    ].filter(([, value]) => String(value || "").trim())
      .map(([label, value]) => `${label}: ${String(value).trim()}`);
  }

  function wetboekArticleChoices(article) {
    return asArray(article?.tables).flatMap((table, tableIndex) => asArray(table.rows).map((row, rowIndex) => {
      const effectiveTableIndex = table.index ?? tableIndex;
      const title = String(row?.Feit || row?.Veroordeling || row?.Omschrijving || row?.Titel || `Regel ${rowIndex + 1}`).trim();
      const penalty = wetboekPenaltyParts(row).join(" | ") || "geen strafbedrag";
      return {
        key: `${effectiveTableIndex}:${rowIndex}`,
        tableIndex: String(effectiveTableIndex),
        rowIndex: String(rowIndex),
        label: `${title} - ${penalty}`,
        row,
        table
      };
    }));
  }

  function selectedWetboekChoice(item) {
    const article = wetboekArticleById(item.articleId);
    const choices = wetboekArticleChoices(article);
    return choices.find((choice) => choice.tableIndex === String(item.tableIndex) && choice.rowIndex === String(item.rowIndex)) || choices[0] || null;
  }

  function parseEuroAmount(value) {
    const match = String(value || "").match(/\d[\d.,]*/);
    if (!match) return 0;
    const parsed = Number(match[0].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  function parseDurationValue(value) {
    const match = String(value || "").match(/\d+(?:[.,]\d+)?/);
    if (!match) return 0;
    const parsed = Number(match[0].replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatPenaltyNumber(value) {
    const rounded = Math.round(Number(value || 0) * 10) / 10;
    if (!rounded) return "0";
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(".", ",");
  }

  function wetboekPenaltyModifier(item = {}) {
    const labels = [];
    let factor = 1;
    if (item.officialInDuty) {
      factor *= 1.33;
      labels.push("Ambtenaar in functie +33%");
    }
    if (item.attempted) {
      factor *= 0.67;
      labels.push("Poging tot -33%");
    }
    return { factor, labels };
  }

  function applyPenaltyModifier(value, roundToEuros = false, item = {}) {
    const number = Number(value || 0);
    if (!number) return 0;
    const adjusted = number * wetboekPenaltyModifier(item).factor;
    return roundToEuros ? Math.round(adjusted) : Math.round(adjusted * 10) / 10;
  }

  function wetboekModifierText(item = {}) {
    return wetboekPenaltyModifier(item).labels.join(", ");
  }

  function wetboekModifierBadges(item = {}) {
    const badges = [];
    if (item.officialInDuty) badges.push("Ambtenaar +33%");
    if (item.attempted) badges.push("Poging -33%");
    return badges;
  }

  function renderWetboekBadges(labels = []) {
    const cleanLabels = labels.map((label) => String(label || "").trim()).filter(Boolean);
    if (!cleanLabels.length) return "";
    return `<div class="meos-badge-row">${cleanLabels.map((label) => `<span class="meos-chip info">${escapeHtml(label)}</span>`).join("")}</div>`;
  }

  function calculateWetboekTotals(items = wetboekRecordState.selected) {
    const rawTotals = items.reduce((totals, item) => {
      const article = wetboekArticleById(item.articleId);
      const choice = selectedWetboekChoice(item);
      const row = choice?.row || {};
      const fine = parseEuroAmount(row.Boete || row.Bedrag);
      const jailMonths = parseDurationValue(row.Celstraf);
      const taskHours = parseDurationValue(row.Taakstraf);
      const drivingBanMonths = parseDurationValue(row.Rijontzegging || row.Rijverbod);
      const modifier = wetboekPenaltyModifier(item);
      totals.rawFine += fine;
      totals.rawJailMonths += jailMonths;
      totals.rawTaskHours += taskHours;
      totals.rawDrivingBanMonths += drivingBanMonths;
      totals.fine += applyPenaltyModifier(fine, true, item);
      totals.jailMonths += applyPenaltyModifier(jailMonths, false, item);
      totals.taskHours += applyPenaltyModifier(taskHours, false, item);
      totals.drivingBanMonths += applyPenaltyModifier(drivingBanMonths, false, item);
      if (modifier.labels.length) {
        totals.modifierLabels.push(`${article?.id || item.articleId}: ${modifier.labels.join(", ")}`);
      }
      if (choice) totals.count += 1;
      return totals;
    }, {
      fine: 0,
      jailMonths: 0,
      taskHours: 0,
      drivingBanMonths: 0,
      rawFine: 0,
      rawJailMonths: 0,
      rawTaskHours: 0,
      rawDrivingBanMonths: 0,
      modifierLabels: [],
      count: 0
    });
    const hasJail = rawTotals.jailMonths > 0;
    const taskToJailMonths = hasJail ? rawTotals.taskHours / 2 : 0;
    return {
      count: rawTotals.count,
      rawFine: rawTotals.rawFine,
      rawJailMonths: rawTotals.rawJailMonths,
      rawTaskHours: rawTotals.rawTaskHours,
      rawDrivingBanMonths: rawTotals.rawDrivingBanMonths,
      taskConverted: hasJail && rawTotals.taskHours > 0,
      taskToJailMonths,
      convertedTaskHours: rawTotals.taskHours,
      modifierLabels: rawTotals.modifierLabels,
      fine: rawTotals.fine,
      jailMonths: Math.round((rawTotals.jailMonths + taskToJailMonths) * 10) / 10,
      taskHours: hasJail ? 0 : rawTotals.taskHours,
      drivingBanMonths: rawTotals.drivingBanMonths
    };
  }

  function formatEuroAmount(amount) {
    const value = Number(amount || 0);
    if (!value) return "";
    return `EUR ${Math.round(value).toLocaleString("nl-NL")}`;
  }

  function wetboekRecordFineAmount() {
    const customAmount = String(wetboekRecordState.fineAmount || "").trim();
    if (customAmount) return customAmount;
    return formatEuroAmount(calculateWetboekTotals().fine);
  }

  function composeWetboekRecordNote(items = wetboekRecordState.selected) {
    const lines = items.map((item) => {
      const article = wetboekArticleById(item.articleId);
      const choice = selectedWetboekChoice(item);
      const penalty = wetboekPenaltyParts(choice?.row || {}).join(", ") || "geen automatische strafwaarde";
      return `- ${article?.id || item.articleId} ${article?.title || ""}: ${penalty}`;
    });
    if (!lines.length) return "";
    const totals = calculateWetboekTotals(items);
    const totalParts = [
      totals.fine ? `Boete totaal: ${formatEuroAmount(totals.fine)}` : "",
      totals.jailMonths ? `Celstraf totaal: ${formatPenaltyNumber(totals.jailMonths)} maand(en)` : "",
      totals.taskHours ? `Taakstraf totaal: ${formatPenaltyNumber(totals.taskHours)} uur` : "",
      totals.drivingBanMonths ? `Rijontzegging totaal: ${formatPenaltyNumber(totals.drivingBanMonths)} maand(en)` : ""
    ].filter(Boolean);
    const ruleParts = [
      totals.taskConverted ? `Taakstraf omgezet naar celstraf: ${formatPenaltyNumber(totals.convertedTaskHours)} / 2 = ${formatPenaltyNumber(totals.taskToJailMonths)} maand(en)` : "",
      totals.modifierLabels.length ? `Aanpassingen: ${totals.modifierLabels.join(", ")}` : ""
    ].filter(Boolean);
    return [
      "Wetboek strafberekening:",
      ...lines,
      ...ruleParts,
      totalParts.length ? `Totaal: ${totalParts.join(" | ")}` : ""
    ].filter(Boolean).join("\n");
  }

  function wetboekRecordNoteWithExtra() {
    const baseNote = composeWetboekRecordNote();
    const extraNote = String(wetboekRecordState.extraNote || "").trim();
    return [
      baseNote,
      extraNote ? `Aanvullende notitie:\n${extraNote}` : ""
    ].filter(Boolean).join("\n\n");
  }

  function wetboekFineTitle() {
    const ids = [...new Set(wetboekRecordState.selected.map((item) => item.articleId).filter(Boolean))];
    return ids.length ? `Wetboek boete ${ids.join(", ")}` : "Wetboek boete";
  }

  function wetboekArticleModifier(articleId) {
    return wetboekRecordState.articleModifiers?.[articleId] || {};
  }

  function setWetboekArticleModifier(articleId, modifierName, checked) {
    if (!articleId || !["officialInDuty", "attempted"].includes(modifierName)) return;
    wetboekRecordState.articleModifiers = {
      ...(wetboekRecordState.articleModifiers || {}),
      [articleId]: {
        ...wetboekArticleModifier(articleId),
        [modifierName]: Boolean(checked)
      }
    };
  }

  function renderWetboekArticleList() {
    if (wetboekRecordState.loading) return '<div class="meos-empty">Wetboek artikelen laden...</div>';
    if (wetboekRecordState.error) {
      return `
        <div class="meos-empty">
          ${escapeHtml(wetboekRecordState.error)}
          <button class="meos-secondary muted" type="button" data-retry-wetboek>Opnieuw laden</button>
        </div>
      `;
    }
    const articles = filteredWetboekArticles().slice(0, 24);
    if (!articles.length) return '<div class="meos-empty">Geen Wetboek artikelen gevonden.</div>';
    return articles.map((article) => {
      const isSelected = wetboekRecordState.selected.some((item) => item.articleId === article.id);
      const modifiers = wetboekArticleModifier(article.id);
      const summary = article.contentText ? `${article.contentText.slice(0, 170)}${article.contentText.length > 170 ? "..." : ""}` : "Geen omschrijving beschikbaar.";
      return `
        <article class="meos-wetboek-result">
          <div>
            <strong>${escapeHtml(article.id)} - ${escapeHtml(article.title)}</strong>
            <span>${escapeHtml(article.category || "Overig")}</span>
            <p>${escapeHtml(summary)}</p>
          </div>
          <div class="meos-wetboek-result-actions">
            <div class="meos-wetboek-add-options">
              <label class="meos-check-row compact">
                <input type="checkbox" data-wetboek-article-modifier="officialInDuty" data-article-id="${escapeHtml(article.id)}" ${modifiers.officialInDuty ? "checked" : ""} ${isSelected ? "disabled" : ""} />
                <span>Ambtenaar in functie (+33%)</span>
              </label>
              <label class="meos-check-row compact">
                <input type="checkbox" data-wetboek-article-modifier="attempted" data-article-id="${escapeHtml(article.id)}" ${modifiers.attempted ? "checked" : ""} ${isSelected ? "disabled" : ""} />
                <span>Poging tot (-33%)</span>
              </label>
            </div>
            <button class="meos-secondary" type="button" data-add-wetboek-article="${escapeHtml(article.id)}" ${isSelected ? "disabled" : ""}>Toevoegen</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderWetboekSelectedList() {
    if (!wetboekRecordState.selected.length) {
      return '<div class="meos-empty">Nog geen artikelen geselecteerd.</div>';
    }
    return wetboekRecordState.selected.map((item) => {
      const article = wetboekArticleById(item.articleId);
      const choices = wetboekArticleChoices(article);
      const selectedChoice = selectedWetboekChoice(item);
      const modifierBadges = wetboekModifierBadges(item);
      return `
        <article class="meos-wetboek-selection">
          <div class="meos-wetboek-selection-head">
            <strong>${escapeHtml(article?.id || item.articleId)} - ${escapeHtml(article?.title || "Artikel")}</strong>
            <button class="meos-danger-action" type="button" data-remove-wetboek-selection="${escapeHtml(item.articleId)}">Verwijderen</button>
          </div>
          ${choices.length ? `
            <label>
              <span>Strafregel</span>
              <select data-wetboek-row-choice="${escapeHtml(item.articleId)}">
                ${choices.map((choice) => `<option value="${escapeHtml(choice.key)}" ${choice.key === selectedChoice?.key ? "selected" : ""}>${escapeHtml(choice.label)}</option>`).join("")}
              </select>
            </label>
          ` : '<p>Dit artikel heeft geen strafmatrix of boetelijst.</p>'}
          ${renderWetboekBadges(modifierBadges)}
        </article>
      `;
    }).join("");
  }

  function renderWetboekTotals(totals) {
    const items = [
      ["Boete", totals.fine ? formatEuroAmount(totals.fine) : "Geen"],
      ["Celstraf", totals.jailMonths ? `${formatPenaltyNumber(totals.jailMonths)} maand(en)` : "Geen"],
      ["Taakstraf", totals.taskHours ? `${formatPenaltyNumber(totals.taskHours)} uur` : "Geen"],
      ["Rijontzegging", totals.drivingBanMonths ? `${formatPenaltyNumber(totals.drivingBanMonths)} maand(en)` : "Geen"]
    ];
    const summary = items.filter(([, value]) => value !== "Geen").map(([label, value]) => `${label}: ${value}`).join(" | ") || "Geen straf berekend";
    const notes = [
      totals.taskConverted ? `${formatPenaltyNumber(totals.convertedTaskHours)} taakstraf wordt ${formatPenaltyNumber(totals.taskToJailMonths)} celstraf (:2).` : "",
      totals.modifierLabels.length ? totals.modifierLabels.join(" en ") : ""
    ].filter(Boolean);
    const badges = [
      totals.taskConverted ? "Taakstraf omgezet" : "",
      ...totals.modifierLabels
    ].filter(Boolean);
    return `
      <div class="meos-wetboek-total-summary">
        <span>Berekend totaal</span>
        <strong>${escapeHtml(summary)}</strong>
        ${renderWetboekBadges(badges)}
        ${notes.length ? `<p>${escapeHtml(notes.join(" | "))}</p>` : ""}
      </div>
      <div class="meos-wetboek-totals">${items.map(([label, value]) => `
        <div>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join("")}</div>
    `;
  }

  function renderWetboekRecordModal() {
    const modal = $("#meosRecordModal");
    if (!modal || !wetboekRecordState.personId) return;
    const person = findPerson(wetboekRecordState.personId);
    const totals = calculateWetboekTotals();
    const fineAmount = wetboekRecordFineAmount();
    const notePreview = wetboekRecordNoteWithExtra() || "Selecteer artikelen of vul een aanvullende notitie in.";
    const saveLabel = wetboekRecordState.createFine ? "Strafblad + boete opslaan" : "Strafblad opslaan";
    modal.innerHTML = `
      <section class="meos-record-modal" role="dialog" aria-modal="true" aria-labelledby="meosRecordModalTitle">
        <header class="meos-record-modal-head">
          <div>
            <p>Strafberekening</p>
            <h2 id="meosRecordModalTitle">Strafblad toevoegen voor ${escapeHtml(person?.name || "persoon")}</h2>
          </div>
          <button class="meos-secondary muted" type="button" data-close-record-modal>Sluiten</button>
        </header>

        <div class="meos-record-modal-grid">
          <section class="meos-wetboek-search" aria-label="Wetboek doorzoeken">
            <div class="meos-record-modal-tools">
              <label>
                <span>Wetboek zoeken</span>
                <input id="wetboekSearch" data-wetboek-field="query" type="search" placeholder="Bijv. rijden onder invloed, diefstal..." value="${escapeHtml(wetboekRecordState.query)}" />
              </label>
              <label>
                <span>Categorie</span>
                <select data-wetboek-field="category">
                  <option value="all">Alle categorieen</option>
                  ${wetboekCategories().map((category) => `<option value="${escapeHtml(category)}" ${category === wetboekRecordState.category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
                </select>
              </label>
            </div>
            <div class="meos-wetboek-results">${renderWetboekArticleList()}</div>
          </section>

          <section class="meos-wetboek-compose" aria-label="Strafbepaling">
            <h3>Strafbepaling</h3>
            ${renderWetboekSelectedList()}
            ${renderWetboekTotals(totals)}

            <div class="meos-record-modal-fields">
              <label>
                <span>Datum</span>
                <input data-wetboek-field="date" type="text" maxlength="40" value="${escapeHtml(wetboekRecordState.date || todayMeosDate())}" />
              </label>
              <label>
                <span>Sanctie</span>
                <input data-wetboek-field="sanction" type="text" maxlength="80" value="${escapeHtml(wetboekRecordState.sanction || "PV")}" />
              </label>
              <label class="wide">
                <span>Extra notitie</span>
                <textarea data-wetboek-field="extraNote" rows="3" maxlength="1200" placeholder="Bijv. context, locatie of bijzonderheden">${escapeHtml(wetboekRecordState.extraNote)}</textarea>
              </label>
              <label class="wide">
                <span>Samengestelde strafbladtekst</span>
                <textarea data-wetboek-note-preview readonly rows="6">${escapeHtml(notePreview)}</textarea>
              </label>
              <label class="meos-check-row wide">
                <input data-wetboek-field="createFine" type="checkbox" ${wetboekRecordState.createFine ? "checked" : ""} />
                <span>Direct openstaande boete toevoegen aan deze persoon</span>
              </label>
              <label>
                <span>Boetebedrag</span>
                <input data-wetboek-field="fineAmount" type="text" maxlength="80" placeholder="Bijv. EUR 3.000" value="${escapeHtml(fineAmount)}" />
              </label>
            </div>

            ${wetboekRecordState.formError ? `<p class="meos-form-error">${escapeHtml(wetboekRecordState.formError)}</p>` : ""}
            <div class="meos-form-actions">
              <button class="meos-secondary muted" type="button" data-close-record-modal>Annuleren</button>
              <button class="meos-primary" type="button" data-save-record-modal ${wetboekRecordState.busy ? "disabled" : ""}>${escapeHtml(saveLabel)}</button>
            </div>
          </section>
        </div>
      </section>
    `;
    modal.hidden = false;
    document.body.classList.add("meos-modal-open");
  }

  function focusWetboekField(name) {
    const field = $(`[data-wetboek-field="${name}"]`);
    if (!field) return;
    field.focus();
    if (typeof field.setSelectionRange === "function") {
      const end = String(field.value || "").length;
      field.setSelectionRange(end, end);
    }
  }

  function openWetboekRecordModal(personId = activePersonId) {
    if (!canWriteMeosEntries()) {
      window.alert("Je MEOS rol mag geen strafbladen toevoegen.");
      return;
    }
    wetboekRecordState.personId = personId;
    wetboekRecordState.formError = "";
    wetboekRecordState.query = "";
    wetboekRecordState.category = "all";
    wetboekRecordState.articleModifiers = {};
    wetboekRecordState.selected = [];
    wetboekRecordState.date = todayMeosDate();
    wetboekRecordState.sanction = "PV";
    wetboekRecordState.extraNote = "";
    wetboekRecordState.createFine = false;
    wetboekRecordState.fineAmount = "";
    wetboekRecordState.busy = false;
    renderWetboekRecordModal();
    loadWetboekArticles();
  }

  function closeWetboekRecordModal() {
    const modal = $("#meosRecordModal");
    if (modal) {
      modal.hidden = true;
      modal.innerHTML = "";
    }
    wetboekRecordState.personId = "";
    wetboekRecordState.formError = "";
    wetboekRecordState.busy = false;
    document.body.classList.remove("meos-modal-open");
  }

  function addWetboekArticle(articleId) {
    const article = wetboekArticleById(articleId);
    if (!article || wetboekRecordState.selected.some((item) => item.articleId === article.id)) return;
    if (wetboekRecordState.selected.length >= 10) {
      wetboekRecordState.formError = "Voeg maximaal 10 Wetboek artikelen per strafblad toe.";
      renderWetboekRecordModal();
      return;
    }
    const choice = wetboekArticleChoices(article)[0] || null;
    const modifiers = wetboekArticleModifier(article.id);
    wetboekRecordState.selected.push({
      articleId: article.id,
      tableIndex: choice?.tableIndex || "",
      rowIndex: choice?.rowIndex || "",
      officialInDuty: Boolean(modifiers.officialInDuty),
      attempted: Boolean(modifiers.attempted)
    });
    wetboekRecordState.formError = "";
    wetboekRecordState.fineAmount = "";
    renderWetboekRecordModal();
  }

  function removeWetboekSelection(articleId) {
    wetboekRecordState.selected = wetboekRecordState.selected.filter((item) => item.articleId !== articleId);
    wetboekRecordState.fineAmount = "";
    renderWetboekRecordModal();
  }

  function updateWetboekChoice(articleId, choiceKey) {
    const item = wetboekRecordState.selected.find((selection) => selection.articleId === articleId);
    if (!item) return;
    const [tableIndex, rowIndex] = String(choiceKey || "").split(":");
    item.tableIndex = tableIndex || "";
    item.rowIndex = rowIndex || "";
    wetboekRecordState.fineAmount = "";
    renderWetboekRecordModal();
  }

  function handleWetboekRecordInput(event) {
    const field = event.target.closest?.("[data-wetboek-field]");
    if (!field) return;
    const name = field.dataset.wetboekField;
    if (field.type === "checkbox") wetboekRecordState[name] = field.checked;
    else wetboekRecordState[name] = field.value;
    if (name === "query") {
      renderWetboekRecordModal();
      focusWetboekField("query");
    } else if (name === "extraNote") {
      const preview = $("[data-wetboek-note-preview]");
      if (preview) preview.value = wetboekRecordNoteWithExtra() || "Selecteer artikelen of vul een aanvullende notitie in.";
    }
  }

  function handleWetboekRecordChange(event) {
    const articleModifier = event.target.closest?.("[data-wetboek-article-modifier]");
    if (articleModifier) {
      setWetboekArticleModifier(articleModifier.dataset.articleId, articleModifier.dataset.wetboekArticleModifier, articleModifier.checked);
      return;
    }

    const rowChoice = event.target.closest?.("[data-wetboek-row-choice]");
    if (rowChoice) {
      updateWetboekChoice(rowChoice.dataset.wetboekRowChoice, rowChoice.value);
      return;
    }
    const field = event.target.closest?.("[data-wetboek-field]");
    if (!field) return;
    const name = field.dataset.wetboekField;
    if (field.type === "checkbox") wetboekRecordState[name] = field.checked;
    else wetboekRecordState[name] = field.value;
    if (["category", "createFine"].includes(name)) renderWetboekRecordModal();
  }

  async function submitWetboekRecordModal() {
    if (wetboekRecordState.busy) return;
    const personId = wetboekRecordState.personId || activePersonId;
    const note = wetboekRecordNoteWithExtra();
    if (!note.trim()) {
      wetboekRecordState.formError = "Selecteer minimaal een Wetboek artikel of vul een notitie in.";
      renderWetboekRecordModal();
      return;
    }
    if (note.length > 2000) {
      wetboekRecordState.formError = "De samengestelde strafbladtekst is te lang. Verwijder een artikel of verkort de extra notitie.";
      renderWetboekRecordModal();
      return;
    }
    const totals = calculateWetboekTotals();
    const body = {
      date: wetboekRecordState.date || todayMeosDate(),
      sanction: wetboekRecordState.sanction || "PV",
      verbalist: currentVerbalistName(),
      note,
      source: "wetboek",
      articleIds: wetboekRecordState.selected.map((item) => item.articleId).filter(Boolean),
      articleSelections: wetboekRecordState.selected.map((item) => ({
        articleId: item.articleId,
        tableIndex: item.tableIndex,
        rowIndex: item.rowIndex,
        officialInDuty: Boolean(item.officialInDuty),
        attempted: Boolean(item.attempted)
      })),
      calculatedTotals: {
        fine: String(totals.fine || ""),
        jailMonths: String(totals.jailMonths || ""),
        taskHours: String(totals.taskHours || ""),
        drivingBanMonths: String(totals.drivingBanMonths || ""),
        taskConverted: Boolean(totals.taskConverted)
      }
    };
    if (wetboekRecordState.createFine) {
      const amount = wetboekRecordFineAmount();
      if (!amount) {
        wetboekRecordState.formError = "Vul een boetebedrag in om direct een boete toe te voegen.";
        renderWetboekRecordModal();
        return;
      }
      body.createFine = true;
      body.fine = wetboekFineTitle();
      body.amount = amount;
      body.writtenAt = body.date;
      body.writtenBy = currentVerbalistName();
    }
    wetboekRecordState.busy = true;
    wetboekRecordState.formError = "";
    renderWetboekRecordModal();
    try {
      const payload = await apiJson(`/api/meos/people/${encodeURIComponent(personId)}/records`, {
        method: "POST",
        body
      });
      updatePersonInState(payload.person);
      closeWetboekRecordModal();
      renderProfile(payload.person?.id || personId, { updateUrl: false });
      renderPeople();
      renderWarrantOverview();
      renderQuickSearch();
    } catch (error) {
      wetboekRecordState.busy = false;
      wetboekRecordState.formError = error.message || "Strafblad opslaan is mislukt.";
      renderWetboekRecordModal();
    }
  }

  function updatePersonInState(updatedPerson) {
    if (!updatedPerson?.id) return;
    const normalizedPerson = normalizePersonData(updatedPerson);
    people = people.map((person) => person.id === normalizedPerson.id ? normalizedPerson : person);
    activePersonId = normalizedPerson.id;
  }

  async function loadMeosData() {
    renderDataLoading();
    try {
      const payload = await apiJson("/api/meos/data");
      const data = payload.data || {};
      meosDataSource = data.dataSource || null;
      meosDataLoaded = true;
      meosDataError = "";
      setMeosPeople(data.people || []);
      renderPeople();
      renderVehicles();
      renderWarrantOverview();
      renderQuickSearch();
      renderDataSourceStatus();
    } catch (error) {
      meosDataLoaded = false;
      meosDataError = error.message || "MEOS data kon niet worden geladen.";
      renderDataError(error);
      throw error;
    }
  }

  function allVehicles() {
    return people.flatMap((person) => (person.vehicles || []).map((vehicle) => ({ ...vehicle, owner: vehicle.owner || person.name, ownerId: vehicle.ownerId || person.id })));
  }

  function activeArrestWarrants() {
    return people.flatMap((person) => (person.arrestWarrants || [])
      .filter((warrant) => normalize(warrant.status || "actief") !== "gesloten")
      .map((warrant) => ({ ...warrant, person })));
  }

  function findPerson(id) {
    return people.find((person) => person.id === id) || people[0] || null;
  }

  function findPersonBySlug(slug) {
    const normalizedSlug = String(slug || "").trim().toLowerCase();
    return people.find((person) => personSlug(person).toLowerCase() === normalizedSlug || person.id.toLowerCase() === normalizedSlug) || null;
  }

  function findVehicle(value) {
    const normalizedValue = normalize(value);
    return allVehicles().find((vehicle) => normalize(vehicle.plate) === normalizedValue || normalize(vehicleSlug(vehicle)) === normalizedValue) || null;
  }

  function findVehicleBySlug(slug) {
    const normalizedSlug = String(slug || "").trim().toLowerCase();
    return allVehicles().find((vehicle) => vehicleSlug(vehicle).toLowerCase() === normalizedSlug || normalize(vehicle.plate) === normalize(normalizedSlug)) || null;
  }

  function vehicleOwnerPerson(vehicle) {
    if (!vehicle) return null;
    const ownerId = String(vehicle.ownerId || "").trim();
    if (ownerId) {
      const byId = people.find((person) => person.id === ownerId);
      if (byId) return byId;
    }
    const ownerName = normalize(vehicle.owner);
    if (!ownerName) return null;
    return people.find((person) => normalize(person.name) === ownerName) || null;
  }

  function renderVehicleOwnerField(vehicle) {
    const owner = vehicleOwnerPerson(vehicle);
    const ownerName = vehicle.owner || owner?.name || "-";
    if (!owner) return `<strong>${escapeHtml(ownerName)}</strong>`;
    return `
      <button
        class="meos-info-link"
        type="button"
        data-open-profile="${escapeHtml(owner.id)}"
        data-open-profile-vehicle="${escapeHtml(vehicle.plate)}"
        aria-label="Persoonsprofiel openen ${escapeHtml(owner.name)}"
      >${escapeHtml(ownerName)}</button>
    `;
  }

  function vehicleColor(vehicle) {
    return [
      vehicle.primaryColor,
      vehicle.secondaryColor && `Secundair ${vehicle.secondaryColor}`,
      vehicle.pearlColor && normalize(vehicle.pearlColor) !== "geen" && `Parelmoer ${vehicle.pearlColor}`
    ].filter(Boolean).join(" / ");
  }

  function vehicleStolenDetail(vehicle) {
    if (normalize(vehicle.stolen) !== "ja") return "Nee";
    return ["Ja", vehicle.stolenReason, vehicle.stolenDate].filter(Boolean).join(" - ");
  }

  function personSearchFields(person, field) {
    const fields = {
      name: [person.name],
      bsn: [person.bsn],
      fingerprint: [person.fingerprint],
      birthDate: [person.birthDate],
      all: [person.name, person.bsn, person.fingerprint, person.birthDate, person.status]
    };
    return fields[field] || fields.all;
  }

  function personSearchQueries(query, field = "all") {
    const raw = String(query || "").trim();
    const normalized = normalize(raw);
    const queries = new Set(normalized ? [normalized] : []);
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 4) {
      if (field === "bsn" || field === "all") queries.add(normalize(`ORP-BSN-${digits}`));
      if (field === "fingerprint" || field === "all") queries.add(normalize(`ORP-V-${digits}`));
    }
    return [...queries].filter(Boolean);
  }

  function personMatchesSearch(person, field, query) {
    const queries = personSearchQueries(query, field);
    if (!queries.length) return true;
    if ((field === "name" || field === "all") && fuzzyNameMatches(person.name, query)) return true;
    return personSearchFields(person, field).some((value) => {
      const normalizedValue = normalize(value);
      return queries.some((candidate) => normalizedValue.includes(candidate));
    });
  }

  function filteredPeople() {
    const query = $("#personSearch")?.value || "";
    const field = $("#personSearchField")?.value || "all";
    if (!query) return people;
    return people.filter((person) => personMatchesSearch(person, field, query));
  }

  function filteredVehicles() {
    const query = normalize($("#vehicleSearch")?.value || "");
    const vehicles = allVehicles();
    if (!query) return vehicles;
    return vehicles.filter((vehicle) => [
      vehicle.plate,
      vehicle.model,
      vehicle.owner,
      vehicle.primaryColor,
      vehicle.secondaryColor,
      vehicle.stolen,
      vehicle.stolenReason,
      vehicle.stolenDate,
      vehicle.impounded,
      vehicle.wok,
      vehicle.apkStatus,
      vehicle.vin
    ].some((value) => normalize(value).includes(query)));
  }

  function pagePath(page, options = {}) {
    if (page === "profile") {
      const person = options.person || findPerson(activePersonId);
      return person ? `/personen/${personSlug(person)}` : "/personen";
    }
    if (page === "vehicle") {
      const vehicle = options.vehicle || findVehicle(activeVehiclePlate);
      return vehicle ? `/voertuigen/${vehicleSlug(vehicle)}` : "/voertuigen";
    }
    if (page === "personen") return "/personen";
    if (page === "voertuigen") return "/voertuigen";
    if (page === "arrestatiebevelen") return "/arrestatiebevelen";
    if (page === "proces-verbaal") return "/proces-verbaal";
    if (page === "databron") return "/databron";
    return "/dashboard";
  }

  function updatePageUrl(page, options = {}) {
    if (options.updateUrl === false || !window.history?.pushState) return;
    const nextPath = pagePath(page, options);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ meos: true, page }, "", nextPath);
    }
  }

  function setPage(page, options = {}) {
    if (page === "databron" && !canViewDataHealth()) page = "dashboard";
    activePage = page;
    $$(".meos-page").forEach((element) => element.classList.toggle("active", element.dataset.page === page));
    const navPage = options.nav || (page === "profile" ? "personen" : page === "vehicle" ? "voertuigen" : page);
    $$(".meos-nav-item").forEach((button) => button.classList.toggle("active", button.dataset.section === navPage));
    document.body.classList.remove("sidebar-open");
    updatePageUrl(page, options);
    if (page === "databron") loadDataHealth();
  }

  function renderPeople() {
    const rows = filteredPeople();
    const count = $("#peopleCount");
    if (count) count.textContent = `${rows.length} ${rows.length === 1 ? "resultaat" : "resultaten"}`;
    const target = $("#personResults");
    if (!target) return;
    if (!rows.length) {
      target.innerHTML = '<div class="meos-empty">Geen personen gevonden.</div>';
      return;
    }
    target.innerHTML = rows.map((person) => {
      const wanted = personIsWanted(person);
      return `
      <article class="meos-result-card meos-person-row${wanted ? " wanted" : ""}" role="button" tabindex="0" data-open-profile="${escapeHtml(person.id)}" aria-label="Profiel openen van ${escapeHtml(person.name)}">
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <div class="meos-result-meta">
            <span class="meos-chip">BSN ${escapeHtml(person.bsn)}</span>
            <span class="meos-chip">Vingerafdruk ${escapeHtml(person.fingerprint)}</span>
            <span class="meos-chip">Geboren ${escapeHtml(person.birthDate)}</span>
          </div>
        </div>
      </article>
    `;
    }).join("");
  }

  function renderVehicleFields(vehicle) {
    const fields = [
      ["Model", vehicle.model],
      ["Inbeslaggenomen", vehicle.impounded],
      ["WOK", vehicle.wok],
      ["APK", vehicle.apkStatus],
      ["Primaire Kleur", vehicle.primaryColor],
      ["Secondaire Kleur", vehicle.secondaryColor],
      ["Parelmoer Kleur", vehicle.pearlColor],
      ["Gestolen", vehicle.stolen],
      ["Dienst Auto", vehicle.serviceVehicle]
    ];
    return `<div class="meos-info-grid">${fields.map(([label, value]) => `
      <div class="meos-info-field">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || "-")}</strong>
      </div>
    `).join("")}</div>`;
  }

  function parseMeosDateTimestamp(value) {
    const raw = String(value || "").trim();
    const iso = Date.parse(raw);
    if (Number.isFinite(iso)) return iso;
    const match = raw.toLowerCase().match(/(\d{1,2})\s+([a-z.]+)\s+(\d{4})/);
    if (!match) return 0;
    const months = {
      "jan.": 0,
      jan: 0,
      "feb.": 1,
      feb: 1,
      "mrt.": 2,
      mrt: 2,
      "apr.": 3,
      apr: 3,
      mei: 4,
      "jun.": 5,
      jun: 5,
      "jul.": 6,
      jul: 6,
      "aug.": 7,
      aug: 7,
      "sep.": 8,
      sep: 8,
      "okt.": 9,
      okt: 9,
      "nov.": 10,
      nov: 10,
      "dec.": 11,
      dec: 11
    };
    const month = months[match[2]];
    if (month == null) return 0;
    return new Date(Number(match[3]), month, Number(match[1])).getTime();
  }

  function timelineText(value, max = 140) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    return `${text.slice(0, max - 3)}...`;
  }

  function profileTimelineItems(person) {
    const items = [];
    (person.records || []).forEach((record, index) => items.push({
      type: "Strafblad",
      date: record.date || record.createdAt || "",
      title: record.sanction || "PV",
      meta: record.verbalist || "",
      text: record.note || "",
      tone: "danger",
      order: parseMeosDateTimestamp(record.createdAt || record.date) || (9000 - index)
    }));
    (person.notes || []).forEach((note, index) => items.push({
      type: "Notitie",
      date: note.date || note.createdAt || "",
      title: note.author || "MEOS",
      meta: "Notitie",
      text: note.note || "",
      tone: "info",
      order: parseMeosDateTimestamp(note.createdAt || note.date) || (8000 - index)
    }));
    (person.fines || []).forEach((fine, index) => items.push({
      type: "Boete",
      date: fine.writtenAt || fine.createdAt || "",
      title: fine.amount || "Boete",
      meta: fine.writtenBy || "",
      text: fine.fine || "",
      tone: "warning",
      order: parseMeosDateTimestamp(fine.createdAt || fine.writtenAt) || (7000 - index)
    }));
    (person.arrestWarrants || []).forEach((warrant, index) => items.push({
      type: "ArrestatieBevel",
      date: warrant.issuedAt || "",
      title: warrant.priority || warrant.status || "Actief",
      meta: warrant.issuedBy || "",
      text: warrant.reason || warrant.instruction || "",
      tone: "danger",
      order: parseMeosDateTimestamp(warrant.issuedAt) || (6000 - index)
    }));
    (person.vehicles || []).forEach((vehicle, index) => items.push({
      type: "Voertuig",
      date: vehicle.plate || "",
      title: vehicle.model || vehicle.plate || "Voertuig",
      meta: vehicleColor(vehicle),
      text: vehicleStolenDetail(vehicle),
      tone: normalize(vehicle.stolen) === "ja" ? "danger" : "info",
      order: 1000 - index
    }));
    return items.sort((left, right) => right.order - left.order).slice(0, 8);
  }

  function renderProfileTimeline(person) {
    const items = profileTimelineItems(person);
    if (!items.length) return '<div class="meos-empty">Nog geen tijdlijngegevens gevonden.</div>';
    return `<div class="meos-timeline">${items.map((item) => `
      <article class="meos-timeline-item ${escapeHtml(item.tone)}">
        <span>${escapeHtml(item.type)}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml([item.date, item.meta].filter(Boolean).join(" - "))}</p>
        ${item.text ? `<small>${escapeHtml(timelineText(item.text))}</small>` : ""}
      </article>
    `).join("")}</div>`;
  }

  function entryIdentifier(entry, type, index) {
    return String(entry?.id || `${type}-${index}`).trim();
  }

  function deleteEntryButton(person, type, entry, index, label = "Verwijderen") {
    if (!canDeleteMeosEntries()) return "";
    return `<button class="meos-danger-action" type="button" data-delete-entry="${escapeHtml(type)}" data-person-id="${escapeHtml(person.id)}" data-entry-id="${escapeHtml(entryIdentifier(entry, type, index))}">${escapeHtml(label)}</button>`;
  }

  function renderRecordEntryForm(person) {
    return `
      <form class="meos-entry-form" data-meos-add-record-form data-person-id="${escapeHtml(person.id)}" hidden>
        <div class="meos-form-grid">
          <label>
            <span>Datum</span>
            <input name="date" type="text" value="${escapeHtml(todayMeosDate())}" maxlength="40" />
          </label>
          <label>
            <span>Sanctie</span>
            <input name="sanction" type="text" placeholder="PV, waarschuwing, signalering" maxlength="80" required />
          </label>
          <label>
            <span>Verbalisant</span>
            <input name="verbalist" type="text" value="${escapeHtml(currentVerbalistName())}" maxlength="120" />
          </label>
          <label class="wide">
            <span>Notitie</span>
            <textarea name="note" rows="4" maxlength="2000" required></textarea>
          </label>
        </div>
        <p class="meos-form-error" data-form-error hidden></p>
        <div class="meos-form-actions">
          <button class="meos-primary" type="submit">Opslaan</button>
          <button class="meos-secondary muted" type="button" data-close-entry-form>Annuleren</button>
        </div>
      </form>
    `;
  }

  function renderNoteEntryForm(person) {
    return `
      <form class="meos-entry-form" data-meos-add-note-form data-person-id="${escapeHtml(person.id)}" hidden>
        <div class="meos-form-grid">
          <label>
            <span>Datum</span>
            <input name="date" type="text" value="${escapeHtml(todayMeosDate())}" maxlength="40" />
          </label>
          <label>
            <span>Verbalisant</span>
            <input name="author" type="text" value="${escapeHtml(currentVerbalistName())}" maxlength="120" />
          </label>
          <label class="wide">
            <span>Notitie</span>
            <textarea name="note" rows="4" maxlength="2000" required></textarea>
          </label>
        </div>
        <p class="meos-form-error" data-form-error hidden></p>
        <div class="meos-form-actions">
          <button class="meos-primary" type="submit">Opslaan</button>
          <button class="meos-secondary muted" type="button" data-close-entry-form>Annuleren</button>
        </div>
      </form>
    `;
  }

  function renderVehicleDetail(vehicleKey = activeVehiclePlate, options = {}) {
    const vehicle = findVehicle(vehicleKey) || allVehicles()[0];
    const target = $("#vehicleDetailView");
    if (!target) return;
    if (!vehicle) {
      target.innerHTML = '<div class="meos-empty">Geen voertuig geselecteerd.</div>';
      $("#vehicleBreadcrumb").textContent = "Voertuigen / Detail";
      setPage("vehicle", { nav: "voertuigen", updateUrl: options.updateUrl });
      return;
    }
    activeVehiclePlate = vehicle.plate;
    activePersonId = vehicle.ownerId || activePersonId;
    target.innerHTML = `
      <div class="meos-profile-col">
        <article class="meos-panel">
          <div class="meos-card-title">
            <h2 id="vehicleDetailTitle">Voertuig ${escapeHtml(vehicle.plate)}</h2>
          </div>
          <div class="meos-info-grid">
            <div class="meos-info-field"><span>Kenteken</span><strong>${escapeHtml(vehicle.plate)}</strong></div>
            <div class="meos-info-field"><span>Eigenaar</span>${renderVehicleOwnerField(vehicle)}</div>
            <div class="meos-info-field"><span>Model</span><strong>${escapeHtml(vehicle.model)}</strong></div>
            <div class="meos-info-field"><span>VIN</span><strong>${escapeHtml(vehicle.vin)}</strong></div>
            <div class="meos-info-field"><span>Kleur van voertuig</span><strong>${escapeHtml(vehicleColor(vehicle))}</strong></div>
          </div>
        </article>
      </div>

      <div class="meos-profile-col">
        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Voertuig informatie</h2>
          </div>
          <div class="meos-info-grid">
            <div class="meos-info-field"><span>APK Status</span><strong>${escapeHtml(vehicle.apkStatus || "-")}</strong></div>
            <div class="meos-info-field"><span>WOK status</span><strong>${escapeHtml(vehicle.wok || "-")}</strong></div>
            <div class="meos-info-field"><span>Gestolen</span><strong>${escapeHtml(vehicleStolenDetail(vehicle))}</strong></div>
            <div class="meos-info-field"><span>Inbeslaggenomen</span><strong>${escapeHtml(vehicle.impounded)}</strong></div>
            <div class="meos-info-field"><span>Dienst Auto</span><strong>${escapeHtml(vehicle.serviceVehicle)}</strong></div>
          </div>
        </article>
      </div>
    `;
    $("#vehicleBreadcrumb").textContent = `Voertuigen / ${vehicle.plate}`;
    setPage("vehicle", { nav: "voertuigen", vehicle, updateUrl: options.updateUrl });
  }

  function renderProfile(personId = activePersonId, options = {}) {
    const person = findPerson(personId);
    const target = $("#profileView");
    if (!target) return;
    if (!person) {
      target.innerHTML = '<div class="meos-empty">Geen persoon geselecteerd.</div>';
      $("#profileBreadcrumb").textContent = "Personen / Profiel";
      setPage("profile", { nav: "personen", updateUrl: options.updateUrl });
      return;
    }
    activePersonId = person.id;
    const personVehicles = person.vehicles || [];
    const selectedVehicle = personVehicles.find((vehicle) => vehicle.plate === activeVehiclePlate) || personVehicles[0];
    activeVehiclePlate = selectedVehicle?.plate || "";
    const activeRecord = person.records[0] || null;
    const profileTitle = `${person.name}`;
    const canWrite = canWriteMeosEntries();
    const recordDates = person.records.map((record, index) => `
      <button class="${index === 0 ? "active" : ""}" type="button" data-record-index="${index}">${escapeHtml(record.date)}</button>
    `).join("");
    target.innerHTML = `
      <div class="meos-profile-col">
        <article class="meos-panel">
          <div class="meos-card-title">
            <h2 id="profileTitle">Persoon ${escapeHtml(profileTitle)}</h2>
          </div>
          <div class="meos-info-grid">
            <div class="meos-info-field"><span>Geslacht</span><strong>${escapeHtml(person.gender)}</strong></div>
            <div class="meos-info-field"><span>BSN</span><strong>${escapeHtml(person.bsn)}</strong></div>
            <div class="meos-info-field"><span>Geboortedatum</span><strong>${escapeHtml(person.birthDate)}</strong></div>
            <div class="meos-info-field"><span>Lengte</span><strong>${escapeHtml(person.height)}</strong></div>
            <div class="meos-info-field"><span>Vingerafdruk</span><strong>${escapeHtml(person.fingerprint)}</strong></div>
            <div class="meos-info-field"><span>Status</span><strong>${escapeHtml(person.status)}</strong></div>
          </div>
          <div class="meos-license-list">${person.licenses.map((license) => `<span>${escapeHtml(license)}</span>`).join("")}</div>
        </article>

        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Voertuigen aantal: ${personVehicles.length}</h2>
            <button class="meos-secondary" type="button" data-section-shortcut="voertuigen">Voertuigen</button>
          </div>
          <div class="meos-vehicle-tabs">
            ${personVehicles.map((vehicle) => `<button class="${vehicle.plate === selectedVehicle?.plate ? "active" : ""}" type="button" data-profile-vehicle="${escapeHtml(vehicle.plate)}">Kenteken: ${escapeHtml(vehicle.plate)}</button>`).join("")}
          </div>
          ${selectedVehicle ? renderVehicleFields(selectedVehicle) : '<div class="meos-empty">Geen voertuigen gekoppeld.</div>'}
        </article>

        <article class="meos-panel">
          <h2>Huisvestigingen</h2>
          ${person.houses.length ? `
            <table class="meos-table">
              <thead><tr><th>Locatie</th><th>Pand</th><th>Status</th></tr></thead>
              <tbody>${person.houses.map((house) => `<tr><td>${escapeHtml(house.location)}</td><td>${escapeHtml(house.building)}</td><td>${escapeHtml(house.status)}</td></tr>`).join("")}</tbody>
            </table>
          ` : '<div class="meos-empty">Geen huisvestigingen gevonden.</div>'}
        </article>
      </div>

      <div class="meos-profile-col">
        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Tijdlijn</h2>
          </div>
          ${renderProfileTimeline(person)}
        </article>

        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Strafbladen</h2>
            ${canWrite ? '<button class="meos-secondary" type="button" data-toggle-record-form>Toevoegen</button>' : ""}
          </div>
          ${canWrite ? renderRecordEntryForm(person) : ""}
          ${person.records.length ? `<div class="meos-date-tabs">${recordDates}</div><div id="recordDetail">${renderRecord(activeRecord, 0, person)}</div>` : '<div class="meos-empty">Geen strafbladen gevonden.</div>'}
        </article>

        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Notitie's</h2>
            ${canWrite ? '<button class="meos-secondary" type="button" data-toggle-note-form>Toevoegen</button>' : ""}
          </div>
          ${canWrite ? renderNoteEntryForm(person) : ""}
          ${person.notes.length ? `
            <table class="meos-table">
              <thead><tr><th>Datum</th><th>Verbalisant</th><th>Notitie</th>${canDeleteMeosEntries() ? "<th>Beheer</th>" : ""}</tr></thead>
              <tbody>${person.notes.map((note, index) => `<tr><td>${escapeHtml(note.date)}</td><td>${escapeHtml(note.author)}</td><td>${escapeHtml(note.note)}</td>${canDeleteMeosEntries() ? `<td>${deleteEntryButton(person, "note", note, index)}</td>` : ""}</tr>`).join("")}</tbody>
            </table>
          ` : '<div class="meos-empty">Geen notities gevonden.</div>'}
        </article>

        <article class="meos-panel">
          <h2>Openstaande boete's</h2>
          ${person.fines.length ? `
            <table class="meos-table">
              <thead><tr><th>Boete</th><th>Bedrag</th><th>Uitgeschreven op</th><th>Uitgeschreven door</th>${canDeleteMeosEntries() ? "<th>Beheer</th>" : ""}</tr></thead>
              <tbody>${person.fines.map((fine, index) => `<tr><td>${escapeHtml(fine.fine)}</td><td>${escapeHtml(fine.amount)}</td><td>${escapeHtml(fine.writtenAt)}</td><td>${escapeHtml(fine.writtenBy)}</td>${canDeleteMeosEntries() ? `<td>${deleteEntryButton(person, "fine", fine, index)}</td>` : ""}</tr>`).join("")}</tbody>
            </table>
          ` : '<div class="meos-empty">Geen openstaande boetes gevonden.</div>'}
        </article>
      </div>
    `;
    $("#profileBreadcrumb").textContent = `Personen / ${person.name}`;
    setPage("profile", { nav: "personen", person, updateUrl: options.updateUrl });
  }

  function renderRecord(record, index = 0, person = null) {
    if (!record) return '<div class="meos-empty">Geen strafblad geselecteerd.</div>';
    const badges = [
      ...(Array.isArray(record.articleIds) ? record.articleIds : []),
      record.calculatedTotals?.taskConverted ? "Taakstraf omgezet" : ""
    ].filter(Boolean);
    return `
      ${renderWetboekBadges(badges)}
      <div class="meos-record-body">
        <div>
          <div class="meos-info-field"><span>Sanctie</span><strong>${escapeHtml(record.sanction)}</strong></div>
          <div class="meos-info-field"><span>Notitie</span><strong>${escapeHtml(record.note)}</strong></div>
        </div>
        <div>
          <div class="meos-info-field"><span>Verbalisant</span><strong>${escapeHtml(record.verbalist)}</strong></div>
          <div class="meos-info-field"><span>Datum</span><strong>${escapeHtml(record.date)}</strong></div>
        </div>
      </div>
      ${person ? `<div class="meos-record-actions">${deleteEntryButton(person, "record", record, index)}</div>` : ""}
    `;
  }

  function renderVehicles() {
    const rows = filteredVehicles();
    const count = $("#vehicleCount");
    if (count) count.textContent = `${rows.length} ${rows.length === 1 ? "resultaat" : "resultaten"}`;
    const target = $("#vehicleResults");
    if (!target) return;
    if (!rows.length) {
      target.innerHTML = '<div class="meos-empty">Geen voertuigen gevonden.</div>';
      return;
    }
    target.innerHTML = rows.map((vehicle) => {
      const stolen = normalize(vehicle.stolen) === "ja";
      const impounded = normalize(vehicle.impounded) === "ja";
      return `
        <article class="meos-result-card meos-vehicle-row" role="button" tabindex="0" data-open-vehicle="${escapeHtml(vehicle.plate)}" aria-label="Voertuig openen ${escapeHtml(vehicle.plate)}">
          <div>
            <strong>${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.model)}</strong>
            <div class="meos-result-meta">
              <span class="meos-chip">Eigenaar ${escapeHtml(vehicle.owner)}</span>
              <span class="meos-chip">VIN ${escapeHtml(vehicle.vin)}</span>
              <span class="meos-chip">Kleur ${escapeHtml(vehicleColor(vehicle))}</span>
              <span class="meos-chip">APK ${escapeHtml(vehicle.apkStatus)}</span>
              <span class="meos-chip ${normalize(vehicle.wok) === "ja" ? "warning" : "ok"}">WOK ${escapeHtml(vehicle.wok)}</span>
              <span class="meos-chip ${stolen ? "danger" : "ok"}">Gestolen ${escapeHtml(vehicle.stolen)}</span>
              <span class="meos-chip ${impounded ? "warning" : "ok"}">Inbeslag ${escapeHtml(vehicle.impounded)}</span>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderWarrantOverview() {
    const warrants = activeArrestWarrants();
    const count = $("#warrantCount");
    if (count) count.textContent = `${warrants.length} ${warrants.length === 1 ? "bevel" : "bevelen"} actief`;
    const target = $("#warrantOverview");
    if (!target) return;
    if (!warrants.length) {
      target.innerHTML = '<div class="meos-empty">Geen actieve arrestatiebevelen gevonden.</div>';
      return;
    }
    target.innerHTML = warrants.map((warrant) => `
      <article class="meos-warrant-card meos-result-card wanted" role="button" tabindex="0" data-open-profile="${escapeHtml(warrant.person.id)}" aria-label="Profiel openen van ${escapeHtml(warrant.person.name)}">
        <header>
          <div>
            <h3>${escapeHtml(warrant.person.name)}</h3>
            <p>${escapeHtml(warrant.id || "ArrestatieBevel")}</p>
          </div>
          <span class="meos-status high">${escapeHtml(warrant.priority || "Actief")}</span>
        </header>
        <dl class="meos-detail-list">
          <div><dt>BSN</dt><dd>${escapeHtml(warrant.person.bsn)}</dd></div>
          <div><dt>Geboortedatum</dt><dd>${escapeHtml(warrant.person.birthDate)}</dd></div>
          <div><dt>Reden</dt><dd>${escapeHtml(warrant.reason)}</dd></div>
          <div><dt>Uitgegeven op</dt><dd>${escapeHtml(warrant.issuedAt)}</dd></div>
          <div><dt>Uitgegeven door</dt><dd>${escapeHtml(warrant.issuedBy)}</dd></div>
          <div><dt>Instructie</dt><dd>${escapeHtml(warrant.instruction)}</dd></div>
        </dl>
      </article>
    `).join("");
  }

  function renderQuickSearch() {
    if (!meosDataLoaded) {
      const target = $("#dashboardSearchPreview");
      if (target) target.innerHTML = `<div class="meos-empty">${escapeHtml(meosDataError || "MEOS data laden...")}</div>`;
      return;
    }
    const rawQuery = $("#dashboardQuickSearch")?.value || "";
    const query = normalize(rawQuery);
    const target = $("#dashboardSearchPreview");
    if (!target) return;
    if (!query) {
      target.innerHTML = '<div class="meos-empty">Typ een zoekterm om personen en voertuigen te vinden.</div>';
      return;
    }
    const personMatches = people.filter((person) => personMatchesSearch(person, "all", rawQuery)).slice(0, 3);
    const vehicleMatches = allVehicles().filter((vehicle) => [vehicle.plate, vehicle.model, vehicle.owner].some((value) => normalize(value).includes(query))).slice(0, 3);
    const items = [
      ...personMatches.map((person) => `<button class="meos-result-card" type="button" data-open-profile="${escapeHtml(person.id)}"><span><strong>${escapeHtml(person.name)}</strong><span class="meos-result-meta"><span class="meos-chip">Persoon</span><span class="meos-chip">BSN ${escapeHtml(person.bsn)}</span></span></span></button>`),
      ...vehicleMatches.map((vehicle) => `<button class="meos-result-card" type="button" data-open-vehicle="${escapeHtml(vehicle.plate)}"><span><strong>${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.model)}</strong><span class="meos-result-meta"><span class="meos-chip">Voertuig</span><span class="meos-chip">${escapeHtml(vehicle.owner)}</span></span></span></button>`)
    ];
    target.innerHTML = items.length ? items.join("") : '<div class="meos-empty">Geen matches gevonden.</div>';
  }

  function routeFromLocation() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const segments = path.split("/").filter(Boolean);
    const first = (segments[0] || "").toLowerCase();
    if (path === "/" || first === "meos" || first === "dashboard") return { page: "dashboard", replace: path === "/" || first === "meos" };
    if (first === "personen" && segments[1]) {
      const slug = decodeURIComponent(segments.slice(1).join("-"));
      const person = findPersonBySlug(slug);
      return person ? { page: "profile", personId: person.id } : { page: "personen", replace: true };
    }
    if (first === "personen") return { page: "personen" };
    if (first === "voertuigen" && segments[1]) {
      const slug = decodeURIComponent(segments.slice(1).join("-"));
      const vehicle = findVehicleBySlug(slug);
      return vehicle ? { page: "vehicle", vehiclePlate: vehicle.plate } : { page: "voertuigen", replace: true };
    }
    if (first === "voertuigen") return { page: "voertuigen" };
    if (first === "arrestatiebevelen") return { page: "arrestatiebevelen" };
    if (first === "proces-verbaal" || first === "procesverbaal" || first === "pv") return { page: "proces-verbaal", replace: first !== "proces-verbaal" };
    if (first === "databron") return { page: "databron" };
    if (first === "at") return { page: "arrestatiebevelen", replace: true };
    return { page: "dashboard", replace: true };
  }

  function applyRouteFromLocation() {
    const route = routeFromLocation();
    if (route.page === "profile") {
      renderProfile(route.personId, { updateUrl: false });
    } else if (route.page === "vehicle") {
      renderVehicleDetail(route.vehiclePlate, { updateUrl: false });
    } else {
      setPage(route.page, { updateUrl: false });
    }
    if (route.replace && window.history?.replaceState) {
      const person = route.personId ? findPerson(route.personId) : null;
      const vehicle = route.vehiclePlate ? findVehicle(route.vehiclePlate) : null;
      window.history.replaceState({ meos: true, page: route.page }, "", pagePath(route.page, { person, vehicle }));
    }
  }

  function setFormError(form, message = "") {
    const target = $("[data-form-error]", form);
    if (!target) return;
    target.textContent = message;
    target.hidden = !message;
  }

  function setFormBusy(form, busy) {
    $$("button, input, textarea", form).forEach((element) => {
      element.disabled = busy;
    });
  }

  async function submitMeosEntryForm(form, type) {
    if (!canWriteMeosEntries()) {
      setFormError(form, "Je MEOS rol mag geen gegevens toevoegen.");
      return;
    }
    const personId = form.dataset.personId || activePersonId;
    const path = type === "record"
      ? `/api/meos/people/${encodeURIComponent(personId)}/records`
      : `/api/meos/people/${encodeURIComponent(personId)}/notes`;
    setFormError(form, "");
    setFormBusy(form, true);
    try {
      const payload = await apiJson(path, {
        method: "POST",
        body: formPayload(form)
      });
      updatePersonInState(payload.person);
      renderProfile(payload.person?.id || personId, { updateUrl: false });
      renderPeople();
      renderWarrantOverview();
      renderQuickSearch();
    } catch (error) {
      setFormError(form, error.message || "Opslaan is mislukt.");
      setFormBusy(form, false);
    }
  }

  async function deleteMeosEntry(button) {
    const type = String(button.dataset.deleteEntry || "").trim();
    const personId = button.dataset.personId || activePersonId;
    const entryId = button.dataset.entryId || "";
    const collections = {
      record: "records",
      note: "notes",
      fine: "fines"
    };
    const labels = {
      record: "strafblad",
      note: "notitie",
      fine: "boete"
    };
    const collection = collections[type];
    if (!collection || !personId || !entryId) return;
    if (!window.confirm(`Weet je zeker dat je deze ${labels[type]} wilt verwijderen?`)) return;
    button.disabled = true;
    try {
      const payload = await apiJson(`/api/meos/people/${encodeURIComponent(personId)}/${collection}/${encodeURIComponent(entryId)}`, {
        method: "DELETE"
      });
      updatePersonInState(payload.person);
      renderProfile(payload.person?.id || personId, { updateUrl: false });
      renderPeople();
      renderWarrantOverview();
      renderQuickSearch();
    } catch (error) {
      window.alert(error.message || "Verwijderen is mislukt.");
      button.disabled = false;
    }
  }

  function toggleEntryForm(selector) {
    const form = $(selector);
    if (!form) return;
    form.hidden = !form.hidden;
    setFormError(form, "");
    if (!form.hidden) {
      $("textarea, input", form)?.focus();
    }
  }

  function bindInterfaceGuards() {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
    document.addEventListener("keydown", (event) => {
      const key = String(event.key || "").toLowerCase();
      const blockedDevToolsShortcut = event.key === "F12"
        || (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key))
        || (event.ctrlKey && ["u", "s"].includes(key));
      if (blockedDevToolsShortcut) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Escape" && $("#meosRecordModal") && !$("#meosRecordModal").hidden) {
        closeWetboekRecordModal();
        return;
      }

      const clickableRow = event.target.closest?.(".meos-result-card[data-open-profile], .meos-result-card[data-open-vehicle]");
      if (clickableRow && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        clickableRow.click();
      }
    });
    document.addEventListener("change", (event) => {
      const input = event.target;
      if (shouldNormalizeImageInput(input)) normalizeImageInputFiles(input);
    });
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const navButton = event.target.closest("[data-section]");
      if (navButton) {
        setPage(navButton.dataset.section);
        return;
      }

      const shortcut = event.target.closest("[data-section-shortcut]");
      if (shortcut) {
        setPage(shortcut.dataset.sectionShortcut);
        return;
      }

      const openProfile = event.target.closest("[data-open-profile]");
      if (openProfile) {
        const personId = openProfile.dataset.openProfile || "";
        const person = people.find((candidate) => candidate.id === personId) || findPersonBySlug(personId);
        if (!person) return;
        const contextVehicle = openProfile.dataset.openProfileVehicle || "";
        const ownsContextVehicle = contextVehicle && (person.vehicles || []).some((vehicle) => normalize(vehicle.plate) === normalize(contextVehicle));
        activeVehiclePlate = ownsContextVehicle ? contextVehicle : person.vehicles?.[0]?.plate || "";
        renderProfile(person.id);
        return;
      }

      const openVehicle = event.target.closest("[data-open-vehicle]");
      if (openVehicle) {
        renderVehicleDetail(openVehicle.dataset.openVehicle);
        return;
      }

      const profileVehicle = event.target.closest("[data-profile-vehicle]");
      if (profileVehicle) {
        activeVehiclePlate = profileVehicle.dataset.profileVehicle;
        renderProfile(activePersonId);
        return;
      }

      if (event.target.closest("[data-toggle-record-form]")) {
        openWetboekRecordModal(activePersonId);
        return;
      }

      if (event.target.closest("[data-toggle-note-form]")) {
        toggleEntryForm("[data-meos-add-note-form]");
        return;
      }

      if (event.target.closest("[data-close-entry-form]")) {
        const form = event.target.closest("form");
        if (form) {
          form.hidden = true;
          setFormError(form, "");
          form.reset();
        }
        return;
      }

      if (event.target.closest("[data-close-record-modal]") || event.target.id === "meosRecordModal") {
        closeWetboekRecordModal();
        return;
      }

      const retryWetboek = event.target.closest("[data-retry-wetboek]");
      if (retryWetboek) {
        wetboekRecordState.loaded = false;
        wetboekRecordState.loading = false;
        wetboekRecordState.error = "";
        loadWetboekArticles();
        return;
      }

      const addWetboek = event.target.closest("[data-add-wetboek-article]");
      if (addWetboek) {
        addWetboekArticle(addWetboek.dataset.addWetboekArticle);
        return;
      }

      const removeWetboek = event.target.closest("[data-remove-wetboek-selection]");
      if (removeWetboek) {
        removeWetboekSelection(removeWetboek.dataset.removeWetboekSelection);
        return;
      }

      if (event.target.closest("[data-save-record-modal]")) {
        submitWetboekRecordModal();
        return;
      }

      const deleteEntry = event.target.closest("[data-delete-entry]");
      if (deleteEntry) {
        deleteMeosEntry(deleteEntry);
        return;
      }

      const recordButton = event.target.closest("[data-record-index]");
      if (recordButton) {
        const person = findPerson(activePersonId);
        const index = Number(recordButton.dataset.recordIndex);
        $$(".meos-date-tabs button").forEach((button) => button.classList.toggle("active", button === recordButton));
        $("#recordDetail").innerHTML = renderRecord(person?.records?.[index], index, person);
        return;
      }

      if (event.target.closest("[data-profile-back]")) {
        setPage("personen");
        return;
      }

      if (event.target.closest("[data-vehicle-back]")) {
        setPage("voertuigen");
        return;
      }

      if (event.target.closest("[data-dashboard-search]")) {
        renderQuickSearch();
        return;
      }

      if (event.target.closest("[data-refresh-data-health]")) {
        loadDataHealth(true);
        return;
      }

      if (event.target.closest("[data-toggle-sidebar]")) {
        document.body.classList.toggle("sidebar-open");
      }
    });

    document.addEventListener("submit", (event) => {
      const recordForm = event.target.closest?.("[data-meos-add-record-form]");
      if (recordForm) {
        event.preventDefault();
        submitMeosEntryForm(recordForm, "record");
        return;
      }
      const noteForm = event.target.closest?.("[data-meos-add-note-form]");
      if (noteForm) {
        event.preventDefault();
        submitMeosEntryForm(noteForm, "note");
      }
    });

    document.addEventListener("input", handleWetboekRecordInput);
    document.addEventListener("change", handleWetboekRecordChange);
    $("#personSearch")?.addEventListener("input", renderPeople);
    $("#personSearchField")?.addEventListener("change", renderPeople);
    $("#vehicleSearch")?.addEventListener("input", renderVehicles);
    $("#dashboardQuickSearch")?.addEventListener("input", renderQuickSearch);
    $("#meosThemeToggle")?.addEventListener("change", (event) => {
      setTheme(event.target.checked ? "dark" : "light");
    });
    $("#meosProfileLogout")?.addEventListener("click", logoutMeosProfile);
    $("#meosProfileAvatar")?.addEventListener("error", (event) => {
      event.currentTarget.src = defaultMeosProfile.avatarUrl;
    }, { once: true });
    window.addEventListener("popstate", applyRouteFromLocation);
  }

  async function init() {
    applyTheme(preferredTheme());
    renderMeosProfile(defaultMeosProfile, true);
    bindInterfaceGuards();
    bindEvents();
    await loadMeosSession();
    try {
      await loadMeosData();
      applyRouteFromLocation();
    } catch {
      setPage("dashboard", { updateUrl: false });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
