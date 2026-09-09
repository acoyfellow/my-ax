export interface DecisionResponseStore {
  insertEvent(input: { id: string; eventId: string; email: string; question: string; choice: string; now: string }): Promise<void>;
  completeRun(input: { id: string; email: string }): Promise<boolean>;
  reopenRun(input: { id: string; email: string }): Promise<boolean>;
  deleteEvent(input: { id: string; eventId: string; email: string }): Promise<void>;
}
