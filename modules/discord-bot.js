const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_NICKNAME_LIMIT = 32;
const {
  configuredPortoVoiceChannels,
  resolvePortoVoiceChannelId
} = require("./porto-discord-channels");
const {
  organizationConfigs,
  currentOrganization,
  organizationMainRoleId,
  envOrDefault
} = require("./organizations");
const { createSideTasksStore } = require("./side-tasks-store");
const { isCurrentPerson } = require("./person-status");

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
  },
  OVD: {
    envKey: "DISCORD_OVD_ROLE_ID",
    roleId: "",
    label: "OVD"
  }
};
const DEFAULT_ORGANIZATION_ROLE_PRIORITY = ["defensie", "politie"];
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

function enabledFromEnv(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  return !["0", "false", "nee", "no", "off", "uit", "disabled"].includes(String(value).trim().toLowerCase());
}

function organizationPriorityKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (["politie", "police"].includes(key)) return "politie";
  if (["defensie", "defense"].includes(key)) return "defensie";
  return "";
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

function activeOrganization() {
  return currentOrganization();
}

function requiredDefensieRoleId() {
  return organizationMainRoleId(activeOrganization());
}

function memberHasRequiredDefensieRole(memberResult) {
  const roleId = requiredDefensieRoleId();
  if (!roleId) return true;
  return (memberResult?.data?.roles || []).map(String).includes(roleId);
}

function missingDefensieRoleResult() {
  const organization = activeOrganization();
  return {
    skipped: true,
    retryable: true,
    reason: `${organization.requiredRoleLabel || organization.label} rol ontbreekt; Discord naam en rangrollen worden nog niet aangepast.`
  };
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
  const organization = activeOrganization();
  const symbols = organization.discord?.nicknameSymbols || defaultDefensieRankNicknameSymbols;
  return symbols[String(rank || "").trim()] || "";
}

function rankSymbolSeparator() {
  const organization = activeOrganization();
  const separator = organization.discord?.nicknameSymbolSeparator;
  return typeof separator === "string" ? separator : " ";
}

function buildNicknamePrefix(serviceNumber, symbols) {
  const number = String(serviceNumber || "-").trim() || "-";
  const rankSymbols = String(symbols || "").trim();
  if (!rankSymbols) return `[${number}]`;
  return `[${number}${rankSymbolSeparator()}${rankSymbols}]`;
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
  const prefix = buildNicknamePrefix(serviceNumber, symbols);
  return truncateDiscordNickname(`${prefix} ${name}`.trim());
}

function buildPortoNicknameDefault(person, unit = {}) {
  const organization = activeOrganization();
  const serviceNumber = unit?.vehicleNumber || person?.serviceNumber || person?.previousServiceNumber || "-";
  const symbols = rankSymbolsFor(person?.rank || unit?.rank);
  const dutyRole = String(unit?.dutyRole || "").trim().toUpperCase();
  const k9Name = String(person?.k9Name || "").trim();
  const name = formatNameForDiscordNickname(dutyRole === "K9" && k9Name ? k9Name : person?.name || unit?.name || person?.discordUsername || "");
  const prefix = buildNicknamePrefix(serviceNumber, symbols);
  const body = `${prefix} ${name}`.trim();
  const operatorVehicleNumber = organization.porto?.operatorVehicleNumber || "30-00";
  const isOpsLead = unit?.vehicleNumber === operatorVehicleNumber && unit?.isPortoOpsLead === true;
  const operatorLabel = organization.porto?.operatorLabel || organization.discord?.portoOperatorLabel || "OPS";
  const dutySuffix = organization.key === "politie" ? "P" : "K";
  const dutyPrefixByRole = {
    OVD: `OVD-${dutySuffix}`,
    OPCO: `OPCO-${dutySuffix}`,
    K9: `K9-${dutySuffix}`,
    K9_BEGELEIDER: `K9B-${dutySuffix}`
  };
  const dutyPrefix = dutyPrefixByRole[dutyRole] || "";
  const leadPrefix = isOpsLead ? operatorLabel : "";
  return truncateDiscordNickname(`${dutyPrefix || leadPrefix} ${body}`.trim());
}

function nicknameHasPortoDutyPrefix(nickname) {
  return /^(?:OVD|OPCO|K9|K9B)-[KP]\s+/i.test(String(nickname || "").trim());
}

function auditReasonAllowsNormalNicknameOverDuty(auditReason) {
  return /porto dienst (?:beeindigd|be[eë]indigd)|uit dienst|status 8/i.test(String(auditReason || ""));
}

function nicknameTemplateHasPlaceholders(template) {
  return /\{(?:serviceNumber|name|formattedName|rank|symbols|symbolSeparator)\}/.test(String(template || ""));
}

