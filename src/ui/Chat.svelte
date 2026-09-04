<script lang="ts">
  import { marked } from "marked";
  import { createOutboundMessageDraft } from "./outbound-message";

  type Role = "user" | "assistant";

  interface Message {
    id: string;
    role: Role;
    content: string;
  }

  let composerText = $state("");
  let messages = $state<Message[]>([]);

  function renderMarkdown(content: string) {
    return marked.parse(content, { gfm: true, breaks: true }) as string;
  }

  function sendMessage() {
    const draft = createOutboundMessageDraft(composerText);
    if (!draft.hasVisibleContent) return;

    messages = [...messages, {
      id: crypto.randomUUID(),
      role: "user",
      content: draft.text,
    }];
    composerText = "";
  }
</script>

<div class="h-full flex flex-col">
  <main class="flex-1 overflow-y-auto" aria-label="Conversation">
    {#each messages as message (message.id)}
      <article class={`msg msg-${message.role}`}>
        <header class="msg-head"><span class="msg-head__role">{message.role === "user" ? "You" : "Agent"}</span></header>
        {#if message.role === "user"}
          <div class="msg-body">{message.content}</div>
        {:else}
          <div class="msg-body"><div class="prose prose-invert prose-sm max-w-none">{@html renderMarkdown(message.content)}</div></div>
        {/if}
      </article>
    {/each}
  </main>

  <form class="safe-area-composer flex gap-2 p-3" onsubmit={(event) => { event.preventDefault(); sendMessage(); }}>
    <textarea bind:value={composerText} class="flex-1" aria-label="Message"></textarea>
    <button type="submit" aria-label="Send message">Send</button>
  </form>
</div>
