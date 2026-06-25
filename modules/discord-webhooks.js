const { currentOrganization } = require("./organizations");

function webhookUrlWithWait(webhookUrl, wait) {
  if (!wait) return webhookUrl;
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  return url.toString();
}

function truncateDiscordThreadName(value) {
  const text = String(value || "").trim();
  return text.length > 100 ? text.slice(0, 100) : text;
}

async function sendDiscordWebhook(webhookUrl, payload, files = [], options = {}) {
  if (!webhookUrl) return { skipped: true };
  async function webhookResult(response) {
    const shouldParseBody = Boolean(options.wait);
    if (response.ok) {
      if (!shouldParseBody) return { ok: true, status: response.status };
      const body = await response.json().catch(() => null);
      return {
        ok: true,
        status: response.status,
        messageId: body?.id || "",
        channelId: body?.channel_id || "",
        body
      };
    }
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, body: body.slice(0, 800) };
  }

  const targetUrl = webhookUrlWithWait(webhookUrl, options.wait);
  if (Array.isArray(files) && files.length) {
    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload));
    files.forEach((file, index) => {
      const blob = new Blob([file.buffer], { type: file.contentType || "application/octet-stream" });
      formData.append(`files[${index}]`, blob, file.filename || `bijlage-${index + 1}`);
    });
    const response = await fetch(targetUrl, {
      method: "POST",
      body: formData
    });
    return webhookResult(response);
  }

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return webhookResult(response);
}

async function createDiscordThreadFromMessage(channelId, messageId, threadName) {
  const token = String(process.env.DISCORD_BOT_TOKEN || "").trim();
  const name = truncateDiscordThreadName(threadName);
  if (!token) return { skipped: true, reason: "DISCORD_BOT_TOKEN ontbreekt." };
  if (!channelId || !messageId || !name) return { skipped: true, reason: "Kanaal, bericht of threadnaam ontbreekt." };

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      auto_archive_duration: 10080
    })
  });
  if (response.ok) {
    const body = await response.json().catch(() => null);
    return { ok: true, status: response.status, threadId: body?.id || "", body };
  }
  const body = await response.text().catch(() => "");
  return { ok: false, status: response.status, body: body.slice(0, 800) };
}

async function sendDiscordWebhookWithMessageThread(webhookUrl, payload, files = [], threadName) {
  const webhookResult = await sendDiscordWebhook(webhookUrl, payload, files, { wait: true });
  if (!webhookResult.ok) return webhookResult;
  const threadResult = await createDiscordThreadFromMessage(webhookResult.channelId, webhookResult.messageId, threadName);
  return { ...webhookResult, thread: threadResult };
}

function createDiscordWebhookServices({ formatDate }) {
  const organization = currentOrganization();
  const orgEnvPrefix = String(organization.key || "defensie").trim().toUpperCase();

  function firstConfiguredEnv(...keys) {
    for (const key of keys) {
      const value = String(process.env[key] || "").trim();
      if (value) return value;
    }
    return "";
  }

  function personnelWebhookUrl(type) {
    if (type === "blacklist") {
      return firstConfiguredEnv(
        `DISCORD_${orgEnvPrefix}_BLACKLIST_WEBHOOK_URL`,
        "DISCORD_BLACKLIST_WEBHOOK_URL"
      );
    }
    const map = {
      hire: "HIRE",
      dismissal: "DISMISSAL",
      resignation: "RESIGNATION",
      io: "IO"
    };
    const typeKey = map[type];
    if (!typeKey) {
      return firstConfiguredEnv(
        `DISCORD_${orgEnvPrefix}_PERSONNEL_WEBHOOK_URL`,
        "DISCORD_PERSONNEL_WEBHOOK_URL"
      );
    }
    return firstConfiguredEnv(
      `DISCORD_${orgEnvPrefix}_${typeKey}_WEBHOOK_URL`,
      `DISCORD_${orgEnvPrefix}_PERSONNEL_WEBHOOK_URL`,
      `DISCORD_${typeKey}_WEBHOOK_URL`,
      "DISCORD_PERSONNEL_WEBHOOK_URL"
    );
  }

  function absenceWebhookUrl() {
    return firstConfiguredEnv(
      `DISCORD_${orgEnvPrefix}_ABSENCE_WEBHOOK_URL`,
      "DISCORD_ABSENCE_WEBHOOK_URL"
    );
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
            { name: "Rang", value: dismissal.rank || member.previousRank || member.rank || "-", inline: true },
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

  function formatWebhookDateTime(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function buildInvestigationWebhookPayload(member, investigation, actor) {
    const reporterName = actor?.name || investigation?.setByName || "Onbekend";
    return {
      content: [
        `I.O Melding - ${reporterName}`,
        "",
        `Naam: ${member?.name || "-"}`,
        `Datum: ${formatWebhookDateTime(investigation?.setAt)}`,
        "",
        `Reden: ${investigation?.reason || "-"}`
      ].join("\n"),
      allowed_mentions: { parse: [] }
    };
  }

  return {
    sendDiscordWebhook,
    sendDiscordWebhookWithMessageThread,
    absenceWebhookUrl,
    personnelWebhookUrl,
    buildAbsenceWebhookPayload,
    buildRecruitmentWebhookPayload,
    buildDismissalWebhookPayload,
    buildResignationFormWebhookPayload,
    buildBlacklistWebhookPayload,
    buildInvestigationWebhookPayload
  };
}

module.exports = { createDiscordWebhookServices };
