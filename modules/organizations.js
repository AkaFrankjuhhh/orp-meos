const crypto = require("node:crypto");

const defensieRanks = [
  "Luitenant-Generaal",
  "Generaal-Majoor",
  "Brigade-Generaal",
  "Kolonel",
  "Luitenant-Kolonel",
  "Majoor",
  "Kapitein",
  "Eerste-Luitenant",
  "Tweede-Luitenant",
  "Kornet",
  "Adjudant",
  "Opperwachtmeester",
  "Wachtmeester 1ste Klasser",
  "Wachtmeester",
  "Marechaussee 1ste Klasser",
  "Marechaussee 2de Klasser",
  "Marechaussee 3de Klasser",
  "Marechaussee 4de Klasser"
];

const politieRanks = [
  "Eerste hoofdcommissaris",
  "Hoofdcommissaris",
  "Commissaris",
  "Hoofdinspecteur",
  "Inspecteur",
  "Brigadier",
  "Hoofdagent",
  "Agent",
  "Surveillant",
  "Aspirant"
];

const defaultMentorChecklistGroups = [
  {
    title: "Praktijk",
    items: [
      "Leerling kent de rechten van een verdachte",
      "Leerling kan rustig handelen tijdens een incident",
      "Leerling weet hoe een verdachte staande gehouden wordt",
      "Leerling weet hoe een verdachte aangehouden wordt",
      "Leerling kan een BTGV uitvoeren",
      "Leerling kan zich professioneel opstellen",
      "Leerling heeft zijn vuurwapen op een correcte manier gebruikt"
    ]
  },
  {
    title: "Theorie",
    items: [
      "Leerling weet hoe MEOS werkt",
      "Leerling weet hoe een I8 ingevuld moet worden",
      "Leerling kan bewijzen opstellen",
      "Leerling kent de geweldsladder",
      "Leerling kent de douane gebieden",
      "Leerling kent de discord"
    ]
  }
];

const politieMentorChecklistGroups = [
  {
    title: "Basis Politiewerk",
    items: [
      "Kennis van rangen en hi\u00ebrarchie binnen het korps",
      "Correct aanspreken van collega's en burgers",
      "Basisuitrusting kennen en gebruiken",
      "Dienst starten en eindigen volgens procedure",
      "Gebruik van dienstvoertuigen begrijpen"
    ]
  },
  {
    title: "Communicatie & Porto",
    items: [
      "Porto correct gebruiken (call signs, meldingen)",
      "Korte en duidelijke communicatie via de radio",
      "Prioriteiten (prio 1, 2, 3) correct toepassen",
      "Back-up aanvragen op de juiste manier",
      "OPCO/OVD-P communicatie begrijpen"
    ]
  },
  {
    title: "Wetten & Procedures",
    items: [
      "Basiskennis van wetgeving (boetes, misdrijven)",
      "Staandehouding correct uitvoeren",
      "Fouilleren volgens procedure",
      "Aanhouding correct uitvoeren",
      "Rechten van een verdachte benoemen"
    ]
  },
  {
    title: "Praktische Handelingen",
    items: [
      "Verkeerscontroles uitvoeren",
      "Boetes uitschrijven (juiste reden & bedrag)",
      "Voertuigen controleren (papieren, kenteken)",
      "Gebruik van handboeien en transport",
      "Verdachte veilig vervoeren naar bureau"
    ]
  },
  {
    title: "Achtervolging & Nood",
    items: [
      "Basis achtervolgingstechnieken begrijpen",
      "Wegblokkades correct neerzetten",
      "Tactisch rijden tijdens achtervolgingen",
      "Handelen bij gewapende situaties",
      "Samenwerken bij grote incidenten"
    ]
  }
];

const defensieExtraTasks = [
  "Interne-Zaken",
  "OvJ",
  "hOvJ",
  "Trainer",
  "Mentor",
  "W&S",
  "Mentor-Leiding",
  "OTC-Leiding",
  "W&S-Leiding",
  "IZ-Leiding",
  "Trainer-Leiding",
  "DSI-Leiding",
  "DSI",
  "KLu-Leiding",
  "KLu",
  "DNR-Leiding",
  "DNR",
  "HRB-Leiding",
  "HRB"
];

