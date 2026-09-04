export const selectForkCutoffSql = `
  SELECT id
  FROM conversation_entries
  WHERE session_id = ? AND owner_email = ? AND ui_message_id = ?
  ORDER BY id DESC
  LIMIT 1
`;
