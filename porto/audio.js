(function () {
  let audioContext = null;
  let audioUnlocked = false;
  let opsSoundPrimed = false;
  let ownAssignmentPrimed = false;
  let previousOwnAssignmentSignature = "";
  let previousOpsRequestIds = new Set();
  let previousOpsStatuses = new Map();
  const activeOpsAlerts = new Map();

  // OPS-audio gebruikt Web Audio, zodat er geen losse geluidsbestanden nodig zijn.
  function getAudioContext() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) audioContext = new AudioCtor();
    return audioContext;
  }

  function unlock() {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") {
      context.resume()
        .then(() => { audioUnlocked = context.state === "running"; })
        .catch(() => { audioUnlocked = false; });
      return;
    }
    audioUnlocked = context.state === "running";
  }

  function playTone(context, frequency, startOffset, duration, volume, type = "sine") {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const startAt = context.currentTime + startOffset;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }

  // De huidige OPS krijgt herhalend geluid zolang een melding aandacht nodig heeft.
  function playOpsSound(type) {
    const context = getAudioContext();
    if (!context || !audioUnlocked) return;
    if (context.state === "suspended") {
      context.resume().catch(() => {});
      return;
    }
    if (type === "status0") {
      playTone(context, 880, 0, 0.11, 0.045);
      playTone(context, 1320, 0.11, 0.13, 0.04);
      return;
    }
    if (type === "status6") {
      playTone(context, 520, 0, 0.16, 0.055, "triangle");
      playTone(context, 660, 0.2, 0.16, 0.055, "triangle");
      return;
    }
    if (type === "status7") {
      playTone(context, 740, 0, 0.18, 0.085, "sawtooth");
      playTone(context, 740, 0.24, 0.18, 0.085, "sawtooth");
      playTone(context, 980, 0.48, 0.22, 0.095, "sawtooth");
      return;
    }
    if (type === "assignment") {
      playTone(context, 760, 0, 0.10, 0.045, "triangle");
      playTone(context, 1040, 0.14, 0.12, 0.045, "triangle");
    }
  }

  function playAssignmentSound() {
    playOpsSound("assignment");
    window.setTimeout(() => playOpsSound("assignment"), 620);
  }

  function collectOpsStatuses(activeUnits) {
    const statuses = new Map();
    (activeUnits || []).forEach((unit) => {
      (unit.members || []).forEach((member) => {
        if (member?.id) statuses.set(member.id, String(member.status || ""));
      });
    });
    return statuses;
  }

  function repeatMsForSound(type) {
    if (type === "status7") return 2600;
    if (type === "status6") return 4300;
    return 5200;
  }

  function stopOpsAlert(key) {
    const alert = activeOpsAlerts.get(key);
    if (!alert) return;
    window.clearInterval(alert.timer);
    activeOpsAlerts.delete(key);
  }

  function startOpsAlert(key, type) {
    const current = activeOpsAlerts.get(key);
    if (current?.type === type) return;
    stopOpsAlert(key);
    playOpsSound(type);
    const timer = window.setInterval(() => playOpsSound(type), repeatMsForSound(type));
    activeOpsAlerts.set(key, { type, timer });
  }

  function stopMissingOpsAlerts(nextKeys) {
    for (const key of [...activeOpsAlerts.keys()]) {
      if (!nextKeys.has(key)) stopOpsAlert(key);
    }
  }

  function resetSoundState(payload) {
    previousOpsRequestIds = new Set((payload.opsRequests || []).map((request) => request.id));
    previousOpsStatuses = collectOpsStatuses(payload.activeUnits || []);
    for (const key of [...activeOpsAlerts.keys()]) stopOpsAlert(key);
    opsSoundPrimed = false;
  }

  function ownAssignmentSignature(unit) {
    if (!unit || String(unit.status) === "8" || !unit.vehicleNumber) return "";
    return [
      unit.id || "",
      unit.vehicleNumber || "",
      unit.vehicleCode || "",
      unit.vehicleType || "",
      unit.vehicleName || ""
    ].join("|");
  }

  function trackOwnAssignmentSound(payload, profile, options = {}) {
    if (!profile) return;
    const signature = ownAssignmentSignature(payload.unit || null);
    if (!ownAssignmentPrimed) {
      previousOwnAssignmentSignature = signature;
      ownAssignmentPrimed = true;
      return;
    }
    if (options.suppressOwnAssignmentSound) {
      previousOwnAssignmentSignature = signature;
      return;
    }
    if (signature && signature !== previousOwnAssignmentSignature) {
      playAssignmentSound();
    }
    previousOwnAssignmentSignature = signature;
  }

  function trackOpsSounds(payload, profile, options = {}) {
    trackOwnAssignmentSound(payload, profile, options);
    const currentOps = payload.currentOps || null;
    const isAssignedOps = Boolean(currentOps && profile && currentOps.memberId === profile.id && payload.canManageOps);
    if (!isAssignedOps) {
      resetSoundState(payload);
      return;
    }

    const nextAlertKeys = new Set();
    const nextRequestIds = new Set((payload.opsRequests || []).map((request) => request.id));
    const nextStatuses = collectOpsStatuses(payload.activeUnits || []);

    // Status 0 blijft hoorbaar totdat OPS de aanmelding indeelt en het verzoek verdwijnt.
    for (const request of payload.opsRequests || []) {
      if (!request?.id) continue;
      const key = `status0:${request.id}`;
      nextAlertKeys.add(key);
      startOpsAlert(key, "status0");
    }

    // Status 6/7 blijft hoorbaar per roepnummer totdat OPS de status wijzigt.
    for (const unit of payload.activeUnits || []) {
      const vehicleNumber = String(unit.vehicleNumber || "");
      const primaryMember = (unit.members || [])[0] || null;
      const status = String(primaryMember?.status || "");
      if (!vehicleNumber || !["6", "7"].includes(status)) continue;
      const key = `status:${vehicleNumber}`;
      nextAlertKeys.add(key);
      startOpsAlert(key, status === "7" ? "status7" : "status6");
    }

    stopMissingOpsAlerts(nextAlertKeys);
    previousOpsRequestIds = nextRequestIds;
    previousOpsStatuses = nextStatuses;
    opsSoundPrimed = true;
  }

  window.PortoAudio = window.PortoModules.registerFeature("audio", {
    unlock,
    playOpsSound,
    playAssignmentSound,
    resetSoundState,
    trackOpsSounds
  });
}());
