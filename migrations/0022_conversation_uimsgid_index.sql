-- P1 transcript-race Stage 4: index the uiMessageId dedup lookup.
--
-- appendConversationLog and reconcileAssistantHistory dedup by
--   WHERE session_id = ? AND owner_email = ? AND role = ? AND json_extract(meta_json,'$.uiMessageId') = ?
-- With no supporting index that is a scan per candidate message. On a long
-- thread reconcile (formerly on every onConnect) this multiplied into the
-- open-path stall. SQLite/D1 support expression indexes, so index the exact
-- json_extract expression alongside the equality-filtered columns.
--
-- Additive + idempotent. No data change.
CREATE INDEX IF NOT EXISTS idx_conversation_entries_uimsgid
    ON conversation_entries(
        session_id,
        owner_email,
        role,
        json_extract(meta_json, '$.uiMessageId')
    );

-- The toolCallId dedup path (conversation-log.ts) uses the same shape for tools.
CREATE INDEX IF NOT EXISTS idx_conversation_entries_toolcallid
    ON conversation_entries(
        session_id,
        owner_email,
        json_extract(meta_json, '$.toolCallId')
    );
