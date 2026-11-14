import * as Domain from "@alchemy.run/domain";
import { Attention } from "./Attention/Attention.aggregate";
import { AudioMessage } from "./AudioMessage/AudioMessage.aggregate";
import { BrowserRecording } from "./BrowserRecording/BrowserRecording.aggregate";
import { Computer } from "./Computer/Computer.aggregate";
import { ComputerSnapshot } from "./ComputerSnapshot/ComputerSnapshot.aggregate";
import { Email } from "./Email/Email.aggregate";
import { Job } from "./Job/Job.aggregate";
import { OwnerPreference } from "./OwnerPreference/OwnerPreference.aggregate";
import { PushSubscription } from "./PushSubscription/PushSubscription.aggregate";
import { Recipe } from "./Recipe/Recipe.aggregate";
import { Run } from "./Run/Run.aggregate";
import { Session } from "./Session/Session.aggregate";
import { Skill } from "./Skill/Skill.aggregate";
import { Snippet } from "./Snippet/Snippet.aggregate";
import { Widget } from "./Widget/Widget.aggregate";
import { WorkspaceSnapshot } from "./WorkspaceSnapshot/WorkspaceSnapshot.aggregate";

export class MyAx extends Domain.Model("MyAx", {
  aggregates: [
    Job,
    Session,
    Run,
    Recipe,
    Attention,
    Computer,
    ComputerSnapshot,
    Widget,
    Skill,
    Email,
    PushSubscription,
    OwnerPreference,
    Snippet,
    WorkspaceSnapshot,
    AudioMessage,
    BrowserRecording,
  ],
}) {}
