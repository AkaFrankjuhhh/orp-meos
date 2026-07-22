const test = require("node:test");
const assert = require("node:assert/strict");
const {
  mentorChecklistStaleAfterReactivation,
  mentorReviewStateForStatus,
  mentorTestStaleAfterReactivation
} = require("../modules/mentor-tests-logic");

test("mentor approval completes test and trajectory", () => {
  assert.deepEqual(mentorReviewStateForStatus("approved"), { testSent: true, testApproved: true, completed: true });
});

test("mentor rejection clears sent and approved state", () => {
  assert.deepEqual(mentorReviewStateForStatus("rejected"), { testSent: false, testApproved: false, completed: false });
});

test("mentor checklist before reactivation is treated as stale", () => {
  assert.equal(
    mentorChecklistStaleAfterReactivation(
      { reactivatedDate: "2026-07-22" },
      { updatedAt: "2026-07-21T20:00:00.000Z", completed: true, testApproved: true }
    ),
    true
  );
});

test("mentor checklist after reactivation stays valid", () => {
  assert.equal(
    mentorChecklistStaleAfterReactivation(
      { reactivatedDate: "2026-07-22" },
      { updatedAt: "2026-07-22T08:00:00.000Z", completed: true, testApproved: true }
    ),
    false
  );
});

test("mentor checklist without reactivation is not stale", () => {
  assert.equal(mentorChecklistStaleAfterReactivation({}, { completed: true }), false);
});

test("mentor tests sent before reactivation are stale", () => {
  assert.equal(
    mentorTestStaleAfterReactivation(
      { reactivatedDate: "2026-07-22" },
      { sentAt: "2026-07-20T18:00:00.000Z", status: "sent" }
    ),
    true
  );
});

test("mentor tests sent after reactivation are current", () => {
  assert.equal(
    mentorTestStaleAfterReactivation(
      { reactivatedDate: "2026-07-22" },
      { sentAt: "2026-07-22T18:00:00.000Z", status: "sent" }
    ),
    false
  );
});
