"use strict";

const crypto = require("node:crypto");

function createMeosApiRoutes(context = {}) {
  const {
    requireMeosApiSession,
    appendMeosAudit,
    sendJson,
    sendHtml,
    writeHeadSecure,
    getMeosStore,
    meosStoreConfigFromEnv,
    sendMeosStoreResponse,
    sendMeosWetboekResponse,
    sendMeosMutationResponse,
    fetchWetboekApiJson,
    meosPathParam,
    meosNestedPathParam,
    meosEntryPathParams,
    meosRecordFromBody,
    meosShouldCreateFine,
    meosFineFromBody,
    meosNoteFromBody,
    meosProcessVerbalFromBody,
    meosProcessVerbalAccessFromSession,
    getMeosSession,
    requireMeosCsrf,
    meosFallbackProfile,
    deleteMeosSession,
    clearMeosSessionCookie,
    discordConfigured,
    meosCallbackUrl,
    safeMeosReturnTo,
    rememberOAuthState,
    meosHomeUrl,
    clearOverheidCookies,
    authCookie,
    returnToCookie,
    loginPage
  } = context;

  async function handleMeosApiRoute(req, res, url) {
    if (!String(url.pathname || "").startsWith("/api/meos/")) return false;

    if (url.pathname === "/api/meos/session/debug" && req.method === "GET") {
      const session = requireMeosApiSession(req, res);
      if (!session) return true;
      appendMeosAudit(req, session, "session.debug", {});
      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        dataSource: meosStoreConfigFromEnv(),
        session: {
          createdAt: session.createdAt,
          expiresAt: new Date(session.expiresAt).toISOString()
        },
        profile: {
          name: session.profile?.name || "",
          rank: session.profile?.rank || "",
          serviceNumber: session.profile?.serviceNumber || "",
          organizationKey: session.profile?.organizationKey || "",
          matchedOrganizations: session.profile?.matchedOrganizations || [],
          discordId: session.profile?.discordId || "",
          discordUsername: session.profile?.discordUsername || "",
          portalPersonId: session.profile?.portalPersonId || "",
          identityLinkedBy: session.profile?.identityLinkedBy || "",
          portalNickname: session.profile?.portalNickname || "",
          permissions: session.profile?.permissions || {}
        }
      });
      return true;
    }

    if (url.pathname === "/api/meos/data" && req.method === "GET") {
      await sendMeosStoreResponse(req, res, "data.snapshot", {}, async (store) => {
        const snapshot = await store.snapshot();
        return { data: snapshot };
      });
      return true;
    }

    if (url.pathname === "/api/meos/data-health" && req.method === "GET") {
      await sendMeosStoreResponse(req, res, "data.health", {}, async (store) => {
        return { health: await store.sourceHealth() };
      }, {
        permission: "canViewDataHealth",
        permissionMessage: "Alleen KL/Kader kan de MEOS databronstatus bekijken."
      });
      return true;
    }

    if (url.pathname === "/api/meos/wetboek/articles" && req.method === "GET") {
      await sendMeosWetboekResponse(req, res, "wetboek.articles", {}, async () => {
        const payload = await fetchWetboekApiJson("/api/meos/articles");
        return { wetboek: payload };
      });
      return true;
    }

    if (url.pathname === "/api/meos/wetboek/search" && req.method === "GET") {
      const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      const payloadPath = `/api/meos/search${params.toString() ? `?${params}` : ""}`;
      await sendMeosWetboekResponse(req, res, "wetboek.search", { query }, async () => {
        const payload = await fetchWetboekApiJson(payloadPath);
        return { wetboek: payload };
      });
      return true;
    }

    if (url.pathname === "/api/meos/process-verbals" && req.method === "GET") {
      const scope = String(url.searchParams.get("scope") || "mine").trim().toLowerCase();
      const author = url.searchParams.get("author") || "";
      const type = url.searchParams.get("type") || "";
      await sendMeosStoreResponse(req, res, "processVerbals.list", { scope, author, type }, async (store, session) => {
        const access = meosProcessVerbalAccessFromSession(session);
        const includeAll = scope === "all";
        if (includeAll && !access.includeAll) {
          const error = new Error("Alleen kader, korpsleiding of OVJ kan alle processen-verbaal bekijken.");
          error.status = 403;
          throw error;
        }
        return {
          processVerbals: await store.listProcessVerbals({
            actorKey: access.actorKey,
            includeAll,
            author,
            type
          })
        };
      });
      return true;
    }

    if (url.pathname === "/api/meos/process-verbals" && req.method === "POST") {
      await sendMeosMutationResponse(req, res, "processVerbals.add", {}, async (store, session, body) => {
        return store.addProcessVerbal(meosProcessVerbalFromBody(body, session));
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen proces-verbaal opmaken."
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/process-verbals/") && req.method === "PUT") {
      const processVerbalId = meosPathParam(url.pathname, "/api/meos/process-verbals/");
      await sendMeosMutationResponse(req, res, "processVerbals.update", { processVerbalId }, async (store, session, body) => {
        const access = meosProcessVerbalAccessFromSession(session);
        return store.updateProcessVerbal(processVerbalId, meosProcessVerbalFromBody(body, session), {
          actorKey: access.actorKey
        });
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen proces-verbaal wijzigen."
      });
      return true;
    }

    if (url.pathname === "/api/meos/people" && req.method === "GET") {
      const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
      const field = url.searchParams.get("field") || "all";
      const limit = url.searchParams.get("limit") || "";
      await sendMeosStoreResponse(req, res, "people.list", { query, field, limit }, async (store) => ({
        people: await store.listPeople({ query, field, limit })
      }));
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && req.method === "GET") {
      const value = meosPathParam(url.pathname, "/api/meos/people/");
      await sendMeosStoreResponse(req, res, "people.detail", { value }, async (store) => {
        const person = await store.getPerson(value);
        if (!person) {
          const error = new Error("Persoon niet gevonden.");
          error.status = 404;
          throw error;
        }
        return { person };
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && url.pathname.endsWith("/records") && req.method === "POST") {
      const value = meosNestedPathParam(url.pathname, "/api/meos/people/", "/records");
      await sendMeosMutationResponse(req, res, "records.add", { person: value }, async (store, session, body) => {
        const record = meosRecordFromBody(body, session);
        const fine = meosShouldCreateFine(body) ? meosFineFromBody(body, session) : null;
        const recordResult = await store.addPersonRecord(value, record);
        if (!meosShouldCreateFine(body)) return recordResult;
        const fineResult = await store.addPersonFine(value, fine);
        return {
          ...recordResult,
          fine: fineResult.fine,
          person: fineResult.person
        };
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen strafbladen toevoegen."
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && url.pathname.endsWith("/fines") && req.method === "POST") {
      const value = meosNestedPathParam(url.pathname, "/api/meos/people/", "/fines");
      await sendMeosMutationResponse(req, res, "fines.add", { person: value }, async (store, session, body) => {
        return store.addPersonFine(value, meosFineFromBody(body, session));
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen boetes toevoegen."
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && url.pathname.endsWith("/notes") && req.method === "POST") {
      const value = meosNestedPathParam(url.pathname, "/api/meos/people/", "/notes");
      await sendMeosMutationResponse(req, res, "notes.add", { person: value }, async (store, session, body) => {
        return store.addPersonNote(value, meosNoteFromBody(body, session));
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen notities toevoegen."
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && url.pathname.includes("/records/") && req.method === "DELETE") {
      const { person, entryId } = meosEntryPathParams(url.pathname, "records");
      await sendMeosMutationResponse(req, res, "records.delete", { person, entryId }, async (store) => {
        return store.deletePersonRecord(person, entryId);
      }, {
        readBody: false,
        permission: "canDeleteEntries",
        permissionMessage: "Alleen kader, korpsleiding of OVJ kan strafbladen verwijderen."
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && url.pathname.includes("/notes/") && req.method === "DELETE") {
      const { person, entryId } = meosEntryPathParams(url.pathname, "notes");
      await sendMeosMutationResponse(req, res, "notes.delete", { person, entryId }, async (store) => {
        return store.deletePersonNote(person, entryId);
      }, {
        readBody: false,
        permission: "canDeleteEntries",
        permissionMessage: "Alleen kader, korpsleiding of OVJ kan notities verwijderen."
      });
      return true;
    }

    if (url.pathname.startsWith("/api/meos/people/") && url.pathname.includes("/fines/") && req.method === "DELETE") {
      const { person, entryId } = meosEntryPathParams(url.pathname, "fines");
      await sendMeosMutationResponse(req, res, "fines.delete", { person, entryId }, async (store) => {
        return store.deletePersonFine(person, entryId);
      }, {
        readBody: false,
        permission: "canDeleteEntries",
        permissionMessage: "Alleen kader, korpsleiding of OVJ kan boetes verwijderen."
      });
      return true;
    }

    if (url.pathname === "/api/meos/vehicles" && req.method === "GET") {
      const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
      const limit = url.searchParams.get("limit") || "";
      await sendMeosStoreResponse(req, res, "vehicles.list", { query, limit }, async (store) => ({
        vehicles: await store.listVehicles({ query, limit })
      }));
      return true;
    }

    if (url.pathname.startsWith("/api/meos/vehicles/") && req.method === "GET") {
      const value = meosPathParam(url.pathname, "/api/meos/vehicles/");
      await sendMeosStoreResponse(req, res, "vehicles.detail", { value }, async (store) => {
        const vehicle = await store.getVehicle(value);
        if (!vehicle) {
          const error = new Error("Voertuig niet gevonden.");
          error.status = 404;
          throw error;
        }
        return { vehicle };
      });
      return true;
    }

    if (url.pathname === "/api/meos/warrants" && req.method === "GET") {
      const limit = url.searchParams.get("limit") || "";
      await sendMeosStoreResponse(req, res, "warrants.list", { limit }, async (store) => ({
        warrants: await store.listWarrants({ limit })
      }));
      return true;
    }

    if (url.pathname === "/api/meos/search" && req.method === "GET") {
      const query = url.searchParams.get("q") || url.searchParams.get("query") || "";
      const limit = url.searchParams.get("limit") || "";
      await sendMeosStoreResponse(req, res, "search", { query, limit }, async (store) => ({
        results: await store.search({ query, limit })
      }));
      return true;
    }

    if (url.pathname === "/api/meos/session" && req.method === "GET") {
      const session = getMeosSession(req);
      sendJson(res, 200, {
        authenticated: Boolean(session),
        csrfToken: session?.csrfToken || "",
        profile: session?.profile || meosFallbackProfile()
      });
      return true;
    }

    if (url.pathname === "/api/meos/logout" && req.method === "POST") {
      const session = getMeosSession(req);
      try {
        if (session) {
          requireMeosCsrf(req, session);
          appendMeosAudit(req, session, "session.logout", {});
        }
        deleteMeosSession(req);
        writeHeadSecure(res, 204, {
          "Set-Cookie": clearMeosSessionCookie(req)
        });
        res.end();
      } catch (error) {
        sendJson(res, error.status || 403, {
          ok: false,
          error: error.message || "MEOS logout is geweigerd."
        });
      }
      return true;
    }

    if (url.pathname === "/api/meos/login" && req.method === "GET") {
      if (!discordConfigured()) {
        sendHtml(res, 500, loginPage("Discord of organisatie rollen ontbreken in .env."));
        return true;
      }
      const state = crypto.randomBytes(24).toString("hex");
      const redirectUri = meosCallbackUrl(req);
      const returnTo = safeMeosReturnTo(url.searchParams.get("returnTo") || "/dashboard");
      rememberOAuthState(state, {
        redirectUri,
        returnTo,
        surface: "meos",
        meosHomeUrl: meosHomeUrl(req, returnTo)
      });
      const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "identify guilds.members.read",
        state
      });
      writeHeadSecure(res, 302, {
        Location: `https://discord.com/api/oauth2/authorize?${params}`,
        "Set-Cookie": [
          ...clearOverheidCookies(["orp_overheid_state", "orp_overheid_redirect", "orp_overheid_return_to", "orp_overheid_choices"], req),
          authCookie("orp_overheid_state", state, 600, req),
          authCookie("orp_overheid_redirect", redirectUri, 600, req),
          returnToCookie(returnTo, req)
        ]
      });
      res.end();
      return true;
    }

    return false;
  }

  return { handleMeosApiRoute };
}

module.exports = {
  createMeosApiRoutes
};
