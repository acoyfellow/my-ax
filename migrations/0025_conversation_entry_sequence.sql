ALTER TABLE conversation_entries ADD COLUMN sequence_number INTEGER;

WITH numbered_entries AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id, owner_email ORDER BY id) AS sequence_number
    FROM conversation_entries
)
UPDATE conversation_entries
SET sequence_number = (
    SELECT sequence_number
    FROM numbered_entries
    WHERE numbered_entries.id = conversation_entries.id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_entries_sequence
    ON conversation_entries(session_id, owner_email, sequence_number);
