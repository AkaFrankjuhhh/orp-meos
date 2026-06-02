const crypto = require("node:crypto");
const { URLSearchParams } = require("node:url");

function parseCookies(req) {
  const cookie = req.headers.cookie || "";
  return Object.fromEntries(
    cookie
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        const key = part.slice(0, index);
        const value = part.slice(index + 1);
        try {
          return [key, decodeURIComponent(value)];
        } catch (error) {
          return [key, value];
        }
      })
  );
}

function avatarUrl(user) {
  if (!user.avatar) return "";
  const extension = user.avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=128`;
}

async function discordFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    body = { message: text || `Discord API fout ${response.status}` };
  }
  if (!response.ok) {
    const message = body?.message || body?.error_description || `Discord API fout ${response.status}`;
    const apiError = new Error(message);
    apiError.status = response.status;
    apiError.retryAfter = Number(body?.retry_after || response.headers.get("retry-after") || 0);
    throw apiError;
  }
  return body;
}

function createAuthServices({ sessions, readState, discordConfigured, allowDevUnauth, sessionMaxAgeSeconds = () => 604800 }) {
  function sessionCookieSecureSuffix() {
    const secureCookieEnabled = String(process.env.SESSION_COOKIE_SECURE || "").toLowerCase() === "true";
    const configuredBaseUrls = [process.env.APP_BASE_URL, process.env.PORTO_APP_BASE_URL].filter(Boolean);
    return secureCookieEnabled || configuredBaseUrls.some((baseUrl) => String(baseUrl).startsWith("https://")) ? "; Secure" : "";
  }

  function authCookie(name, value, maxAgeSeconds = 600) {
    return `${name}=${encodeURIComponent(String(value || ""))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${sessionCookieSecureSuffix()}`;
  }

  function clearAuthCookie(name) {
    return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${sessionCookieSecureSuffix()}`;
  }

  function getSession(req) {
    const sid = parseCookies(req).orp_session;
    if (!sid) return null;
    return sessions.get(sid) || null;
  }

  function createSession(res, user, profile, discordAuth = {}) {
    const sid = crypto.randomBytes(32).toString("hex");
    // Sessies blijven server-side; de browser krijgt alleen een willekeurige sessie-id.
    sessions.set(sid, {
      user,
      profileId: profile.id,
      profile: { ...profile },
      accessToken: discordAuth.accessToken || "",
      roles: discordAuth.roles || [],
      roleSyncedAt: Date.now(),
      createdAt: Date.now()
    });
    res.setHeader("Set-Cookie", authCookie("orp_session", sid, sessionMaxAgeSeconds()));
  }

  function clearSession(req, res) {
    const sid = parseCookies(req).orp_session;
    if (sid) sessions.delete(sid);
    res.setHeader("Set-Cookie", clearAuthCookie("orp_session"));
  }

  function getLoggedInProfile(req) {
    const session = getSession(req);
    if (session) {
      if (session.profile && session.profile.status === "Actief") return { profile: session.profile, session };
      const state = readState();
      if (state && typeof state.then !== "function") {
        const profile = state.people.find((person) => person.id === session.profileId && person.status === "Actief");
        if (profile) {
          session.profile = { ...profile };
          return { profile, session };
        }
      }
    }
    if (!discordConfigured() && allowDevUnauth()) {
      const state = readState();
      if (state && typeof state.then !== "function") {
        const profile = state.people.find((person) => person.status === "Actief") || state.people[0];
        if (profile) return { profile, session: { dev: true, profile: { ...profile } } };
      }
    }
    return null;
  }

  async function exchangeCode(code, redirectUri = process.env.DISCORD_REDIRECT_URI) {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri
    });

    return discordFetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
  }

  async function getDiscordUser(accessToken) {
    return discordFetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  async function getCurrentUserGuildMember(accessToken) {
    return discordFetch(`https://discord.com/api/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
  }

  return {
    parseCookies,
    getSession,
    createSession,
    clearSession,
    authCookie,
    clearAuthCookie,
    getLoggedInProfile,
    avatarUrl,
    discordFetch,
    exchangeCode,
    getDiscordUser,
    getCurrentUserGuildMember
  };
}

module.exports = { createAuthServices };
