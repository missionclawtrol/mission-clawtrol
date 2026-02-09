<script lang="ts">
  // Mock data - will be replaced with API calls
  const agents = [
    { id: 'jarvis', name: 'Jarvis', status: 'idle', role: 'Personal Assistant' },
    { id: 'goldie-pm', name: 'Goldie PM', status: 'working', role: 'Project Manager', task: 'Drafting patent #2' },
    { id: 'research', name: 'Research', status: 'idle', role: 'Deep Research' },
  ];
  
  const projects = [
    { id: 'goldie', name: 'Goldie Health', agents: ['goldie-pm', 'research'], status: 'active', updated: '2 hours ago' },
    { id: 'dashboard', name: 'Agent Dashboard', agents: ['jarvis'], status: 'active', updated: 'Just now' },
    { id: 'nonprofit', name: 'PT/OT Nonprofit', agents: ['jarvis'], status: 'idle', updated: '3 days ago' },
  ];
  
  const recentActivity = [
    { time: '08:05', type: 'message', from: 'You', to: 'Jarvis', text: 'Start building the dashboard' },
    { time: '08:04', type: 'status', agent: 'Jarvis', text: 'Status changed to working' },
    { time: '07:58', type: 'file', agent: 'Jarvis', text: 'Created agent-dashboard/PROJECT.md' },
  ];
  
  const statusColors: Record<string, string> = {
    idle: 'bg-green-500',
    working: 'bg-yellow-500',
    error: 'bg-red-500',
    waiting: 'bg-blue-500',
    offline: 'bg-slate-500',
  };
  
  const statusIcons: Record<string, string> = {
    idle: '🟢',
    working: '🟡',
    error: '🔴',
    waiting: '⏳',
    offline: '⚫',
  };
</script>

<div class="space-y-6">
  <!-- Stats Row -->
  <div class="grid grid-cols-4 gap-4">
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold">{agents.length}</div>
      <div class="text-sm text-slate-400">Total Agents</div>
    </div>
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold">{agents.filter(a => a.status === 'working').length}</div>
      <div class="text-sm text-slate-400">Active</div>
    </div>
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold">{projects.length}</div>
      <div class="text-sm text-slate-400">Projects</div>
    </div>
    <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div class="text-3xl font-bold text-yellow-400">0</div>
      <div class="text-sm text-slate-400">Pending Approvals</div>
    </div>
  </div>
  
  <!-- Main Grid -->
  <div class="grid grid-cols-2 gap-6">
    <!-- Agents Panel -->
    <div class="bg-slate-800 rounded-lg border border-slate-700">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 class="font-semibold">Agents</h2>
      </div>
      <div class="p-4 space-y-3">
        {#each agents as agent}
          <div class="flex items-center justify-between p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
            <div class="flex items-center gap-3">
              <span>{statusIcons[agent.status]}</span>
              <div>
                <div class="font-medium">{agent.name}</div>
                <div class="text-sm text-slate-400">{agent.role}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-sm capitalize text-slate-300">{agent.status}</div>
              {#if agent.task}
                <div class="text-xs text-slate-500 truncate max-w-[150px]">{agent.task}</div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
    
    <!-- Projects Panel -->
    <div class="bg-slate-800 rounded-lg border border-slate-700">
      <div class="px-4 py-3 border-b border-slate-700">
        <h2 class="font-semibold">Projects</h2>
      </div>
      <div class="p-4 space-y-3">
        {#each projects as project}
          <div class="p-3 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition-colors cursor-pointer">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span>📁</span>
                <span class="font-medium">{project.name}</span>
              </div>
              <span class="text-xs text-slate-500">{project.updated}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-400">Agents:</span>
              {#each project.agents as agentId}
                {@const agent = agents.find(a => a.id === agentId)}
                {#if agent}
                  <span class="text-xs px-2 py-0.5 bg-slate-600 rounded">{agent.name}</span>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
  
  <!-- Recent Activity -->
  <div class="bg-slate-800 rounded-lg border border-slate-700">
    <div class="px-4 py-3 border-b border-slate-700">
      <h2 class="font-semibold">Recent Activity</h2>
    </div>
    <div class="p-4 space-y-2">
      {#each recentActivity as event}
        <div class="flex items-center gap-4 text-sm">
          <span class="text-slate-500 w-12">{event.time}</span>
          {#if event.type === 'message'}
            <span class="text-blue-400">💬</span>
            <span><span class="text-slate-300">{event.from}</span> → <span class="text-slate-300">{event.to}</span>: {event.text}</span>
          {:else if event.type === 'status'}
            <span class="text-yellow-400">🔄</span>
            <span><span class="text-slate-300">{event.agent}</span>: {event.text}</span>
          {:else if event.type === 'file'}
            <span class="text-green-400">📄</span>
            <span><span class="text-slate-300">{event.agent}</span>: {event.text}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
