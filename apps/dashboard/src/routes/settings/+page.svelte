<script lang="ts">
  import { onMount } from 'svelte';
  import { getBackendBase, getWsUrl } from '$lib/config';

  const API_BASE = getBackendBase();
  const WS_URL = getWsUrl();

  let settings = {
    alerts: {
      browserPush: true,
      audio: true,
      audioVolume: 50,
      toastDuration: 5,
      quietHours: {
        enabled: true,
        start: '22:00',
        end: '08:00',
      },
    },
    theme: 'dark',
    refreshInterval: 2,
    kanbanColumnWidth: 384,
    humanHourlyRate: 100,
  };

  let saving = false;
  let saveMessage = '';
  let currentTheme = 'dark';

  let gatewayStatus: 'connected' | 'pending' | 'error' = 'pending';
  let backendStatus: 'connected' | 'pending' | 'error' = 'pending';
  let wsStatus: 'connected' | 'pending' | 'error' = 'pending';

  async function saveSettings() {
    saving = true;
    saveMessage = '';
    try {
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          kanbanColumnWidth: settings.kanbanColumnWidth,
          humanHourlyRate: settings.humanHourlyRate,
        }),
      });
      if (res.ok) {
        saveMessage = '✅ Settings saved';
      } else {
        saveMessage = '❌ Failed to save';
      }
    } catch {
      saveMessage = '❌ Failed to save';
    }
    saving = false;
    setTimeout(() => saveMessage = '', 3000);
  }

  onMount(async () => {
    // Load current theme
    if (typeof localStorage !== 'undefined') {
      currentTheme = localStorage.getItem('theme') || 'dark';
    }

    // Load persisted settings
    try {
      const res = await fetch(`${API_BASE}/api/settings`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data.kanbanColumnWidth) settings.kanbanColumnWidth = data.kanbanColumnWidth;
        if (data.humanHourlyRate) settings.humanHourlyRate = data.humanHourlyRate;
      }
    } catch {}

    // Backend API health check
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      backendStatus = res.ok ? 'connected' : 'error';
      const data = await res.json().catch(() => null);
      gatewayStatus = data?.gateway?.connected ? 'connected' : 'error';
    } catch {
      backendStatus = 'error';
      gatewayStatus = 'error';
    }

    // WebSocket check
    try {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        wsStatus = 'connected';
        ws.close();
      };
      ws.onerror = () => {
        wsStatus = 'error';
      };
    } catch {
      wsStatus = 'error';
    }
  });
</script>

