-- P1 transcript-race Stage 4: index the uiMessageId / toolCallId dedup lookups.
--
-- appendConversationLog and reconcileAssistantHistory dedup by
--   WHERE session_id = ? AND owner_email = ? AND role = ? AND <uiMessageId> = ?
-- With no supporting index that is a scan per candidate row.
--
-- Two D1 gotchas this migration works around (both hit on the real remote DB):
--   1. D1 rejects an expression index directly on json_extract() (SQLITE_ERROR
--      7500). So we project the field into a VIRTUAL generated column and index
--      that instead.
--   2. Some existing rows have NON-JSON meta_json (34 on prod at migration time),
--      and json_extract() over invalid JSON throws 7500 when the index is built.
--      Guard with json_valid() so bad rows yield NULL instead of aborting.
-- VIRTUAL (not STORED) = no table rewrite, value computed on read + materialized
-- by the index. Additive.
ALTER TABLE conversation_entries
    ADD COLUMN ui_message_id TEXT
    GENERATED ALWAYS AS (
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.uiMessageId') END
    ) VIRTUAL;

ALTER TABLE conversation_entries
    ADD COLUMN tool_call_id TEXT
    GENERATED ALWAYS AS (
        CASE WHEN json_valid(meta_json) THEN json_extract(meta_json, '$.toolCallId') END
    ) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_conversation_entries_uimsgid
    ON conversation_entries(session_id, owner_email, role, ui_message_id);

CREATE INDEX IF NOT EXISTS idx_conversation_entries_toolcallid
    ON conversation_entries(session_id, owner_email, tool_call_id);
