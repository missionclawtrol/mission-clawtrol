<script lang="ts">
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
  };
</script>

<div class="max-w-2xl space-y-6">
  <h2 class="text-lg font-semibold">Settings</h2>
  
  <!-- Alert Settings -->
  <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
    <h3 class="font-medium mb-4">🔔 Alert Preferences</h3>
    
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Browser Push Notifications</div>
          <div class="text-sm text-slate-400">Receive notifications when agents need attention</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" bind:checked={settings.alerts.browserPush} class="sr-only peer">
          <div class="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
        </label>
      </div>
      
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Audio Alerts</div>
          <div class="text-sm text-slate-400">Play sound for high-priority approvals</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" bind:checked={settings.alerts.audio} class="sr-only peer">
          <div class="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
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
            class="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          >
          <div class="text-sm text-slate-400 mt-1">{settings.alerts.audioVolume}%</div>
        </div>
      {/if}
      
      <div class="flex items-center justify-between">
        <div>
          <div class="font-medium">Quiet Hours</div>
          <div class="text-sm text-slate-400">Silence non-critical alerts during these hours</div>
        </div>
        <label class="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" bind:checked={settings.alerts.quietHours.enabled} class="sr-only peer">
          <div class="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
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
              class="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
            >
          </div>
          <div>
            <label for="quiet-hours-end" class="block text-sm font-medium mb-2">End</label>
            <input 
              id="quiet-hours-end"
              type="time" 
              bind:value={settings.alerts.quietHours.end}
              class="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm"
            >
          </div>
        </div>
      {/if}
    </div>
  </div>
  
  <!-- Display Settings -->
  <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
    <h3 class="font-medium mb-4">🎨 Display</h3>
    
    <div class="space-y-4">
      <div>
        <label for="theme-select" class="block text-sm font-medium mb-2">Theme</label>
        <select 
          id="theme-select"
          bind:value={settings.theme}
          class="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm w-full"
        >
          <option value="dark">Dark</option>
          <option value="light">Light (coming soon)</option>
        </select>
      </div>
      
      <div>
        <label for="refresh-interval" class="block text-sm font-medium mb-2">Refresh Interval (seconds)</label>
        <input 
          id="refresh-interval"
          type="number" 
          min="1" 
          max="30"
          bind:value={settings.refreshInterval}
          class="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm w-32"
        >
        <div class="text-sm text-slate-400 mt-1">How often to poll for updates (WebSocket will be instant)</div>
      </div>
    </div>
  </div>
  
  <!-- Connection Info -->
  <div class="bg-slate-800 rounded-lg border border-slate-700 p-4">
    <h3 class="font-medium mb-4">🔌 Connection</h3>
    
    <div class="space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-slate-400">OpenClaw Gateway</span>
        <span class="text-green-400">● Connected</span>
      </div>
      <div class="flex justify-between">
        <span class="text-slate-400">WebSocket</span>
        <span class="text-yellow-400">● Pending</span>
      </div>
      <div class="flex justify-between">
        <span class="text-slate-400">Backend API</span>
        <span class="text-yellow-400">● Not Running</span>
      </div>
    </div>
  </div>
  
  <!-- Save Button -->
  <div class="flex justify-end">
    <button class="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium transition-colors">
      Save Settings
    </button>
  </div>
</div>
