<script lang="ts">
  import { onMount } from 'svelte';
  import { getBackendBase } from '$lib/config';

  const API_BASE = getBackendBase();

  // ── Types ──────────────────────────────────────────────────────────────────

  interface ToolEntry {
    name: string;
    url: string;
    username: string;
    password: string;
    purpose: string;
  }

  interface CompanyProfile {
    companyName: string;
    industry: string;
    whatYouDo: string;
    targetCustomers: string;
    missionValues: string;
    websiteUrl: string;
    teamSize: string;
    goalsAndChallenges: string;
    tools: ToolEntry[];
  }

  interface AgentTraining {
    instructions: string;
    tools: ToolEntry[];
  }

  interface RosterAgent {
    id: string;
    name: string;
    emoji: string;
    fullName: string;
    model: string;
    status: string;
  }

  interface UploadedFile {
    name: string;
    path: string;
    size: number;
  }

  type FileMap = Record<string, UploadedFile[]>;

  // ── State: Company ─────────────────────────────────────────────────────────

  let company: CompanyProfile = {
    companyName: '',
    industry: '',
    whatYouDo: '',
    targetCustomers: '',
    missionValues: '',
    websiteUrl: '',
    teamSize: '',
    goalsAndChallenges: '',
    tools: [],
  };

  let companySaving = false;
  let companySaveMsg = '';
  let companyLoading = true;

  // ── State: Files ───────────────────────────────────────────────────────────

  let files: FileMap = {};
  let uploadingCategory = '';
  let uploadProgress = '';

  // ── State: Agents ─────────────────────────────────────────────────────────

  let agents: RosterAgent[] = [];
  let agentsLoading = true;
  let agentTraining: Record<string, AgentTraining> = {};
  let agentSaving: Record<string, boolean> = {};
  let agentSaveMsg: Record<string, string> = {};
  let expandedAgents: Record<string, boolean> = {};
  let agentUploading: Record<string, boolean> = {};

  // ── Helpers ────────────────────────────────────────────────────────────────

  function newTool(): ToolEntry {
    return { name: '', url: '', username: '', password: '', purpose: '' };
  }

  function addCompanyTool() {
    company.tools = [...company.tools, newTool()];
  }

  function removeCompanyTool(i: number) {
    company.tools = company.tools.filter((_, idx) => idx !== i);
  }

  function addAgentTool(agentId: string) {
    if (!agentTraining[agentId]) agentTraining[agentId] = { instructions: '', tools: [] };
    agentTraining[agentId].tools = [...agentTraining[agentId].tools, newTool()];
    agentTraining = { ...agentTraining };
  }

  function removeAgentTool(agentId: string, i: number) {
    agentTraining[agentId].tools = agentTraining[agentId].tools.filter((_, idx) => idx !== i);
    agentTraining = { ...agentTraining };
  }

  function toggleAgent(agentId: string) {
    expandedAgents = { ...expandedAgents, [agentId]: !expandedAgents[agentId] };
    // Load training data on first expand
    if (expandedAgents[agentId] && !agentTraining[agentId]) {
      loadAgentTraining(agentId);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── API Calls ──────────────────────────────────────────────────────────────

  async function loadCompany() {
    companyLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/company`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        company = { ...company, ...data };
        if (!Array.isArray(company.tools)) company.tools = [];
      }
    } catch (e) {
      console.error('Failed to load company profile', e);
    } finally {
      companyLoading = false;
    }
  }

  async function saveCompany() {
    companySaving = true;
    companySaveMsg = '';
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/company`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(company),
      });
      companySaveMsg = res.ok ? '✅ Saved successfully' : '❌ Failed to save';
    } catch {
      companySaveMsg = '❌ Network error';
    } finally {
      companySaving = false;
      setTimeout(() => (companySaveMsg = ''), 3000);
    }
  }

  async function loadAgents() {
    agentsLoading = true;
    try {
      const res = await fetch(`${API_BASE}/api/agents/roster`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        agents = data.agents || [];
      }
    } catch (e) {
      console.error('Failed to load agents', e);
    } finally {
      agentsLoading = false;
    }
  }

  async function loadAgentTraining(agentId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/agent/${encodeURIComponent(agentId)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        agentTraining[agentId] = {
          instructions: data.instructions || '',
          tools: Array.isArray(data.tools) ? data.tools : [],
        };
        agentTraining = { ...agentTraining };
      }
    } catch (e) {
      console.error('Failed to load agent training', e);
    }
  }

  async function saveAgentTraining(agentId: string) {
    agentSaving[agentId] = true;
    agentSaveMsg[agentId] = '';
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/agent/${encodeURIComponent(agentId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(agentTraining[agentId] || { instructions: '', tools: [] }),
      });
      agentSaveMsg[agentId] = res.ok ? '✅ Saved' : '❌ Failed';
    } catch {
      agentSaveMsg[agentId] = '❌ Network error';
    } finally {
      agentSaving[agentId] = false;
      setTimeout(() => {
        agentSaveMsg[agentId] = '';
        agentSaveMsg = { ...agentSaveMsg };
      }, 3000);
    }
  }

  async function loadFiles() {
    try {
      const res = await fetch(`${API_BASE}/api/onboarding/files`, { credentials: 'include' });
      if (res.ok) {
        files = await res.json();
      }
    } catch (e) {
      console.error('Failed to load files', e);
    }
  }

  async function uploadFile(category: string, agentId?: string, inputEl?: HTMLInputElement) {
    const fileInput = inputEl;
    if (!fileInput?.files?.length) return;

    uploadingCategory = agentId ? `agent:${agentId}` : category;
    if (agentId) agentUploading[agentId] = true;
    uploadProgress = 'Uploading...';

    try {
      const formData = new FormData();
      formData.append('category', agentId ? 'agent' : category);
      if (agentId) formData.append('agentId', agentId);
      formData.append('file', fileInput.files[0]);

      const res = await fetch(`${API_BASE}/api/onboarding/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (res.ok) {
        await loadFiles();
        fileInput.value = '';
        uploadProgress = '✅ Uploaded';
      } else {
        uploadProgress = '❌ Upload failed';
      }
    } catch {
      uploadProgress = '❌ Upload error';
    } finally {
      uploadingCategory = '';
      if (agentId) agentUploading[agentId] = false;
      setTimeout(() => (uploadProgress = ''), 3000);
    }
  }

  async function deleteFile(path: string) {
    if (!confirm(`Delete ${path}?`)) return;
    try {
      const encoded = encodeURIComponent(path);
      const res = await fetch(`${API_BASE}/api/onboarding/files/${encoded}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        await loadFiles();
      }
    } catch (e) {
      console.error('Failed to delete file', e);
    }
  }

  onMount(() => {
    loadCompany();
    loadAgents();
    loadFiles();
  });
