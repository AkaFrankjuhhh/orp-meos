const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_NICKNAME_LIMIT = 32;

const rankNicknameSymbols = {
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

const dutchSurnameParticles = new Set([
  "aan", "bij", "de", "del", "den", "der", "des", "du", "het", "in", "la", "op", "ten", "ter", "tot", "uit", "van", "vanden", "ver", "voor"
]);
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
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
  return rankNicknameSymbols[String(rank || "").trim()] || "";
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
      { key: "kader", label: "Kader", roleId: process.env.DISCORD_KADER_ROLE_ID },
      { key: "hoofdofficier", label: "Hoofdofficier", roleId: process.env.DISCORD_HOOFDOFFICIER_ROLE_ID },
      { key: "officiersraad", label: "Officiersraad", roleId: process.env.DISCORD_OFFICIERSRAAD_ROLE_ID },
      { key: "interne-zaken", label: "Interne-Zaken", roleId: process.env.DISCORD_INTERNE_ZAKEN_ROLE_ID },
      { key: "ovj", label: "OvJ", roleId: process.env.DISCORD_OVJ_ROLE_ID },
      { key: "hovj", label: "hOvJ", roleId: process.env.DISCORD_HOVJ_ROLE_ID },
      { key: "trainer", label: "Trainer", roleId: process.env.DISCORD_TRAINER_ROLE_ID },
      { key: "mentor", label: "Mentor", roleId: process.env.DISCORD_MENTOR_ROLE_ID },
      { key: "w-s", label: "W&S", roleId: process.env.DISCORD_WS_ROLE_ID }
    ].filter((mapping) => String(mapping.roleId || "").trim());
  }

  function configuredVoiceChannels() {
    return {
      ops: process.env.DISCORD_VOICE_OPS_CHANNEL_ID || "",
      "inrap-1": process.env.DISCORD_VOICE_INRAP_1_CHANNEL_ID || "",
      "inrap-2": process.env.DISCORD_VOICE_INRAP_2_CHANNEL_ID || "",
      "inrap-3": process.env.DISCORD_VOICE_INRAP_3_CHANNEL_ID || "",
      "koppel-prio-1": process.env.DISCORD_VOICE_KOPPEL_PRIO_1_CHANNEL_ID || "",
      "koppel-prio-2": process.env.DISCORD_VOICE_KOPPEL_PRIO_2_CHANNEL_ID || "",
      "koppel-prio-3": process.env.DISCORD_VOICE_KOPPEL_PRIO_3_CHANNEL_ID || "",
      "koppel-prio-4": process.env.DISCORD_VOICE_KOPPEL_PRIO_4_CHANNEL_ID || "",
      "koppel-prio-5": process.env.DISCORD_VOICE_KOPPEL_PRIO_5_CHANNEL_ID || ""
    };
  }

  function resolveVoiceChannelId(channelKeyOrId) {
    const value = String(channelKeyOrId || "").trim();
    if (!value) return "";
    return configuredVoiceChannels()[value.toLowerCase()] || value;
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

  async function addRole(discordId, roleId, auditReason = "Defensie Personeelsportaal rol toegevoegd") {
    const memberId = normalizeDiscordId(discordId);
    const targetRole = String(roleId || "").trim();
    if (!memberId || !targetRole) return { skipped: true, reason: "Discord ID of role ID ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}/roles/${targetRole}`, {
      method: "PUT",
      auditReason
    });
  }

  async function removeRole(discordId, roleId, auditReason = "Defensie Personeelsportaal rol verwijderd") {
    const memberId = normalizeDiscordId(discordId);
    const targetRole = String(roleId || "").trim();
    if (!memberId || !targetRole) return { skipped: true, reason: "Discord ID of role ID ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}/roles/${targetRole}`, {
      method: "DELETE",
      auditReason
    });
  }

  async function syncRoleSet(discordId, desiredRoleIds, managedRoleIds, auditReason = "Defensie Personeelsportaal rollen gesynchroniseerd") {
    const memberId = normalizeDiscordId(discordId);
    const desired = compactRoleIds(desiredRoleIds);
    const managed = compactRoleIds(managedRoleIds);
    if (!memberId || !managed.length) return { skipped: true, reason: "Discord ID of beheerde rollen ontbreken." };

    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;

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

  async function setNickname(discordId, nickname, auditReason = "Defensie Personeelsportaal nickname aangepast") {
    const memberId = normalizeDiscordId(discordId);
    const nick = truncateDiscordNickname(nickname);
    if (!memberId || !nick) return { skipped: true, reason: "Discord ID of nickname ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}`, {
      method: "PATCH",
      body: { nick },
      auditReason
    });
  }

  async function syncNicknameForPerson(person, auditReason = "Defensie Personeelsportaal dienstnummer nickname gesynchroniseerd") {
    return setNickname(person?.discordId, buildServiceNickname(person), auditReason);
  }

  async function moveMemberToVoice(discordId, channelKeyOrId, auditReason = "Porto voicekanaal aangepast") {
    const memberId = normalizeDiscordId(discordId);
    const channelId = resolveVoiceChannelId(channelKeyOrId);
    if (!memberId || !channelId) return { skipped: true, reason: "Discord ID of voicekanaal ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}`, {
      method: "PATCH",
      body: { channel_id: channelId },
      auditReason
    });
  }

  async function moveMembersToVoice(discordIds, channelKeyOrId, auditReason = "Porto eenheid verplaatst") {
    const results = [];
    // Sequentieel uitvoeren houdt Discord rate limits rustiger bij gekoppelde eenheden.
    for (const discordId of discordIds || []) {
      results.push(await moveMemberToVoice(discordId, channelKeyOrId, auditReason));
    }
    return { ok: results.every((result) => result.ok || result.skipped), results };
  }

  return {
    isConfigured,
    configuredRoleMappings,
    configuredVoiceChannels,
    resolveVoiceChannelId,
    getGuildMember,
    addRole,
    removeRole,
    syncRoleSet,
    rankSymbolsFor,
    formatNameForDiscordNickname,
    buildServiceNicknameDefault,
    buildServiceNickname,
    setNickname,
    syncNicknameForPerson,
    moveMemberToVoice,
    moveMembersToVoice
  };
}

module.exports = { createDiscordBotServices };