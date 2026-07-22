function mentorReviewStateForStatus(status) {
  const approved = String(status || "") === "approved";
  return {
    testSent: approved,
    testApproved: approved,
    completed: approved
  };
}

function timestampMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function mentorChecklistStaleAfterReactivation(person = {}, checklist = {}) {
  const reactivatedAt = timestampMs(person.reactivatedDate);
  if (reactivatedAt === null) return false;

  const checklistAt = timestampMs(
    checklist.updatedAt
      || checklist.completedAt
      || checklist.reviewedAt
      || checklist.sentAt
      || checklist.testReadyNotifiedAt
  );
  return checklistAt === null || checklistAt < reactivatedAt;
}

function mentorTestStaleAfterReactivation(person = {}, test = {}) {
  const reactivatedAt = timestampMs(person.reactivatedDate);
  if (reactivatedAt === null || !test) return false;
  const testAt = timestampMs(test.sentAt || test.updatedAt || test.submittedAt);
  return testAt === null || testAt < reactivatedAt;
}

module.exports = {
  mentorReviewStateForStatus,
  mentorChecklistStaleAfterReactivation,
  mentorTestStaleAfterReactivation
};
