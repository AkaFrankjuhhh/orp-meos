(function () {
  const people = [
    {
      id: "ernie-nugz",
      name: "Ernie Nugz",
      gender: "M",
      bsn: "16751",
      fingerprint: "VN-8842-ER",
      birthDate: "17-03-1945",
      height: "171",
      status: "Geen signalering",
      licenses: ["Theorie", "Vrachtwagen Rijbewijs", "Auto Rijbewijs", "Motor Rijbewijs", "Zorgpas", "Vaarbewijs", "Heli Vliegbrevet", "Tol pas", "Eerste Hulp Pas"],
      vehicles: [
        { plate: "WFX 403", model: "BMX (velo)", impounded: "Nee", wok: "Nee", primaryColor: "Racing Blue", secondaryColor: "Black", pearlColor: "Light Blue", stolen: "Nee", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-BMX-403" },
        { plate: "OP-218-L", model: "Obey Oracle", impounded: "Nee", wok: "Nee", primaryColor: "Zwart", secondaryColor: "Wit", pearlColor: "Ice White", stolen: "Nee", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-ORA-218" },
        { plate: "AT-744", model: "Vapid Scout", impounded: "Ja", wok: "Nee", primaryColor: "Donkerblauw", secondaryColor: "Wit", pearlColor: "Chrome", stolen: "Nee", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-SCT-744" },
        { plate: "NUGZ-91", model: "Dinka Blista", impounded: "Nee", wok: "Ja", primaryColor: "Rood", secondaryColor: "Zwart", pearlColor: "Geen", stolen: "Nee", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-BLI-091" },
        { plate: "FST 017", model: "Shitzu Hakuchou", impounded: "Nee", wok: "Nee", primaryColor: "Wit", secondaryColor: "Blauw", pearlColor: "Silver", stolen: "Ja", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-HAK-017" }
      ],
      houses: [
        { location: "Mirror Park Boulevard 12", building: "Woning", status: "Actief" },
        { location: "Alta Street 4B", building: "Appartement", status: "Huur" }
      ],
      records: [
        { date: "27 jan. 2022", sanction: "PV", verbalist: "Matheo Van antwerpen", note: "Meneer reed 319 waar hij 130 mocht, voertuig word in beslag genomen." },
        { date: "6 dec. 2020", sanction: "Waarschuwing", verbalist: "Frank B.", note: "Onvolledige papieren bij verkeerscontrole." },
        { date: "27 nov. 2020", sanction: "PV", verbalist: "S. de Vries", note: "Niet opvolgen stopteken." },
        { date: "24 nov. 2020", sanction: "Notitie", verbalist: "Meldkamer", note: "Betrokken bij melding rond Legion Square." }
      ],
      notes: [
        { date: "27 jan. 2022", author: "Matheo Van antwerpen", note: "Meneer reed 319 waar hij 130 mocht, voertuig word in beslag genomen." },
        { date: "14 feb. 2021", author: "Recherche", note: "Controleer recente voertuigbewegingen bij opvolgende staandehouding." }
      ],
      fines: [
        { fine: "Snelheidsovertreding", amount: "EUR 1.250", writtenAt: "27 jan. 2022", writtenBy: "Matheo Van antwerpen" }
      ]
    },
    {
      id: "mila-voss",
      name: "Mila Voss",
      gender: "V",
      bsn: "88420",
      fingerprint: "VN-1200-MV",
      birthDate: "04-08-1998",
      height: "168",
      status: "Aandacht",
      licenses: ["Theorie", "Auto Rijbewijs", "Motor Rijbewijs"],
      vehicles: [
        { plate: "MV-884", model: "Karin Sultan", impounded: "Nee", wok: "Nee", primaryColor: "Pearl White", secondaryColor: "Black", pearlColor: "Blue", stolen: "Nee", serviceVehicle: "Nee", owner: "Mila Voss", vin: "ORP-SUL-884" }
      ],
      houses: [{ location: "Vespucci Canals 8", building: "Appartement", status: "Actief" }],
      records: [{ date: "12 mei 2026", sanction: "Waarschuwing", verbalist: "OC Politie", note: "Onrustig gedrag tijdens voertuigcontrole." }],
      notes: [{ date: "12 mei 2026", author: "OC Politie", note: "Geen verdere actie nodig, wel noteren voor opvolging." }],
      fines: []
    },
    {
      id: "damian-kroes",
      name: "Damian Kroes",
      gender: "M",
      bsn: "31977",
      fingerprint: "VN-5509-DK",
      birthDate: "23-11-1987",
      height: "182",
      status: "Gezocht voor verhoor",
      licenses: ["Theorie", "Auto Rijbewijs", "Vrachtwagen Rijbewijs"],
      vehicles: [
        { plate: "DK-319", model: "Benefactor Schafter", impounded: "Nee", wok: "Nee", primaryColor: "Grijs", secondaryColor: "Zwart", pearlColor: "Geen", stolen: "Nee", serviceVehicle: "Nee", owner: "Damian Kroes", vin: "ORP-SCH-319" },
        { plate: "TRK 550", model: "MTL Pounder", impounded: "Nee", wok: "Nee", primaryColor: "Wit", secondaryColor: "Blauw", pearlColor: "Geen", stolen: "Nee", serviceVehicle: "Nee", owner: "Damian Kroes", vin: "ORP-PND-550" }
      ],
      houses: [],
      records: [{ date: "2 aug. 2026", sanction: "Signalering", verbalist: "Recherche", note: "Graag staandehouden voor verhoor in onderzoek Havengebied." }],
      notes: [{ date: "2 aug. 2026", author: "Recherche", note: "Niet aanhouden zonder OvJ-contact, tenzij heterdaad." }],
      fines: [{ fine: "Openstaande boete", amount: "EUR 600", writtenAt: "18 jul. 2026", writtenBy: "Verkeersteam" }]
    }
  ];

  const atTeams = [
    { name: "AT-01", status: "Actief", tone: "active", commander: "Frank B.", members: "4 leden", location: "Mission Row", assignment: "Stand-by voor hoog risico melding", vehicle: "BearCat AT-01" },
    { name: "AT-02", status: "Stand-by", tone: "standby", commander: "S. de Vries", members: "3 leden", location: "Vespucci Bureau", assignment: "Ondersteuning DSI controle", vehicle: "Scout AT-02" },
    { name: "AT-03", status: "Hoog risico", tone: "high", commander: "Matheo V.", members: "5 leden", location: "Havengebied", assignment: "Doorzoeking voorbereiding", vehicle: "Unmarked Granger" }
  ];

  let activePage = "dashboard";
  let activePersonId = people[0].id;
  let activeVehiclePlate = people[0].vehicles[0].plate;

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

  function allVehicles() {
    return people.flatMap((person) => person.vehicles.map((vehicle) => ({ ...vehicle, owner: vehicle.owner || person.name, ownerId: person.id })));
  }

  function findPerson(id) {
    return people.find((person) => person.id === id) || people[0];
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
    return vehicles.filter((vehicle) => [vehicle.plate, vehicle.model, vehicle.owner, vehicle.primaryColor, vehicle.secondaryColor, vehicle.stolen, vehicle.impounded, vehicle.vin].some((value) => normalize(value).includes(query)));
  }

  function setPage(page, options = {}) {
    activePage = page;
    $$(".meos-page").forEach((element) => element.classList.toggle("active", element.dataset.page === page));
    const navPage = options.nav || (page === "profile" ? "personen" : page);
    $$(".meos-nav-item").forEach((button) => button.classList.toggle("active", button.dataset.section === navPage));
    document.body.classList.remove("sidebar-open");
  }

  function statusChip(status) {
    const normalized = normalize(status);
    const tone = normalized.includes("gezocht") ? "danger" : normalized.includes("aandacht") ? "warning" : "ok";
    return `<span class="meos-chip ${tone}">${escapeHtml(status)}</span>`;
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
    target.innerHTML = rows.map((person) => `
      <article class="meos-result-card">
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <div class="meos-result-meta">
            <span class="meos-chip">BSN ${escapeHtml(person.bsn)}</span>
            <span class="meos-chip">Vingerafdruk ${escapeHtml(person.fingerprint)}</span>
            <span class="meos-chip">Geboren ${escapeHtml(person.birthDate)}</span>
            ${statusChip(person.status)}
          </div>
        </div>
        <button class="meos-secondary" type="button" data-open-profile="${escapeHtml(person.id)}">Profiel openen</button>
      </article>
    `).join("");
  }

  function renderVehicleFields(vehicle) {
    const fields = [
      ["Model", vehicle.model],
      ["Inbeslaggenomen", vehicle.impounded],
      ["WOK", vehicle.wok],
      ["Primaire Kleur", vehicle.primaryColor],
      ["Secondaire Kleur", vehicle.secondaryColor],
      ["Parelmor Kleur", vehicle.pearlColor],
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

  function renderProfile(personId = activePersonId) {
    activePersonId = personId;
    const person = findPerson(personId);
    const selectedVehicle = person.vehicles.find((vehicle) => vehicle.plate === activeVehiclePlate) || person.vehicles[0];
    activeVehiclePlate = selectedVehicle?.plate || "";
    const target = $("#profileView");
    if (!target) return;
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
            <h2>Voertuigen aantal: ${person.vehicles.length}</h2>
            <button class="meos-secondary" type="button" data-section-shortcut="voertuigen">Voertuigen</button>
          </div>
          <div class="meos-vehicle-tabs">
            ${person.vehicles.map((vehicle) => `<button class="${vehicle.plate === selectedVehicle?.plate ? "active" : ""}" type="button" data-profile-vehicle="${escapeHtml(vehicle.plate)}">Kenteken: ${escapeHtml(vehicle.plate)}</button>`).join("")}
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
            <button class="meos-secondary" type="button">Toevoegen</button>
          </div>
          ${person.records.length ? `<div class="meos-date-tabs">${recordDates}</div><div id="recordDetail">${renderRecord(activeRecord)}</div>` : '<div class="meos-empty">Geen strafbladen gevonden.</div>'}
        </article>

        <article class="meos-panel">
          <div class="meos-card-title">
            <h2>Notitie's</h2>
            <button class="meos-secondary" type="button">Toevoegen</button>
          </div>
          ${person.notes.length ? `
            <table class="meos-table">
              <thead><tr><th>Datum</th><th>Verbalisant</th><th>Notitie</th></tr></thead>
              <tbody>${person.notes.map((note) => `<tr><td>${escapeHtml(note.date)}</td><td>${escapeHtml(note.author)}</td><td>${escapeHtml(note.note)}</td></tr>`).join("")}</tbody>
            </table>
          ` : '<div class="meos-empty">Geen notities gevonden.</div>'}
        </article>

        <article class="meos-panel">
          <h2>Openstaande boete's</h2>
          ${person.fines.length ? `
            <table class="meos-table">
              <thead><tr><th>Boete</th><th>Bedrag</th><th>Uitgeschreven op</th><th>Uitgeschreven door</th></tr></thead>
              <tbody>${person.fines.map((fine) => `<tr><td>${escapeHtml(fine.fine)}</td><td>${escapeHtml(fine.amount)}</td><td>${escapeHtml(fine.writtenAt)}</td><td>${escapeHtml(fine.writtenBy)}</td></tr>`).join("")}</tbody>
            </table>
          ` : '<div class="meos-empty">Geen openstaande boetes gevonden.</div>'}
        </article>
      </div>
    `;
    $("#profileBreadcrumb").textContent = `Personen / ${person.name}`;
    setPage("profile", { nav: "personen" });
  }

  function renderRecord(record) {
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
        <article class="meos-result-card">
          <div>
            <strong>${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.model)}</strong>
            <div class="meos-result-meta">
              <span class="meos-chip">Eigenaar ${escapeHtml(vehicle.owner)}</span>
              <span class="meos-chip">VIN ${escapeHtml(vehicle.vin)}</span>
              <span class="meos-chip">Kleur ${escapeHtml(vehicle.primaryColor)}</span>
              <span class="meos-chip ${stolen ? "danger" : "ok"}">Gestolen ${escapeHtml(vehicle.stolen)}</span>
              <span class="meos-chip ${impounded ? "warning" : "ok"}">Inbeslag ${escapeHtml(vehicle.impounded)}</span>
            </div>
          </div>
          <button class="meos-secondary" type="button" data-owner-profile="${escapeHtml(vehicle.ownerId)}" data-owner-plate="${escapeHtml(vehicle.plate)}">Eigenaar openen</button>
        </article>
      `;
    }).join("");
  }

  function renderAtOverview() {
    const target = $("#atOverview");
    if (!target) return;
    target.innerHTML = atTeams.map((team) => `
      <article class="meos-at-card">
        <header>
          <h3>${escapeHtml(team.name)}</h3>
          <span class="meos-status ${escapeHtml(team.tone)}">${escapeHtml(team.status)}</span>
        </header>
        <dl class="meos-detail-list">
          <div><dt>Commandant</dt><dd>${escapeHtml(team.commander)}</dd></div>
          <div><dt>Leden</dt><dd>${escapeHtml(team.members)}</dd></div>
          <div><dt>Locatie</dt><dd>${escapeHtml(team.location)}</dd></div>
          <div><dt>Voertuig</dt><dd>${escapeHtml(team.vehicle)}</dd></div>
          <div><dt>Inzet</dt><dd>${escapeHtml(team.assignment)}</dd></div>
        </dl>
      </article>
    `).join("");
  }

  function renderQuickSearch() {
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
      ...vehicleMatches.map((vehicle) => `<button class="meos-result-card" type="button" data-owner-profile="${escapeHtml(vehicle.ownerId)}" data-owner-plate="${escapeHtml(vehicle.plate)}"><span><strong>${escapeHtml(vehicle.plate)} - ${escapeHtml(vehicle.model)}</strong><span class="meos-result-meta"><span class="meos-chip">Voertuig</span><span class="meos-chip">${escapeHtml(vehicle.owner)}</span></span></span></button>`)
    ];
    target.innerHTML = items.length ? items.join("") : '<div class="meos-empty">Geen matches gevonden.</div>';
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
        activeVehiclePlate = findPerson(openProfile.dataset.openProfile).vehicles[0]?.plate || "";
        renderProfile(openProfile.dataset.openProfile);
        return;
      }

      const ownerProfile = event.target.closest("[data-owner-profile]");
      if (ownerProfile) {
        activeVehiclePlate = ownerProfile.dataset.ownerPlate || "";
        renderProfile(ownerProfile.dataset.ownerProfile);
        return;
      }

      const profileVehicle = event.target.closest("[data-profile-vehicle]");
      if (profileVehicle) {
        activeVehiclePlate = profileVehicle.dataset.profileVehicle;
        renderProfile(activePersonId);
        return;
      }

      const recordButton = event.target.closest("[data-record-index]");
      if (recordButton) {
        const person = findPerson(activePersonId);
        const index = Number(recordButton.dataset.recordIndex);
        $$(".meos-date-tabs button").forEach((button) => button.classList.toggle("active", button === recordButton));
        $("#recordDetail").innerHTML = renderRecord(person.records[index]);
        return;
      }

      if (event.target.closest("[data-profile-back]")) {
        setPage("personen");
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

    $("#personSearch")?.addEventListener("input", renderPeople);
    $("#personSearchField")?.addEventListener("change", renderPeople);
    $("#vehicleSearch")?.addEventListener("input", renderVehicles);
    $("#dashboardQuickSearch")?.addEventListener("input", renderQuickSearch);
  }

  function init() {
    bindEvents();
    renderPeople();
    renderVehicles();
    renderAtOverview();
    renderQuickSearch();
    setPage(activePage);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
