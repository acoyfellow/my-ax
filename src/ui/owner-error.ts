export function clarifyOwnerError(text: string): string {
  if (/invalid url string/i.test(text)) {
    return "A link on this turn is not a valid URL. The turn stopped. Check desk or notify hrefs.";
  }
  return text;
}
