// Reserved server-created room ID; normal create requests derive their IDs
// from the authenticated actor and cannot choose this value.
// Keep in sync with drizzle/0043_default_community_group.sql.
export const COMMUNITY_ROOM_ID = 'room:noctgram-community';
