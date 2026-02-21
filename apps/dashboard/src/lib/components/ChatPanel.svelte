<script lang="ts">
  import { onMount, onDestroy, afterUpdate, tick } from 'svelte';
  import { page } from '$app/stores';
  import { marked } from 'marked';
  import {
    chatOpen,
    messages,
    isStreaming,
    isConnected,
    selectedAgentId,
    agents,
    currentContext,
    connectChatWS,
    disconnectChatWS,
    sendMessage,
    switchAgent,
    clearHistory,
    closeChat,
    loadAgents,
    setContext,
    type ChatMessage,
  } from '$lib/stores/chat';

  // Textarea input
  let inputText = '';
  let inputEl: HTMLTextAreaElement;
  let messagesEl: HTMLDivElement;
  let agentSelectOpen = false;

  // Configure marked for safe rendering
  marked.setOptions({ breaks: true, gfm: true });

  // Render markdown safely
  function renderMarkdown(content: string): string {
    try {
      return marked.parse(content) as string;
    } catch {
      return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }

  // Auto-scroll to bottom when new messages arrive
  afterUpdate(async () => {
    await tick();
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });

  // Update context when page changes
  $: if ($page) {
    const pathname = $page.url.pathname;
    const params = $page.params as Record<string, string | undefined>;
    setContext({
      route: pathname,
      projectId: params.project || params.projectId || undefined,
      taskId: params.task || params.taskId || undefined,
    });
  }

  // Handle message send
  function handleSend() {
    const text = inputText.trim();
    if (!text || $isStreaming) return;
    sendMessage(text, $currentContext);
    inputText = '';
    // Auto-resize textarea back
    if (inputEl) {
      inputEl.style.height = 'auto';
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  function handleAgentSelect(agentId: string) {
    switchAgent(agentId);
    agentSelectOpen = false;
  }

  // Close agent dropdown when clicking outside
  function handleClickOutside(e: MouseEvent) {
    if (agentSelectOpen) {
      const target = e.target as HTMLElement;
      if (!target.closest('.agent-select')) agentSelectOpen = false;
    }
  }

  // Format timestamp
  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Get current agent info
  $: currentAgent = $agents.find((a) => a.id === $selectedAgentId) || {
    id: $selectedAgentId,
    name: $selectedAgentId,
    emoji: '🤖',
    model: '',
  };

  // Context badge text
  $: contextBadge = $currentContext.projectId
    ? `📁 ${$currentContext.projectId}${$currentContext.taskId ? ` › task` : ''}`
    : $currentContext.route && $currentContext.route !== '/'
    ? `📄 ${$currentContext.route}`
    : '';

  onMount(() => {
    connectChatWS();
    loadAgents();
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('click', handleClickOutside);
    };
  });

  onDestroy(() => {
    disconnectChatWS();
  });
</script>

<!-- Chat Panel Overlay Drawer -->
{#if $chatOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fixed inset-0 z-40 pointer-events-none"
    aria-hidden="true"
  >
    <!-- Backdrop (mobile) -->
    <div
      class="absolute inset-0 bg-black/30 pointer-events-auto md:hidden"
      on:click={closeChat}
    ></div>

    <!-- Drawer -->
    <div
      class="absolute top-0 right-0 h-full w-full md:w-[420px] bg-slate-900 border-l border-slate-700 flex flex-col shadow-2xl pointer-events-auto"
      role="dialog"
      aria-label="AI Chat Panel"
    >
      <!-- Header -->
      <div class="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-800/80 flex-shrink-0">
        <!-- Agent selector -->
        <div class="relative agent-select flex-1">
          <button
            on:click|stopPropagation={() => (agentSelectOpen = !agentSelectOpen)}
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors text-sm"
          >
            <span class="text-lg leading-none">{currentAgent.emoji}</span>
            <span class="font-medium text-slate-200">{currentAgent.name}</span>
            <svg
              class="w-3.5 h-3.5 text-slate-400 transition-transform {agentSelectOpen ? 'rotate-180' : ''}"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {#if agentSelectOpen}
            <div class="absolute top-full left-0 mt-1 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-10 overflow-hidden">
              {#each $agents as agent}
                <button
                  on:click={() => handleAgentSelect(agent.id)}
                  class="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-700 transition-colors text-left
                    {$selectedAgentId === agent.id ? 'bg-slate-700/50 text-blue-400' : 'text-slate-300'}"
                >
                  <span class="text-xl">{agent.emoji}</span>
                  <div>
                    <div class="font-medium">{agent.name}</div>
                    {#if agent.model}
                      <div class="text-xs text-slate-500 truncate">{agent.model.split('/').pop()}</div>
                    {/if}
                  </div>
                  {#if $selectedAgentId === agent.id}
                    <span class="ml-auto text-blue-400">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Connection status -->
        <div class="flex items-center gap-1.5" title={$isConnected ? 'Connected' : 'Disconnected'}>
          <span
            class="w-2 h-2 rounded-full {$isConnected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}"
          ></span>
        </div>

        <!-- Clear history -->
        <button
          on:click={clearHistory}
          title="Clear conversation"
          class="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-200"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>

        <!-- Close button -->
        <button
          on:click={closeChat}
          class="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-slate-200"
          aria-label="Close chat"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Context badge -->
      {#if contextBadge}
        <div class="px-4 py-1.5 bg-slate-800/50 border-b border-slate-700/50 flex-shrink-0">
          <span class="text-xs text-slate-400 font-mono">{contextBadge}</span>
        </div>
      {/if}

      <!-- Messages area -->
      <div
        bind:this={messagesEl}
        class="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth"
        role="log"
        aria-live="polite"
      >
        {#if $messages.length === 0}
          <div class="flex flex-col items-center justify-center h-full text-center gap-3 text-slate-500">
            <span class="text-5xl opacity-50">{currentAgent.emoji}</span>
            <div>
              <p class="text-sm font-medium text-slate-400">{currentAgent.name}</p>
              <p class="text-xs mt-1">Ask anything about your projects, tasks, or codebase.</p>
            </div>
          </div>
        {:else}
          {#each $messages as msg (msg.id)}
            <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-2">
              {#if msg.role === 'assistant'}
                <div class="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-sm flex-shrink-0 mt-0.5">
                  {currentAgent.emoji}
                </div>
              {/if}

              <div
                class="max-w-[85%] {msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5'
                  : 'bg-slate-800 text-slate-200 rounded-2xl rounded-tl-sm px-4 py-3'}"
              >
                {#if msg.role === 'user'}
                  <p class="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                {:else}
                  <div
                    class="prose prose-sm prose-invert max-w-none text-slate-200
                      prose-headings:text-slate-100 prose-headings:font-semibold
                      prose-code:text-blue-300 prose-code:bg-slate-900/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono
                      prose-pre:bg-slate-900 prose-pre:border prose-pre:border-slate-700 prose-pre:rounded-lg prose-pre:text-xs
                      prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                      prose-strong:text-slate-100
                      prose-li:text-slate-300
                      prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5
                      prose-pre:my-2 prose-h1:mt-2 prose-h2:mt-2 prose-h3:mt-2"
                  >
                    {#if msg.streaming && !msg.content}
                      <div class="flex items-center gap-1.5 py-1">
                        <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                        <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                        <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
                      </div>
                    {:else}
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html renderMarkdown(msg.content)}
                    {/if}
                  </div>
                {/if}

                <div class="mt-1 text-right">
                  <span class="text-xs {msg.role === 'user' ? 'text-blue-200/60' : 'text-slate-500'}">
                    {formatTime(msg.timestamp)}
                  </span>
                </div>
              </div>

              {#if msg.role === 'user'}
                <div class="w-7 h-7 rounded-full bg-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5">
                  You
                </div>
              {/if}
            </div>
          {/each}

          <!-- Typing indicator when streaming but no placeholder yet -->
          {#if $isStreaming && $messages[$messages.length - 1]?.role === 'user'}
            <div class="flex justify-start gap-2">
              <div class="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-sm flex-shrink-0">
                {currentAgent.emoji}
              </div>
              <div class="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3">
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                  <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                  <span class="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
                </div>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <!-- Not connected banner -->
      {#if !$isConnected}
        <div class="px-4 py-2 bg-yellow-500/10 border-t border-yellow-500/20 flex-shrink-0">
          <p class="text-xs text-yellow-400 text-center">⚠ Reconnecting to agent...</p>
        </div>
      {/if}

      <!-- Input area -->
      <div class="px-4 py-3 border-t border-slate-700 bg-slate-800/50 flex-shrink-0">
        <div class="flex items-end gap-2">
          <div class="flex-1 relative">
            <textarea
              bind:this={inputEl}
              bind:value={inputText}
              on:keydown={handleKeyDown}
              on:input={autoResize}
              rows="1"
              placeholder="Message {currentAgent.name}…"
              disabled={$isStreaming || !$isConnected}
              class="w-full bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 pr-2 text-sm text-slate-200 placeholder-slate-400
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     resize-none overflow-hidden transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed"
              style="min-height: 40px; max-height: 120px;"
            ></textarea>
          </div>

          <button
            on:click={handleSend}
            disabled={!inputText.trim() || $isStreaming || !$isConnected}
            class="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors flex-shrink-0 self-end mb-0.5"
            aria-label="Send message"
          >
            {#if $isStreaming}
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
            {:else}
              <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            {/if}
          </button>
        </div>

        <p class="text-xs text-slate-500 mt-1.5 text-center">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Smooth slide-in animation */
  div[role="dialog"] {
    animation: slideIn 0.2s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  /* Prose styling fixes for dark theme */
  :global(.prose-invert pre code) {
    background: transparent;
    padding: 0;
  }
</style>
