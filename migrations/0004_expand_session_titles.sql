-- Earlier auto-titles baked a 50-character ellipsis into session data. Preserve
-- useful title text in D1 and let the sidebar truncate visually at its real
-- available width. Deliberate user renames without the old trailing ellipsis are
-- untouched.
UPDATE sessions
SET name = substr(trim(replace(replace((
  SELECT content
  FROM conversation_entries
  WHERE conversation_entries.session_id = sessions.id
    AND conversation_entries.owner_email = sessions.owner_email
    AND conversation_entries.role = 'user'
    AND conversation_entries.content IS NOT NULL
  ORDER BY conversation_entries.id ASC
  LIMIT 1
), char(10), ' '), char(13), ' ')), 1, 200)
WHERE name LIKE '%…'
  AND EXISTS (
    SELECT 1
    FROM conversation_entries
    WHERE conversation_entries.session_id = sessions.id
      AND conversation_entries.owner_email = sessions.owner_email
      AND conversation_entries.role = 'user'
      AND conversation_entries.content IS NOT NULL
  );
