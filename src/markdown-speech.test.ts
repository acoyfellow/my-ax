import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownSpeechSanitizer, sanitizeMarkdownForSpeech } from "./markdown-speech";
import { createVoiceTurnStream } from "./voice-turn-stream";

function stream(chunks: string[]): string | null {
  const sanitizer = new MarkdownSpeechSanitizer();
  const parts = chunks.map((chunk) => sanitizer.push(chunk));
  parts.push(sanitizer.finish());
  const result = parts.filter((part): part is string => part !== null).join("");
  return result || null;
}

function assertEverySplit(markdown: string, spoken: string | null): void {
  assert.equal(sanitizeMarkdownForSpeech(markdown), spoken, "whole input");
  assert.equal(stream([...markdown]), spoken, "one character deltas");
  for (let split = 1; split < markdown.length; split++) {
    assert.equal(stream([markdown.slice(0, split), markdown.slice(split)]), spoken, `split ${split}`);
  }
}

function assertNeverEmitsSecret(markdown: string, secret: string): void {
  const chunkSets = [
    [markdown],
    [...markdown],
    ...Array.from({ length: Math.max(0, markdown.length - 1) }, (_unused, split) => [markdown.slice(0, split + 1), markdown.slice(split + 1)]),
  ];
  for (const chunks of chunkSets) {
    const sanitizer = new MarkdownSpeechSanitizer();
    for (const chunk of chunks) assert.equal(sanitizer.push(chunk)?.includes(secret) ?? false, false, `push ${JSON.stringify(chunks)}`);
    assert.equal(sanitizer.finish()?.includes(secret) ?? false, false, `finish ${JSON.stringify(chunks)}`);
  }
}

const markdown = "# Result\n1. **Bold** and ~~gone~~ with [the label](https://example.com/a_b), `x_y`, and \\*literal\\*.";
const spoken = "Result Bold and gone with the label, and *literal*.";
const fenceCharacters = ["`", "~"] as const;
const fenceLengths = [3, 4, 5] as const;

test("sanitizes Markdown deterministically", () => {
  assertEverySplit(markdown, spoken);
  assertEverySplit("## Heading!\n- First sentence.\n> Second: yes?", "Heading! First sentence. Second: yes?");
  assertEverySplit("unfinished **emphasis and [label", "unfinished emphasis and label");
  assertEverySplit("Escaped \\[ bracket, \\` tick, and \\* star.", "Escaped [ bracket, ` tick, and * star.");
});