const defensieSideTaskBadges = ["DSI-Leiding", "DSI", "KLu-Leiding", "KLu", "DNR-Leiding", "DNR", "HRB-Leiding", "HRB"];
const politieSideTaskBadges = ["DSI-Leiding", "DSI", "KLu-Leiding", "KLu", "DNR-Leiding", "DNR", "ME-Leiding", "ME"];

const politieExtraTasks = [
  "OvJ",
  "hOvJ",
  "Trainer",
  "Mentor",
  "W&S",
  "Mentor-Leiding",
  "OTC-Leiding",
  "W&S-Leiding",
  "Trainer-Leiding",
  ...politieSideTaskBadges
];

const disciplineTypes = {
  "regular-warning": { label: "Officiële Waarschuwing", tone: "warning" },
  "regular-strike": { label: "Strike", tone: "strike" },
  "i8-warning": { label: "I8 Waarschuwing", tone: "i8-warning" },
  "i8-strike": { label: "I8 Strike", tone: "i8-strike" }
};

const defensieNicknameSymbols = {
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

const politieNicknameSymbols = {
  "Eerste hoofdcommissaris": "\u2759\u2737\u2737\u2737",
  Hoofdcommissaris: "\u2759\u2737\u2737",
  Commissaris: "\u2759\u2737",
  Hoofdinspecteur: "I\u2655",
  Inspecteur: "\u2655",
  Brigadier: "\u2725",
  Hoofdagent: "IIII",
  Agent: "III",
  Surveillant: "II",
  Aspirant: "I"
};

const commonDistinctions = [
  { type: "Bronze diensttijdster", tone: "bronze", months: 1.5 },
  { type: "Zilveren diensttijdster", tone: "silver", months: 3 },
  { type: "Gouden diensttijdster", tone: "gold", months: 6 },
  { type: "Diamanten diensttijdster", tone: "diamond", months: 12 }
];

const organizationConfigs = {
  defensie: {
    key: "defensie",
    label: "Defensie",
    portalTitle: "Defensie Personeelsportaal",
    portalSubtitle: "Defensie Oranjestad",
    requiredRoleLabel: "Defensie",
    ranks: defensieRanks,
    defaultRecruitRank: "Marechaussee 4de Klasser",
    rankCategories: [
      { title: "Kader", serviceRange: "70-01 t/m 70-05", ranks: ["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"] },
      { title: "Hoofd-Officieren", serviceRange: "71-01 t/m 71-15", ranks: ["Kolonel", "Luitenant-Kolonel", "Majoor"] },
      { title: "Officieren", serviceRange: "72-01 t/m 72-50", ranks: ["Kapitein", "Eerste-Luitenant", "Tweede-Luitenant", "Kornet"] },
      { title: "Onderofficieren", serviceRange: "73-01 t/m 73-75", ranks: ["Adjudant", "Opperwachtmeester", "Wachtmeester 1ste Klasser", "Wachtmeester"] },
      { title: "Manschappen", serviceRange: "74-01 t/m 74-100", ranks: ["Marechaussee 1ste Klasser", "Marechaussee 2de Klasser", "Marechaussee 3de Klasser", "Marechaussee 4de Klasser"] }
    ],
    serviceNumberGroups: [
      { prefix: "70", min: 1, max: 5, ranks: ["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"], autoSort: true },
      { prefix: "71", min: 1, max: 15, ranks: ["Kolonel", "Luitenant-Kolonel", "Majoor"], autoSort: true },
      { prefix: "72", min: 1, max: 50, ranks: ["Kapitein", "Eerste-Luitenant", "Tweede-Luitenant", "Kornet"], autoSort: true },
      { prefix: "73", min: 1, max: 75, ranks: ["Adjudant", "Opperwachtmeester", "Wachtmeester 1ste Klasser", "Wachtmeester"] },
      { prefix: "74", min: 1, max: 100, ranks: ["Marechaussee 1ste Klasser", "Marechaussee 2de Klasser", "Marechaussee 3de Klasser", "Marechaussee 4de Klasser"] }
    ],
    profileTrainings: ["BKV", "Mentor-Traject", "IBT", "TMO", "SIV", "ZULU", "OGM", "KW", "SMG"],
    profileOperational: ["OPS", "OPCO", "OVD"],
    extraTasks: defensieExtraTasks,
    extraFunctions: ["Kader", "Overheidscoördinator", "Hoofdofficier", "Officiersraad"],
    sideTaskBadges: defensieSideTaskBadges,
    restrictedTaskBadges: defensieSideTaskBadges,
    mentorRanks: ["Marechaussee 4de Klasser", "Marechaussee 3de Klasser", "Marechaussee 2de Klasser"],
    mentorTrainingName: "Mentor-Traject",
    mentorChecklistGroups: defaultMentorChecklistGroups,
    mentorChecklistCount: 13,
    rankTrainingRequirements: {
      "Marechaussee 4de Klasser": ["BKV"],
      "Marechaussee 3de Klasser": ["BKV", "IBT"],
      "Marechaussee 2de Klasser": ["BKV", "IBT", "Mentor-Traject"],
      "Marechaussee 1ste Klasser": ["BKV", "IBT", "Mentor-Traject", "KW"],
      Wachtmeester: ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO"],
      "Wachtmeester 1ste Klasser": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO"],
      Opperwachtmeester: ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO", "SIV"],
      "Eerste-Luitenant": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO", "SIV", "OGM"],
      Majoor: ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO", "SIV", "OGM", "SMG"]
    },
    autoFunctionByRanks: [
      { label: "Kader", ranks: ["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"] },
      { label: "Hoofdofficier", ranks: ["Kolonel", "Luitenant-Kolonel", "Majoor"] }
    ],
    permissionAliases: {
      kader: ["Kader"],
      viewAsKader: ["Kader", "Overheidscoördinator"],
      hoofdofficier: ["Hoofdofficier"],
      officiersraad: ["Officiersraad"]
    },
    permissions: {
      personnelRankMode: "defensie",
      i8ReviewMode: "defensie"
    },
    rankColors: {
      "Luitenant-Generaal": "#e17000",
      "Generaal-Majoor": "#ff8a00",
      "Brigade-Generaal": "#f6b15a",
      Kolonel: "#0e3d6e",
      "Luitenant-Kolonel": "#2d638f",
      Majoor: "#4f86b1",
      Kapitein: "#6f42c1",
      "Eerste-Luitenant": "#8b5cf6",
      "Tweede-Luitenant": "#a78bfa",
      Kornet: "#c4b5fd",
      Adjudant: "#0f766e",
      Opperwachtmeester: "#14b8a6",
      "Wachtmeester 1ste Klasser": "#5eead4",
      Wachtmeester: "#99f6e4",
      "Marechaussee 1ste Klasser": "#b45309",
      "Marechaussee 2de Klasser": "#d97706",
      "Marechaussee 3de Klasser": "#f59e0b",
      "Marechaussee 4de Klasser": "#fbbf24"
    },
    discord: {
      mainRole: { envKey: "DISCORD_DEFENSIE_ROLE_ID" },
      functionRoleMappings: [
        { key: "kader", label: "Kader", envKey: "DISCORD_KADER_ROLE_ID", stateKey: "kaderRoleId" },
        { key: "overheidscoordinator", label: "Overheidscoördinator", envKey: "DISCORD_OVERHEIDSCOORDINATOR_ROLE_ID", stateKey: "overheidsCoordinatorRoleId" },
        { key: "hoofdofficier", label: "Hoofdofficier", envKey: "DISCORD_HOOFDOFFICIER_ROLE_ID", stateKey: "hoofdofficierRoleId" },
        { key: "officiersraad", label: "Officiersraad", envKey: "DISCORD_OFFICIERSRAAD_ROLE_ID", stateKey: "officiersraadRoleId" }
      ],
      taskRoleMappings: [
        { key: "interne-zaken", label: "Interne-Zaken", envKey: "DISCORD_INTERNE_ZAKEN_ROLE_ID" },
        { key: "ovj", label: "OvJ", envKey: "DISCORD_OVJ_ROLE_ID" },
        { key: "hovj", label: "hOvJ", envKey: "DISCORD_HOVJ_ROLE_ID" },
        { key: "trainer", label: "Trainer", envKey: "DISCORD_TRAINER_ROLE_ID" },
        { key: "mentor", label: "Mentor", envKey: "DISCORD_MENTOR_ROLE_ID" },
        { key: "w-s", label: "W&S", envKey: "DISCORD_WS_ROLE_ID" }
      ],
      rankRoleEnvKeys: {
        "Luitenant-Generaal": "DISCORD_RANK_LUITENANT_GENERAAL_ROLE_ID",
        "Generaal-Majoor": "DISCORD_RANK_GENERAAL_MAJOOR_ROLE_ID",
        "Brigade-Generaal": "DISCORD_RANK_BRIGADE_GENERAAL_ROLE_ID",
        Kolonel: "DISCORD_RANK_KOLONEL_ROLE_ID",
        "Luitenant-Kolonel": "DISCORD_RANK_LUITENANT_KOLONEL_ROLE_ID",
        Majoor: "DISCORD_RANK_MAJOOR_ROLE_ID",
        Kapitein: "DISCORD_RANK_KAPITEIN_ROLE_ID",
        "Eerste-Luitenant": "DISCORD_RANK_EERSTE_LUITENANT_ROLE_ID",
        "Tweede-Luitenant": "DISCORD_RANK_TWEEDE_LUITENANT_ROLE_ID",
        Kornet: "DISCORD_RANK_KORNET_ROLE_ID",
        Adjudant: "DISCORD_RANK_ADJUDANT_ROLE_ID",
        Opperwachtmeester: "DISCORD_RANK_OPPERWACHTMEESTER_ROLE_ID",
        "Wachtmeester 1ste Klasser": "DISCORD_RANK_WACHTMEESTER_1STE_KLASSER_ROLE_ID",
        Wachtmeester: "DISCORD_RANK_WACHTMEESTER_ROLE_ID",
        "Marechaussee 1ste Klasser": "DISCORD_RANK_MARECHAUSSEE_1STE_KLASSER_ROLE_ID",
        "Marechaussee 2de Klasser": "DISCORD_RANK_MARECHAUSSEE_2DE_KLASSER_ROLE_ID",
        "Marechaussee 3de Klasser": "DISCORD_RANK_MARECHAUSSEE_3DE_KLASSER_ROLE_ID",
        "Marechaussee 4de Klasser": "DISCORD_RANK_MARECHAUSSEE_4DE_KLASSER_ROLE_ID"
      },
      qualificationRoleMappings: {
        BKV: { envKey: "DISCORD_MEOS_ROLE_ID", defaultRoleId: "1425931664877551708", label: "MEOS" },
        OPS: { envKey: "DISCORD_OPS_ROLE_ID", defaultRoleId: "1423790817738227864", label: "OPS" },
        OPCO: { envKey: "DISCORD_OPCO_ROLE_ID", defaultRoleId: "1424523638526185513", label: "OPCO" }
      },
      nicknameSymbols: defensieNicknameSymbols,
      portoOperatorLabel: "OPS"
    },
    porto: {
      operatorLabel: "OPS",
      operatorTraining: "OPS",
      operatorVehicleNumber: "30-00",
      operatorVehicleCode: "OPS",
      operatorVehicleType: "OPS",
      operatorVehicleName: "OPS",
      lockTitle: "Defensie Porto-Systeem",
      lockSubtitle: "Defensie Oranjestad",
      lockText: "Alleen aangemelde Defensie leden met een gekoppeld Defensie Personeelsportaal-profiel kunnen het Porto-Systeem openen."
    }
  },
  politie: {
    key: "politie",
    label: "Politie",
    portalTitle: "Politie Personeelsportaal",
    portalSubtitle: "Politie Oranjestad",
    requiredRoleLabel: "Politie",
    ranks: politieRanks,
    defaultRecruitRank: "Aspirant",
    rankCategories: [
      { title: "Korpsleiding", serviceRange: "21-01 t/m 21-05", ranks: ["Eerste hoofdcommissaris", "Hoofdcommissaris", "Commissaris"], ranges: [{ prefix: "21", min: 1, max: 5 }] },
      { title: "Bestuur", serviceRange: "21-06 t/m 21-16", ranks: ["Hoofdinspecteur", "Inspecteur"], ranges: [{ prefix: "21", min: 6, max: 16 }] },
      { title: "Brigadier", serviceRange: "21-17 t/m 21-27", ranks: ["Brigadier"], ranges: [{ prefix: "21", min: 17, max: 27 }] },
      { title: "Brigadier", serviceRange: "22-17 t/m 22-27", ranks: ["Brigadier"], ranges: [{ prefix: "22", min: 17, max: 27 }] },
      { title: "Hoofdagent", serviceRange: "21-28 t/m 21-48", ranks: ["Hoofdagent"], ranges: [{ prefix: "21", min: 28, max: 48 }] },
      { title: "Hoofdagent", serviceRange: "22-28 t/m 22-48", ranks: ["Hoofdagent"], ranges: [{ prefix: "22", min: 28, max: 48 }] },
      { title: "Agent", serviceRange: "21-49 t/m 21-70", ranks: ["Agent"], ranges: [{ prefix: "21", min: 49, max: 70 }] },
      { title: "Agent", serviceRange: "22-49 t/m 22-70", ranks: ["Agent"], ranges: [{ prefix: "22", min: 49, max: 70 }] },
      { title: "Surveillant", serviceRange: "21-71 t/m 21-86", ranks: ["Surveillant"], ranges: [{ prefix: "21", min: 71, max: 86 }] },
      { title: "Surveillant", serviceRange: "22-71 t/m 22-86", ranks: ["Surveillant"], ranges: [{ prefix: "22", min: 71, max: 86 }] },
      { title: "Aspirant", serviceRange: "21-87 t/m 21-99", ranks: ["Aspirant"], ranges: [{ prefix: "21", min: 87, max: 99 }] },
      { title: "Aspirant", serviceRange: "22-87 t/m 22-99", ranks: ["Aspirant"], ranges: [{ prefix: "22", min: 87, max: 99 }] }
    ],
    serviceNumberGroups: [
      { prefix: "21", min: 1, max: 5, ranks: ["Eerste hoofdcommissaris", "Hoofdcommissaris", "Commissaris"], autoSort: true },
      { prefix: "21", min: 6, max: 16, ranks: ["Hoofdinspecteur", "Inspecteur"], autoSort: true },
      { prefix: "21", min: 17, max: 27, ranks: ["Brigadier"], autoSort: true },
      { prefix: "22", min: 17, max: 27, ranks: ["Brigadier"], autoSort: true },
      { prefix: "21", min: 28, max: 48, ranks: ["Hoofdagent"], autoSort: true },
      { prefix: "22", min: 28, max: 48, ranks: ["Hoofdagent"], autoSort: true },
      { prefix: "21", min: 49, max: 70, ranks: ["Agent"], autoSort: true },
      { prefix: "22", min: 49, max: 70, ranks: ["Agent"], autoSort: true },
      { prefix: "21", min: 71, max: 86, ranks: ["Surveillant"] },
      { prefix: "22", min: 71, max: 86, ranks: ["Surveillant"] },
      { prefix: "21", min: 87, max: 99, ranks: ["Aspirant"] },
      { prefix: "22", min: 87, max: 99, ranks: ["Aspirant"] }
    ],
    autoSortRanks: ["Eerste hoofdcommissaris", "Hoofdcommissaris", "Commissaris", "Hoofdinspecteur", "Inspecteur", "Brigadier", "Hoofdagent", "Agent"],
    profileTrainings: ["Basis", "NH", "IBT", "TLO", "OFF", "SIV", "TMO", "ZULU", "OGM"],
    profileOperational: ["OC", "OPCO", "OVD-P"],
    extraTasks: politieExtraTasks,
    extraFunctions: ["Korpsleiding", "Bestuur"],
    sideTaskBadges: politieSideTaskBadges,
    restrictedTaskBadges: politieSideTaskBadges,
    mentorRanks: ["Aspirant"],
    mentorTrainingName: "Mentor-Traject",
    mentorChecklistGroups: politieMentorChecklistGroups,
    mentorChecklistCount: 25,
    rankTrainingRequirements: {
      Surveillant: ["Basis"],
      Agent: ["Basis", "NH", "IBT"],
      Hoofdagent: ["Basis", "NH", "IBT"],
      Brigadier: ["Basis", "NH", "IBT"]
    },
    autoFunctionByRanks: [
      { label: "Korpsleiding", ranks: ["Eerste hoofdcommissaris", "Hoofdcommissaris", "Commissaris"] },
      { label: "Bestuur", ranks: ["Hoofdinspecteur", "Inspecteur"] }
    ],
    permissionAliases: {
      kader: ["Korpsleiding"],
      viewAsKader: ["Korpsleiding", "Bestuur"],
      hoofdofficier: ["Bestuur"],
      officiersraad: []
    },
    permissions: {
      personnelRankMode: "kaderOnly",
      i8ReviewMode: "ovjOnly",
      absenceReviewMode: "kaderAndHoofdofficier",
      officerManagementMode: "viewAndAbsenceOnly"
    },
    rankColors: {
      "Eerste hoofdcommissaris": "#e17000",
      Hoofdcommissaris: "#ff8a00",
      Commissaris: "#f6b15a",
      Hoofdinspecteur: "#0e3d6e",
      Inspecteur: "#2d638f",
      Brigadier: "#6f42c1",
      Hoofdagent: "#8b5cf6",
      Agent: "#14b8a6",
      Surveillant: "#d97706",
      Aspirant: "#fbbf24"
    },
    discord: {
      mainRole: { envKey: "DISCORD_POLITIE_ROLE_ID", defaultRoleId: "1423471185391255705" },
      functionRoleMappings: [
        { key: "korpsleiding", label: "Korpsleiding", envKey: "DISCORD_POLITIE_KORPSLEIDING_ROLE_ID", defaultRoleId: "1423471166495916052", stateKey: "korpsleidingRoleId" },
        { key: "bestuur", label: "Bestuur", envKey: "DISCORD_POLITIE_BESTUUR_ROLE_ID", defaultRoleId: "1425219424943865987", stateKey: "bestuurRoleId" }
      ],
      taskRoleMappings: [],
      rankRoleEnvKeys: {
        "Eerste hoofdcommissaris": "DISCORD_POLITIE_RANK_EERSTE_HOOFDCOMMISSARIS_ROLE_ID",
        Hoofdcommissaris: "DISCORD_POLITIE_RANK_HOOFDCOMMISSARIS_ROLE_ID",
        Commissaris: "DISCORD_POLITIE_RANK_COMMISSARIS_ROLE_ID",
        Hoofdinspecteur: "DISCORD_POLITIE_RANK_HOOFDINSPECTEUR_ROLE_ID",
        Inspecteur: "DISCORD_POLITIE_RANK_INSPECTEUR_ROLE_ID",
        Brigadier: "DISCORD_POLITIE_RANK_BRIGADIER_ROLE_ID",
        Hoofdagent: "DISCORD_POLITIE_RANK_HOOFDAGENT_ROLE_ID",
        Agent: "DISCORD_POLITIE_RANK_AGENT_ROLE_ID",
        Surveillant: "DISCORD_POLITIE_RANK_SURVEILLANT_ROLE_ID",
        Aspirant: "DISCORD_POLITIE_RANK_ASPIRANT_ROLE_ID"
      },
      qualificationRoleMappings: {
        Basis: { envKey: "DISCORD_POLITIE_MEOS_ROLE_ID", defaultRoleId: "1425715749862772818", label: "Politie MEOS" },
        OC: { envKey: "DISCORD_POLITIE_OC_ROLE_ID", defaultRoleId: "1424523648819003484", label: "OC" },
        OPCO: { envKey: "DISCORD_POLITIE_OPCO_ROLE_ID", defaultRoleId: "1424523648412155994", label: "OPCO" },
        "OVD-P": { envKey: "DISCORD_POLITIE_OVD_ROLE_ID", defaultRoleId: "1424523647816699996", label: "OVD-P" }
      },
      nicknameSymbols: politieNicknameSymbols,
      nicknameSymbolSeparator: " - ",
      portoOperatorLabel: "OC"
    },
    porto: {
      operatorLabel: "OC",
      operatorTraining: "OC",
      operatorVehicleNumber: "30-00",
      operatorVehicleCode: "OC",
      operatorVehicleType: "OC",
      operatorVehicleName: "OC",
      lockTitle: "Politie Porto-Systeem",
      lockSubtitle: "Politie Oranjestad",
      lockText: "Alleen aangemelde Politie leden met een gekoppeld Politie Personeelsportaal-profiel kunnen het Porto-Systeem openen."
    }
  }
};

function normalizeOrganizationKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (["politie", "police"].includes(key)) return "politie";
  return "defensie";
}

