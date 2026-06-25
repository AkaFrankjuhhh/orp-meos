const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildDiscordLeaveLogPayload,
  collectDefensieLeaveLogRoleIds,
  collectOrganizationDiscordRoleIds,
  discordUserTag,
  memberHasAnyTrackedRole,
  sendDiscordLeaveLog
} = require("../modules/discord-leave-log");
const { organizationConfigs } = require("../modules/organizations");

test("collectOrganizationDiscordRoleIds includes configured main, function, rank and qualification roles", () => {
  const previous = {
    DISCORD_DEFENSIE_ROLE_ID: process.env.DISCORD_DEFENSIE_ROLE_ID,
    DISCORD_KADER_ROLE_ID: process.env.DISCORD_KADER_ROLE_ID,
    DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID: process.env.DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID
  };
  process.env.DISCORD_DEFENSIE_ROLE_ID = "role-main";
  process.env.DISCORD_KADER_ROLE_ID = "role-kader";
  process.env.DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID = "role-rank";

  try {
    const roleIds = collectOrganizationDiscordRoleIds(organizationConfigs.defensie);

    assert.equal(roleIds.has("role-main"), true);
    assert.equal(roleIds.has("role-kader"), true);
    assert.equal(roleIds.has("role-rank"), true);
    assert.equal(roleIds.has("1425931664877551708"), true);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("memberHasAnyTrackedRole only matches tracked roles", () => {
  const trackedRoleIds = new Set(["a", "b"]);

  assert.equal(memberHasAnyTrackedRole(["c", "b"], trackedRoleIds), true);
  assert.equal(memberHasAnyTrackedRole(["c", "d"], trackedRoleIds), false);
});

test("collectDefensieLeaveLogRoleIds only includes the configured Defensie main role", () => {
  const previous = {
    DISCORD_DEFENSIE_ROLE_ID: process.env.DISCORD_DEFENSIE_ROLE_ID,
    DISCORD_KADER_ROLE_ID: process.env.DISCORD_KADER_ROLE_ID,
    DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID: process.env.DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID
  };
  process.env.DISCORD_DEFENSIE_ROLE_ID = "role-defensie";
  process.env.DISCORD_KADER_ROLE_ID = "role-kader";
  process.env.DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID = "role-rank";

  try {
    const roleIds = collectDefensieLeaveLogRoleIds(organizationConfigs.defensie);

    assert.deepEqual([...roleIds], ["role-defensie"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("collectDefensieLeaveLogRoleIds ignores non-defensie organizations", () => {
  const previous = process.env.DISCORD_POLITIE_ROLE_ID;
  process.env.DISCORD_POLITIE_ROLE_ID = "role-politie";

  try {
    const roleIds = collectDefensieLeaveLogRoleIds(organizationConfigs.politie);

    assert.equal(roleIds.size, 0);
  } finally {
    if (previous === undefined) delete process.env.DISCORD_POLITIE_ROLE_ID;
    else process.env.DISCORD_POLITIE_ROLE_ID = previous;
  }
});

test("buildDiscordLeaveLogPayload formats name and Discord tag", () => {
  const payload = buildDiscordLeaveLogPayload({
    nick: "Frank Bright",
    user: { username: "frank", discriminator: "0" }
  });

  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.content, "**Frank Bright**\n@frank\nIs de discord verlaten.");
});

test("discordUserTag keeps legacy discriminator tags", () => {
  assert.equal(discordUserTag({ username: "frank", discriminator: "1234" }), "frank#1234");
});

test("sendDiscordLeaveLog posts payload to webhook", async () => {
  let request;
  const result = await sendDiscordLeaveLog("https://discord.example/webhook", { content: "test" }, async (url, options) => {
    request = { url, options };
    return { ok: true, status: 204, text: async () => "" };
  });

  assert.equal(result.ok, true);
  assert.equal(request.url, "https://discord.example/webhook");
  assert.equal(request.options.method, "POST");
  assert.equal(JSON.parse(request.options.body).content, "test");
});
