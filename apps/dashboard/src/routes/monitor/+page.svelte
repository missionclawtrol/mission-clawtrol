<script lang="ts">
  // Mock data - will be replaced with WebSocket updates
  const agentTree = [
    {
      project: 'Goldie Health',
      agents: [
        { id: 'goldie-pm', name: 'Goldie PM', status: 'working', task: 'Drafting patent #2' },
        { id: 'research', name: 'Research', status: 'idle' },
      ]
    },
    {
      project: 'Agent Dashboard',
      agents: [
        { id: 'jarvis', name: 'Jarvis', status: 'working', task: 'Building frontend scaffold' },
      ]
    },
    {
      project: 'Personal',
      agents: [
        { id: 'jarvis', name: 'Jarvis', status: 'working' },
      ]
    },
  ];
  
  const tasks = {
    parallel: [
      { id: 1, name: 'Research competitors', status: 'complete', agent: 'Research' },
      { id: 2, name: 'Draft patent #2', status: 'in_progress', agent: 'Goldie PM' },
      { id: 3, name: 'Review legal docs', status: 'pending', agent: 'Research' },
    ],
    sequential: [
      { id: 4, name: 'Integration testing', status: 'pending', agent: 'TBD' },
      { id: 5, name: 'Deploy to staging', status: 'pending', agent: 'TBD' },
    ]
  };
  
  const events = [
    { time: '08:06:32', level: 'info', message: 'Jarvis: Created dashboard scaffold' },
    { time: '08:06:15', level: 'info', message: 'Jarvis: Installed Tailwind CSS' },
    { time: '08:05:58', level: 'info', message: 'Jarvis: Initialized SvelteKit project' },
    { time: '08:05:02', level: 'info', message: 'You → Jarvis: "Start building the dashboard"' },
    { time: '08:04:30', level: 'info', message: 'Goldie PM → Research: "Start competitor analysis"' },
  ];
  
  const statusIcons: Record<string, string> = {
    idle: '🟢',
    working: '🟡',
    error: '🔴',
    waiting: '⏳',
    complete: '✅',
    in_progress: '🟡',
    pending: '⏳',
  };
</script>

<div class="h-[calc(100vh-180px)] flex flex-col gap-4">
  <!-- Top Section: Agent Tree + Task List -->
  <div class="flex-1 grid grid-cols-2 gap-4 min-h-0">
    <!-- Agent Tree -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col min-h-0">
      <div class="px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <h2 class="font-semibold">Agent Tree</h2>
      </div>
      <div class="p-4 overflow-y-auto flex-1">
        {#each agentTree as group}
          <div class="mb-4">
            <div class="flex items-center gap-2 text-slate-400 mb-2">
              <span>📁</span>
              <span class="font-medium">{group.project}</span>
            </div>
            <div class="ml-6 space-y-2">
              {#each group.agents as agent}
                <div class="flex items-center justify-between p-2 bg-slate-700/50 rounded hover:bg-slate-700 transition-colors cursor-pointer">
                  <div class="flex items-center gap-2">
                    <span>{statusIcons[agent.status]}</span>
                    <span>{agent.name}</span>
                  </div>
                  {#if agent.task}
                    <span class="text-xs text-slate-500 truncate max-w-[150px]">{agent.task}</span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
    
    <!-- Task List -->
    <div class="bg-slate-800 rounded-lg border border-slate-700 flex flex-col min-h-0">
      <div class="px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <h2 class="font-semibold">Task List</h2>
      </div>
      <div class="p-4 overflow-y-auto flex-1">
        <!-- Parallel Tasks -->
        <div class="mb-4">
          <div class="text-sm text-slate-400 mb-2 font-medium">PARALLEL TASKS</div>
          <div class="space-y-2">
            {#each tasks.parallel as task}
              <div class="flex items-center justify-between p-2 bg-slate-700/50 rounded">
                <div class="flex items-center gap-2">
                  <span>{statusIcons[task.status]}</span>
                  <span class:line-through={task.status === 'complete'} class:text-slate-500={task.status === 'complete'}>
                    {task.name}
                  </span>
                </div>
                <span class="text-xs text-slate-500">{task.agent}</span>
              </div>
            {/each}
          </div>
        </div>
        
        <!-- Sequential Tasks -->
        <div>
          <div class="text-sm text-slate-400 mb-2 font-medium">SEQUENTIAL TASKS</div>
          <div class="space-y-2">
            {#each tasks.sequential as task}
              <div class="flex items-center justify-between p-2 bg-slate-700/50 rounded">
                <div class="flex items-center gap-2">
                  <span>{statusIcons[task.status]}</span>
                  <span>{task.name}</span>
                </div>
                <span class="text-xs text-slate-500">{task.agent}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Bottom Section: Event Log -->
  <div class="h-48 bg-slate-800 rounded-lg border border-slate-700 flex flex-col">
    <div class="px-4 py-2 border-b border-slate-700 flex items-center justify-between flex-shrink-0">
      <h2 class="font-semibold text-sm">Event Log</h2>
      <button class="text-xs text-slate-500 hover:text-slate-300">Clear</button>
    </div>
    <div class="p-3 overflow-y-auto flex-1 font-mono text-xs">
      {#each events as event}
        <div class="flex gap-3 py-1 hover:bg-slate-700/50">
          <span class="text-slate-500">{event.time}</span>
          <span class="text-slate-300">{event.message}</span>
        </div>
      {/each}
    </div>
  </div>
</div>
