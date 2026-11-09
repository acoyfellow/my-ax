---- MODULE SessionTable ----
Events == {"turn_started", "turn_completed", "turn_failed", "turn_aborted", "turn_stuck", "recovery_exhausted", "dead_session_detected", "pi_run_started", "pi_run_settled", "pi_run_settled_failed", "archived", "unarchived"}

From(e) ==
CASE e = "turn_started" -> {"active", "error", "interrupted", "running", "archived"}
  [] e = "turn_completed" -> {"running", "interrupted"}
  [] e = "turn_failed" -> {"running", "interrupted"}
  [] e = "turn_aborted" -> {"active", "running", "error", "interrupted"}
  [] e = "turn_stuck" -> {"running"}
  [] e = "recovery_exhausted" -> {"active", "running"}
  [] e = "dead_session_detected" -> {"active", "running"}
  [] e = "pi_run_started" -> {"active", "error"}
  [] e = "pi_run_settled" -> {"running", "error"}
  [] e = "pi_run_settled_failed" -> {"active", "running"}
  [] e = "archived" -> {"active", "error", "interrupted"}
  [] e = "unarchived" -> {"archived"}

To(e) ==
CASE e = "turn_started" -> "running"
  [] e = "turn_completed" -> "active"
  [] e = "turn_failed" -> "error"
  [] e = "turn_aborted" -> "active"
  [] e = "turn_stuck" -> "active"
  [] e = "recovery_exhausted" -> "interrupted"
  [] e = "dead_session_detected" -> "interrupted"
  [] e = "pi_run_started" -> "running"
  [] e = "pi_run_settled" -> "active"
  [] e = "pi_run_settled_failed" -> "error"
  [] e = "archived" -> "archived"
  [] e = "unarchived" -> "active"

Apply(s, e) == IF s \in From(e) THEN To(e) ELSE s
====
