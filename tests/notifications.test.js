const test = require("node:test");
const assert = require("node:assert/strict");
const { markNotificationsRead, clearNotifications } = require("../modules/notifications");

test("markNotificationsRead preserves existing read timestamp and marks unread", () => {
  const person = { notifications: [{ id: "1" }, { id: "2", readAt: "old" }] };

  markNotificationsRead(person, "now");

  assert.deepEqual(person.notifications, [{ id: "1", readAt: "now" }, { id: "2", readAt: "old" }]);
});

test("clearNotifications empties the inbox", () => {
  const person = { notifications: [{ id: "1" }] };

  clearNotifications(person);

  assert.deepEqual(person.notifications, []);
});