function currentOrganizationKey() {
  return normalizeOrganizationKey(process.env.ORP_ORGANIZATION || process.env.PORTAL_ORGANIZATION || process.env.ORGANIZATION || "defensie");
}

function currentOrganization() {
  return organizationConfigs[currentOrganizationKey()] || organizationConfigs.defensie;
}

function envOrDefault(envKey, defaultValue = "") {
  return String(process.env[envKey] || defaultValue || "").trim();
}

function organizationMainRoleId(config = currentOrganization()) {
  const mainRole = config.discord?.mainRole || {};
  return envOrDefault(mainRole.envKey, mainRole.defaultRoleId);
}

function serviceNumberGroupsForRank(config, rank) {
  const groups = (config.serviceNumberGroups || []).filter((group) => (group.ranks || []).includes(rank));
  return groups.length ? groups : [config.serviceNumberGroups?.[0] || { prefix: "00", min: 1, max: 999 }];
}

function serviceNumberGroupForRank(config, rank) {
  return serviceNumberGroupsForRank(config, rank)[0];
}

function rankWeightEntries(config = currentOrganization()) {
  return config.ranks.map((rank, index) => [rank, config.ranks.length - index]);
}

function defaultStateForOrganization(config = currentOrganization()) {
  const firstRank = config.ranks[0];
  const secondRank = config.ranks[Math.min(1, config.ranks.length - 1)];
  const thirdRank = config.ranks[Math.min(2, config.ranks.length - 1)];
  const firstGroup = serviceNumberGroupForRank(config, firstRank);
  const secondGroup = serviceNumberGroupForRank(config, secondRank);
  const thirdGroup = serviceNumberGroupForRank(config, thirdRank);
  return {
    theme: "dark",
    discord: {},
    people: [
      {
        id: crypto.randomUUID(),
        name: `${config.label} Leiding`,
        discordId: "100000000000000001",
        avatar: "",
        rank: firstRank,
        serviceNumber: `${firstGroup.prefix}-01`,
        permRole: config.permissionAliases?.kader?.[0] || "Kader",
        extraFunctions: [],
        hiredDate: "2026-01-01",
        rankDate: "2026-01-01",
        promotionDate: "2026-01-01",
        tasks: "Leiding, personeelszaken",
        completedTrainings: [],
        completedOperational: [],
        status: "Actief",
        rankHistory: [{ rank: firstRank, date: "2026-01-01", serviceNumber: `${firstGroup.prefix}-01` }]
      },
      {
        id: crypto.randomUUID(),
        name: `${config.label} Bestuur`,
        discordId: "100000000000000002",
        avatar: "",
        rank: secondRank,
        serviceNumber: `${secondGroup.prefix}-02`,
        permRole: config.permissionAliases?.hoofdofficier?.[0] || "Geen",
        extraFunctions: [],
        hiredDate: "2026-02-10",
        rankDate: "2026-02-10",
        promotionDate: "2026-02-10",
        tasks: "Operationele leiding",
        completedTrainings: [],
        completedOperational: [],
        status: "Actief",
        rankHistory: [{ rank: secondRank, date: "2026-02-10", serviceNumber: `${secondGroup.prefix}-02` }]
      },
      {
        id: crypto.randomUUID(),
        name: `${config.label} Medewerker`,
        discordId: "100000000000000003",
        avatar: "",
        rank: thirdRank,
        serviceNumber: `${thirdGroup.prefix}-03`,
        permRole: "Geen",
        extraFunctions: [],
        hiredDate: "2026-03-15",
        rankDate: "2026-03-15",
        promotionDate: "2026-03-15",
        tasks: "Training",
        completedTrainings: [],
        completedOperational: [],
        status: "Actief",
        rankHistory: [{ rank: thirdRank, date: "2026-03-15", serviceNumber: `${thirdGroup.prefix}-03` }]
      }
    ],
    hours: [],
    trainings: [],
    absences: [],
    i8Forms: [],
    resignationForms: [],
    blacklist: [],
    mentorChecklistGroups: config.mentorChecklistGroups,
    activity: [`${config.portalTitle} omgeving aangemaakt.`]
  };
}

