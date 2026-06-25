"use strict";

const { buildPortoDutyHourEntries } = require("./porto-duty-hours");

function startPortoDutyHoursJob(options = {}) {
  const {
    enabled = true,
    readState,
    writeHourEntries,
    intervalMs = 10 * 60 * 1000,
    timeZone = "Europe/Amsterdam",
    logError = console.error
  } = options;

  let timer = null;
  let running = false;
  let stopped = false;

  async function runOnce() {
    if (!enabled || stopped || running) return { skipped: true };
    if (typeof readState !== "function" || typeof writeHourEntries !== "function") {
      return { skipped: true, reason: "missing-storage" };
    }

    running = true;
    try {
      const state = await readState();
      const entries = buildPortoDutyHourEntries(state, { now: new Date(), timeZone });
      if (entries.length) await writeHourEntries(entries);
      return { entries: entries.length };
    } catch (error) {
      logError(error);
      return { error };
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    if (!enabled || stopped) return;
    timer = setTimeout(async () => {
      await runOnce();
      scheduleNext();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  if (enabled) {
    runOnce();
    scheduleNext();
  }

  return {
    runOnce,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    isEnabled() {
      return Boolean(enabled && !stopped);
    }
  };
}

module.exports = { startPortoDutyHoursJob };
