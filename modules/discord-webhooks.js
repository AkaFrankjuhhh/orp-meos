async function sendDiscordWebhook(webhookUrl, payload) {
  if (!webhookUrl) return { skipped: true };
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { ok: response.ok, status: response.status };
}

function createDiscordWebhookServices({ formatDate }) {
  function personnelWebhookUrl(type) {
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

  return {
    sendDiscordWebhook,
    absenceWebhookUrl,
    personnelWebhookUrl,
    buildAbsenceWebhookPayload,
    buildRecruitmentWebhookPayload,
    buildDismissalWebhookPayload,
    buildResignationFormWebhookPayload
  };
}

module.exports = { createDiscordWebhookServices };