test("fences require valid opener and closer lines", () => {
  const cases: Array<[string, string | null]> = [
    ["```ts\nconst secret = 1;\n```", null],
    ["~~~js\nsecret()\n~~~", null],
    ["Before.\n````lang\n``` is body\nleak()\n````\nAfter.", "Before. After."],
    ["Start\n~~~~\n~~~ is body\nhidden\n~~~~\nEnd.", "Start End."],
    ["Text\n```\nnever closes and must stay hidden", "Text"],
    ["~~~\n`shorter` and ``` still hidden\n~~~\nSafe.", "Safe."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);

  for (const character of fenceCharacters) {
    for (const length of fenceLengths) {
      const fence = character.repeat(length);
      const longerFence = character.repeat(length + 1);
      assertEverySplit(`${fence}lang\nhidden ${fence} and ${longerFence} remain hidden\n${fence}\nSafe.`, "Safe.");
      assertEverySplit(`${fence}\nhidden\n${longerFence} trailing text\nstill hidden\n${fence}\nSafe.`, "Safe.");
      assertEverySplit(`${fence}\nhidden\n${fence} \t\nSafe.`, "Safe.");
      assertEverySplit(`Say ${fence}code${fence} now.`, character === "`" ? "Say now." : "Say code now.");
    }
  }
});

test("fence indentation is limited to three spaces", () => {
  for (const character of fenceCharacters) {
    for (const length of fenceLengths) {
      const fence = character.repeat(length);
      for (let spaces = 0; spaces <= 3; spaces++) {
        const indentation = " ".repeat(spaces);
        assertEverySplit(`${indentation}${fence}\nhidden\n${indentation}${fence}\nSafe.`, "Safe.");
      }
      assertEverySplit(`    ${fence}visible${fence}\nSafe.`, "Safe.");
    }
  }
});

test("fences suppress content after container prefixes and retain following prose", () => {
  const cases: Array<[string, string]> = [
    ["Before\n> ```ts\nsecret-token\n> ```\nSafe.", "Before Safe."],
    ["Before\n- ```ts\nsecret-token\n- ```\nSafe.", "Before Safe."],
    ["Before\n> - ```ts\nsecret-token\n> - ```\nSafe.", "Before Safe."],
    ["Before\n>   - ~~~ts\nsecret-token\n>   - ~~~\nSafe.", "Before Safe."],
    ["Before\r\n>   - ```ts\r\nsecret-token\r\n>   - ```\r\nSafe.", "Before Safe."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("nested container prefixes retain ordinary visible prose", () => {
  assertEverySplit(">   - Visible list prose.", "Visible list prose.");
  assertEverySplit(">   1. Visible ordered prose.", "Visible ordered prose.");
});

test("links suppress balanced destinations and quoted titles", () => {
  const cases: Array<[string, string]> = [
    [`Read [the label](https://example.test/a_(nested) "A title (too)") after.`, "Read the label after."],
    ["[label](target(foo(bar)) 'title')! Next sentence.", "label! Next sentence."],
    [`[label](target "title has ( and ) plus an escaped \\"quoted (pair)\\"") after.`, "label after."],
    ["Malformed [label](destination(no close", "Malformed label"],
    [`Malformed [label](destination "unterminated title) remains hidden.`, "Malformed label"],
    ["A [label] followed by prose.", "A label followed by prose."],
    ["[outer [inner] label](https://secret.example/path) after.", "outer [inner] label after."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("CommonMark autolinks suppress destinations without hiding comparison prose", () => {
  const cases: Array<[string, string]> = [
    ["See <https://secret.example/path?token=abc> after.", "See after."],
    ["Mail <mailto:secret@example.com> after.", "Mail after."],
    ["Email <secret@example.com> after.", "Email after."],
    ["Compare 2 < 3 > 1 after.", "Compare 2 < 3 > 1 after."],
    ["Use <not a link> as ordinary prose.", "Use as ordinary prose."],
    ["Keep <unfinished prose", "Keep"],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("CommonMark reference links and definitions suppress metadata without hiding bracket prose", () => {
  const cases: Array<[string, string]> = [
    ["Read [shown][private] after.", "Read shown after."],
    ["Read [shown][] after.", "Read shown after."],
    ["Read [shortcut] after.", "Read shortcut after."],
    ["[shown][private]\n\n[private]: https://secret.example/path?access_token=leak\nSafe.", "shown Safe."],
    [`  [private]: <https://secret.example/path?access_token=leak> "credential title"\nSafe.`, "Safe."],
    [`[private]: https://secret.example/path?access_token=leak\n  "credential title"\nSafe.`, "Safe."],
    ["[shown] [private] remains ordinary prose.", "shown private remains ordinary prose."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("reference definitions suppress metadata inside containers and CRLF title continuations", () => {
  const cases: Array<[string, string]> = [
    ["Read [shown][private]\n> [private]: https://secret.example/path?access_token=leak\n> Safe.", "Read shown Safe."],
    ["- [private]: https://secret.example/path?access_token=leak\n- Safe.", "Safe."],
    ["[private]: https://secret.example/path?access_token=leak\r\n  \"credential title\"\r\nSafe.", "Safe."],
    ["> [private]: https://secret.example/path?access_token=leak\r\n> \"credential title\"\r\n> Safe.", "Safe."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("reference destinations on permitted following lines remain suppressed", () => {
  const cases: Array<[string, string]> = [
    ["Read [shown][private]\n[private]:\n  https://secret.example/path?access_token=leak\nSafe.", "Read shown Safe."],
    ["Read [shown][private]\r\n[private]:\r\n  https://secret.example/path?access_token=leak\r\nSafe.", "Read shown Safe."],
    ["Read [shown][private]\n>   - [private]: https://secret.example/path?access_token=leak\n>   - Safe.", "Read shown Safe."],
    ["Read [shown][private]\n>   - [private]:\n>   -   https://secret.example/path?access_token=leak\n>   - Safe.", "Read shown Safe."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("four-space and tab reference continuations become suppressed indented code", () => {
  const secret = "REFERENCE_INDENT_SECRET";
  const cases = [
    `[private]:\n    ${secret}\nSafe.`,
    `[private]:\n\t${secret}\nSafe.`,
    `[private]: https://secret.example/path\n    ${secret}\nSafe.`,
    `[private]: https://secret.example/path\n\t${secret}\nSafe.`,
  ];
  for (const source of cases) {
    assertEverySplit(source, "Safe.");
    assertNeverEmitsSecret(source, secret);
  }
});

test("raw HTML tags suppress attributes while preserving safe text and comparison prose", () => {
  const cases: Array<[string, string]> = [
    [`Before <a href="https://secret.example/path?token=abc">safe</a> after.`, "Before safe after."],
    [`Before <IMG SRC=https://secret.example/path?token=abc data-token=def/> after.`, "Before after."],
    [`Before <private-link data-token=abc>safe</private-link> after.`, "Before safe after."],
    [`Before <svg data-token=abc>safe</svg> after.`, "Before safe after."],
    [`Before <section title="1 > 0" href='https://secret.example/path?token=abc'>safe > text</section> after.`, "Before safe > text after."],
    [`Before <a href="https://secret.example/path?token=abc`, "Before"],
    [`Before <div token=abc`, "Before"],
    [`Before <svg data-token=abc`, "Before"],
    [`Before <private-link data-token=abc`, "Before"],
    ["Compare 2 < 3 > 1 after.", "Compare 2 < 3 > 1 after."],
    ["Use <not-a-link> as ordinary prose.", "Use as ordinary prose."],
    ["Use <not a link> as ordinary prose.", "Use as ordinary prose."],
    ["Keep <not-a-link prose", "Keep"],
    ["Keep <unfinished prose", "Keep"],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("HTML raw bodies and inert containers never emit their contents", () => {
  const secret = "RAW_SECRET_SENTINEL";
  for (const element of ["script", "style", "pre", "textarea", "template", "title", "head", "iframe", "noembed", "noframes", "noscript", "xmp"]) {
    const source = `Before <${element}>${secret}</${element}> After.`;
    assertEverySplit(source, "Before After.");
    assertNeverEmitsSecret(source, secret);
  }
  assertEverySplit(`Before\r\n<SCRIPT>${secret}</sCrIpT>\r\nAfter.`, "Before After.");
  assertNeverEmitsSecret(`Before\r\n<SCRIPT>${secret}</sCrIpT>\r\nAfter.`, secret);
  assertEverySplit(`Before <plaintext>${secret}\nAfter.`, "Before");
  assertNeverEmitsSecret(`Before <plaintext>${secret}\nAfter.`, secret);
});

test("nested suppressed HTML containers retain secrecy through matched outer closures", () => {
  const secret = "NESTED_HTML_SECRET_SENTINEL";
  const cases = [
    `Before <DIV hidden>${secret}<div INERT>${secret}</dIv>${secret}</DIV> After.`,
    `Before <TeMpLaTe>${secret}<template>${secret}</TeMpLaTe>${secret}</tEmPlAtE> After.`,
    `Before <section inert><div>${secret}</div>${secret}</section> After.`,
    `Before <div hidden><span>${secret}</div>${secret}</span></div> After.`,
  ];
  for (const source of cases) {
    assertEverySplit(source, "Before After.");
    assertNeverEmitsSecret(source, secret);
  }
});

test("HTML code and preformatted containers suppress their bodies", () => {
  const secret = "HTML_CODE_SECRET_SENTINEL";
  for (const element of ["code", "kbd", "listing", "pre", "samp", "tt", "var"]) {
    const source = `Before <${element}>${secret}</${element}> After.`;
    assertEverySplit(source, "Before After.");
    assertNeverEmitsSecret(source, secret);
  }
  assertEverySplit(`Before <CoDe>${secret}</cOdE> After.`, "Before After.");
  assertNeverEmitsSecret(`Before <CoDe>${secret}</cOdE> After.`, secret);
});

test("self-closing raw-text syntax still suppresses non-void element bodies", () => {
  const secret = "SELF_CLOSING_RAW_SECRET";
  for (const element of ["script", "style", "textarea"]) {
    for (const suffix of ["/>", " />"]) {
      const source = `Before <${element}${suffix}${secret}</${element}> After.`;
      assertEverySplit(source, "Before After.");
      assertNeverEmitsSecret(source, secret);
    }
  }
  const unfinished = `Before <script/>${secret}`;
  assertEverySplit(unfinished, "Before");
  assertNeverEmitsSecret(unfinished, secret);
});

test("hidden and inert attributes suppress non-void container bodies", () => {
  const secret = "HIDDEN_ATTRIBUTE_SECRET";
  const cases = [
    `Before <div hidden>${secret}</div> After.`,
    `Before <section inert>${secret}</section> After.`,
    `Before <private-panel hidden="until-found">${secret}</private-panel> After.`,
    `Before <private-panel inert=''>${secret}</private-panel> After.`,
  ];
  for (const source of cases) {
    assertEverySplit(source, "Before After.");
    assertNeverEmitsSecret(source, secret);
  }
  assertEverySplit("Before <input hidden> Safe.", "Before Safe.");

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(`Before <div hidden>${secret}`), "Before");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("unfinished potential autolinks fail closed at finish and reset cleanly", () => {
  const secret = "AUTOLINK_SECRET_SENTINEL";
  const cases = [
    `Before <https://secret.example/${secret}`,
    `Before <mailto:${secret}@example.com`,
    `Before <${secret}@example.com`,
  ];
  for (const source of cases) {
    assertEverySplit(source, "Before");
    assertNeverEmitsSecret(source, secret);
  }

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(`Before <https://secret.example/${secret}`), "Before");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("malformed started autolinks remain suppressed while ordinary comparison prose recovers", () => {
  const secret = "MALFORMED_AUTOLINK_SECRET_SENTINEL";
  const cases: Array<[string, string]> = [
    ["Before <x@x..x", "Before"],
    ["Before <https://x y", "Before"],
    [`Before <x@x..x${secret}`, "Before"],
    [`Before <https://x y${secret}`, "Before"],
    [`Before <x@x..x${secret}> After.`, "Before After."],
    [`Before <https://x y${secret}> After.`, "Before After."],
    ["Compare 2 < 3 > 1 and x < y without a closing delimiter.", "Compare 2 < 3 > 1 and x < y without a closing delimiter."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
  assertNeverEmitsSecret(`Before <x@x..x${secret}`, secret);
  assertNeverEmitsSecret(`Before <https://x y${secret}`, secret);

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(`Before <x@x..x${secret}`), "Before");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("malformed angle autolinks fail closed before RFC validation", () => {
  const secret = "MALFORMED_ANGLE_AUTOLINK_SECRET";
  const longScheme = "a".repeat(33);
  const cases: Array<[string, string]> = [
    [`Before <http_:${secret}> After.`, "Before After."],
    [`Before <http_:${secret}`, "Before"],
    [`Before <${longScheme}:${secret}> After.`, "Before After."],
    [`Before <${longScheme}:${secret}`, "Before"],
    [`Before <user(name)@example.test:${secret}> After.`, "Before After."],
    [`Before <user(name)@example.test:${secret}`, "Before"],
  ];
  for (const [source, expected] of cases) {
    assertEverySplit(source, expected);
    assertNeverEmitsSecret(source, secret);
  }
  assert.equal(stream(["Before <http_", `:${secret}> After.`]), "Before After.");

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push("Before <http_"), "Before");
  assert.equal(sanitizer.push(`:${secret}`), null);
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("credential-shaped angle candidates with encoded separators fail closed across stream boundaries", () => {
  const secret = "ENCODED_ANGLE_SECRET_SENTINEL";
  const candidates = [
    `<@x:${secret}>`,
    `<:${secret}>`,
    `<http&#58;${secret}>`,
    `<http&#x3a;${secret}>`,
    `<http&#X00003A;${secret}>`,
    `<http&#000058${secret}>`,
    `<http&#x00003A${secret}>`,
    `<&#64;x&#58;${secret}>`,
    `<user&#000064example&#x3a;${secret}>`,
    `<user&commat;example&colon;${secret}>`,
    `<http&#58;user@${secret}>`,
    `<http&#58;&#64;${secret}>`,
    `<http&#x3g;${secret}>`,
    `<http&colon${secret}>`,
  ];

  for (const candidate of candidates) {
    const complete = `Before ${candidate} After.`;
    const unfinished = `Before ${candidate.slice(0, -1)}`;
    assertEverySplit(complete, "Before After.");
    assertNeverEmitsSecret(complete, secret);
    assertEverySplit(unfinished, "Before");
    assertNeverEmitsSecret(unfinished, secret);
  }

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(`Before <http&#x3a;${secret}`), "Before");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("whitespace-separated malformed credential candidates fail closed across every stream boundary", () => {
  const secret = "WHITESPACE_ANGLE_SECRET_SENTINEL";
  const prefixes = ["http_", "user(name)", "a".repeat(33)];
  const whitespaceRuns = [" ", "\t", "\r\n", " \t", "\f\v"];
  const markers = [
    ":",
    "@",
    "&colon;",
    "&CoLoN;",
    "&commat;",
    "&CoMmAt;",
    "&#58;",
    "&#000058;",
    "&#x3a;",
    "&#X00003A;",
    "&colon",
    "&#000058",
    "&#x3g",
    "&colonz",
    ":&CoMmAt;",
    "&colon;@",
  ];

  for (const prefix of prefixes) {
    for (const whitespace of whitespaceRuns) {
      for (const marker of markers) {
        const complete = `Before <${prefix}${whitespace}${marker}${secret}> After.`;
        const unfinished = `Before <${prefix}${whitespace}${marker}${secret}`;
        assertEverySplit(complete, "Before After.");
        assertEverySplit(unfinished, "Before");
      }
    }
  }

  const complete = `Before <http_ \t&colon;${secret}> After.`;
  const unfinished = `Before <http_ \t&colon;${secret}`;
  assertNeverEmitsSecret(complete, secret);
  assertNeverEmitsSecret(unfinished, secret);

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push("Before <http_ \t&co"), "Before");
  assert.equal(sanitizer.push(`lon;${secret}`), null);
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("comparison prose with whitespace after an angle bracket remains visible", () => {
  const cases = [
    "Compare 2 < 3 > 1 after.",
    "Compare x < y: a ratio and x < user@example.test as prose.",
    "Compare x < y &colon; z > w as prose.",
    "Compare x < y without a closing delimiter.",
  ];
  for (const source of cases) assertEverySplit(source, source);
});

test("unknown tags with bare attributes fail closed while prose after completed tags recovers", () => {
  const secret = "BARE_ATTRIBUTE_SECRET";
  const unfinished = `Before <opaque ${secret}`;
  const completed = `Before <opaque ${secret}>Safe prose.`;
  assertEverySplit(unfinished, "Before");
  assertNeverEmitsSecret(unfinished, secret);
  assertEverySplit(completed, "Before Safe prose.");
  assertNeverEmitsSecret(completed, secret);
});

test("indented code blocks suppress LF, CRLF, container, and blank-line continuations", () => {
  const secret = "INDENTED_SECRET_SENTINEL";
  const cases: Array<[string, string]> = [
    [`Before.\n    ${secret}\n    continuation\n\n    ${secret}\nAfter.`, "Before. After."],
    [`Before.\r\n\t${secret}\r\n\tcontinuation\r\n\r\n\t${secret}\r\nAfter.`, "Before. After."],
    [`Before\n>     ${secret}\n>     continuation\n> Safe.`, "Before Safe."],
    [`Before\n-     ${secret}\n-     continuation\n- Safe.`, "Before Safe."],
    ["   Ordinary indented prose.\n>    Container prose.\nAfter.", "Ordinary indented prose. Container prose. After."],
  ];
  for (const [source, expected] of cases) {
    assertEverySplit(source, expected);
    assertNeverEmitsSecret(source, secret);
  }
  assertEverySplit(`Before\n    ${secret}`, "Before");
  assertNeverEmitsSecret(`Before\n    ${secret}`, secret);
});

test("HTML comments, declarations, processing instructions, and CDATA never emit contents", () => {
  const secret = "HTML_CONTROL_SECRET_SENTINEL";
  const cases: Array<[string, string]> = [
    [`Before <!-- ${secret} --> After.`, "Before After."],
    [`Before <!DOCTYPE [ ${secret} > ${secret} ]> After.`, "Before After."],
    [`Before <?instruction ${secret}?> After.`, "Before After."],
    [`Before <![CDATA[ ${secret} ]]> After.`, "Before After."],
    [`Before <!-- ${secret}`, "Before"],
    [`Before <!DOCTYPE ${secret}`, "Before"],
    [`Before <?instruction ${secret}`, "Before"],
    [`Before <![CDATA[ ${secret}`, "Before"],
  ];
  for (const [source, expected] of cases) {
    assertEverySplit(source, expected);
    assertNeverEmitsSecret(source, secret);
  }
});

test("incomplete secrecy constructs finish silently and reset before the next turn", () => {
  const secret = "RESET_SECRET_SENTINEL";
  for (const source of [
    `Before <script>${secret}`,
    `Before <!-- ${secret}`,
    `Before <!DOCTYPE ${secret}`,
    `Before <?instruction ${secret}`,
    `Before <![CDATA[ ${secret}`,
    `Before\n    ${secret}`,
    `Before <opaque inert ${secret}`,
  ]) {
    const sanitizer = new MarkdownSpeechSanitizer();
    assert.equal(sanitizer.push(source)?.includes(secret) ?? false, false, source);
    assert.equal(sanitizer.finish()?.includes(secret) ?? false, false, source);
    sanitizer.reset();
    assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.", source);
    assert.equal(sanitizer.finish(), null, source);
  }
});

test("nested HTML suppression finalizes and resets without crossing turns", () => {
  const secret = "NESTED_RESET_SECRET_SENTINEL";
  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(`Before <DIV hidden>${secret}<div inert>${secret}</div>`), "Before");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push(`<CoDe>${secret}</cOdE>Safe next turn.`), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Visible turn."), "Visible turn.");
  assert.equal(sanitizer.finish(), null);
});

test("unknown and custom tags with boolean attributes never emit markup", () => {
  const secret = "BOOLEAN_ATTRIBUTE_SECRET_SENTINEL";
  const cases: Array<[string, string]> = [
    ["Before <opaque hidden>safe</opaque> After.", "Before After."],
    ["Before <opaque private>safe</opaque> After.", "Before safe After."],
    ["Before <unknown disabled>safe</unknown> After.", "Before safe After."],
    ["Before <private-widget sealed>safe</private-widget> After.", "Before safe After."],
    [`Before <opaque inert ${secret}`, "Before"],
    ["Before <boolean-secret-sentinel hidden>safe</boolean-secret-sentinel> After.", "Before After."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
  assertNeverEmitsSecret(`Before <opaque inert ${secret}`, secret);
  assertNeverEmitsSecret("Before <boolean-secret-sentinel hidden>safe</boolean-secret-sentinel> After.", "boolean-secret-sentinel");
});

test("literal NUL source characters never terminate angle secrecy", () => {
  const secret = "NUL_ANGLE_SECRET_SENTINEL";
  const nul = "\u0000";
  const cases: Array<[string, string]> = [
    [`Before <http_${nul} :${secret}> After.`, "Before After."],
    [`Before <${nul}http_:${secret}> After.`, "Before After."],
    [`Before <http_:${nul}${secret}> After.`, "Before After."],
    [`Before <http_${nul}${nul} :${secret}> After.`, "Before After."],
    [`Before <http_:${secret}${nul}> After.`, "Before After."],
    [`Before <http_${nul} :${secret}`, "Before"],
    [`Before <script${nul}>${secret}</script> After.`, "Before After."],
    [`Before <div hidden${nul}>${secret}</div> After.`, "Before After."],
  ];

  for (const [source, expected] of cases) {
    assertEverySplit(source, expected);
    assertNeverEmitsSecret(source, secret);
  }

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push("Before <http_"), "Before");
  assert.equal(sanitizer.push(`${nul} :${secret}`), null);
  assert.equal(sanitizer.push("> After."), " After.");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("escaped secrecy delimiters remain structural while ordinary prose stays audible", () => {
  const secret = "ESCAPED_DELIMITER_SECRET_SENTINEL";
  const escapedInline = "Before \\" + "`" + secret + "\\" + "` After.";
  const incompleteEscapedInline = "Before \\" + "`" + secret;
  const escapedBacktickFence = "\\```";
  const escapedTildeFence = "\\~~~";
  const cases: Array<[string, string]> = [
    [`Before \\<http_:${secret}> After.`, "Before After."],
    [`Before \\<https://secret.example/${secret}> After.`, "Before After."],
    [`Before \\<http_:${secret}`, "Before"],
    [`Before \\<script>${secret}</script> After.`, "Before After."],
    [`Before \\<ScRiPt data-token=${secret}>${secret}</sCrIpT> After.`, "Before After."],
    [`Before \\<section hidden data-token=${secret}>${secret}</section> After.`, "Before After."],
    [escapedInline, "Before After."],
    [incompleteEscapedInline, "Before"],
    [`Before\n${escapedBacktickFence}ts\n${secret}\n${escapedBacktickFence}\nAfter.`, "Before After."],
    [`Before\n${escapedTildeFence}ts\n${secret}\n${escapedTildeFence}\nAfter.`, "Before After."],
  ];

  for (const [source, expected] of cases) {
    assertEverySplit(source, expected);
    assertNeverEmitsSecret(source, secret);
  }

  for (let escapes = 1; escapes <= 4; escapes++) {
    const visibleEscapes = "\\".repeat(Math.floor(escapes / 2));
    const expected = visibleEscapes === "" ? "Before After." : `Before ${visibleEscapes} After.`;
    const rawSource = `Before ${"\\".repeat(escapes)}<script>${secret}</script> After.`;
    const inlineSource = "Before " + "\\".repeat(escapes) + "`" + secret + "\\" + "` After.";
    assertEverySplit(rawSource, expected);
    assertNeverEmitsSecret(rawSource, secret);
    assertEverySplit(inlineSource, expected);
    assertNeverEmitsSecret(inlineSource, secret);
  }

  assertEverySplit("Compare x \\< y > z and \\* literal.", "Compare x < y > z and * literal.");

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(`Before \\<script>${secret}`), "Before");
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push("Safe next turn."), "Safe next turn.");
  assert.equal(sanitizer.finish(), null);
});

test("adversarial Markdown suppression remains chunk-safe across containers", () => {
  const cases: Array<[string, string | null]> = [
    ["Before\n1. > ~~~ts\r\nsecret-token\r\n1. > ~~~\r\nAfter.", "Before After."],
    ["Before ``secret`` after.", "Before after."],
    ["Before <X-Private-Token data-token=abc>safe</X-Private-Token> after.", "Before safe after."],
    ["Before <frameset credential=abc", "Before"],
    ["Before <math data-token=abc>safe</math> after.", "Before safe after."],
    ["> - [private]: https://secret.example/path?access_token=leak\r\n> - \"credential title\"\r\n> - [shown] after.", "shown after."],
    ["Compare 2 < 3 > 1 after.", "Compare 2 < 3 > 1 after."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("nested container secrecy state finalizes and resets without crossing turns", () => {
  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push(">   - [private]:\n>   -   https://secret.example/path?access_token=leak"), null);
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push(">   - ~~~ts\r\nsecret-token\r\n>   - ~~~"), null);
  assert.equal(sanitizer.finish(), null);
  sanitizer.reset();
  assert.equal(sanitizer.push(">   - Safe prose."), "Safe prose.");
  assert.equal(sanitizer.finish(), null);
});

test("reference and HTML suppression finalize and reset without crossing turns", () => {
  const references = new MarkdownSpeechSanitizer();
  assert.equal(references.push("[shown][private"), "shown");
  assert.equal(references.finish(), null);
  references.reset();
  assert.equal(references.push("[private]: https://secret.example/path?access_token=leak"), null);
  assert.equal(references.finish(), null);
  references.reset();
  assert.equal(references.push("Safe reference turn."), "Safe reference turn.");
  assert.equal(references.finish(), null);

  const html = new MarkdownSpeechSanitizer();
  assert.equal(html.push(`Before <a href="https://secret.example/path?token=abc`), "Before");
  assert.equal(html.finish(), null);
  html.reset();
  assert.equal(html.push(`<a href="https://secret.example/path?token=abc">safe</a>`), "safe");
  assert.equal(html.finish(), null);
  html.reset();
  assert.equal(html.push("Safe HTML turn."), "Safe HTML turn.");
  assert.equal(html.finish(), null);

  const code = new MarkdownSpeechSanitizer();
  assert.equal(code.push("> ```ts\nsecret-token"), null);
  assert.equal(code.finish(), null);
  code.reset();
  assert.equal(code.push("Safe code turn."), "Safe code turn.");
  assert.equal(code.finish(), null);

  const inline = new MarkdownSpeechSanitizer();
  assert.equal(inline.push("Before `secret`"), "Before");
  assert.equal(inline.push(" after."), " after.");
  assert.equal(inline.finish(), null);
  inline.reset();
  assert.equal(inline.push("Safe inline turn."), "Safe inline turn.");
  assert.equal(inline.finish(), null);
});

test("randomized chunks remain equivalent to complete Markdown sanitization", () => {
  const source = "# Result\nRead [shown][private].\n[private]: https://secret.example/path?access_token=leak\n<a href=\"https://secret.example/path?token=abc\">safe</a> <not-a-link>";
  const expected = "Result Read shown. safe";
  assert.equal(sanitizeMarkdownForSpeech(source), expected);

  for (let seed = 1; seed <= 32; seed++) {
    let state = seed;
    let position = 0;
    const chunks: string[] = [];
    while (position < source.length) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      const length = 1 + (state % 11);
      chunks.push(source.slice(position, position + length));
      position += length;
    }
    assert.equal(stream(chunks), expected, `seed ${seed}`);
  }
});

test("quotes in destinations do not start link titles", () => {
  const cases: Array<[string, string]> = [
    ["[label](https://example.test/it's) after.", "label after."],
    [`[label](https://example.test/a"double) after.`, "label after."],
    [`[label](https://example.test/a_(it's_nested)) after.`, "label after."],
    [`[label](https://example.test/'single'/"double) after.`, "label after."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("valid quoted titles suppress parentheses and escaped quotes across chunks", () => {
  const cases: Array<[string, string]> = [
    [`[label](https://example.test/it's "Title with (parentheses) and an escaped \\"quote\\"") after.`, "label after."],
    [`[label](https://example.test/say"hi 'Title with (parentheses) and an escaped \\'apostrophe\\'') after.`, "label after."],
  ];
  for (const [source, expected] of cases) assertEverySplit(source, expected);
});

test("inline code contents stay suppressed for matching, nested, and terminal runs", () => {
  assertEverySplit("Say ``a `short` run`` now.", "Say now.");
  assertEverySplit("Use ```lang\na ``pair`` here\n``` safely.", "Use safely.");
  assertEverySplit("`````a````` after.", "after.");
  assertEverySplit("Malformed ``code ` remains code.", "Malformed");

  for (let openingLength = 1; openingLength <= 5; openingLength++) {
    for (let terminalLength = 1; terminalLength <= 6; terminalLength++) {
      const opening = "`".repeat(openingLength);
      const terminal = "`".repeat(terminalLength);
      assertEverySplit(`Say ${opening}a${terminal}`, "Say");
    }
  }
});

test("finish suppresses terminal code and reset starts an isolated stream", () => {
  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push("Say ``a"), "Say");
  assert.equal(sanitizer.push("```"), null);
  assert.equal(sanitizer.finish(), null);
  assert.equal(sanitizer.finish(), null);
  assert.throws(() => sanitizer.push("later"), /finished/);
  sanitizer.reset();
  assert.equal(sanitizer.push("Say ``a``"), "Say");
  assert.equal(sanitizer.finish(), null);
});

test("finish emits terminal carry before a new speech turn", () => {
  assertEverySplit("The answer is\n42.", "The answer is 42.");

  const sanitizer = new MarkdownSpeechSanitizer();
  assert.equal(sanitizer.push("The answer is\n42."), "The answer is");
  assert.equal(sanitizer.finish(), " 42.");
  sanitizer.reset();
  assert.equal(sanitizer.push("The next answer."), "The next answer.");
  assert.equal(sanitizer.finish(), null);
});

test("state is isolated per connection and reset between turns/interruption", () => {
  const a = new MarkdownSpeechSanitizer();
  const b = new MarkdownSpeechSanitizer();
  assert.equal(a.push("[label](https://exa"), "label");
  assert.equal(b.push("ordinary"), "ordinary");
  assert.equal(a.push("mple.test) hidden"), " hidden");
  a.reset();
  assert.equal(a.push("visible again"), "visible again");
});

test("raw voice turn stream remains byte-for-byte Markdown", async () => {
  const raw = "## Heading\n- **bold** [label](https://example.com) `code`";
  const voiceStream = createVoiceTurnStream("question", async (_transcript, callbacks) => {
    for (const delta of [raw.slice(0, 11), raw.slice(11)]) await callbacks.onEvent(JSON.stringify({ type: "text-delta", delta }));
    await callbacks.onDone();
  });
  let received = "";
  for await (const delta of voiceStream) received += delta;
  assert.equal(received, raw);
});
