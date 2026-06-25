"use strict";

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function localDateMs(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
}

function zonedTimeToUtc(local, timeZone) {
  let utcMs = localDateMs(local);
  for (let i = 0; i < 2; i += 1) {
    const actual = zonedParts(new Date(utcMs), timeZone);
    utcMs -= localDateMs(actual) - localDateMs(local);
  }
  return new Date(utcMs);
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour || 0, parts.minute || 0, parts.second || 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour || 0,
    minute: parts.minute || 0,
    second: parts.second || 0
  };
}

function localDayOfWeek(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function isoWeekForLocalDate(parts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const weekYear = date.getUTCFullYear();
  const firstDay = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil((((date - firstDay) / 86400000) + 1) / 7);
  return { weekYear, weekNumber };
}

function operationalWeekForDate(date, options = {}) {
  const timeZone = options.timeZone || "Europe/Amsterdam";
  const local = zonedParts(date, timeZone);
  const sunday = addLocalDays({ ...local, hour: 0, minute: 0, second: 0 }, -localDayOfWeek(local));
  const boundary = zonedTimeToUtc({ ...sunday, hour: 19, minute: 0, second: 0 }, timeZone);
  const startSunday = date < boundary ? addLocalDays(sunday, -7) : sunday;
  const endSunday = addLocalDays(startSunday, 7);
  const startsAt = zonedTimeToUtc({ ...startSunday, hour: 19, minute: 0, second: 0 }, timeZone);
  const endsAt = zonedTimeToUtc({ ...endSunday, hour: 19, minute: 0, second: 0 }, timeZone);
  const labelDate = addLocalDays(startSunday, 1);
  const { weekYear, weekNumber } = isoWeekForLocalDate(labelDate);
  return { weekYear, weekNumber, startsAt, endsAt };
}

function splitRangeByOperationalWeeks(startAt, endAt, options = {}) {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const end = endAt instanceof Date ? endAt : new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return [];
  const segments = [];
  let cursor = start;
  for (let guard = 0; cursor < end && guard < 370; guard += 1) {
    const week = operationalWeekForDate(cursor, options);
    const segmentEnd = week.endsAt < end ? week.endsAt : end;
    const minutes = Math.max(0, Math.round((segmentEnd.getTime() - cursor.getTime()) / 60000));
    if (minutes > 0) {
      segments.push({
        weekYear: week.weekYear,
        weekNumber: week.weekNumber,
        startedAt: cursor,
        endedAt: segmentEnd,
        minutes
      });
    }
    cursor = segmentEnd;
  }
  return segments;
}

module.exports = { operationalWeekForDate, splitRangeByOperationalWeeks };
