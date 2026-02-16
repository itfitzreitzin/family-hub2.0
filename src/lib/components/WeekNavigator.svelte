<script>
  import { createEventDispatcher } from 'svelte';
  
  export let currentWeek = new Date();
  
  const dispatch = createEventDispatcher();
  
  function changeWeek(direction) {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(newWeek.getDate() + (direction * 7));
    dispatch('weekChange', newWeek);
  }
  
  function formatWeek(date) {
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    
    return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;
  }
  
  $: isCurrentWeek = () => {
    const now = new Date();
    const weekStart = new Date(currentWeek);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const nowStart = new Date(now);
    nowStart.setDate(nowStart.getDate() - nowStart.getDay());
    
    return weekStart.toDateString() === nowStart.toDateString();
  };
</script>

<div class="week-navigator">
  <button on:click={() => changeWeek(-1)}>← Previous</button>
  <div class="week-display">
    <span>{formatWeek(currentWeek)}</span>
    {#if isCurrentWeek()}
      <span class="current-badge">Current Week</span>
    {/if}
  </div>
  <button on:click={() => changeWeek(1)}>Next →</button>
</div>

<style>
  .week-navigator {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1rem;
    background: var(--surface-sunken, #eef1f8);
    border-radius: 12px;
    margin-bottom: 1rem;
    border: 1px solid rgba(0, 0, 0, 0.04);
  }

  .week-navigator button {
    padding: 6px 14px;
    background: var(--surface-card, white);
    border: 1.5px solid var(--color-gray-200, #e2e8f0);
    border-radius: 8px;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.85em;
    color: var(--color-gray-700, #4a5568);
    transition: all 0.2s;
  }

  .week-navigator button:hover {
    border-color: var(--color-primary, #667eea);
    color: var(--color-primary, #667eea);
  }

  .week-display {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 500;
    color: var(--color-gray-800, #2d3748);
    font-size: 0.9em;
  }

  .current-badge {
    background: linear-gradient(135deg, #48bb78, #38a169);
    color: white;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 600;
    box-shadow: 0 2px 6px rgba(72, 187, 120, 0.25);
  }
</style>

