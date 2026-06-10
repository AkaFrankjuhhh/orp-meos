const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_NICKNAME_LIMIT = 32;
const {
  configuredPortoVoiceChannels,
  resolvePortoVoiceChannelId
} = require("./porto-discord-channels");
const {
  currentOrganization,
  organizationMainRoleId,
  envOrDefault
} = require("./organizations");

const organization = currentOrganization();
const portalAuditLabel = organization.portalTitle || "Personeelsportaal";
const defaultDefensieRankNicknameSymbols = {
  "Marechaussee 4de Klasser": "\u276F",
  "Marechaussee 3de Klasser": "\u276F\u276F",
  "Marechaussee 2de Klasser": "\u276F\u276F\u276F",
  "Marechaussee 1ste Klasser": "\u276F\u276F\u276F\u276F",
  Wachtmeester: "\u2759\u276F",
  "Wachtmeester 1ste Klasser": "\u2759\u276F\u276F",
  Opperwachtmeester: "\u2759\u276F\u276F\u276F",
  Adjudant: "\u25CF",
  Kornet: "\u2759\u25CF",
  "Tweede-Luitenant": "\u2743",
  "Eerste-Luitenant": "\u2743\u2743",
  Kapitein: "\u2743\u2743\u2743",
  Majoor: "\u2759\u2743",
  "Luitenant-Kolonel": "\u2759\u2743\u2743",
  Kolonel: "\u2759\u2743\u2743\u2743",
  "Brigade-Generaal": "\u2759\u272F",
  Brigadegeneraal: "\u2759\u272F",
  "Generaal-Majoor": "\u2759\u272F\u272F",
  "Generaal-majoor": "\u2759\u272F\u272F",
  "Luitenant-Generaal": "\u2759\u272F\u272F\u272F",
  "Luitenant-generaal": "\u2759\u272F\u272F\u272F"
};


const defaultDefensieRankRoleEnvKeys = {
  "Luitenant-Generaal": "DISCORD_RANK_LUITENANT_GENERAAL_ROLE_ID",
  "Generaal-Majoor": "DISCORD_RANK_GENERAAL_MAJOOR_ROLE_ID",
  "Brigade-Generaal": "DISCORD_RANK_BRIGADE_GENERAAL_ROLE_ID",
  "Kolonel": "DISCORD_RANK_KOLONEL_ROLE_ID",
  "Luitenant-Kolonel": "DISCORD_RANK_LUITENANT_KOLONEL_ROLE_ID",
  "Majoor": "DISCORD_RANK_MAJOOR_ROLE_ID",
  "Kapitein": "DISCORD_RANK_KAPITEIN_ROLE_ID",
  "Eerste-Luitenant": "DISCORD_RANK_EERSTE_LUITENANT_ROLE_ID",
  "Tweede-Luitenant": "DISCORD_RANK_TWEEDE_LUITENANT_ROLE_ID",
  "Kornet": "DISCORD_RANK_KORNET_ROLE_ID",
  "Adjudant": "DISCORD_RANK_ADJUDANT_ROLE_ID",
  "Opperwachtmeester": "DISCORD_RANK_OPPERWACHTMEESTER_ROLE_ID",
  "Wachtmeester 1ste Klasser": "DISCORD_RANK_WACHTMEESTER_1STE_KLASSER_ROLE_ID",
  "Wachtmeester": "DISCORD_RANK_WACHTMEESTER_ROLE_ID",
  "Marechaussee 1ste Klasser": "DISCORD_RANK_MARECHAUSSEE_1STE_KLASSER_ROLE_ID",
  "Marechaussee 2de Klasser": "DISCORD_RANK_MARECHAUSSEE_2DE_KLASSER_ROLE_ID",
  "Marechaussee 3de Klasser": "DISCORD_RANK_MARECHAUSSEE_3DE_KLASSER_ROLE_ID",
  "Marechaussee 4de Klasser": "DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID"
};

