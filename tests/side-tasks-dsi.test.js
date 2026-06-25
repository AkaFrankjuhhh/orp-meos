const test = require("node:test");
const assert = require("node:assert/strict");
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
