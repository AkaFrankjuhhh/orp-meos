const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { sideTaskForKey, permissionsForTask } = require("../modules/side-tasks-config");
const { shouldSyncDsiNicknameForStatus, requireDsiIdentityForStatus } = require("../modules/side-tasks-dsi");

test("DSI nickname sync only runs for status 0, 1 and 8", () => {
  assert.equal(shouldSyncDsiNicknameForStatus("0"), true);
  assert.equal(shouldSyncDsiNicknameForStatus("1"), true);
  assert.equal(shouldSyncDsiNicknameForStatus("4"), false);
  assert.equal(shouldSyncDsiNicknameForStatus("8"), true);
});

test("DSI status 0 requires saved callsign and alias", () => {
  assert.throws(() => requireDsiIdentityForStatus({ callSign: "", aliasName: "Simon R." }, "0"), /roepnummer en schuilnaam/);
  assert.doesNotThrow(() => requireDsiIdentityForStatus({ callSign: "R-03", aliasName: "Simon R." }, "0"));
  assert.doesNotThrow(() => requireDsiIdentityForStatus({}, "8"));
});

test("DSI uses the 50 unit range", () => {
  const dsiTask = sideTaskForKey("DSI");
  assert.equal(dsiTask.dsiUnits.prefix, "50");
  assert.deepEqual(dsiTask.dsiUnits.commandUnits, { TCO: "50-01", ACO: "50-02" });
});

test("DSI unit assignment does not hard-code the old 24 range", () => {
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "side-tasks-store.js"), "utf8");
  const uiCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");
  assert.doesNotMatch(storeCode, /`24-\$\{String\(index\)/);
  assert.doesNotMatch(storeCode, /\^24-/);
  assert.doesNotMatch(uiCode, /24-eenheid|24-eenheden|24-nummer/);
});

test("DSI members can assign ACO and TCO labels", () => {
  process.env.SIDE_TASK_DSI_MEMBER_ROLE_IDS = "dsi-member-role";
  const dsiTask = sideTaskForKey("DSI");
  const permissions = permissionsForTask(dsiTask, ["dsi-member-role"], "discord-user");
  assert.equal(permissions.hasAccess, true);
  assert.equal(permissions.canAssignDsiCommand, true);
});

test("DNR supports automatic recherche unit ranges", () => {
  const dnrTask = sideTaskForKey("DNR");
  assert.equal(dnrTask.allowAlias, true);
  assert.equal(dnrTask.aliasProfile.numberSource, "unit");
  assert.equal(dnrTask.aliasProfile.nicknameTemplate, "[{number} - ※] {name}");
  assert.equal(dnrTask.aliasProfile.supportsUndercover, false);
  assert.deepEqual(dnrTask.dnrUnits.map((unit) => [unit.key, unit.prefix, unit.requiresAlias]), [
    ["technical", "11", false],
    ["tactical", "12", true],
    ["unit-six", "13", true]
  ]);
});

test("DNR unit assignment is handled server-side", () => {
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "side-tasks-store.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "side-tasks-server.js"), "utf8");
  const clientCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");

  assert.match(storeCode, /async function assignDnrUnit/);
  assert.match(storeCode, /options\.useLeadershipNumber/);
  assert.match(storeCode, /dnrUnit\.leadershipNumber/);
  assert.match(storeCode, /formatDnrUnit\(dnrUnit\.prefix, index\)/);
  assert.match(serverCode, /function canUseDnrLeadershipNumber/);
  assert.match(serverCode, /store\.assignDnrUnit\(task\.key, member\.id, dnrUnitKey/);
  assert.match(clientCode, /name="dnrUnitKey"/);
  assert.match(clientCode, /\[\$\{number\} - ※\]/);
});

test("KLu supports Eagle rank numbers", () => {
  const kluTask = sideTaskForKey("KLU");
  assert.equal(kluTask.allowAlias, true);
  assert.equal(kluTask.aliasProfile.numberSource, "rank");
  assert.equal(kluTask.aliasProfile.rankNumbers.Generaal.number, "1");
  assert.equal(kluTask.aliasProfile.rankNumbers["Soldaat der 2de klasse"].number, "9");
});