const defaultDefensieQualificationRoleDefaults = {
  BKV: {
    envKey: "DISCORD_MEOS_ROLE_ID",
    roleId: "1425931664877551708",
    label: "MEOS"
  },
  OPS: {
    envKey: "DISCORD_OPS_ROLE_ID",
    roleId: "1423790817738227864",
    label: "OPS"
  },
  OPCO: {
    envKey: "DISCORD_OPCO_ROLE_ID",
    roleId: "1424523638526185513",
    label: "OPCO"
  }
};
const dutchSurnameParticles = new Set([
  "aan", "bij", "de", "del", "den", "der", "des", "du", "het", "in", "la", "op", "ten", "ter", "tot", "uit", "van", "vanden", "ver", "voor"
]);
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}
function splitEnvList(value) {
  return String(value || "")
    .split(/[;,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isDiscordSyncExcludedDiscordId(discordId) {
  const memberId = normalizeDiscordId(discordId);
  if (!memberId) return false;
  return new Set(splitEnvList(process.env.DISCORD_SYNC_EXCLUDED_DISCORD_IDS)).has(memberId);
}

function isDiscordSyncExcludedPerson(person) {
  const personIds = new Set(splitEnvList(process.env.DISCORD_SYNC_EXCLUDED_PERSON_IDS));
  return Boolean((person?.id && personIds.has(String(person.id))) || isDiscordSyncExcludedDiscordId(person?.discordId));
}

function discordSyncExcludedResult() {
  return { skipped: true, reason: "Discord sync staat uitgeschakeld voor dit profiel." };
}


function requiredDefensieRoleId() {
  return organizationMainRoleId(organization);
}

function memberHasRequiredDefensieRole(memberResult) {
  const roleId = requiredDefensieRoleId();
  if (!roleId) return true;
  return (memberResult?.data?.roles || []).map(String).includes(roleId);
}

function missingDefensieRoleResult() {
  return { skipped: true, reason: `${organization.requiredRoleLabel || organization.label} rol ontbreekt; Discord naam en rangrollen worden niet aangepast.` };
}

function compactRoleIds(roleIds) {
  return [...new Set((roleIds || []).map((roleId) => String(roleId || "").trim()).filter(Boolean))];
}

function truncateDiscordNickname(value) {
  const text = String(value || "").trim();
  if (text.length <= DISCORD_NICKNAME_LIMIT) return text;
  return text.slice(0, DISCORD_NICKNAME_LIMIT).trim();
}

function rankSymbolsFor(rank) {
  const symbols = organization.discord?.nicknameSymbols || defaultDefensieRankNicknameSymbols;
  return symbols[String(rank || "").trim()] || "";
}

function formatNameForDiscordNickname(name) {
  const parts = String(name || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const middleParts = parts.slice(1, -1);
  const hasSurnameParticle = middleParts.length > 0 && middleParts.every((part) => {
    const lower = part.toLowerCase();
    return dutchSurnameParticles.has(lower) || part === lower;
  });
  const surnameParticle = hasSurnameParticle ? `${middleParts.join(" ")} ` : "";
  return `${firstName} ${surnameParticle}${lastName.charAt(0).toUpperCase()}.`.trim();
}

function buildServiceNicknameDefault(person) {
  const serviceNumber = person?.serviceNumber || person?.previousServiceNumber || "-";
  const symbols = rankSymbolsFor(person?.rank);
  const name = formatNameForDiscordNickname(person?.name || person?.discordUsername || "");
  const prefix = symbols ? `[${serviceNumber} ${symbols}]` : `[${serviceNumber}]`;
  return truncateDiscordNickname(`${prefix} ${name}`.trim());
}

function buildPortoNicknameDefault(person, unit = {}) {
  const serviceNumber = unit?.vehicleNumber || person?.serviceNumber || person?.previousServiceNumber || "-";
  const symbols = rankSymbolsFor(person?.rank || unit?.rank);
  const name = formatNameForDiscordNickname(person?.name || unit?.name || person?.discordUsername || "");
  const prefix = symbols ? `[${serviceNumber} ${symbols}]` : `[${serviceNumber}]`;
  const body = `${prefix} ${name}`.trim();
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";
  const isOpsLead = unit?.vehicleNumber === operatorVehicleNumber && unit?.isPortoOpsLead === true;
  const operatorLabel = organization.porto?.operatorLabel || organization.discord?.portoOperatorLabel || "OPS";
  return truncateDiscordNickname(isOpsLead ? `${operatorLabel} ${body}` : body);
}

function nicknameTemplateHasPlaceholders(template) {
  return /\{(?:serviceNumber|name|formattedName|rank|symbols)\}/.test(String(template || ""));
}

function createDiscordBotServices(options = {}) {
  const tokenProvider = typeof options.tokenProvider === "function" ? options.tokenProvider : () => process.env.DISCORD_BOT_TOKEN || "";
  const guildProvider = typeof options.guildProvider === "function" ? options.guildProvider : () => process.env.DISCORD_GUILD_ID || "";

  function botToken() {
    return String(tokenProvider() || "").trim();
  }

  function guildId() {
    return String(guildProvider() || "").trim();
  }

  function isConfigured() {
    return Boolean(botToken() && guildId());
  }

  function configuredRoleMappings() {
    return [
      ...(organization.discord?.functionRoleMappings || []),
      ...(organization.discord?.taskRoleMappings || [])
    ]
      .map((mapping) => ({
        key: mapping.key,
        label: mapping.label,
        roleId: envOrDefault(mapping.envKey, mapping.defaultRoleId)
      }))
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function configuredRankRoleMappings() {
    const rankRoleEnvKeys = organization.discord?.rankRoleEnvKeys || defaultDefensieRankRoleEnvKeys;
    return Object.entries(rankRoleEnvKeys)
      .map(([rank, envKey]) => ({ rank, envKey, roleId: process.env[envKey] }))
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function configuredQualificationRoleMappings() {
    const qualificationRoleDefaults = organization.discord?.qualificationRoleMappings || defaultDefensieQualificationRoleDefaults;
    return Object.entries(qualificationRoleDefaults)
      .map(([qualification, config]) => ({
        qualification,
        label: config.label,
        envKey: config.envKey,
        roleId: envOrDefault(config.envKey, config.defaultRoleId || config.roleId)
      }))
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function rankRoleIdForPerson(person) {
    const rank = String(person?.rank || "").trim();
    const mapping = configuredRankRoleMappings().find((entry) => entry.rank === rank);
    return mapping?.roleId || "";
  }

  function completedQualificationSetForPerson(person) {
    return new Set([
      ...(Array.isArray(person?.completedTrainings) ? person.completedTrainings : []),
      ...(Array.isArray(person?.completedOperational) ? person.completedOperational : [])
    ].map((item) => String(item || "").trim()).filter(Boolean));
  }

  function configuredVoiceChannels() {
    return configuredPortoVoiceChannels();
  }

  function resolveVoiceChannelId(channelKeyOrId) {
    return resolvePortoVoiceChannelId(channelKeyOrId);
  }

  async function discordBotFetch(route, options = {}) {
    if (!isConfigured()) {
      return { skipped: true, reason: "Discord bot token of guild ID ontbreekt." };
    }

    const headers = {
      Authorization: `Bot ${botToken()}`,
      "Content-Type": "application/json"
    };
    if (options.auditReason) {
      headers["X-Audit-Log-Reason"] = encodeURIComponent(String(options.auditReason).slice(0, 512));
    }

    const maxAttempts = Number(options.maxAttempts || 4);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const response = await fetch(`${DISCORD_API_BASE}${route}`, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const text = await response.text();
      const data = text ? safeJson(text) : null;

      if (response.status === 429 && attempt < maxAttempts) {
        const retryAfterSeconds = Number(data?.retry_after || response.headers.get("retry-after") || 1);
        await sleep(Math.max(250, Math.ceil(retryAfterSeconds * 1000) + 150));
        continue;
      }

      if (!response.ok) {
        const detail = data?.message || text || `Discord API fout ${response.status}`;
        const error = new Error(detail);
        error.status = response.status;
        error.discord = data;
        throw error;
      }

      return { ok: true, status: response.status, data };
    }

    throw new Error("Discord API gaf te vaak rate limit terug.");
  }

  function safeJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  async function getGuildMember(discordId) {
    const memberId = normalizeDiscordId(discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}`);
  }

  async function addRole(discordId, roleId, auditReason = `${portalAuditLabel} rol toegevoegd`) {
    const memberId = normalizeDiscordId(discordId);
    const targetRole = String(roleId || "").trim();
    if (!memberId || !targetRole) return { skipped: true, reason: "Discord ID of role ID ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}/roles/${targetRole}`, {
      method: "PUT",
      auditReason
    });
  }

  async function removeRole(discordId, roleId, auditReason = `${portalAuditLabel} rol verwijderd`) {
    const memberId = normalizeDiscordId(discordId);
    const targetRole = String(roleId || "").trim();
    if (!memberId || !targetRole) return { skipped: true, reason: "Discord ID of role ID ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}/roles/${targetRole}`, {
      method: "DELETE",
      auditReason
    });
  }

  async function syncRoleSet(discordId, desiredRoleIds, managedRoleIds, auditReason = `${portalAuditLabel} rollen gesynchroniseerd`) {
    const memberId = normalizeDiscordId(discordId);
    const desired = compactRoleIds(desiredRoleIds);
    const managed = compactRoleIds(managedRoleIds);
    if (!memberId || !managed.length) return { skipped: true, reason: "Discord ID of beheerde rollen ontbreken." };

    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();

    const existingRoles = new Set(memberResult.data?.roles || []);
    const desiredSet = new Set(desired);
    const changes = [];

    // Alleen rollen binnen managedRoleIds worden gewijzigd; handmatige Discord rollen blijven met rust.
    for (const roleId of managed) {
      if (desiredSet.has(roleId) && !existingRoles.has(roleId)) {
        changes.push(await addRole(memberId, roleId, auditReason));
      }
      if (!desiredSet.has(roleId) && existingRoles.has(roleId)) {
        changes.push(await removeRole(memberId, roleId, auditReason));
      }
    }

    return { ok: true, changes };
  }

  async function syncRankRoleForPerson(person, auditReason = `${portalAuditLabel} rangrol gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const mappings = configuredRankRoleMappings();
    const managedRoleIds = mappings.map((mapping) => mapping.roleId);
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen Discord rangrollen ingesteld." };
    const desiredRoleId = rankRoleIdForPerson(person);
    if (!desiredRoleId) return { skipped: true, reason: `Geen Discord rangrol ingesteld voor ${person?.rank || "onbekende rang"}.` };
    return syncRoleSet(memberId, [desiredRoleId], managedRoleIds, auditReason);
  }

  async function syncRankRoleForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke rangrol controle`) {
    return syncRankRoleForPerson(person, auditReason);
  }

  async function syncQualificationRolesForPerson(person, auditReason = `${portalAuditLabel} kwalificatierollen gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const mappings = configuredQualificationRoleMappings();
    const managedRoleIds = mappings.map((mapping) => mapping.roleId);
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen Discord kwalificatierollen ingesteld." };
    const completed = completedQualificationSetForPerson(person);
    const desiredRoleIds = mappings
      .filter((mapping) => completed.has(mapping.qualification))
      .map((mapping) => mapping.roleId);
    return syncRoleSet(memberId, desiredRoleIds, managedRoleIds, auditReason);
  }

  async function syncQualificationRolesForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke kwalificatierol controle`) {
    return syncQualificationRolesForPerson(person, auditReason);
  }

  async function syncDiscordForPersonIfNeeded(person, auditReason = `${portalAuditLabel} Discord profiel gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const nickname = await syncNicknameForPersonIfNeeded(person, auditReason);
    const rankRole = await syncRankRoleForPersonIfNeeded(person, auditReason);
    const qualificationRoles = await syncQualificationRolesForPersonIfNeeded(person, auditReason);
    return { ok: true, nickname, rankRole, qualificationRoles };
  }

  function buildServiceNickname(person, template = process.env.DISCORD_NICKNAME_TEMPLATE || "personeelsportaal") {
    if (!template || template === "personeelsportaal" || !nicknameTemplateHasPlaceholders(template)) {
      return buildServiceNicknameDefault(person);
    }
    const serviceNumber = person?.serviceNumber || person?.previousServiceNumber || "";
    const name = person?.name || person?.discordUsername || "";
    const symbols = rankSymbolsFor(person?.rank);
    const nickname = template
      .replaceAll("{serviceNumber}", serviceNumber)
      .replaceAll("{name}", name)
      .replaceAll("{formattedName}", formatNameForDiscordNickname(name))
      .replaceAll("{rank}", person?.rank || "")
      .replaceAll("{symbols}", symbols)
      .replace(/\s+/g, " ")
      .trim();
    return truncateDiscordNickname(nickname || buildServiceNicknameDefault(person));
  }

  async function setNickname(discordId, nickname, auditReason = `${portalAuditLabel} nickname aangepast`) {
    const memberId = normalizeDiscordId(discordId);
    const nick = truncateDiscordNickname(nickname);
    if (!memberId || !nick) return { skipped: true, reason: "Discord ID of nickname ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}`, {
      method: "PATCH",
      body: { nick },
      auditReason
    });
  }

  async function syncNicknameForPerson(person, auditReason = `${portalAuditLabel} dienstnummer nickname gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();
    return setNickname(memberId, buildServiceNickname(person), auditReason);
  }

  async function syncNicknameForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke nickname controle`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const desiredNickname = buildServiceNickname(person);
    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();
    const currentNickname = memberResult.data?.nick || "";
    if (currentNickname === desiredNickname) return { ok: true, unchanged: true, nickname: desiredNickname };
    return setNickname(memberId, desiredNickname, auditReason);
  }

  async function syncPortoNicknameForPersonIfNeeded(person, unit, auditReason = "Porto roepnummer nickname gesynchroniseerd") {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId || unit?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const desiredNickname = buildPortoNicknameDefault(person, unit);
    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();
    const currentNickname = memberResult.data?.nick || "";
    if (currentNickname === desiredNickname) return { ok: true, unchanged: true, nickname: desiredNickname };
    return setNickname(memberId, desiredNickname, auditReason);
  }

  async function moveMemberToVoice(discordId, channelKeyOrId, auditReason = "Porto voicekanaal aangepast") {
    const memberId = normalizeDiscordId(discordId);
    const channelId = resolveVoiceChannelId(channelKeyOrId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    if (!channelId) return { skipped: true, reason: "Discord voicekanaal ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}`, {
      method: "PATCH",
      body: { channel_id: channelId },
      auditReason
    });
  }

  async function moveMembersToVoice(discordIds, channelKeyOrId, auditReason = "Porto eenheid verplaatst") {
    const uniqueDiscordIds = [...new Set((discordIds || []).map(normalizeDiscordId).filter(Boolean))];
    if (!uniqueDiscordIds.length) return { skipped: true, reason: "Geen Discord ID's om te verplaatsen." };
    const moved = [];
    const failed = [];
    for (const discordId of uniqueDiscordIds) {
      try {
        const result = await moveMemberToVoice(discordId, channelKeyOrId, auditReason);
        if (result?.skipped) failed.push({ discordId, reason: result.reason || "overgeslagen" });
        else moved.push(discordId);
      } catch (error) {
        failed.push({ discordId, reason: error.message || "Discord move mislukt" });
      }
      await sleep(250);
    }
    return { ok: failed.length === 0, moved, failed, total: uniqueDiscordIds.length };
  }

  async function getVoiceChannel(channelKeyOrId) {
    const channelId = resolveVoiceChannelId(channelKeyOrId);
    if (!channelId) return { skipped: true, reason: "Discord voicekanaal ontbreekt." };
    return discordBotFetch(`/channels/${channelId}`);
  }

  async function setVoiceChannelStatus(channelKeyOrId, status, auditReason = "Porto kanaalstatus aangepast") {
    const channelId = resolveVoiceChannelId(channelKeyOrId);
    if (!channelId) return { skipped: true, reason: "Discord voicekanaal ontbreekt." };
    try {
      return await discordBotFetch(`/channels/${channelId}/voice-status`, {
        method: "PUT",
        body: { status: String(status || "").trim() || null },
        auditReason
      });
    } catch (error) {
      if (error.status === 403) {
        error.message = `${error.message} Controleer of de bot SET_VOICE_CHANNEL_STATUS heeft, of MANAGE_CHANNELS als de bot niet in dit voicekanaal zit.`;
      }
      throw error;
    }
  }

  return {
    isConfigured,
    configuredRoleMappings,
    configuredRankRoleMappings,
    configuredQualificationRoleMappings,
    configuredVoiceChannels,
    resolveVoiceChannelId,
    getGuildMember,
    addRole,
    removeRole,
    syncRoleSet,
    isDiscordSyncExcludedPerson,
    isDiscordSyncExcludedDiscordId,
    rankRoleEnvKeys: organization.discord?.rankRoleEnvKeys || defaultDefensieRankRoleEnvKeys,
    rankRoleIdForPerson,
    syncRankRoleForPerson,
    syncRankRoleForPersonIfNeeded,
    syncQualificationRolesForPerson,
    syncQualificationRolesForPersonIfNeeded,
    syncDiscordForPersonIfNeeded,
    rankSymbolsFor,
    formatNameForDiscordNickname,
    buildServiceNicknameDefault,
    buildPortoNicknameDefault,
    buildServiceNickname,
    setNickname,
    syncNicknameForPerson,
    syncNicknameForPersonIfNeeded,
    syncPortoNicknameForPersonIfNeeded,
    moveMemberToVoice,
    moveMembersToVoice,
    getVoiceChannel,
    setVoiceChannelStatus
  };
}

module.exports = { createDiscordBotServices };
