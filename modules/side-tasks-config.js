const SIDE_TASK_STATUS_OPTIONS = [
  { value: "1", label: "Beschikbaar", active: true, color: "green" },
  { value: "2", label: "Aanrijdend", active: true, color: "cyan" },
  { value: "3", label: "Ter plaatse", active: true, color: "blue" },
  { value: "4", label: "Niet beschikbaar", active: true, color: "gray" },
  { value: "5", label: "Transport aanvraag", active: true, color: "light-blue" },
  { value: "6", label: "Spraak aanvraag", active: true, color: "orange" },
  { value: "7", label: "Spraak aanvraag urgent", active: true, color: "red" },
  { value: "8", label: "Niet beschikbaar", active: false, color: "amber" }
];

const SIDE_TASK_DEFINITIONS = {
  DSI: {
    key: "DSI",
    slug: "dsi",
    label: "DSI",
    displayName: "Dienst Speciale Interventies",
    allowAlias: true,
    specialties: [
      { label: "CLS", roleId: "1446494955718709338" },
      { label: "Breacher", roleId: "1446495161482874880" },
      { label: "EOD", roleId: "1446495214226112532" },
      { label: "EPS", roleId: "1446495437845561394" },
      { label: "ID", roleId: "1446495654292754432" },
      { label: "HS", roleId: "1446495690367696927" },
      { label: "LLW", roleId: "1485665237079293972" },
      { label: "MT", roleId: "1492878352502099968" }
    ]
  },
  HRB: {
    key: "HRB",
    slug: "hrb",
    label: "HRB",
    displayName: "Hoog Risico Beveiliging",
    allowAlias: false,
    specialties: [
      { label: "Konvooi", roleId: "1504458999439954090" },
      { label: "Breach", roleId: "1504459148186615918" },
      { label: "BOT", roleId: "1505600925530718398" }
    ]
  },
  KLU: {
    key: "KLU",
    slug: "klu",
    label: "KLu",
    displayName: "Koninklijke Luchtmacht",
    allowAlias: false,
    specialties: [
      { label: "298", roleId: "1486813167899381811" },
      { label: "299", roleId: "1487158218051424348" },
      { label: "300", roleId: "1504953237399277759" },
      { label: "301", roleId: "1486813322597634281" },
      { label: "302", roleId: "1486813376641241181" },
      { label: "322", roleId: "1486813468047835176" },
      { label: "334", roleId: "1486813884835692657" }
    ]
  },
  DNR: {
    key: "DNR",
    slug: "dnr",
    label: "DNR",
    displayName: "Dienst Nationale Recherche",
    allowAlias: false,
    specialties: []
  }
};

function splitIds(value) {
  return String(value || "")
    .split(/[,\s;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function roleEnv(taskKey, suffix) {
  return splitIds(process.env[`SIDE_TASK_${taskKey}_${suffix}_ROLE_IDS`]);
}

function devDiscordIds() {
  return splitIds(process.env.SIDE_TASK_DEV_DISCORD_IDS || process.env.DEV_DISCORD_IDS || "");
}

function hostnameForTask(task) {
  const explicit = process.env[`SIDE_TASK_${task.key}_HOSTNAME`];
  if (explicit) return explicit.toLowerCase();
  const baseDomain = String(process.env.SIDE_TASK_BASE_DOMAIN || "orpoverheid.nl").trim().toLowerCase();
  return `${task.slug}.${baseDomain}`;
}

function sideTaskWithRuntimeConfig(task) {
  const specialtyRoleIds = task.specialties.map((specialty) => specialty.roleId);
  return {
    ...task,
    hostname: hostnameForTask(task),
    roleIds: {
      members: roleEnv(task.key, "MEMBER"),
      leadership: roleEnv(task.key, "LEADERSHIP"),
      subleadership: roleEnv(task.key, "SUBLEADERSHIP"),
      specialties: specialtyRoleIds
    }
  };
}

function allSideTasks() {
  return Object.values(SIDE_TASK_DEFINITIONS).map(sideTaskWithRuntimeConfig);
}

function sideTaskForKey(key) {
  const task = SIDE_TASK_DEFINITIONS[String(key || "").trim().toUpperCase()];
  return task ? sideTaskWithRuntimeConfig(task) : null;
}

function sideTaskForHost(host) {
  const normalizedHost = String(host || "").split(":")[0].toLowerCase();
  return allSideTasks().find((task) => task.hostname.split(":")[0] === normalizedHost) || null;
}

function hasAnyRole(memberRoles, roleIds) {
  const roles = new Set((memberRoles || []).map(String));
  return (roleIds || []).some((roleId) => roles.has(String(roleId)));
}

function specialtiesForRoles(task, memberRoles) {
  const roles = new Set((memberRoles || []).map(String));
  return (task.specialties || [])
    .filter((specialty) => roles.has(String(specialty.roleId)))
    .map((specialty) => specialty.label);
}

function permissionsForTask(task, memberRoles, discordId) {
  const roleIds = task.roleIds || {};
  const isDev = hasAnyRole([discordId], devDiscordIds());
  const hasMemberRole = hasAnyRole(memberRoles, roleIds.members);
  const hasLeadershipRole = hasAnyRole(memberRoles, roleIds.leadership);
  const hasSubleadershipRole = hasAnyRole(memberRoles, roleIds.subleadership);
  const hasSpecialtyRole = hasAnyRole(memberRoles, roleIds.specialties);
  const canManageMembers = isDev || hasLeadershipRole || hasSubleadershipRole;
  return {
    isDev,
    hasAccess: isDev || canManageMembers || hasMemberRole || hasSpecialtyRole,
    canManageMembers,
    canUseAlias: task.allowAlias,
    roles: {
      member: hasMemberRole,
      leadership: hasLeadershipRole,
      subleadership: hasSubleadershipRole,
      specialty: hasSpecialtyRole
    }
  };
}

function statusOption(value) {
  return SIDE_TASK_STATUS_OPTIONS.find((option) => option.value === String(value)) || SIDE_TASK_STATUS_OPTIONS[7];
}

module.exports = {
  SIDE_TASK_STATUS_OPTIONS,
  allSideTasks,
  sideTaskForKey,
  sideTaskForHost,
  splitIds,
  hasAnyRole,
  specialtiesForRoles,
  permissionsForTask,
  statusOption,
  devDiscordIds
};
