const { withClient } = require("./db");
const { currentOrganization } = require("./organizations");
const {
  DEFAULT_PORTO_DUTY_HOURS_START_WEEK,
  filterPortoDutyHourEntriesByStartWeek
} = require("./porto-duty-hours");

const organization = currentOrganization();

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function iso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function stripEmpty(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isLegacyDefensieMentorTemplate(groups) {
  if (!Array.isArray(groups) || groups.length !== 2) return false;
  const titles = groups.map((group) => String(group?.title || "").trim());
  const labels = groups.flatMap((group) => Array.isArray(group?.items) ? group.items : []).map((item) => String(typeof item === "string" ? item : item?.label || ""));
  return titles.includes("Praktijk")
    && titles.includes("Theorie")
    && labels.includes("Leerling weet hoe MEOS werkt")
    && labels.includes("Leerling kent de douane gebieden");
}

function mentorChecklistGroupsFromSettings(settings) {
  const configured = settings.mentorChecklistGroups;
  if (organization.key === "politie" && isLegacyDefensieMentorTemplate(configured)) {
    return organization.mentorChecklistGroups || [];
  }
  return configured || [];
}

async function readPostgresState() {
  return withClient(async (client) => {
    const settingsResult = await client.query("select value from app_settings where key = 'main'");
    const settings = settingsResult.rows[0]?.value || {};

    const peopleResult = await client.query("select * from people order by name asc");
    const people = peopleResult.rows.map((row) => ({
      ...parseJson(row.raw, {}),
      id: row.id,
      name: row.name,
      discordId: row.discord_id || "",
      discordUsername: row.discord_username || "",
      avatar: row.avatar || "",
      rank: row.rank || "",
      serviceNumber: row.service_number || "",
      permRole: row.perm_role || "Geen",
      rankDate: row.rank_date || "",
      promotionDate: row.promotion_date || "",
      hiredDate: row.hired_date || "",
      status: row.status || "Actief",
      tasks: row.tasks || "",
      previousServiceNumber: row.previous_service_number || "",
      dismissalDate: row.dismissal_date || "",
      dismissalReason: row.dismissal_reason || "",
      archivedUntil: row.archived_until || "",
      reactivatedDate: row.reactivated_date || "",
      portoPhone: row.porto_phone || "",
      discordRoles: parseJson(row.discord_roles, []),
      completedTrainings: parseJson(row.completed_trainings, []),
      completedOperational: parseJson(row.completed_operational, []),
      badges: parseJson(row.badges, []),
      extraFunctions: parseJson(row.extra_functions, []),
      rankHistory: parseJson(row.rank_history, []),
      discipline: parseJson(row.discipline, []),
      mentorChecklist: parseJson(row.mentor_checklist, {})
    }));

    const absencesResult = await client.query("select * from absences order by requested_at nulls last, id asc");
    const absences = absencesResult.rows.map((row) => stripEmpty({
      ...parseJson(row.raw, {}),
      id: row.id,
      memberId: row.member_id || "",
      name: row.name || "",
      rank: row.rank || "",
      serviceNumber: row.service_number || "",
      from: row.from_date || "",
      to: row.to_date || "",
      reason: row.reason || "",
      status: row.status || "",
      requestedAt: iso(row.requested_at),
      reviewedAt: iso(row.reviewed_at),
      reviewedById: row.reviewed_by_id || "",
      reviewedByName: row.reviewed_by_name || ""
    }));

    const i8Result = await client.query("select * from i8_forms order by created_at nulls last, id asc");
    const i8Forms = i8Result.rows.map((row) => ({
      ...parseJson(row.raw, {}),
      id: row.id,
      i8Number: row.i8_number || "",
      personId: row.person_id || "",
      personName: row.person_name || "",
      serviceNumber: row.service_number || "",
      rank: row.rank || "",
      violenceDate: row.violence_date || "",
      violenceTime: row.violence_time || "",
      location: row.location || "",
      opcoOvdName: row.opco_ovd_name || "",
      description: row.description || "",
      forceUsed: row.force_used || "",
      vehicleViolence: row.vehicle_violence || "",
      thirdPartyInjury: row.third_party_injury || "",
      truthConfirmed: Boolean(row.truth_confirmed),
      status: row.status || "pending",
      rejectionReason: row.rejection_reason || "",
      createdAt: iso(row.created_at),
      reviewedAt: iso(row.reviewed_at),
      reviewedById: row.reviewed_by_id || "",
      reviewedByName: row.reviewed_by_name || ""
    }));

    const resignationResult = await client.query("select * from resignation_forms order by requested_at nulls last, id asc");
    const resignationForms = resignationResult.rows.map((row) => ({
      ...parseJson(row.raw, {}),
      id: row.id,
      memberId: row.member_id || "",
      name: row.name || "",
      rank: row.rank || "",
      serviceNumber: row.service_number || "",
      reason: row.reason || "",
      status: row.status || "",
      requestedAt: iso(row.requested_at),
      processedAt: iso(row.processed_at),
      processedById: row.processed_by_id || "",
      processedByName: row.processed_by_name || ""
    }));

    const blacklistResult = await client.query("select * from blacklist_entries order by blacklisted_at desc nulls last, id asc");
    const blacklist = blacklistResult.rows.map((row) => ({
      ...parseJson(row.raw, {}),
      id: row.id,
      personId: row.person_id || "",
      name: row.name || "",
      discordId: row.discord_id || "",
      rank: row.rank || "",
      serviceNumber: row.service_number || "",
      reason: row.reason || "",
      blacklistedAt: iso(row.blacklisted_at),
      blacklistedById: row.blacklisted_by_id || "",
      blacklistedByName: row.blacklisted_by_name || "",
      revokedAt: iso(row.revoked_at),
      revokedById: row.revoked_by_id || "",
      revokedByName: row.revoked_by_name || "",
      revokeReason: row.revoke_reason || ""
    }));

    const hoursResult = await client.query("select * from hours order by week_year desc nulls last, week_number desc nulls last, started_at nulls last, id asc");
    const rawHours = hoursResult.rows.map((row) => {
      const raw = parseJson(row.raw, {});
      const hoursValue = row.hours_value != null ? Number(row.hours_value) : Number(raw.hours || row.minutes / 60 || 0);
      return {
        ...raw,
        id: row.id,
        personId: row.person_id || "",
        discordId: row.discord_id || "",
        job: row.job || "",
        startedAt: iso(row.started_at),
        endedAt: iso(row.ended_at),
        minutes: Number(row.minutes || 0),
        weekYear: row.week_year || raw.weekYear || null,
        weekNumber: row.week_number || raw.weekNumber || null,
        hours: Number.isFinite(hoursValue) ? hoursValue : 0,
        enteredById: row.entered_by_id || raw.enteredById || "",
        enteredByName: row.entered_by_name || raw.enteredByName || "",
        enteredAt: iso(row.entered_at) || raw.enteredAt || ""
      };
    });
    const hours = filterPortoDutyHourEntriesByStartWeek(
      rawHours,
      process.env.PORTO_DUTY_HOURS_START_WEEK || DEFAULT_PORTO_DUTY_HOURS_START_WEEK
    );

    const portoResult = await client.query("select * from porto_units order by requested_at nulls last, id asc");
    const portoUnits = portoResult.rows.map((row) => ({
      ...parseJson(row.raw, {}),
      id: row.id,
      memberId: row.member_id || "",
      name: row.name || "",
      rank: row.rank || "",
      serviceNumber: row.service_number || "",
      phone: row.phone || "",
      status: row.status || "",
      statusDetail: row.status_detail || "",
      vehicleNumber: row.vehicle_number || "",
      vehicleCode: row.vehicle_code || "",
      vehicleType: row.vehicle_type || "",
      vehicleName: row.vehicle_name || "",
      linkedWith: parseJson(row.linked_with, []),
      active: row.active !== false,
      requestedAt: iso(row.requested_at),
      assignedAt: iso(row.assigned_at),
      endedAt: iso(row.ended_at),
      lastSeenAt: iso(row.last_seen_at)
    }));

    const activityResult = await client.query("select message from activity_log order by position nulls last, id asc");
    const activity = activityResult.rows.map((row) => row.message);

    return {
      theme: settings.theme || "dark",
      discord: settings.discord || {},
      people,
      hours,
      trainings: [],
      absences,
      activity,
      announcements: settings.announcements || [],
      i8Forms,
      resignationForms,
      blacklist,
      mentorChecklistGroups: mentorChecklistGroupsFromSettings(settings),
      portoUnits,
      portoVehicleRanges: settings.portoVehicleRanges || [],
      portoCurrentOps: settings.portoCurrentOps || null,
      portoOpsLog: settings.portoOpsLog || []
    };
  });
}

module.exports = { readPostgresState };