function publicClientData(config = currentOrganization()) {
  const operatorLabel = config.porto?.operatorLabel || config.discord?.portoOperatorLabel || "OPS";
  return {
    organization: {
      key: config.key,
      label: config.label,
      portalTitle: config.portalTitle,
      portalSubtitle: config.portalSubtitle,
      requiredRoleLabel: config.requiredRoleLabel
    },
    ranks: config.ranks,
    defaultRecruitRank: config.defaultRecruitRank,
    rankCategories: config.rankCategories,
    serviceNumberGroups: config.serviceNumberGroups,
    today: new Date().toISOString().slice(0, 10),
    profileTrainings: config.profileTrainings,
    profileOperational: config.profileOperational,
    porto: {
      operatorLabel,
      operatorTraining: config.porto?.operatorTraining || operatorLabel
    },
    mentorRanks: config.mentorRanks,
    mentorChecklistGroups: config.mentorChecklistGroups,
    mentorChecklistLabels: config.mentorChecklistGroups.flatMap((group) => group.items),
    extraTasks: config.extraTasks,
    extraFunctions: config.extraFunctions,
    sideTaskBadges: config.sideTaskBadges || [],
    disciplineTypes,
    profileDistinctions: commonDistinctions,
    rankTrainingRequirements: config.rankTrainingRequirements || {},
    autoFunctionByRanks: config.autoFunctionByRanks || [],
    rankColors: config.rankColors || {},
    defaultState: defaultStateForOrganization(config)
  };
}

