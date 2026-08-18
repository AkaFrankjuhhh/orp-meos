const assert = require("node:assert/strict");
const test = require("node:test");

const {
  portalIdentitySearchHints,
  portalPersonDisplayName,
  portalPersonMatchesSearchHints,
  serviceNumberFromDiscordNickname,
  stripDiscordNicknamePrefix
} = require("../modules/side-tasks-portal-identity");

test("MEOS identity hints parse Discord nicknames from the personnel portal", () => {
  const hints = portalIdentitySearchHints(
    { id: "123", username: "slak", global_name: "Slak" },
    { nick: "[73-04] Slak G.", user: { username: "slak", global_name: "Slak" } }
  );

  assert.deepEqual(hints.serviceNumbers, ["73-04"]);
  assert.ok(hints.names.includes("slak"));
  assert.ok(hints.names.includes("slak g"));
  assert.ok(hints.usernames.includes("slak"));
  assert.equal(portalPersonMatchesSearchHints({ name: "Slak Giesen", discord_username: "" }, hints), true);
  assert.equal(portalPersonMatchesSearchHints({ name: "Andere Medewerker", discord_username: "" }, hints), false);
});

test("MEOS identity hints handle active duty prefixes before service nicknames", () => {
  assert.equal(stripDiscordNicknamePrefix("OVD-K [73-04] Slak G."), "Slak G.");
  assert.equal(serviceNumberFromDiscordNickname("[73-04] Slak G."), "73-04");
});

test("MEOS profile names prefer full portal names over compact Discord fallbacks", () => {
  assert.equal(
    portalPersonDisplayName({
      name: "Slak G.",
      discord_username: "Frank B",
      raw: { name: "Slak Giesen" }
    }, { fallbackNickname: "[73-01] Slak G." }),
    "Slak Giesen"
  );
  assert.equal(
    portalPersonDisplayName({
      name: "",
      discord_username: "Frank B",
      raw: {}
    }, { fallbackNickname: "[73-01] Slak G." }),
    "Slak G."
  );
});
