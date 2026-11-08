---- MODULE SessionLifecycle ----
EXTENDS SessionTable

VARIABLES status, turn

vars == <<status, turn>>

Init == status = "active" /\ turn = "idle"

Fire(e) == status' = Apply(status, e)

YouSendMessage ==
  /\ turn = "idle"
  /\ turn' = "working"
  /\ Fire("turn_started")

TurnFinishes ==
  /\ turn = "working"
  /\ turn' = "idle"
  /\ Fire("turn_completed")

TurnFails ==
  /\ turn = "working"
  /\ turn' = "idle"
  /\ Fire("turn_failed")

YouStopTurn ==
  /\ turn = "working"
  /\ turn' = "idle"
  /\ Fire("turn_aborted")

WatchdogEndsStuckTurn ==
  /\ turn = "working"
  /\ turn' = "idle"
  /\ Fire("turn_stuck")

RecoveryGivesUp ==
  /\ turn = "working"
  /\ turn' = "idle"
  /\ Fire("recovery_exhausted")

ScannerFlagsQuietSession ==
  /\ Fire("dead_session_detected")
  /\ UNCHANGED turn

YouArchive ==
  /\ Fire("archived")
  /\ UNCHANGED turn

YouUnarchive ==
  /\ Fire("unarchived")
  /\ UNCHANGED turn

Next ==
  \/ YouSendMessage
  \/ TurnFinishes
  \/ TurnFails
  \/ YouStopTurn
  \/ WatchdogEndsStuckTurn
  \/ RecoveryGivesUp
  \/ ScannerFlagsQuietSession
  \/ YouArchive
  \/ YouUnarchive

Spec == Init /\ [][Next]_vars

NeverStuckRunning == turn = "idle" => status /= "running"

WorkingShowsRunning == turn = "working" => status \in {"running", "archived"}

ArchivedOnlyWhenIdle == status = "archived" => turn = "idle"
====
