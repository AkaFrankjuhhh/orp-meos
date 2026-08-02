const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const port = 4137;
const baseUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(process, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assert.equal(process.exitCode, null, "server exited before it became ready");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await wait(150);
  }
  throw new Error("server did not become ready in time");
}

test("portal boot assets are served under the production CSP", async () => {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      APP_BASE_URL: baseUrl,
      STORAGE_MODE: "json",
      DEV_ALLOW_UNAUTH: "false",
      NODE_ENV: "test"
    },
    stdio: "ignore"
  });

  try {
    await waitForServer(server);

    const index = await fetch(`${baseUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-security-policy") || "", /script-src 'self'/);

    for (const asset of ["/portal-boot.js", "/portal-client-errors.js", "/portal-loader-failsafe.js", "/boot-failsafe.js"]) {
      const response = await fetch(`${baseUrl}${asset}`);
      assert.equal(response.status, 200, `${asset} should be public`);
      assert.match(response.headers.get("content-type") || "", /text\/javascript/);
    }
  } finally {
    server.kill();
  }
});

test("portal shell uses absolute assets so deep profile routes hydrate", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const assetRefs = [...html.matchAll(/\b(?:href|src)="([^"]+\.(?:css|js)(?:\?[^"]*)?)"/g)].map((match) => match[1]);
  assert.ok(assetRefs.length > 10, "expected portal CSS and JS references");
  for (const ref of assetRefs) {
    assert.ok(ref.startsWith("/"), `${ref} should be absolute for /medewerkers/... routes`);
  }
});

test("portal lockscreen supports organization time-cycle backgrounds", () => {
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "shared.css"), "utf8");

  assert.match(appCode, /function currentLoginPeriod/);
  assert.match(appCode, /document\.body\.dataset\.organization = organizationKey/);
  assert.match(appCode, /document\.body\.dataset\.loginPeriod = currentLoginPeriod\(\)/);
  for (const period of ["morning", "day", "evening", "night"]) {
    assert.match(styles, new RegExp(`lockscreen-defensie-${period}\\.png`));
    assert.match(styles, new RegExp(`lockscreen-politie-${period}\\.png`));
  }
  assert.match(styles, /lockscreen-defensie\.png/);
  assert.match(styles, /lockscreen-politie\.png/);
  assert.match(styles, /--lockscreen-cycle-image/);
});

test("portal live refresh ignores the immediate echo after local actions", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");

  assert.match(html, /app\.js\?v=20260802-defensie-department-badges/);
  assert.match(appCode, /LIVE_REFRESH_LOCAL_ACTION_SUPPRESS_MS/);
  assert.match(appCode, /suppressImmediateLiveRefresh\(\);/);
  assert.match(appCode, /function isLiveRefreshSuppressed\(/);
});

test("portal boot waits for the app before revealing the shell", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const bootCode = fs.readFileSync(path.join(process.cwd(), "portal-boot.js"), "utf8");
  const loaderFailsafe = fs.readFileSync(path.join(process.cwd(), "portal-loader-failsafe.js"), "utf8");
  const bootFailsafe = fs.readFileSync(path.join(process.cwd(), "boot-failsafe.js"), "utf8");

  assert.match(html, /portal-boot\.js\?v=20260802-stylesheet-retry/);
  assert.match(appCode, /function markPortalReady\(/);
  assert.match(appCode, /window\.__orpBootReady\(\)/);
  assert.doesNotMatch(bootCode, /DOMContentLoaded/);
  assert.doesNotMatch(bootCode, /scheduleBootRelease|setTimeout\(releaseBoot/);
  assert.match(bootCode, /verifyCriticalStylesheets/);
  assert.match(bootCode, /maxStylesheetVerifyAttempts/);
  assert.match(bootCode, /link\.sheet/);
  assert.match(bootCode, /sheet\.ownerNode === link/);
  assert.match(bootCode, /Stijlbestand kon niet laden:/);
  assert.doesNotMatch(loaderFailsafe, /setTimeout|orp-app-ready|orp-app-booting|style\.visibility/);
  assert.doesNotMatch(bootFailsafe, /setTimeout|orp-app-ready|orp-app-booting|style\.visibility/);
});

test("porto saves duty hours before ended runtime units are cleaned up", () => {
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-postgres-store.js"), "utf8");
  const portoServerCode = fs.readFileSync(path.join(process.cwd(), "porto-server.js"), "utf8");

  assert.match(routesCode, /writePortoDutyHours/);
  assert.match(routesCode, /function persistPortoDutyHoursForUnits\(/);
  assert.match(routesCode, /persistPortoDutyHoursForUnits\(state, units\);[\s\S]*writePortoUnits\(units\)/);
  assert.match(storeCode, /function doWritePortoDutyHours\(/);
  assert.match(storeCode, /buildPortoDutyHourEntries/);
  assert.match(storeCode, /insert into hours/);
  assert.match(storeCode, /writePortoDutyHours/);
  assert.match(portoServerCode, /afterHoursWrite: \(\) => afterStorageWrite\("people"\)/);
  assert.match(portoServerCode, /writePortoDutyHours: portoStorage\.writePortoDutyHours/);
});

test("modern porto status 4 reason menu survives live refresh", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const portoCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const dutyCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");

  assert.match(html, /porto\/duty\.js\?v=20260728-status4-pending/);
  assert.match(html, /porto\.js\?v=20260731-ops-refresh-state/);
  assert.match(dutyCode, /let portoModernStatus4Pending = false/);
  assert.match(dutyCode, /const showChoices = portoModernStatus4Pending \|\| String\(portoDuty\?\.status\) === "4"/);
  assert.match(dutyCode, /entry\.code === "4" && portoModernStatus4Pending/);
  assert.match(portoCode, /if \(portoModernStatus4Pending\) return true/);
  assert.match(portoCode, /const choiceMenu = \$\("#portoChoiceContextMenu"\);/);
  assert.match(portoCode, /portoModernStatus4Pending = true;\s+renderDutyPanel\(\);/);
  assert.match(portoCode, /updatePortoStatus\("4", modernStatus4Button\.dataset\.modernStatus4\)/);
  assert.match(routesCode, /const rawStatus4Detail = status === "4"/);
  assert.match(routesCode, /rawStatus4Detail \|\| "Niet beschikbaar"/);
});

test("suggestion threads and vehicle seizures are wired", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const permissionsCode = fs.readFileSync(path.join(process.cwd(), "modules", "permissions.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const schema = fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "vehicle-seizures-store.js"), "utf8");
  const webhookCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-webhooks.js"), "utf8");
  const botWorkerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const politieEnvExample = fs.readFileSync(path.join(process.cwd(), ".env.politie.example"), "utf8");

  assert.match(html, /data-page="voertuiginbeslagname"/);
  assert.match(html, /vehicle-seizure-workspace/);
  assert.match(html, /vehicleSeizureOverviewTitle/);
  assert.match(html, /Registreer een nieuwe inbeslagname/);
  assert.match(html, /id="vehicleSeizureForm"/);
  assert.match(html, /id="vehicleSeizureList"/);
  assert.match(appCode, /voertuiginbeslagname: "\/voertuiginbeslagname"/);
  assert.match(appCode, /function renderVehicleSeizures\(/);
  assert.match(appCode, /\/api\/vehicle-seizures/);
  assert.match(appCode, /vehicle-seizures/);
  assert.match(styles, /\.vehicle-seizure-workspace/);
  assert.match(styles, /\.vehicle-seizure-create/);
  assert.match(styles, /\.vehicle-seizure-card/);
  assert.match(routesCode, /\/api\/vehicle-seizures/);
  assert.match(routesCode, /vehicleSeizuresStore\.createSeizure/);
  assert.match(routesCode, /vehicleSeizuresStore\.updateSeizureStatus/);
  assert.match(permissionsCode, /canManageVehicleSeizures/);
  assert.match(serverCode, /createVehicleSeizuresStore/);
  assert.match(serverCode, /"voertuiginbeslagname"/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS vehicle_seizures/);
  assert.match(storeCode, /VEHICLE_SEIZURE_DATABASE_URL/);
  assert.match(webhookCode, /vehicleSeizureWebhookUrl/);
  assert.match(webhookCode, /buildVehicleSeizureWebhookPayload/);
  assert.match(botWorkerCode, /DISCORD_SUGGESTIES_CHANNEL_ID \|\| "1434527756573610016"/);
  assert.match(botWorkerCode, /DISCORD_WETBOEK_SUGGESTIES_CHANNEL_ID \|\| "1489733814791049426"/);
  assert.match(botWorkerCode, /DISCORD_BUGMELDINGEN_CHANNEL_ID \|\| "1423417191717404722"/);
  assert.match(botWorkerCode, /name: "suggestie"/);
  assert.match(botWorkerCode, /MESSAGE_CREATE/);
  assert.match(botWorkerCode, /createThreadFromMessage/);
  assert.match(envExample, /VEHICLE_SEIZURE_DATABASE_URL/);
  assert.match(envExample, /DISCORD_SUGGESTION_AUTOTHREAD_ENABLED=true/);
  assert.match(politieEnvExample, /VEHICLE_SEIZURE_DATABASE_URL/);
});

test("mentor checklist autosave is serialized against live refresh", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const mentorCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "mentor.js"), "utf8");

  assert.match(html, /personeelsportaal\/mentor\.js\?v=20260726-mentor-log-current/);
  assert.match(mentorCode, /let mentorChecklistSavePromise = null/);
  assert.match(mentorCode, /let mentorChecklistSaveQueued = false/);
  assert.match(mentorCode, /function mentorChecklistStaleAfterReactivation\(/);
  assert.match(mentorCode, /reactivatedDate/);
  assert.match(mentorCode, /function isMentorChecklistSaveActive\(/);
  assert.match(mentorCode, /function isMentorLogPersonCurrent\(/);
  assert.match(mentorCode, /typeof isCurrentProfile === "function" \? isCurrentProfile\(person\) : person\.status === "Actief"/);
  assert.match(mentorCode, /if \(mentorChecklistSavePromise\) return mentorChecklistSavePromise/);
  assert.match(mentorCode, /while \(mentorChecklistSaveQueued\)/);
  assert.match(appCode, /isMentorChecklistSaveActive\(\)/);
  assert.match(appCode, /isSavingMentorChecklist/);
});

test("trainer sidebar exposes training logs and IBT reviews", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const trainerCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "trainer.js"), "utf8");
  const publicFormsCode = fs.readFileSync(path.join(process.cwd(), "public-forms.js"), "utf8");
  const publicFormsHtml = fs.readFileSync(path.join(process.cwd(), "public-forms.html"), "utf8");
  const publicFormsConfigCode = fs.readFileSync(path.join(process.cwd(), "modules", "public-forms.js"), "utf8");
  const permissionsCode = fs.readFileSync(path.join(process.cwd(), "modules", "permissions.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /data-trainer-section="true"/);
  assert.match(html, /data-page="trainer-overzicht"/);
  assert.match(html, /class="panel trainer-overview-panel"/);
  assert.match(html, /data-page="trainer-ibt"/);
  assert.match(html, /id="trainerIbtCounter"/);
  assert.match(html, /trainerIbtDetailDialog/);
  assert.match(html, /personeelsportaal\/trainer\.js\?v=20260731-police-off-training/);
  assert.match(appCode, /"trainer-overzicht": "\/trainer-overzicht"/);
  assert.match(appCode, /function canViewTrainerOverview\(/);
  assert.match(appCode, /refreshTrainerIbtReviewsSilently\(\)/);
  assert.match(appCode, /renderTrainerIbtReviews\(\)/);
  assert.match(permissionsCode, /canViewTrainerSection/);
  assert.match(permissionsCode, /canReviewTrainerIbtForms: isTrainer \|\| isTrainerLeadership/);
  assert.match(permissionsCode, /canViewProfileAuditLog: canViewAsKader \|\| isHoofdofficier \|\| canViewTrainerSection/);
  assert.match(routesCode, /addedTrainings: newTrainings/);
  assert.match(routesCode, /\/api\/trainer\/ibt-tests/);
  assert.match(routesCode, /Marechaussee 3de Klasser/);
  assert.match(routesCode, /buildIbtTestSentDm/);
  assert.match(routesCode, /queueDiscordDmForPerson\([\s\S]*buildIbtTestSentDm/);
  assert.match(serverCode, /publicFormsStore,/);
  assert.match(serverCode, /type: "qualification"[\s\S]*addedTrainings: \[training\]/);
  assert.match(serverCode, /"trainer-overzicht", "trainer-ibt", "trainer-logboek"/);
  assert.match(trainerCode, /function trainerEntryAddedTrainings/);
  assert.match(trainerCode, /function trainerEntryCoTrainerCredits/);
  assert.match(trainerCode, /typeof isCurrentProfile === "function" \? isCurrentProfile\(person\) : person\.status === "Actief"/);
  assert.match(trainerCode, /\/api\/trainer\/ibt-tests/);
  assert.match(trainerCode, /data-send-trainer-ibt/);
  assert.match(trainerCode, /data-open-trainer-ibt-detail/);
  assert.match(trainerCode, /data-review-trainer-ibt/);
  assert.match(trainerCode, /mentor-test-answer trainer-ibt-answer/);
  assert.match(trainerCode, /let trainerIbtRenderedMarkup = ""/);
  assert.match(trainerCode, /function refreshTrainerIbtReviewsSilently\(/);
  assert.match(trainerCode, /keepExistingOnError/);
  assert.match(trainerCode, /function setTrainerIbtReviewListHtml/);
  assert.match(publicFormsConfigCode, /reviewSurface: "portal"/);
  assert.match(publicFormsCode, /function canShowSubmissionReviewPanel\(/);
  assert.match(publicFormsCode, /formState\.config\?\.reviewSurface !== "portal"/);
  assert.match(publicFormsCode, /\[config\.systemNotice, config\.notice\]\.filter\(Boolean\)\.join\("\\n\\n"\)/);
  assert.match(publicFormsConfigCode, /systemNotice: "Let op: zonder bewijs wordt de zaak direct afgesloten\."/);
  assert.match(publicFormsHtml, /public-forms\.js\?v=20260728-complaint-evidence-notice/);
  assert.match(styles, /\.trainer-stats/);
  assert.match(styles, /#trainer-overzicht \.trainer-overview-panel \{[\s\S]*grid-template-rows: auto auto minmax\(0, 1fr\) minmax\(170px, 36%\);/);
  assert.match(styles, /#trainerOverviewList \{[\s\S]*overflow-y: auto;/);
  assert.match(styles, /#trainer-overzicht \.trainer-person-log \{[\s\S]*overflow-y: auto;/);
  assert.match(styles, /\.trainer-ibt-row/);
});

test("training completion can credit co-trainers", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const trainerCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "trainer.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /id="trainingCreditDialog"/);
  assert.match(html, /id="trainingCoTrainerOptions"/);
  assert.match(html, /data-training-co-trainer-row="3"/);
  assert.match(appCode, /const MAX_TRAINING_CREDIT_TRAINERS = 5/);
  assert.match(appCode, /function openTrainingCreditDialog/);
  assert.match(appCode, /payload\.coTrainers = coTrainers/);
  assert.match(routesCode, /function normalizeTrainingCoTrainers/);
  assert.match(routesCode, /function trainingCoTrainerCredits/);
  assert.match(routesCode, /coTrainerCredits/);
  assert.match(trainerCode, /trainerEntryCoTrainerCredits/);
  assert.match(trainerCode, /record\.isCoTrainer/);
  assert.match(styles, /#trainingCreditDialog/);
  assert.match(styles, /\.training-credit-co-trainers/);
});

test("profile badge context dialog groups controls with a summary", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const profileCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "profile.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /personeelsportaal\.css\?v=20260802-defensie-department-badges/);
  assert.match(html, /personeelsportaal\/profile\.js\?v=20260802-defensie-department-badges/);
  assert.match(html, /personeelsportaal-data\.js\?v=20260802-defensie-department-badges/);
  assert.match(html, /id="profileBadgeSummary"/);
  assert.match(html, /id="profileBadgeGroupedOptions"/);
  assert.match(profileCode, /function profileBadgeDialogGroups/);
  assert.match(profileCode, /function profileTrainingLabel\(/);
  assert.match(profileCode, /data-profile-badge-kind="\$\{escapeHtml\(kind\)\}"/);
  assert.match(profileCode, /profileBadgeTaskLeadershipOrder/);
  assert.match(profileCode, /profileBadgeTaskAssistantLeadershipOrder/);
  assert.match(profileCode, /profileBadgeBranchRows = \[/);
  assert.match(profileCode, /function orderedProfileBadgeMixedItems/);
  assert.match(profileCode, /leadership: "ME-Leiding", assistant: "ME-Assist\. Leiding", functionBadge: "ME"/);
  assert.match(profileCode, /leadership: "Wijkagent-Leiding", assistant: "Wijkagent-Assist\. Leiding", functionBadge: "Wijkagent"/);
  assert.match(profileCode, /profileBadgeTaskLeadershipOrder = \[\.\.\.profileBadgeBranchRows\.map/);
  assert.match(profileCode, /profileBadgeFunctionOrder = \[\.\.\.profileBadgeBranchRows\.map/);
  assert.match(profileCode, /title: "Assist\. Leiding"/);
  assert.doesNotMatch(profileCode, /profileBadgeOrganizationLeadership = \[[^\]]*"HR"/);
  assert.match(profileCode, /profileBadgeGeneralFunctionOrder = \[[^\]]*"HR"/);
  assert.match(profileCode, /orderedProfileBadgeMixedItems\(\[/);
  assert.match(profileCode, /generalFunctions\.map\(\(item\) => \(\{ item, kind: "function" \}\)\)/);
  assert.match(profileCode, /leadership: "HR-Leiding", assistant: "HR-Assist\. Leiding", functionBadge: "HR"/);
  assert.match(profileCode, /profileBadgeDefensieDirectieOrder = \["Directie Operatie", "Directie W&S", "Directie OTC"\]/);
  assert.match(profileCode, /profileBadgeDefensieTeamchefOrder = \["Teamchef Operatie", "Teamchef W&S", "Teamchef OTC"\]/);
  assert.match(profileCode, /profileBadgeDefensieCoordinatorOrder = \["Co\\u00f6rdinator Operatie", "Co\\u00f6rdinator W&S", "Co\\u00f6rdinator Mentor", "Co\\u00f6rdinator Trainer"\]/);
  assert.match(profileCode, /title: "Directie"/);
  assert.match(profileCode, /title: "Teamchef"/);
  assert.match(profileCode, /title: "Co\\u00f6rdinator"/);
  assert.match(profileCode, /title: "Extra-Leiding"/);
  assert.match(profileCode, /manageableProfileTaskBadges\(\)\.includes\(task\)/);
  assert.match(profileCode, /manageableProfileFunctionBadges\(\)\.includes\(item\)/);
  assert.match(profileCode, /updateProfileBadgeDialogSummary/);
  assert.match(appCode, /function canManageProfileFunctions\(/);
  assert.match(appCode, /function manageableProfileTaskBadges\(/);
  assert.match(appCode, /function manageableProfileFunctionBadges\(/);
  assert.match(appCode, /input\[data-profile-badge-kind="function"\]:checked/);
  assert.match(appCode, /input\[data-profile-badge-kind="task"\]:checked/);
  assert.match(styles, /#profileBadgeDialog/);
  assert.match(styles, /\.profile-badge-dialog-summary/);
  assert.match(styles, /\.profile-badge-group-grid/);
  assert.match(styles, /body\.portal-org-defensie #profileBadgeDialog:not\(\[data-mode="side"\]\) \.profile-badge-group-grid/);
  assert.match(styles, /\.profile-badge-category\.is-defensie-extra-leiding/);
  assert.match(styles, /\.profile-badge-category/);
});

test("I.O can be cleared for current non-active profiles", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const peopleCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "people.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const permissionsCode = fs.readFileSync(path.join(process.cwd(), "modules", "permissions.js"), "utf8");

  assert.match(html, /personeelsportaal\/people\.js\?v=20260802-io-clear-current-profile/);
  assert.match(peopleCode, /const isCurrent = typeof isCurrentProfile === "function" \? isCurrentProfile\(person\) : person\.status === "Actief"/);
  assert.match(peopleCode, /const canChangeIoStatus = canManageInvestigationStatus\(\) && isCurrent/);
  assert.match(peopleCode, /person\.ioStatus\?\.active[\s\S]*data-io-clear/);
  assert.match(peopleCode, /person\.status === "Actief"[\s\S]*data-io-mark/);
  assert.doesNotMatch(peopleCode, /canManageInvestigationStatus\(\) && person\.status === "Actief" \? \(person\.ioStatus\?\.active/);
  assert.match(routesCode, /action === "io" && !permissions\.canManageInvestigationStatus/);
  assert.match(permissionsCode, /canManageInvestigationStatus: isKader \|\| isHoofdofficier \|\| isOfficiersraad/);
});

test("profile notes are private to self and authorized leadership", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const profileCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "profile.js"), "utf8");
  const permissionsCode = fs.readFileSync(path.join(process.cwd(), "modules", "permissions.js"), "utf8");
  const domainCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-domain.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /id="profileNotesPanel"/);
  assert.match(html, /id="profileNoteText"/);
  assert.match(html, /id="saveProfileNoteBtn"/);
  assert.match(appCode, /function canViewProfileNotes\(person\)/);
  assert.match(appCode, /function canManageProfileNotes\(\)/);
  assert.match(appCode, /\/profile-note/);
  assert.match(appCode, /function hasActiveProfileNoteInteraction/);
  assert.match(profileCode, /function renderProfileNote/);
  assert.match(profileCode, /person\.profileNote/);
  assert.match(permissionsCode, /canViewAllProfileNotes: isKader \|\| isHoofdofficier \|\| isOfficiersraad/);
  assert.match(permissionsCode, /canManageProfileNotes: isKader \|\| isHoofdofficier \|\| isOfficiersraad/);
  assert.match(domainCode, /function profileNoteForView/);
  assert.match(domainCode, /profileNote: person\.id === profileId \|\| permissions\?\.canViewAllProfileNotes[\s\S]*profileNoteForView\(person\.profileNote\)/);
  assert.match(routesCode, /profileNoteMatch/);
  assert.match(routesCode, /Alleen Kader, Hoofdofficier of Officiersraad mag profielnotities aanpassen/);
  assert.match(styles, /\.profile-notes-panel textarea/);
});

test("portal dashboard and profile expose action-focused overview panels", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const profileCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "profile.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /id="actionCenterList"/);
  assert.match(html, /id="profileTimelinePanel"/);
  assert.match(appCode, /function dashboardActionItems\(/);
  assert.match(appCode, /function renderActionCenter\(/);
  assert.match(appCode, /data-action-center-page/);
  assert.match(profileCode, /function profileTimelineEntries\(person\)/);
  assert.match(profileCode, /canViewProfileNotes\(person\)/);
  assert.match(profileCode, /canViewDisciplineFor\(person\)/);
  assert.match(styles, /\.action-center-item/);
  assert.match(styles, /\.profile-timeline-item/);
});

test("archived resignation forms are not counted as open", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const archiveCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "archive.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");

  assert.match(html, /personeelsportaal\/archive\.js\?v=20260705-resignation-archive-state/);
  assert.match(appCode, /function isHandledResignationForm\(/);
  assert.match(appCode, /linkedProfile && !isCurrentProfile\(linkedProfile\)/);
  assert.match(archiveCode, /const openForms = allForms\.filter\(\(form\) => !isHandledResignationForm\(form\)\)/);
  assert.match(routesCode, /al gearchiveerd ontslagformulier/);
});

test("portal exposes the availability agenda for defensie and police", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /data-page="beschikbaarheids-agenda"/);
  assert.match(html, /id="availabilityAgenda"/);
  assert.match(appCode, /"beschikbaarheids-agenda": "\/beschikbaarheids-agenda"/);
  assert.match(appCode, /function renderAvailabilityAgenda\(/);
  assert.match(appCode, /absenceAgendaEntries/);
  assert.match(serverCode, /"beschikbaarheids-agenda"/);
  assert.match(styles, /\.availability-agenda/);
  assert.match(styles, /\.agenda-week/);
  assert.match(styles, /\.agenda-day\.today/);
});

test("managed public forms can be closed and reopened by form leadership", () => {
  const formModuleCode = fs.readFileSync(path.join(process.cwd(), "modules", "public-forms.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const clientCode = fs.readFileSync(path.join(process.cwd(), "public-forms.js"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "public-forms.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "public-forms.css"), "utf8");

  assert.match(formModuleCode, /hrb: \["HRB-Leiding"\]/);
  assert.match(formModuleCode, /dsi: \["DSI-Leiding"\]/);
  assert.match(formModuleCode, /override\.closed = Boolean\(rawOverride\.closed\)/);
  assert.match(formModuleCode, /closed: Boolean\(config\.closed\)/);
  assert.match(serverCode, /Dit formulier is momenteel gesloten door de leiding/);
  assert.match(serverCode, /readConfigOverride\?\.\(baseConfig\.slug\)/);
  assert.match(clientCode, /function renderClosedForm/);
  assert.match(clientCode, /function saveFormClosed/);
  assert.match(html, /id="toggleFormClosed"/);
  assert.match(styles, /\.form-status-pill\.closed/);
});

test("VID ticket forms refresh access and tickets through live events", () => {
  const clientCode = fs.readFileSync(path.join(process.cwd(), "public-forms.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "public-forms.css"), "utf8");

  assert.match(clientCode, /new EventSource\("\/api\/events"\)/);
  assert.match(clientCode, /people:update/);
  assert.match(clientCode, /public-forms:update/);
  assert.match(clientCode, /schedulePublicFormLiveRefresh\(data\.scope\)/);
  assert.match(clientCode, /await loadForm\(\)/);
  assert.match(clientCode, /function closeVidTicket\(/);
  assert.match(clientCode, /\/api\/public-forms\/submissions\/\$\{encodeURIComponent\(ticketId\)\}\/close/);
  assert.match(clientCode, /vid-ticket-status/);
  assert.match(serverCode, /const publicFormCloseMatch = url\.pathname\.match/);
  assert.match(serverCode, /status: "closed"/);
  assert.match(serverCode, /closedBy: publicFormPersonDto\(profile\)/);
  assert.match(styles, /\.vid-ticket-status\.closed/);
});

test("calm dashboard adapts before police counters overflow", () => {
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(styles, /html\[data-ui-mode="calm"\] \.dashboard-grid > \.panel/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /html\[data-ui-mode="calm"\] \.dashboard-grid \{\s+grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /html\[data-ui-mode="calm"\] \.member-summary strong \{[\s\S]*font-size: clamp\(36px, 3\.4vw, 52px\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});

test("portal chrome keeps topbar controls inside narrow desktop viewports", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(html, /personeelsportaal\.css\?v=20260802-defensie-department-badges/);
  assert.match(styles, /Portal chrome stability for browser zoom/);
  assert.match(styles, /body:not\(\.locked\) \{[\s\S]*overflow-x: clip;/);
  assert.match(styles, /\.topbar \{[\s\S]*flex-wrap: wrap;/);
  assert.match(styles, /\.topbar-actions \{[\s\S]*max-width: 100%;/);
  assert.match(styles, /\.profile-chip \{[\s\S]*flex: 0 1 300px;/);
  assert.match(styles, /@media \(max-width: 1280px\) \{[\s\S]*\.topbar-actions \{[\s\S]*width: 100%;/);
  assert.match(styles, /@media \(min-width: 901px\) and \(max-width: 1400px\), \(min-width: 901px\) and \(max-height: 760px\)/);
});

test("people mutations persist rank changes before queueing Discord sync", () => {
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const peopleStoreCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-postgres-people-store.js"), "utf8");

  assert.match(routesCode, /async function persistPeopleStateMutation\(state\)/);
  assert.match(routesCode, /async function persistRankMutation\(state, changedPeople, activityMessages\)/);
  assert.match(routesCode, /async function persistPersonSnapshotMutation\(state, changedPeople, activityMessages\)/);
  assert.match(routesCode, /function rankMutationChangedPeople\(state, previousSignatures\)/);
  assert.match(routesCode, /function personMutationChangedPeople\(state, previousSignatures\)/);
  assert.match(peopleStoreCode, /async function writePersonRankChanges\(people, activityMessage\)/);
  assert.match(peopleStoreCode, /async function writePersonSnapshots\(people, activityMessage\)/);
  assert.match(peopleStoreCode, /async function writeBlacklistEntries\(entries, activityMessage\)/);
  const rankStoreBlock = peopleStoreCode.slice(peopleStoreCode.indexOf("async function writePersonRankChanges"), peopleStoreCode.indexOf("async function writePersonSnapshots"));
  assert.match(rankStoreBlock, /update people[\s\S]*rank = \$2,[\s\S]*service_number = \$3,[\s\S]*rank_history = \$7::jsonb/);
  assert.doesNotMatch(rankStoreBlock, /lockPeopleWrite/);

  const recruitmentBlock = routesCode.slice(routesCode.indexOf('queueChangedDiscordProfilesAfterResponse(state, previousNicknames, previousRankRoles, "recruitment_hire"') - 260, routesCode.indexOf('queueChangedDiscordProfilesAfterResponse(state, previousNicknames, previousRankRoles, "recruitment_hire"') + 220);
  assert.match(recruitmentBlock, /await persistPersonSnapshotMutation\(state, changedPeople, state\.activity\.slice\(activityStartIndex\)\);[\s\S]*sendPeopleStateResponse\(res, auth, state\);[\s\S]*queueChangedDiscordProfilesAfterResponse/);
  assert.doesNotMatch(recruitmentBlock, /await queuePersonDiscordSync\(state, result\.person, "recruitment_hire"\)/);

  const personSaveBlock = routesCode.slice(routesCode.indexOf('const reason = existingBeforeSave ? "person_updated" : "person_created";') - 260, routesCode.indexOf('const reason = existingBeforeSave ? "person_updated" : "person_created";') + 260);
  assert.match(personSaveBlock, /await persistPersonSnapshotMutation\(state, changedPeople, state\.activity\.slice\(activityStartIndex\)\);[\s\S]*sendPeopleStateResponse\(res, auth, state\);[\s\S]*queueChangedDiscordProfilesAfterResponse/);
  assert.doesNotMatch(personSaveBlock, /await queuePersonDiscordSync\(state, result\.person/);

  const rankActionBlock = routesCode.slice(routesCode.indexOf('if (["promote", "demote"].includes(action))'), routesCode.indexOf('if (["dismiss", "restore", "clear-history", "io"].includes(action))'));
  assert.match(rankActionBlock, /const changedRankPeople = rankMutationChangedPeople\(state, previousRankSignatures\);[\s\S]*await persistRankMutation\(state, changedRankPeople, rankActivityMessages\);[\s\S]*sendPeopleStateResponse\(res, auth, state\);[\s\S]*queueChangedDiscordProfilesAfterResponse\(state, previousNicknames, previousRankRoles, `person_\$\{action\}`\)/);
  assert.match(rankActionBlock, /queuePersonDiscordSyncAfterResponse\(person, `person_\$\{action\}`\)/);
});

test("portal exposes a protected system health page", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");

  assert.match(html, /data-page="systeemstatus"/);
  assert.match(html, /id="systemHealthSummary"/);
  assert.match(appCode, /function canViewSystemHealth\(/);
  assert.match(appCode, /fetch\("\/api\/admin\/health"/);
  assert.match(appCode, /function renderDiscordJobHealth\(/);
  assert.match(appCode, /function renderProfileAuditHealth\(/);
  assert.match(appCode, /function renderPortoHeartbeatHealth\(/);
  assert.match(appCode, /data-system-health-action/);
  assert.match(styles, /\.system-health-card/);
  assert.match(styles, /\.system-health-table/);
  assert.match(styles, /\.system-health-pill/);
  assert.match(serverCode, /url\.pathname === "\/api\/admin\/health"/);
  assert.match(serverCode, /url\.pathname === "\/api\/admin\/discord-jobs\/retry"/);
  assert.match(serverCode, /url\.pathname === "\/api\/admin\/discord-jobs\/cleanup"/);
  assert.match(serverCode, /healthPayload\(\{ includeDetails: true \}\)/);
  assert.match(serverCode, /payload\.discordSync\.failedByType/);
  assert.match(serverCode, /payload\.profileAudit/);
  assert.match(serverCode, /payload\.portoDebug/);
});

test("portal actions retry temporary database lock failures", () => {
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(appCode, /const ACTION_RETRY_DELAYS_MS = \[350, 1100\]/);
  assert.match(appCode, /function isTemporaryActionFailure\(/);
  assert.match(appCode, /lock timeout\|deadlock\|could not serialize/);
  assert.match(appCode, /if \(pendingActionKeys\.size > 0 \|\| pendingActionKeys\.has\(actionKey\)\) return false;/);
  assert.match(appCode, /await wait\(ACTION_RETRY_DELAYS_MS\[attempt\]\);/);
  assert.match(appCode, /updateGlobalActionBusy\(\);/);
  assert.match(styles, /body\.is-action-busy/);
});

test("portal login sync uses targeted profile writes", () => {
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const peopleStoreCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-postgres-people-store.js"), "utf8");

  assert.match(serverCode, /async function persistDiscordProfileSync\(state, profile, activityStartIndex = 0\)/);
  assert.match(serverCode, /peopleStorage\.writePersonDiscordProfileSync\(profile, activityMessages\)/);
  assert.match(serverCode, /await persistDiscordProfileSync\(state, profile, activityStartIndex\)/);

  const callbackBlock = serverCode.slice(serverCode.indexOf('if (["/api/auth/callback", "/auth/discord/callback"].includes(url.pathname)'), serverCode.indexOf("if (await handlePersoneelsportaalApi"));
  assert.match(callbackBlock, /syncProfileFromDiscord\(state, profile, user, member/);
  assert.match(callbackBlock, /await persistDiscordProfileSync\(state, profile, activityStartIndex\)/);
  assert.doesNotMatch(callbackBlock, /peopleStorage\.writeState\(state\)/);

  const authMeBlock = serverCode.slice(serverCode.indexOf('if (url.pathname === "/api/auth/me"'), serverCode.indexOf('if (url.pathname === "/api/auth/login"'));
  assert.match(authMeBlock, /syncProfileFromDiscord\(state, profile, auth\.session\.user, member/);
  assert.match(authMeBlock, /await persistDiscordProfileSync\(state, profile, activityStartIndex\)/);
  assert.doesNotMatch(authMeBlock, /peopleStorage\.writeState\(state\)/);

  assert.match(peopleStoreCode, /async function writePersonDiscordProfileSync\(person, activityMessage\)/);
  assert.match(peopleStoreCode, /discord_username = \$2,[\s\S]*avatar = \$3,[\s\S]*discord_roles = \$4::jsonb,[\s\S]*perm_role = \$5/);
});

test("porto dev and management bypass assign regular 30 numbers", () => {
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const devBypassBlock = routesCode.slice(
    routesCode.indexOf('url.pathname === "/api/porto/dev-bypass"'),
    routesCode.indexOf('url.pathname === "/api/porto/management-bypass"')
  );
  const managementBypassBlock = routesCode.slice(
    routesCode.indexOf('url.pathname === "/api/porto/management-bypass"'),
    routesCode.indexOf('url.pathname === "/api/porto/auto-assign"')
  );

  for (const block of [devBypassBlock, managementBypassBlock]) {
    assert.match(block, /previousVehicleNumber && previousVehicleNumber !== operatorVehicleNumber/);
    assert.match(block, /firstAvailableRegularVehicleNumber\(state\)/);
    assert.match(block, /Geen vrij regulier 30-nummer beschikbaar/);
    assert.doesNotMatch(block, /availablePortoVehicleNumbers\(state\)/);
    assert.doesNotMatch(block, /firstAvailableVehicleNumber\(state,\s*"30"\)/);
  }
});

test("porto exposes the modern dispatcher test UI beside the classic UI", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const portoCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const opsCode = fs.readFileSync(path.join(process.cwd(), "porto", "ops.js"), "utf8");
  const dutyCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const portoStoreCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-postgres-store.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "porto.css"), "utf8");

  assert.match(html, /data-porto-ui-choice="classic"/);
  assert.match(html, /data-porto-ui-choice="modern"/);
  assert.match(html, /id="portoModernDutyDashboard"/);
  assert.match(html, /id="portoModernOpsDashboard"/);
  assert.match(html, /porto\/ops\.js\?v=20260731-ops-refresh-state/);
  assert.match(html, /porto\/duty\.js\?v=20260728-status4-pending/);
  assert.match(html, /porto\.js\?v=20260731-ops-refresh-state/);
  assert.match(portoCode, /PORTO_UI_MODE_KEY/);
  assert.match(portoCode, /let portoDutyTime = null/);
  assert.match(portoCode, /function bindPortoUiToggle/);
  assert.match(opsCode, /portoDutyTime = payload\.dutyTime \|\| null/);
  assert.match(opsCode, /function renderModernOpsDashboard/);
  assert.match(opsCode, /function isEditingModernOpsDashboard/);
  assert.match(opsCode, /captureModernOpsDashboardState/);
  assert.match(opsCode, /restoreModernOpsDashboardState/);
  assert.match(opsCode, /data-porto-modern-ops-duration-text/);
  assert.match(opsCode, /function updateOpsDurationDisplay/);
  assert.doesNotMatch(opsCode, /window\.setInterval\(\(\) => \{ renderOpsStatus\(\)/);
  assert.match(dutyCode, /function renderModernDutyDashboard/);
  assert.match(dutyCode, /function modernDutyTimeMetaHtml/);
  assert.match(dutyCode, /function updateDutyOpsInfoDisplay/);
  assert.match(dutyCode, /data-porto-duty-session-time/);
  assert.match(dutyCode, /data-porto-duty-week-time/);
  assert.match(routesCode, /function portoDutyTimePayload/);
  assert.match(routesCode, /function activePortoDutySessionWeekSeconds/);
  assert.match(routesCode, /weekTotalSeconds \+= Math\.max\(0, activeSession\.total - activeSession\.counted\)/);
  assert.match(routesCode, /if \(endedAt > startedAt\) return Math\.round\(\(endedAt - startedAt\) \/ 1000\)/);
  assert.match(routesCode, /buildPortoDutyHourEntries\(state/);
  assert.match(routesCode, /operationalWeekForDate\(now/);
  assert.match(portoStoreCode, /PORTO_DUTY_HOURS_ENTERED_BY_ID/);
  assert.match(styles, /body\[data-porto-ui="modern"\]\.porto-duty-workspace/);
  assert.match(styles, /\.porto-modern-ops-dashboard/);
  assert.match(styles, /\.porto-modern-duty-time-card/);
  assert.match(styles, /body\[data-porto-ui="modern"\]\.porto-ops-workspace\.porto-blank \{[\s\S]*overflow-y: auto;/);
  assert.match(styles, /body\[data-porto-ui="modern"\]\.porto-ops-workspace \.porto-modern-ops-list \{[\s\S]*overscroll-behavior: contain;/);
});

test("modern duty status layout stays aligned on desktop widths", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "porto.css"), "utf8");

  assert.match(html, /porto\.css\?v=20260731-ops-page-scroll/);
  assert.match(styles, /body\[data-porto-ui="modern"\]\.porto-duty-workspace \.porto-modern-duty-meta-grid \{[\s\S]*margin-top: 0;/);
  assert.match(styles, /\.porto-modern-duty-meta-grid article > \.porto-modern-vehicle-select \{[\s\S]*grid-column: 1 \/ -1;/);
  const desktopBreakpointStart = styles.indexOf("@media (max-width: 1280px)");
  const compactBreakpointStart = styles.indexOf("@media (max-width: 980px)");
  const desktopBreakpointBlock = styles.slice(desktopBreakpointStart, compactBreakpointStart);
  assert.doesNotMatch(desktopBreakpointBlock, /\.porto-modern-duty-meta-grid,[\s\S]*grid-template-columns: 1fr;/);
  assert.match(styles, /@media \(max-width: 980px\) \{[\s\S]*\.porto-modern-duty-meta-grid,[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
});

test("porto unit member cards show service numbers separately from rank", () => {
  const dutyCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "porto.css"), "utf8");

  assert.match(dutyCode, /porto-unit-service-number/);
  assert.match(dutyCode, /porto-modern-duty-member-number/);
  assert.match(dutyCode, /<div><span>Rang:<\/span><strong>\$\{escapeHtml\(member\.rank \|\| "-"\)\}<\/strong><\/div>/);
  assert.match(dutyCode, /<div><dt>Rang<\/dt><dd>\$\{escapeHtml\(member\.rank \|\| "-"\)\}<\/dd><\/div>/);
  assert.doesNotMatch(dutyCode, /Rang \+ Dienstnummer/);
  assert.match(styles, /\.porto-modern-duty-member-number,[\s\S]*\.porto-unit-service-number \{/);
  assert.match(styles, /\.porto-modern-duty-member \{[\s\S]*position: relative;/);
  assert.match(styles, /\.porto-unit-member \{[\s\S]*position: relative;/);
});

test("porto profile dialog scroll avoids expensive backdrop repainting", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "porto.css"), "utf8");

  assert.match(html, /porto\.css\?v=20260731-ops-page-scroll/);
  assert.match(styles, /\.porto-profile-dialog \{[\s\S]*contain: layout paint;/);
  assert.match(styles, /\.porto-profile-dialog::backdrop \{[\s\S]*backdrop-filter: none;/);
  assert.match(styles, /\.porto-profile-form \{[\s\S]*overscroll-behavior: contain;/);
  assert.match(styles, /\.porto-profile-form \{[\s\S]*scrollbar-gutter: stable;/);
});

test("porto K9 duty role stores a visible K9 name from the profile", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const profileCode = fs.readFileSync(path.join(process.cwd(), "porto", "profile.js"), "utf8");
  const clientCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");

  assert.match(html, /portoK9NameField/);
  assert.match(html, /portoK9Name/);
  assert.match(html, /porto\/profile\.js\?v=20260719-k9-duty-role/);
  assert.match(html, /porto\.js\?v=20260731-ops-refresh-state/);
  assert.match(profileCode, /completedTrainings\)\s*&& portoProfile\.completedTrainings\.includes\("K9"\)/);
  assert.match(clientCode, /k9Name: k9NameInput/);
  assert.match(routesCode, /personHasK9Training/);
  assert.match(routesCode, /person\.k9Name = String\(body\.k9Name/);
  assert.match(botCode, /dutyRole === "K9" && k9Name \? k9Name/);
});

test("porto browser heartbeat avoids noisy persistence and stale active screens", () => {
  const clientCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const dutyCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const policeEnvExample = fs.readFileSync(path.join(process.cwd(), ".env.politie.example"), "utf8");

  assert.match(routesCode, /PORTO_BROWSER_HEARTBEAT_PERSIST_MS/);
  assert.match(routesCode, /4 \* 60 \* 60 \* 1000/);
  assert.match(routesCode, /PORTO_BROWSER_CLOSE_GRACE_MS/);
  assert.match(routesCode, /60 \* 60 \* 1000/);
  assert.match(routesCode, /const heartbeatChanged = markPortoBrowserHeartbeat\(unit\);/);
  assert.match(routesCode, /if \(heartbeatChanged\) await persistPortoState\(state, \{ units: state\.portoUnits \}\);/);
  assert.match(clientCode, /function syncPortoBrowserHeartbeatForPayload\(payload\)/);
  assert.match(clientCode, /heartbeat && heartbeat\.active === false/);
  assert.match(clientCode, /schedulePortoLiveRefresh\("porto"\)/);
  assert.match(clientCode, /event\.persisted/);
  assert.doesNotMatch(clientCode, /beforeunload", sendPortoBrowserClosedSignal/);
  assert.match(dutyCode, /syncPortoBrowserHeartbeatForPayload\(payload\)/);
  assert.match(dutyCode, /if \(portoSignedOffUntilStatus0\) return;/);
  assert.match(dutyCode, /function setPortoSignedOffUntilStatus0\(enabled\) \{[\s\S]*clearPortoAutoAssignTimer\(\);/);
  assert.match(routesCode, /if \(isRecentlyEnded\(person\.id\)\) \{[\s\S]*recentlyEndedError\(\)/);
  assert.match(html, /porto\/duty\.js\?v=20260728-status4-pending/);
  assert.match(html, /porto\.js\?v=20260731-ops-refresh-state/);
  assert.match(envExample, /PORTO_BROWSER_CLOSE_GRACE_MS=3600000/);
  assert.match(envExample, /PORTO_BROWSER_HARD_TIMEOUT_MS=14400000/);
  assert.match(envExample, /PORTO_BROWSER_HEARTBEAT_PERSIST_MS=45000/);
  assert.match(policeEnvExample, /PORTO_BROWSER_CLOSE_GRACE_MS=3600000/);
  assert.match(policeEnvExample, /PORTO_BROWSER_HARD_TIMEOUT_MS=14400000/);
  assert.match(policeEnvExample, /PORTO_BROWSER_HEARTBEAT_PERSIST_MS=45000/);
});

test("porto live events refresh OPS status 0 without waiting for the poll throttle", () => {
  const clientCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const dutyCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const opsCode = fs.readFileSync(path.join(process.cwd(), "porto", "ops.js"), "utf8");

  assert.match(clientCode, /loadPortoDuty\(\{ automatic: true, bypassAutoThrottle: scope === "porto" \}\)/);
  assert.match(clientCode, /function hasActivePortoLiveInteraction\(\)/);
  assert.match(clientCode, /typeof isEditingModernOpsDashboard === "function" && isEditingModernOpsDashboard\(\)/);
  assert.doesNotMatch(clientCode, /active\?\.matches\?\.\("input"\)/);
  assert.doesNotMatch(clientCode, /isEditingOpsRequest[\s\S]{0,80}return true/);
  assert.match(dutyCode, /const bypassAutoThrottle = Boolean\(options\.bypassAutoThrottle\);/);
  assert.match(dutyCode, /if \(automatic && !bypassAutoThrottle\)/);
  assert.match(opsCode, /function scheduleOpsRequestRenderAfterInteraction\(\)/);
  assert.match(opsCode, /function scheduleModernOpsDashboardRenderAfterInteraction\(\)/);
  assert.doesNotMatch(opsCode, /list\.matches\(":hover"\)/);
});

test("I8 create form keeps a browser draft until server save succeeds", () => {
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const i8Code = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "i8.js"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");

  assert.match(i8Code, /function saveI8Draft\(/);
  assert.match(i8Code, /function restoreI8Draft\(/);
  assert.match(i8Code, /function clearI8Draft\(/);
  assert.match(i8Code, /function i8FieldHasUserInput\(/);
  assert.match(i8Code, /I8_DRAFT_DEFAULT_ONLY_FIELDS/);
  assert.match(i8Code, /function updateI8ForceWarningReasonField\(/);
  assert.match(i8Code, /function i8ForceWarningText\(form\)/);
  assert.match(appCode, /forceWarningGiven: \$\("#i8ForceWarningGiven"\)\.value/);
  assert.match(appCode, /forceWarningReason: \$\("#i8ForceWarningReason"\)\.value\.trim\(\)/);
  assert.match(appCode, /function saveActiveFormDraftBeforeAction\(/);
  assert.match(appCode, /saveActiveFormDraftBeforeAction\(\);/);
  assert.match(i8Code, /const ownSummary = \$\("#i8OwnSummary"\)/);
  assert.match(i8Code, /Totaal aantal eigen I8's/);
  assert.match(html, /id="i8OwnSummary"/);
  assert.match(html, /id="i8ForceWarningGiven"/);
  assert.match(html, /id="i8ForceWarningReason"/);
  assert.match(styles, /\.i8-own-summary/);
  assert.match(appCode, /button\.dataset\.i8Tab === "create"\) restoreI8Draft/);
  assert.match(appCode, /if \(!saved\) return;\s+clearI8Draft\(\);/);
  assert.match(routesCode, /function currentPersonForAuth\(state, auth\)/);
  assert.match(routesCode, /normalizeDiscordId\(auth\?\.session\?\.user\?\.id \|\| auth\?\.profile\?\.discordId \|\| ""\)/);
  assert.match(routesCode, /state: stateForProfile\(state, permissions, member\.id\)/);
  assert.match(routesCode, /\{ normalizeAbsences: false, profileId: member\.id \}/);
  assert.match(html, /personeelsportaal\/i8\.js\?v=20260731-i8-force-warning/);
  assert.match(routesCode, /forceWarningGiven/);
  assert.match(routesCode, /forceWarningGiven === "no" && !forceWarningReason/);
});

test("browser profile identity ignores old profiles with the same Discord ID", () => {
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");

  assert.match(appCode, /const byId = state\.people\.find\(\(person\) => person\.id === authProfile\.id && isCurrentProfile\(person\)\)/);
  assert.match(appCode, /const byDiscordId = state\.people\.find\(\(person\) => person\.discordId === authProfile\.discordId && isCurrentProfile\(person\)\)/);
});

test("mentor test Discord embed formats submitted date and time", () => {
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(serverCode, /function formatMentorTestDateTime\(/);
  assert.match(serverCode, /timeZone: "Europe\/Amsterdam"/);
  assert.match(serverCode, /name: "Ingediend op", value: formatMentorTestDateTime\(test\.submittedAt\)/);
});

test("side task shell serves LR and KLu alias assets with a fresh version", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "side-tasks.html"), "utf8");
  assert.match(html, /side-tasks\.css\?v=20260721-lr-context-actions/);
  assert.match(html, /side-tasks\.js\?v=20260721-lr-context-actions/);
});

test("LR member admin is compact and reconciles stale Discord roles", () => {
  const clientCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "side-tasks-server.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "side-tasks.css"), "utf8");
  const profileCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "profile.js"), "utf8");

  assert.match(clientCode, /function dnrMemberAdminRow/);
  assert.match(clientCode, /<tr><th>Naam \(Discord\)<\/th><th>Schuilnaam<\/th><\/tr>/);
  assert.match(clientCode, /\/api\/side-tasks\/members\/reconcile/);
  assert.match(clientCode, /Controleer Discord-rollen/);
  assert.match(serverCode, /function reconcileDnrMembersWithDiscord/);
  assert.match(serverCode, /hasMembershipRole\(task, roles\)/);
  assert.match(serverCode, /LR Discord-rol ontbreekt/);
  assert.match(serverCode, /archiveMemberByDiscordId\(task\.key/);
  assert.match(profileCode, /DNR: "LR"/);
  assert.match(profileCode, /"DNR-Leiding": "LR-Leiding"/);
  assert.match(styles, /\.member-admin-name-cell/);
});

test("side task browser heartbeat signs off closed browsers server-side", () => {
  const clientCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "side-tasks-server.js"), "utf8");
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "side-tasks-store.js"), "utf8");

  assert.match(clientCode, /BROWSER_HEARTBEAT_INTERVAL_MS/);
  assert.match(clientCode, /\/api\/side-tasks\/me\/heartbeat/);
  assert.match(serverCode, /SIDE_TASK_BROWSER_TIMEOUT_MS/);
  assert.match(serverCode, /signOffTimedOutBrowserMembers/);
  assert.match(storeCode, /clientHeartbeatAt/);
  assert.match(storeCode, /browser_heartbeat_timeout/);
});

test("mentor tests render compact rows with a detail dialog", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const mentorCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "mentor.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  assert.match(html, /mentorTestDetailDialog/);
  assert.match(html, /personeelsportaal\/mentor\.js\?v=20260726-mentor-log-current/);
  assert.match(mentorCode, /data-open-mentor-test-detail/);
  assert.match(mentorCode, /function openMentorTestDetailDialog/);
  assert.match(mentorCode, /mentorSelfTestCache\.unavailableReason/);
  assert.match(mentorCode, /function saveMentorTestDraft\(/);
  assert.match(mentorCode, /function restoreMentorTestDraft\(/);
  assert.match(mentorCode, /function clearMentorTestDraft\(/);
  assert.match(mentorCode, /function bindMentorTestDraftAutosave\(/);
  assert.match(mentorCode, /orp-\$\{organizationKey\}-mentor-test-draft-\$\{profileId\}-\$\{testId\}/);
  assert.match(mentorCode, /clearMentorTestDraft\(submittedTest\);/);
  assert.match(appCode, /saveMentorTestDraft\(\);/);
  assert.match(routesCode, /const person = currentPersonForAuth\(state, auth\);\s+if \(!person \|\| !mentorRanks\.includes\(person\.rank\)\)/);
  assert.match(routesCode, /latestTest: mentorTestForClient\(latestTest, \{ includeAnswers: false \}\)/);
});

test("Discord private messages are queued and sent as embeds", () => {
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  assert.match(routesCode, /function buildDiscordDmEmbed\(/);
  assert.match(routesCode, /embeds: buildDiscordDmEmbed\(content, reason\)/);
  assert.match(workerCode, /embeds: job\.payload\?\.embeds \|\| \[\]/);
  assert.match(botCode, /async function sendDirectMessage\(discordId, content, options = \{\}\)/);
  assert.match(botCode, /body\.embeds = embeds/);
});

test("Discord leave logs are scoped to the configured guild", () => {
  const leaveLogCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-leave-log.js"), "utf8");
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  assert.match(leaveLogCode, /function gatewayGuildMatchesConfiguredGuild\(/);
  assert.match(workerCode, /gatewayGuildMatchesConfiguredGuild\(member\.guild_id\)/);
  assert.match(workerCode, /gatewayMemberCacheKey\(discordId, guildId\)/);
  assert.match(workerCode, /memberStillInConfiguredGuild\(discordId\)/);
  assert.match(workerCode, /recentLeaveLogKeys/);
  assert.match(workerCode, /packet\.t === "GUILD_MEMBER_REMOVE"[\s\S]*handleGuildMemberRemove/);
});

test("mentor checklist completion notifies the mentor test channel once", () => {
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  assert.match(serverCode, /ready: "Toets kan klaargezet worden"/);
  assert.match(routesCode, /shouldNotifyMentorTestReady = allItemsCompleted && !testSent && !existing\.testReadyNotifiedAt/);
  assert.match(routesCode, /testReadyNotifiedAt: allItemsCompleted/);
  assert.match(routesCode, /sendMentorTestWebhook\("ready", \{ person, actor \}\)/);
});

test("Discord bot can claim IZ cases from a thread", () => {
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  assert.match(workerCode, /name: "claimizleiding"/);
  assert.match(workerCode, /IZ_LEIDING_CHANNEL_ID/);
  assert.match(workerCode, /IZ_LEIDING_ROLE_ID/);
  assert.match(workerCode, /interactionHasRole\(interaction, IZ_LEIDING_ROLE_ID\)/);
  assert.match(workerCode, /function formatEmbedForTranscript/);
  assert.match(workerCode, /for \(const field of embed\.fields \|\| \[\]\)/);
  assert.match(workerCode, /function formatComponentsForTranscript/);
  assert.match(workerCode, /transcriptMessageHasContent/);
  assert.match(workerCode, /function buildClaimSummaryEmbed/);
  assert.match(workerCode, /originalMessageSummaryDescription/);
  assert.match(workerCode, /Originele auteur/);
  assert.match(workerCode, /Origineel bericht/);
  assert.match(workerCode, /downloadMessageAttachments/);
  assert.match(workerCode, /createMessageWithFiles/);
  assert.match(workerCode, /Originele thread is daarom niet verwijderd/);
  assert.match(workerCode, /deleteChannel\(threadId, "IZ zaak overgenomen"\)/);
  assert.match(botCode, /async function createMessageWithFiles/);
  assert.match(botCode, /formData\.append\("payload_json"/);
});

test("Discord worker writes sync status back to portal profiles", () => {
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  assert.match(workerCode, /updatePortalDiscordSyncStatus/);
  assert.match(workerCode, /jsonb_build_object\('discordSyncStatus'/);
  assert.match(workerCode, /updatePortalDiscordSyncStatus\(statusPerson, stateName/);
  assert.match(routesCode, /"qualification_updated"/);
  assert.match(routesCode, /Wacht op Discord rollen of eerstvolgende worker-run/);
  assert.match(workerCode, /nestedSyncFailureFromResult/);
  assert.match(workerCode, /\$\{label\} overgeslagen/);
  assert.match(workerCode, /if \(nestedFailure\) throw nestedFailure/);
});

test("Discord worker resolves duplicate Discord IDs to current portal profiles", () => {
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");

  assert.match(workerCode, /findPersonByDiscordId/);
  assert.match(workerCode, /findPersonByIdOrDiscordId/);
  assert.match(workerCode, /findPersonByDiscordId\(state\.people \|\| \[\], userId, \{ currentOnly: true \}\)/);
});

test("Discord worker casts Porto JSONB update parameters", () => {
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  assert.match(workerCode, /jsonb_build_object\('discordChannelKey', \$2::text\)/);
  assert.match(workerCode, /jsonb_build_object\('discordChannelStatus', \$2::text\)/);
  assert.match(workerCode, /coalesce\(raw->>'discordChannelKey', ''\) <> \$2::text/);
});

test("Discord nickname sync returns the desired nickname for logging", () => {
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  assert.match(botCode, /return \{ \.\.\.result, nickname: desiredNickname \}/);
  assert.doesNotMatch(botCode, /return setNickname\(memberId, desiredNickname, auditReason\)/);
  assert.match(workerCode, /function nicknameTextFromResult/);
  assert.match(workerCode, /typeof value\.nickname === "string"/);
  assert.match(workerCode, /const resultText = jobResultText\(result\)/);
});

test("Discord person sync script diagnoses qualification roles", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  const scriptCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-sync-person.js"), "utf8");
  assert.equal(packageJson.scripts["discord:person"], "node scripts/discord-sync-person.js");
  assert.match(scriptCode, /configuredQualificationRoleMappings/);
  assert.match(scriptCode, /allQualificationRoleMappings/);
  assert.match(scriptCode, /allRankRoleMappings/);
  assert.match(scriptCode, /Ontbrekende rangrol/);
  assert.match(scriptCode, /Ontbrekende gewenste rollen/);
  assert.match(scriptCode, /Gewenst maar niet geconfigureerd/);
  assert.match(scriptCode, /syncDiscordForPersonIfNeeded\(person/);
  assert.match(scriptCode, /--apply/);
});

test("Discord sync manages portal function and badge roles", () => {
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const organizationsCode = fs.readFileSync(path.join(process.cwd(), "modules", "organizations.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");
  const peopleStoreCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-postgres-people-store.js"), "utf8");
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  const roleConfigCode = fs.readFileSync(path.join(process.cwd(), "scripts", "check-discord-role-config.js"), "utf8");
  const scriptCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-sync-person.js"), "utf8");
  const profileBadgeRoute = routesCode.slice(routesCode.indexOf("const profileBadgesMatch"), routesCode.indexOf("const disciplineMatch"));

  assert.match(envExample, /DISCORD_MENTOR_LEIDING_ROLE_ID=/);
  assert.match(envExample, /DISCORD_POLITIE_DSI_ROLE_ID=/);
  assert.match(envExample, /DISCORD_POLITIE_HR_ROLE_ID=1532700206175490200/);
  assert.match(envExample, /DISCORD_POLITIE_HR_LEIDING_ROLE_ID=1532700114810835004/);
  assert.match(envExample, /DISCORD_POLITIE_ME_LEIDING_ROLE_ID=1514667369660944402/);
  assert.match(envExample, /DISCORD_POLITIE_TRAINER_ASSIST_LEIDING_ROLE_ID=1518668300899451042/);
  assert.match(envExample, /DISCORD_POLITIE_MENTOR_ASSIST_LEIDING_ROLE_ID=1518668511101059082/);
  assert.match(envExample, /DISCORD_POLITIE_WS_ASSIST_LEIDING_ROLE_ID=1518667352475176980/);
  assert.match(envExample, /DISCORD_POLITIE_HR_ASSIST_LEIDING_ROLE_ID=1532700312333320244/);
  assert.match(envExample, /DISCORD_POLITIE_IZ_ASSIST_LEIDING_ROLE_ID=1518668099468005493/);
  assert.match(envExample, /DISCORD_POLITIE_ME_ASSIST_LEIDING_ROLE_ID=1514667366540378112/);
  assert.match(envExample, /DISCORD_POLITIE_WIJKAGENT_LEIDING_ROLE_ID=1524072585221112073/);
  assert.match(envExample, /DISCORD_POLITIE_WIJKAGENT_ASSIST_LEIDING_ROLE_ID=1524072866209857576/);
  assert.match(envExample, /DISCORD_POLITIE_WIJKAGENT_ROLE_ID=1485639884252381316/);
  assert.match(envExample, /DISCORD_POLITIE_SEPARATOR_RANG_ROLE_ID=1423472054136606761/);
  assert.match(envExample, /DISCORD_POLITIE_SEPARATOR_SPECIALISATIES_ROLE_ID=1486666494464098426/);
  assert.match(envExample, /DISCORD_POLITIE_SEPARATOR_PORTO_ROLE_ID=1459368187480244384/);
  assert.match(envExample, /DISCORD_POLITIE_NH_ROLE_ID=1468340097010368747/);
  assert.doesNotMatch(envExample, /DISCORD_POLITIE_IBT_ROLE_ID=/);
  assert.match(envExample, /DISCORD_POLITIE_TLO_ROLE_ID=1492543958935539735/);
  assert.match(envExample, /DISCORD_POLITIE_OFF_ROLE_ID=1468338856553353256/);
  assert.match(envExample, /DISCORD_POLITIE_SIV_ROLE_ID=1468339057489739878/);
  assert.match(envExample, /DISCORD_POLITIE_TMO_ROLE_ID=1468342410403909644/);
  assert.match(envExample, /DISCORD_POLITIE_ZULU_ROLE_ID=1468340559696367659/);
  assert.match(envExample, /DISCORD_POLITIE_OGM_ROLE_ID=1468339159889350736/);
  assert.match(envExample, /DISCORD_POLITIE_ME_ROLE_ID=1468339400969683117/);
  assert.match(envExample, /DISCORD_POLITIE_K9_ROLE_ID=1527746931827277904/);
  assert.match(envExample, /DISCORD_POLITIE_K9_BEGELEIDER_ROLE_ID=1468339725709480138/);
  assert.match(envExample, /DISCORD_TRAINING_NEEDED_BKV_ROLE_ID=1499476179537625128/);
  assert.match(envExample, /DISCORD_JUSTITIE_DEFENSIE_ROLE_ID=/);
  assert.match(envExample, /DISCORD_SEPARATOR_EXTRA_ROLE_ID=1526710886511939794/);
  assert.match(organizationsCode, /label: "Trainer", envKey: "DISCORD_TRAINER_ROLE_ID"/);
  assert.match(organizationsCode, /label: "DSI", envKey: "DISCORD_DSI_ROLE_ID"/);
  assert.match(organizationsCode, /label: "HR", envKey: "DISCORD_POLITIE_HR_ROLE_ID", defaultRoleId: "1532700206175490200"/);
  assert.match(organizationsCode, /label: "HR-Leiding", envKey: "DISCORD_POLITIE_HR_LEIDING_ROLE_ID", defaultRoleId: "1532700114810835004"/);
  assert.match(organizationsCode, /label: "Trainer-Assist\. Leiding", envKey: "DISCORD_POLITIE_TRAINER_ASSIST_LEIDING_ROLE_ID"/);
  assert.match(organizationsCode, /label: "HR-Assist\. Leiding", envKey: "DISCORD_POLITIE_HR_ASSIST_LEIDING_ROLE_ID", defaultRoleId: "1532700312333320244"/);
  assert.match(organizationsCode, /label: "ME-Leiding", envKey: "DISCORD_POLITIE_ME_LEIDING_ROLE_ID", defaultRoleId: "1514667369660944402"/);
  assert.match(organizationsCode, /label: "ME-Assist\. Leiding", envKey: "DISCORD_POLITIE_ME_ASSIST_LEIDING_ROLE_ID", defaultRoleId: "1514667366540378112"/);
  assert.match(organizationsCode, /label: "Wijkagent-Leiding", envKey: "DISCORD_POLITIE_WIJKAGENT_LEIDING_ROLE_ID", defaultRoleId: "1524072585221112073"/);
  assert.match(organizationsCode, /label: "Wijkagent-Assist\. Leiding", envKey: "DISCORD_POLITIE_WIJKAGENT_ASSIST_LEIDING_ROLE_ID", defaultRoleId: "1524072866209857576"/);
  assert.match(organizationsCode, /label: "Wijkagent", envKey: "DISCORD_POLITIE_WIJKAGENT_ROLE_ID", defaultRoleId: "1485639884252381316"/);
  assert.match(organizationsCode, /const politieSideTaskBadges = \[[\s\S]*"Wijkagent"/);
  assert.match(organizationsCode, /defaultRecruitCompletedTrainings: \["Basis"\]/);
  assert.match(organizationsCode, /label: "Rang", envKey: "DISCORD_POLITIE_SEPARATOR_RANG_ROLE_ID", defaultRoleId: "1423472054136606761"[\s\S]*always: true/);
  assert.match(organizationsCode, /label: "Specialisaties", envKey: "DISCORD_POLITIE_SEPARATOR_SPECIALISATIES_ROLE_ID", defaultRoleId: "1486666494464098426"[\s\S]*always: true/);
  assert.match(organizationsCode, /label: "Porto", envKey: "DISCORD_POLITIE_SEPARATOR_PORTO_ROLE_ID", defaultRoleId: "1459368187480244384"[\s\S]*always: true/);
  assert.match(organizationsCode, /NH: \{ envKey: "DISCORD_POLITIE_NH_ROLE_ID", defaultRoleId: "1468340097010368747", label: "Noodhulp \(NH\)" \}/);
  assert.match(organizationsCode, /OFF: \{ envKey: "DISCORD_POLITIE_OFF_ROLE_ID", defaultRoleId: "1468338856553353256", label: "Off-Road \(OFF\)" \}/);
  assert.match(organizationsCode, /"K9 Begeleider": \{ envKey: "DISCORD_POLITIE_K9_BEGELEIDER_ROLE_ID", defaultRoleId: "1468339725709480138", label: "Hondenbegeleider" \}/);
  assert.match(organizationsCode, /label: "Extra", envKey: "DISCORD_SEPARATOR_EXTRA_ROLE_ID"[\s\S]*always: true/);
  assert.match(organizationsCode, /label: "Justitie-Defensie", envKey: "DISCORD_JUSTITIE_DEFENSIE_ROLE_ID"[\s\S]*badges: \["hOvJ"\]/);
  assert.match(organizationsCode, /trainingRequirementRoleMappings/);
  assert.match(botCode, /function allBadgeRoleMappings\(/);
  assert.match(botCode, /function syncBadgeRolesForPerson\(/);
  assert.match(botCode, /function syncTrainingRequirementRolesForPerson\(/);
  assert.match(botCode, /assignedBadgeSetForPerson/);
  assert.match(workerCode, /trainingNeededRoles/);
  assert.match(workerCode, /badgeRoles/);
  assert.match(routesCode, /syncTrainingRequirementRolesForPerson/);
  assert.match(routesCode, /function mergeManageableProfileItems\(/);
  assert.match(routesCode, /permissions\.manageableProfileTaskBadges/);
  assert.match(routesCode, /permissions\.manageableProfileFunctionBadges/);
  assert.match(routesCode, /function queuePersonDiscordSyncAfterResponse\(person, reason\)/);
  assert.match(routesCode, /if \(shouldQueueBadgeDiscordSync\) queuePersonDiscordSyncAfterResponse\(person, "badge_updated"\)/);
  assert.ok(
    profileBadgeRoute.indexOf("sendJson(res, 200") < profileBadgeRoute.indexOf('queuePersonDiscordSyncAfterResponse(person, "badge_updated")'),
    "profile badge route should answer before queueing Discord sync"
  );
  assert.match(routesCode, /peopleStorage\.writePersonProfileBadges\(person, badgeActivityMessages\)/);
  assert.match(peopleStoreCode, /async function writePersonProfileBadges\(person, activityMessage\)/);
  assert.match(peopleStoreCode, /badges = \$2::jsonb/);
  assert.match(peopleStoreCode, /extra_functions = \$3::jsonb/);
  assert.match(roleConfigCode, /Benodigde trainingsrollen/);
  assert.match(roleConfigCode, /Functie- en badgerollen/);
  assert.match(scriptCode, /Benodigde training mappings/);
  assert.match(scriptCode, /Functie- en badge mappings/);
});

test("Discord bot exposes training request dropdown and trainer info overview", () => {
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const webhooksCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-webhooks.js"), "utf8");

  assert.match(envExample, /DISCORD_TRAINER_INFO_ENABLED=true/);
  assert.match(envExample, /DISCORD_TRAINER_INFO_CHANNEL_ID=1496169651695128627/);
  assert.match(envExample, /DISCORD_TRAINER_INFO_WEBHOOK_URL=/);
  assert.match(envExample, /DISCORD_TRAINING_REQUEST_K9_ROLE_ID=/);
  assert.match(envExample, /DISCORD_TRAINING_REQUEST_K9_BEGELEIDER_ROLE_ID=/);
  assert.match(workerCode, /const trainerInfoOverviewAllowed = organization\.key === "defensie"/);
  assert.match(workerCode, /trainerInfoOverviewEnabled/);
  assert.match(workerCode, /if \(!trainerInfoOverviewAllowed\) return \[\]/);
  assert.match(workerCode, /async function cleanupDisallowedTrainerInfoOverview\(/);
  assert.match(workerCode, /Trainer-informatie is alleen voor Defensie/);
  assert.match(workerCode, /await cleanupDisallowedTrainerInfoOverview\(\);[\s\S]*connectGateway\(\)/);
  assert.match(workerCode, /organizationKey: organization\.key/);
  assert.match(workerCode, /if \(!trainerInfoOverviewAllowed \|\| !TRAINER_INFO_CHANNEL_ID \|\| trainerInfoOverviewTimer\) return;/);
  assert.match(workerCode, /option\.roleId \|\| fullMapping\?\.roleId/);
  assert.match(workerCode, /entry\.mapping\.roleId && entry\.people\.length > 0/);
  assert.match(workerCode, /Geen openstaande training-aanvragen/);
  assert.match(workerCode, /voegtrainingtoe/);
  assert.match(workerCode, /training_request_select/);
  assert.match(workerCode, /Welke training wil je toevoegen/);
  assert.match(workerCode, /Alleen actieve Defensie leden kunnen training-aanvragen toevoegen/);
  assert.match(workerCode, /label: "BKV"/);
  assert.match(workerCode, /label: "IBT"/);
  assert.match(workerCode, /label: "TMO"/);
  assert.match(workerCode, /label: "SIV"/);
  assert.match(workerCode, /label: "Zulu"/);
  assert.match(workerCode, /label: "OGM"/);
  assert.match(workerCode, /label: "Kustwacht"/);
  assert.match(workerCode, /label: "SMG"/);
  assert.match(workerCode, /label: "OPS"/);
  assert.match(workerCode, /label: "OPCO"/);
  assert.match(workerCode, /label: "K9"/);
  assert.match(workerCode, /label: "K9 Begeleider"/);
  assert.match(workerCode, /label: "Communicatie"/);
  assert.match(workerCode, /label: "EHBO"/);
  assert.match(workerCode, /minimumRank: "Wachtmeester 1ste Klasser"/);
  assert.match(workerCode, /buildTrainerInfoOverviewPayload/);
  assert.match(workerCode, /scheduleTrainerInfoOverviewUpdate/);
  assert.match(botCode, /async function editMessage\(/);
  assert.match(webhooksCode, /editDiscordWebhookMessage/);
});

test("public form webhooks split long Discord embeds over multiple messages", () => {
  const publicFormsCode = fs.readFileSync(path.join(process.cwd(), "modules", "public-forms.js"), "utf8");
  const webhooksCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-webhooks.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  const retryCode = fs.readFileSync(path.join(process.cwd(), "scripts", "retry-public-form-webhooks.js"), "utf8");

  assert.match(publicFormsCode, /function splitPublicFormWebhookPayload\(/);
  assert.match(publicFormsCode, /maxPayloadChars = 5600/);
  assert.match(webhooksCode, /sendDiscordWebhookPayloadsWithMessageThread/);
  assert.match(webhooksCode, /createDiscordThreadMessage/);
  assert.match(webhooksCode, /list\.length - 1/);
  assert.match(webhooksCode, /const finalResult = await sendDiscordWebhookWithMessageThread/);
  assert.match(serverCode, /splitPublicFormWebhookPayload\(payload\)/);
  assert.match(retryCode, /messages=\$\{payloads\.length\}/);
});

test("Defensie OVD is a Discord qualification role mapping", () => {
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const organizationsCode = fs.readFileSync(path.join(process.cwd(), "modules", "organizations.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");
  const roleConfigCode = fs.readFileSync(path.join(process.cwd(), "scripts", "check-discord-role-config.js"), "utf8");
  assert.match(envExample, /DISCORD_OVD_ROLE_ID=/);
  assert.match(organizationsCode, /OVD: \{ envKey: "DISCORD_OVD_ROLE_ID"/);
  assert.match(botCode, /OVD: \{\s+envKey: "DISCORD_OVD_ROLE_ID"/);
  assert.match(roleConfigCode, /Ontbrekende kwalificatierol env keys/);
});

test("Porto login accepts linked current profiles during absence", () => {
  const portoCode = fs.readFileSync(path.join(process.cwd(), "porto-server.js"), "utf8");
  assert.match(portoCode, /isPersonLoginEligible/);
  assert.match(portoCode, /canUsePortalLogin/);
  assert.doesNotMatch(portoCode, /person\.status === "Actief"/);
  assert.match(portoCode, /normalizeDiscordId\(person\.discordId\) === loginDiscordId && isPersonLoginEligible\(person\)/);
});
