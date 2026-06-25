const DISCORD_SYNC_LABELS = {
  synced: "Aangepast",
  role_missing: "Rol ontbreekt",
  missing_permissions: "Bot mist rechten",
  hierarchy: "Hierarchy issue",
  retry_planned: "Retry gepland",
  skipped: "Overgeslagen",
  failed: "Mislukt"
};

function setDiscordSyncStatus(person, state, message = "", reason = "") {
  if (!person) return null;
  const normalizedState = DISCORD_SYNC_LABELS[state] ? state : "failed";
  person.discordSyncStatus = {
    state: normalizedState,
    label: DISCORD_SYNC_LABELS[normalizedState],
    message: String(message || DISCORD_SYNC_LABELS[normalizedState]),
    reason: String(reason || ""),
    updatedAt: new Date().toISOString()
  };
  return person.discordSyncStatus;
}

function syncStatusFromError(error) {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();
  if (lower.includes("missing permissions") || lower.includes("permission") || lower.includes("403")) {
    return { state: "missing_permissions", message: "Bot mist rechten om deze Discord-naam aan te passen." };
  }
  if (lower.includes("hierarchy") || lower.includes("higher role") || lower.includes("role hoger")) {
    return { state: "hierarchy", message: "Discord role hierarchy blokkeert deze aanpassing." };
  }
  if (lower.includes("rol ontbreekt") || lower.includes("role missing") || lower.includes("organisatie-rol")) {
    return { state: "role_missing", message: "De vereiste Discord-rol ontbreekt nog." };
  }
  return { state: "retry_planned", message: message || "Sync wordt opnieuw geprobeerd." };
}

module.exports = {
  DISCORD_SYNC_LABELS,
  setDiscordSyncStatus,
  syncStatusFromError
};
