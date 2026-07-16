-- P1 transcript-race Stage 4: index the uiMessageId / toolCallId dedup lookups.
--
-- appendConversationLog and reconcileAssistantHistory dedup by
--   WHERE session_id = ? AND owner_email = ? AND role = ? AND json_extract(meta_json,'$.uiMessageId') = ?
-- With no supporting index that is a scan per candidate row.
--
-- D1 rejects an expression index directly on json_extract() (SQLITE_ERROR 7500:
-- json_extract is not index-safe there). Instead we add VIRTUAL generated
-- columns that project the JSON fields, then index those. VIRTUAL (not STORED)
-- means no table rewrite and no extra row storage — the value is computed on
-- read, and the index materializes it. Additive + idempotent-friendly.
ALTER TABLE conversation_entries
    ADD COLUMN ui_message_id TEXT
    GENERATED ALWAYS AS (json_extract(meta_json, '$.uiMessageId')) VIRTUAL;

ALTER TABLE conversation_entries
    ADD COLUMN tool_call_id TEXT
    GENERATED ALWAYS AS (json_extract(meta_json, '$.toolCallId')) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_conversation_entries_uimsgid
    ON conversation_entries(session_id, owner_email, role, ui_message_id);

CREATE INDEX IF NOT EXISTS idx_conversation_entries_toolcallid
    ON conversation_entries(session_id, owner_email, tool_call_id);
