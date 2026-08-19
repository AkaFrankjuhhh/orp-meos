"use strict";

function normalizeSpaces(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function digitsOnly(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizePrefixedNumber(value, prefix) {
  const raw = normalizeSpaces(value);
  if (!raw) return "";
  const normalizedPrefix = String(prefix || "").trim().toUpperCase();
  const compact = raw.toUpperCase().replace(/[_\s]+/g, "-").replace(/-+/g, "-");
  const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = compact.match(new RegExp(`^${escapedPrefix}-(\\d+)$`));
  if (match) return `${normalizedPrefix}-${match[1]}`;
  const digits = digitsOnly(raw);
  return digits ? `${normalizedPrefix}-${digits}` : raw;
}

function normalizeOrpBsn(value) {
  return normalizePrefixedNumber(value, "ORP-BSN");
}

function normalizeOrpFingerprint(value) {
  return normalizePrefixedNumber(value, "ORP-V");
}

function normalizeVehiclePlate(value) {
  return normalizeSpaces(value).toUpperCase();
}

function normalizeVehicleVin(value) {
  return normalizeSpaces(value).toUpperCase();
}

function normalizePersonIdentity(person = {}) {
  return {
    ...person,
    bsn: normalizeOrpBsn(person.bsn),
    fingerprint: normalizeOrpFingerprint(person.fingerprint),
    vehicles: Array.isArray(person.vehicles) ? person.vehicles.map(normalizeVehicleIdentity) : []
  };
}

function normalizeVehicleIdentity(vehicle = {}) {
  return {
    ...vehicle,
    plate: normalizeVehiclePlate(vehicle.plate),
    vin: normalizeVehicleVin(vehicle.vin)
  };
}

module.exports = {
  digitsOnly,
  normalizeOrpBsn,
  normalizeOrpFingerprint,
  normalizePersonIdentity,
  normalizePrefixedNumber,
  normalizeSpaces,
  normalizeVehicleIdentity,
  normalizeVehiclePlate,
  normalizeVehicleVin
};
