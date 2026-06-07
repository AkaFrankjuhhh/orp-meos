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
  function normalizeFunctionBadge(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function hasFunctionBadge(functionBadges, badge) {
    const normalized = normalizeFunctionBadge(badge);
    return functionBadges.some((item) => normalizeFunctionBadge(item) === normalized);
  }

  function canonicalFunctionBadge(value) {
    const normalized = normalizeFunctionBadge(value);
    return extraFunctions.find((badge) => normalizeFunctionBadge(badge) === normalized) || "";
  }

  function effectiveFunctionBadges(profile) {
    const badges = new Set(automaticFunctionBadges(profile));
    const permRole = canonicalFunctionBadge(profile?.permRole);
    if (permRole) badges.add(permRole);
    (profile?.extraFunctions || []).forEach((badge) => {
      const canonical = canonicalFunctionBadge(badge);
      if (canonical) badges.add(canonical);
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
    const isKader = hasFunctionBadge(functionBadges, "Kader") || isDevOverride;
    const isOverheidsCoordinator = hasFunctionBadge(functionBadges, "Overheidscoördinator");
    const canViewAsKader = isKader || isOverheidsCoordinator;
    const isHoofdofficier = hasFunctionBadge(functionBadges, "Hoofdofficier");
    const isOfficiersraad = hasFunctionBadge(functionBadges, "Officiersraad");
    const isInterneZaken = taskBadges.includes("Interne-Zaken");
    const isOvJ = taskBadges.includes("OvJ") || taskBadges.includes("hOvJ");
    const isTrainer = taskBadges.includes("Trainer");
    const isMentor = taskBadges.includes("Mentor");
    const isWs = taskBadges.includes("W&S");
    const isMentorLeadership = taskBadges.includes("Mentor-Leiding");
    const isOtcLeadership = taskBadges.includes("OTC-Leiding");
    const isIzLeadership = taskBadges.includes("IZ-Leiding");
    const isTrainerLeadership = taskBadges.includes("Trainer-Leiding");

    return {
      canViewLogbook: canViewAsKader,
      canManagePeople: isKader,
      canViewPersonnel: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canManagePersonnelRanks: isKader || isHoofdofficier || isOfficiersraad,
      canViewAbsenceOverview: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canReviewAbsences: isKader || isHoofdofficier || isOfficiersraad,
      canViewResignationOverview: canViewAsKader || isHoofdofficier,
      canViewPersonnelArchive: canViewAsKader || isHoofdofficier,
      canViewKaderPages: canViewAsKader,
      canManageProfileBadges: isKader || isHoofdofficier || isOfficiersraad,
      canManageQualifications: isKader || isTrainer || isTrainerLeadership,
      canRevokeIbt: isKader || isOvJ,
      canViewAllDiscipline: canViewAsKader || isInterneZaken || isIzLeadership,
      canViewI8Discipline: canViewAsKader || isInterneZaken || isOvJ,
      canManageDiscipline: isKader || isInterneZaken,
      canManageI8Discipline: isKader || isInterneZaken || isOvJ,
      canViewAllHours: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canManageHours: isKader || isHoofdofficier || isOfficiersraad,
      canViewOvJChannels: canViewAsKader || isOvJ,
      canReviewI8Forms: isKader || isOvJ,
      canLeadOvJ: isKader || taskBadges.includes("OvJ"),
      canViewMentorOverview: canViewAsKader || isMentor || isMentorLeadership || isOtcLeadership,
      canManageMentorOverview: isKader || isMentor || isMentorLeadership || isOtcLeadership,
      canManageMentorChecklistTemplate: isKader || isMentorLeadership || isOtcLeadership,
      canViewRecruitment: canViewAsKader || isWs,
      canRecruitPeople: isKader || isWs,
      canViewBlacklist: canViewAsKader || isWs,
      canManageBlacklist: isKader,
      canViewOvJLeadershipLog: canViewAsKader || taskBadges.includes("OvJ"),
      canViewMentorLeadershipLog: canViewAsKader || isMentorLeadership || isOtcLeadership,
      canViewProfileAuditLog: canViewAsKader || isHoofdofficier,
      canViewRestrictedTaskBadges: canViewAsKader || isHoofdofficier || isOfficiersraad,
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
        permRole: "Overheidscoördinator",
        roleId: process.env.DISCORD_OVERHEIDSCOORDINATOR_ROLE_ID || state.discord?.overheidsCoordinatorRoleId || ""
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
