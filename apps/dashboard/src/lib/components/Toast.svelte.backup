<script lang="ts">
  import { toasts, type Toast } from '$lib/stores/toasts';
  import { fly, fade } from 'svelte/transition';
  
  function getIcon(type: Toast['type']): string {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
      default:
        return 'ℹ️';
    }
  }
  
  function getColorClasses(type: Toast['type']): string {
    switch (type) {
      case 'success':
        return 'bg-green-500/90 border-green-400';
      case 'error':
        return 'bg-red-500/90 border-red-400';
      case 'warning':
        return 'bg-orange-500/90 border-orange-400';
      case 'info':
      default:
        return 'bg-blue-500/90 border-blue-400';
    }
  }
</script>

<div class="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-md">
  {#each $toasts as toast (toast.id)}
    <div
      class="pointer-events-auto border rounded-lg shadow-lg p-4 flex items-start gap-3 backdrop-blur-sm {getColorClasses(toast.type)}"
      transition:fly="{{ y: -20, duration: 300 }}"
    >
      <span class="text-2xl flex-shrink-0">{getIcon(toast.type)}</span>
      <div class="flex-1 min-w-0">
        <p class="text-white font-medium leading-tight">{toast.message}</p>
      </div>
      <button
        class="flex-shrink-0 text-white/70 hover:text-white transition-colors"
        on:click={() => toasts.remove(toast.id)}
        aria-label="Close notification"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  {/each}
</div>
