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

function idSet(items) {
  return new Set(ids(items));
}

function filterHoursForKnownPeople(hours, knownPeopleIds) {
  return (hours || []).filter((entry) => !entry.personId || knownPeopleIds.has(entry.personId));
}

function unlinkUnknownPersonReferences(items, knownPeopleIds, key) {
  return (items || []).map((entry) => {
    const personId = entry?.[key];
    if (!personId || knownPeopleIds.has(personId)) return entry;
    return { ...entry, [key]: "" };
  });
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

  async function writeBlacklist(client, blacklist) {
    const entryIds = ids(blacklist);
    if (entryIds.length) {
      await client.query("delete from blacklist_entries where not (id = any($1::text[]))", [entryIds]);
    } else {
      await client.query("delete from blacklist_entries");
    }
    for (const entry of blacklist) {
      await client.query(`
        insert into blacklist_entries(
          id, person_id, name, discord_id, rank, service_number, reason,
          blacklisted_at, blacklisted_by_id, blacklisted_by_name,
          revoked_at, revoked_by_id, revoked_by_name, revoke_reason, raw, updated_at
        )
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,now())
        on conflict(id) do update set
          person_id = excluded.person_id,
          name = excluded.name,
          discord_id = excluded.discord_id,
          rank = excluded.rank,
          service_number = excluded.service_number,
          reason = excluded.reason,
          blacklisted_at = excluded.blacklisted_at,
          blacklisted_by_id = excluded.blacklisted_by_id,
          blacklisted_by_name = excluded.blacklisted_by_name,
          revoked_at = excluded.revoked_at,
          revoked_by_id = excluded.revoked_by_id,
          revoked_by_name = excluded.revoked_by_name,
          revoke_reason = excluded.revoke_reason,
          raw = excluded.raw,
          updated_at = now()
      `, [
        entry.id,
        entry.personId || null,
        entry.name || "",
        entry.discordId || "",
        entry.rank || "",
        entry.serviceNumber || "",
        entry.reason || "",
        asDateTime(entry.blacklistedAt),
        entry.blacklistedById || "",
        entry.blacklistedByName || "",
        asDateTime(entry.revokedAt),
        entry.revokedById || "",
        entry.revokedByName || "",
        entry.revokeReason || "",
        json(entry, {})
      ]);
    }
  }

  async function upsertHourEntry(client, entry) {
    const hoursValue = Number(entry.hours || 0);
    const minutes = Number(entry.minutes || entry.durationMinutes || Math.round(hoursValue * 60) || 0);
    await client.query(`
      insert into hours(
        id, person_id, discord_id, job, started_at, ended_at, minutes,
        week_year, week_number, hours_value, entered_by_id, entered_by_name, entered_at,
        raw, updated_at
      ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,now())
      on conflict(id) do update set
        person_id = excluded.person_id,
        discord_id = excluded.discord_id,
        job = excluded.job,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        minutes = excluded.minutes,
        week_year = excluded.week_year,
        week_number = excluded.week_number,
        hours_value = excluded.hours_value,
        entered_by_id = excluded.entered_by_id,
        entered_by_name = excluded.entered_by_name,
        entered_at = excluded.entered_at,
        raw = excluded.raw,
        updated_at = now()
    `, [
      entry.id,
      entry.personId || null,
      entry.discordId || "",
      entry.job || "Manual",
      asDateTime(entry.startedAt),
      asDateTime(entry.endedAt),
      minutes,
      Number(entry.weekYear || 0) || null,
      Number(entry.weekNumber || 0) || null,
      Number.isFinite(hoursValue) ? hoursValue : 0,
      entry.enteredById || "",
      entry.enteredByName || "",
      asDateTime(entry.enteredAt),
      json(entry, {})
    ]);
  }

  async function writeHours(client, hours) {
    const hourIds = ids(hours);
    if (hourIds.length) {
      await client.query("delete from hours where not (id = any($1::text[]))", [hourIds]);
    } else {
      await client.query("delete from hours");
    }
    for (const entry of hours) {
      await upsertHourEntry(client, entry);
    }
  }

  async function writeActivity(client, activity) {
    await client.query("delete from activity_log");
    for (let index = 0; index < activity.length; index += 1) {
      await client.query("insert into activity_log(position, message) values($1, $2)", [index, String(activity[index])]);
    }
  }

  async function writeMentorChecklistGroups(state) {
    await withClient(async (client) => {
      await client.query(`
        insert into app_settings(key, value, updated_at)
        values(
          'main',
          jsonb_build_object('mentorChecklistGroups', $1::jsonb),
          now()
        )
        on conflict(key) do update set
          value = coalesce(app_settings.value, '{}'::jsonb) || jsonb_build_object('mentorChecklistGroups', $1::jsonb),
          updated_at = now()
      `, [json(state.mentorChecklistGroups, [])]);
    });
    if (afterWrite) afterWrite();
    return state;
  }

  async function writeState(state) {
    // Personeelsbeheer schrijft hier direct naar de genormaliseerde PostgreSQL-tabellen.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        const people = Array.isArray(state.people) ? state.people : [];
        const knownPeopleIds = idSet(people);
        const hasResignationForms = Array.isArray(state.resignationForms);
        const resignationForms = hasResignationForms
          ? unlinkUnknownPersonReferences(state.resignationForms, knownPeopleIds, "memberId")
          : [];
        const blacklist = unlinkUnknownPersonReferences(
          Array.isArray(state.blacklist) ? state.blacklist : [],
          knownPeopleIds,
          "personId"
        );
        const hours = filterHoursForKnownPeople(Array.isArray(state.hours) ? state.hours : [], knownPeopleIds);
        if (hasResignationForms) state.resignationForms = resignationForms;
        state.blacklist = blacklist;
        state.hours = hours;
        await writePeople(client, people);
        if (hasResignationForms) {
          await writeResignationForms(client, resignationForms);
        }
        await writeBlacklist(client, blacklist);
        await writeHours(client, hours);
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
        const activityMessages = Array.isArray(activityMessage)
          ? activityMessage.filter(Boolean)
          : [activityMessage].filter(Boolean);
        for (const message of activityMessages) {
          await client.query(`
            insert into activity_log(position, message)
            values((select coalesce(max(position), -1) + 1 from activity_log), $1)
          `, [String(message)]);
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


  async function writePersonNotifications(person) {
    // Persoonsgebonden meldingen zitten in raw, zodat er geen losse notificatietabel nodig is.
    await withClient(async (client) => {
      const result = await client.query(`
        update people
        set raw = $2::jsonb, updated_at = now()
        where id = $1
      `, [person.id, json(person, {})]);
      if (result.rowCount !== 1) {
        throw new Error("Personeelslid niet gevonden voor notificatie-update.");
      }
    });
    if (afterWrite) afterWrite();
    return person;
  }
  async function writePersonDiscipline(person, activityMessage) {
    // Sancties/waarschuwingen raken alleen het disciplineveld van één profiel.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        const result = await client.query(`
          update people
          set
            discipline = $2::jsonb,
            raw = $3::jsonb,
            updated_at = now()
          where id = $1
        `, [
          person.id,
          json(person.discipline, []),
          json(person, {})
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Personeelslid niet gevonden voor sanctie-update.");
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

  async function writeManualHoursEntries(entries, activityMessages = []) {
    // Handmatige weekuren zijn losse rijen per profiel/week, zodat bulk invoer niet de rest van de state overschrijft.
    await withClient(async (client) => {
      await client.query("begin");
      try {
        for (const entry of entries) {
          await upsertHourEntry(client, entry);
        }
        for (const message of activityMessages.filter(Boolean)) {
          await client.query(`
            insert into activity_log(position, message)
            values((select coalesce(max(position), -1) + 1 from activity_log), $1)
          `, [String(message)]);
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    });
    if (afterWrite) afterWrite();
    return entries;
  }
  return { readState, writeState, writePersonQualifications, writePersonNotifications, writePersonDiscipline, writeManualHoursEntries, writeMentorChecklistGroups };
}

module.exports = { createPostgresPeopleStore };
