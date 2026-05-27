const crypto = require("node:crypto");
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
