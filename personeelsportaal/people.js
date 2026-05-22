/* Defensie Personeelsportaal personeelmodule: personeel, medewerkers, W&S en personeelsdialogen. */

function getGroupForRank(rank) {
  if (["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"].includes(rank)) {
    return { prefix: "70", min: 1, max: 5, sortable: true };
  }
  if (["Kolonel", "Luitenant-Kolonel", "Majoor"].includes(rank)) {
    return { prefix: "71", min: 1, max: 15, sortable: true };
  }
  if (["Kapitein", "Eerste-Luitenant", "Tweede-Luitenant", "Kornet"].includes(rank)) {
    return { prefix: "72", min: 1, max: 50, sortable: true };
  }
  if (["Adjudant", "Opperwachtmeester", "Wachtmeester 1ste Klasser", "Wachtmeester"].includes(rank)) {
    return { prefix: "73", min: 1, max: 75, sortable: false };
  }
  return { prefix: "74", min: 1, max: 100, sortable: false };
}

function formatService(prefix, number) {
  return `${prefix}-${String(number).padStart(2, "0")}`;
}

function getAvailableServiceNumbers(rank, permRole, currentId = "") {
  const group = getGroupForRank(rank);
  const used = new Set(
    state.people
      .filter((person) => person.id !== currentId)
      .filter((person) => person.status === "Actief")
      .map((person) => person.serviceNumber)
      .filter(Boolean)
  );
  const numbers = [];
  for (let i = group.min; i <= group.max; i += 1) {
    const service = formatService(group.prefix, i);
    if (!used.has(service)) numbers.push(service);
  }
  return numbers;
}

function fillRankSelect() {
  $("#memberRank").innerHTML = ranks.map((rank) => `<option>${rank}</option>`).join("");
}

function fillRestoreRankSelect(selected = "") {
  const select = $("#restoreRank");
  if (!select) return;
  select.innerHTML = ranks.map((rank) => `<option>${rank}</option>`).join("");
  if (selected && ranks.includes(selected)) select.value = selected;
}

function fillServiceSelect(selected = "") {
  const rank = $("#memberRank").value;
  const currentId = $("#memberId").value;
  const numbers = getAvailableServiceNumbers(rank, "Geen", currentId);
  if (selected && !numbers.includes(selected)) numbers.unshift(selected);
  $("#memberService").innerHTML = numbers.map((number) => `<option>${number}</option>`).join("");
  if (selected) $("#memberService").value = selected;
}

function renderResignationForm() {
  const current = currentProfile();
  const memberField = $("#resignationMemberDisplay");
  const rankField = $("#resignationRankDisplay");
  if (!memberField || !rankField) return;
  memberField.value = current ? `${current.serviceNumber || "-"} - ${current.name}` : "";
  rankField.value = current?.rank || "";
}

function renderRecruitment() {
  const current = currentProfile();
  const officer = $("#recruitmentOfficer");
  const hiredDate = $("#recruitmentHiredDate");
  const message = $("#recruitmentMessage");
  if (!officer || !hiredDate) return;
  officer.value = current ? `${current.serviceNumber || "-"} - ${current.name}` : "";
  if (!hiredDate.value) hiredDate.value = today;
  if (message && !canRecruitPeople()) {
    message.textContent = "Geen toegang.";
    message.hidden = false;
  }
}

