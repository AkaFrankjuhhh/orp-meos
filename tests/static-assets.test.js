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
  assert.match(html, /side-tasks\.css\?v=20260630-dnr-klu-alias/);
  assert.match(html, /side-tasks\.js\?v=20260630-dnr-klu-alias/);
});

test("mentor tests render compact rows with a detail dialog", () => {
  const html = fs.readFileSync(path.join(process.cwd(), "index.html"), "utf8");
  const mentorCode = fs.readFileSync(path.join(process.cwd(), "personeelsportaal", "mentor.js"), "utf8");
  assert.match(html, /mentorTestDetailDialog/);
  assert.match(html, /personeelsportaal\/mentor\.js\?v=20260630-mentor-test-dialog/);
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
  assert.match(scriptCode, /Ontbrekende gewenste rollen/);
  assert.match(scriptCode, /Gewenst maar niet geconfigureerd/);
  assert.match(scriptCode, /syncQualificationRolesForPerson\(person/);
  assert.match(scriptCode, /--apply/);
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
