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

  assert.match(html, /app\.js\?v=20260715-mentor-autosave/);
  assert.match(appCode, /LIVE_REFRESH_LOCAL_ACTION_SUPPRESS_MS/);
  assert.match(appCode, /suppressImmediateLiveRefresh\(\);/);
  assert.match(appCode, /function isLiveRefreshSuppressed\(/);
});

test("mentor checklist autosave is serialized against live refresh", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const mentorCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "mentor.js"), "utf8");

  assert.match(html, /personeelsportaal\/mentor\.js\?v=20260715-mentor-autosave/);
  assert.match(mentorCode, /let mentorChecklistSavePromise = null/);
  assert.match(mentorCode, /let mentorChecklistSaveQueued = false/);
  assert.match(mentorCode, /function isMentorChecklistSaveActive\(/);
  assert.match(mentorCode, /if \(mentorChecklistSavePromise\) return mentorChecklistSavePromise/);
  assert.match(mentorCode, /while \(mentorChecklistSaveQueued\)/);
  assert.match(appCode, /isMentorChecklistSaveActive\(\)/);
  assert.match(appCode, /isSavingMentorChecklist/);
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

test("calm dashboard adapts before police counters overflow", () => {
  const styles = fs.readFileSync(path.join(process.cwd(), "personeelsportaal.css"), "utf8");

  assert.match(styles, /html\[data-ui-mode="calm"\] \.dashboard-grid > \.panel/);
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(styles, /html\[data-ui-mode="calm"\] \.dashboard-grid \{\s+grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /html\[data-ui-mode="calm"\] \.member-summary strong \{[\s\S]*font-size: clamp\(36px, 3\.4vw, 52px\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});

test("people mutations persist rank changes before queueing Discord sync", () => {
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");

  assert.match(routesCode, /async function persistPeopleStateMutation\(state\)/);

  const recruitmentBlock = routesCode.slice(routesCode.indexOf('queuePersonDiscordSync(state, result.person, "recruitment_hire"') - 240, routesCode.indexOf('queuePersonDiscordSync(state, result.person, "recruitment_hire"') + 120);
  assert.match(recruitmentBlock, /await persistPeopleStateMutation\(state\);[\s\S]*queuePersonDiscordSync\(state, result\.person, "recruitment_hire"\)/);

  const personSaveBlock = routesCode.slice(routesCode.indexOf('queuePersonDiscordSync(state, result.person, existingBeforeSave ? "person_updated" : "person_created"') - 240, routesCode.indexOf('queuePersonDiscordSync(state, result.person, existingBeforeSave ? "person_updated" : "person_created"') + 160);
  assert.match(personSaveBlock, /await persistPeopleStateMutation\(state\);[\s\S]*queuePersonDiscordSync\(state, result\.person, existingBeforeSave \? "person_updated" : "person_created"\)/);

  const rankActionBlock = routesCode.slice(routesCode.indexOf('if (["promote", "demote"].includes(action))'), routesCode.indexOf('} else if (action !== "io"'));
  assert.match(rankActionBlock, /await persistPeopleStateMutation\(state\);[\s\S]*queueChangedDiscordProfiles\(state, previousNicknames, previousRankRoles, `person_\$\{action\}`\)/);
});

test("porto exposes the modern dispatcher test UI beside the classic UI", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const portoCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const opsCode = fs.readFileSync(path.join(process.cwd(), "porto", "ops.js"), "utf8");
  const dutyCode = fs.readFileSync(path.join(process.cwd(), "porto", "duty.js"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "porto.css"), "utf8");

  assert.match(html, /data-porto-ui-choice="classic"/);
  assert.match(html, /data-porto-ui-choice="modern"/);
  assert.match(html, /id="portoModernDutyDashboard"/);
  assert.match(html, /id="portoModernOpsDashboard"/);
  assert.match(portoCode, /PORTO_UI_MODE_KEY/);
  assert.match(portoCode, /function bindPortoUiToggle/);
  assert.match(opsCode, /function renderModernOpsDashboard/);
  assert.match(dutyCode, /function renderModernDutyDashboard/);
  assert.match(styles, /body\[data-porto-ui="modern"\]\.porto-duty-workspace/);
  assert.match(styles, /\.porto-modern-ops-dashboard/);
});

test("modern duty status layout stays aligned on desktop widths", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "porto.html"), "utf8");
  const styles = fs.readFileSync(path.join(process.cwd(), "porto.css"), "utf8");

  assert.match(html, /porto\.css\?v=20260717-responsive-stability/);
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

  assert.match(html, /porto\.css\?v=20260717-responsive-stability/);
  assert.match(styles, /\.porto-profile-dialog \{[\s\S]*contain: layout paint;/);
  assert.match(styles, /\.porto-profile-dialog::backdrop \{[\s\S]*backdrop-filter: none;/);
  assert.match(styles, /\.porto-profile-form \{[\s\S]*overscroll-behavior: contain;/);
  assert.match(styles, /\.porto-profile-form \{[\s\S]*scrollbar-gutter: stable;/);
});

test("porto browser heartbeat avoids noisy persistence and stale active screens", () => {
  const clientCode = fs.readFileSync(path.join(process.cwd(), "porto.js"), "utf8");
  const routesCode = fs.readFileSync(path.join(process.cwd(), "modules", "porto-routes.js"), "utf8");
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  const policeEnvExample = fs.readFileSync(path.join(process.cwd(), ".env.politie.example"), "utf8");

  assert.match(routesCode, /PORTO_BROWSER_HEARTBEAT_PERSIST_MS/);
  assert.match(routesCode, /4 \* 60 \* 60 \* 1000/);
  assert.match(routesCode, /const heartbeatChanged = markPortoBrowserHeartbeat\(unit\);/);
  assert.match(routesCode, /if \(heartbeatChanged\) await persistPortoState\(state, \{ units: state\.portoUnits \}\);/);
  assert.match(clientCode, /heartbeat && heartbeat\.active === false/);
  assert.match(clientCode, /schedulePortoLiveRefresh\("porto"\)/);
  assert.match(envExample, /PORTO_BROWSER_HARD_TIMEOUT_MS=14400000/);
  assert.match(envExample, /PORTO_BROWSER_HEARTBEAT_PERSIST_MS=45000/);
  assert.match(policeEnvExample, /PORTO_BROWSER_HARD_TIMEOUT_MS=14400000/);
  assert.match(policeEnvExample, /PORTO_BROWSER_HEARTBEAT_PERSIST_MS=45000/);
});

test("I8 create form keeps a browser draft until server save succeeds", () => {
  const appCode = fs.readFileSync(path.join(process.cwd(), "app.js"), "utf8");
  const i8Code = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "i8.js"), "utf8");
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");

  assert.match(i8Code, /function saveI8Draft\(/);
  assert.match(i8Code, /function restoreI8Draft\(/);
  assert.match(i8Code, /function clearI8Draft\(/);
  assert.match(appCode, /button\.dataset\.i8Tab === "create"\) restoreI8Draft/);
  assert.match(appCode, /if \(!saved\) return;\s+clearI8Draft\(\);/);
  assert.match(html, /personeelsportaal\/i8\.js\?v=20260630-i8-draft-autosave/);
});

test("mentor test Discord embed formats submitted date and time", () => {
  const serverCode = fs.readFileSync(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(serverCode, /function formatMentorTestDateTime\(/);
  assert.match(serverCode, /timeZone: "Europe\/Amsterdam"/);
  assert.match(serverCode, /name: "Ingediend op", value: formatMentorTestDateTime\(test\.submittedAt\)/);
});

test("side task shell serves DNR and KLu alias assets with a fresh version", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "side-tasks.html"), "utf8");
  assert.match(html, /side-tasks\.css\?v=20260703-calm-arial/);
  assert.match(html, /side-tasks\.js\?v=20260705-browser-heartbeat/);
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
  const mentorCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "mentor.js"), "utf8");
  assert.match(html, /mentorTestDetailDialog/);
  assert.match(html, /personeelsportaal\/mentor\.js\?v=20260715-mentor-autosave/);
  assert.match(mentorCode, /data-open-mentor-test-detail/);
  assert.match(mentorCode, /function openMentorTestDetailDialog/);
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
  assert.match(routesCode, /reason === "qualification_updated"/);
  assert.match(routesCode, /Wacht op Discord rollen of eerstvolgende worker-run/);
  assert.match(workerCode, /nestedSyncFailureFromResult/);
  assert.match(workerCode, /\$\{label\} overgeslagen/);
  assert.match(workerCode, /if \(nestedFailure\) throw nestedFailure/);
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
  const workerCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");
  const roleConfigCode = fs.readFileSync(path.join(process.cwd(), "scripts", "check-discord-role-config.js"), "utf8");
  const scriptCode = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-sync-person.js"), "utf8");

  assert.match(envExample, /DISCORD_MENTOR_LEIDING_ROLE_ID=/);
  assert.match(envExample, /DISCORD_POLITIE_DSI_ROLE_ID=/);
  assert.match(envExample, /DISCORD_TRAINING_NEEDED_BKV_ROLE_ID=1499476179537625128/);
  assert.match(envExample, /DISCORD_JUSTITIE_DEFENSIE_ROLE_ID=/);
  assert.match(envExample, /DISCORD_SEPARATOR_EXTRA_ROLE_ID=1526710886511939794/);
  assert.match(organizationsCode, /label: "Trainer", envKey: "DISCORD_TRAINER_ROLE_ID"/);
  assert.match(organizationsCode, /label: "DSI", envKey: "DISCORD_DSI_ROLE_ID"/);
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
  assert.match(routesCode, /queuePersonDiscordSync\(state, person, "badge_updated"\)/);
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

  assert.match(envExample, /DISCORD_TRAINER_INFO_CHANNEL_ID=1496169651695128627/);
  assert.match(envExample, /DISCORD_TRAINER_INFO_WEBHOOK_URL=/);
  assert.match(workerCode, /voegtrainingtoe/);
  assert.match(workerCode, /training_request_select/);
  assert.match(workerCode, /Welke training wil je toevoegen/);
  assert.match(workerCode, /label: "Zulu"/);
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