function renderPeople() {
  const bulkHoursBtn = $("#bulkHoursBtn");
  if (bulkHoursBtn) bulkHoursBtn.hidden = !canManageHours();
  const query = $("#searchInput")?.value.toLowerCase() || "";  const people = state.people
    .filter((person) => person.status === "Actief")
    .filter((person) => {
      const haystack = `${person.name} ${person.rank} ${person.serviceNumber} ${person.permRole}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });

  const groups = rankCategories
    .map((category) => ({
      ...category,
      rankGroups: category.ranks
        .map((rank) => ({
          rank,
          people: people.filter((person) => person.rank === rank)
        }))
        .filter((group) => group.people.length > 0)
    }))
    .filter((category) => category.rankGroups.length > 0);

  $("#peopleList").innerHTML = groups
    .map((category) => `
      <section class="rank-category">
        <div class="rank-category-title">
          <h2>${escapeHtml(category.title)}</h2>
          <span>${category.rankGroups.reduce((sum, group) => sum + group.people.length, 0)}</span>
        </div>
        ${category.rankGroups
          .map((group) => `
            <section class="rank-group">
              <div class="rank-group-title count-left">
                <span>${group.people.length}</span><h3>${escapeHtml(group.rank)}</h3>
              </div>
              <div class="rank-group-list">
                ${group.people.map((person) => `
      <article class="person-card" data-person-card="${person.id}">
        <div class="card-menu-wrap">
          <button class="card-menu" type="button" aria-label="Meer opties">...</button>
          <div class="card-menu-panel">
            <button type="button" data-open-person-profile="${person.id}">Profiel openen</button>
            <button type="button" data-edit="${person.id}">Bewerken</button>
            <button type="button" data-clear-history="${person.id}">Rang geschiedenis wissen</button>
          </div>
        </div>
        <div class="person-head">
          <div class="avatar-status-wrap">
            <img class="avatar" src="${avatarFor(person)}" alt="" />
            <span class="status-dot ${statusInfoFor(person).className}" title="${escapeHtml(statusInfoFor(person).label)}" aria-label="${escapeHtml(statusInfoFor(person).label)}"></span>
          </div>
          <div>
            <span class="person-label">Naam</span>
            <h2>${escapeHtml(person.name)}</h2>
            <p class="muted">${escapeHtml(person.rank)} - ${escapeHtml(person.serviceNumber || "Geen roepnummer")}</p>
            <span class="person-status ${statusInfoFor(person).className}">${escapeHtml(statusInfoFor(person).label)}</span>
          </div>
        </div>
        <div class="person-meta">
          <span>Datum aangenomen: ${escapeHtml(formatDate(hiredDateFor(person)))}</span>
          <span>Laatste promotie: ${escapeHtml(formatDate(person.promotionDate))}</span>
        </div>
        <details>
          <summary>Rang geschiedenis</summary>
          <div class="feed">
            ${(person.rankHistory || []).map((item) => `<div class="feed-item">${escapeHtml(formatDate(item.date))}: ${escapeHtml(item.rank)} (${escapeHtml(item.serviceNumber || "-")})</div>`).join("")}
          </div>
        </details>
        <div class="person-actions">
          ${hasKaderAccess() && ranks.indexOf(person.rank) > 0 ? `<button class="primary" type="button" data-promote="${person.id}">Promotie</button>` : ""}
          ${hasKaderAccess() && ranks.indexOf(person.rank) < ranks.length - 1 ? `<button class="ghost secondary" type="button" data-demote="${person.id}">Degraderen</button>` : ""}
          ${hasKaderAccess() ? `<button class="ghost danger" type="button" data-dismiss="${person.id}">Ontslag</button>` : ""}
        </div>
      </article>
                `).join("")}
              </div>
            </section>
          `)
          .join("")}
      </section>
    `)
    .join("");
}

function employeeCategoryTone(title) {
  if (title === "Kader") return "kader";
  if (title === "Hoofd-Officieren") return "hoofdofficier";
  if (title === "Officieren") return "officier";
  if (title === "Onderofficieren") return "onderofficier";
  return "manschap";
}

function renderEmployeeDirectory() {
  const query = $("#employeeSearchInput")?.value.toLowerCase() || "";
  const people = state.people
    .filter((person) => person.status === "Actief")
    .filter((person) => {
      const haystack = `${person.name} ${person.rank} ${person.serviceNumber}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const rankDelta = rankWeight.get(b.rank) - rankWeight.get(a.rank);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });

  $("#employeeDirectory").innerHTML = rankCategories
    .map((category) => {
      const categoryPeople = people.filter((person) => category.ranks.includes(person.rank));
      if (!categoryPeople.length) return "";
      const tone = employeeCategoryTone(category.title);
      return `
        <section class="employee-group employee-group-${tone}">
          <div class="employee-group-title">
            <span class="employee-group-icon" aria-hidden="true">${escapeHtml(category.title.slice(0, 1))}</span>
            <h2>${escapeHtml(category.title)}</h2>
            <span class="employee-group-count">${categoryPeople.length}</span>
          </div>
          <div class="employee-table">
            <div class="employee-row employee-row-head">
              <span>Dienstnummer</span>
              <span>Rang</span>
              <span>Naam</span>
              <span>Status</span>
            </div>
            ${categoryPeople
              .map((person) => {
                const status = statusInfoFor(person);
                return `
                  <button class="employee-row employee-row-${tone}" type="button" data-open-profile="${person.id}">
                    <span class="employee-service-number">${escapeHtml(person.serviceNumber || "-")}</span>
                    <span class="employee-rank-badge">${escapeHtml(person.rank)}</span>
                    <strong>${escapeHtml(person.name)}</strong>
                    <span class="employee-status ${status.className}">${escapeHtml(status.label)}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("") || '<div class="feed-item">Geen medewerkers gevonden.</div>';
}

function openMemberDialog(person = null) {
  $("#memberId").value = person?.id || "";
  $("#memberName").value = person?.name || "";
  $("#memberDiscord").value = person?.discordId || "";
  $("#memberAvatar").value = person?.avatar || "";
  $("#memberRank").value = person?.rank || "Marechaussee 4de Klasser";
  $("#memberHiredDate").value = person?.hiredDate || person?.rankHistory?.[0]?.date || person?.rankDate || today;
  $("#memberRankDate").value = person?.rankDate || today;
  $("#memberPromotionDate").value = person?.promotionDate || today;
  $("#memberTasks").value = person?.tasks || "";
  fillServiceSelect(person?.serviceNumber || "");
  $("#memberDialog").showModal();
}

function openDismissalDialog(person) {
  pendingDismissalId = person.id;
  $("#dismissalTitle").textContent = `${person.name} Ontslaan`;
  $("#dismissalReason").value = "";
  $("#dismissalDialog").showModal();
}

function openRestoreDialog(person) {
  pendingRestoreId = person.id;
  $("#restorePersonId").value = person.id;
  $("#restoreTitle").textContent = `${person.name} Herintrede`;
  fillRestoreRankSelect(person.rank || "Marechaussee 4de Klasser");
  $("#restoreDialog").showModal();
}

window.DefensiePortalModules.registerFeature("people", { ready: true });
