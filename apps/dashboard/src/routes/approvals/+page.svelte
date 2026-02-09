<script lang="ts">
  // Mock data - will be replaced with API calls
  let approvals = [
    {
      id: '1',
      priority: 'high',
      agent: 'Goldie PM',
      action: 'Send email to investor',
      details: 'Follow-up on Series A meeting with detailed term sheet...',
      time: '2 min ago',
    },
    {
      id: '2',
      priority: 'medium',
      agent: 'Research',
      action: 'Execute shell command',
      details: 'rm -rf ./temp/*',
      time: '15 min ago',
    },
    {
      id: '3',
      priority: 'low',
      agent: 'Frontend',
      action: 'Install npm package',
      details: 'lodash@4.17.21',
      time: '1 hour ago',
    },
  ];
  
  const priorityColors: Record<string, string> = {
    high: 'border-red-500 bg-red-500/10',
    medium: 'border-yellow-500 bg-yellow-500/10',
    low: 'border-green-500 bg-green-500/10',
  };
  
  const priorityIcons: Record<string, string> = {
    high: '🔴',
    medium: '🟡',
    low: '🟢',
  };
  
  function approve(id: string) {
    approvals = approvals.filter(a => a.id !== id);
    // TODO: Send approval to backend
  }
  
  function reject(id: string) {
    approvals = approvals.filter(a => a.id !== id);
    // TODO: Send rejection to backend
  }
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h2 class="text-lg font-semibold">Pending Approvals</h2>
    <span class="px-3 py-1 bg-yellow-500/20 text-yellow-400 rounded-full text-sm">
      {approvals.length} pending
    </span>
  </div>
  
  {#if approvals.length === 0}
    <div class="bg-slate-800 rounded-lg border border-slate-700 p-12 text-center">
      <div class="text-4xl mb-4">✅</div>
      <div class="text-lg font-medium">All caught up!</div>
      <div class="text-slate-400">No pending approvals</div>
    </div>
  {:else}
    <div class="space-y-4">
      {#each approvals as approval}
        <div class="bg-slate-800 rounded-lg border-l-4 {priorityColors[approval.priority]} p-4">
          <div class="flex items-start justify-between mb-3">
            <div class="flex items-center gap-2">
              <span>{priorityIcons[approval.priority]}</span>
              <span class="font-medium uppercase text-xs text-slate-400">{approval.priority} priority</span>
              <span class="text-xs text-slate-500">• {approval.time}</span>
            </div>
          </div>
          
          <div class="mb-3">
            <div class="text-sm text-slate-400 mb-1">Agent: <span class="text-slate-200">{approval.agent}</span></div>
            <div class="text-sm text-slate-400 mb-1">Action: <span class="text-slate-200">{approval.action}</span></div>
            <div class="mt-2 p-3 bg-slate-900 rounded font-mono text-sm text-slate-300">
              {approval.details}
            </div>
          </div>
          
          <div class="flex gap-2">
            <button 
              on:click={() => approve(approval.id)}
              class="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium transition-colors"
            >
              Approve
            </button>
            <button 
              on:click={() => reject(approval.id)}
              class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium transition-colors"
            >
              Reject
            </button>
            <button class="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-sm font-medium transition-colors">
              View Context
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
