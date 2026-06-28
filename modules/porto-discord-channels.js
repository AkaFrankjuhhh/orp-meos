const { currentOrganizationKey } = require("./organizations");

const defaultPortoDiscordChannels = [
  { key: "ops", label: "OPS", envKey: "DISCORD_PORTO_CHANNEL_OPS", legacyEnvKeys: ["DISCORD_VOICE_OPS_CHANNEL_ID"], organizations: ["defensie"] },
  { key: "inrap-01", label: "INRAP-01", envKey: "DISCORD_PORTO_CHANNEL_INRAP_01", legacyEnvKeys: ["DISCORD_VOICE_INRAP_1_CHANNEL_ID"], organizations: ["defensie"] },
  { key: "inrap-02", label: "INRAP-02", envKey: "DISCORD_PORTO_CHANNEL_INRAP_02", legacyEnvKeys: ["DISCORD_VOICE_INRAP_2_CHANNEL_ID"], organizations: ["defensie"] },
  { key: "inrap-03", label: "INRAP-03", envKey: "DISCORD_PORTO_CHANNEL_INRAP_03", legacyEnvKeys: ["DISCORD_VOICE_INRAP_3_CHANNEL_ID"], organizations: ["defensie"] },
  { key: "inrap-04", label: "INRAP-04", envKey: "DISCORD_PORTO_CHANNEL_INRAP_04", organizations: ["defensie"] },
  { key: "inrap-05", label: "INRAP-05", envKey: "DISCORD_PORTO_CHANNEL_INRAP_05", organizations: ["defensie"] },
  { key: "inrap-06", label: "INRAP-06", envKey: "DISCORD_PORTO_CHANNEL_INRAP_06", organizations: ["defensie"] },
  { key: "kustwacht", label: "Kustwacht", envKey: "DISCORD_PORTO_CHANNEL_KUSTWACHT", organizations: ["defensie"] },
  { key: "stilte-porto", label: "Stilte-Porto", envKey: "DISCORD_PORTO_CHANNEL_STILTE_PORTO", organizations: ["defensie"] },
  { key: "oc", label: "OC", envKey: "DISCORD_PORTO_CHANNEL_OC", defaultChannelId: "1515863022688796702", organizations: ["politie"] },
  { key: "ic-kp1", label: "IC-KP1", envKey: "DISCORD_PORTO_CHANNEL_IC_KP1", defaultChannelId: "1515863205757456624", organizations: ["defensie", "politie"] },
  { key: "ic-kp2", label: "IC-KP2", envKey: "DISCORD_PORTO_CHANNEL_IC_KP2", defaultChannelId: "1515863240364789831", organizations: ["defensie", "politie"] },
  { key: "ic-kp3", label: "IC-KP3", envKey: "DISCORD_PORTO_CHANNEL_IC_KP3", defaultChannelId: "1515863263252971540", organizations: ["defensie", "politie"] },
  { key: "ic-kp4", label: "IC-KP4", envKey: "DISCORD_PORTO_CHANNEL_IC_KP4", defaultChannelId: "1515863287315566672", organizations: ["defensie", "politie"] },
  { key: "ic-kp5", label: "IC-KP5", envKey: "DISCORD_PORTO_CHANNEL_IC_KP5", defaultChannelId: "1515863311458242650", organizations: ["defensie", "politie"] },
  { key: "ic-kp6", label: "IC-KP6", envKey: "DISCORD_PORTO_CHANNEL_IC_KP6", defaultChannelId: "1515863332479827988", organizations: ["defensie", "politie"] },
  { key: "ic-controle", label: "IC-CONTROLE", envKey: "DISCORD_PORTO_CHANNEL_IC_CONTROLE", defaultChannelId: "1515855500925865994", organizations: ["politie"] }
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
  return keys.map((key) => String(env[key] || "").trim()).find(Boolean) || String(channel.defaultChannelId || "").trim();
}

function configuredPortoDiscordChannels(env = process.env) {
  const organizationKey = currentOrganizationKey();
  return defaultPortoDiscordChannels.filter((channel) => {
    const organizations = Array.isArray(channel.organizations) ? channel.organizations : [];
    return !organizations.length || organizations.includes(organizationKey);
  }).map((channel) => {
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
