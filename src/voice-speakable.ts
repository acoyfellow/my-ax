export const ACRONYM = /(?<![\p{L}\p{N}_])(DDoS|\p{Lu}{2,5})(s)?(?![\p{L}\p{N}_])/gu;


const withoutJsonObjects = (text: string): string => {
  let out = "";
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (depth === 0 && char === "{" && /^\{\s*"/u.test(text.slice(index, index + 4))) { depth = 1; out += " "; continue; }
    if (depth > 0) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      continue;
    }
    out += char;
  }
  return out;
};

export const speakable = (text: string): string =>
  withoutJsonObjects(text)
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gmu, '')
    .replace(/^\s*[-*•]\s+/gmu, '')
    .replace(/^\s*\d+[.)]\s+/gmu, '')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/gu, '$2')
    .replace(/<([a-z_]+)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
    .replace(/<[a-z_]+\b[^>]*\/?>/giu, ' ')
    .replace(/<\/[a-z_]+>/giu, ' ')
    .replace(/\[\s*\{[\s\S]*?\}\s*\]/gu, ' ')
    .replace(/[*#>|]/gu, ' ')
    .replace(/["\u201c\u201d]/gu, '')
    .replace(/\s*(?:--+|\u2014)\s*/gu, '... ')
    .replace(ACRONYM, (_match: string, acronym: string, plural: string | undefined) => {
      const letters = acronym === 'AI' ? 'A.I.' : [...acronym.toUpperCase()].join(' ');

      return plural === undefined ? letters : `${letters}'s`;
    })
    .replace(/\s+([,.!?])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim();
