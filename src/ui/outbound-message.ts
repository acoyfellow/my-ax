export interface OutboundMessageDraft {
  text: string;
  hasVisibleContent: boolean;
}

export function createOutboundMessageDraft(text: string): OutboundMessageDraft {
  return {
    text,
    hasVisibleContent: text.trim().length > 0,
  };
}
