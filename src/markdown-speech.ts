type Mode =
  | "text"
  | "inline-code"
  | "link-label"
  | "link-after-label"
  | "link-reference-label"
  | "link-url"
  | "fenced-code"
  | "reference-definition-label"
  | "reference-definition-after-label"
  | "reference-definition"
  | "reference-definition-continuation"
  | "html-tag"
  | "html-comment"
  | "html-declaration"
  | "html-processing-instruction"
  | "html-cdata"
  | "html-raw-text"
  | "indented-code";

const NULL_CHARACTER = "\u0000";
const URI_AUTOLINK = /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\u0000-\u0020<>]*$/;
const EMAIL_AUTOLINK = /^[A-Za-z0-9.!#$%&'*+\/?=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
const EMAIL_LOCAL = /^[A-Za-z0-9.!#$%&'*+\/?=^_`{|}~-]+$/;
const EMAIL_LOCAL_PREFIX = /^[A-Za-z0-9.!#$%&'*+\/?=^_`{|}~-]*$/;
const HTML_TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const ENCODED_AUTOLINK_MARKER = /&(?:#|colon;?|commat;?)/i;
const BOOLEAN_HTML_ATTRIBUTES = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected",
]);
const HIDDEN_HTML_ELEMENT_NAMES = new Set([
  "code", "head", "iframe", "kbd", "listing", "noembed", "noframes", "noscript", "plaintext", "pre", "samp", "script", "style", "template", "textarea", "title", "tt", "var", "xmp",
]);
const VOID_HTML_ELEMENT_NAMES = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const HTML_TAG_NAMES = new Set([
  "a", "abbr", "acronym", "address", "applet", "area", "article", "aside", "audio", "b", "base", "basefont", "bdi", "bdo", "bgsound", "big", "blink", "blockquote", "body", "br", "button",
  "canvas", "caption", "center", "cite", "code", "col", "colgroup", "content", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "dir", "div", "dl", "dt",
  "em", "embed", "fencedframe", "fieldset", "figcaption", "figure", "font", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "image", "img", "input", "ins", "isindex", "kbd", "keygen", "label", "legend", "li", "link", "listing", "main", "map", "mark", "marquee", "menu", "menuitem", "meta", "meter", "multicol", "nav", "nextid", "nobr", "noembed", "noframes", "noscript",
  "object", "ol", "optgroup", "option", "output", "p", "param", "picture", "plaintext", "portal", "pre", "progress", "q", "rb", "rp", "rt", "rtc", "ruby", "s", "samp", "script", "search", "section", "select", "selectedcontent", "shadow",
  "slot", "small", "source", "spacer", "span", "strike", "strong", "style", "sub", "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead", "time", "title", "tr", "track", "tt", "u", "ul", "var", "video", "wbr", "xmp",
]);
const SVG_TAG_NAMES = new Set([
  "altglyph", "altglyphdef", "altglyphitem", "animate", "animatemotion", "animatetransform", "circle", "clippath", "color-profile", "cursor", "defs", "desc", "discard", "ellipse", "feblend", "fecolormatrix", "fecomponenttransfer",
  "fecomposite", "feconvolvematrix", "fediffuselighting", "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr", "fegaussianblur", "feimage", "femerge", "femergenode", "femorphology", "feoffset", "fepointlight", "fespecularlighting",
  "fespotlight", "fetile", "feturbulence", "filter", "font-face", "font-face-format", "font-face-name", "font-face-src", "font-face-uri", "foreignobject", "g", "glyph", "glyphref", "hkern", "image", "line", "lineargradient", "marker", "mask", "metadata",
  "missing-glyph", "mpath", "path", "pattern", "polygon", "polyline", "radialgradient", "rect", "set", "solidcolor", "stop", "svg", "switch", "symbol", "text", "textpath", "tref", "tspan", "unknown", "use", "view", "vkern",
]);
const MATHML_TAG_NAMES = new Set([
  "annotation", "annotation-xml", "maction", "maligngroup", "malignmark", "math", "menclose", "merror", "mfenced", "mfrac", "mglyph", "mi", "mlabeledtr", "mlongdiv", "mmultiscripts", "mn", "mo", "mover", "mpadded", "mphantom", "mroot", "mrow", "ms", "mscarries", "mscarry", "msgroup", "msline", "mspace", "msqrt", "msrow", "mstack", "mstyle", "msub", "msup", "msubsup", "mtable", "mtd", "mtext", "mtr", "munder", "munderover", "none", "semantics",
]);

function isAutolinkDestination(value: string): boolean {
  return URI_AUTOLINK.test(value) || EMAIL_AUTOLINK.test(value);
}

function isPotentialAutolinkDestination(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon === -1 && /^[A-Za-z][A-Za-z0-9+.-]{0,31}$/.test(value)) return true;
  if (colon >= 2 && colon <= 32 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value.slice(0, colon)) && /^[^\u0000-\u0020<>]*$/.test(value.slice(colon + 1))) return true;

  const at = value.indexOf("@");
  if (at === -1) return EMAIL_LOCAL_PREFIX.test(value);
  if (at === 0 || value.indexOf("@", at + 1) !== -1 || !EMAIL_LOCAL.test(value.slice(0, at))) return false;

  const labels = value.slice(at + 1).split(".");
  return labels.every((label, index) => (label === "" ? index === labels.length - 1 : /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(label)));
}

function hasStartedAutolinkDestination(value: string): boolean {
  const colon = value.indexOf(":");
  if (colon >= 2 && colon <= 32 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value.slice(0, colon))) return true;

  const at = value.indexOf("@");
  return at > 0 && EMAIL_LOCAL.test(value.slice(0, at));
}

