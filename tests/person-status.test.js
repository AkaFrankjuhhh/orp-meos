const test = require("node:test");
const assert = require("node:assert/strict");

const { isActivePerson, isPersonLoginEligible } = require("../modules/person-status");

test("portal login accepts active and temporary personnel statuses", () => {
  assert.equal(isPersonLoginEligible({ status: "Actief" }), true);
  assert.equal(isPersonLoginEligible({ status: "Afwezig" }), true);
  assert.equal(isPersonLoginEligible({ status: "I.O" }), true);
  assert.equal(isPersonLoginEligible({ status: "" }), true);
  assert.equal(isPersonLoginEligible({}), true);
});

test("portal login blocks removed or blacklisted personnel statuses", () => {
  assert.equal(isPersonLoginEligible(null), false);
  assert.equal(isPersonLoginEligible({ status: "Inactief" }), false);
  assert.equal(isPersonLoginEligible({ status: "Ontslagen" }), false);
  assert.equal(isPersonLoginEligible({ status: "Gearchiveerd" }), false);
  assert.equal(isPersonLoginEligible({ status: "Archief" }), false);
  assert.equal(isPersonLoginEligible({ status: "Blacklist" }), false);
  assert.equal(isPersonLoginEligible({ status: "Geblacklist" }), false);
});

test("active status helper remains strict for active-state UI", () => {
  assert.equal(isActivePerson({ status: "Actief" }), true);
  assert.equal(isActivePerson({ status: "Afwezig" }), false);
  assert.equal(isActivePerson({ status: "I.O" }), false);
});
