const crypto = require("node:crypto");
const { withClient } = require("./db");

let ensured = false;
const caseNumberFormSlugs = new Set(["klachten", "interne-klacht"]);

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
      case_number integer,
      webhook_status text,
      raw jsonb not null default '{}'::jsonb
    )
  `));
  await withClient((client) => client.query("alter table public_form_submissions add column if not exists case_number integer"));
  await withClient((client) => client.query("create index if not exists public_form_submissions_slug_idx on public_form_submissions(form_slug, submitted_at desc)"));
  await withClient((client) => client.query("create unique index if not exists public_form_submissions_slug_case_number_uidx on public_form_submissions(form_slug, case_number) where case_number is not null"));
  await withClient((client) => client.query(`
    create table if not exists public_form_configs (
      slug text primary key,
      config jsonb not null default '{}'::jsonb,
      updated_by_id text,
      updated_by_name text,
      updated_at timestamptz not null default now()
    )
  `));
  await withClient((client) => client.query(`
    create table if not exists audit_log (
      id uuid primary key,
      scope text not null,
      action text not null,
      target_id text,
      target_label text,
      actor_id text,
      actor_name text,
      details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `));
  await withClient((client) => client.query("create index if not exists audit_log_scope_created_idx on audit_log(scope, created_at desc)"));
  await withClient((client) => client.query("create index if not exists audit_log_target_idx on audit_log(target_id, created_at desc)"));
  ensured = true;
}

function publicFormWebhookStatus(webhookResult = {}) {
  if (webhookResult.pending) return "pending";
  if (webhookResult.skipped) return "skipped";
  if (webhookResult.ok) return "sent";
  return `failed:${webhookResult.status || "unknown"}`;
}

function shouldAssignCaseNumber(submission) {
  return caseNumberFormSlugs.has(submission?.formSlug) && !Number(submission.caseNumber || 0);
}

function createPublicFormsStore({ storageMode, readState, writeState, afterWrite } = {}) {
  async function saveSubmission(submission, webhookResult = {}) {
    if (storageMode === "postgres") {
      await ensurePublicFormsTable();
      await withClient(async (client) => {
        await client.query("begin");
        try {
          if (shouldAssignCaseNumber(submission)) {
            await client.query("select pg_advisory_xact_lock(hashtext($1))", [`public-form-case:${submission.formSlug}`]);
            const result = await client.query("select coalesce(max(case_number), 0) + 1 as next_case_number from public_form_submissions where form_slug = $1", [submission.formSlug]);
            submission.caseNumber = Number(result.rows[0]?.next_case_number || 1);
          }
          await client.query(
            `insert into public_form_submissions(id, form_slug, form_title, answers, submitted_at, ip, user_agent, case_number, webhook_status, raw)
             values($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb)
             on conflict (id) do update set
               form_slug = excluded.form_slug,
               form_title = excluded.form_title,
               answers = excluded.answers,
               submitted_at = excluded.submitted_at,
               ip = excluded.ip,
               user_agent = excluded.user_agent,
               case_number = coalesce(public_form_submissions.case_number, excluded.case_number),
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
              submission.caseNumber || null,
              publicFormWebhookStatus(webhookResult),
              JSON.stringify(submission)
            ]
          );
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
      afterWrite?.();
      return submission;
    }

    const state = await Promise.resolve(readState());
    state.publicFormSubmissions = Array.isArray(state.publicFormSubmissions) ? state.publicFormSubmissions : [];
    if (shouldAssignCaseNumber(submission)) {
      const maxCaseNumber = state.publicFormSubmissions
        .filter((item) => item.formSlug === submission.formSlug)
        .reduce((max, item) => Math.max(max, Number(item.caseNumber || 0)), 0);
      submission.caseNumber = maxCaseNumber + 1;
    }
    const storedSubmission = { ...submission, webhookStatus: publicFormWebhookStatus(webhookResult) };
    const existingIndex = state.publicFormSubmissions.findIndex((item) => item.id === submission.id);
    if (existingIndex >= 0) state.publicFormSubmissions[existingIndex] = { ...state.publicFormSubmissions[existingIndex], ...storedSubmission };
    else state.publicFormSubmissions.push(storedSubmission);
    await Promise.resolve(writeState(state));
    afterWrite?.();
    return submission;
  }

  async function readConfigOverride(slug) {
    if (storageMode === "postgres") {
      await ensurePublicFormsTable();
      const result = await withClient((client) => client.query("select config from public_form_configs where slug = $1", [slug]));
      return result.rows[0]?.config || {};
    }
    const state = await Promise.resolve(readState());
    return state.publicFormConfigs?.[slug] || {};
  }

  async function saveConfigOverride(slug, override, actor) {
    if (storageMode === "postgres") {
      await ensurePublicFormsTable();
      await withClient(async (client) => {
        await client.query("begin");
        try {
          await client.query(`insert into public_form_configs(slug, config, updated_by_id, updated_by_name, updated_at)
            values($1, $2::jsonb, $3, $4, now())
            on conflict(slug) do update set
              config = excluded.config,
              updated_by_id = excluded.updated_by_id,
              updated_by_name = excluded.updated_by_name,
              updated_at = now()`, [slug, JSON.stringify(override || {}), actor?.id || "", actor?.name || ""]);
          await client.query(`insert into audit_log(id, scope, action, target_id, target_label, actor_id, actor_name, details)
            values($1, 'forms', 'Formulierconfig bijgewerkt', $2, $3, $4, $5, $6::jsonb)`, [crypto.randomUUID(), slug, slug, actor?.id || "", actor?.name || "", JSON.stringify({ slug })]);
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      });
      afterWrite?.();
      return override;
    }

    const state = await Promise.resolve(readState());
    state.publicFormConfigs = state.publicFormConfigs || {};
    state.publicFormConfigs[slug] = override || {};
    state.activity = state.activity || [];
    state.activity.push(`${actor?.name || "Onbekend"} heeft formulierconfig ${slug} bijgewerkt.`);
    await Promise.resolve(writeState(state));
    afterWrite?.();
    return override;
  }

  return { saveSubmission, ensurePublicFormsTable, readConfigOverride, saveConfigOverride };
}

module.exports = { createPublicFormsStore, ensurePublicFormsTable };
