const { loadEnv, withClient, closePool } = require("../modules/db");
const { createDiscordWebhookServices } = require("../modules/discord-webhooks");
const {
  publicFormFromSlug,
  publicFormWebhookUrl,
  buildPublicFormWebhookPayload,
  formatCaseNumber,
  mergePublicFormConfig,
  isComplaintForm
} = require("../modules/public-forms");
const { createPublicFormsStore } = require("../modules/public-forms-store");

loadEnv();

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.includes(`--${name}`);
}

async function configForSlug(slug) {
  const baseConfig = publicFormFromSlug(slug);
  if (!baseConfig) throw new Error(`Onbekend formulier: ${slug}`);
  const result = await withClient((client) => client.query("select config from public_form_configs where slug = $1", [slug]));
  return mergePublicFormConfig(baseConfig, result.rows[0]?.config || {});
}

function submissionFromRow(row) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  return {
    ...raw,
    id: raw.id || row.id,
    formSlug: raw.formSlug || row.form_slug,
    formTitle: raw.formTitle || row.form_title,
    answers: raw.answers || row.answers || {},
    submittedAt: raw.submittedAt || row.submitted_at,
    ip: raw.ip || row.ip || "",
    userAgent: raw.userAgent || row.user_agent || "",
    caseNumber: raw.caseNumber || row.case_number || null
  };
}

async function main() {
  const slug = argValue("slug", "hovj");
  const status = argValue("status", "failed:400");
  const limit = Math.max(1, Math.min(100, Number(argValue("limit", "25")) || 25));
  const dryRun = hasArg("dry-run");
  const config = await configForSlug(slug);
  const webhookUrl = publicFormWebhookUrl(config);
  if (!webhookUrl) throw new Error(`Geen webhook URL ingesteld voor ${slug}. Controleer ${config.webhookEnv} of DISCORD_PUBLIC_FORMS_WEBHOOK_URL.`);

  const result = await withClient((client) => client.query(
    `select id, form_slug, form_title, answers, submitted_at, ip, user_agent, case_number, webhook_status, raw
     from public_form_submissions
     where form_slug = $1 and webhook_status = $2
     order by submitted_at asc
     limit $3`,
    [slug, status, limit]
  ));

  if (!result.rows.length) {
    console.log(`Geen inzendingen gevonden voor ${slug} met status ${status}.`);
    return;
  }

  const { sendDiscordWebhook, sendDiscordWebhookWithMessageThread } = createDiscordWebhookServices({ formatDate: (value) => value || "-" });
  const store = createPublicFormsStore({ storageMode: "postgres" });
  console.log(`${dryRun ? "[dry-run] " : ""}${result.rows.length} webhook(s) opnieuw verwerken voor ${slug} (${status}).`);

  for (const row of result.rows) {
    const submission = submissionFromRow(row);
    const payload = buildPublicFormWebhookPayload(config, submission);
    const fieldCount = payload.embeds?.[0]?.fields?.length || 0;
    if (dryRun) {
      console.log(`[dry-run] ${submission.id} ${submission.submittedAt} fields=${fieldCount}`);
      continue;
    }
    const webhookResult = isComplaintForm(config)
      ? await sendDiscordWebhookWithMessageThread(webhookUrl, payload, [], `zaaknummer ${formatCaseNumber(submission.caseNumber)}`)
      : await sendDiscordWebhook(webhookUrl, payload);
    await store.saveSubmission(submission, webhookResult);
    console.log(`${submission.id} -> ${webhookResult.ok ? "sent" : `failed:${webhookResult.status || "unknown"}`}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