function normalizeNicknameTemplateForOrganization(template) {
  const text = String(template || "");
  if (rankSymbolSeparator() === " " || text.includes("{symbolSeparator}")) return text;
  return text.replaceAll("{serviceNumber} {symbols}", "{serviceNumber}{symbolSeparator}{symbols}");
}

function normalizeRequirementName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function createDiscordBotServices(options = {}) {
  const sideTasksStore = createSideTasksStore();
  let dsiNicknameGuardWarningShown = false;
  const organization = currentOrganization();
  const portalAuditLabel = organization.portalTitle || "Personeelsportaal";
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

  function organizationRolePriority() {
    const configured = splitEnvList(process.env.DISCORD_ORGANIZATION_ROLE_PRIORITY)
      .map(organizationPriorityKey)
      .filter(Boolean);
    const ordered = configured.length ? configured : DEFAULT_ORGANIZATION_ROLE_PRIORITY;
    const unique = [];
    for (const key of ordered) {
      if (organizationConfigs[key] && !unique.includes(key)) unique.push(key);
    }
    return unique;
  }

  function organizationRolePriorityEnabled() {
    return enabledFromEnv(process.env.DISCORD_ORGANIZATION_ROLE_PRIORITY_ENABLED, true);
  }

  function organizationRoleIdForKey(key) {
    const config = organizationConfigs[key];
    return config ? organizationMainRoleId(config) : "";
  }

  function organizationRoleConflictForMember(memberResult) {
    if (!organizationRolePriorityEnabled()) return null;
    const currentKey = organization.key;
    const priority = organizationRolePriority();
    const currentIndex = priority.indexOf(currentKey);
    if (currentIndex < 1) return null;

    const memberRoles = new Set((memberResult?.data?.roles || []).map(String));
    for (const preferredKey of priority.slice(0, currentIndex)) {
      const preferredRoleId = organizationRoleIdForKey(preferredKey);
      if (!preferredRoleId || !memberRoles.has(preferredRoleId)) continue;
      const preferredOrganization = organizationConfigs[preferredKey];
      return {
        currentOrganizationKey: currentKey,
        currentOrganizationLabel: organization.requiredRoleLabel || organization.label || currentKey,
        currentRoleId: requiredDefensieRoleId(),
        preferredOrganizationKey: preferredKey,
        preferredOrganizationLabel: preferredOrganization?.requiredRoleLabel || preferredOrganization?.label || preferredKey,
        preferredRoleId
      };
    }
    return null;
  }

  function organizationRoleConflictResult(conflict, cleanup = null) {
    const currentLabel = conflict?.currentOrganizationLabel || organization.requiredRoleLabel || organization.label || "deze organisatie";
    const preferredLabel = conflict?.preferredOrganizationLabel || "een hogere organisatie";
    return {
      skipped: true,
      reason: `Discord profiel heeft al de ${preferredLabel} rol; ${currentLabel} sync overgeslagen.`,
      organizationRoleConflict: true,
      retryable: false,
      cleanup
    };
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

  function normalizeRankRoleMapping(rank, config) {
    if (typeof config === "string") {
      return { rank, envKey: config, roleId: process.env[config] || "" };
    }
    const envKey = config?.envKey || "";
    return {
      rank,
      envKey,
      roleId: envOrDefault(envKey, config?.defaultRoleId || config?.roleId || "")
    };
  }

  function allRankRoleMappings() {
    const rankRoleEnvKeys = organization.discord?.rankRoleEnvKeys || defaultDefensieRankRoleEnvKeys;
    return Object.entries(rankRoleEnvKeys)
      .map(([rank, config]) => normalizeRankRoleMapping(rank, config));
  }

  function configuredRankRoleMappings() {
    return allRankRoleMappings()
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function missingRankRoleMappings() {
    return allRankRoleMappings()
      .filter((mapping) => !String(mapping.roleId || "").trim());
  }

  function allQualificationRoleMappings() {
    const qualificationRoleDefaults = organization.discord?.qualificationRoleMappings || defaultDefensieQualificationRoleDefaults;
    return Object.entries(qualificationRoleDefaults)
      .map(([qualification, config]) => ({
        qualification,
        label: config.label,
        envKey: config.envKey,
        roleId: envOrDefault(config.envKey, config.defaultRoleId || config.roleId)
      }));
  }

  function configuredQualificationRoleMappings() {
    return allQualificationRoleMappings()
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function missingQualificationRoleMappings() {
    return allQualificationRoleMappings()
      .filter((mapping) => !String(mapping.roleId || "").trim());
  }

  function allTrainingRequirementRoleMappings() {
    return Object.entries(organization.discord?.trainingRequirementRoleMappings || {})
      .map(([requirement, config]) => ({
        requirement,
        label: config.label || requirement,
        envKey: config.envKey,
        roleId: envOrDefault(config.envKey, config.defaultRoleId || config.roleId)
      }));
  }

  function configuredTrainingRequirementRoleMappings() {
    return allTrainingRequirementRoleMappings()
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function missingTrainingRequirementRoleMappings() {
    return allTrainingRequirementRoleMappings()
      .filter((mapping) => !String(mapping.roleId || "").trim());
  }

  function normalizeBadgeRoleMapping(mapping, type) {
    const envKeys = [mapping?.envKey || "", ...(mapping?.envFallbackKeys || [])];
    return {
      type,
      key: mapping?.key || "",
      label: mapping?.label || mapping?.key || "",
      envKey: mapping?.envKey || "",
      roleId: envOrDefault(envKeys, mapping?.defaultRoleId || mapping?.roleId || "")
    };
  }

  function allBadgeRoleMappings() {
    return [
      ...(organization.discord?.functionRoleMappings || []).map((mapping) => normalizeBadgeRoleMapping(mapping, "function")),
      ...(organization.discord?.taskRoleMappings || []).map((mapping) => normalizeBadgeRoleMapping(mapping, "task"))
    ];
  }

  function configuredBadgeRoleMappings() {
    return allBadgeRoleMappings()
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function missingBadgeRoleMappings() {
    return allBadgeRoleMappings()
      .filter((mapping) => !String(mapping.roleId || "").trim());
  }

  function normalizeSeparatorRoleMapping(mapping) {
    const envKeys = [mapping?.envKey || "", ...(mapping?.envFallbackKeys || [])];
    return {
      key: mapping?.key || "",
      label: mapping?.label || mapping?.key || "",
      envKey: mapping?.envKey || "",
      roleId: envOrDefault(envKeys, mapping?.defaultRoleId || mapping?.roleId || ""),
      always: Boolean(mapping?.always),
      badges: Array.isArray(mapping?.badges) ? mapping.badges.map((badge) => String(badge || "").trim()).filter(Boolean) : []
    };
  }

  function allSeparatorRoleMappings() {
    return (organization.discord?.separatorRoleMappings || [])
      .map(normalizeSeparatorRoleMapping);
  }

  function configuredSeparatorRoleMappings() {
    return allSeparatorRoleMappings()
      .filter((mapping) => String(mapping.roleId || "").trim());
  }

  function missingSeparatorRoleMappings() {
    return allSeparatorRoleMappings()
      .filter((mapping) => !String(mapping.roleId || "").trim());
  }

  function currentOrganizationManagedRoleIds() {
    return compactRoleIds([
      requiredDefensieRoleId(),
      ...configuredRankRoleMappings().map((mapping) => mapping.roleId),
      ...configuredQualificationRoleMappings().map((mapping) => mapping.roleId),
      ...configuredTrainingRequirementRoleMappings().map((mapping) => mapping.roleId),
      ...configuredBadgeRoleMappings().map((mapping) => mapping.roleId),
      ...configuredSeparatorRoleMappings().map((mapping) => mapping.roleId)
    ]);
  }

  function separatorRoleMatchesPerson(mapping, person) {
    if (!mapping || !isCurrentPerson(person)) return false;
    if (mapping.always) return true;
    const assignedBadges = assignedBadgeSetForPerson(person);
    return (mapping.badges || []).some((badge) => assignedBadges.has(badge));
  }

  function desiredSeparatorRoleMappingsForPerson(person) {
    return configuredSeparatorRoleMappings()
      .filter((mapping) => separatorRoleMatchesPerson(mapping, person));
  }

  function rankRoleIdForPerson(person) {
    const rank = String(person?.rank || "").trim();
    const mapping = configuredRankRoleMappings().find((entry) => entry.rank === rank);
    return mapping?.roleId || "";
  }

  function desiredRankRoleIdForPerson(person) {
    if (!isCurrentPerson(person)) return "";
    if (!String(person?.serviceNumber || "").trim()) return "";
    return rankRoleIdForPerson(person);
  }

  function completedQualificationSetForPerson(person) {
    return new Set([
      ...(Array.isArray(person?.completedTrainings) ? person.completedTrainings : []),
      ...(Array.isArray(person?.completedOperational) ? person.completedOperational : [])
    ].map((item) => String(item || "").trim()).filter(Boolean));
  }

  function missingTrainingRequirementsForPerson(person) {
    if (organization.key !== "defensie") return [];
    if (!isCurrentPerson(person)) return [];
    const requirements = organization.rankTrainingRequirements?.[person?.rank || ""] || [];
    if (!Array.isArray(requirements) || !requirements.length) return [];
    const completed = new Set([...completedQualificationSetForPerson(person)].map(normalizeRequirementName));
    return requirements.filter((requirement) => !completed.has(normalizeRequirementName(requirement)));
  }

  function assignedBadgeSetForPerson(person) {
    const assigned = [
      person?.permRole,
      ...(Array.isArray(person?.extraFunctions) ? person.extraFunctions : []),
      ...(Array.isArray(person?.badges) ? person.badges : [])
    ];
    for (const mapping of organization.autoFunctionByRanks || []) {
      if ((mapping.ranks || []).includes(person?.rank || "")) assigned.push(mapping.label);
    }
    return new Set(assigned.map((item) => String(item || "").trim()).filter(Boolean));
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

  function truncateDiscordMessage(value) {
    const text = String(value || "").trim();
    if (text.length <= 2000) return text;
    return `${text.slice(0, 1990).trim()}\n...`;
  }

  function truncateDiscordEmbedText(value, maxLength) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }

  function normalizeDiscordEmbeds(embeds = []) {
    return (Array.isArray(embeds) ? embeds : [])
      .filter((embed) => embed && typeof embed === "object")
      .slice(0, 10)
      .map((embed) => ({
        ...embed,
        title: embed.title ? truncateDiscordEmbedText(embed.title, 256) : undefined,
        description: embed.description ? truncateDiscordEmbedText(embed.description, 4096) : undefined,
        fields: Array.isArray(embed.fields)
          ? embed.fields.slice(0, 25).map((field) => ({
              name: truncateDiscordEmbedText(field.name || "-", 256) || "-",
              value: truncateDiscordEmbedText(field.value || "-", 1024) || "-",
              inline: Boolean(field.inline)
            }))
          : undefined
      }));
  }

  async function getGuildMember(discordId) {
    const memberId = normalizeDiscordId(discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    return discordBotFetch(`/guilds/${guildId()}/members/${memberId}`);
  }

  async function searchGuildMembers(searchText, limit = 10) {
    const queryText = String(searchText || "").trim();
    if (!queryText) return { skipped: true, reason: "Zoekterm ontbreekt." };
    const size = Math.min(100, Math.max(1, Number(limit || 10)));
    const query = new URLSearchParams({ query: queryText, limit: String(size) });
    return discordBotFetch(`/guilds/${guildId()}/members/search?${query.toString()}`);
  }

  async function listGuildMembers(options = {}) {
    const size = Math.min(1000, Math.max(1, Number(options.limit || 1000)));
    const query = new URLSearchParams({ limit: String(size) });
    const after = normalizeDiscordId(options.after || "");
    if (after) query.set("after", after);
    return discordBotFetch(`/guilds/${guildId()}/members?${query.toString()}`);
  }

  async function getGuildAuditLogs(options = {}) {
    const actionType = Number(options.actionType || 0);
    const limit = Math.min(100, Math.max(1, Number(options.limit || 10)));
    const query = new URLSearchParams({ limit: String(limit) });
    if (Number.isFinite(actionType) && actionType > 0) query.set("action_type", String(actionType));
    return discordBotFetch(`/guilds/${guildId()}/audit-logs?${query.toString()}`);
  }

  function applicationId() {
    return String(process.env.DISCORD_CLIENT_ID || process.env.DISCORD_APPLICATION_ID || "").trim() || botToken().split(".")[0] || "";
  }

  async function registerGuildCommand(command) {
    const appId = applicationId();
    const targetGuildId = guildId();
    if (!appId || !targetGuildId) return { skipped: true, reason: "Discord application ID of guild ID ontbreekt." };
    return discordBotFetch(`/applications/${appId}/guilds/${targetGuildId}/commands`, {
      method: "POST",
      body: command
    });
  }

  async function getChannel(channelId) {
    const id = normalizeDiscordId(channelId);
    if (!id) return { skipped: true, reason: "Kanaal ID ontbreekt." };
    return discordBotFetch(`/channels/${id}`);
  }

  async function getMessage(channelId, messageId) {
    const targetChannelId = normalizeDiscordId(channelId);
    const targetMessageId = normalizeDiscordId(messageId);
    if (!targetChannelId || !targetMessageId) return { skipped: true, reason: "Kanaal of bericht ontbreekt." };
    return discordBotFetch(`/channels/${targetChannelId}/messages/${targetMessageId}`);
  }

  async function listMessages(channelId, options = {}) {
    const targetChannelId = normalizeDiscordId(channelId);
    if (!targetChannelId) return { skipped: true, reason: "Kanaal ID ontbreekt." };
    const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(options.limit || 100)))) });
    if (options.before) query.set("before", String(options.before));
    if (options.after) query.set("after", String(options.after));
    return discordBotFetch(`/channels/${targetChannelId}/messages?${query.toString()}`);
  }

  async function createMessage(channelId, payload, auditReason = "") {
    const targetChannelId = normalizeDiscordId(channelId);
    if (!targetChannelId) return { skipped: true, reason: "Kanaal ID ontbreekt." };
    return discordBotFetch(`/channels/${targetChannelId}/messages`, {
      method: "POST",
      body: payload,
      auditReason
    });
  }

  async function editMessage(channelId, messageId, payload, auditReason = "") {
    const targetChannelId = normalizeDiscordId(channelId);
    const targetMessageId = normalizeDiscordId(messageId);
    if (!targetChannelId || !targetMessageId) return { skipped: true, reason: "Kanaal of bericht ontbreekt." };
    return discordBotFetch(`/channels/${targetChannelId}/messages/${targetMessageId}`, {
      method: "PATCH",
      body: payload,
      auditReason
    });
  }

  async function createMessageWithFiles(channelId, payload, files = [], auditReason = "") {
    const targetChannelId = normalizeDiscordId(channelId);
    if (!targetChannelId) return { skipped: true, reason: "Kanaal ID ontbreekt." };
    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload || {}));
    files.slice(0, 10).forEach((file, index) => {
      const blob = new Blob([file.buffer], { type: file.contentType || "application/octet-stream" });
      formData.append(`files[${index}]`, blob, file.filename || `bijlage-${index + 1}`);
    });
    const headers = {
      Authorization: `Bot ${botToken()}`
    };
    if (auditReason) headers["X-Audit-Log-Reason"] = encodeURIComponent(String(auditReason).slice(0, 512));
    const response = await fetch(`${DISCORD_API_BASE}/channels/${targetChannelId}/messages`, {
      method: "POST",
      headers,
      body: formData
    });
    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (!response.ok) {
      const detail = data?.message || text || `Discord API fout ${response.status}`;
      const error = new Error(detail);
      error.status = response.status;
      error.discord = data;
      throw error;
    }
    return { ok: true, status: response.status, data };
  }

  async function createThreadFromMessage(channelId, messageId, name, auditReason = "") {
    const targetChannelId = normalizeDiscordId(channelId);
    const targetMessageId = normalizeDiscordId(messageId);
    if (!targetChannelId || !targetMessageId || !name) return { skipped: true, reason: "Kanaal, bericht of threadnaam ontbreekt." };
    return discordBotFetch(`/channels/${targetChannelId}/messages/${targetMessageId}/threads`, {
      method: "POST",
      body: {
        name: String(name || "").slice(0, 100),
        auto_archive_duration: 10080
      },
      auditReason
    });
  }

  async function deleteChannel(channelId, auditReason = "") {
    const targetChannelId = normalizeDiscordId(channelId);
    if (!targetChannelId) return { skipped: true, reason: "Kanaal ID ontbreekt." };
    return discordBotFetch(`/channels/${targetChannelId}`, {
      method: "DELETE",
      auditReason
    });
  }

  async function deleteMessage(channelId, messageId, auditReason = "") {
    const targetChannelId = normalizeDiscordId(channelId);
    const targetMessageId = normalizeDiscordId(messageId);
    if (!targetChannelId || !targetMessageId) return { skipped: true, reason: "Kanaal of bericht ontbreekt." };
    return discordBotFetch(`/channels/${targetChannelId}/messages/${targetMessageId}`, {
      method: "DELETE",
      auditReason
    });
  }

  async function sendDirectMessage(discordId, content, options = {}) {
    const memberId = normalizeDiscordId(discordId);
    const message = truncateDiscordMessage(content);
    const embeds = normalizeDiscordEmbeds(options.embeds);
    if (!memberId || (!message && !embeds.length)) return { skipped: true, reason: "Discord ID of bericht ontbreekt." };
    try {
      const channelResult = await discordBotFetch("/users/@me/channels", {
        method: "POST",
        body: { recipient_id: memberId }
      });
      const channelId = channelResult?.data?.id;
      if (!channelId) return { skipped: true, reason: "Discord DM-kanaal kon niet worden aangemaakt." };
      const body = {
        allowed_mentions: { parse: [] }
      };
      if (message) body.content = message;
      if (embeds.length) body.embeds = embeds;
      await discordBotFetch(`/channels/${channelId}/messages`, {
        method: "POST",
        body
      });
      return { ok: true, discordId: memberId };
    } catch (error) {
      if (error.status === 403 || error.discord?.code === 50007) {
        return {
          skipped: true,
          reason: "Discord DM kon niet worden gestuurd; gebruiker blokkeert DMs of deelt geen DM-rechten met de bot."
        };
      }
      throw error;
    }
  }

  function looksLikeActiveDsiNickname(nickname) {
    return /^(?:(?:ACO|TCO)\s+)?\[(?:24-\d{2}|[A-Za-z]{1,10}-\d{1,3})\]\s+\S/.test(String(nickname || "").trim());
  }

  async function activeDsiNicknameProtection(discordId, currentNickname) {
    try {
      const member = await sideTasksStore.findActiveDsiNicknameMember(discordId);
      if (member) return { source: "DSI-status", member };
    } catch (error) {
      // De herkenning hieronder blijft een veilige terugval wanneer een oudere
      // service nog geen centrale neventakendatabase kent.
      if (!dsiNicknameGuardWarningShown) {
        dsiNicknameGuardWarningShown = true;
        console.warn(`DSI nickname-bescherming kon de neventakendatabase niet lezen: ${error.message}`);
      }
    }
    if (looksLikeActiveDsiNickname(currentNickname)) return { source: "bestaande DSI-naam" };
    return null;
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

  async function syncRoleSet(discordId, desiredRoleIds, managedRoleIds, auditReason = `${portalAuditLabel} rollen gesynchroniseerd`, options = {}) {
    const memberId = normalizeDiscordId(discordId);
    const desired = compactRoleIds(desiredRoleIds);
    const managed = compactRoleIds(managedRoleIds);
    const requireOrganizationRole = options.requireOrganizationRole !== false;
    if (!memberId || !managed.length) return { skipped: true, reason: "Discord ID of beheerde rollen ontbreken." };

    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    if (!options.allowOrganizationRoleConflict && (requireOrganizationRole || desired.length)) {
      const conflict = organizationRoleConflictForMember(memberResult);
      if (conflict) return organizationRoleConflictResult(conflict);
    }
    if (requireOrganizationRole && !memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();

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

  async function removeCurrentOrganizationManagedRolesForPerson(person, auditReason = `${portalAuditLabel} rollen opgeschoond`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const managedRoleIds = currentOrganizationManagedRoleIds();
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen beheerde Discord rollen ingesteld." };
    return syncRoleSet(memberId, [], managedRoleIds, auditReason, {
      requireOrganizationRole: false,
      allowOrganizationRoleConflict: true
    });
  }

  async function enforceOrganizationRoleOwnershipForPerson(person, auditReason = `${portalAuditLabel} organisatierollen gecontroleerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    const conflict = organizationRoleConflictForMember(memberResult);
    if (!conflict) return null;
    const cleanup = await removeCurrentOrganizationManagedRolesForPerson(person, auditReason);
    return organizationRoleConflictResult(conflict, cleanup);
  }

  async function ensureBaseRolesForPerson(person, auditReason = `${portalAuditLabel} basisrollen gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };

    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    const conflict = organizationRoleConflictForMember(memberResult);
    if (conflict) return organizationRoleConflictResult(conflict);
    const existingRoles = new Set(memberResult.data?.roles || []);
    const desiredRoleIds = compactRoleIds([
      requiredDefensieRoleId(),
      desiredRankRoleIdForPerson(person)
    ]);
    if (!desiredRoleIds.length) return { skipped: true, reason: "Geen basisrollen ingesteld." };

    const changes = [];
    for (const roleId of desiredRoleIds) {
      if (!existingRoles.has(roleId)) {
        changes.push(await addRole(memberId, roleId, auditReason));
      }
    }
    return { ok: true, changes, desiredRoleIds };
  }

  async function syncRankRoleForPerson(person, auditReason = `${portalAuditLabel} rangrol gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const mappings = configuredRankRoleMappings();
    const managedRoleIds = mappings.map((mapping) => mapping.roleId);
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen Discord rangrollen ingesteld." };
    const desiredRoleId = desiredRankRoleIdForPerson(person);
    if (!desiredRoleId && isCurrentPerson(person) && String(person?.serviceNumber || "").trim()) {
      const result = await syncRoleSet(memberId, [], managedRoleIds, auditReason, {
        requireOrganizationRole: false
      });
      return {
        ...result,
        missingDesiredRankRole: true,
        reason: `Geen Discord rangrol ingesteld voor ${person?.rank || "onbekende rang"}; oude beheerde rangrollen verwijderd.`
      };
    }
    return syncRoleSet(memberId, desiredRoleId ? [desiredRoleId] : [], managedRoleIds, auditReason, {
      requireOrganizationRole: Boolean(desiredRoleId)
    });
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

  async function syncTrainingRequirementRolesForPerson(person, auditReason = `${portalAuditLabel} benodigde trainingsrollen gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const mappings = configuredTrainingRequirementRoleMappings();
    const managedRoleIds = mappings.map((mapping) => mapping.roleId);
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen Discord benodigde trainingsrollen ingesteld." };
    const missingRequirements = new Set(missingTrainingRequirementsForPerson(person));
    const desiredRoleIds = mappings
      .filter((mapping) => missingRequirements.has(mapping.requirement))
      .map((mapping) => mapping.roleId);
    return syncRoleSet(memberId, desiredRoleIds, managedRoleIds, auditReason);
  }

  async function syncTrainingRequirementRolesForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke benodigde trainingsrol controle`) {
    return syncTrainingRequirementRolesForPerson(person, auditReason);
  }

  async function syncBadgeRolesForPerson(person, auditReason = `${portalAuditLabel} functie- en badgerollen gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const mappings = configuredBadgeRoleMappings();
    const managedRoleIds = mappings.map((mapping) => mapping.roleId);
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen Discord functie- of badgerollen ingesteld." };
    const assignedBadges = assignedBadgeSetForPerson(person);
    const desiredRoleIds = mappings
      .filter((mapping) => assignedBadges.has(mapping.label))
      .map((mapping) => mapping.roleId);
    return syncRoleSet(memberId, desiredRoleIds, managedRoleIds, auditReason);
  }

  async function syncBadgeRolesForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke functie- en badgerol controle`) {
    return syncBadgeRolesForPerson(person, auditReason);
  }

  async function syncSeparatorRolesForPerson(person, auditReason = `${portalAuditLabel} scheidingsrollen gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const mappings = configuredSeparatorRoleMappings();
    const managedRoleIds = mappings.map((mapping) => mapping.roleId);
    if (!managedRoleIds.length) return { skipped: true, reason: "Geen Discord scheidingsrollen ingesteld." };
    const desiredRoleIds = mappings
      .filter((mapping) => separatorRoleMatchesPerson(mapping, person))
      .map((mapping) => mapping.roleId);
    return syncRoleSet(memberId, desiredRoleIds, managedRoleIds, auditReason);
  }

  async function syncSeparatorRolesForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke scheidingsrol controle`) {
    return syncSeparatorRolesForPerson(person, auditReason);
  }

  async function syncDiscordForPersonIfNeeded(person, auditReason = `${portalAuditLabel} Discord profiel gesynchroniseerd`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    if (!isCurrentPerson(person)) {
      const rankRole = await syncRankRoleForPersonIfNeeded(person, auditReason);
      const trainingNeededRoles = await syncTrainingRequirementRolesForPersonIfNeeded(person, auditReason);
      const separatorRoles = await syncSeparatorRolesForPersonIfNeeded(person, auditReason);
      return { ok: true, inactive: true, rankRole, trainingNeededRoles, separatorRoles };
    }
    const ownership = await enforceOrganizationRoleOwnershipForPerson(person, auditReason);
    if (ownership) return ownership;
    const baseRoles = await ensureBaseRolesForPerson(person, auditReason);
    const nickname = await syncNicknameForPersonIfNeeded(person, auditReason);
    const rankRole = await syncRankRoleForPersonIfNeeded(person, auditReason);
    const qualificationRoles = await syncQualificationRolesForPersonIfNeeded(person, auditReason);
    const trainingNeededRoles = await syncTrainingRequirementRolesForPersonIfNeeded(person, auditReason);
    const badgeRoles = await syncBadgeRolesForPersonIfNeeded(person, auditReason);
    const separatorRoles = await syncSeparatorRolesForPersonIfNeeded(person, auditReason);
    return { ok: true, baseRoles, nickname, rankRole, qualificationRoles, trainingNeededRoles, badgeRoles, separatorRoles };
  }

  function buildServiceNickname(person, template = process.env.DISCORD_NICKNAME_TEMPLATE || "personeelsportaal") {
    if (!template || template === "personeelsportaal" || !nicknameTemplateHasPlaceholders(template)) {
      return buildServiceNicknameDefault(person);
    }
    const resolvedTemplate = normalizeNicknameTemplateForOrganization(template);
    const serviceNumber = person?.serviceNumber || person?.previousServiceNumber || "";
    const name = person?.name || person?.discordUsername || "";
    const symbols = rankSymbolsFor(person?.rank);
    const nickname = resolvedTemplate
      .replaceAll("{serviceNumber}", serviceNumber)
      .replaceAll("{name}", name)
      .replaceAll("{formattedName}", formatNameForDiscordNickname(name))
      .replaceAll("{rank}", person?.rank || "")
      .replaceAll("{symbols}", symbols)
      .replaceAll("{symbolSeparator}", rankSymbolSeparator())
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
    const conflict = organizationRoleConflictForMember(memberResult);
    if (conflict) return organizationRoleConflictResult(conflict);
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();
    const dsiProtection = await activeDsiNicknameProtection(memberId, memberResult.data?.nick);
    if (dsiProtection) {
      return { skipped: true, reason: `DSI nickname blijft behouden (${dsiProtection.source}).` };
    }
    const desiredNickname = buildServiceNickname(person);
    const result = await setNickname(memberId, desiredNickname, auditReason);
    return { ...result, nickname: desiredNickname };
  }

  async function syncNicknameForPersonIfNeeded(person, auditReason = `${portalAuditLabel} periodieke nickname controle`) {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const desiredNickname = buildServiceNickname(person);
    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    const conflict = organizationRoleConflictForMember(memberResult);
    if (conflict) return organizationRoleConflictResult(conflict);
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();
    const currentNickname = memberResult.data?.nick || "";
    const dsiProtection = await activeDsiNicknameProtection(memberId, currentNickname);
    if (dsiProtection) {
      return { skipped: true, reason: `DSI nickname blijft behouden (${dsiProtection.source}).` };
    }
    if (nicknameHasPortoDutyPrefix(currentNickname) && !auditReasonAllowsNormalNicknameOverDuty(auditReason)) {
      return { ok: true, unchanged: true, nickname: currentNickname, protectedPortoDuty: true };
    }
    if (currentNickname === desiredNickname) return { ok: true, unchanged: true, nickname: desiredNickname };
    const result = await setNickname(memberId, desiredNickname, auditReason);
    return { ...result, nickname: desiredNickname };
  }

  async function syncPortoNicknameForPersonIfNeeded(person, unit, auditReason = "Porto roepnummer nickname gesynchroniseerd") {
    if (isDiscordSyncExcludedPerson(person)) return discordSyncExcludedResult();
    const memberId = normalizeDiscordId(person?.discordId || unit?.discordId);
    if (!memberId) return { skipped: true, reason: "Discord ID ontbreekt." };
    const desiredNickname = buildPortoNicknameDefault(person, unit);
    const memberResult = await getGuildMember(memberId);
    if (memberResult.skipped) return memberResult;
    const conflict = organizationRoleConflictForMember(memberResult);
    if (conflict) return organizationRoleConflictResult(conflict);
    if (!memberHasRequiredDefensieRole(memberResult)) return missingDefensieRoleResult();
    const currentNickname = memberResult.data?.nick || "";
    const dsiProtection = await activeDsiNicknameProtection(memberId, currentNickname);
    if (dsiProtection) {
      return { skipped: true, reason: `DSI nickname blijft behouden (${dsiProtection.source}).` };
    }
    if (currentNickname === desiredNickname) return { ok: true, unchanged: true, nickname: desiredNickname };
    const result = await setNickname(memberId, desiredNickname, auditReason);
    return { ...result, nickname: desiredNickname };
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
    allQualificationRoleMappings,
    allRankRoleMappings,
    allBadgeRoleMappings,
    allTrainingRequirementRoleMappings,
    allSeparatorRoleMappings,
    configuredRankRoleMappings,
    missingRankRoleMappings,
    configuredQualificationRoleMappings,
    missingQualificationRoleMappings,
    configuredTrainingRequirementRoleMappings,
    missingTrainingRequirementRoleMappings,
    configuredBadgeRoleMappings,
    missingBadgeRoleMappings,
    configuredSeparatorRoleMappings,
    missingSeparatorRoleMappings,
    separatorRoleMatchesPerson,
    desiredSeparatorRoleMappingsForPerson,
    configuredVoiceChannels,
    resolveVoiceChannelId,
    getGuildMember,
    searchGuildMembers,
    listGuildMembers,
    getGuildAuditLogs,
    registerGuildCommand,
    getChannel,
    getMessage,
    listMessages,
    createMessage,
    editMessage,
    createMessageWithFiles,
    createThreadFromMessage,
    deleteChannel,
    deleteMessage,
    sendDirectMessage,
    addRole,
    removeRole,
    syncRoleSet,
    ensureBaseRolesForPerson,
    enforceOrganizationRoleOwnershipForPerson,
    removeCurrentOrganizationManagedRolesForPerson,
    isDiscordSyncExcludedPerson,
    isDiscordSyncExcludedDiscordId,
    rankRoleEnvKeys: organization.discord?.rankRoleEnvKeys || defaultDefensieRankRoleEnvKeys,
    rankRoleIdForPerson,
    desiredRankRoleIdForPerson,
    missingTrainingRequirementsForPerson,
    syncRankRoleForPerson,
    syncRankRoleForPersonIfNeeded,
    syncQualificationRolesForPerson,
    syncQualificationRolesForPersonIfNeeded,
    syncTrainingRequirementRolesForPerson,
    syncTrainingRequirementRolesForPersonIfNeeded,
    syncBadgeRolesForPerson,
    syncBadgeRolesForPersonIfNeeded,
    syncSeparatorRolesForPerson,
    syncSeparatorRolesForPersonIfNeeded,
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
