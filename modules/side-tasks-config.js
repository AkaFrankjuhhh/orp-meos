const SIDE_TASK_STATUS_OPTIONS = [
  { value: "0", label: "Aanmelden", active: false, color: "blue" },
  { value: "1", label: "Aanwezig", active: true, color: "green" },
  { value: "4", label: "Afwezig", active: false, color: "amber" },
  { value: "8", label: "Uit dienst melden", active: false, color: "gray" }
];

const SIDE_TASK_DEFINITIONS = {
  DSI: {
    key: "DSI",
    slug: "dsi",
    label: "DSI",
    displayName: "Dienst Speciale Interventies",
    logoUrl: "/assets/dsi-logo.png",
    allowAlias: true,
    dsiUnits: {
      prefix: "50",
      min: 3,
      max: 99,
      capacity: 3,
      commandUnits: { TCO: "50-01", ACO: "50-02" }
    },
    commandRoleDefaults: {
      ACO: "1517546277913628695",
      TCO: "1517546225715380494"
    },
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
    logoUrl: "/assets/hrb-logo.png",
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
    logoUrl: "/assets/klu-logo.png",
    allowAlias: true,
    aliasProfile: {
      numberLabel: "KLu roepnummer",
      numberPlaceholder: "Eagle 1",
      aliasLabel: "Schuilnaam",
      aliasPlaceholder: "Naam",
      aliasRequiredForActive: true,
      numberSource: "rank",
      nicknameTemplate: "[{number}] {name}",
      rankNumbers: {
        "Generaal": { number: "1", roleId: "1516830107711307867" },
        "Luitenant Generaal": { number: "2", roleId: "1487005041154850837" },
        "Majoor": { number: "3", roleId: "1487005030664900708" },
        "Kapitein": { number: "4", roleId: "1487005042631376946" },
        "Sergeant": { number: "5", roleId: "1487005047177871421" },
        "Korporaal der 1e klasse": { number: "6", roleId: "1487005047979114546" },
        "Korporaal": { number: "7", roleId: "1487005582845153280" },
        "Soldaat der 1e klasse": { number: "8", roleId: "1487005583654649856" },
        "Soldaat der 2de klasse": { number: "9", roleId: "1487005584392982549" }
      }
    },
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
    logoUrl: "/assets/politie-logo.png",
    allowAlias: true,
    aliasProfile: {
      numberLabel: "DNR nummer",
      numberPlaceholder: "DNR-01",
      aliasLabel: "Schuilnaam",
      aliasPlaceholder: "Schuilnaam",
      aliasRequiredForActive: false,
      numberPattern: "^DNR-\\d{2,3}$",
      numberPatternHint: "Gebruik formaat DNR-01, DNR-02, DNR-03.",
      nicknameTemplate: "[{number}] {name}",
      supportsUndercover: true
    },
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
  const acoRoleIds = roleEnv(task.key, "ACO");
  const tcoRoleIds = roleEnv(task.key, "TCO");
  return {
    ...task,
    hostname: hostnameForTask(task),
    roleIds: {
      members: roleEnv(task.key, "MEMBER"),
      leadership: roleEnv(task.key, "LEADERSHIP"),
      subleadership: roleEnv(task.key, "SUBLEADERSHIP"),
      aco: acoRoleIds.length ? acoRoleIds : [task.commandRoleDefaults?.ACO].filter(Boolean),
      tco: tcoRoleIds.length ? tcoRoleIds : [task.commandRoleDefaults?.TCO].filter(Boolean),
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

function hasMembershipRole(task, memberRoles) {
  const roleIds = task?.roleIds || {};
  return hasAnyRole(memberRoles, [
    ...(roleIds.members || []),
    ...(roleIds.leadership || []),
    ...(roleIds.subleadership || []),
    ...(roleIds.specialties || []),
    ...(roleIds.aco || []),
    ...(roleIds.tco || [])
  ]);
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
  const hasAcoRole = hasAnyRole(memberRoles, roleIds.aco);
  const hasTcoRole = hasAnyRole(memberRoles, roleIds.tco);
  const hasSpecialtyRole = hasAnyRole(memberRoles, roleIds.specialties);
  const canManageMembers = isDev || hasLeadershipRole || hasSubleadershipRole;
  const canManageDsiUnits = task.key === "DSI" && (canManageMembers || hasAcoRole || hasTcoRole);
  return {
    isDev,
    hasAccess: isDev || canManageMembers || hasAcoRole || hasTcoRole || hasMemberRole || hasSpecialtyRole,
    canManageMembers,
    canManageDsiUnits,
    canAssignDsiCommand: task.key === "DSI" && canManageMembers,
    canUseAlias: task.allowAlias,
    roles: {
      member: hasMemberRole,
      leadership: hasLeadershipRole,
      subleadership: hasSubleadershipRole,
      aco: hasAcoRole,
      tco: hasTcoRole,
      specialty: hasSpecialtyRole
    }
  };
}

function statusOption(value) {
  return SIDE_TASK_STATUS_OPTIONS.find((option) => option.value === String(value)) || SIDE_TASK_STATUS_OPTIONS[1];
}

function statusOptionsForTask(task) {
  return task?.key === "DSI"
    ? SIDE_TASK_STATUS_OPTIONS
    : SIDE_TASK_STATUS_OPTIONS.filter((option) => option.value !== "0");
}

module.exports = {
  SIDE_TASK_STATUS_OPTIONS,
  allSideTasks,
  sideTaskForKey,
  sideTaskForHost,
  splitIds,
  hasAnyRole,
  hasMembershipRole,
  specialtiesForRoles,
  permissionsForTask,
  statusOption,
  statusOptionsForTask,
  devDiscordIds
};
