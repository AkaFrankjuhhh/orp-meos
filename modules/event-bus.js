function createEventBus() {
  const clients = new Set();

  function send(client, event, payload = {}) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  function addClient(req, res, profile) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const client = res;
    clients.add(client);
    send(client, "connected", { profileId: profile?.id || "", at: new Date().toISOString() });
    const heartbeat = setInterval(() => send(client, "heartbeat", { at: new Date().toISOString() }), 25000);
    req.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(client);
    });
  }

  function publish(event, payload = {}) {
    for (const client of clients) {
      send(client, event, { ...payload, at: new Date().toISOString() });
    }
  }

  return { addClient, publish, clientCount: () => clients.size };
}

module.exports = { createEventBus };
