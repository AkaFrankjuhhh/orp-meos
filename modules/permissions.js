function normalizeDiscordId(value) {
  return String(value || "").replace(/^discord:/i, "").trim();
}

function configuredDevDiscordIds() {
  return new Set(String(process.env.DEV_OVERRIDE_DISCORD_IDS || "").split(",").map(normalizeDiscordId).filter(Boolean));
}

function isDevOverrideProfile(profile) {
  return Boolean(profile?.status === "Actief" && configuredDevDiscordIds().has(normalizeDiscordId(profile.discordId)));
}

function automaticFunctionBadges(profile) {
  const rank = profile?.rank || "";
  const badges = [];
  if (["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"].includes(rank)) badges.push("Kader");
  if (["Kolonel", "Luitenant-Kolonel", "Majoor"].includes(rank)) badges.push("Hoofdofficier");
  return badges;
}

function createPermissionServices({ extraFunctions, extraTasks, readState }) {
  function effectiveFunctionBadges(profile) {
    const badges = new Set(automaticFunctionBadges(profile));
    if (extraFunctions.includes(profile?.permRole)) badges.add(profile.permRole);
    (profile?.extraFunctions || []).forEach((badge) => {
      if (extraFunctions.includes(badge)) badges.add(badge);
    });
    return [...badges];
  }

  function effectiveTaskBadges(profile) {
    return (profile?.badges || []).filter((badge) => extraTasks.includes(badge));
  }

  function isKaderProfile(profile) {
    return isDevOverrideProfile(profile) || effectiveFunctionBadges(profile).includes("Kader");
  }

  function permissionsForProfile(profile) {
    const functionBadges = effectiveFunctionBadges(profile);
    const taskBadges = effectiveTaskBadges(profile);
    const isDevOverride = isDevOverrideProfile(profile);
    const isKader = functionBadges.includes("Kader") || isDevOverride;
    const isHoofdofficier = functionBadges.includes("Hoofdofficier");
    const isOfficiersraad = functionBadges.includes("Officiersraad");
    const isInterneZaken = taskBadges.includes("Interne-Zaken");
    const isOvJ = taskBadges.includes("OvJ") || taskBadges.includes("hOvJ");
    const isTrainer = taskBadges.includes("Trainer");
    const isMentor = taskBadges.includes("Mentor");
    const isWs = taskBadges.includes("W&S");
    const isMentorLeadership = taskBadges.includes("Mentor-Leiding");
    const isIzLeadership = taskBadges.includes("IZ-Leiding");
    const isTrainerLeadership = taskBadges.includes("Trainer-Leiding");

    return {
      canViewLogbook: isKader,
      canManagePeople: isKader,
      canViewKaderPages: isKader,
      canManageProfileBadges: isKader,
      canManageQualifications: isKader || isTrainer || isTrainerLeadership,
      canViewAllDiscipline: isKader || isInterneZaken || isIzLeadership,
      canViewI8Discipline: isKader || isInterneZaken || isOvJ,
      canManageDiscipline: isKader || isInterneZaken,
      canViewAllHours: isKader || isHoofdofficier || isOfficiersraad,
      canManageHours: isKader || isHoofdofficier || isOfficiersraad,
      canViewOvJChannels: isKader || isOvJ,
      canViewMentorOverview: isKader || isMentor || isMentorLeadership,
      canManageMentorOverview: isKader || isMentor || isMentorLeadership,
      canRecruitPeople: isKader || isWs,
      canViewOvJLeadershipLog: isKader || taskBadges.includes("OvJ"),
      canViewMentorLeadershipLog: isKader || isMentorLeadership,
      canUseDevTools: isDevOverride
    };
  }

  function permissionsForAuth(auth, state = readState()) {
    const usableState = state && typeof state.then !== "function" ? state : null;
    const freshProfile = usableState?.people?.find((person) => person.id === auth.profile.id) || auth.profile;
    return permissionsForProfile(freshProfile);
  }

  async function hasPermission(auth, state, permission) {
    return Boolean(permissionsForAuth(auth, state)[permission]);
  }

  async function hasKaderAccess(auth, state = readState()) {
    const usableState = state && typeof state.then !== "function" ? state : await state;
    const freshProfile = usableState?.people?.find((person) => person.id === auth.profile.id) || auth.profile;
    return isKaderProfile(freshProfile);
  }

  function getPermRoleMappings(state) {
    return [
      {
        permRole: "Kader",
        roleId: process.env.DISCORD_KADER_ROLE_ID || state.discord?.kaderRoleId || ""
      },
      {
        permRole: "Hoofdofficier",
        roleId: process.env.DISCORD_HOOFDOFFICIER_ROLE_ID || state.discord?.hoofdofficierRoleId || ""
      },
      {
        permRole: "Officiersraad",
        roleId: process.env.DISCORD_OFFICIERSRAAD_ROLE_ID || state.discord?.officiersraadRoleId || ""
      }
    ].filter((mapping) => mapping.roleId);
  }

  function resolveSyncedPermRole(profile, roles, state) {
    const mappings = getPermRoleMappings(state);
    if (!mappings.length) return profile.permRole || "Geen";

    const matched = mappings.find((mapping) => roles.includes(mapping.roleId));
    if (matched) return matched.permRole;

    const syncedPermRoles = new Set(mappings.map((mapping) => mapping.permRole));
    if (syncedPermRoles.has(profile.permRole)) return "Geen";
    return profile.permRole || "Geen";
  }

  return {
    automaticFunctionBadges,
    effectiveFunctionBadges,
    effectiveTaskBadges,
    isKaderProfile,
    permissionsForProfile,
    permissionsForAuth,
    hasPermission,
    hasKaderAccess,
    getPermRoleMappings,
    isDevOverrideProfile,
    resolveSyncedPermRole
  };
}

module.exports = { createPermissionServices };
