(function () {
const ranks = [
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

const rankCategories = [
  {
    title: "Kader",
    serviceRange: "70-01 t/m 70-05",
    ranks: ["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"]
  },
  {
    title: "Hoofd-Officieren",
    serviceRange: "71-01 t/m 71-15",
    ranks: ["Kolonel", "Luitenant-Kolonel", "Majoor"]
  },
  {
    title: "Officieren",
    serviceRange: "72-01 t/m 72-50",
    ranks: ["Kapitein", "Eerste-Luitenant", "Tweede-Luitenant", "Kornet"]
  },
  {
    title: "Onderofficieren",
    serviceRange: "73-01 t/m 73-75",
    ranks: ["Adjudant", "Opperwachtmeester", "Wachtmeester 1ste Klasser", "Wachtmeester"]
  },
  {
    title: "Manschappen",
    serviceRange: "74-01 t/m 74-100",
    ranks: [
      "Marechaussee 1ste Klasser",
      "Marechaussee 2de Klasser",
      "Marechaussee 3de Klasser",
      "Marechaussee 4de Klasser"
    ]
  }
];

const rankWeight = new Map(ranks.map((rank, index) => [rank, ranks.length - index]));
const today = new Date().toISOString().slice(0, 10);
const profileTrainings = ["BKV", "Mentor-Traject", "IBT", "TMO", "SIV", "ZULU", "OGM", "KW", "SMG"];
const profileOperational = ["OPS", "OPCO", "OVD"];
const mentorRanks = ["Marechaussee 4de Klasser", "Marechaussee 3de Klasser", "Marechaussee 2de Klasser"];
const mentorChecklistGroups = [
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
const mentorChecklistLabels = mentorChecklistGroups.flatMap((group) => group.items);
const extraTasks = ["Interne-Zaken", "OvJ", "hOvJ", "Trainer", "Mentor", "W&S", "Mentor-Leiding", "IZ-Leiding", "Trainer-Leiding", "OTC-Leiding", "W&S-Leiding", "DSI-Leiding", "DSI", "KLu-Leiding", "KLu", "DNR-Leiding", "DNR", "HRB-Leiding", "HRB"];
const extraFunctions = ["Kader", "Overheidscoördinator", "Hoofdofficier", "Officiersraad"];
const disciplineTypes = {
  "regular-warning": { label: "Offici\u00eble Waarschuwing", tone: "warning" },
  "regular-strike": { label: "Strike", tone: "strike" },
  "i8-warning": { label: "I8 Waarschuwing", tone: "i8-warning" },
  "i8-strike": { label: "I8 Strike", tone: "i8-strike" }
};
const profileDistinctions = [
  { type: "Bronze diensttijdster", tone: "bronze", months: 1.5 },
  { type: "Zilveren diensttijdster", tone: "silver", months: 3 },
  { type: "Gouden diensttijdster", tone: "gold", months: 6 },
  { type: "Diamanten diensttijdster", tone: "diamond", months: 12 }
];
const rankTrainingRequirements = {
  "Marechaussee 4de Klasser": ["BKV"],
  "Marechaussee 3de Klasser": ["BKV", "IBT"],
  "Marechaussee 2de Klasser": ["BKV", "IBT", "Mentor-Traject"],
  "Marechaussee 1ste Klasser": ["BKV", "IBT", "Mentor-Traject", "KW"],
  "Wachtmeester": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO"],
  "Wachtmeester 1ste Klasser": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO"],
  "Opperwachtmeester": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO", "SIV"],
  "Eerste-Luitenant": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO", "SIV", "OGM"],
  "Majoor": ["BKV", "IBT", "Mentor-Traject", "KW", "OPS", "TMO", "OPCO", "SIV", "OGM", "SMG"]
};
const autoFunctionByRanks = [
  { label: "Kader", ranks: ["Luitenant-Generaal", "Generaal-Majoor", "Brigade-Generaal"] },
  { label: "Hoofdofficier", ranks: ["Kolonel", "Luitenant-Kolonel", "Majoor"] }
];
const rankColors = {
  "Luitenant-Generaal": "#e17000",
  "Generaal-Majoor": "#ff8a00",
  "Brigade-Generaal": "#f6b15a",
  "Kolonel": "#0e3d6e",
  "Luitenant-Kolonel": "#2d638f",
  "Majoor": "#4f86b1",
  "Kapitein": "#6f42c1",
  "Eerste-Luitenant": "#8b5cf6",
  "Tweede-Luitenant": "#a78bfa",
  "Kornet": "#c4b5fd",
  "Adjudant": "#0f766e",
  "Opperwachtmeester": "#14b8a6",
  "Wachtmeester 1ste Klasser": "#5eead4",
  "Wachtmeester": "#99f6e4",
  "Marechaussee 1ste Klasser": "#b45309",
  "Marechaussee 2de Klasser": "#d97706",
  "Marechaussee 3de Klasser": "#f59e0b",
  "Marechaussee 4de Klasser": "#fbbf24"
};

const defaultState = {
  theme: "dark",
  discord: {
    kaderRoleId: "",
    hoofdofficierRoleId: "",
    officiersraadRoleId: ""
  },
  people: [
    {
      id: crypto.randomUUID(),
      name: "Kader Commandant",
      discordId: "100000000000000001",
      avatar: "",
      rank: "Luitenant-Generaal",
      serviceNumber: "70-01",
      permRole: "Kader",
      extraFunctions: [],
      hiredDate: "2026-01-01",
      rankDate: "2026-01-01",
      promotionDate: "2026-01-01",
      tasks: "Leiding, personeelszaken",
      completedTrainings: [],
      completedOperational: [],
      status: "Actief",
      rankHistory: [
        { rank: "Luitenant-Generaal", date: "2026-01-01", serviceNumber: "70-01" }
      ]
    },
    {
      id: crypto.randomUUID(),
      name: "Hoofdofficier Jansen",
      discordId: "100000000000000002",
      avatar: "",
      rank: "Kolonel",
      serviceNumber: "71-01",
      permRole: "Hoofdofficier",
      extraFunctions: [],
      hiredDate: "2026-02-10",
      rankDate: "2026-02-10",
      promotionDate: "2026-02-10",
      tasks: "Operationele leiding",
      completedTrainings: [],
      completedOperational: [],
      status: "Actief",
      rankHistory: [
        { rank: "Kolonel", date: "2026-02-10", serviceNumber: "71-01" }
      ]
    },
    {
      id: crypto.randomUUID(),
      name: "Kapitein De Vries",
      discordId: "100000000000000003",
      avatar: "",
      rank: "Kapitein",
      serviceNumber: "72-01",
      permRole: "Officiersraad",
      extraFunctions: [],
      hiredDate: "2026-03-15",
      rankDate: "2026-03-15",
      promotionDate: "2026-03-15",
      tasks: "Training, beoordelingsraad",
      completedTrainings: [],
      completedOperational: [],
      status: "Actief",
      rankHistory: [
        { rank: "Kapitein", date: "2026-03-15", serviceNumber: "72-01" }
      ]
    }
  ],
  hours: [],
  trainings: [],
  absences: [],
  i8Forms: [],
  resignationForms: [],
  blacklist: [],
  mentorChecklistGroups,
  activity: [
    "Personeelsbeheer omgeving aangemaakt.",
    "Dienstnummer reeksen 70 t/m 74 ingericht.",
    "Perm rollen Kader, Hoofdofficier en Officiersraad toegevoegd."
  ]
};
// Exporteer statische Defensie Personeelsportaal configuratie naar app.js zonder alles in ÃƒÂ©ÃƒÂ©n bestand te houden.
window.DefensiePortalData = {
  ranks,
  rankCategories,
  rankWeight,
  today,
  profileTrainings,
  profileOperational,
  mentorRanks,
  mentorChecklistGroups,
  mentorChecklistLabels,
  extraTasks,
  extraFunctions,
  disciplineTypes,
  profileDistinctions,
  rankTrainingRequirements,
  autoFunctionByRanks,
  rankColors,
  defaultState
};
}());

