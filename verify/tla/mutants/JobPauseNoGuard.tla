---- MODULE JobPauseNoGuard ----
EXTENDS Naturals, FiniteSets

CONSTANTS MaxRuns, MaxAlarms

VARIABLES status, runCount, scheduleId, alarms, firing, nextAlarm, pause, resume

vars == <<status, runCount, scheduleId, alarms, firing, nextAlarm, pause, resume>>

None == 0

Init ==
  /\ status = "active"
  /\ runCount = 0
  /\ scheduleId = 1
  /\ alarms = {1}
  /\ firing = {}
  /\ nextAlarm = 2
  /\ pause = "idle"
  /\ resume = None

AlarmWakes(a) ==
  /\ a \in alarms
  /\ a \notin firing
  /\ firing' = firing \cup {a}
  /\ UNCHANGED <<status, runCount, scheduleId, alarms, nextAlarm, pause, resume>>

AlarmClaimsRun(a) ==
  /\ a \in firing
  /\ firing' = firing \ {a}
  /\ IF status = "active" /\ runCount < MaxRuns
       THEN /\ runCount' = runCount + 1
            /\ IF runCount + 1 >= MaxRuns
                 THEN /\ status' = "exhausted"
                      /\ scheduleId' = None
                      /\ alarms' = alarms \ {scheduleId}
                 ELSE UNCHANGED <<status, scheduleId, alarms>>
       ELSE UNCHANGED <<status, runCount, scheduleId, alarms>>
  /\ UNCHANGED <<nextAlarm, pause, resume>>

PauseCancelsAlarm ==
  /\ pause = "idle"
  /\ status = "active"
  /\ scheduleId /= None
  /\ alarms' = alarms \ {scheduleId}
  /\ pause' = "cancelled"
  /\ UNCHANGED <<status, runCount, scheduleId, firing, nextAlarm, resume>>

PauseSaves ==
  /\ pause = "cancelled"
  /\ pause' = "idle"
  /\ IF TRUE
       THEN /\ status' = "paused"
            /\ scheduleId' = None
            /\ UNCHANGED <<alarms, nextAlarm>>
       ELSE /\ alarms' = alarms \cup {nextAlarm}
            /\ nextAlarm' = nextAlarm + 1
            /\ UNCHANGED <<status, scheduleId>>
  /\ UNCHANGED <<runCount, firing, resume>>

ResumeSchedulesAlarm ==
  /\ resume = None
  /\ status = "paused"
  /\ nextAlarm <= MaxAlarms
  /\ alarms' = alarms \cup {nextAlarm}
  /\ resume' = nextAlarm
  /\ nextAlarm' = nextAlarm + 1
  /\ UNCHANGED <<status, runCount, scheduleId, firing, pause>>

ResumeSaves ==
  /\ resume /= None
  /\ resume' = None
  /\ IF status = "paused"
       THEN /\ status' = "active"
            /\ scheduleId' = resume
            /\ UNCHANGED alarms
       ELSE /\ alarms' = alarms \ {resume}
            /\ UNCHANGED <<status, scheduleId>>
  /\ UNCHANGED <<runCount, firing, nextAlarm, pause>>

Settled == pause = "idle" /\ resume = None /\ firing = {}

Done ==
  /\ Settled
  /\ UNCHANGED vars

AlarmWakesUp == \E a \in alarms : AlarmWakes(a)

AlarmRuns == \E a \in firing : AlarmClaimsRun(a)

Next ==
  \/ AlarmWakesUp
  \/ AlarmRuns
  \/ PauseCancelsAlarm
  \/ PauseSaves
  \/ ResumeSchedulesAlarm
  \/ ResumeSaves
  \/ Done

Spec == Init /\ [][Next]_vars

NeverRunsPastLimit == runCount <= MaxRuns

PausedJobNeverRuns == [][status = "paused" => runCount' = runCount]_vars

ExhaustedStaysExhausted == [][status = "exhausted" => status' = "exhausted"]_vars

ActiveJobHasLiveAlarm == (Settled /\ status = "active") => scheduleId \in alarms

PausedJobHasNoAlarm == (Settled /\ status = "paused") => alarms = {}

ExhaustedJobHasNoAlarm == (Settled /\ status = "exhausted") => alarms = {}

AtMostOneLiveAlarm == Settled => Cardinality(alarms) <= 1
====
