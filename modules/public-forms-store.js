const { withClient } = require("./db");

let ensured = false;

async function ensurePublicFormsTable() {
  if (ensured) return;
  await withClient((client) => client.query(`
    create table if not exists public_form_submissions (
      id text primary key,
      form_slug text not null,
      form_title text not null,
      answers jsonb not null default '{}'::jsonb,
      submitted_at timestamptz not null default now(),
      ip text,
      user_agent text,
      webhook_status text,
      raw jsonb not null default '{}'::jsonb
    )
  `));
  await withClient((client) => client.query("create index if not exists public_form_submissions_slug_idx on public_form_submissions(form_slug, submitted_at desc)"));
  ensured = true;
}

function createPublicFormsStore({ storageMode, readState, writeState, afterWrite } = {}) {
  async function saveSubmission(submission, webhookResult = {}) {
    if (storageMode === "postgres") {
      await ensurePublicFormsTable();
      await withClient((client) => client.query(
        `insert into public_form_submissions(id, form_slug, form_title, answers, submitted_at, ip, user_agent, webhook_status, raw)
         values($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb)
         on conflict (id) do update set
           form_slug = excluded.form_slug,
           form_title = excluded.form_title,
           answers = excluded.answers,
           submitted_at = excluded.submitted_at,
           ip = excluded.ip,
           user_agent = excluded.user_agent,
           webhook_status = excluded.webhook_status,
           raw = excluded.raw`,
        [
          submission.id,
          submission.formSlug,
          submission.formTitle,
          JSON.stringify(submission.answers || {}),
          submission.submittedAt,
          submission.ip || "",
          submission.userAgent || "",
          webhookResult.skipped ? "skipped" : webhookResult.ok ? "sent" : `failed:${webhookResult.status || "unknown"}`,
          JSON.stringify(submission)
        ]
      ));
      afterWrite?.();
      return submission;
    }

    const state = await Promise.resolve(readState());
    state.publicFormSubmissions = Array.isArray(state.publicFormSubmissions) ? state.publicFormSubmissions : [];
    state.publicFormSubmissions.push({ ...submission, webhookStatus: webhookResult.skipped ? "skipped" : webhookResult.ok ? "sent" : "failed" });
    await Promise.resolve(writeState(state));
    afterWrite?.();
    return submission;
  }

  return { saveSubmission, ensurePublicFormsTable };
}

module.exports = { createPublicFormsStore, ensurePublicFormsTable };