// n is the notification. Calls and channel activity keep their own settings.
// Retaining the last preference change prevents a backlog when alerts resume.
export function directNotificationAllowed() {
  return `NOT EXISTS(SELECT 1 FROM direct_chat_notifications prefs
    WHERE prefs.userId=n.userId AND prefs.peerId=n.actorId
      AND (prefs.muted=1 OR n.created<=prefs.updated)
      AND (n.kind='message' OR (n.kind='gift' AND EXISTS(
        SELECT 1 FROM received_gifts dg WHERE dg.id=n.targetId AND dg.recipient=n.userId))))`;
}