</script>

<div class="max-w-4xl space-y-8">
  <div class="flex items-center gap-3">
    <span class="text-3xl">📚</span>
    <div>
      <h1 class="text-2xl font-bold">Onboarding & Training</h1>
      <p class="text-sm text-slate-400 mt-0.5">Set up your company knowledge base and train your AI team</p>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════════
       SECTION 1: COMPANY KNOWLEDGE
       ══════════════════════════════════════════════════════════════════════ -->
  <section>
    <div class="flex items-center gap-2 mb-4">
      <span class="text-xl">🏢</span>
      <h2 class="text-lg font-semibold">Company Knowledge</h2>
      <span class="text-xs text-slate-500 ml-1">— shared context for all agents</span>
    </div>

    {#if companyLoading}
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center text-slate-400">
        Loading company profile...
      </div>
    {:else}
      <div class="bg-slate-800 border border-slate-700 rounded-lg divide-y divide-slate-700">

        <!-- Basic Info -->
        <div class="p-6 space-y-4">
          <h3 class="font-medium text-slate-200 mb-4">Basic Info</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-1">Company Name</label>
              <input
                bind:value={company.companyName}
                type="text"
                placeholder="Acme Corp"
                class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-1">Industry</label>
              <input
                bind:value={company.industry}
                type="text"
                placeholder="e.g. SaaS, E-commerce, Healthcare"
                class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-1">Website URL</label>
              <input
                bind:value={company.websiteUrl}
                type="url"
                placeholder="https://example.com"
                class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-300 mb-1">Team Size</label>
              <input
                bind:value={company.teamSize}
                type="text"
                placeholder="e.g. 5-10 people"
                class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        <!-- What You Do -->
        <div class="p-6 space-y-4">
          <h3 class="font-medium text-slate-200 mb-2">About the Business</h3>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">What you do / Products & Services</label>
            <textarea
              bind:value={company.whatYouDo}
              rows="4"
              placeholder="Describe your products and services in detail..."
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            ></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Target Customers</label>
            <textarea
              bind:value={company.targetCustomers}
              rows="3"
              placeholder="Who are your ideal customers? What problems do you solve for them?"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            ></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Mission / Values</label>
            <textarea
              bind:value={company.missionValues}
              rows="3"
              placeholder="What does your company stand for? What's your mission?"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            ></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-300 mb-1">Main Goals & Challenges</label>
            <textarea
              bind:value={company.goalsAndChallenges}
              rows="3"
              placeholder="What are your current goals? What challenges are you facing?"
              class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            ></textarea>
          </div>
        </div>

        <!-- General Tools -->
        <div class="p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-medium text-slate-200">General Tools</h3>
            <button
              on:click={addCompanyTool}
              class="px-3 py-1.5 text-sm text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors"
            >
              + Add Tool
            </button>
          </div>

          {#if company.tools.length === 0}
            <p class="text-sm text-slate-500 italic">No tools added yet. Click "Add Tool" to add software your team uses.</p>
          {:else}
            <div class="space-y-3">
              {#each company.tools as tool, i}
                <div class="bg-slate-900 border border-slate-700 rounded-lg p-3">
                  <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <input
                      bind:value={tool.name}
                      type="text"
                      placeholder="Tool name"
                      class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      bind:value={tool.url}
                      type="text"
                      placeholder="URL"
                      class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      bind:value={tool.username}
                      type="text"
                      placeholder="Username"
                      class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      bind:value={tool.password}
                      type="text"
                      placeholder="Password"
                      class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500"
                    />
                    <div class="flex gap-2">
                      <input
                        bind:value={tool.purpose}
                        type="text"
                        placeholder="What it's for"
                        class="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-sm focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        on:click={() => removeCompanyTool(i)}
                        class="p-1.5 text-red-400 hover:bg-red-500/10 rounded transition-colors flex-shrink-0"
                        title="Remove tool"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- File Uploads -->
        <div class="p-6">
          <h3 class="font-medium text-slate-200 mb-4">Company Documents</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            {#each [
              { key: 'handbook', label: '📋 Employee Handbook', desc: 'Company handbook, policies, procedures' },
              { key: 'brand', label: '🎨 Brand Guide', desc: 'Logo, colors, style guidelines' },
              { key: 'training', label: '📖 Training Materials', desc: 'General training docs for all staff' },
            ] as cat}
              <div class="bg-slate-900 border border-slate-700 rounded-lg p-4">
                <div class="font-medium text-sm mb-1">{cat.label}</div>
                <div class="text-xs text-slate-500 mb-3">{cat.desc}</div>

                <!-- Existing files -->
                {#if files[cat.key]?.length > 0}
                  <div class="space-y-1 mb-3">
                    {#each files[cat.key] as f}
                      <div class="flex items-center justify-between text-xs bg-slate-800 rounded px-2 py-1">
                        <span class="truncate text-slate-300 flex-1 mr-2">{f.name}</span>
                        <span class="text-slate-500 mr-2 flex-shrink-0">{formatSize(f.size)}</span>
                        <button
                          on:click={() => deleteFile(f.path)}
                          class="text-red-400 hover:text-red-300 flex-shrink-0"
                          title="Delete"
                        >✕</button>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="text-xs text-slate-600 mb-3 italic">No files uploaded</p>
                {/if}

                <!-- Upload -->
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="file"
                    class="hidden"
                    on:change={(e) => uploadFile(cat.key, undefined, e.currentTarget)}
                  />
                  <span class="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">
                    {uploadingCategory === cat.key ? 'Uploading...' : '↑ Upload'}
                  </span>
                  {#if uploadingCategory === cat.key && uploadProgress}
                    <span class="text-xs text-slate-400">{uploadProgress}</span>
                  {/if}
                </label>
              </div>
            {/each}
          </div>
        </div>

        <!-- Save Button -->
        <div class="p-6 flex items-center justify-end gap-3">
          {#if companySaveMsg}
            <span class="text-sm {companySaveMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}">{companySaveMsg}</span>
          {/if}
          <button
            on:click={saveCompany}
            disabled={companySaving}
            class="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-medium transition-colors"
          >
            {companySaving ? 'Saving...' : 'Save Company Profile'}
          </button>
        </div>
      </div>
    {/if}
  </section>

  <!-- ═══════════════════════════════════════════════════════════════════════
       SECTION 2: EMPLOYEE TRAINING
       ══════════════════════════════════════════════════════════════════════ -->
  <section>
    <div class="flex items-center gap-2 mb-4">
      <span class="text-xl">👩‍💼</span>
      <h2 class="text-lg font-semibold">Employee Training</h2>
      <span class="text-xs text-slate-500 ml-1">— role-specific instructions for each agent</span>
    </div>

    {#if agentsLoading}
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center text-slate-400">
        Loading agents...
      </div>
    {:else if agents.length === 0}
      <div class="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center">
        <p class="text-slate-400">No agents found. Add agents in the <a href="/roster" class="text-blue-400 underline">Roster</a> first.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each agents as agent}
          {@const isExpanded = expandedAgents[agent.id]}
          {@const training = agentTraining[agent.id] || { instructions: '', tools: [] }}
          {@const agentFiles = files[`agent:${agent.id}`] || []}

          <div class="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
            <!-- Agent Card Header (clickable to expand) -->
            <button
              class="w-full flex items-center justify-between p-4 hover:bg-slate-700/50 transition-colors text-left"
              on:click={() => toggleAgent(agent.id)}
            >
              <div class="flex items-center gap-3">
                <span class="text-2xl">{agent.emoji || '🤖'}</span>
                <div>
                  <div class="font-medium">{agent.name}</div>
                  <div class="text-sm text-slate-400">{agent.fullName || agent.id}</div>
                </div>
              </div>
              <div class="flex items-center gap-3">
                {#if training.instructions}
                  <span class="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">Trained</span>
                {:else}
                  <span class="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded-full">Not configured</span>
                {/if}
                <span class="text-slate-400 text-lg transition-transform {isExpanded ? 'rotate-180' : ''}">▾</span>
              </div>
            </button>

            <!-- Expanded Training Form -->
            {#if isExpanded}
              <div class="border-t border-slate-700 divide-y divide-slate-700">

                <!-- Role Instructions -->
                <div class="p-5">
                  <label class="block text-sm font-medium text-slate-300 mb-2">
                    Role-Specific Instructions
                    <span class="text-slate-500 font-normal ml-1">— What should {agent.name} know about their job here?</span>
                  </label>
                  <textarea
                    value={training.instructions}
                    rows="6"
                    placeholder="Describe this agent's specific responsibilities, style, priorities, and anything they need to know to do their job well at your company..."
                    class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                    on:input={(e) => {
                      if (!agentTraining[agent.id]) agentTraining[agent.id] = { instructions: '', tools: [] };
                      agentTraining[agent.id].instructions = e.currentTarget.value;
                      agentTraining = { ...agentTraining };
                    }}
                  ></textarea>
                </div>

                <!-- Role-Specific Tools -->
                <div class="p-5">
                  <div class="flex items-center justify-between mb-3">
                    <h4 class="font-medium text-sm text-slate-300">Role-Specific Tools</h4>
                    <button
                      on:click={() => addAgentTool(agent.id)}
                      class="px-3 py-1 text-xs text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg transition-colors"
                    >
                      + Add Tool
                    </button>
                  </div>

                  {#if !training.tools?.length}
                    <p class="text-xs text-slate-500 italic">No role-specific tools yet.</p>
                  {:else}
                    <div class="space-y-2">
                      {#each training.tools as tool, i}
                        <div class="bg-slate-900 border border-slate-700 rounded-lg p-2">
                          <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
                            <input
                              bind:value={tool.name}
                              type="text"
                              placeholder="Tool name"
                              class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs focus:ring-1 focus:ring-blue-500"
                            />
                            <input
                              bind:value={tool.url}
                              type="text"
                              placeholder="URL"
                              class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs focus:ring-1 focus:ring-blue-500"
                            />
                            <input
                              bind:value={tool.username}
                              type="text"
                              placeholder="Username"
                              class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs focus:ring-1 focus:ring-blue-500"
                            />
                            <input
                              bind:value={tool.password}
                              type="text"
                              placeholder="Password"
                              class="px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs focus:ring-1 focus:ring-blue-500"
                            />
                            <div class="flex gap-2">
                              <input
                                bind:value={tool.purpose}
                                type="text"
                                placeholder="What it's for"
                                class="flex-1 px-2 py-1.5 bg-slate-800 border border-slate-600 rounded text-xs focus:ring-1 focus:ring-blue-500"
                              />
                              <button
                                on:click={() => removeAgentTool(agent.id, i)}
                                class="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors flex-shrink-0"
                              >✕</button>
                            </div>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- Agent File Uploads -->
                <div class="p-5">
                  <h4 class="font-medium text-sm text-slate-300 mb-3">Training Materials</h4>

                  {#if agentFiles.length > 0}
                    <div class="space-y-1 mb-3">
                      {#each agentFiles as f}
                        <div class="flex items-center justify-between text-xs bg-slate-900 rounded px-2 py-1.5">
                          <span class="truncate text-slate-300 flex-1 mr-2">{f.name}</span>
                          <span class="text-slate-500 mr-2 flex-shrink-0">{formatSize(f.size)}</span>
                          <button
                            on:click={() => deleteFile(f.path)}
                            class="text-red-400 hover:text-red-300 flex-shrink-0"
                          >✕</button>
                        </div>
                      {/each}
                    </div>
                  {:else}
                    <p class="text-xs text-slate-600 mb-3 italic">No files uploaded for {agent.name}</p>
                  {/if}

                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="file"
                      class="hidden"
                      on:change={(e) => uploadFile('agent', agent.id, e.currentTarget)}
                    />
                    <span class="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors">
                      {agentUploading[agent.id] ? 'Uploading...' : '↑ Upload File'}
                    </span>
                  </label>
                </div>

                <!-- Save Agent Button -->
                <div class="p-5 flex items-center justify-end gap-3 bg-slate-800/50">
                  {#if agentSaveMsg[agent.id]}
                    <span class="text-sm {agentSaveMsg[agent.id]?.startsWith('✅') ? 'text-green-400' : 'text-red-400'}">
                      {agentSaveMsg[agent.id]}
                    </span>
                  {/if}
                  <button
                    on:click={() => saveAgentTraining(agent.id)}
                    disabled={agentSaving[agent.id]}
                    class="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
                  >
                    {agentSaving[agent.id] ? 'Saving...' : `Save ${agent.name}'s Training`}
                  </button>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
</div>
