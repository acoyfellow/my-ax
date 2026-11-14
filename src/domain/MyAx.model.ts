import * as Domain from "@alchemy.run/domain";
import { Job } from "./Job/Job.aggregate";

export class MyAx extends Domain.Model("MyAx", { aggregates: [Job] }) {}
