const test = require("node:test");
const assert = require("node:assert/strict");
const { mentorReviewStateForStatus } = require("../modules/mentor-tests-logic");

test("mentor approval completes test and trajectory", () => {
  assert.deepEqual(mentorReviewStateForStatus("approved"), { testSent: true, testApproved: true, completed: true });
});

test("mentor rejection clears sent and approved state", () => {
  assert.deepEqual(mentorReviewStateForStatus("rejected"), { testSent: false, testApproved: false, completed: false });
});
