/* Defensie Personeelsportaal personeelmodule: personeel, medewerkers, W&S en personeelsdialogen. */

function getGroupForRank(rank) {
  const configuredGroup = (serviceNumberGroups || []).find((group) => (group.ranks || []).includes(rank));
  if (configuredGroup) return configuredGroup;
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

function getGroupsForRank(rank) {
  const configuredGroups = (serviceNumberGroups || []).filter((group) => (group.ranks || []).includes(rank));
  return configuredGroups.length ? configuredGroups : [getGroupForRank(rank)];
}

function formatService(prefix, number) {
  return `${prefix}-${String(number).padStart(2, "0")}`;
}

function personMatchesRankCategory(person, category) {
  if (!(category.ranks || []).includes(person.rank)) return false;
  if (!Array.isArray(category.ranges) || !category.ranges.length) return true;
  const match = /^(\d{2})-(\d{2,3})$/.exec(String(person.serviceNumber || "").trim());
  if (!match) return false;
  const prefix = match[1];
  const number = Number(match[2]);
  return category.ranges.some((range) => (
    String(range.prefix) === prefix
    && number >= Number(range.min)
    && number <= Number(range.max)
  ));
}

function getAvailableServiceNumbers(rank, permRole, currentId = "") {
  const groups = getGroupsForRank(rank);
  const used = new Set(
    state.people
      .filter((person) => person.id !== currentId)
      .filter((person) => person.status === "Actief")
      .map((person) => person.serviceNumber)
      .filter(Boolean)
  );
  const numbers = [];
  for (const group of groups) {
    for (let i = group.min; i <= group.max; i += 1) {
      const service = formatService(group.prefix, i);
      if (!used.has(service)) numbers.push(service);
    }
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

function usesManualRecruitServiceNumber() {
  return Boolean(organizationConfig?.manualRecruitServiceNumber);
}

function fillRecruitmentServiceSelect(selected = "") {
  const field = $("#recruitmentServiceField");
  const select = $("#recruitmentServiceNumber");
  if (!field || !select) return;

  if (!usesManualRecruitServiceNumber()) {
    field.hidden = true;
    select.required = false;
    select.innerHTML = "";
    return;
  }

  const rank = defaultRecruitRank || ranks[ranks.length - 1] || "";
  const numbers = getAvailableServiceNumbers(rank, "Geen");
  if (selected && !numbers.includes(selected)) numbers.unshift(selected);
  field.hidden = false;
  select.required = true;
  select.innerHTML = numbers.map((number) => `<option>${number}</option>`).join("");
  if (selected) select.value = selected;
}

function isAutoSortedPersonnelRank(rank) {
  const sortableRanks = new Set(organizationConfig?.autoSortRanks || []);
  return getGroupsForRank(rank).some((group) => (
    group.autoSort && (!sortableRanks.size || sortableRanks.has(rank))
  ));
}

function targetRankForAction(person, action) {
  const currentIndex = ranks.indexOf(person?.rank);
  if (currentIndex < 0) return "";
  if (action === "promote" && currentIndex > 0) return ranks[currentIndex - 1] || "";
  if (action === "demote" && currentIndex < ranks.length - 1) return ranks[currentIndex + 1] || "";
  return "";
}

function requiresManualRankChangeServiceNumber(person, action) {
  const targetRank = targetRankForAction(person, action);
  if (!organizationConfig?.manualRankChangeServiceNumber || !targetRank) return false;
  if (organizationConfig?.manualRankChangeServiceNumberForAllRanks) return true;
  return !isAutoSortedPersonnelRank(targetRank);
}

function serviceNumberChoicesForRankAction(person, action) {
  const targetRank = targetRankForAction(person, action);
  if (!targetRank) return [];
  return getAvailableServiceNumbers(targetRank, "Geen", person.id).map((number) => ({
    label: `${number} - ${targetRank}`,
    value: number
  }));
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
  const form = $("#recruitmentForm");
  if (!officer || !hiredDate) return;
  officer.value = current ? `${current.serviceNumber || "-"} - ${current.name}` : "";
  if (!hiredDate.value) hiredDate.value = today;
  const canView = canViewRecruitment();
  const canRecruit = canRecruitPeople();
  fillRecruitmentServiceSelect($("#recruitmentServiceNumber")?.value || "");
  if (form) {
    form.querySelectorAll("input, select, button").forEach((element) => {
      if (element.id === "recruitmentOfficer") return;
      element.disabled = !canRecruit;
    });
  }
  if (message) {
    if (!canView) {
      message.textContent = "Geen toegang.";
      message.hidden = false;
    } else if (!canRecruit) {
      message.textContent = "Alleen bekijken: deze rol kan geen personeel aannemen.";
      message.hidden = false;
    } else {
      message.hidden = true;
    }
  }
}

function personnelCurrentWeekHours(person) {
  const week = typeof currentHourWeek === "function" ? currentHourWeek() : null;
  if (!week || typeof hourEntryFor !== "function") return 0;
  const entry = hourEntryFor(person.id, week.weekYear, week.weekNumber);
  return Number(entry?.hours) || 0;
}

function personnelServiceTopWeek(date = new Date()) {
  if (typeof isoWeekInfo !== "function" || typeof isoWeekStart !== "function") {
    return typeof currentHourWeek === "function" ? currentHourWeek() : null;
  }
  const current = isoWeekInfo(date);
  const isSundayAfterCutoff = date.getDay() === 0 && (
    date.getHours() > 19 || (date.getHours() === 19 && date.getMinutes() >= 0)
  );
  if (isSundayAfterCutoff) return current;
  const previousStart = isoWeekStart(current.weekYear, current.weekNumber);
  previousStart.setUTCDate(previousStart.getUTCDate() - 7);
  return isoWeekInfo(previousStart);
}

function personnelServiceHoursForWeek(person, week) {
  if (!week || typeof hourEntryFor !== "function") return 0;
  const entry = hourEntryFor(person.id, week.weekYear, week.weekNumber);
  return Number(entry?.hours) || 0;
}

function personnelOpsHoursLastWeeks(person, count = 2) {
  if (typeof recentHourWeeks !== "function" || typeof opsHoursForWeek !== "function") return 0;
  return recentHourWeeks(count).reduce((sum, week) => sum + opsHoursForWeek(person, week), 0);
}

function personnelOperatorLabel() {
  return typeof portalOperatorLabel !== "undefined" && portalOperatorLabel ? portalOperatorLabel : "OPS";
}

function renderPersonnelHourBadges(person) {
  if (typeof isOvcOnlyProfile === "function" && isOvcOnlyProfile(person)) return "";
  const serviceHours = personnelCurrentWeekHours(person);
  const opsHours = personnelOpsHoursLastWeeks(person, 2);
  const operatorLabel = personnelOperatorLabel();
  const serviceText = typeof displayHourValue === "function" ? displayHourValue(serviceHours) : String(serviceHours);
  const opsText = typeof displayHourValue === "function" ? displayHourValue(opsHours) : String(opsHours);
  return `
    <span class="person-hours-badge service-hours" title="Diensturen huidige week">${escapeHtml(serviceText)}u dienst</span>
    <span class="person-hours-badge ops-hours" title="${escapeHtml(operatorLabel)} uren laatste 2 weken">${escapeHtml(opsText)}u ${escapeHtml(operatorLabel)}</span>
  `;
}

function personnelOpsHoursForTop(person) {
  return personnelOpsHoursLastWeeks(person, 2);
}

function renderPersonnelTopHoursList(title, subtitle, people, valueForPerson, className, emptyText = "Nog geen uren geregistreerd.") {
  const rows = people
    .map((person) => ({ person, hours: valueForPerson(person) }))
    .filter((entry) => entry.hours > 0)
    .sort((a, b) => {
      const hourDelta = b.hours - a.hours;
      if (hourDelta !== 0) return hourDelta;
      return (a.person.serviceNumber || "").localeCompare(b.person.serviceNumber || "", "nl", { numeric: true });
    })
    .slice(0, 5);
  return `
    <section class="personnel-top-hours ${className}">
      <div>
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(subtitle)}</span>
      </div>
      <div class="personnel-top-hours-list">
        ${rows.length ? rows.map((entry, index) => `
          <button class="personnel-top-hours-row" type="button" data-open-person-profile="${escapeHtml(entry.person.id)}">
            <span>${index + 1}</span>
            <strong>${escapeHtml(entry.person.serviceNumber || "-")}</strong>
            <em>${escapeHtml(entry.person.name || "Onbekend")}</em>
            <b>${escapeHtml(displayHourValue(entry.hours))}u</b>
          </button>
        `).join("") : `
          <div class="personnel-top-hours-row personnel-top-hours-empty">
            <span>-</span>
            <em>${escapeHtml(emptyText)}</em>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderPersonnelCard(person) {
  const isOvcOnly = typeof isOvcOnlyProfile === "function" && isOvcOnlyProfile(person);
  const status = statusInfoFor(person);
  const statusTitle = status.title || status.label;
  const rankServiceText = isOvcOnly
    ? "OVC"
    : `${person.rank || "-"} - ${person.serviceNumber || "Geen roepnummer"}`;
  return `
      <article class="person-card" data-person-card="${person.id}">
        <div class="card-menu-wrap">
          <button class="card-menu" type="button" aria-label="Meer opties">...</button>
          <div class="card-menu-panel">
            <button type="button" data-open-person-profile="${person.id}">Profiel openen</button>
            ${canManageInvestigationStatus() && person.status === "Actief" ? (person.ioStatus?.active
              ? `<button type="button" data-io-clear="${person.id}">I.O intrekken</button>`
              : `<button type="button" data-io-mark="${person.id}">I.O Melden</button>`) : ""}
            ${hasKaderAccess() ? `<button type="button" data-edit="${person.id}">Bewerken</button>` : ""}
            ${hasKaderAccess() ? `<button type="button" data-clear-history="${person.id}">Rang geschiedenis wissen</button>` : ""}
          </div>
        </div>
        <div class="person-head">
          <div class="avatar-status-wrap">
            <img class="avatar" src="${avatarFor(person)}" alt="" />
            <span class="status-dot ${status.className}" title="${escapeHtml(statusTitle)}" aria-label="${escapeHtml(statusTitle)}"></span>
          </div>
          <div>
            <span class="person-label">Naam</span>
            <h2>${escapeHtml(person.name)}</h2>
            <p class="muted">${escapeHtml(rankServiceText)}</p>
            <div class="person-status-line">
              <span class="person-status ${status.className}" title="${escapeHtml(statusTitle)}">${escapeHtml(status.label)}</span>
              ${renderPersonnelHourBadges(person)}
            </div>
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
          ${!isOvcOnly && canManagePersonnelRanksFor(person, "promote") && ranks.indexOf(person.rank) > 0 ? `<button class="primary" type="button" data-promote="${person.id}">Promotie</button>` : ""}
          ${!isOvcOnly && canManagePersonnelRanksFor(person, "demote") && ranks.indexOf(person.rank) < ranks.length - 1 ? `<button class="ghost secondary" type="button" data-demote="${person.id}">Degraderen</button>` : ""}
          ${canDismissPerson(person) ? `<button class="ghost danger" type="button" data-dismiss="${person.id}">Ontslag</button>` : ""}
        </div>
      </article>
  `;
}

function renderLeadershipOverview(people, allActivePeople, leaderRank = "Luitenant-Generaal") {
  const commander = people.find((person) => person.rank === leaderRank);
  const serviceTopWeek = personnelServiceTopWeek();
  const operatorLabel = personnelOperatorLabel();
  const commanderCard = commander
    ? renderPersonnelCard(commander)
    : `<div class="personnel-commander-empty">Geen ${escapeHtml(leaderRank)} ingesteld.</div>`;
  return `
    <div class="leadership-overview">
      <section class="personnel-commander-field">
        <div class="personnel-section-kicker">${escapeHtml(leaderRank)}</div>
        ${commanderCard}
      </section>
      <aside class="personnel-hours-top5" aria-label="Top 5 uren">
        ${renderPersonnelTopHoursList(
          `Meeste diensturen week ${serviceTopWeek?.weekNumber || "-"}`,
          "Tot zondag 19:00",
          allActivePeople,
          (person) => personnelServiceHoursForWeek(person, serviceTopWeek),
          "service-hours"
        )}
        ${renderPersonnelTopHoursList(`Top 5 ${operatorLabel} uren`, "Laatste 2 weken", allActivePeople, personnelOpsHoursForTop, "ops-hours")}
      </aside>
    </div>
  `;
}

function renderPeople() {
  const bulkHoursBtn = $("#bulkHoursBtn");
  if (bulkHoursBtn) bulkHoursBtn.hidden = !canManageHours();
  if (!canViewPersonnel()) {
    $("#peopleList").innerHTML = '<div class="feed-item">Geen toegang.</div>';
    return;
  }
  const query = $("#searchInput")?.value.toLowerCase() || "";  const people = state.people
    .filter((person) => person.status === "Actief")
    .filter((person) => {
      const haystack = `${person.name} ${person.rank} ${person.serviceNumber} ${person.permRole}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => {
      const rankDelta = (rankWeight.get(b.rank) || 0) - (rankWeight.get(a.rank) || 0);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
  const allActivePeople = state.people.filter((person) => person.status === "Actief");
  const ovcPeople = people.filter((person) => typeof isOvcOnlyProfile === "function" && isOvcOnlyProfile(person));

  const leadershipCategory = rankCategories[0] || {};
  const leadershipRank = leadershipCategory.ranks?.[0] || "";
  const hasLeadershipOverview = Boolean(leadershipCategory.title && leadershipRank);
  const groups = rankCategories
    .map((category) => ({
      ...category,
      rankGroups: category.ranks
        .filter((rank) => !(hasLeadershipOverview && category.title === leadershipCategory.title && rank === leadershipRank))
        .map((rank) => ({
          rank,
          people: people.filter((person) => person.rank === rank && personMatchesRankCategory(person, category))
        }))
        .filter((group) => group.people.length > 0)
    }))
    .filter((category) => category.rankGroups.length > 0 || (hasLeadershipOverview && category.title === leadershipCategory.title && people.some((person) => person.rank === leadershipRank && personMatchesRankCategory(person, category))));

  const ovcSection = ovcPeople.length
    ? `
      <section class="rank-category">
        <div class="rank-category-title">
          <h2>OVC</h2>
          <span>${ovcPeople.length}</span>
        </div>
        <section class="rank-group">
          <div class="rank-group-title count-left">
            <span>${ovcPeople.length}</span><h3>Overheid Coördinator</h3>
          </div>
          <div class="rank-group-list">
            ${ovcPeople.map(renderPersonnelCard).join("")}
          </div>
        </section>
      </section>
    `
    : "";

  $("#peopleList").innerHTML = groups
    .map((category) => `
      <section class="rank-category">
        <div class="rank-category-title">
          <h2>${escapeHtml(category.title)}</h2>
          <span>${category.rankGroups.reduce((sum, group) => sum + group.people.length, 0) + (hasLeadershipOverview && category.title === leadershipCategory.title && people.some((person) => person.rank === leadershipRank) ? 1 : 0)}</span>
        </div>
        ${hasLeadershipOverview && category.title === leadershipCategory.title ? renderLeadershipOverview(people, allActivePeople, leadershipRank) : ""}
        ${category.rankGroups
          .map((group) => `
            <section class="rank-group">
              <div class="rank-group-title count-left">
                <span>${group.people.length}</span><h3>${escapeHtml(group.rank)}</h3>
              </div>
              <div class="rank-group-list">
                ${group.people.map(renderPersonnelCard).join("")}
              </div>
            </section>
          `)
          .join("")}
      </section>
    `)
    .join("") + ovcSection;
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
      const rankDelta = (rankWeight.get(b.rank) || 0) - (rankWeight.get(a.rank) || 0);
      if (rankDelta !== 0) return rankDelta;
      return (a.serviceNumber || "").localeCompare(b.serviceNumber || "", "nl", { numeric: true });
    });
  const ovcPeople = people.filter((person) => typeof isOvcOnlyProfile === "function" && isOvcOnlyProfile(person));

  const ovcDirectory = ovcPeople.length
    ? `
      <section class="employee-group employee-group-kader">
        <div class="employee-group-title">
          <span class="employee-group-icon" aria-hidden="true">O</span>
          <h2>OVC</h2>
          <span class="employee-group-count">${ovcPeople.length}</span>
        </div>
        <div class="employee-table">
          ${ovcPeople.map((person) => `
            <button class="employee-row employee-row-kader" type="button" data-open-profile="${person.id}">
              <span class="employee-service-badge">OVC</span>
              <span class="employee-rank-badge">Overheid Coördinator</span>
              <strong>${escapeHtml(person.name)}</strong>
              ${(() => {
                const status = statusInfoFor(person);
                const statusTitle = status.title || status.label;
                return `<span class="employee-status ${status.className}" title="${escapeHtml(statusTitle)}">${escapeHtml(status.label)}</span>`;
              })()}
            </button>
          `).join("")}
        </div>
      </section>
    `
    : "";

  $("#employeeDirectory").innerHTML = rankCategories
    .map((category) => {
      const categoryPeople = people.filter((person) => personMatchesRankCategory(person, category));
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
                const statusTitle = status.title || status.label;
                return `
                  <button class="employee-row employee-row-${tone}" type="button" data-open-profile="${person.id}">
                    <span class="employee-service-number">${escapeHtml(person.serviceNumber || "-")}</span>
                    <span class="employee-rank-badge">${escapeHtml(person.rank)}</span>
                    <strong>${escapeHtml(person.name)}</strong>
                    <span class="employee-status ${status.className}" title="${escapeHtml(statusTitle)}">${escapeHtml(status.label)}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    })
    .join("") + ovcDirectory || '<div class="feed-item">Geen medewerkers gevonden.</div>';
}

function openMemberDialog(person = null) {
  const fallbackRank = defaultRecruitRank || ranks[ranks.length - 1] || "";
  $("#memberId").value = person?.id || "";
  $("#memberName").value = person?.name || "";
  $("#memberDiscord").value = person?.discordId || "";
  $("#memberAvatar").value = person?.avatar || "";
  $("#memberRank").value = person?.rank || fallbackRank;
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
  fillRestoreRankSelect(person.rank || defaultRecruitRank || ranks[ranks.length - 1] || "");
  $("#restoreDialog").showModal();
}

window.DefensiePortalModules.registerFeature("people", { ready: true });
