const { currentOrganization, envOrDefault, organizationMainRoleId } = require("./organizations");

function normalizeRoleId(value) {
  return String(value || "").trim();
}

function addRoleId(set, value) {
  const roleId = normalizeRoleId(value);
  if (roleId) set.add(roleId);
}

function collectOrganizationDiscordRoleIds(organization = currentOrganization()) {
  const roleIds = new Set();
  addRoleId(roleIds, organizationMainRoleId(organization));

  for (const mapping of organization.discord?.functionRoleMappings || []) {
    addRoleId(roleIds, envOrDefault(mapping.envKey, mapping.defaultRoleId));
  }
  for (const mapping of organization.discord?.taskRoleMappings || []) {
    addRoleId(roleIds, envOrDefault(mapping.envKey, mapping.defaultRoleId));
  }
  for (const mapping of Object.values(organization.discord?.rankRoleEnvKeys || {})) {
    if (typeof mapping === "string") {
      addRoleId(roleIds, envOrDefault(mapping));
    } else {
      addRoleId(roleIds, envOrDefault(mapping?.envKey, mapping?.defaultRoleId || mapping?.roleId));
    }
  }
  for (const mapping of Object.values(organization.discord?.qualificationRoleMappings || {})) {
    addRoleId(roleIds, envOrDefault(mapping.envKey, mapping.defaultRoleId));
  }

  return roleIds;
}

function collectDefensieLeaveLogRoleIds(organization = currentOrganization()) {
  const roleIds = new Set();
  if (String(organization?.key || "").trim() !== "defensie") return roleIds;
  addRoleId(roleIds, organizationMainRoleId(organization));
  return roleIds;
}

function memberHasAnyTrackedRole(memberRoles = [], trackedRoleIds = new Set()) {
  if (!trackedRoleIds.size) return false;
  return (memberRoles || []).some((roleId) => trackedRoleIds.has(normalizeRoleId(roleId)));
}

function discordLeaveLogWebhookUrl(organization = currentOrganization()) {
  const organizationKey = String(organization.key || "").trim().toUpperCase();
  return envOrDefault(`DISCORD_${organizationKey}_LEAVE_LOG_WEBHOOK_URL`, process.env.DISCORD_LEAVE_LOG_WEBHOOK_URL);
}

function discordUserTag(user = {}) {
  const username = String(user.username || user.global_name || user.id || "Onbekend").trim();
  const discriminator = String(user.discriminator || "").trim();
  if (discriminator && discriminator !== "0") return `${username}#${discriminator}`;
  return username.startsWith("@") ? username : `@${username}`;
}

function discordUserId(user = {}) {
  return String(user.id || "").trim();
}

function discordMemberDisplayName(member = {}) {
  return String(member.nick || member.user?.global_name || member.user?.username || member.user?.id || "Onbekend").trim();
}

const LEAVE_LOG_REASON_TEXT = {
  leave: "Is de discord verlaten",
  kick: "Is uit de discord gekickt",
  ban: "Is verbannen uit de discord"
};

const LEAVE_LOG_REASON_COLOR = {
  leave: 0xf59e0b,
  kick: 0xef4444,
  ban: 0x7f1d1d
};

function normalizeLeaveLogReason(reason) {
  const value = String(reason || "").trim().toLowerCase();
  if (value === "kick" || value === "kicked") return "kick";
  if (value === "ban" || value === "banned") return "ban";
  return "leave";
}

function leaveLogReasonText(reason) {
  return LEAVE_LOG_REASON_TEXT[normalizeLeaveLogReason(reason)];
}

function buildDiscordLeaveLogPayload(member = {}, options = {}) {
  const name = discordMemberDisplayName(member);
  const tag = discordUserTag(member.user || {});
  const discordId = discordUserId(member.user || {});
  const mention = discordId ? `<@${discordId}>` : "Discord profiel onbekend";
  const normalizedReason = normalizeLeaveLogReason(options.reason);
  const reasonText = leaveLogReasonText(normalizedReason);
  return {
    embeds: [
      {
        title: "Leave-log",
        color: LEAVE_LOG_REASON_COLOR[normalizedReason],
        fields: [
          { name: "Naam medewerker", value: name || "Onbekend", inline: false },
          { name: "Discord-tag", value: mention || tag || "Onbekend", inline: false },
          { name: "Discord ID", value: discordId || "Onbekend", inline: false },
          { name: "Reden", value: reasonText, inline: false }
        ],
        timestamp: new Date().toISOString()
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

async function sendDiscordLeaveLog(webhookUrl, payload, fetchImpl = fetch) {
  if (!String(webhookUrl || "").trim()) return { skipped: true, reason: "Webhook ontbreekt." };
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) return { ok: false, status: response.status, body: text };
  return { ok: true, status: response.status, body: text };
}

module.exports = {
  buildDiscordLeaveLogPayload,
  collectDefensieLeaveLogRoleIds,
  collectOrganizationDiscordRoleIds,
  discordLeaveLogWebhookUrl,
  discordMemberDisplayName,
  discordUserId,
  discordUserTag,
  leaveLogReasonText,
  memberHasAnyTrackedRole,
  normalizeLeaveLogReason,
  sendDiscordLeaveLog
};