function clientDataScript(config = currentOrganization()) {
  const data = publicClientData(config);
  return `(function(){\nwindow.DefensiePortalData = ${JSON.stringify(data)};\nwindow.DefensiePortalData.rankWeight = new Map(${JSON.stringify(rankWeightEntries(config))});\n}());`;
}

function portoClientData(config = currentOrganization()) {
  const operatorLabel = config.porto?.operatorLabel || config.discord?.portoOperatorLabel || "OPS";
  return {
    organization: {
      key: config.key,
      label: config.label,
      portalTitle: config.portalTitle,
      portalSubtitle: config.portalSubtitle,
      requiredRoleLabel: config.requiredRoleLabel
    },
    operatorLabel,
    operatorTraining: config.porto?.operatorTraining || operatorLabel,
    profileTrainings: config.profileTrainings || [],
    profileOperational: config.profileOperational || [],
    lockTitle: config.porto?.lockTitle || `${config.label} Porto-Systeem`,
    lockSubtitle: config.porto?.lockSubtitle || config.portalSubtitle,
    lockText: config.porto?.lockText || `Alleen aangemelde ${config.requiredRoleLabel} leden met een gekoppeld ${config.portalTitle}-profiel kunnen het Porto-Systeem openen.`
  };
}

function portoClientDataScript(config = currentOrganization()) {
  return `(function(){\nwindow.ORPPortoData = ${JSON.stringify(portoClientData(config))};\n}());`;
}

module.exports = {
  organizationConfigs,
  normalizeOrganizationKey,
  currentOrganizationKey,
  currentOrganization,
  organizationMainRoleId,
  serviceNumberGroupForRank,
  serviceNumberGroupsForRank,
  rankWeightEntries,
  publicClientData,
  clientDataScript,
  portoClientData,
  portoClientDataScript,
  envOrDefault
};
