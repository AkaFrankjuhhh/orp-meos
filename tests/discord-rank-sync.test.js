const assert = require("node:assert/strict");
const test = require("node:test");

const { createDiscordBotServices } = require("../modules/discord-bot");

function discordResponse(status, data = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (data == null ? "" : JSON.stringify(data))
  };
}

async function withDiscordEnv(fn) {
  const keys = [
    "ORP_ORGANIZATION",
    "DISCORD_BOT_TOKEN",
    "DISCORD_GUILD_ID",
    "DISCORD_DEFENSIE_ROLE_ID",
    "DISCORD_RANK_MARECHAUSSEE_1STE_KLASSER_ROLE_ID",
    "DISCORD_RANK_MARECHAUSSEE_2DE_KLASSER_ROLE_ID"
  ];
  const previousEnv = new Map(keys.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  process.env.ORP_ORGANIZATION = "defensie";
  process.env.DISCORD_BOT_TOKEN = "token";
  process.env.DISCORD_GUILD_ID = "guild-1";
  process.env.DISCORD_DEFENSIE_ROLE_ID = "main-role";
  process.env.DISCORD_RANK_MARECHAUSSEE_1STE_KLASSER_ROLE_ID = "rank-1";
  process.env.DISCORD_RANK_MARECHAUSSEE_2DE_KLASSER_ROLE_ID = "rank-2";
  try {
    await fn();
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = previousFetch;
  }
}

test("Discord rank sync clears managed rank roles for dismissed profiles", async () => {
  await withDiscordEnv(async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url).endsWith("/guilds/guild-1/members/user-1")) {
        return discordResponse(200, { roles: ["rank-1"] });
      }
      if ((options.method || "GET") === "DELETE" && String(url).endsWith("/roles/rank-1")) {
        return discordResponse(204);
      }
      throw new Error(`Unexpected Discord request: ${options.method || "GET"} ${url}`);
    };

    const bot = createDiscordBotServices();
    const result = await bot.syncRankRoleForPerson({
      discordId: "user-1",
      rank: "Marechaussee 1ste Klasser",
      serviceNumber: "",
      status: "Ontslagen"
    });

    assert.equal(result.ok, true);
    assert.equal(calls.some((call) => call.method === "PUT"), false);
    assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
    assert.match(calls.find((call) => call.method === "DELETE").url, /\/roles\/rank-1$/);
  });
});

test("Discord rank sync replaces an old rank role with the restored current rank", async () => {
  await withDiscordEnv(async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url).endsWith("/guilds/guild-1/members/user-1")) {
        return discordResponse(200, { roles: ["main-role", "rank-1"] });
      }
      if ((options.method || "GET") === "DELETE" && String(url).endsWith("/roles/rank-1")) {
        return discordResponse(204);
      }
      if ((options.method || "GET") === "PUT" && String(url).endsWith("/roles/rank-2")) {
        return discordResponse(204);
      }
      throw new Error(`Unexpected Discord request: ${options.method || "GET"} ${url}`);
    };

    const bot = createDiscordBotServices();
    const result = await bot.syncRankRoleForPerson({
      discordId: "user-1",
      rank: "Marechaussee 2de Klasser",
      serviceNumber: "74-24",
      status: "Actief"
    });

    assert.equal(result.ok, true);
    assert.equal(calls.filter((call) => call.method === "DELETE" && call.url.endsWith("/roles/rank-1")).length, 1);
    assert.equal(calls.filter((call) => call.method === "PUT" && call.url.endsWith("/roles/rank-2")).length, 1);
  });
});

test("Discord rank sync removes stale ranks when the desired rank role is not configured", async () => {
  await withDiscordEnv(async () => {
    delete process.env.DISCORD_RANK_MARECHAUSSEE_2DE_KLASSER_ROLE_ID;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET" });
      if (String(url).endsWith("/guilds/guild-1/members/user-1")) {
        return discordResponse(200, { roles: ["rank-1"] });
      }
      if ((options.method || "GET") === "DELETE" && String(url).endsWith("/roles/rank-1")) {
        return discordResponse(204);
      }
      throw new Error(`Unexpected Discord request: ${options.method || "GET"} ${url}`);
    };

    const bot = createDiscordBotServices();
    const result = await bot.syncRankRoleForPerson({
      discordId: "user-1",
      rank: "Marechaussee 2de Klasser",
      serviceNumber: "74-24",
      status: "Actief"
    });

    assert.equal(result.ok, true);
    assert.equal(result.missingDesiredRankRole, true);
    assert.equal(calls.some((call) => call.method === "PUT"), false);
    assert.equal(calls.filter((call) => call.method === "DELETE" && call.url.endsWith("/roles/rank-1")).length, 1);
  });
});
