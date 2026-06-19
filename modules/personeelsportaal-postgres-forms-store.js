const { readPostgresState } = require("./postgres-state");
const { withClient } = require("./db");

function json(value, fallback) {
  return JSON.stringify(value == null ? fallback : value);
}

function asDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function appendActivityMessages(client, messages = []) {
  for (const message of messages.filter(Boolean)) {
    await client.query("insert into activity_log(message) values($1)", [String(message)]);
  }
}

async function lockFormsWrite(client) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", ["forms-write"]);
}

async function appendActivitySuffix(client, activity = []) {
  if (!Array.isArray(activity)) return;
  const result = await client.query("select message from activity_log order by position nulls last, id asc");
  const existingCount = result.rows.length;
  const nextMessages = activity.slice(existingCount).filter(Boolean);
  await appendActivityMessages(client, nextMessages);
}

async function upsertAbsence(client, absence) {
  await client.query(`
    insert into absences(
      id, member_id, name, rank, service_number, from_date, to_date, reason, status,
      requested_at, reviewed_at, reviewed_by_id, reviewed_by_name, raw, updated_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
    on conflict(id) do update set
      member_id = excluded.member_id,
      name = excluded.name,
      rank = excluded.rank,
      service_number = excluded.service_number,
      from_date = excluded.from_date,
      to_date = excluded.to_date,
      reason = excluded.reason,
      status = excluded.status,
      requested_at = excluded.requested_at,
      reviewed_at = excluded.reviewed_at,
      reviewed_by_id = excluded.reviewed_by_id,
      reviewed_by_name = excluded.reviewed_by_name,
      raw = excluded.raw,
      updated_at = now()
  `, [
    absence.id,
    absence.memberId || null,
    absence.name || "",
    absence.rank || "",
    absence.serviceNumber || "",
    absence.from || "",
    absence.to || "",
    absence.reason || "",
    absence.status || "",
    asDateTime(absence.requestedAt),
    asDateTime(absence.reviewedAt),
    absence.reviewedById || "",
    absence.reviewedByName || "",
    json(absence, {})
  ]);
}

async function upsertI8Form(client, form) {
  await client.query(`
    insert into i8_forms(
      id, i8_number, person_id, person_name, service_number, rank, violence_date, violence_time,
      location, opco_ovd_name, description, force_used, vehicle_violence,
      third_party_injury, truth_confirmed, status, rejection_reason, created_at,
      reviewed_at, reviewed_by_id, reviewed_by_name, raw, updated_at
    ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,now())
    on conflict(id) do update set
      i8_number = excluded.i8_number,
      person_id = excluded.person_id,
      person_name = excluded.person_name,
      service_number = excluded.service_number,
      rank = excluded.rank,
      violence_date = excluded.violence_date,
      violence_time = excluded.violence_time,
      location = excluded.location,
      opco_ovd_name = excluded.opco_ovd_name,
      description = excluded.description,
      force_used = excluded.force_used,
      vehicle_violence = excluded.vehicle_violence,
      third_party_injury = excluded.third_party_injury,
      truth_confirmed = excluded.truth_confirmed,
      status = excluded.status,
      rejection_reason = excluded.rejection_reason,
      created_at = excluded.created_at,
      reviewed_at = excluded.reviewed_at,
      reviewed_by_id = excluded.reviewed_by_id,
      reviewed_by_name = excluded.reviewed_by_name,
      raw = excluded.raw,
      updated_at = now()
  `, [
    form.id,
    form.i8Number || "",
    form.personId || null,
    form.personName || "",
    form.serviceNumber || "",
    form.rank || "",
    form.violenceDate || "",
    form.violenceTime || "",
    form.location || "",
    form.opcoOvdName || "",
    form.description || "",
    form.forceUsed || "",
    form.vehicleViolence || "",
    form.thirdPartyInjury || "",
    Boolean(form.truthConfirmed),
    form.status || "pending",
    form.rejectionReason || "",
    asDateTime(form.createdAt),
    asDateTime(form.reviewedAt),
    form.reviewedById || "",
    form.reviewedByName || "",
    json(form, {})
  ]);
}

function createPostgresFormsStore(options = {}) {
  const afterWrite = typeof options.afterWrite === "function" ? options.afterWrite : null;
  async function readState() {
    return readPostgresState();
  }

  async function writeState(state = {}) {
    // Fallback voor JSON-achtige mutaties. Schrijf alleen aanwezige delen terug,
    // zodat een gedeeltelijke state nooit per ongeluk formulierdata wist.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        if (Array.isArray(state.absences)) {
          for (const absence of state.absences) {
            await upsertAbsence(client, absence);
          }
        }

        if (Array.isArray(state.i8Forms)) {
          for (const form of state.i8Forms) {
            await upsertI8Form(client, form);
          }
        }

        await appendActivitySuffix(client, state.activity);

        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return state;
  }

  async function createAbsence(absence, activityMessages = []) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        await upsertAbsence(client, absence);
        await appendActivityMessages(client, activityMessages);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return absence;
  }

  async function updateAbsence(absence, activityMessages = []) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        await upsertAbsence(client, absence);
        await appendActivityMessages(client, activityMessages);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return absence;
  }

  async function deleteAbsence(absenceId, activityMessages = []) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        await client.query("delete from absences where id = $1", [absenceId]);
        await appendActivityMessages(client, activityMessages);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return { id: absenceId };
  }

  async function createI8Form(form, activityMessages = []) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        await upsertI8Form(client, form);
        await appendActivityMessages(client, activityMessages);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return form;
  }

  // Gerichte delete voorkomt dat het volledige formulierenbestand herschreven hoeft te worden.
  async function deleteI8Form(formId, activityMessages = []) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        await client.query("delete from i8_forms where id = $1", [formId]);
        await appendActivityMessages(client, activityMessages);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return { id: formId };
  }

  async function updateI8Form(form, activityMessages = []) {
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await lockFormsWrite(client);
        await upsertI8Form(client, form);
        await appendActivityMessages(client, activityMessages);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return form;
  }

  return { readState, writeState, createAbsence, updateAbsence, deleteAbsence, createI8Form, updateI8Form, deleteI8Form };
}

module.exports = { createPostgresFormsStore };
