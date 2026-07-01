const { normalizeDiscordId } = require("./ovc");
const { isPersonLoginEligible } = require("./person-status");

function hasOrganizationRole(roles = [], organizationRoleId = "") {
  const roleId = String(organizationRoleId || "").trim();
  return Boolean(roleId && Array.isArray(roles) && roles.includes(roleId));
}

function isLinkedLoginProfile(profile, discordId) {
  const linkedDiscordId = normalizeDiscordId(profile?.discordId);
  const loginDiscordId = normalizeDiscordId(discordId);
  return Boolean(linkedDiscordId && loginDiscordId && linkedDiscordId === loginDiscordId && isPersonLoginEligible(profile));
}

function canUsePortalLogin({ profile = null, discordId = "", roles = [], organizationRoleId = "", devOverride = false } = {}) {
  return Boolean(
    devOverride ||
    hasOrganizationRole(roles, organizationRoleId) ||
    isLinkedLoginProfile(profile, discordId)
  );
}

module.exports = {
  canUsePortalLogin,
  hasOrganizationRole,
  isLinkedLoginProfile
};
