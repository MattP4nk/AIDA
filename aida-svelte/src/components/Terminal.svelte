<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    outputLines,
    prompt,
    addOutput,
    addToHistory,
    navigateHistory
  } from '../stores/gameState';
  import { CommandRegistry } from '../commands/CommandRegistry';
  import { registerCommands } from '../commands/commands';
  import { initializeGame } from '../data/initializeGame';

  let inputValue = '';
  let inputElement: HTMLInputElement;
  let outputElement: HTMLDivElement;
  let commandRegistry: CommandRegistry;

  const WELCOME_MESSAGE =
    'Initializing NLT... \nSCANNING IRIS...\nNO MATCH FOUND...\nNETWORK ACCESS RESTRICTED';

  onMount(() => {
    // Initialize game
    initializeGame();

    // Set up command registry
    commandRegistry = new CommandRegistry();
    registerCommands(commandRegistry);

    // Show welcome message
    addOutput(WELCOME_MESSAGE);

    // Focus input
    inputElement?.focus();
  });

  // Auto-scroll to bottom when output changes
  $: if ($outputLines.length) {
    tick().then(() => {
      if (outputElement) {
        outputElement.scrollTop = outputElement.scrollHeight;
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Command history navigation
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const historyCommand = navigateHistory('up');
      if (historyCommand !== null) {
        inputValue = historyCommand;
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const historyCommand = navigateHistory('down');
      if (historyCommand !== null) {
        inputValue = historyCommand;
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      handleTabCompletion();
    }
  }

  function handleSubmit(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const input = inputValue.trim();

      // Show command in output
      addOutput($prompt + inputValue);

      if (input) {
        // Add to history
        addToHistory(input);

        // Execute command
        const executed = commandRegistry.execute(input);
        if (!executed) {
          addOutput("Command not found\nType 'help' for a list of commands");
        }
      }

      // Clear input
      inputValue = '';
    }
  }

  function handleTabCompletion() {
    const input = inputValue.trim().toLowerCase();
    if (!input) return;

    const commandNames = commandRegistry.getCommandNames();
    const matches = commandNames.filter(cmd => cmd.startsWith(input));

    if (matches.length === 1) {
      inputValue = matches[0] + ' ';
    } else if (matches.length > 1) {
      addOutput('Possible commands:');
      matches.forEach(match => addOutput(`  ${match}`));
    }
  }

  function focusInput() {
    inputElement?.focus();
  }
</script>

<div class="terminal" on:click={focusInput} on:keydown={focusInput} role="button" tabindex="0">
  <div class="output" bind:this={outputElement}>
    {#each $outputLines as line (line.timestamp)}
      <p class="output-line">{line.text}</p>
    {/each}
  </div>

  <div class="input-line">
    <span class="prompt">{$prompt}</span>
    <input
      type="text"
      bind:this={inputElement}
      bind:value={inputValue}
      on:keydown={handleKeyDown}
      on:keydown={handleSubmit}
      autocomplete="off"
      spellcheck="false"
      class="input"
    />
  </div>
</div>

<style>
  .terminal {
    width: 100%;
    height: 100vh;
    background-color: #000;
    color: #0f0;
    font-family: 'Courier New', Courier, monospace;
    font-size: 1.2rem;
    padding: 1rem;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: text;
  }

  .output {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 0.5rem;
    scrollbar-width: thin;
    scrollbar-color: #0f0 #000;
  }

  .output::-webkit-scrollbar {
    width: 8px;
  }

  .output::-webkit-scrollbar-track {
    background: #000;
  }

  .output::-webkit-scrollbar-thumb {
    background: #0f0;
  }

  .output-line {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
  }

  .input-line {
    display: flex;
    align-items: center;
  }

  .prompt {
    color: #0f0;
    margin-right: 0.5rem;
    white-space: nowrap;
  }

  .input {
    flex: 1;
    background-color: transparent;
    border: none;
    outline: none;
    color: #0f0;
    font-family: 'Courier New', Courier, monospace;
    font-size: 1.2rem;
    padding: 0;
    margin: 0;
  }

  /* Light mode support */
  @media (prefers-color-scheme: light) {
    .terminal {
      background-color: #fff;
      color: #000;
    }

    .prompt,
    .input {
      color: #000;
    }

    .output::-webkit-scrollbar-thumb {
      background: #666;
    }

    .output {
      scrollbar-color: #666 #fff;
    }
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .terminal {
      font-size: 1rem;
      padding: 0.5rem;
    }

    .input {
      font-size: 1rem;
    }
  }
</style>
