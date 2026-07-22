const test = require("node:test");
const assert = require("node:assert/strict");
const { createAuthServices } = require("../modules/auth");

test("session profile id is refreshed from Discord id after reactivation", () => {
  const session = {
    profileId: "old-profile",
    profile: {
      id: "old-profile",
      name: "Oud Profiel",
      discordId: "1234567890",
      status: "Ontslagen"
    },
    user: { id: "1234567890" }
  };
  const saved = [];
  const sessions = {
    get: (id) => {
      session.id = id;
      return session;
    },
    save: (id, nextSession) => saved.push({ id, profileId: nextSession.profileId })
  };
  const state = {
    people: [
      {
        id: "old-profile",
        name: "Oud Profiel",
        discordId: "1234567890",
        status: "Ontslagen"
      },
      {
        id: "active-profile",
        name: "Nieuw Profiel",
        discordId: "1234567890",
        status: "Actief"
      }
    ]
  };
  const { getLoggedInProfile } = createAuthServices({
    sessions,
    readState: () => state,
    discordConfigured: () => true,
    allowDevUnauth: () => false
  });

  const auth = getLoggedInProfile({ headers: { cookie: "orp_session=test-session" } });

  assert.equal(auth.profile.id, "active-profile");
  assert.equal(session.profileId, "active-profile");
  assert.equal(session.profile.name, "Nieuw Profiel");
  assert.deepEqual(saved, [{ id: "test-session", profileId: "active-profile" }]);
});
