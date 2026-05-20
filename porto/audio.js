(function () {
  let audioContext = null;
  let audioUnlocked = false;
  let opsSoundPrimed = false;
  let previousOpsRequestIds = new Set();
  let previousOpsStatuses = new Map();

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

  // De huidige OPS krijgt alleen geluid bij nieuwe meldingen of echte statuswissels.
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
    }
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

  function resetSoundState(payload) {
    previousOpsRequestIds = new Set((payload.opsRequests || []).map((request) => request.id));
    previousOpsStatuses = collectOpsStatuses(payload.activeUnits || []);
    opsSoundPrimed = false;
  }

  function trackOpsSounds(payload, profile) {
    const currentOps = payload.currentOps || null;
    const isAssignedOps = Boolean(currentOps && profile && currentOps.memberId === profile.id && payload.canManageOps);
    if (!isAssignedOps) {
      resetSoundState(payload);
      return;
    }

    const nextRequestIds = new Set((payload.opsRequests || []).map((request) => request.id));
    const nextStatuses = collectOpsStatuses(payload.activeUnits || []);

    if (opsSoundPrimed) {
      const hasNewStatusZero = [...nextRequestIds].some((id) => !previousOpsRequestIds.has(id));
      if (hasNewStatusZero) playOpsSound("status0");

      for (const [unitId, nextStatus] of nextStatuses.entries()) {
        const previousStatus = previousOpsStatuses.get(unitId);
        if (!previousStatus || previousStatus === nextStatus) continue;
        if (nextStatus === "6") playOpsSound("status6");
        if (nextStatus === "7") playOpsSound("status7");
      }
    }

    previousOpsRequestIds = nextRequestIds;
    previousOpsStatuses = nextStatuses;
    opsSoundPrimed = true;
  }

  window.PortoAudio = window.PortoModules.registerFeature("audio", {
    unlock,
    playOpsSound,
    resetSoundState,
    trackOpsSounds
  });
}());