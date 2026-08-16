const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  sideTaskForKey,
  permissionsForTask,
  dnrUnitsForRoles,
  canUseDnrUnit,
  statusOptionsForTask
} = require("../modules/side-tasks-config");
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
  assert.equal(dsiTask.dsiUnits.min, 2);
  assert.deepEqual(dsiTask.dsiUnits.commandUnits, { TCO: "50-00", ACO: "50-01" });
});

test("DSI unit assignment does not hard-code the old 24 range", () => {
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "side-tasks-store.js"), "utf8");
  const uiCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");
  assert.doesNotMatch(storeCode, /`24-\$\{String\(index\)/);
  assert.doesNotMatch(storeCode, /\^24-/);
  assert.match(storeCode, /TCO: `\$\{DSI_UNIT_PREFIX\}-00`, ACO: `\$\{DSI_UNIT_PREFIX\}-01`/);
  assert.match(storeCode, /const DSI_FIRST_REGULAR_UNIT = Number\(DSI_UNITS\.min \|\| 2\)/);
  assert.doesNotMatch(uiCode, /24-eenheid|24-eenheden|24-nummer/);
});

test("DSI members can assign ACO and TCO labels", () => {
  process.env.SIDE_TASK_DSI_MEMBER_ROLE_IDS = "dsi-member-role";
  const dsiTask = sideTaskForKey("DSI");
  const permissions = permissionsForTask(dsiTask, ["dsi-member-role"], "discord-user");
  assert.equal(permissions.hasAccess, true);
  assert.equal(permissions.canAssignDsiCommand, true);
});

test("HRB supports automatic HRB units and CM/PLAVA command slots", () => {
  process.env.SIDE_TASK_HRB_MEMBER_ROLE_IDS = "hrb-member-role";
  const hrbTask = sideTaskForKey("HRB");
  const permissions = permissionsForTask(hrbTask, ["hrb-member-role"], "discord-user");
  const statuses = statusOptionsForTask(hrbTask).map((status) => status.value);

  assert.equal(hrbTask.allowAlias, true);
  assert.equal(hrbTask.aliasProfile.numberSource, "auto");
  assert.equal(hrbTask.aliasProfile.nicknameTemplate, "[{number}] {name}");
  assert.equal(hrbTask.hrbUnits.prefix, "HRB");
  assert.equal(hrbTask.hrbUnits.min, 2);
  assert.deepEqual(hrbTask.hrbUnits.commandUnits, { CM: "HRB-00", PLAVA: "HRB-01" });
  assert.equal(hrbTask.hrbUnits.botPrefix, "BOT");
  assert.equal(hrbTask.hrbUnits.botMin, 0);
  assert.deepEqual(statuses, ["0", "1", "4", "8"]);
  assert.equal(permissions.hasAccess, true);
  assert.equal(permissions.canAssignHrbCommand, true);
});

test("HRB unit assignment is handled server-side with protected nicknames", () => {
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "side-tasks-store.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "side-tasks-server.js"), "utf8");
  const clientCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");
  const botCode = fs.readFileSync(path.join(process.cwd(), "modules", "discord-bot.js"), "utf8");

  assert.match(storeCode, /const HRB_COMMAND_UNITS = Object\.freeze/);
  assert.match(storeCode, /CM: `\$\{HRB_UNIT_PREFIX\}-00`, PLAVA: `\$\{HRB_UNIT_PREFIX\}-01`/);
  assert.match(storeCode, /const HRB_FIRST_REGULAR_UNIT = Number\(HRB_UNITS\.min \|\| 2\)/);
  assert.match(storeCode, /const HRB_BOT_UNIT_PREFIX = String\(HRB_UNITS\.botPrefix \|\| "BOT"\)/);
  assert.match(storeCode, /function formatHrbBotUnit/);
  assert.match(storeCode, /async function assignHrbUnit/);
  assert.match(storeCode, /async function linkHrbUnit/);
  assert.match(storeCode, /async function assignHrbCommandRole/);
  assert.match(storeCode, /Koppel aan een actief \$\{HRB_UNIT_PREFIX\}- of \$\{HRB_BOT_UNIT_PREFIX\}-nummer/);
  assert.match(storeCode, /jsonb_build_object\('hrbDutyMode', \$7::text\)/);
  assert.match(storeCode, /const nextDutyMode = hrbDutyModeForUnitNumber\(unitNumber\)/);
  assert.match(storeCode, /findActiveSideTaskNicknameMember/);
  assert.match(serverCode, /store\.assignHrbUnit\(task\.key, member\.id, "", status\)/);
  assert.match(serverCode, /const hrbUnitMatch/);
  assert.match(serverCode, /store\.linkHrbUnit\(task\.key, member\.id, unitNumber\)/);
  assert.match(serverCode, /side-tasks\\\/hrb\\\/members\\\/\(\[\^\/\]\+\)\\\/unit/);
  assert.match(serverCode, /const hrbBotUnitMatch/);
  assert.match(serverCode, /bot-unit/);
  assert.match(serverCode, /memberHasHrbBotSpecialty/);
  assert.match(serverCode, /hrb-bot-unit-updated/);
  assert.match(serverCode, /hrbDutyModeForMember\(member\) === "BOT"/);
  assert.match(serverCode, /const hrbSignOffMatch/);
  assert.match(serverCode, /hrb-member-signed-off/);
  assert.match(serverCode, /const hrbCommandMatch/);
  assert.match(serverCode, /function buildHrbNickname/);
  assert.match(serverCode, /\["CM", "PLAVA"\]\.includes\(commandRole\)/);
  assert.match(serverCode, /formatNameForDiscordNickname\(normalAliasName\(member, portalIdentity\)\)/);
  assert.match(serverCode, /side-tasks\\\/hrb\\\/members/);
  assert.match(clientCode, /function hrbUnitLinkOptions/);
  assert.match(clientCode, /const activeUnits = new Map/);
  assert.doesNotMatch(clientCode, /HRB-03 \(vrij\)/);
  assert.match(clientCode, /function hrbContextMenu/);
  assert.match(clientCode, /data-hrb-member/);
  assert.match(clientCode, /data-action="hrb-open-link-menu"/);
  assert.match(clientCode, /data-action="hrb-confirm-link"/);
  assert.match(clientCode, /data-hrb-unit-select/);
  assert.match(clientCode, /data-action="hrb-sign-off-member"/);
  assert.match(clientCode, /data-action="hrb-set-command-role"/);
  assert.match(clientCode, /data-action="hrb-set-bot-unit"/);
  assert.match(clientCode, /BOT opnemen/);
  assert.match(clientCode, /BOT aanmelden/);
  assert.match(clientCode, /Koppelen aan HRB\/BOT-nummer/);
  assert.match(clientCode, /function hrbGroupedMemberSection/);
  assert.match(clientCode, /function hrbUnitGroupCard/);
  assert.match(clientCode, /data-hrb-unit-group/);
  assert.match(clientCode, /hrb-unit-member/);
  assert.match(clientCode, /CM opnemen/);
  assert.match(clientCode, /PLAVA opnemen/);
  assert.match(botCode, /findActiveSideTaskNicknameMember/);
  assert.match(botCode, /Neventaken nickname blijft behouden/);
  assert.match(botCode, /\?:ACO\|TCO\|CM\|PLAVA/);
});

test("LR supports automatic recherche unit ranges", () => {
  const dnrTask = sideTaskForKey("DNR");
  assert.equal(dnrTask.slug, "lr");
  assert.equal(dnrTask.label, "LR");
  assert.equal(dnrTask.displayName, "Landelijke Recherche");
  assert.equal(dnrTask.hostname, "lr.orpoverheid.nl");
  assert.deepEqual(dnrTask.hostnames, ["lr.orpoverheid.nl", "dnr.orpoverheid.nl"]);
  assert.equal(dnrTask.allowAlias, true);
  assert.equal(dnrTask.aliasProfile.numberSource, "unit");
  assert.equal(dnrTask.aliasProfile.numberLabel, "LR eenheid");
  assert.equal(dnrTask.aliasProfile.nicknameTemplate, "[{number} - ※] {name}");
  assert.equal(dnrTask.aliasProfile.supportsUndercover, false);
  assert.deepEqual(dnrTask.roleIds.members, ["1485659456837783744"]);
  assert.deepEqual(dnrTask.dnrUnits.map((unit) => [unit.key, unit.prefix, unit.requiresAlias]), [
    ["technical", "11", false],
    ["tactical", "12", true],
    ["unit-six", "13", true]
  ]);
  assert.deepEqual(dnrTask.dnrUnits.map((unit) => [unit.key, unit.roleIds]), [
    ["technical", ["1485659765429501982"]],
    ["tactical", ["1485659805673586688"]],
    ["unit-six", ["1506721224062144722", "1506721133100007615", "1506720813099778229"]]
  ]);
  assert.deepEqual(dnrTask.dnrUnits.map((unit) => [unit.key, unit.leadershipNumber, unit.leadershipRoleIds]), [
    ["technical", "11-00", ["1485659279263273091"]],
    ["tactical", "12-00", ["1485659407277752482"]],
    ["unit-six", "13-00", ["1506720813099778229"]]
  ]);
});

test("LR unit choices follow Discord unit roles", () => {
  const dnrTask = sideTaskForKey("DNR");
  const technicalRole = "1485659765429501982";
  const technicalSeniorRole = "1485659279263273091";
  const tacticalRole = "1485659805673586688";
  const tacticalSeniorRole = "1485659407277752482";
  const unitSixRole = "1506721224062144722";
  const unitSixTeamchefRole = "1506720813099778229";

  assert.equal(permissionsForTask(dnrTask, [technicalRole], "discord-user").hasAccess, true);
  assert.equal(permissionsForTask(dnrTask, [technicalRole], "discord-user").roles.dnrUnit, true);
  assert.deepEqual(dnrUnitsForRoles(dnrTask, [technicalRole], "discord-user").map((unit) => unit.key), ["technical"]);
  assert.deepEqual(dnrUnitsForRoles(dnrTask, [tacticalRole, unitSixRole], "discord-user").map((unit) => unit.key), ["tactical", "unit-six"]);
  assert.deepEqual(dnrUnitsForRoles(dnrTask, [technicalSeniorRole], "discord-user").map((unit) => unit.key), ["technical"]);
  assert.deepEqual(dnrUnitsForRoles(dnrTask, [tacticalSeniorRole, unitSixTeamchefRole], "discord-user").map((unit) => unit.key), ["tactical", "unit-six"]);
  assert.equal(canUseDnrUnit(dnrTask, [unitSixRole], "discord-user", "unit-six"), true);
  assert.equal(canUseDnrUnit(dnrTask, [unitSixRole], "discord-user", "technical"), false);
  assert.equal(permissionsForTask(dnrTask, [technicalRole], "discord-user").canManageDnrUnits, false);
  assert.equal(permissionsForTask(dnrTask, [technicalSeniorRole], "discord-user").canManageDnrUnits, true);
  assert.equal(permissionsForTask(dnrTask, [technicalSeniorRole], "discord-user").canSignOffDnrMembers, true);
});

test("LR unit assignment is handled server-side", () => {
  const storeCode = fs.readFileSync(path.join(process.cwd(), "modules", "side-tasks-store.js"), "utf8");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "side-tasks-server.js"), "utf8");
  const clientCode = fs.readFileSync(path.join(process.cwd(), "side-tasks.js"), "utf8");

  assert.match(storeCode, /async function assignDnrUnit/);
  assert.match(storeCode, /options\.useLeadershipNumber/);
  assert.match(storeCode, /options\.unitNumber/);
  assert.match(storeCode, /dnrUnit\.leadershipNumber/);
  assert.match(storeCode, /formatDnrUnit\(dnrUnit\.prefix, index\)/);
  assert.match(storeCode, /occupiedUnit\.rows\.length >= capacity/);
  assert.match(serverCode, /function requireAllowedDnrUnit/);
  assert.match(serverCode, /function canUseDnrLeadershipNumber/);
  assert.match(serverCode, /dnrUnit\.leadershipRoleIds/);
  assert.match(serverCode, /store\.assignDnrUnit\(task\.key, member\.id, dnrUnitKey/);
  assert.match(serverCode, /const dnrSignOffMatch/);
  assert.match(serverCode, /side-tasks\\\/dnr\\\/members/);
  assert.match(serverCode, /canSignOffDnrMembers/);
  assert.match(clientCode, /selectableDnrUnits/);
  assert.match(clientCode, /function dnrContextMenu/);
  assert.match(clientCode, /data-dnr-member/);
  assert.match(clientCode, /data-dnr-unit-select/);
  assert.match(clientCode, /data-action="dnr-open-link-menu"/);
  assert.match(clientCode, /data-action="dnr-sign-off-member"/);
  assert.match(clientCode, /name="dnrUnitKey"/);
  assert.match(clientCode, /\[\$\{number\} - ※\]/);
});

test("KLu stores manual Eagle numbers", () => {
  const kluTask = sideTaskForKey("KLU");
  const serverCode = fs.readFileSync(path.join(process.cwd(), "side-tasks-server.js"), "utf8");

  assert.equal(kluTask.allowAlias, true);
  assert.equal(kluTask.aliasProfile.numberSource, "manual");
  assert.equal(kluTask.aliasProfile.numberPattern, "^Eagle\\s+\\d{1,2}$");
  assert.equal(kluTask.aliasProfile.rankNumbers.Generaal.number, "1");
  assert.equal(kluTask.aliasProfile.rankNumbers["Soldaat der 2de klasse"].number, "9");
  assert.match(serverCode, /if \(task\.key === "KLU"\) \{\s+const savedNumber = normalizeAliasNumber\(task, member\.callSign\);\s+if \(savedNumber\) return savedNumber;/);
  assert.match(serverCode, /if \(task\.key === "KLU"\) \{\s+const match = \/\^eagle\\s\*\(\\d\{1,2\}\)\$\/i\.exec\(text\);/);
  assert.match(serverCode, /task\.key === "KLU" && shouldSyncAliasNicknameForStatus\(task, member\.status\)/);
});
