import * as Domain from "@alchemy.run/domain";
import { Job } from "./Job/Job.aggregate";
import { Session } from "./Session/Session.aggregate";

export class MyAx extends Domain.Model("MyAx", { aggregates: [Job, Session] }) {}
