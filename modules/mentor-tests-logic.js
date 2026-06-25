function mentorReviewStateForStatus(status) {
  const approved = String(status || "") === "approved";
  return {
    testSent: approved,
    testApproved: approved,
    completed: approved
  };
}

module.exports = {
  mentorReviewStateForStatus
};
