const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("MEOS login is limited to the configured police and defensie role allowlist", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "overheid-server.js"), "utf8");
  const meosRoutesBlock = code.slice(code.indexOf("const meosRoleRoutes"), code.indexOf("const INTERNAL_COMPLAINT_RETURN_TO"));
  const callbackBlock = code.slice(code.indexOf('if (url.pathname === "/auth/discord/callback"'));

  assert.match(meosRoutesBlock, /roleIds: \["1423468016099918024", "1425931664877551708"\]/);
  assert.match(meosRoutesBlock, /roleIds: \["1423471185391255705", "1425715749862772818"\]/);
  assert.doesNotMatch(meosRoutesBlock, /DISCORD_POLITIE_ROLE_ID|DISCORD_DEFENSIE_ROLE_ID|DISCORD_POLITIE_MEOS_ROLE_ID|DISCORD_MEOS_ROLE_ID/);
  assert.match(code, /function routeRoleIds\(route\)/);
  assert.match(code, /function meosOrganizationPriority\(matches = \[\]\)/);
  assert.match(code, /function meosCallbackUrl\(req\)/);
  assert.match(code, /MEOS_DISCORD_REDIRECT_URI/);
  assert.match(code, /const redirectUri = meosCallbackUrl\(req\);/);
  assert.match(code, /if \(isMeosHost\(req\)\) \{\s+const returnTo = safeMeosReturnTo/);
  assert.match(callbackBlock, /isMeosLogin \? meosCallbackUrl\(req\) : cookies\.orp_overheid_redirect \|\| callbackUrl\(req\)/);
  assert.match(code, /portalIdentityForDiscordId\(user\?\.id, \{[\s\S]*organizationPriority,[\s\S]*guildMember: member,[\s\S]*linkMissingDiscordId: true/);
  assert.match(code, /portalPersonDisplayName\(person, \{[\s\S]*fallbackNickname: member\?\.nick \|\| identity\?\.nickname \|\| ""/);
  assert.match(code, /hasPortalIdentityDatabase\(\)/);
  assert.match(code, /function allowMeosDemoProfileFallback\(\)/);
  assert.match(code, /MEOS_REQUIRE_PORTAL_IDENTITY/);
  assert.match(code, /function meosPermissionsForMember\(roles, organizations = \[\], userId = ""\)/);
  assert.match(code, /MEOS_DEFENSIE_DELETE_ROLE_IDS/);
  assert.match(code, /MEOS_POLITIE_DELETE_ROLE_IDS/);
  assert.match(code, /shouldRejectMutation\(req, appBaseUrl\)/);
  assert.match(code, /meosRateLimitAllows/);
  assert.match(code, /Geen actief personeelsprofiel gevonden in Defensie of Politie/);
  assert.match(callbackBlock, /matchingRoutesForRoles\(meosRoleRoutes, roles, user\.id\)/);
  assert.match(callbackBlock, /profile\.permissions = meosPermissionsForMember\(roles, profile\.matchedOrganizations \|\| meosOrganizationPriority\(meosMatches\), user\.id\)/);
  assert.match(callbackBlock, /rememberedState\?\.surface === "meos" \|\| isMeosHost\(req\) \|\| returnTo === "\/meos"/);
  assert.doesNotMatch(callbackBlock, /uniqueRoutesByKey\(\[\.\.\.matches, \.\.\.matchingRoutesForRoles\(meosRoleRoutes/);
});
