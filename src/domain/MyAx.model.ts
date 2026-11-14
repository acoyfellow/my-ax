import * as Domain from "@alchemy.run/domain";
import { Attention } from "./Attention/Attention.aggregate";
import { Job } from "./Job/Job.aggregate";
import { Recipe } from "./Recipe/Recipe.aggregate";
import { Run } from "./Run/Run.aggregate";
import { Session } from "./Session/Session.aggregate";

export class MyAx extends Domain.Model("MyAx", { aggregates: [Job, Session, Run, Recipe, Attention] }) {}
