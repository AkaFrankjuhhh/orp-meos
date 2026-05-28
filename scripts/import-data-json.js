const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { withClient } = require("../modules/db");

const replace = process.argv.includes("--replace");
const root = path.join(__dirname, "..");
const inputIndex = process.argv.indexOf("--input");
const dataPath = inputIndex >= 0 && process.argv[inputIndex + 1] ? path.resolve(process.argv[inputIndex + 1]) : path.join(root, "data.json");

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function asDateTime(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function stableId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(5, "0")}`;
}

async function clearTables(client) {
  await client.query("delete from activity_log");
  await client.query("delete from porto_units");
  await client.query("delete from hours");
  await client.query("delete from blacklist_entries");
  await client.query("delete from resignation_forms");
  await client.query("delete from i8_forms");
  await client.query("delete from absences");
  await client.query("delete from people");
  await client.query("delete from app_settings");
}

async function importSettings(client, state) {
  const settings = {
    theme: state.theme || "dark",
    discord: state.discord || {},
    mentorChecklistGroups: state.mentorChecklistGroups || [],
    portoVehicleRanges: state.portoVehicleRanges || [],
    portoCurrentOps: state.portoCurrentOps || null,
    announcements: state.announcements || []
  };
  await client.query(`
    insert into app_settings(key, value, updated_at)
    values('main', $1::jsonb, now())
    on conflict(key) do update set value = excluded.value, updated_at = now()
  `, [json(settings, {})]);
}

async function importPeople(client, people = []) {
  for (const person of people) {
    await client.query(`
      insert into people(
        id, name, discord_id, discord_username, avatar, rank, service_number, perm_role,
        rank_date, promotion_date, hired_date, status, tasks, previous_service_number,
        dismissal_date, dismissal_reason, archived_until, reactivated_date, porto_phone,
        discord_roles, completed_trainings, completed_operational, badges, extra_functions,
        rank_history, discipline, mentor_checklist, raw, updated_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,$26::jsonb,$27::jsonb,$28::jsonb,now()
      )
      on conflict(id) do update set
        name = excluded.name,
        discord_id = excluded.discord_id,
        discord_username = excluded.discord_username,
        avatar = excluded.avatar,
        rank = excluded.rank,
        service_number = excluded.service_number,
        perm_role = excluded.perm_role,
        rank_date = excluded.rank_date,
        promotion_date = excluded.promotion_date,
        hired_date = excluded.hired_date,
        status = excluded.status,
        tasks = excluded.tasks,
        previous_service_number = excluded.previous_service_number,
        dismissal_date = excluded.dismissal_date,
        dismissal_reason = excluded.dismissal_reason,
        archived_until = excluded.archived_until,
        reactivated_date = excluded.reactivated_date,
        porto_phone = excluded.porto_phone,
        discord_roles = excluded.discord_roles,
        completed_trainings = excluded.completed_trainings,
        completed_operational = excluded.completed_operational,
        badges = excluded.badges,
        extra_functions = excluded.extra_functions,
        rank_history = excluded.rank_history,
        discipline = excluded.discipline,
        mentor_checklist = excluded.mentor_checklist,
        raw = excluded.raw,
        updated_at = now()
    `, [
      person.id,
      person.name || "Onbekend",
      person.discordId || "",
      person.discordUsername || "",
      person.avatar || "",
      person.rank || "",
      person.serviceNumber || "",
      person.permRole || "Geen",
      person.rankDate || "",
      person.promotionDate || "",
      person.hiredDate || "",
      person.status || "Actief",
      person.tasks || "",
      person.previousServiceNumber || "",
      person.dismissalDate || "",
      person.dismissalReason || "",
      person.archivedUntil || "",
      person.reactivatedDate || "",
      person.portoPhone || "",
      json(person.discordRoles, []),
      json(person.completedTrainings, []),
      json(person.completedOperational, []),
      json(person.badges, []),
      json(person.extraFunctions, []),
      json(person.rankHistory, []),
      json(person.discipline, []),
      json(person.mentorChecklist, {}),
      json(person, {})
    ]);
  }
}

async function importAbsences(client, absences = []) {
  for (let index = 0; index < absences.length; index += 1) {
    const item = absences[index];
    await client.query(`
      insert into absences(id, member_id, name, rank, service_number, from_date, to_date, reason, status, requested_at, reviewed_at, reviewed_by_id, reviewed_by_name, raw, updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
      on conflict(id) do update set status = excluded.status, reviewed_at = excluded.reviewed_at, reviewed_by_id = excluded.reviewed_by_id, reviewed_by_name = excluded.reviewed_by_name, raw = excluded.raw, updated_at = now()
    `, [item.id || stableId("absence", index), item.memberId || null, item.name || "", item.rank || "", item.serviceNumber || "", item.from || "", item.to || "", item.reason || "", item.status || "", asDateTime(item.requestedAt), asDateTime(item.reviewedAt), item.reviewedById || "", item.reviewedByName || "", json(item, {})]);
  }
}

async function importI8Forms(client, forms = []) {
  for (const form of forms) {
    await client.query(`
      insert into i8_forms(id, i8_number, person_id, person_name, service_number, rank, violence_date, violence_time, location, opco_ovd_name, description, force_used, vehicle_violence, third_party_injury, truth_confirmed, status, rejection_reason, created_at, reviewed_at, reviewed_by_id, reviewed_by_name, raw, updated_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,now())
      on conflict(id) do update set i8_number = excluded.i8_number, status = excluded.status, rejection_reason = excluded.rejection_reason, reviewed_at = excluded.reviewed_at, reviewed_by_id = excluded.reviewed_by_id, reviewed_by_name = excluded.reviewed_by_name, raw = excluded.raw, updated_at = now()
    `, [form.id, form.i8Number || "", form.personId || null, form.personName || "", form.serviceNumber || "", form.rank || "", form.violenceDate || "", form.violenceTime || "", form.location || "", form.opcoOvdName || "", form.description || "", form.forceUsed || "", form.vehicleViolence || "", form.thirdPartyInjury || "", Boolean(form.truthConfirmed), form.status || "pending", form.rejectionReason || "", asDateTime(form.createdAt), asDateTime(form.reviewedAt), form.reviewedById || "", form.reviewedByName || "", json(form, {})]);
  }
}

async function importSimpleJsonRows(client, table, rows = [], mapper) {
  for (let index = 0; index < rows.length; index += 1) {
    await mapper(rows[index], index);
  }
}

async function importRest(client, state) {
  await importSimpleJsonRows(client, "resignation_forms", state.resignationForms || [], async (form, index) => {
    await client.query(`insert into resignation_forms(id, member_id, name, rank, service_number, reason, status, requested_at, processed_at, processed_by_id, processed_by_name, raw, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now()) on conflict(id) do update set status = excluded.status, processed_at = excluded.processed_at, processed_by_id = excluded.processed_by_id, processed_by_name = excluded.processed_by_name, raw = excluded.raw, updated_at = now()`, [form.id || stableId("resignation", index), form.memberId || null, form.name || "", form.rank || "", form.serviceNumber || "", form.reason || "", form.status || "", asDateTime(form.requestedAt), asDateTime(form.processedAt), form.processedById || "", form.processedByName || "", json(form, {})]);
  });

  await importSimpleJsonRows(client, "blacklist_entries", state.blacklist || [], async (entry, index) => {
    await client.query(`insert into blacklist_entries(id, person_id, name, discord_id, rank, service_number, reason, blacklisted_at, blacklisted_by_id, blacklisted_by_name, revoked_at, revoked_by_id, revoked_by_name, revoke_reason, raw, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now()) on conflict(id) do update set person_id = excluded.person_id, name = excluded.name, discord_id = excluded.discord_id, rank = excluded.rank, service_number = excluded.service_number, reason = excluded.reason, blacklisted_at = excluded.blacklisted_at, blacklisted_by_id = excluded.blacklisted_by_id, blacklisted_by_name = excluded.blacklisted_by_name, revoked_at = excluded.revoked_at, revoked_by_id = excluded.revoked_by_id, revoked_by_name = excluded.revoked_by_name, revoke_reason = excluded.revoke_reason, raw = excluded.raw, updated_at = now()`, [entry.id || stableId("blacklist", index), entry.personId || null, entry.name || "", entry.discordId || "", entry.rank || "", entry.serviceNumber || "", entry.reason || "", asDateTime(entry.blacklistedAt), entry.blacklistedById || "", entry.blacklistedByName || "", asDateTime(entry.revokedAt), entry.revokedById || "", entry.revokedByName || "", entry.revokeReason || "", json(entry, {})]);
  });

  await importSimpleJsonRows(client, "hours", state.hours || [], async (entry, index) => {
    await client.query(`insert into hours(id, person_id, discord_id, job, started_at, ended_at, minutes, raw, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now()) on conflict(id) do update set minutes = excluded.minutes, raw = excluded.raw, updated_at = now()`, [entry.id || stableId("hours", index), entry.personId || null, entry.discordId || "", entry.job || "", asDateTime(entry.startedAt), asDateTime(entry.endedAt), Number(entry.minutes || entry.durationMinutes || 0), json(entry, {})]);
  });

  await importSimpleJsonRows(client, "porto_units", state.portoUnits || [], async (unit, index) => {
    await client.query(`insert into porto_units(id, member_id, name, rank, service_number, phone, status, status_detail, vehicle_number, vehicle_code, vehicle_type, vehicle_name, linked_with, active, requested_at, assigned_at, ended_at, last_seen_at, raw, updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,$19::jsonb,now()) on conflict(id) do update set status = excluded.status, status_detail = excluded.status_detail, vehicle_number = excluded.vehicle_number, vehicle_name = excluded.vehicle_name, linked_with = excluded.linked_with, active = excluded.active, raw = excluded.raw, updated_at = now()`, [unit.id || crypto.randomUUID(), unit.memberId || null, unit.name || "", unit.rank || "", unit.serviceNumber || "", unit.phone || "", unit.status || "", unit.statusDetail || "", unit.vehicleNumber || "", unit.vehicleCode || "", unit.vehicleType || "", unit.vehicleName || "", json(unit.linkedWith, []), unit.active !== false, asDateTime(unit.requestedAt), asDateTime(unit.assignedAt), asDateTime(unit.endedAt), asDateTime(unit.lastSeenAt), json(unit, {})]);
  });

  const activity = Array.isArray(state.activity) ? state.activity : [];
  for (let index = 0; index < activity.length; index += 1) {
    await client.query("insert into activity_log(position, message) values($1, $2)", [index, String(activity[index])]);
  }
}

(async () => {
  if (!fs.existsSync(dataPath)) throw new Error(`data.json niet gevonden: ${dataPath}`);
  const state = JSON.parse(fs.readFileSync(dataPath, "utf8").replace(/^\uFEFF/, ""));
  await withClient(async (client) => {
    await client.query("begin");
    try {
      if (replace) await clearTables(client);
      await importSettings(client, state);
      await importPeople(client, state.people || []);
      await importAbsences(client, state.absences || []);
      await importI8Forms(client, state.i8Forms || []);
      await importRest(client, state);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
  console.log(`Import klaar: ${(state.people || []).length} personen, ${(state.i8Forms || []).length} I8 formulieren, ${(state.absences || []).length} afwezigheden.`);
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

