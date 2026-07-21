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
    slug: "lr",
    hostAliases: ["dnr"],
    label: "LR",
    displayName: "Landelijke Recherche",
    logoUrl: "/assets/politie-logo.png",
    roleDefaults: {
      members: ["1485659456837783744"]
    },
    allowAlias: true,
    aliasProfile: {
      numberLabel: "LR eenheid",
      numberPlaceholder: "Kies eenheid",
      aliasLabel: "Schuilnaam",
      aliasPlaceholder: "Schuilnaam",
      aliasRequiredForActive: false,
      numberSource: "unit",
      nicknameTemplate: "[{number} - ※] {name}",
      supportsUndercover: false
    },
    dnrUnits: [
      {
        key: "technical",
        label: "Technische Recherche",
        prefix: "11",
        capacity: 2,
        requiresAlias: false,
        roleIds: ["1485659765429501982"],
        leadershipRoleIds: ["1485659279263273091"],
        leadershipNumber: "11-00",
      },
      {
        key: "tactical",
        label: "Tactische Recherche",
        prefix: "12",
        capacity: 2,
        requiresAlias: true,
        roleIds: ["1485659805673586688"],
        leadershipRoleIds: ["1485659407277752482"],
        leadershipNumber: "12-00"
      },
      {
        key: "unit-six",
        label: "UNIT SIX",
        prefix: "13",
        capacity: 2,
        requiresAlias: true,
        roleIds: ["1506721224062144722", "1506721133100007615", "1506720813099778229"],
        leadershipRoleIds: ["1506720813099778229"],
        leadershipNumber: "13-00"
      }
    ],
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

function envKeyPart(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function configuredRoleIds(taskKey, suffix, fallback = []) {
  const configured = roleEnv(taskKey, suffix);
  return configured.length ? configured : (Array.isArray(fallback) ? fallback.map(String).filter(Boolean) : splitIds(fallback));
}

function dnrUnitsWithRuntimeConfig(task) {
  return (task.dnrUnits || []).map((unit) => ({
    ...unit,
    roleIds: configuredRoleIds(task.key, `UNIT_${envKeyPart(unit.key)}`, unit.roleIds || []),
    leadershipRoleIds: configuredRoleIds(task.key, `UNIT_${envKeyPart(unit.key)}_LEADERSHIP`, unit.leadershipRoleIds || [])
  }));
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

function hostnameAliasesForTask(task) {
  const baseDomain = String(process.env.SIDE_TASK_BASE_DOMAIN || "orpoverheid.nl").trim().toLowerCase();
  const configured = splitIds(process.env[`SIDE_TASK_${task.key}_HOST_ALIASES`] || "");
  const defaultAliases = [
    `${task.slug}.${baseDomain}`,
    ...(task.hostAliases || []).map((slug) => `${slug}.${baseDomain}`)
  ];
  return [...new Set([...configured, ...defaultAliases].map((host) => String(host || "").trim().toLowerCase()).filter(Boolean))];
}

function sideTaskWithRuntimeConfig(task) {
  const specialtyRoleIds = task.specialties.map((specialty) => specialty.roleId);
  const acoRoleIds = roleEnv(task.key, "ACO");
  const tcoRoleIds = roleEnv(task.key, "TCO");
  const dnrUnits = dnrUnitsWithRuntimeConfig(task);
  const dnrUnitRoleIds = dnrUnits.flatMap((unit) => [
    ...(unit.roleIds || []),
    ...(unit.leadershipRoleIds || [])
  ]);
  const hostname = hostnameForTask(task);
  const runtimeTask = {
    ...task,
    hostname,
    hostnames: [...new Set([hostname, ...hostnameAliasesForTask(task)])],
    roleIds: {
      members: configuredRoleIds(task.key, "MEMBER", task.roleDefaults?.members || []),
      leadership: configuredRoleIds(task.key, "LEADERSHIP", task.roleDefaults?.leadership || []),
      subleadership: configuredRoleIds(task.key, "SUBLEADERSHIP", task.roleDefaults?.subleadership || []),
      aco: acoRoleIds.length ? acoRoleIds : [task.commandRoleDefaults?.ACO].filter(Boolean),
      tco: tcoRoleIds.length ? tcoRoleIds : [task.commandRoleDefaults?.TCO].filter(Boolean),
      specialties: specialtyRoleIds,
      dnrUnits: dnrUnitRoleIds
    }
  };
  if (dnrUnits.length) runtimeTask.dnrUnits = dnrUnits;
  return runtimeTask;
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
  return allSideTasks().find((task) => (task.hostnames || [task.hostname]).some((hostname) => hostname.split(":")[0] === normalizedHost)) || null;
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
    ...(roleIds.tco || []),
    ...(roleIds.dnrUnits || [])
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
  const hasDnrUnitRole = task.key === "DNR" && hasAnyRole(memberRoles, roleIds.dnrUnits);
  const dnrLeadershipRoleIds = task.key === "DNR"
    ? (task.dnrUnits || []).flatMap((unit) => unit.leadershipRoleIds || [])
    : [];
  const hasDnrUnitLeadershipRole = task.key === "DNR" && hasAnyRole(memberRoles, dnrLeadershipRoleIds);
  const canManageMembers = isDev || hasLeadershipRole || hasSubleadershipRole;
  const canManageDsiUnits = task.key === "DSI" && (canManageMembers || hasAcoRole || hasTcoRole);
  const canAssignDsiCommand = task.key === "DSI" && (canManageMembers || hasMemberRole || hasAcoRole || hasTcoRole);
  const canManageDnrUnits = task.key === "DNR" && (canManageMembers || hasDnrUnitLeadershipRole);
  return {
    isDev,
    hasAccess: isDev || canManageMembers || hasAcoRole || hasTcoRole || hasMemberRole || hasSpecialtyRole || hasDnrUnitRole,
    canManageMembers,
    canManageDsiUnits,
    canAssignDsiCommand,
    canManageDnrUnits,
    canSignOffDnrMembers: canManageDnrUnits,
    canUseAlias: task.allowAlias,
    roles: {
      member: hasMemberRole,
      leadership: hasLeadershipRole,
      subleadership: hasSubleadershipRole,
      aco: hasAcoRole,
      tco: hasTcoRole,
      specialty: hasSpecialtyRole,
      dnrUnit: hasDnrUnitRole,
      dnrUnitLeadership: hasDnrUnitLeadershipRole
    }
  };
}

function dnrUnitsForRoles(task, memberRoles, discordId) {
  if (task?.key !== "DNR") return task?.dnrUnits || [];
  const permissions = permissionsForTask(task, memberRoles, discordId);
  if (permissions.isDev || permissions.canManageMembers) return task.dnrUnits || [];
  return (task.dnrUnits || []).filter((unit) => hasAnyRole(memberRoles, [
    ...(unit.roleIds || []),
    ...(unit.leadershipRoleIds || [])
  ]));
}

function canUseDnrUnit(task, memberRoles, discordId, unitKey) {
  const key = String(unitKey || "").trim();
  if (task?.key !== "DNR") return true;
  if (!key) return false;
  return dnrUnitsForRoles(task, memberRoles, discordId).some((unit) => unit.key === key);
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
  dnrUnitsForRoles,
  canUseDnrUnit,
  statusOption,
  statusOptionsForTask,
  devDiscordIds
};
