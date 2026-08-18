"use strict";

const basePeople = [
  {
    id: "ernie-nugz",
    name: "Ernie Nugz",
    gender: "M",
    bsn: "ORP-BSN-44499819",
    fingerprint: "ORP-V-38445989",
    birthDate: "17-03-1945",
    height: "171",
    status: "Geen signalering",
    licenses: ["Theorie", "Auto", "Motor", "Vrachtwagen", "Vaarbewijs", "Vliegbrevet"],
    vehicles: [
      { plate: "WFX 403", model: "BMX (velo)", impounded: "Nee", wok: "Nee", apkStatus: "Goedgekeurd", primaryColor: "Racing Blue", secondaryColor: "Black", pearlColor: "Light Blue", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-BMX-403" },
      { plate: "OP-218-L", model: "Obey Oracle", impounded: "Nee", wok: "Nee", apkStatus: "Goedgekeurd", primaryColor: "Zwart", secondaryColor: "Wit", pearlColor: "Ice White", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-ORA-218" },
      { plate: "AT-744", model: "Vapid Scout", impounded: "Ja", wok: "Nee", apkStatus: "Herkeuring nodig", primaryColor: "Donkerblauw", secondaryColor: "Wit", pearlColor: "Chrome", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-SCT-744" },
      { plate: "NUGZ-91", model: "Dinka Blista", impounded: "Nee", wok: "Ja", apkStatus: "Afgekeurd", primaryColor: "Rood", secondaryColor: "Zwart", pearlColor: "Geen", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-BLI-091" },
      { plate: "FST 017", model: "Shitzu Hakuchou", impounded: "Nee", wok: "Nee", apkStatus: "Goedgekeurd", primaryColor: "Wit", secondaryColor: "Blauw", pearlColor: "Silver", stolen: "Ja", stolenReason: "Aangifte diefstal bij Vespucci", stolenDate: "12 aug. 2026", serviceVehicle: "Nee", owner: "Ernie Nugz", vin: "ORP-HAK-017" }
    ],
    houses: [
      { location: "Mirror Park Boulevard 12", building: "Woning", status: "Actief" },
      { location: "Alta Street 4B", building: "Appartement", status: "Huur" }
    ],
    records: [
      { date: "27 jan. 2022", sanction: "PV", verbalist: "Matheo Van antwerpen", note: "Meneer reed 319 waar hij 130 mocht, voertuig word in beslag genomen." },
      { date: "6 dec. 2020", sanction: "Waarschuwing", verbalist: "Frank B.", note: "Onvolledige papieren bij verkeerscontrole." },
      { date: "27 nov. 2020", sanction: "PV", verbalist: "S. de Vries", note: "Niet opvolgen stopteken." },
      { date: "24 nov. 2020", sanction: "Notitie", verbalist: "Meldkamer", note: "Betrokken bij melding rond Legion Square." }
    ],
    notes: [
      { date: "27 jan. 2022", author: "Matheo Van antwerpen", note: "Meneer reed 319 waar hij 130 mocht, voertuig word in beslag genomen." },
      { date: "14 feb. 2021", author: "Recherche", note: "Controleer recente voertuigbewegingen bij opvolgende staandehouding." }
    ],
    fines: [
      { fine: "Snelheidsovertreding", amount: "EUR 1.250", writtenAt: "27 jan. 2022", writtenBy: "Matheo Van antwerpen" }
    ],
    arrestWarrants: []
  },
  {
    id: "mila-voss",
    name: "Mila Voss",
    gender: "V",
    bsn: "ORP-BSN-88420044",
    fingerprint: "ORP-V-12008842",
    birthDate: "04-08-1998",
    height: "168",
    status: "Aandacht",
    licenses: ["Theorie", "Auto", "Motor"],
    vehicles: [
      { plate: "MV-884", model: "Karin Sultan", impounded: "Nee", wok: "Nee", apkStatus: "Goedgekeurd", primaryColor: "Pearl White", secondaryColor: "Black", pearlColor: "Blue", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Mila Voss", vin: "ORP-SUL-884" }
    ],
    houses: [{ location: "Vespucci Canals 8", building: "Appartement", status: "Actief" }],
    records: [{ date: "12 mei 2026", sanction: "Waarschuwing", verbalist: "OC Politie", note: "Onrustig gedrag tijdens voertuigcontrole." }],
    notes: [{ date: "12 mei 2026", author: "OC Politie", note: "Geen verdere actie nodig, wel noteren voor opvolging." }],
    fines: [],
    arrestWarrants: []
  },
  {
    id: "damian-kroes",
    name: "Damian Kroes",
    gender: "M",
    bsn: "ORP-BSN-31977012",
    fingerprint: "ORP-V-55093197",
    birthDate: "23-11-1987",
    height: "182",
    status: "Gezocht voor verhoor",
    licenses: ["Theorie", "Auto", "Vrachtwagen"],
    vehicles: [
      { plate: "DK-319", model: "Benefactor Schafter", impounded: "Nee", wok: "Nee", apkStatus: "Goedgekeurd", primaryColor: "Grijs", secondaryColor: "Zwart", pearlColor: "Geen", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Damian Kroes", vin: "ORP-SCH-319" },
      { plate: "TRK 550", model: "MTL Pounder", impounded: "Nee", wok: "Nee", apkStatus: "Goedgekeurd", primaryColor: "Wit", secondaryColor: "Blauw", pearlColor: "Geen", stolen: "Nee", stolenReason: "", stolenDate: "", serviceVehicle: "Nee", owner: "Damian Kroes", vin: "ORP-PND-550" }
    ],
    houses: [],
    records: [{ date: "2 aug. 2026", sanction: "Signalering", verbalist: "Recherche", note: "Graag staandehouden voor verhoor in onderzoek Havengebied." }],
    notes: [{ date: "2 aug. 2026", author: "Recherche", note: "Niet aanhouden zonder OvJ-contact, tenzij heterdaad." }],
    fines: [{ fine: "Openstaande boete", amount: "EUR 600", writtenAt: "18 jul. 2026", writtenBy: "Verkeersteam" }],
    arrestWarrants: [
      {
        id: "AB-2026-0142",
        reason: "Verhoor in onderzoek Havengebied",
        issuedAt: "2 aug. 2026",
        issuedBy: "Recherche",
        priority: "Hoog",
        status: "Actief",
        instruction: "Staandehouden en overbrengen naar bureau voor verhoor."
      }
    ]
  }
];

const demoFirstNames = [
  "Nolan", "Sven", "Lars", "Daan", "Ruben", "Jasper", "Milan", "Sem", "Timo", "Jayden",
  "Levi", "Finn", "Noah", "Stijn", "Koen", "Mees", "Rayan", "Ilias", "Samir", "Joey",
  "Nora", "Lina", "Eva", "Sofie", "Mila", "Noor", "Fenna", "Isa", "Yara", "Tess"
];
const demoLastNames = [
  "Vos", "Bakker", "Smit", "Jansen", "Kramer", "Mulder", "Dekker", "Visser", "Bos", "Meijer",
  "Koster", "Vermeer", "Hendriks", "Kuipers", "Dijkstra", "Martens", "Jacobs", "Peters", "Willems", "Schouten",
  "Maas", "Prins", "Stevens", "Roos"
];
const demoVehicleModels = [
  "Karin Sultan", "Obey Tailgater", "Benefactor Schafter", "Dinka Blista", "Vapid Stanier",
  "Bravado Buffalo", "Ubermacht Sentinel", "Declasse Granger", "Maibatsu Mule", "Nagasaki Shinobi",
  "Gallivanter Baller", "Vapid Speedo", "Karin Futo", "Pfister Comet", "Albany Primo"
];
const demoColors = ["Blauw", "Wit", "Zwart", "Grijs", "Rood", "Groen", "Zilver", "Donkerblauw", "Geel", "Paars"];
const demoPearlColors = ["Geen", "Chrome", "Ice White", "Silver", "Blue", "Light Blue", "Gold"];
const demoRecordNotes = [
  "Rijden zonder geldig rijbewijs.",
  "Niet stoppen voor controle.",
  "Openbare orde verstoring bij Legion Square.",
  "Onveilig rijgedrag rond Mission Row.",
  "Verbale waarschuwing na verkeerscontrole.",
  "Aangetroffen bij verdachte situatie.",
  "Proces-verbaal voor snelheidsovertreding.",
  "Controle op voertuigdocumenten afgerond."
];
const demoNoteTexts = [
  "Let op wisselende voertuigen bij controle.",
  "Bekend bij meerdere meldingen in het centrum.",
  "Geen verdere actie, wel registreren voor opvolging.",
  "Bij staandehouding extra identiteitscontrole uitvoeren.",
  "Heeft vaker contact gehad met de meldkamer.",
  "Voertuigbewegingen rondom havengebied controleren."
];
const demoWarrantReasons = [
  "Niet verschenen na oproep",
  "Verhoor in lopend rechercheonderzoek",
  "Aanhouding na meerdere openstaande feiten",
  "Betrokkenheid bij geweldsmelding",
  "Staandehouding en overbrenging vereist"
];
const demoMonths = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
const demoVerbalists = ["Frank B.", "OC Politie", "Recherche", "Verkeersteam", "Meldkamer", "S. de Vries", "Matheo V."];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function slugFromValue(value, fallback = "persoon") {
  const slug = String(value || fallback)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function pick(random, values) {
  return values[Math.floor(random() * values.length)];
}

function demoNumber(index, offset, digits = 8) {
  return String(offset + index * 7919).padStart(digits, "0").slice(-digits);
}

function demoDate(index, offset = 0, yearBase = 2024) {
  const day = ((index * 5 + offset) % 28) + 1;
  const month = (index + offset) % 12;
  const year = yearBase + ((index + offset) % 3);
  return `${day} ${demoMonths[month]} ${year}`;
}

function demoBirthDate(index) {
  const day = String(((index * 7) % 28) + 1).padStart(2, "0");
  const month = String(((index * 5) % 12) + 1).padStart(2, "0");
  const year = 1972 + (index % 34);
  return `${day}-${month}-${year}`;
}

function demoPlate(index, vehicleIndex, random) {
  const letters = ["ORP", "LS", "MR", "PB", "GC", "HW", "RO", "SX"];
  const prefix = pick(random, letters);
  return `${prefix}-${String(100 + index * 9 + vehicleIndex * 13).padStart(3, "0")}`;
}

function demoLicenses(index, random) {
  const licenses = ["Theorie"];
  if (random() > 0.18) licenses.push("Auto");
  if (random() > 0.55) licenses.push("Motor");
  if (random() > 0.68) licenses.push("Vrachtwagen");
  if (random() > 0.78) licenses.push("Vaarbewijs");
  if (random() > 0.88) licenses.push("Vliegbrevet");
  return licenses.length ? licenses : index % 2 ? ["Auto"] : ["Theorie"];
}

function demoVehiclesForPerson(index, name, random) {
  const vehicleCount = index % 6 === 0 ? 0 : 1 + Math.floor(random() * 3);
  return Array.from({ length: vehicleCount }, (_, vehicleIndex) => {
    const stolen = (index + vehicleIndex) % 11 === 0;
    const wok = (index + vehicleIndex) % 7 === 0;
    const impounded = stolen || (index + vehicleIndex) % 9 === 0;
    const primaryColor = pick(random, demoColors);
    const secondaryColor = pick(random, demoColors.filter((color) => color !== primaryColor));
    const model = pick(random, demoVehicleModels);
    const plate = demoPlate(index, vehicleIndex, random);
    return {
      plate,
      model,
      impounded: impounded ? "Ja" : "Nee",
      wok: wok ? "Ja" : "Nee",
      apkStatus: wok ? "Afgekeurd" : pick(random, ["Goedgekeurd", "Goedgekeurd", "Herkeuring nodig"]),
      primaryColor,
      secondaryColor,
      pearlColor: pick(random, demoPearlColors),
      stolen: stolen ? "Ja" : "Nee",
      stolenReason: stolen ? pick(random, ["Aangifte diefstal", "Vermist na achtervolging", "Gestolen bij woninginbraak"]) : "",
      stolenDate: stolen ? demoDate(index, vehicleIndex + 3, 2026) : "",
      serviceVehicle: index % 17 === 0 ? "Ja" : "Nee",
      owner: name,
      vin: `ORP-${plate.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`
    };
  });
}

function demoRecordsForPerson(index, random) {
  const count = index % 5 === 0 ? 0 : 1 + Math.floor(random() * 3);
  return Array.from({ length: count }, (_, recordIndex) => ({
    date: demoDate(index, recordIndex, 2024),
    sanction: pick(random, ["PV", "Waarschuwing", "Notitie", "Signalering"]),
    verbalist: pick(random, demoVerbalists),
    note: pick(random, demoRecordNotes)
  }));
}

function demoNotesForPerson(index, random) {
  const count = index % 4 === 0 ? 0 : 1 + Math.floor(random() * 3);
  return Array.from({ length: count }, (_, noteIndex) => ({
    date: demoDate(index, noteIndex + 2, 2025),
    author: pick(random, demoVerbalists),
    note: pick(random, demoNoteTexts)
  }));
}

function demoFinesForPerson(index, random) {
  const count = index % 3 === 0 ? 1 : index % 8 === 0 ? 2 : 0;
  return Array.from({ length: count }, (_, fineIndex) => ({
    fine: pick(random, ["Snelheidsovertreding", "Rijden door rood", "Fout parkeren", "Geen verlichting"]),
    amount: `EUR ${String(150 + ((index + fineIndex) % 9) * 125)}`,
    writtenAt: demoDate(index, fineIndex + 5, 2025),
    writtenBy: pick(random, demoVerbalists)
  }));
}

function demoArrestWarrantsForPerson(index, random) {
  const hasWarrant = index % 5 === 0 || index % 13 === 0;
  if (!hasWarrant) return [];
  return [{
    id: `AB-2026-${String(200 + index).padStart(4, "0")}`,
    reason: pick(random, demoWarrantReasons),
    issuedAt: demoDate(index, 4, 2026),
    issuedBy: pick(random, ["Recherche", "OvJ", "OC Politie"]),
    priority: pick(random, ["Normaal", "Hoog", "Zeer hoog"]),
    status: "Actief",
    instruction: pick(random, [
      "Staandehouden en overbrengen naar bureau.",
      "Aanhouden bij aantreffen, direct OvJ informeren.",
      "Niet benaderen zonder tweede eenheid.",
      "Controleer voertuig en identiteit bij staandehouding."
    ])
  }];
}

function generateDemoPeople(count = 50) {
  const random = seededRandom(20260818);
  return Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    const firstName = demoFirstNames[(index - 1) % demoFirstNames.length];
    const lastName = demoLastNames[((index - 1) * 7) % demoLastNames.length];
    const name = `${firstName} ${lastName}`;
    const arrestWarrants = demoArrestWarrantsForPerson(index, random);
    const status = arrestWarrants.length
      ? "Gezocht voor aanhouding"
      : pick(random, ["Geen signalering", "Geen signalering", "Aandacht", "Controle bij staandehouding", "Bekend bij politie"]);
    return {
      id: `${slugFromValue(name)}-${String(index).padStart(2, "0")}`,
      name,
      gender: index % 3 === 0 ? "V" : "M",
      bsn: `ORP-BSN-${demoNumber(index, 44000000)}`,
      fingerprint: `ORP-V-${demoNumber(index, 38000000)}`,
      birthDate: demoBirthDate(index),
      height: String(160 + (index * 3) % 36),
      status,
      licenses: demoLicenses(index, random),
      vehicles: demoVehiclesForPerson(index, name, random),
      houses: index % 4 === 0 ? [] : [{
        location: `${pick(random, ["Vespucci", "Mission Row", "Mirror Park", "Davis", "Sandy Shores", "Paleto Bay"])} ${20 + index}`,
        building: pick(random, ["Appartement", "Woning", "Garagebox"]),
        status: pick(random, ["Actief", "Huur", "Onderzoek"])
      }],
      records: demoRecordsForPerson(index, random),
      notes: demoNotesForPerson(index, random),
      fines: demoFinesForPerson(index, random),
      arrestWarrants
    };
  });
}

function normalizeDemoPeople(people) {
  return people.map((person) => ({
    ...person,
    id: person.id || slugFromValue(person.name),
    vehicles: (person.vehicles || []).map((vehicle) => ({
      ...vehicle,
      owner: vehicle.owner || person.name
    })),
    houses: person.houses || [],
    records: person.records || [],
    notes: person.notes || [],
    fines: person.fines || [],
    arrestWarrants: person.arrestWarrants || []
  }));
}

function buildDemoMeosPeople() {
  return clone(normalizeDemoPeople([...basePeople, ...generateDemoPeople(50)]));
}

module.exports = {
  basePeople,
  buildDemoMeosPeople,
  generateDemoPeople,
  normalize,
  slugFromValue
};
