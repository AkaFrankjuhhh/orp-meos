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
    readMeosAuditLog,
    getMeosSession,
    refreshMeosSessionAuthorization,
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
    hostAuthCookie,
    returnToCookie,
    loginPage,
    isLspdPublicDemoRequest
  } = context;

  async function processVerbalFromRequest(store, session, body = {}) {
    const related = body?.related && typeof body.related === "object" && !Array.isArray(body.related)
      ? { ...body.related }
      : {};
    const personId = String(related.personId || "").trim();
    let person = null;
    if (personId) {
      person = await store.getPerson(personId);
      if (!person) {
        const error = new Error("De gekoppelde persoon bestaat niet meer in MEOS.");
        error.status = 409;
        throw error;
      }
    } else {
      delete related.personName;
      delete related.personBirthDate;
      delete related.personBsn;
      delete related.personFingerprint;
    }

    const vehicleReference = String(related.vehiclePlate || "").trim();
    if (vehicleReference) {
      const vehicle = await store.getVehicle(vehicleReference);
      if (!vehicle) {
        const error = new Error("Het gekoppelde voertuig bestaat niet meer in MEOS.");
        error.status = 409;
        throw error;
      }
      related.vehiclePlate = vehicle.plate;
      related.vehicleLabel = [vehicle.plate, vehicle.model].filter(Boolean).join(" - ");
    } else {
      delete related.vehicleLabel;
    }

    const warrantId = String(related.warrantId || "").trim();
    if (warrantId) {
      const warrants = await store.listWarrants({ limit: 500 });
      const warrant = warrants.find((entry) => String(entry.id || "") === warrantId);
      if (!warrant) {
        const error = new Error("Het gekoppelde arrestatiebevel bestaat niet meer in MEOS.");
        error.status = 409;
        throw error;
      }
      related.warrantId = warrant.id;
      related.warrantLabel = [warrant.person?.name, warrant.reason].filter(Boolean).join(" - ");
    } else {
      delete related.warrantLabel;
    }

    const parentId = String(related.parentProcessVerbalId || "").trim();
    if (parentId) {
      const rows = await store.listProcessVerbals(meosProcessVerbalAccessFromSession(session));
      const parent = rows.find((entry) => String(entry.id || "") === parentId);
      if (!parent) {
        const error = new Error("Het oorspronkelijke proces-verbaal is niet toegankelijk of bestaat niet meer.");
        error.status = 409;
        throw error;
      }
      related.parentProcessVerbalId = parent.id;
      related.parentProcessVerbalTitle = parent.title;
    } else {
      delete related.parentProcessVerbalTitle;
    }

    delete related.entryType;
    delete related.entryId;
    delete related.entryLabel;
    return meosProcessVerbalFromBody({ ...body, related }, session, { person });
  }

  function searchQueryFromUrl(url, maxLength = 120) {
    return String(url.searchParams.get("q") || url.searchParams.get("query") || "").trim().slice(0, maxLength);
  }

  async function handleMeosApiRoute(req, res, url) {
    if (!String(url.pathname || "").startsWith("/api/meos/")) return false;

    if (url.pathname === "/api/meos/session/debug" && req.method === "GET") {
      if (isLspdPublicDemoRequest?.(req)) {
        sendJson(res, 404, { ok: false, error: "Debug information is disabled in the public demo." });
        return true;
      }
      const session = requireMeosApiSession(req, res);
      if (!session) return true;
      await refreshMeosSessionAuthorization(session);
      await appendMeosAudit(req, session, "session.debug", {});
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

    if (url.pathname === "/api/meos/general-note" && req.method === "GET") {
      await sendMeosStoreResponse(req, res, "generalNote.get", {}, async (store, session) => {
        const access = meosProcessVerbalAccessFromSession(session);
        return store.getGeneralNote(access.actorKey);
      });
      return true;
    }

    if (url.pathname === "/api/meos/general-note" && req.method === "PUT") {
      await sendMeosMutationResponse(req, res, "generalNote.save", {}, async (store, session, body) => {
        const access = meosProcessVerbalAccessFromSession(session);
        return store.saveGeneralNote(access.actorKey, String(body.note || "").slice(0, 2000));
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen algemene notitie opslaan."
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

    if (url.pathname === "/api/meos/audit" && req.method === "GET") {
      const limit = url.searchParams.get("limit") || "";
      await sendMeosStoreResponse(req, res, "audit.list", { limit }, async () => ({
        audit: await readMeosAuditLog({ limit })
      }), {
        permission: "canViewAudit",
        permissionMessage: "Alleen kader, korpsleiding of OVJ kan de MEOS auditlog bekijken."
      });
      return true;
    }

    if (url.pathname === "/api/meos/wetboek/articles" && req.method === "GET") {
      await sendMeosWetboekResponse(req, res, "wetboek.articles", {}, async () => {
        const payload = await fetchWetboekApiJson("/api/meos/v1/articles");
        return { wetboek: payload };
      });
      return true;
    }

    if (url.pathname === "/api/meos/wetboek/search" && req.method === "GET") {
      const query = searchQueryFromUrl(url);
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      const payloadPath = `/api/meos/v1/search${params.toString() ? `?${params}` : ""}`;
      await sendMeosWetboekResponse(req, res, "wetboek.search", { query }, async () => {
        const payload = await fetchWetboekApiJson(payloadPath);
        return { wetboek: payload };
      });
      return true;
    }

    if (url.pathname === "/api/meos/process-verbals" && req.method === "GET") {
      const scope = String(url.searchParams.get("scope") || "mine").trim().toLowerCase();
      const author = String(url.searchParams.get("author") || "").trim().slice(0, 120);
      const type = String(url.searchParams.get("type") || "").trim().slice(0, 40);
      const query = searchQueryFromUrl(url);
      await sendMeosStoreResponse(req, res, "processVerbals.list", { scope, author, type, query }, async (store, session) => {
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
            type,
            query
          })
        };
      });
      return true;
    }

    if (url.pathname === "/api/meos/process-verbals" && req.method === "POST") {
      await sendMeosMutationResponse(req, res, "processVerbals.add", {}, async (store, session, body) => {
        return store.addProcessVerbal(await processVerbalFromRequest(store, session, body));
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
        return store.updateProcessVerbal(processVerbalId, await processVerbalFromRequest(store, session, body), {
          actorKey: access.actorKey
        });
      }, {
        permission: "canWriteEntries",
        permissionMessage: "Je MEOS rol mag geen proces-verbaal wijzigen."
      });
      return true;
    }

    if (url.pathname === "/api/meos/people" && req.method === "GET") {
      const query = searchQueryFromUrl(url);
      const field = String(url.searchParams.get("field") || "all").trim().slice(0, 40);
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
        const record = await meosRecordFromBody(body, session);
        const fine = meosShouldCreateFine(body) ? meosFineFromBody(body, session, record) : null;
        if (fine && typeof store.addPersonRecordWithFine === "function") {
          return store.addPersonRecordWithFine(value, record, fine);
        }
        const recordResult = await store.addPersonRecord(value, record);
        if (!fine) return recordResult;
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
      const query = searchQueryFromUrl(url);
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
      const query = searchQueryFromUrl(url);
      const limit = url.searchParams.get("limit") || "";
      await sendMeosStoreResponse(req, res, "search", { query, limit }, async (store) => ({
        results: await store.search({ query, limit })
      }));
      return true;
    }

    if (url.pathname === "/api/meos/session" && req.method === "GET") {
      const session = getMeosSession(req);
      try {
        if (session) await refreshMeosSessionAuthorization(session);
        sendJson(res, 200, {
          authenticated: Boolean(session),
          csrfToken: session?.csrfToken || "",
          profile: session?.profile || null
        });
      } catch (error) {
        sendJson(res, error.status || 401, {
          authenticated: false,
          csrfToken: "",
          profile: null,
          error: error.message || "MEOS login is niet meer geldig."
        }, { "Set-Cookie": clearMeosSessionCookie(req) });
      }
      return true;
    }

    if (url.pathname === "/api/meos/logout" && req.method === "POST") {
      const session = getMeosSession(req);
      try {
        if (session) {
          requireMeosCsrf(req, session);
          await appendMeosAudit(req, session, "session.logout", {});
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
      if (isLspdPublicDemoRequest?.(req)) {
        writeHeadSecure(res, 302, {
          Location: safeMeosReturnTo(url.searchParams.get("returnTo") || "/dashboard")
        });
        res.end();
        return true;
      }
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
          hostAuthCookie("orp_overheid_state", state, 600, req),
          hostAuthCookie("orp_overheid_redirect", redirectUri, 600, req),
          hostAuthCookie("orp_overheid_return_to", returnTo, 600, req)
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
