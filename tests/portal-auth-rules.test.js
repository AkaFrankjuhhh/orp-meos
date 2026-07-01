const test = require("node:test");
const assert = require("node:assert/strict");

const { canUsePortalLogin, hasOrganizationRole, isLinkedLoginProfile } = require("../modules/portal-auth-rules");

test("portal login accepts a current linked profile without organization role", () => {
  const profile = { discordId: "discord:123", status: "Afwezig" };

  assert.equal(isLinkedLoginProfile(profile, "123"), true);
  assert.equal(canUsePortalLogin({
    profile,
    discordId: "123",
    roles: [],
    organizationRoleId: "role-main"
  }), true);
});

test("portal login still blocks removed linked profiles without organization role", () => {
  assert.equal(canUsePortalLogin({
    profile: { discordId: "123", status: "Ontslagen" },
    discordId: "123",
    roles: [],
    organizationRoleId: "role-main"
  }), false);
});

test("portal login accepts organization role and dev override", () => {
  assert.equal(hasOrganizationRole(["role-main"], "role-main"), true);
  assert.equal(canUsePortalLogin({
    profile: null,
    discordId: "456",
    roles: ["role-main"],
    organizationRoleId: "role-main"
  }), true);
  assert.equal(canUsePortalLogin({ devOverride: true }), true);
});

test("portal login blocks unlinked users without organization role", () => {
  assert.equal(canUsePortalLogin({
    profile: { discordId: "123", status: "Actief" },
    discordId: "456",
    roles: [],
    organizationRoleId: "role-main"
  }), false);
});
