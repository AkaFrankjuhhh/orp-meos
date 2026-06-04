const defaultPortoDiscordChannels = [
  { key: "ops", label: "OPS", envKey: "DISCORD_PORTO_CHANNEL_OPS", legacyEnvKeys: ["DISCORD_VOICE_OPS_CHANNEL_ID"] },
  { key: "inrap-01", label: "INRAP-01", envKey: "DISCORD_PORTO_CHANNEL_INRAP_01", legacyEnvKeys: ["DISCORD_VOICE_INRAP_1_CHANNEL_ID"] },
  { key: "inrap-02", label: "INRAP-02", envKey: "DISCORD_PORTO_CHANNEL_INRAP_02", legacyEnvKeys: ["DISCORD_VOICE_INRAP_2_CHANNEL_ID"] },
  { key: "inrap-03", label: "INRAP-03", envKey: "DISCORD_PORTO_CHANNEL_INRAP_03", legacyEnvKeys: ["DISCORD_VOICE_INRAP_3_CHANNEL_ID"] },
  { key: "inrap-04", label: "INRAP-04", envKey: "DISCORD_PORTO_CHANNEL_INRAP_04" },
  { key: "inrap-05", label: "INRAP-05", envKey: "DISCORD_PORTO_CHANNEL_INRAP_05" },
  { key: "inrap-06", label: "INRAP-06", envKey: "DISCORD_PORTO_CHANNEL_INRAP_06" },
  { key: "kustwacht", label: "Kustwacht", envKey: "DISCORD_PORTO_CHANNEL_KUSTWACHT" },
  { key: "stilte-porto", label: "Stilte-Porto", envKey: "DISCORD_PORTO_CHANNEL_STILTE_PORTO" }
];

const nonRegularPortoDiscordChannel = {
  key: "niet-reguliere-porto",
  label: "Niet in reguliere porto",
  channelId: "",
  configured: false,
  readonly: true
};

function channelIdFor(channel, env = process.env) {
  const keys = [channel.envKey, ...(channel.legacyEnvKeys || [])];
  return keys.map((key) => String(env[key] || "").trim()).find(Boolean) || "";
}

function configuredPortoDiscordChannels(env = process.env) {
  return defaultPortoDiscordChannels.map((channel) => {
    const channelId = channelIdFor(channel, env);
    return {
      ...channel,
      channelId,
      configured: Boolean(channelId)
    };
  });
}

function configuredPortoDiscordChannelKeys(env = process.env) {
  return new Set(configuredPortoDiscordChannels(env).filter((channel) => channel.configured).map((channel) => channel.key));
}

function configuredPortoVoiceChannels(env = process.env) {
  return Object.fromEntries(
    configuredPortoDiscordChannels(env)
      .filter((channel) => channel.configured)
      .map((channel) => [channel.key, channel.channelId])
  );
}

function resolvePortoVoiceChannelId(channelKeyOrId, env = process.env) {
  const value = String(channelKeyOrId || "").trim();
  if (!value) return "";
  return configuredPortoVoiceChannels(env)[value.toLowerCase()] || value;
}

module.exports = {
  defaultPortoDiscordChannels,
  nonRegularPortoDiscordChannel,
  configuredPortoDiscordChannels,
  configuredPortoDiscordChannelKeys,
  configuredPortoVoiceChannels,
  resolvePortoVoiceChannelId
};
