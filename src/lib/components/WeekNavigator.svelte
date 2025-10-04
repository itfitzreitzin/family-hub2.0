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
    padding: 1rem;
    background: #f7fafc;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }
  
  .current-badge {
    background: #48bb78;
    color: white;
    padding: 0.25rem 0.5rem;
    border-radius: 9999px;
    font-size: 0.8rem;
    margin-left: 0.5rem;
  }
</style>

