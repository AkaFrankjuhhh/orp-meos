const { withClient } = require("./db");

const DEFAULT_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function sessionMaxAgeSeconds() {
  const configured = Number(process.env.SESSION_MAX_AGE_SECONDS || DEFAULT_SESSION_MAX_AGE_SECONDS);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

function sessionExpiryDate() {
  return new Date(Date.now() + sessionMaxAgeSeconds() * 1000);
}

function isPostgresStorage() {
  return String(process.env.STORAGE_MODE || "json").toLowerCase() === "postgres" && Boolean(process.env.DATABASE_URL);
}

function cloneSession(session) {
  return session ? JSON.parse(JSON.stringify(session)) : null;
}

function createSessionStore() {
  const cache = new Map();

  function attachSessionId(id, session) {
    if (!session || typeof session !== "object") return session;
    Object.defineProperty(session, "id", {
      value: id,
      enumerable: false,
      configurable: true,
      writable: true
    });
    return session;
  }

  async function load() {
    if (!isPostgresStorage()) return;
    await withClient(async (client) => {
      await client.query("delete from app_sessions where expires_at <= now()");
      const result = await client.query("select id, payload from app_sessions where expires_at > now()");
      cache.clear();
      for (const row of result.rows) {
        cache.set(row.id, attachSessionId(row.id, row.payload));
      }
    });
  }

  function get(id) {
    const session = cache.get(id) || null;
    return attachSessionId(id, session);
  }

  function persist(id, session) {
    if (!isPostgresStorage()) return;
    const payload = cloneSession(session);
    delete payload.id;
    withClient(async (client) => {
      await client.query(
        `insert into app_sessions (id, payload, expires_at, updated_at)
         values ($1, $2::jsonb, $3, now())
         on conflict (id) do update set payload = excluded.payload, expires_at = excluded.expires_at, updated_at = now()`,
        [id, JSON.stringify(payload), sessionExpiryDate()]
      );
    }).catch((error) => {
      console.error(`Sessie opslaan mislukt: ${error.message}`);
    });
  }

  function set(id, session) {
    const storedSession = attachSessionId(id, session);
    cache.set(id, storedSession);
    persist(id, storedSession);
  }

  function save(id, session) {
    if (!id || !session) return;
    set(id, session);
  }

  function remove(id) {
    cache.delete(id);
    if (!isPostgresStorage()) return;
    withClient(async (client) => {
      await client.query("delete from app_sessions where id = $1", [id]);
    }).catch((error) => {
      console.error(`Sessie verwijderen mislukt: ${error.message}`);
    });
  }

  async function cleanup() {
    if (!isPostgresStorage()) return;
    await withClient(async (client) => {
      await client.query("delete from app_sessions where expires_at <= now()");
    });
  }

  return {
    get,
    set,
    delete: remove,
    save,
    load,
    cleanup,
    size: () => cache.size
  };
}

module.exports = { createSessionStore, sessionMaxAgeSeconds };
