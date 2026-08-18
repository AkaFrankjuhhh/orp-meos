(function () {
  let people = [];
  let activePage = "dashboard";
  let activePersonId = "";
  let activeVehiclePlate = "";
  let meosDataLoaded = false;
  let meosDataError = "";
  let meosDataSource = null;
  let currentMeosProfile = null;
  const themeStorageKey = "orp-meos-theme";
  const defaultMeosProfile = {
    name: "Frank Bright",
    rank: "Brigadegeneraal",
    serviceNumber: "70-04",
    avatarUrl: "/assets/meos-logo.png?v=20260818-site-logo",
    permissions: {
      canDeleteEntries: false
    }
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

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
  }

  async function loadMeosSession() {
    try {
      const response = await fetch("/api/meos/session", {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error(`MEOS sessie ophalen mislukt (${response.status})`);
      const payload = await response.json();
      renderMeosProfile(payload.profile, Boolean(payload.authenticated));
    } catch {
      renderMeosProfile(defaultMeosProfile, false);
    }
  }

  async function logoutMeosProfile() {
    const logout = $("#meosProfileLogout");
    if (logout) logout.disabled = true;
    try {
      await fetch("/api/meos/logout", {
        method: "POST",
        credentials: "same-origin"
      });
      renderMeosProfile(defaultMeosProfile, false);
    } finally {
      if (logout) logout.disabled = false;
    }
  }

  async function apiJson(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    const fetchOptions = {
      ...options,
      headers,
      credentials: "same-origin"
    };
    if (Object.prototype.hasOwnProperty.call(options, "body") && typeof options.body !== "string") {
      fetchOptions.body = JSON.stringify(options.body || {});
      fetchOptions.headers = { ...headers, "Content-Type": "application/json" };
    }
    const response = await fetch(path, {
      ...fetchOptions
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) {
      const returnTo = encodeURIComponent(window.location.pathname || "/dashboard");
      window.location.href = payload?.loginUrl || `/api/meos/login?returnTo=${returnTo}`;
      throw new Error("MEOS login vereist.");
    }
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `MEOS API fout ${response.status}`);
    }
    return payload || {};
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
    syncLine.textContent = `Laatste synchronisatie: ${label} (${live}).`;
  }

  function todayMeosDate() {
    const date = new Date();
    const months = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
    return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  function currentVerbalistName() {
    return profileFullName(currentMeosProfile || defaultMeosProfile);
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

  function filteredPeople() {
    const query = normalize($("#personSearch")?.value || "");
    const field = $("#personSearchField")?.value || "all";
    if (!query) return people;
    return people.filter((person) => personSearchFields(person, field).some((value) => normalize(value).includes(query)));
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
    activePage = page;
    $$(".meos-page").forEach((element) => element.classList.toggle("active", element.dataset.page === page));
    const navPage = options.nav || (page === "profile" ? "personen" : page === "vehicle" ? "voertuigen" : page);
    $$(".meos-nav-item").forEach((button) => button.classList.toggle("active", button.dataset.section === navPage));
    document.body.classList.remove("sidebar-open");
    updatePageUrl(page, options);
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
            <div class="meos-info-field"><span>Eigenaar</span><strong>${escapeHtml(vehicle.owner)}</strong></div>
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
            <h2>Strafbladen</h2>
            <button class="meos-secondary" type="button" data-toggle-record-form>Toevoegen</button>
          </div>
          ${renderRecordEntryForm(person)}
          ${person.records.length ? `<div class="meos-date-tabs">${recordDates}</div><div id="recordDetail">${renderRecord(activeRecord, 0, person)}</div>` : '<div class="meos-empty">Geen strafbladen gevonden.</div>'}
        </article>

        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Notitie's</h2>
            <button class="meos-secondary" type="button" data-toggle-note-form>Toevoegen</button>
          </div>
          ${renderNoteEntryForm(person)}
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
    return `
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
    const query = normalize($("#dashboardQuickSearch")?.value || "");
    const target = $("#dashboardSearchPreview");
    if (!target) return;
    if (!query) {
      target.innerHTML = '<div class="meos-empty">Typ een zoekterm om personen en voertuigen te vinden.</div>';
      return;
    }
    const personMatches = people.filter((person) => personSearchFields(person, "all").some((value) => normalize(value).includes(query))).slice(0, 3);
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

  async function normalizeUploadedImageToPng(file) {
    if (!file?.type?.startsWith("image/")) return file;
    if (file.type === "image/png" && /\.png$/i.test(file.name || "")) return file;
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((pngBlob) => pngBlob ? resolve(pngBlob) : reject(new Error("PNG conversie mislukt.")), "image/png");
    });
    const name = String(file.name || "upload").replace(/\.[^.]+$/, "") || "upload";
    return new File([blob], `${name}.png`, { type: "image/png", lastModified: Date.now() });
  }

  function shouldNormalizeImageInput(input) {
    if (!input?.matches?.('input[type="file"]')) return false;
    const accept = String(input.getAttribute("accept") || "").toLowerCase();
    return input.dataset.meosPngUpload === "true" || accept.includes("image");
  }

  async function normalizeImageInputFiles(input) {
    const files = [...(input.files || [])];
    if (!files.length || typeof DataTransfer === "undefined") return;
    try {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(await normalizeUploadedImageToPng(file));
      input.files = transfer.files;
      input.dispatchEvent(new CustomEvent("meos:png-ready", { bubbles: true }));
    } catch {
      input.value = "";
      window.alert("Upload alleen afbeeldingen die naar PNG kunnen worden omgezet.");
    }
  }

  function formPayload(form) {
    const data = new FormData(form);
    return Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value || "").trim()]));
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
        const person = findPerson(openProfile.dataset.openProfile);
        activeVehiclePlate = person?.vehicles?.[0]?.plate || "";
        renderProfile(person?.id || openProfile.dataset.openProfile);
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
        toggleEntryForm("[data-meos-add-record-form]");
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
