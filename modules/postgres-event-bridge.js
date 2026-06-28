const crypto = require("node:crypto");
const { createPool, withClient } = require("./db");

const channelName = "orp_app_events";

function createPostgresEventBridge({ enabled, serviceName, publishLocal, logError }) {
  const sourceId = `${serviceName || "service"}-${crypto.randomUUID()}`;
  let client = null;
  let reconnectTimer = null;
  let stopped = false;

  function report(label, error) {
    if (typeof logError === "function") logError(label, error);
    else console.error(label, error?.message || error);
  }

  function handleNotification(message) {
    if (message.channel !== channelName || !message.payload) return;
    try {
      const payload = JSON.parse(message.payload);
      if (!payload.scope || payload.sourceId === sourceId) return;
      if (typeof publishLocal === "function") publishLocal(payload.scope, { remote: true, serviceName: payload.serviceName || "" });
    } catch (error) {
      report("Postgres event payload ongeldig", error);
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start().catch((error) => report("Postgres event bridge reconnect mislukt", error));
    }, 5000);
  }

  function dropClient(error = null) {
    if (!client) return;
    const currentClient = client;
    client = null;
    currentClient.removeListener("notification", handleNotification);
    try {
      currentClient.release(error || undefined);
    } catch {
      // De verbinding kan al door pg gesloten zijn; reconnect pakt een nieuwe client.
    }
  }

  async function start() {
    if (!enabled || client || stopped) return;
    const pool = createPool();
    client = await pool.connect();
    client.on("notification", handleNotification);
    client.on("error", (error) => {
      report("Postgres event bridge fout", error);
      dropClient(error);
      scheduleReconnect();
    });
    client.on("end", () => {
      dropClient();
      scheduleReconnect();
    });
    await client.query(`listen ${channelName}`);
  }

  async function stop() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (!client) return;
    const currentClient = client;
    client = null;
    try {
      currentClient.removeListener("notification", handleNotification);
      await currentClient.query(`unlisten ${channelName}`);
    } catch (error) {
      report("Postgres event bridge stop mislukt", error);
    } finally {
      currentClient.release();
    }
  }

  async function notify(scope) {
    if (!enabled || !scope) return;
    const payload = JSON.stringify({
      scope,
      sourceId,
      serviceName: serviceName || "",
      at: new Date().toISOString()
    });
    await withClient((dbClient) => dbClient.query("select pg_notify($1, $2)", [channelName, payload]));
  }

  function status() {
    return {
      enabled: Boolean(enabled),
      listening: Boolean(client),
      reconnectScheduled: Boolean(reconnectTimer),
      stopped
    };
  }

  return { start, stop, notify, status };
}

module.exports = { createPostgresEventBridge };
