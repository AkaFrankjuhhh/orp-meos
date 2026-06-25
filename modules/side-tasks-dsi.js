function shouldSyncDsiNicknameForStatus(status) {
  return ["0", "1", "8"].includes(String(status));
}

function requireDsiIdentityForStatus(member, nextStatus) {
  if (!member || !["0", "1"].includes(String(nextStatus))) return;
  if (String(member.callSign || "").trim() && String(member.aliasName || "").trim()) return;
  const error = new Error("Vul eerst je DSI roepnummer en schuilnaam in en sla je profiel op.");
  error.status = 400;
  throw error;
}

module.exports = {
  shouldSyncDsiNicknameForStatus,
  requireDsiIdentityForStatus
};
