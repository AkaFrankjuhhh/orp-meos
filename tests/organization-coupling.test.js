const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

function withOrganization(key, fn) {
  const previous = process.env.ORP_ORGANIZATION;
  process.env.ORP_ORGANIZATION = key;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ORP_ORGANIZATION;
    else process.env.ORP_ORGANIZATION = previous;
  }
}

test("discord worker uses organization porto operator number for lead nickname context", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "scripts", "discord-bot-worker.js"), "utf8");

  assert.match(code, /organization\.porto\?\.operatorVehicleNumber/);
  assert.doesNotMatch(code, /unit\.vehicleNumber === "30-00"/);
});

test("mentor tests are not hard-coded to defensie only", () => {
  const code = fs.readFileSync(path.join(process.cwd(), "modules", "personeelsportaal-routes.js"), "utf8");

  assert.doesNotMatch(code, /organization\.key === "defensie" && Boolean\(mentorTestsStore\)/);
  assert.match(code, /mentorTestsStore && mentorRanks\.length/);
});

test("police leadership can view I8, mentor and discipline without becoming OvJ reviewers", () => {
  withOrganization("politie", () => {
    const { organizationConfigs } = require("../modules/organizations");
    const { createPermissionServices } = require("../modules/permissions");
    const organization = organizationConfigs.politie;
    const services = createPermissionServices({
      extraFunctions: organization.extraFunctions,
      extraTasks: organization.extraTasks,
      readState: () => ({ people: [] })
    });

    for (const permRole of ["Korpsleiding", "Bestuur"]) {
      const permissions = services.permissionsForProfile({
        id: `politie-${permRole}`,
        name: permRole,
        rank: "Agent",
        status: "Actief",
        permRole,
        badges: []
      });

      assert.equal(permissions.canViewOvJChannels, true);
      assert.equal(permissions.canReviewI8Forms, false);
      assert.equal(permissions.canViewMentorOverview, true);
      assert.equal(permissions.canViewAllDiscipline, true);
      assert.equal(permissions.canViewAllHours, true);
      assert.equal(permissions.canViewPersonnel, true);
    }
  });
});
