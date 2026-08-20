"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

function safeLimit(value) {
  return Math.max(1, Math.min(200, Number(value || 80) || 80));
}

class MeosAuditStore {
  constructor(options = {}) {
    this.mode = String(options.mode || process.env.MEOS_AUDIT_STORAGE || "file").trim().toLowerCase();
    const configuredPath = String(options.filePath || process.env.MEOS_AUDIT_LOG_PATH || "meos-audit.log").trim();
    this.filePath = !configuredPath || configuredPath.toLowerCase() === "off"
      ? ""
      : path.resolve(configuredPath);
    this.databaseUrl = String(options.databaseUrl || process.env.MEOS_AUDIT_DATABASE_URL || "").trim();
    this.maxBytes = Math.max(1024 * 1024, Number(process.env.MEOS_AUDIT_LOG_MAX_BYTES || process.env.MEOS_AUDIT_MAX_BYTES || 10 * 1024 * 1024));
    this.pool = null;
    this.fileQueue = Promise.resolve();
  }

  getPool() {
    if (!this.databaseUrl) {
      const error = new Error("MEOS_AUDIT_DATABASE_URL ontbreekt voor PostgreSQL auditlogging.");
      error.status = 503;
      throw error;
    }
    if (!this.pool) {
      const { Pool } = require("pg");
      this.pool = new Pool({
        connectionString: this.databaseUrl,
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        statement_timeout: 10000,
        application_name: "orp-meos-audit",
        ssl: String(process.env.MEOS_AUDIT_DATABASE_SSL || "false").toLowerCase() === "true"
          ? { rejectUnauthorized: String(process.env.MEOS_AUDIT_DATABASE_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false" }
          : false
      });
    }
    return this.pool;
  }

  async append(entry = {}) {
    if (this.mode === "postgres") return this.appendPostgres(entry);
    if (!this.filePath) return;
    const write = async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const stats = await fs.stat(this.filePath).catch(() => null);
      if (stats?.size >= this.maxBytes) {
        const rotatedPath = `${this.filePath}.1`;
        await fs.unlink(rotatedPath).catch(() => {});
        await fs.rename(this.filePath, rotatedPath);
      }
      await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    };
    const pending = this.fileQueue.then(write, write);
    this.fileQueue = pending.catch(() => {});
    return pending;
  }

  async appendPostgres(entry = {}) {
    const actor = entry.actor || {};
    const details = {
      ...(entry.details || {}),
      request: {
        method: entry.method || "",
        path: entry.path || "",
        host: entry.host || "",
        ip: entry.ip || "",
        userAgent: entry.userAgent || ""
      },
      actor: {
        rank: actor.rank || "",
        serviceNumber: actor.serviceNumber || "",
        discordUsername: actor.discordUsername || "",
        organizationKey: actor.organizationKey || "",
        portalPersonId: actor.portalPersonId || ""
      }
    };
    await this.getPool().query(
      `insert into audit_log(id, scope, action, target_id, target_label, actor_id, actor_name, details, created_at)
       values($1, 'meos', $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        crypto.randomUUID(),
        entry.action || "unknown",
        entry.details?.personId || entry.details?.processVerbalId || entry.details?.deletedId || null,
        entry.details?.personName || null,
        actor.discordId || actor.portalPersonId || null,
        actor.name || null,
        JSON.stringify(details),
        entry.at || new Date().toISOString()
      ]
    );
  }

  async list(options = {}) {
    const limit = safeLimit(options.limit);
    if (this.mode === "postgres") {
      const result = await this.getPool().query(
        `select action, actor_id, actor_name, target_id, target_label, details, created_at
         from audit_log where scope = 'meos' order by created_at desc limit $1`,
        [limit]
      );
      return {
        enabled: true,
        storage: "postgres",
        entries: result.rows.map((row) => ({
          at: row.created_at,
          action: row.action,
          actor: { discordId: row.actor_id || "", name: row.actor_name || "", ...(row.details?.actor || {}) },
          details: { ...(row.details || {}), targetId: row.target_id || "", targetLabel: row.target_label || "" },
          ...(row.details?.request || {})
        }))
      };
    }
    if (!this.filePath) return { enabled: false, storage: "off", entries: [] };
    const content = await fs.readFile(this.filePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    const entries = content.split(/\r?\n/).filter(Boolean).slice(-limit).reverse().map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { at: "", action: "audit.parse_failed", details: { raw: line.slice(0, 500) } };
      }
    });
    return { enabled: true, storage: "file", entries };
  }
}

function createMeosAuditStore(options = {}) {
  return new MeosAuditStore(options);
}

module.exports = { MeosAuditStore, createMeosAuditStore };