function firstAutolinkCredentialMarker(value: string): number {
  const literalMarker = value.search(/[:@]/);
  const encodedMarker = value.search(ENCODED_AUTOLINK_MARKER);
  return literalMarker === -1 ? encodedMarker : encodedMarker === -1 ? literalMarker : Math.min(literalMarker, encodedMarker);
}

function isCredentialAutolinkLikePrefix(value: string): boolean {
  if (value.length === 0 || /[\s<>]/.test(value)) return false;
  if (value.length > 32 && /^[A-Za-z][A-Za-z0-9+.-]*$/.test(value)) return true;
  if (/^(?:https?|mailto|ftp|ftps|ssh|git|ws|wss|tel|urn)$/i.test(value)) return true;
  if (EMAIL_LOCAL_PREFIX.test(value)) return /[!#$%&'*+\/?=^_`{|}~-]/.test(value);
  return /^[A-Za-z0-9][^\s<>]*$/.test(value);
}

function hasWhitespaceSeparatedCredentialMarker(value: string): boolean {
  const separator = value.search(/\s/);
  if (separator <= 0 || !isCredentialAutolinkLikePrefix(value.slice(0, separator))) return false;

  const marker = firstAutolinkCredentialMarker(value);
  return marker >= separator && /^\s*$/.test(value.slice(separator, marker));
}

function hasIncompleteWhitespaceSeparatedCredentialMarker(value: string): boolean {
  const separator = value.search(/\s/);
  if (separator <= 0 || !isCredentialAutolinkLikePrefix(value.slice(0, separator))) return false;

  const suffix = value.slice(separator);
  const markerStart = suffix.search(/\S/);
  if (markerStart === -1) return true;

  const marker = suffix.slice(markerStart);
  return ["&colon", "&commat"].some((entity) => entity.startsWith(marker.toLowerCase())) || /^&#(?:[xX]?[0-9A-Fa-f]*)?$/.test(marker);
}

function hasAutolinkCredentialShape(value: string): boolean {
  const marker = firstAutolinkCredentialMarker(value);
  const separator = value.search(/[\s<>]/);
  return marker >= 0 && (separator === -1 || marker < separator || hasWhitespaceSeparatedCredentialMarker(value));
}

function hasUnresolvedAngleCandidate(value: string): boolean {
  return value.length > 0 && !/[\s<>]/.test(value);
}

function hasSuppressingHtmlAttribute(attributes: string): boolean {
  if (attributes.includes(NULL_CHARACTER)) return true;

  let position = 0;
  while (position < attributes.length) {
    while (position < attributes.length && (/\s/.test(attributes[position]) || attributes[position] === "/")) position++;
    const nameStart = position;
    while (position < attributes.length && !/[\s=/>]/.test(attributes[position])) position++;
    if (nameStart === position) {
      position++;
      continue;
    }

    const name = attributes.slice(nameStart, position).toLowerCase();
    while (position < attributes.length && /\s/.test(attributes[position])) position++;
    if (name === "hidden" || name === "inert") return true;
    if (attributes[position] !== "=") continue;

    position++;
    while (position < attributes.length && /\s/.test(attributes[position])) position++;
    const quote = attributes[position];
    if (quote === "\"" || quote === "'") {
      position++;
      while (position < attributes.length && attributes[position] !== quote) position++;
      if (position < attributes.length) position++;
    } else {
      while (position < attributes.length && !/\s/.test(attributes[position])) position++;
    }
  }
  return false;
}

function isIndentedCodeIndentation(indentation: string): boolean {
  let width = 0;
  for (const character of indentation) width += character === "\t" ? 4 : 1;
  return width >= 4;
}

export class MarkdownSpeechSanitizer {
  private mode: Mode = "text";
  private carry = "";
  private lineStart = true;
  private pendingSpace = false;
  private hasContent = false;
  private inlineTicks = 0;
  private inlineCodeWasSuppressed = false;
  private lastEmittedCharacter = "";
  private fenceCharacter = "`";
  private fenceLength = 0;
  private fenceHeader = false;
  private linkLabelDepth = 0;
  private linkDepth = 0;
  private linkWhitespace = "";
  private linkQuote: "\"" | "'" | null = null;
  private linkEscape = false;
  private linkTitlePosition = false;
  private linkTitleStarted = false;
  private linkReferenceDepth = 0;
  private linkReferenceEscape = false;
  private referenceDefinitionIndent = "";
  private referenceDefinitionLabel = "";
  private referenceDefinitionDepth = 0;
  private referenceDefinitionEscape = false;
  private referenceDefinitionContinuation = "";
  private referenceDefinitionCanContinueTitle = false;
  private referenceDefinitionNeedsDestination = false;
  private referenceDefinitionSkipsLineFeed = false;
  private htmlQuote: "\"" | "'" | null = null;
  private htmlTagName = "";
  private htmlTagClosing = false;
  private htmlTagAttributes = "";
  private htmlRawTag = "";
  private htmlSuppressedElementStack: string[] = [];
  private htmlDeclarationBracketDepth = 0;
  private finishing = false;
  private finished = false;

  push(chunk: string): string | null {
    if (this.finished) throw new Error("Cannot push Markdown after speech sanitization is finished");
    const input = this.carry + chunk;
    this.carry = "";
    let out = "";
    const emit = (value: string) => {
      for (const char of value) {
        if (char === NULL_CHARACTER || /\s/.test(char)) {
          this.pendingSpace = this.hasContent || this.pendingSpace;
        } else {
          if (this.pendingSpace && this.hasContent && !/[.,!?;:)]/.test(char)) out += " ";
          out += char;
          this.hasContent = true;
          this.pendingSpace = false;
          this.inlineCodeWasSuppressed = false;
          this.lastEmittedCharacter = char;
        }
      }
    };
    const runLength = (at: number, character: string) => {
      let end = at;
      while (end < input.length && input[end] === character) end++;
      return end - at;
    };
    const consumeSource = (value: string) => {
      for (const char of value) this.lineStart = char === "\n" || char === "\r";
    };
    const atEnd = (at: number) => at === input.length && !this.finishing;
    const atFinish = (at: number) => at === input.length && this.finishing;
    const scanContainerPrefix = (at: number): { kind: "none" | "wait" } | { kind: "prefix"; end: number } => {
      let cursor = at;
      let indentation = 0;
      while (indentation < 3 && input[cursor] === " ") {
        cursor++;
        indentation++;
      }
      if (atEnd(cursor)) return { kind: "wait" };
      if (atFinish(cursor)) return { kind: "none" };

      let hasPrefix = false;
      while (true) {
        let matchedPrefix = false;
        if (input[cursor] === ">") {
          matchedPrefix = true;
          cursor++;
          if (atEnd(cursor)) return { kind: "wait" };
          if (input[cursor] === " " || input[cursor] === "\t") {
            cursor++;
            if (atEnd(cursor)) return { kind: "wait" };
          }
        } else if (input[cursor] === "-" || input[cursor] === "+" || input[cursor] === "*") {
          if (atEnd(cursor + 1)) return { kind: "wait" };
          if (input[cursor + 1] === " " || input[cursor + 1] === "\t") {
            matchedPrefix = true;
            cursor += 2;
            if (atEnd(cursor)) return { kind: "wait" };
          }
        } else if (/\d/.test(input[cursor] ?? "")) {
          let markerEnd = cursor;
          while (markerEnd < input.length && markerEnd - cursor < 9 && /\d/.test(input[markerEnd])) markerEnd++;
          if (atEnd(markerEnd)) return { kind: "wait" };
          if ((input[markerEnd] === "." || input[markerEnd] === ")") && atEnd(markerEnd + 1)) return { kind: "wait" };
          if ((input[markerEnd] === "." || input[markerEnd] === ")") && (input[markerEnd + 1] === " " || input[markerEnd + 1] === "\t")) {
            matchedPrefix = true;
            cursor = markerEnd + 2;
            if (atEnd(cursor)) return { kind: "wait" };
          }
        }

        if (!matchedPrefix) return hasPrefix ? { kind: "prefix", end: cursor } : { kind: "none" };
        hasPrefix = true;

        let nestedIndentation = 0;
        while (nestedIndentation < 3 && (input[cursor] === " " || input[cursor] === "\t")) {
          cursor++;
          nestedIndentation++;
        }
        if (atEnd(cursor)) return { kind: "wait" };
        if (atFinish(cursor)) return { kind: "prefix", end: cursor };
      }
    };
    const scanHeadingPrefix = (at: number): { kind: "none" | "wait" } | { kind: "prefix"; end: number } => {
      let cursor = at;
      let spaces = 0;
      while (spaces < 3 && input[cursor] === " ") {
        cursor++;
        spaces++;
      }
      if (atEnd(cursor)) return { kind: "wait" };
      if (input[cursor] !== "#") return { kind: "none" };
      let markerEnd = cursor;
      while (markerEnd < input.length && markerEnd - cursor < 6 && input[markerEnd] === "#") markerEnd++;
      if (atEnd(markerEnd)) return { kind: "wait" };
      if (input[markerEnd] !== " " && input[markerEnd] !== "\t") return { kind: "none" };
      while (input[markerEnd] === " " || input[markerEnd] === "\t") markerEnd++;
      return { kind: "prefix", end: markerEnd };
    };
    const scanFenceOpener = (at: number): { kind: "none" | "wait" } | { kind: "open"; character: string; length: number; end: number } => {
      let delimiterStart = at;
      let spaces = 0;
      while (spaces < 3 && input[delimiterStart] === " ") {
        delimiterStart++;
        spaces++;
      }
      if (atEnd(delimiterStart)) return { kind: "wait" };
      if (input[delimiterStart] === "\\" && (input[delimiterStart + 1] === "`" || input[delimiterStart + 1] === "~")) delimiterStart++;
      const character = input[delimiterStart];
      if (character !== "`" && character !== "~") return { kind: "none" };
      const length = runLength(delimiterStart, character);
      const end = delimiterStart + length;
      if (length < 3) return atEnd(end) ? { kind: "wait" } : { kind: "none" };
      let lineEnd = end;
      while (lineEnd < input.length && input[lineEnd] !== "\n" && input[lineEnd] !== "\r" && !atFinish(lineEnd)) lineEnd++;
      const header = input.slice(end, lineEnd);
      if (character === "`" && header.includes("`")) return { kind: "none" };
      if (atEnd(lineEnd)) return { kind: "wait" };
      return { kind: "open", character, length, end };
    };
    const scanFenceCloser = (at: number): { kind: "none" | "wait" } | { kind: "close"; end: number } => {
      const containerPrefix = scanContainerPrefix(at);
      if (containerPrefix.kind === "wait") return containerPrefix;
      let delimiterStart = containerPrefix.kind === "prefix" ? containerPrefix.end : at;
      let spaces = 0;
      while (spaces < 3 && input[delimiterStart] === " ") {
        delimiterStart++;
        spaces++;
      }
      if (atEnd(delimiterStart)) return { kind: "wait" };
      if (input[delimiterStart] === "\\" && atEnd(delimiterStart + 1)) return { kind: "wait" };
      if (input[delimiterStart] === "\\" && input[delimiterStart + 1] === this.fenceCharacter) delimiterStart++;
      if (input[delimiterStart] !== this.fenceCharacter) return { kind: "none" };
      const length = runLength(delimiterStart, this.fenceCharacter);
      let end = delimiterStart + length;
      if (atEnd(end)) return { kind: "wait" };
      if (length < this.fenceLength) return { kind: "none" };
      while (input[end] === " " || input[end] === "\t") end++;
      if (atEnd(end)) return { kind: "wait" };
      if (input[end] === "\n") return { kind: "close", end: end + 1 };
      if (input[end] === "\r") return { kind: "close", end: input[end + 1] === "\n" ? end + 2 : end + 1 };
      if (atFinish(end)) return { kind: "close", end };
      return { kind: "none" };
    };
    const scanReferenceDefinitionOpener = (at: number): { kind: "none" | "wait" } | { kind: "open"; labelStart: number } => {
      let labelStart = at;
      let spaces = 0;
      while (spaces < 3 && input[labelStart] === " ") {
        labelStart++;
        spaces++;
      }
      if (atEnd(labelStart)) return { kind: "wait" };
      return input[labelStart] === "[" ? { kind: "open", labelStart } : { kind: "none" };
    };
    const emitReferenceDefinitionLabel = (closed: boolean) => {
      const end = this.referenceDefinitionLabel.length - (closed ? 1 : 0);
      for (let position = 1; position < end; position++) {
        const labelCharacter = this.referenceDefinitionLabel[position];
        if (labelCharacter === "\\" && position + 1 < end) {
          emit(this.referenceDefinitionLabel[position + 1]);
          position++;
        } else {
          emit(labelCharacter);
        }
      }
    };
    const scanIndentedCode = (at: number): { kind: "none" | "wait" } | { kind: "open"; end: number } => {
      let end = at;
      let indentation = 0;
      while (input[end] === " " || input[end] === "\t") {
        indentation += input[end] === "\t" ? 4 : 1;
        end++;
      }
      if (atEnd(end)) return { kind: "wait" };
      if (atFinish(end)) return indentation >= 4 ? { kind: "open", end } : { kind: "none" };
      return indentation >= 4 ? { kind: "open", end } : { kind: "none" };
    };
    const scanHtmlSpecial = (at: number): { kind: "none" | "wait" } | { kind: "open"; mode: Extract<Mode, "html-comment" | "html-declaration" | "html-processing-instruction" | "html-cdata">; end: number } => {
      if (input[at + 1] === "?") return { kind: "open", mode: "html-processing-instruction", end: at + 2 };
      if (input[at + 1] !== "!") return { kind: "none" };
      for (const [marker, mode] of [["<!--", "html-comment"], ["<![CDATA[", "html-cdata"]] as const) {
        if (input.startsWith(marker, at)) return { kind: "open", mode, end: at + marker.length };
        if (marker.startsWith(input.slice(at))) {
          return this.finishing ? { kind: "open", mode: "html-declaration", end: at + 2 } : { kind: "wait" };
        }
      }
      return { kind: "open", mode: "html-declaration", end: at + 2 };
    };
    const scanHtmlTag = (at: number): { kind: "none" | "wait" } | { kind: "open"; end: number; name: string; closing: boolean } => {
      const closing = input[at + 1] === "/";
      const nameStart = at + (closing ? 2 : 1);
      if (atEnd(nameStart)) return { kind: "wait" };
      if (atFinish(nameStart) || !/[A-Za-z]/.test(input[nameStart] ?? "")) return { kind: "none" };

      let end = nameStart + 1;
      while (end < input.length && /[A-Za-z0-9-]/.test(input[end])) end++;
      if (atEnd(end)) return { kind: "wait" };

      const name = input.slice(nameStart, end);
      const normalizedName = name.toLowerCase();
      if (!HTML_TAG_NAME.test(name)) return { kind: "none" };
      const isStandardTag = HTML_TAG_NAMES.has(normalizedName) || SVG_TAG_NAMES.has(normalizedName) || MATHML_TAG_NAMES.has(normalizedName);
      const isCustomElement = /^[a-z][a-z0-9-]*-[a-z0-9-]*$/.test(normalizedName);
      const delimiter = input[end];

      if (closing) return atFinish(end) || delimiter === ">" || /\s/.test(delimiter) ? { kind: "open", end, name: normalizedName, closing } : { kind: "none" };
      if (isStandardTag || isCustomElement) return { kind: "open", end, name: normalizedName, closing };
      if (delimiter === "/" || delimiter === "=" || delimiter === "\"" || delimiter === "'") return { kind: "open", end, name: normalizedName, closing };
      if (!/\s/.test(delimiter)) return { kind: "none" };

      const closingDelimiter = input.indexOf(">", end + 1);
      const tailEnd = closingDelimiter === -1 ? input.length : closingDelimiter;
      const attributes = input.slice(end, tailEnd).trim().toLowerCase().split(/\s+/).filter(Boolean);
      const matchingCloseStart = closingDelimiter === -1 ? -1 : input.toLowerCase().indexOf(`</${normalizedName}`, closingDelimiter + 1);
      const matchingCloseDelimiter = matchingCloseStart === -1 ? "" : input[matchingCloseStart + normalizedName.length + 2] ?? "";
      const hasMatchingClose = matchingCloseDelimiter === ">" || /\s/.test(matchingCloseDelimiter);
      if (/[=\"'\/]/.test(input.slice(end, tailEnd)) || attributes.some((attribute) => BOOLEAN_HTML_ATTRIBUTES.has(attribute)) || attributes.length > 0 || hasMatchingClose) {
        return { kind: "open", end, name: normalizedName, closing };
      }
      return this.finishing ? { kind: "none" } : { kind: "wait" };
    };

    for (let i = 0; i < input.length;) {
      const char = input[i];

      if (this.mode === "html-comment" || this.mode === "html-processing-instruction" || this.mode === "html-cdata") {
        const terminator = this.mode === "html-comment" ? "-->" : this.mode === "html-processing-instruction" ? "?>" : "]]>";
        if (input.startsWith(terminator, i)) {
          consumeSource(terminator);
          i += terminator.length;
          this.mode = this.htmlSuppressedElementStack.length === 0 ? "text" : "html-raw-text";
          continue;
        }
        if (terminator.startsWith(input.slice(i))) {
          this.carry = input.slice(i);
          break;
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "html-declaration") {
        if (this.htmlQuote === null) {
          if (char === "\"" || char === "'") this.htmlQuote = char;
          else if (char === "[") this.htmlDeclarationBracketDepth++;
          else if (char === "]" && this.htmlDeclarationBracketDepth > 0) this.htmlDeclarationBracketDepth--;
          else if (char === ">" && this.htmlDeclarationBracketDepth === 0) this.mode = this.htmlSuppressedElementStack.length === 0 ? "text" : "html-raw-text";
        } else if (char === this.htmlQuote) {
          this.htmlQuote = null;
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "html-raw-text") {
        if (this.htmlRawTag !== "plaintext" && char === "<") {
          const htmlSpecial = scanHtmlSpecial(i);
          if (htmlSpecial.kind === "wait") {
            this.carry = input.slice(i);
            break;
          }
          if (htmlSpecial.kind === "open") {
            consumeSource(input.slice(i, htmlSpecial.end));
            this.mode = htmlSpecial.mode;
            this.htmlQuote = null;
            this.htmlDeclarationBracketDepth = 0;
            i = htmlSpecial.end;
            continue;
          }

          const htmlTag = scanHtmlTag(i);
          if (htmlTag.kind === "wait") {
            this.carry = input.slice(i);
            break;
          }
          if (htmlTag.kind === "open") {
            consumeSource(input.slice(i, htmlTag.end));
            this.mode = "html-tag";
            this.htmlQuote = null;
            this.htmlTagName = htmlTag.name;
            this.htmlTagClosing = htmlTag.closing;
            this.htmlTagAttributes = "";
            i = htmlTag.end;
            continue;
          }
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "indented-code") {
        if (this.lineStart) {
          const indentedCode = scanIndentedCode(i);
          if (indentedCode.kind === "wait") {
            this.carry = input.slice(i);
            break;
          }
          if (indentedCode.kind === "open") {
            consumeSource(input.slice(i, indentedCode.end));
            this.lineStart = false;
            i = indentedCode.end;
            continue;
          }
          const containerPrefix = scanContainerPrefix(i);
          if (containerPrefix.kind === "wait") {
            this.carry = input.slice(i);
            break;
          }
          if (containerPrefix.kind === "prefix" && (input[containerPrefix.end] === " " || input[containerPrefix.end] === "\t")) {
            consumeSource(input.slice(i, containerPrefix.end));
            this.lineStart = false;
            i = containerPrefix.end;
            continue;
          }
          if (char !== "\n" && char !== "\r") {
            this.mode = "text";
            continue;
          }
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "fenced-code") {
        if (this.fenceHeader) {
          consumeSource(char);
          if (char === "\n" || char === "\r") this.fenceHeader = false;
          i++;
          continue;
        }
        if (this.lineStart) {
          const closer = scanFenceCloser(i);
          if (closer.kind === "wait") {
            this.carry = input.slice(i);
            break;
          }
          if (closer.kind === "close") {
            consumeSource(input.slice(i, closer.end));
            i = closer.end;
            this.mode = "text";
            continue;
          }
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "reference-definition") {
        consumeSource(char);
        if (char === "\n" || char === "\r") {
          const mayContinue = this.referenceDefinitionNeedsDestination || this.referenceDefinitionCanContinueTitle;
          this.mode = mayContinue ? "reference-definition-continuation" : "text";
          this.referenceDefinitionCanContinueTitle = false;
          if (!mayContinue) this.referenceDefinitionNeedsDestination = false;
          if (char === "\r") {
            if (input[i + 1] === "\n") {
              consumeSource("\n");
              i += 2;
            } else {
              this.referenceDefinitionSkipsLineFeed = this.mode === "reference-definition-continuation";
              i++;
            }
            continue;
          }
        } else if (!/\s/.test(char)) {
          this.referenceDefinitionNeedsDestination = false;
          this.referenceDefinitionCanContinueTitle = true;
        }
        i++;
        continue;
      }

      if (this.mode === "reference-definition-continuation") {
        if (this.referenceDefinitionSkipsLineFeed) {
          this.referenceDefinitionSkipsLineFeed = false;
          if (char === "\n") {
            consumeSource(char);
            i++;
            continue;
          }
        }
        if (this.lineStart) {
          const containerPrefix = scanContainerPrefix(i);
          if (containerPrefix.kind === "wait") {
            this.carry = input.slice(i);
            break;
          }
          if (containerPrefix.kind === "prefix") {
            consumeSource(input.slice(i, containerPrefix.end));
            i = containerPrefix.end;
            continue;
          }
        }
        if (this.referenceDefinitionContinuation !== "" && isIndentedCodeIndentation(this.referenceDefinitionContinuation)) {
          this.referenceDefinitionContinuation = "";
          this.referenceDefinitionNeedsDestination = false;
          this.referenceDefinitionCanContinueTitle = false;
          this.mode = "indented-code";
          continue;
        }
        if (this.referenceDefinitionNeedsDestination && (char === "\n" || char === "\r")) {
          emit(this.referenceDefinitionContinuation);
          this.referenceDefinitionContinuation = "";
          this.referenceDefinitionNeedsDestination = false;
          this.mode = "text";
          continue;
        }
        if (char === " " || char === "\t") {
          this.referenceDefinitionContinuation += char;
          consumeSource(char);
          i++;
          continue;
        }
        if (this.referenceDefinitionNeedsDestination) {
          if (this.referenceDefinitionContinuation.length <= 3 && /^[ ]*$/.test(this.referenceDefinitionContinuation)) {
            this.referenceDefinitionContinuation = "";
            this.referenceDefinitionNeedsDestination = false;
            this.referenceDefinitionCanContinueTitle = true;
            this.mode = "reference-definition";
            consumeSource(char);
            i++;
            continue;
          }
          emit(this.referenceDefinitionContinuation);
          this.referenceDefinitionContinuation = "";
          this.referenceDefinitionNeedsDestination = false;
          this.mode = "text";
          continue;
        }
        if (char === "\"" || char === "'" || char === "(") {
          this.referenceDefinitionContinuation = "";
          this.mode = "reference-definition";
          consumeSource(char);
          i++;
          continue;
        }
        emit(this.referenceDefinitionContinuation);
        this.referenceDefinitionContinuation = "";
        this.mode = "text";
        continue;
      }

      if (this.mode === "reference-definition-after-label") {
        if (char === ":") {
          consumeSource(char);
          this.referenceDefinitionCanContinueTitle = false;
          this.referenceDefinitionNeedsDestination = true;
          this.mode = "reference-definition";
          i++;
          continue;
        }
        emit(this.referenceDefinitionIndent);
        emitReferenceDefinitionLabel(true);
        this.referenceDefinitionIndent = "";
        this.referenceDefinitionLabel = "";
        this.mode = "link-after-label";
        this.linkWhitespace = "";
        continue;
      }

      if (this.mode === "reference-definition-label") {
        if (char === "\n" || char === "\r") {
          emit(this.referenceDefinitionIndent);
          emitReferenceDefinitionLabel(false);
          emit(char);
          this.referenceDefinitionIndent = "";
          this.referenceDefinitionLabel = "";
          this.mode = "link-label";
          this.linkLabelDepth = this.referenceDefinitionDepth;
          consumeSource(char);
          i++;
          continue;
        }
        this.referenceDefinitionLabel += char;
        if (this.referenceDefinitionEscape) {
          this.referenceDefinitionEscape = false;
        } else if (char === "\\") {
          this.referenceDefinitionEscape = true;
        } else if (char === "[") {
          this.referenceDefinitionDepth++;
        } else if (char === "]") {
          this.referenceDefinitionDepth--;
          if (this.referenceDefinitionDepth === 0) this.mode = "reference-definition-after-label";
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "link-reference-label") {
        if (this.linkReferenceEscape) {
          this.linkReferenceEscape = false;
        } else if (char === "\\") {
          this.linkReferenceEscape = true;
        } else if (char === "[") {
          this.linkReferenceDepth++;
        } else if (char === "]") {
          this.linkReferenceDepth--;
          if (this.linkReferenceDepth === 0) this.mode = "text";
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "html-tag") {
        if (this.htmlQuote === null) {
          if (char === "\"") {
            this.htmlQuote = char;
            this.htmlTagAttributes += char;
          } else if (char === "'") {
            this.htmlQuote = char;
            this.htmlTagAttributes += char;
          } else if (char === ">") {
            if (this.htmlSuppressedElementStack.length > 0) {
              if (this.htmlTagClosing) {
                if (this.htmlSuppressedElementStack.at(-1) === this.htmlTagName) this.htmlSuppressedElementStack.pop();
              } else if (!VOID_HTML_ELEMENT_NAMES.has(this.htmlTagName)) {
                this.htmlSuppressedElementStack.push(this.htmlTagName);
                if (this.htmlTagName === "plaintext") this.htmlRawTag = "plaintext";
              }
              if (this.htmlSuppressedElementStack.length === 0) this.htmlRawTag = "";
              this.mode = this.htmlSuppressedElementStack.length === 0 ? "text" : "html-raw-text";
            } else {
              const entersHiddenBody = !this.htmlTagClosing
                && !VOID_HTML_ELEMENT_NAMES.has(this.htmlTagName)
                && (HIDDEN_HTML_ELEMENT_NAMES.has(this.htmlTagName) || hasSuppressingHtmlAttribute(this.htmlTagAttributes));
              this.mode = entersHiddenBody ? "html-raw-text" : "text";
              this.htmlRawTag = entersHiddenBody ? this.htmlTagName : "";
              if (entersHiddenBody) this.htmlSuppressedElementStack = [this.htmlTagName];
            }
            this.htmlTagAttributes = "";
          } else {
            this.htmlTagAttributes += char;
          }
        } else {
          this.htmlTagAttributes += char;
          if (char === this.htmlQuote) this.htmlQuote = null;
        }
        consumeSource(char);
        i++;
        continue;
      }

      if (this.mode === "link-url") {
        consumeSource(char);
        if (this.linkQuote !== null) {
          if (this.linkEscape) {
            this.linkEscape = false;
          } else if (char === "\\") {
            this.linkEscape = true;
          } else if (char === this.linkQuote) {
            this.linkQuote = null;
          }
        } else if (this.linkEscape) {
          this.linkEscape = false;
          this.linkTitlePosition = false;
        } else if (char === "\\") {
          this.linkEscape = true;
          this.linkTitlePosition = false;
        } else if ((char === "\"" || char === "'") && this.linkTitlePosition && !this.linkTitleStarted) {
          this.linkQuote = char;
          this.linkTitlePosition = false;
          this.linkTitleStarted = true;
        } else if (/\s/.test(char) && this.linkDepth === 1 && !this.linkTitleStarted) {
          this.linkTitlePosition = true;
        } else {
          this.linkTitlePosition = false;
          if (char === "(") {
            this.linkDepth++;
          } else if (char === ")") {
            this.linkDepth--;
            if (this.linkDepth === 0) this.mode = "text";
          }
        }
        i++;
        continue;
      }

      if (this.mode === "inline-code") {
        if (char === "`") {
          const length = runLength(i, "`");
          if (atEnd(i + length)) {
            this.carry = input.slice(i);
            break;
          }
          if (length === this.inlineTicks) {
            this.mode = "text";
            this.inlineCodeWasSuppressed = true;
          }
          consumeSource(input.slice(i, i + length));
          i += length;
        } else {
          consumeSource(char);
          i++;
        }
        continue;
      }

      if (this.mode === "link-label") {
        if (char === "\\") {
          if (atEnd(i + 1)) {
            this.carry = "\\";
            break;
          }
          if (atFinish(i + 1)) {
            consumeSource(char);
            i++;
            continue;
          }
          emit(input[i + 1]);
          consumeSource(input.slice(i, i + 2));
          i += 2;
        } else {
          if (char === "[") {
            this.linkLabelDepth++;
            emit(char);
          } else if (char === "]") {
            this.linkLabelDepth--;
            if (this.linkLabelDepth === 0) this.mode = "link-after-label";
            else emit(char);
          } else {
            emit(char);
          }
          consumeSource(char);
          i++;
        }
        continue;
      }

      if (this.mode === "link-after-label") {
        if (/\s/.test(char)) {
          this.linkWhitespace += char;
          consumeSource(char);
          i++;
          continue;
        }
        if (char === "[" && this.linkWhitespace === "") {
          this.mode = "link-reference-label";
          this.linkReferenceDepth = 1;
          this.linkReferenceEscape = false;
          consumeSource(char);
          i++;
          continue;
        }
        if (char === "(") {
          this.linkWhitespace = "";
          this.mode = "link-url";
          this.linkDepth = 1;
          this.linkQuote = null;
          this.linkEscape = false;
          this.linkTitlePosition = false;
          this.linkTitleStarted = false;
          consumeSource(char);
          i++;
          continue;
        }
        emit(this.linkWhitespace);
        this.linkWhitespace = "";
        this.mode = "text";
        continue;
      }

      if (this.lineStart) {
        const indentedCode = scanIndentedCode(i);
        if (indentedCode.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        if (indentedCode.kind === "open") {
          consumeSource(input.slice(i, indentedCode.end));
          this.lineStart = false;
          this.mode = "indented-code";
          i = indentedCode.end;
          continue;
        }

        const containerPrefix = scanContainerPrefix(i);
        if (containerPrefix.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        const contentStart = containerPrefix.kind === "prefix" ? containerPrefix.end : i;
        if (containerPrefix.kind === "prefix" && (input[contentStart] === " " || input[contentStart] === "\t")) {
          consumeSource(input.slice(i, contentStart));
          this.lineStart = false;
          this.mode = "indented-code";
          i = contentStart;
          continue;
        }
        const opener = scanFenceOpener(contentStart);
        if (opener.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        if (opener.kind === "open") {
          consumeSource(input.slice(i, opener.end));
          this.mode = "fenced-code";
          this.fenceCharacter = opener.character;
          this.fenceLength = opener.length;
          this.fenceHeader = true;
          i = opener.end;
          continue;
        }
        const referenceDefinition = scanReferenceDefinitionOpener(contentStart);
        if (referenceDefinition.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        if (referenceDefinition.kind === "open") {
          this.referenceDefinitionIndent = input.slice(contentStart, referenceDefinition.labelStart);
          this.referenceDefinitionLabel = "[";
          this.referenceDefinitionDepth = 1;
          this.referenceDefinitionEscape = false;
          this.referenceDefinitionNeedsDestination = false;
          consumeSource(input.slice(i, referenceDefinition.labelStart + 1));
          this.mode = "reference-definition-label";
          i = referenceDefinition.labelStart + 1;
          continue;
        }
        const headingPrefix = scanHeadingPrefix(contentStart);
        if (headingPrefix.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        if (headingPrefix.kind === "prefix") {
          consumeSource(input.slice(i, headingPrefix.end));
          i = headingPrefix.end;
          continue;
        }
        if (containerPrefix.kind === "prefix") {
          consumeSource(input.slice(i, contentStart));
          i = contentStart;
          continue;
        }
      }

      if (char === "\\") {
        if (atEnd(i + 1)) {
          this.carry = "\\";
          break;
        }
        if (atFinish(i + 1)) {
          consumeSource(char);
          i++;
          continue;
        }
        if (input[i + 1] === "<") {
          consumeSource(char);
          i++;
          continue;
        }
        if (input[i + 1] === "`") {
          const length = runLength(i + 1, "`");
          let closing = i + length + 1;
          while (closing < input.length && runLength(closing, "`") !== length) {
            closing += input[closing] === "`" ? runLength(closing, "`") : 1;
          }
          if (closing < input.length) {
            consumeSource(char);
            i++;
            continue;
          }
          if (!this.finishing) {
            this.carry = input.slice(i);
            break;
          }
          if (!/\s/.test(input[i + length + 1] ?? "")) {
            this.mode = "inline-code";
            this.inlineTicks = length;
            consumeSource(input.slice(i, i + length + 1));
            i += length + 1;
            continue;
          }
        }
        emit(input[i + 1]);
        consumeSource(input.slice(i, i + 2));
        i += 2;
        continue;
      }
      if (char === "<") {
        const htmlSpecial = scanHtmlSpecial(i);
        if (htmlSpecial.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        if (htmlSpecial.kind === "open") {
          consumeSource(input.slice(i, htmlSpecial.end));
          this.mode = htmlSpecial.mode;
          this.htmlQuote = null;
          this.htmlDeclarationBracketDepth = 0;
          i = htmlSpecial.end;
          continue;
        }

        const htmlTag = scanHtmlTag(i);
        if (htmlTag.kind === "wait") {
          this.carry = input.slice(i);
          break;
        }
        if (htmlTag.kind === "open") {
          consumeSource(input.slice(i, htmlTag.end));
          this.mode = "html-tag";
          this.htmlQuote = null;
          this.htmlTagName = htmlTag.name;
          this.htmlTagClosing = htmlTag.closing;
          this.htmlTagAttributes = "";
          i = htmlTag.end;
          continue;
        }
        const closing = input.indexOf(">", i + 1);
        if (closing === -1) {
          const candidate = input.slice(i + 1);
          const suppressesCandidate = candidate.includes(NULL_CHARACTER)
            || isPotentialAutolinkDestination(candidate)
            || hasStartedAutolinkDestination(candidate)
            || hasAutolinkCredentialShape(candidate)
            || hasIncompleteWhitespaceSeparatedCredentialMarker(candidate);
          if (suppressesCandidate) {
            if (!this.finishing) {
              this.carry = input.slice(i);
              break;
            }
            consumeSource(input.slice(i));
            i = input.length;
            continue;
          }
          if (!this.finishing && hasUnresolvedAngleCandidate(candidate)) {
            this.carry = input.slice(i);
            break;
          }
        } else {
          const candidate = input.slice(i + 1, closing);
          if (candidate.includes(NULL_CHARACTER) || isAutolinkDestination(candidate) || hasStartedAutolinkDestination(candidate) || hasAutolinkCredentialShape(candidate)) {
            consumeSource(input.slice(i, closing + 1));
            i = closing + 1;
            continue;
          }
        }
      }
      if (char === "[") {
        this.mode = "link-label";
        this.linkLabelDepth = 1;
        consumeSource(char);
        i++;
        continue;
      }
      if (char === "`") {
        const length = runLength(i, char);
        if (i + length === input.length) {
          this.carry = input.slice(i);
          break;
        }
        this.mode = "inline-code";
        this.inlineTicks = length;
        consumeSource(input.slice(i, i + length));
        i += length;
        continue;
      }
      if (char === "*" || char === "_" || char === "~") {
        consumeSource(char);
        i++;
        continue;
      }
      if (this.inlineCodeWasSuppressed && /[.,!?;:]/.test(char) && /[.,!?;:]/.test(this.lastEmittedCharacter)) {
        this.inlineCodeWasSuppressed = false;
        consumeSource(char);
        i++;
        continue;
      }
      emit(char);
      consumeSource(char);
      i++;
    }

    return /\S/.test(out) ? out : null;
  }

  finish(): string | null {
    if (this.finished) return null;
    this.finishing = true;
    const output = this.push("");
    this.finishing = false;
    this.finished = true;
    return output || null;
  }

  reset(): void {
    this.mode = "text";
    this.carry = "";
    this.lineStart = true;
    this.pendingSpace = false;
    this.hasContent = false;
    this.inlineTicks = 0;
    this.inlineCodeWasSuppressed = false;
    this.lastEmittedCharacter = "";
    this.fenceCharacter = "`";
    this.fenceLength = 0;
    this.fenceHeader = false;
    this.linkLabelDepth = 0;
    this.linkDepth = 0;
    this.linkWhitespace = "";
    this.linkQuote = null;
    this.linkEscape = false;
    this.linkTitlePosition = false;
    this.linkTitleStarted = false;
    this.linkReferenceDepth = 0;
    this.linkReferenceEscape = false;
    this.referenceDefinitionIndent = "";
    this.referenceDefinitionLabel = "";
    this.referenceDefinitionDepth = 0;
    this.referenceDefinitionEscape = false;
    this.referenceDefinitionContinuation = "";
    this.referenceDefinitionCanContinueTitle = false;
    this.referenceDefinitionNeedsDestination = false;
    this.referenceDefinitionSkipsLineFeed = false;
    this.htmlQuote = null;
    this.htmlTagName = "";
    this.htmlTagClosing = false;
    this.htmlTagAttributes = "";
    this.htmlRawTag = "";
    this.htmlSuppressedElementStack = [];
    this.htmlDeclarationBracketDepth = 0;
    this.finishing = false;
    this.finished = false;
  }
}

export function sanitizeMarkdownForSpeech(markdown: string): string | null {
  const sanitizer = new MarkdownSpeechSanitizer();
  const streamed = sanitizer.push(markdown) ?? "";
  const finalized = sanitizer.finish() ?? "";
  return streamed + finalized || null;
}
