<script lang="ts">
  import { sendMessage, fetchMessageHistory, type SendMessageResult } from '$lib/api';

  // Props - receive project from parent (Tasks page)
  export let projectId: string = '';

  let message = '';
  let sending = false;
  let error = '';
  let success = '';

  // Chat history for display
  interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }
  
  let chatHistory: ChatMessage[] = [];
  let lastMessageCount = 0;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  // Load initial history when component mounts
  async function loadHistory() {
    try {
      const result = await fetchMessageHistory(50);
      if (result.messages && Array.isArray(result.messages)) {
        // Convert API messages to ChatMessage format
        chatHistory = result.messages.map((msg) => ({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
          timestamp: new Date(),
        }));
        lastMessageCount = chatHistory.length;
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // Start polling for new messages after sending
  function startPolling() {
    stopPolling();
    let pollCount = 0;
    const maxPolls = 10; // Poll for up to 10 seconds
    
    pollInterval = setInterval(async () => {
      pollCount++;
      try {
        const result = await fetchMessageHistory(50);
        if (result.messages && Array.isArray(result.messages)) {
          const newMessages: ChatMessage[] = result.messages.map((msg) => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.content,
            timestamp: new Date(),
          }));
          
          // Only add new messages that aren't in our history
          const existingContents = new Set(chatHistory.map(m => m.content));
          const newOnly = newMessages.filter(m => !existingContents.has(m.content));
          
          if (newOnly.length > 0) {
            chatHistory = [...chatHistory, ...newOnly];
            lastMessageCount = chatHistory.length;
            
            // Stop polling if we got new assistant messages
            const hasNewAssistant = newOnly.some(m => m.role === 'assistant');
            if (hasNewAssistant) {
              stopPolling();
            }
          }
        }
        
        // Stop after max polls even if no new messages
        if (pollCount >= maxPolls) {
          stopPolling();
        }
      } catch (err) {
        console.error('Poll error:', err);
        pollCount++;
        if (pollCount >= maxPolls) {
          stopPolling();
        }
      }
    }, 1000); // Poll every second
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  async function handleSendMessage() {
    if (!message.trim() || sending) return;

    const userMessage = message.trim();
    message = '';
    sending = true;
    error = '';
    success = '';

    // Add user message to chat
    chatHistory = [...chatHistory, {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    }];

    try {
      const result: SendMessageResult = await sendMessage({
        message: userMessage,
        projectId: projectId || undefined,
      });

      if (result.success) {
        success = 'Message sent!';
        // Start polling for AI response
        startPolling();
      } else {
        error = result.error || 'Failed to send message';
        // Remove the user message if it failed
        chatHistory = chatHistory.slice(0, -1);
      }
    } catch (err) {
      error = 'Network error';
      chatHistory = chatHistory.slice(0, -1);
    } finally {
      sending = false;
      
      // Clear success message after 3 seconds
      if (success) {
        setTimeout(() => {
          success = '';
        }, 3000);
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  }

  function formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // Load history on mount
  import { onMount, onDestroy } from 'svelte';
  onMount(() => {
    loadHistory();
  });

  onDestroy(() => {
    stopPolling();
  });
</script>

<div class="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden h-full flex flex-col">
  <!-- Header -->
  <div class="px-4 py-3 border-b border-slate-700 bg-slate-700/50">
    <h2 class="font-semibold text-slate-100 flex items-center gap-2">
      <span>💬</span> Message AI
    </h2>
    {#if projectId}
      <p class="text-xs text-slate-400 mt-1">Project context active</p>
    {:else}
      <p class="text-xs text-slate-400 mt-1">Select a project above to add context</p>
    {/if}
  </div>

  <!-- Chat History (scrollable) -->
  <div class="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
    {#if chatHistory.length === 0}
      <div class="text-center py-8 text-slate-500 text-sm">
        <p>No messages yet</p>
        <p class="mt-1">{projectId ? 'Send a message to get started' : 'Select a project above and send a message'}</p>
      </div>
    {:else}
      {#each chatHistory as msg}
        <div class="flex {msg.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div class="max-w-[85%] {msg.role === 'user' ? 'bg-blue-600' : 'bg-slate-700'} rounded-lg px-3 py-2">
            <div class="text-sm {msg.role === 'user' ? 'text-white' : 'text-slate-100'} whitespace-pre-wrap break-words">
              {msg.content}
            </div>
            <div class="text-xs {msg.role === 'user' ? 'text-blue-200' : 'text-slate-500'} mt-1">
              {formatTime(msg.timestamp)}
            </div>
          </div>
        </div>
      {/each}
    {/if}
    
    {#if sending}
      <div class="flex justify-start">
        <div class="bg-slate-700 rounded-lg px-3 py-2">
          <div class="text-sm text-slate-300">Sending...</div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Status Messages -->
  {#if error}
    <div class="px-4 py-2 bg-red-500/20 border-t border-red-500/30">
      <div class="text-sm text-red-400">{error}</div>
    </div>
  {/if}
  {#if success}
    <div class="px-4 py-2 bg-green-500/20 border-t border-green-500/30">
      <div class="text-sm text-green-400">{success}</div>
    </div>
  {/if}

  <!-- Input Area -->
  <div class="px-4 py-3 border-t border-slate-700">
    <div class="flex gap-2">
      <input
        type="text"
        bind:value={message}
        on:keydown={handleKeydown}
        placeholder="Type your message..."
        class="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500"
        disabled={sending}
      />
      <button
        on:click={handleSendMessage}
        disabled={!message.trim() || sending}
        class="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded px-4 py-2 text-sm font-medium transition-colors"
      >
        {sending ? '...' : 'Send'}
      </button>
    </div>
    <p class="text-xs text-slate-500 mt-2">
      Press Enter to send. Project context is set by the filter above.
    </p>
  </div>
</div>
