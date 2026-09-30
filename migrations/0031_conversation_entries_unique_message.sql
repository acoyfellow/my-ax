UPDATE conversation_entries
SET meta_json = json_object(
    'uiMessageId', substr(meta_json, 17, instr(substr(meta_json, 17), '"') - 1),
    'legacyTruncatedMeta', meta_json
)
WHERE meta_json IS NOT NULL
  AND json_valid(meta_json) = 0
  AND meta_json LIKE '{"uiMessageId":"%'
  AND instr(substr(meta_json, 17), '"') > 1;

UPDATE conversation_entries
SET meta_json = json_object('legacyTruncatedMeta', meta_json)
WHERE meta_json IS NOT NULL
  AND json_valid(meta_json) = 0;

DELETE FROM conversation_entries
WHERE ui_message_id IS NOT NULL
  AND id NOT IN (
    SELECT MIN(id) FROM conversation_entries
    WHERE ui_message_id IS NOT NULL
    GROUP BY session_id, owner_email, role, ui_message_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_entries_unique_message
    ON conversation_entries(session_id, owner_email, role, ui_message_id);
