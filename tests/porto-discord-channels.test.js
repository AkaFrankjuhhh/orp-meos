const assert = require("node:assert/strict");
const test = require("node:test");
const {
  configuredPortoDiscordChannels,
  resolvePortoVoiceChannelId
} = require("../modules/porto-discord-channels");

function withOrganization(key, fn) {
  const previous = process.env.ORP_ORGANIZATION;
  process.env.ORP_ORGANIZATION = key;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ORP_ORGANIZATION;
    else process.env.ORP_ORGANIZATION = previous;
  }
}

test("defensie keeps its own channels and can use shared IC-KP channels", () => {
  withOrganization("defensie", () => {
    const keys = configuredPortoDiscordChannels({ DISCORD_PORTO_CHANNEL_OPS: "ops-channel" }).map((channel) => channel.key);

    assert.ok(keys.includes("ops"));
    assert.ok(keys.includes("inrap-01"));
    assert.ok(keys.includes("inrap-06"));
    assert.ok(keys.includes("kustwacht"));
    assert.ok(keys.includes("stilte-porto"));
    assert.ok(keys.includes("ic-kp1"));
    assert.ok(keys.includes("ic-kp6"));
    assert.ok(!keys.includes("oc"));
    assert.ok(!keys.includes("ic-controle"));
  });
});

test("politie can use OC, shared IC-KP channels and Controle", () => {
  withOrganization("politie", () => {
    const keys = configuredPortoDiscordChannels({}).map((channel) => channel.key);

    assert.ok(keys.includes("oc"));
    assert.ok(keys.includes("ic-kp1"));
    assert.ok(keys.includes("ic-kp6"));
    assert.ok(keys.includes("ic-controle"));
    assert.ok(!keys.includes("ops"));
    assert.ok(!keys.includes("inrap-01"));
    assert.ok(!keys.includes("kustwacht"));
    assert.equal(resolvePortoVoiceChannelId("oc", {}), "1515863022688796702");
    assert.equal(resolvePortoVoiceChannelId("ic-kp3", {}), "1515863263252971540");
  });
});
