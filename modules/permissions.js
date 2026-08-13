const { currentOrganization, envOrDefault } = require("./organizations");
const {
  configuredDevDiscordIds,
  isDevDiscordId,
  isOvcFunctionBadge,
  canonicalizeFunctionBadge,
  normalizeFunctionBadge
} = require("./ovc");
const { isCurrentPerson } = require("./person-status");

function isDevOverrideProfile(profile) {
  return Boolean(isCurrentPerson(profile) && isDevDiscordId(profile.discordId));
}

function automaticFunctionBadges(profile) {
  const organization = currentOrganization();
  const rank = profile?.rank || "";
  const badges = [];
  for (const mapping of organization.autoFunctionByRanks || []) {
    if ((mapping.ranks || []).includes(rank)) badges.push(mapping.label);
  }
  return badges;
}

function createPermissionServices({ extraFunctions, extraTasks, readState }) {
  const organization = currentOrganization();
  const permissionAliases = organization.permissionAliases || {};
  const branchLeadershipTaskTargets = {
    "Trainer-Leiding": "Trainer",
    "Trainer-Assist. Leiding": "Trainer",
    "Co\u00f6rdinator Trainer": "Trainer",
    "Mentor-Leiding": "Mentor",
    "Mentor-Assist. Leiding": "Mentor",
    "Co\u00f6rdinator Mentor": "Mentor",
    "W&S-Leiding": "W&S",
    "W&S-Assist. Leiding": "W&S",
    "Directie W&S": "W&S",
    "Teamchef W&S": "W&S",
    "Co\u00f6rdinator W&S": "W&S",
    "IZ-Leiding": "Interne-Zaken",
    "IZ-Assist. Leiding": "Interne-Zaken",
    "Directie Operatie": "Operatie",
    "Teamchef Operatie": "Operatie",
    "Co\u00f6rdinator Operatie": "Operatie",
    "Directie OTC": ["Mentor", "Trainer"],
    "Teamchef OTC": ["Mentor", "Trainer"],
    "DSI-Leiding": "DSI",
    "KLu-Leiding": "KLu",
    "DNR-Leiding": "DNR",
    "Wijkagent-Leiding": "Wijkagent",
    "Wijkagent-Assist. Leiding": "Wijkagent",
    "HRB-Leiding": "HRB",
    "VID-Leiding": "VID"
  };
  const branchLeadershipFunctionTargets = {
    "HR-Leiding": "HR",
    "HR-Assist. Leiding": "HR"
  };

  function hasFunctionBadge(functionBadges, badge) {
    const normalized = normalizeFunctionBadge(badge);
    return functionBadges.some((item) => normalizeFunctionBadge(item) === normalized);
  }

  function canonicalFunctionBadge(value) {
    return canonicalizeFunctionBadge(value, extraFunctions);
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

  function manageableProfileTaskBadgesFor(taskBadges) {
    return Object.entries(branchLeadershipTaskTargets)
      .filter(([leadershipBadge]) => taskBadges.includes(leadershipBadge))
      .flatMap(([, targetBadge]) => Array.isArray(targetBadge) ? targetBadge : [targetBadge])
      .filter((targetBadge) => extraTasks.includes(targetBadge))
      .filter((badge, index, list) => list.indexOf(badge) === index);
  }

  function manageableProfileFunctionBadgesFor(taskBadges) {
    return Object.entries(branchLeadershipFunctionTargets)
      .filter(([leadershipBadge, targetBadge]) => taskBadges.includes(leadershipBadge) && extraFunctions.includes(targetBadge))
      .map(([, targetBadge]) => targetBadge)
      .filter((badge, index, list) => list.indexOf(badge) === index);
  }

  function isKaderProfile(profile) {
    const functionBadges = effectiveFunctionBadges(profile);
    const taskBadges = effectiveTaskBadges(profile);
    const leadershipBadges = permissionAliases.kader || ["Kader"];
    const fullPortalManagementBadges = organization.permissions?.fullPortalManagementAliases || [];
    return isDevOverrideProfile(profile)
      || leadershipBadges.some((badge) => hasFunctionBadge(functionBadges, badge))
      || fullPortalManagementBadges.some((badge) => hasFunctionBadge(functionBadges, badge) || taskBadges.includes(badge));
  }

  function permissionsForProfile(profile) {
    const functionBadges = effectiveFunctionBadges(profile);
    const taskBadges = effectiveTaskBadges(profile);
    const isDevOverride = isDevOverrideProfile(profile);
    const canManageOvcBadge = isDevDiscordId(profile?.discordId);
    const isKader = (permissionAliases.kader || ["Kader"]).some((badge) => hasFunctionBadge(functionBadges, badge)) || isDevOverride;
    const canViewAsKader = isKader || (permissionAliases.viewAsKader || ["Kader", "OVC", "Overheidscoordinator"]).some((badge) => hasFunctionBadge(functionBadges, badge));
    const isFullPortalManagement = isKader || (organization.permissions?.fullPortalManagementAliases || [])
      .some((badge) => hasFunctionBadge(functionBadges, badge) || taskBadges.includes(badge));
    const isProfileBadgeManagement = isFullPortalManagement || (organization.permissions?.profileBadgeManagementAliases || [])
      .some((badge) => hasFunctionBadge(functionBadges, badge) || taskBadges.includes(badge));
    const isTrainingManagement = isFullPortalManagement || (organization.permissions?.trainingManagementAliases || [])
      .some((badge) => hasFunctionBadge(functionBadges, badge) || taskBadges.includes(badge));
    const isDisciplineManagement = isFullPortalManagement || (organization.permissions?.disciplineManagementAliases || [])
      .some((badge) => hasFunctionBadge(functionBadges, badge) || taskBadges.includes(badge));
    const isHoofdofficier = (permissionAliases.hoofdofficier || ["Hoofdofficier"]).some((badge) => hasFunctionBadge(functionBadges, badge));
    const isOfficiersraad = (permissionAliases.officiersraad || ["Officiersraad"]).some((badge) => hasFunctionBadge(functionBadges, badge));
    const isInterneZaken = taskBadges.includes("Interne-Zaken");
    const isOvJ = taskBadges.includes("OvJ") || taskBadges.includes("hOvJ");
    const isTrainer = taskBadges.includes("Trainer");
    const isMentor = taskBadges.includes("Mentor");
    const isWs = taskBadges.includes("W&S");
    const isWsLeadership = taskBadges.includes("W&S-Leiding")
      || taskBadges.includes("W&S-Assist. Leiding")
      || taskBadges.includes("Directie W&S")
      || taskBadges.includes("Teamchef W&S")
      || taskBadges.includes("Co\u00f6rdinator W&S");
    const isMentorLeadership = taskBadges.includes("Mentor-Leiding")
      || taskBadges.includes("Mentor-Assist. Leiding")
      || taskBadges.includes("Co\u00f6rdinator Mentor");
    const isOtcLeadership = taskBadges.includes("OTC-Leiding")
      || taskBadges.includes("Directie OTC")
      || taskBadges.includes("Teamchef OTC")
      || taskBadges.includes("Co\u00f6rdinator Mentor")
      || taskBadges.includes("Co\u00f6rdinator Trainer");
    const isIzLeadership = taskBadges.includes("IZ-Leiding") || taskBadges.includes("IZ-Assist. Leiding");
    const isTrainerLeadership = taskBadges.includes("Trainer-Leiding")
      || taskBadges.includes("Trainer-Assist. Leiding")
      || taskBadges.includes("Co\u00f6rdinator Trainer");
    const manageableProfileTaskBadges = manageableProfileTaskBadgesFor(taskBadges);
    const profileBadgeManagementFunctionTargets = isProfileBadgeManagement
      ? (organization.permissions?.profileBadgeManagementFunctionTargets || [])
      : [];
    const manageableProfileFunctionBadges = [
      ...manageableProfileFunctionBadgesFor(taskBadges),
      ...profileBadgeManagementFunctionTargets.filter((badge) => extraFunctions.includes(badge))
    ].filter((badge, index, list) => list.indexOf(badge) === index);
    const canViewTrainerSection = canViewAsKader || isTrainer || isTrainerLeadership;
    const isHrManagement = (organization.permissions?.hrManagementAliases || []).some((badge) => hasFunctionBadge(functionBadges, badge) || taskBadges.includes(badge));
    const i8ReviewMode = organization.permissions?.i8ReviewMode || "defensie";
    const canViewI8Forms = canViewAsKader || isOvJ || isInterneZaken || isIzLeadership;
    const canHandleI8Forms = i8ReviewMode === "ovjOnly" ? isOvJ : canViewI8Forms;
    const canOverrideI8Forms = i8ReviewMode === "ovjOnly" ? isOvJ : isKader || taskBadges.includes("OvJ") || isInterneZaken || isIzLeadership;
    const canManagePersonnelRanks = organization.permissions?.personnelRankMode === "kaderOnly"
      ? isFullPortalManagement
      : isFullPortalManagement || isHoofdofficier || isOfficiersraad;
    const canReviewAbsences = organization.permissions?.absenceReviewMode === "kaderAndHoofdofficier"
      ? isFullPortalManagement || isHoofdofficier
      : isFullPortalManagement || isHoofdofficier || isOfficiersraad;
    const canOfficerManage = organization.permissions?.officerManagementMode !== "viewAndAbsenceOnly";
    const canManageAllProfileTaskBadges = isProfileBadgeManagement || (canOfficerManage && (isHoofdofficier || isOfficiersraad));

    return {
      canViewLogbook: canViewAsKader,
      canManagePeople: isFullPortalManagement,
      canViewPersonnel: canViewAsKader || isHoofdofficier || isOfficiersraad || isHrManagement,
      canManagePersonnelRanks,
      canDismissPersonnel: isFullPortalManagement || isHrManagement,
      canDismissPersonnelToAdjudant: isFullPortalManagement || (canOfficerManage && isHoofdofficier),
      canViewAbsenceOverview: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canReviewAbsences,
      canViewResignationOverview: canViewAsKader || (canOfficerManage && isHoofdofficier),
      canViewPersonnelArchive: canViewAsKader || (canOfficerManage && isHoofdofficier),
      canViewKaderPages: canViewAsKader,
      canManageInvestigationStatus: isFullPortalManagement || isHoofdofficier || isOfficiersraad,
      canManageProfileBadges: canManageAllProfileTaskBadges || manageableProfileTaskBadges.length > 0 || manageableProfileFunctionBadges.length > 0,
      canManageAllProfileTaskBadges,
      canManageAllProfileFunctions: isFullPortalManagement,
      canManageProfileFunctions: isFullPortalManagement || manageableProfileFunctionBadges.length > 0,
      manageableProfileTaskBadges,
      manageableProfileFunctionBadges,
      canManageQualifications: isTrainingManagement || isTrainer || isTrainerLeadership,
      canRevokeIbt: isFullPortalManagement || isOvJ,
      canViewTrainerSection,
      canViewTrainerOverview: canViewTrainerSection,
      canViewTrainerLogbook: canViewAsKader || isTrainerLeadership,
      canReviewTrainerIbtForms: isTrainer || isTrainerLeadership,
      canViewAllDiscipline: canViewAsKader || isInterneZaken || isIzLeadership,
      canViewI8Discipline: canViewAsKader || isInterneZaken || isIzLeadership || isOvJ,
      canManageDiscipline: isDisciplineManagement || isInterneZaken || isIzLeadership,
      canManageI8Discipline: isDisciplineManagement || isInterneZaken || isIzLeadership || isOvJ,
      canViewAllHours: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canManageHours: isFullPortalManagement || (canOfficerManage && (isHoofdofficier || isOfficiersraad)),
      canViewAllProfileNotes: isFullPortalManagement || isHoofdofficier || isOfficiersraad,
      canManageProfileNotes: isFullPortalManagement || isHoofdofficier || isOfficiersraad,
      canManageVehicleSeizures: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canViewOvJChannels: canViewI8Forms,
      canReviewI8Forms: canHandleI8Forms,
      canOverrideI8Forms,
      canLeadOvJ: isFullPortalManagement || taskBadges.includes("OvJ"),
      canViewMentorOverview: canViewAsKader || isMentor || isMentorLeadership || isOtcLeadership,
      canManageMentorOverview: isFullPortalManagement || isMentor || isMentorLeadership || isOtcLeadership,
      canManageMentorChecklistTemplate: isFullPortalManagement || isMentorLeadership || isOtcLeadership,
      canManageMentorTestTemplate: isMentorLeadership || isDevOverride,
      canViewRecruitment: canViewAsKader || isWs || isWsLeadership || isHrManagement,
      canRecruitPeople: isFullPortalManagement || isWs || isWsLeadership || isHrManagement,
      canViewBlacklist: canViewAsKader || isWs || isWsLeadership,
      canManageBlacklist: isFullPortalManagement,
      canViewOvJLeadershipLog: canViewAsKader || taskBadges.includes("OvJ"),
      canViewMentorLeadershipLog: canViewAsKader || isMentorLeadership || isOtcLeadership,
      canViewProfileAuditLog: canViewAsKader || isHoofdofficier || canViewTrainerSection,
      canViewRestrictedTaskBadges: canViewAsKader || isHoofdofficier || isOfficiersraad,
      canManageOvcBadge,
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
    return (organization.discord?.functionRoleMappings || [])
      .map((mapping) => ({
        permRole: mapping.label,
        roleId: envOrDefault(mapping.envKey, mapping.defaultRoleId) || state.discord?.[mapping.stateKey] || ""
      }))
      .filter((mapping) => mapping.roleId);
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
    configuredDevDiscordIds,
    isDevOverrideProfile,
    isOvcFunctionBadge,
    resolveSyncedPermRole
  };
}

module.exports = { createPermissionServices };
