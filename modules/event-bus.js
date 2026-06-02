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
    const heartbeat = setInterval(() => {
      try {
        send(client, "heartbeat", { at: new Date().toISOString() });
      } catch {
        cleanup();
      }
    }, 25000);
    function cleanup() {
      clearInterval(heartbeat);
      clients.delete(client);
    }
    try {
      send(client, "connected", { profileId: profile?.id || "", at: new Date().toISOString() });
    } catch {
      cleanup();
    }
    req.on("aborted", cleanup);
    req.on("close", cleanup);
    res.on("close", cleanup);
    res.on("error", cleanup);
  }

  function publish(event, payload = {}) {
    for (const client of clients) {
      try {
        send(client, event, { ...payload, at: new Date().toISOString() });
      } catch {
        clients.delete(client);
      }
    }
  }

  return { addClient, publish, clientCount: () => clients.size };
}

module.exports = { createEventBus };
