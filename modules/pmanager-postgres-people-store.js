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

function ids(items) {
  return (items || []).map((item) => item.id).filter(Boolean);
}

function createPostgresPeopleStore(options = {}) {
  const afterWrite = typeof options.afterWrite === "function" ? options.afterWrite : null;

  async function readState() {
    return readPostgresState();
  }

  async function writePeople(client, people) {
    const peopleIds = ids(people);
    if (peopleIds.length) {
      await client.query("delete from people where not (id = any($1::text[]))", [peopleIds]);
    } else {
      await client.query("delete from people");
    }

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

  async function writeResignationForms(client, forms) {
    const formIds = ids(forms);
    if (formIds.length) {
      await client.query("delete from resignation_forms where not (id = any($1::text[]))", [formIds]);
    } else {
      await client.query("delete from resignation_forms");
    }
    for (const form of forms) {
      await client.query(`
        insert into resignation_forms(id, member_id, name, rank, service_number, reason, status, requested_at, processed_at, processed_by_id, processed_by_name, raw, updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now())
        on conflict(id) do update set
          member_id = excluded.member_id,
          name = excluded.name,
          rank = excluded.rank,
          service_number = excluded.service_number,
          reason = excluded.reason,
          status = excluded.status,
          requested_at = excluded.requested_at,
          processed_at = excluded.processed_at,
          processed_by_id = excluded.processed_by_id,
          processed_by_name = excluded.processed_by_name,
          raw = excluded.raw,
          updated_at = now()
      `, [
        form.id,
        form.memberId || null,
        form.name || "",
        form.rank || "",
        form.serviceNumber || "",
        form.reason || "",
        form.status || "",
        asDateTime(form.requestedAt),
        asDateTime(form.processedAt),
        form.processedById || "",
        form.processedByName || "",
        json(form, {})
      ]);
    }
  }

  async function writeHours(client, hours) {
    const hourIds = ids(hours);
    if (hourIds.length) {
      await client.query("delete from hours where not (id = any($1::text[]))", [hourIds]);
    } else {
      await client.query("delete from hours");
    }
    for (const entry of hours) {
      await client.query(`
        insert into hours(id, person_id, discord_id, job, started_at, ended_at, minutes, raw, updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
        on conflict(id) do update set
          person_id = excluded.person_id,
          discord_id = excluded.discord_id,
          job = excluded.job,
          started_at = excluded.started_at,
          ended_at = excluded.ended_at,
          minutes = excluded.minutes,
          raw = excluded.raw,
          updated_at = now()
      `, [
        entry.id,
        entry.personId || null,
        entry.discordId || "",
        entry.job || "",
        asDateTime(entry.startedAt),
        asDateTime(entry.endedAt),
        Number(entry.minutes || entry.durationMinutes || 0),
        json(entry, {})
      ]);
    }
  }

  async function writeActivity(client, activity) {
    await client.query("delete from activity_log");
    for (let index = 0; index < activity.length; index += 1) {
      await client.query("insert into activity_log(position, message) values($1, $2)", [index, String(activity[index])]);
    }
  }

  async function writeState(state) {
    // Personeelsbeheer schrijft hier direct naar de genormaliseerde PostgreSQL-tabellen.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        await writePeople(client, Array.isArray(state.people) ? state.people : []);
        await writeResignationForms(client, Array.isArray(state.resignationForms) ? state.resignationForms : []);
        await writeHours(client, Array.isArray(state.hours) ? state.hours : []);
        await writeActivity(client, Array.isArray(state.activity) ? state.activity : []);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return state;
  }

  async function writePersonQualifications(person, activityMessage) {
    // Trainingen/operationeel worden vaak aangeklikt; deze update raakt alleen het gekozen profiel.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        const result = await client.query(`
          update people
          set
            completed_trainings = $2::jsonb,
            completed_operational = $3::jsonb,
            raw = $4::jsonb,
            updated_at = now()
          where id = $1
        `, [
          person.id,
          json(person.completedTrainings, []),
          json(person.completedOperational, []),
          json(person, {})
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Personeelslid niet gevonden voor kwalificatie-update.");
        }
        if (activityMessage) {
          await client.query(`
            insert into activity_log(position, message)
            values((select coalesce(max(position), -1) + 1 from activity_log), $1)
          `, [String(activityMessage)]);
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return person;
  }

  return { readState, writeState, writePersonQualifications };
}

module.exports = { createPostgresPeopleStore };
