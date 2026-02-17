<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
  
  // Register Chart.js components
  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
  
  export let labels: string[] = [];
  export let data: number[] = [];
  export let colors: string[] = [];
  export let title: string = '';
  export let horizontal: boolean = true;
  
  let canvas: HTMLCanvasElement;
  let chart: Chart | null = null;
  
  function createChart() {
    if (!canvas || data.length === 0) return;
    
    // Destroy existing chart
    if (chart) {
      chart.destroy();
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: '#1e293b', // slate-800
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: '#0f172a', // slate-900
            titleColor: '#f1f5f9', // slate-100
            bodyColor: '#cbd5e1', // slate-300
            borderColor: '#334155', // slate-700
            borderWidth: 1,
            padding: 12,
            displayColors: false,
          },
        },
        scales: {
          x: {
            grid: {
              color: '#334155', // slate-700
            },
            ticks: {
              color: '#94a3b8', // slate-400
            },
          },
          y: {
            grid: {
              color: '#334155', // slate-700
            },
            ticks: {
              color: '#94a3b8', // slate-400
            },
          },
        },
      },
    });
  }
  
  onMount(() => {
    createChart();
  });
  
  onDestroy(() => {
    if (chart) {
      chart.destroy();
    }
  });
  
  // Recreate chart when data changes
  $: if (canvas && (labels.length > 0 || data.length > 0 || colors.length > 0)) {
    createChart();
  }
</script>

<div class="w-full h-full">
  {#if title}
    <h3 class="text-sm font-medium text-slate-300 mb-3 text-center">{title}</h3>
  {/if}
  <div class="relative" style="height: 250px;">
    <canvas bind:this={canvas}></canvas>
  </div>
</div>
