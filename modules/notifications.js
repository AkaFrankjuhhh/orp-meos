function notificationList(person) {
  if (!person) return [];
  if (!Array.isArray(person.notifications)) person.notifications = [];
  return person.notifications;
}

function markNotificationsRead(person, now = new Date().toISOString()) {
  person.notifications = notificationList(person).map((notification) => ({
    ...notification,
    readAt: notification.readAt || now
  }));
  return person.notifications;
}

function clearNotifications(person) {
  person.notifications = [];
  return person.notifications;
}

module.exports = {
  markNotificationsRead,
  clearNotifications
};
