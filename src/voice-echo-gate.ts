import type { Transcriber, TranscriberSession, TranscriberSessionOptions } from "agents/voice";

const BARGE_MIN_CHARS = 6;

const ECHO_SHARE = 0.6;

const SPOKEN_MEMORY_MS = 20_000;

const MS_PER_SPOKEN_CHAR = 70;

const TAIL_GRACE_MS = 1_200;

const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '');

export type GateEvent = 'barge-held' | 'barge-passed' | 'echo-dropped';

export class SpokenRecord {
  private lines: { text: string; at: number; until: number }[] = [];

  private turnRunning = false;

  constructor(private readonly now: () => number = Date.now) {}

  spoke(text: string) {
    const at = this.now();
    const startsAfter = Math.max(at, this.lines.at(-1)?.until ?? at);

    this.lines.push({ text, at, until: startsAfter + text.length * MS_PER_SPOKEN_CHAR });
    this.lines = this.lines.filter((line) => at - line.until < SPOKEN_MEMORY_MS);
  }

  turnStarted() {
    this.turnRunning = true;
  }

  turnEnded() {
    this.turnRunning = false;
  }

  silenced() {
    const at = this.now();

    this.lines = this.lines.map((line) => ({ ...line, until: Math.min(line.until, at) }));
  }

  agentAudible(): boolean {
    const last = this.lines.at(-1);

    return this.turnRunning || (last !== undefined && this.now() < last.until + TAIL_GRACE_MS);
  }

  isEcho(heard: string): boolean {
    const heardWords = wordsOf(heard);

    if (heardWords.length === 0) return true;

    const longest = Math.max(0, ...this.lines.map((line) => longestSharedRun(heardWords, wordsOf(line.text))));

    return longest / heardWords.length >= ECHO_SHARE;
  }
}

const longestSharedRun = (heard: readonly string[], spoken: readonly string[]) => {
  let best = 0;
  for (let start = 0; start < spoken.length; start += 1) {
    for (let from = 0; from < heard.length; from += 1) {
      let run = 0;
      while (start + run < spoken.length && from + run < heard.length && spoken[start + run] === heard[from + run]) run += 1;
      best = Math.max(best, run);
    }
  }
  return best;
};

const isRealBargeIn = (record: SpokenRecord, heard: string) => heard.trim().length >= BARGE_MIN_CHARS && !record.isEcho(heard);

export const gateSession = (
  options: TranscriberSessionOptions,
  record: SpokenRecord,
  report: (event: GateEvent, heard: string) => void,
): TranscriberSessionOptions => {
  let held = false;
  let started = false;

  const release = (heard: string) => {
    held = false;
    started = true;
    report('barge-passed', heard);
    options.onSpeechStart?.(heard);
  };

  return {
    ...options,
    onSpeechStart: (text) => {
      if (record.agentAudible()) {
        held = true;
        started = false;
        report('barge-held', text ?? '');
        return;
      }

      held = false;
      started = true;
      options.onSpeechStart?.(text);
    },
    onInterim: (text) => {
      if (held) {
        if (!isRealBargeIn(record, text)) return;

        release(text);
      }

      options.onInterim?.(text);
    },
        onUtterance: (transcript) => {
      const wasHeld = held;

      held = false;
      started = false;

      if (wasHeld && !isRealBargeIn(record, transcript)) {
        report('echo-dropped', transcript);
        return;
      }

      if (record.agentAudible() && record.isEcho(transcript)) {
        report('echo-dropped', transcript);
        return;
      }

      if (wasHeld) {
        report('barge-passed', transcript);
        options.onSpeechStart?.(transcript);
      }

      options.onUtterance?.(transcript);
    },
  };
};

export class EchoGatedTranscriber implements Transcriber {
  constructor(
    private readonly inner: Transcriber,
    private readonly record: SpokenRecord,
    private readonly report: (event: GateEvent, heard: string) => void,
  ) {}

  createSession(options?: TranscriberSessionOptions): TranscriberSession {
    return this.inner.createSession(gateSession(options ?? {}, this.record, this.report));
  }
}