<div class="max-w-2xl space-y-6">
  <h2 class="text-lg font-semibold">Settings</h2>
  
  <!-- Alert Settings -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">🔔 Alert Preferences</h3>
    
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Browser Push Notifications</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">Receive notifications when agents need attention</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" bind:checked={settings.alerts.browserPush} class="sr-only peer">
          <div class="w-11 h-6 bg-gray-100 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
      
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Audio Alerts</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">Play sound for high-priority approvals</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" bind:checked={settings.alerts.audio} class="sr-only peer">
          <div class="w-11 h-6 bg-gray-100 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
      
      {#if settings.alerts.audio}
        <div>
          <label for="audio-volume" class="block text-sm font-medium mb-2">Audio Volume</label>
          <input 
            id="audio-volume"
            type="range" 
            min="0" 
            max="100" 
            bind:value={settings.alerts.audioVolume}
            class="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
          >
          <div class="text-sm text-slate-500 dark:text-slate-400 mt-1">{settings.alerts.audioVolume}%</div>
        </div>
      {/if}
      
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Quiet Hours</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">Silence non-critical alerts during these hours</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" bind:checked={settings.alerts.quietHours.enabled} class="sr-only peer">
          <div class="w-11 h-6 bg-gray-100 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
      
      {#if settings.alerts.quietHours.enabled}
        <div class="flex gap-4">
          <div>
            <label for="quiet-hours-start" class="block text-sm font-medium mb-2">Start</label>
            <input 
              id="quiet-hours-start"
              type="time" 
              bind:value={settings.alerts.quietHours.start}
              class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm"
            >
          </div>
          <div>
            <label for="quiet-hours-end" class="block text-sm font-medium mb-2">End</label>
            <input 
              id="quiet-hours-end"
              type="time" 
              bind:value={settings.alerts.quietHours.end}
              class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm"
            >
          </div>
        </div>
      {/if}
    </div>
  </div>
  
  <!-- Cost Estimation Settings -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">💰 Cost Estimation</h3>
    
    <div class="space-y-4">
      <div>
        <label for="human-hourly-rate" class="block text-sm font-medium mb-2">Human Hourly Rate ($)</label>
        <input 
          id="human-hourly-rate"
          type="number" 
          min="1" 
          max="10000"
          step="1"
          bind:value={settings.humanHourlyRate}
          class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm w-32"
        >
        <div class="text-sm text-slate-500 dark:text-slate-400 mt-1">Used to estimate cost savings vs. human developer time</div>
      </div>
    </div>
  </div>

  <!-- Display Settings -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">🎨 Display</h3>
    
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Theme</div>
          <div class="text-sm text-slate-500 dark:text-slate-400">
            {currentTheme === 'dark' ? '🌙 Dark mode' : '☀️ Light mode'}
          </div>
        </div>
        <button
          on:click={() => {
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            currentTheme = newTheme;
            if (typeof document !== 'undefined') {
              if (newTheme === 'dark') {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }
              localStorage.setItem('theme', newTheme);
            }
          }}
          class="px-4 py-2 bg-gray-200 dark:bg-slate-600 hover:bg-gray-300 dark:hover:bg-slate-500 rounded-lg text-sm font-medium transition-colors"
        >
          Switch to {currentTheme === 'dark' ? '☀️ Light' : '🌙 Dark'}
        </button>
      </div>
      
      <div>
        <label for="kanban-col-width" class="block text-sm font-medium mb-2">Work Order Column Width (px)</label>
        <input 
          id="kanban-col-width"
          type="range" 
          min="280" 
          max="600"
          step="20"
          bind:value={settings.kanbanColumnWidth}
          class="w-full h-2 bg-gray-100 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer"
        >
        <div class="text-sm text-slate-500 dark:text-slate-400 mt-1">{settings.kanbanColumnWidth}px</div>
      </div>
      
      <div>
        <label for="refresh-interval" class="block text-sm font-medium mb-2">Refresh Interval (seconds)</label>
        <input 
          id="refresh-interval"
          type="number" 
          min="1" 
          max="30"
          bind:value={settings.refreshInterval}
          class="bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded px-3 py-2 text-sm w-32"
        >
        <div class="text-sm text-slate-500 dark:text-slate-400 mt-1">How often to poll for updates (WebSocket will be instant)</div>
      </div>
    </div>
  </div>
  
  <!-- Connection Info -->
  <div class="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 p-4">
    <h3 class="font-medium mb-4">🔌 Connection</h3>
    
    <div class="space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-slate-500 dark:text-slate-400">OpenClaw Gateway</span>
        <span class={gatewayStatus === 'connected' ? 'text-green-400' : gatewayStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}>
          ● {gatewayStatus === 'connected' ? 'Connected' : gatewayStatus === 'error' ? 'Not Connected' : 'Pending'}
        </span>
      </div>
      <div class="flex justify-between">
        <span class="text-slate-500 dark:text-slate-400">WebSocket</span>
        <span class={wsStatus === 'connected' ? 'text-green-400' : wsStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}>
          ● {wsStatus === 'connected' ? 'Connected' : wsStatus === 'error' ? 'Not Connected' : 'Pending'}
        </span>
      </div>
      <div class="flex justify-between">
        <span class="text-slate-500 dark:text-slate-400">Backend API</span>
        <span class={backendStatus === 'connected' ? 'text-green-400' : backendStatus === 'error' ? 'text-red-400' : 'text-yellow-400'}>
          ● {backendStatus === 'connected' ? 'Connected' : backendStatus === 'error' ? 'Not Running' : 'Pending'}
        </span>
      </div>
    </div>
  </div>
  
  <!-- Save Button -->
  <div class="flex items-center justify-end gap-3">
    {#if saveMessage}
      <span class="text-sm {saveMessage.startsWith('✅') ? 'text-green-400' : 'text-red-400'}">{saveMessage}</span>
    {/if}
    <button 
      on:click={saveSettings}
      disabled={saving}
      class="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded font-medium transition-colors"
    >
      {saving ? 'Saving...' : 'Save Settings'}
    </button>
  </div>
</div>
