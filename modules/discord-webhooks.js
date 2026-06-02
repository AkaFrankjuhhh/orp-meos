async function sendDiscordWebhook(webhookUrl, payload, files = []) {
  if (!webhookUrl) return { skipped: true };
  async function webhookResult(response) {
    if (response.ok) return { ok: true, status: response.status };
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, body: body.slice(0, 800) };
  }

  if (Array.isArray(files) && files.length) {
    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => {
      const blob = new Blob([file.buffer], { type: file.contentType || "application/octet-stream" });
      formData.append(`files[${index}]`, blob, file.filename || `bijlage-${index + 1}`);
    });
    const response = await fetch(webhookUrl, {
      method: "POST",
      body: formData
    });
    return webhookResult(response);
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return webhookResult(response);
}

function createDiscordWebhookServices({ formatDate }) {
  function personnelWebhookUrl(type) {
    if (type === "blacklist") {
      return process.env.DISCORD_BLACKLIST_WEBHOOK_URL || "";
    }
    const map = {
      hire: process.env.DISCORD_HIRE_WEBHOOK_URL,
      dismissal: process.env.DISCORD_DISMISSAL_WEBHOOK_URL,
      resignation: process.env.DISCORD_RESIGNATION_WEBHOOK_URL
    };
    return map[type] || process.env.DISCORD_PERSONNEL_WEBHOOK_URL || "";
  }

  function absenceWebhookUrl() {
    return process.env.DISCORD_ABSENCE_WEBHOOK_URL || "";
  }

  function buildAbsenceWebhookPayload(member, absence, submittedBy) {
    return {
      embeds: [
        {
          title: "Afwezigheid geregistreerd",
          color: 0xe17000,
          thumbnail: member.avatar ? { url: member.avatar } : undefined,
          fields: [
            {
              name: "Personeelslid",
              value: `${member.serviceNumber || "-"} - ${member.name}`,
              inline: false
            },
            {
              name: "Rang",
              value: member.rank || "-",
              inline: true
            },
            {
              name: "Periode",
              value: `${formatDate(absence.from)} t/m ${formatDate(absence.to)}`,
              inline: true
            },
            {
              name: "Reden",
              value: absence.reason || "-",
              inline: false
            },
            {
              name: "Ingevoerd door",
              value: submittedBy?.name || "-",
              inline: false
            }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  function buildRecruitmentWebhookPayload(member, recruiter) {
    return {
      embeds: [
        {
          title: "Personeel aangenomen",
          color: 0x34a853,
          thumbnail: member.avatar ? { url: member.avatar } : undefined,
          fields: [
            { name: "Nieuwe medewerker", value: `${member.serviceNumber || "-"} - ${member.name}`, inline: false },
            { name: "Rang", value: member.rank || "-", inline: true },
            { name: "Aangenomen op", value: formatDate(member.hiredDate), inline: true },
            { name: "Aangenomen door", value: recruiter?.name || "W&S", inline: false }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  function buildDismissalWebhookPayload(member, dismissal, dismissedBy) {
    return {
      embeds: [
        {
          title: "Personeel ontslagen",
          color: 0xd9564a,
          thumbnail: member.avatar ? { url: member.avatar } : undefined,
          fields: [
            { name: "Personeelslid", value: `${dismissal.releasedNumber || member.previousServiceNumber || "-"} - ${member.name}`, inline: false },
            { name: "Rang", value: member.rank || "-", inline: true },
            { name: "Ontslagdatum", value: formatDate(dismissal.date), inline: true },
            { name: "Reden", value: dismissal.reason || "-", inline: false },
            { name: "Uitgevoerd door", value: dismissedBy?.name || "Kader", inline: false }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  function buildResignationFormWebhookPayload(member, form) {
    return {
      embeds: [
        {
          title: "Ontslagformulier ingediend",
          color: 0xf59e0b,
          thumbnail: member.avatar ? { url: member.avatar } : undefined,
          fields: [
            { name: "Personeelslid", value: `${member.serviceNumber || "-"} - ${member.name}`, inline: false },
            { name: "Rang", value: member.rank || "-", inline: true },
            { name: "Datum", value: formatDate(form.requestedAt), inline: true },
            { name: "Reden", value: form.reason || "-", inline: false }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  function buildBlacklistWebhookPayload(entry, actor) {
    const revoked = Boolean(entry.revokedAt);
    return {
      embeds: [
        {
          title: revoked ? "Blacklist ingetrokken" : "Persoon geblacklist",
          color: revoked ? 0x34a853 : 0xd9564a,
          fields: [
            { name: "Persoon", value: `${entry.serviceNumber || "-"} - ${entry.name || "-"}`, inline: false },
            { name: "Discord ID", value: entry.discordId || "-", inline: true },
            { name: "Rang", value: entry.rank || "-", inline: true },
            { name: revoked ? "Intrek reden" : "Reden", value: (revoked ? entry.revokeReason : entry.reason) || "-", inline: false },
            { name: "Uitgevoerd door", value: actor?.name || entry.blacklistedByName || "Kader", inline: false }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    };
  }

  return {
    sendDiscordWebhook,
    absenceWebhookUrl,
    personnelWebhookUrl,
    buildAbsenceWebhookPayload,
    buildRecruitmentWebhookPayload,
    buildDismissalWebhookPayload,
    buildResignationFormWebhookPayload,
    buildBlacklistWebhookPayload
  };
}

module.exports = { createDiscordWebhookServices };
