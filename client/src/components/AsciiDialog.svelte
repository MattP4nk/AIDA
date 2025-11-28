<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { createEventDispatcher } from "svelte";

  // ==================== PROPS ====================

  export let title: string = "DIALOG";
  export let width: number = 80; // Characters
  export let height: number = 24; // Lines
  export let visible: boolean = false;
  export let closeable: boolean = true;
  export let showFooter: boolean = true;

  // ==================== EVENTS ====================

  const dispatch = createEventDispatcher();

  // ==================== STATE ====================

  let dialogElement: HTMLDivElement;

  // ==================== LIFECYCLE ====================

  onMount(() => {
    if (visible) {
      trapFocus();
    }
  });

  onDestroy(() => {
    // Cleanup
  });

  // ==================== FUNCTIONS ====================

  function close() {
    if (!closeable) return;
    dispatch("close");
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!visible) return;

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        event.preventDefault();
        handleTabKey(event.shiftKey);
        break;
    }
  }

  function handleTabKey(reverse: boolean) {
    if (!dialogElement) return;

    const focusableElements = dialogElement.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    const focusableArray = Array.from(focusableElements) as HTMLElement[];
    const currentIndex = focusableArray.indexOf(
      document.activeElement as HTMLElement
    );

    let nextIndex: number;
    if (reverse) {
      nextIndex =
        currentIndex <= 0 ? focusableArray.length - 1 : currentIndex - 1;
    } else {
      nextIndex =
        currentIndex >= focusableArray.length - 1 ? 0 : currentIndex + 1;
    }

    focusableArray[nextIndex]?.focus();
  }

  function trapFocus() {
    if (!dialogElement) return;

    const focusableElements = dialogElement.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length > 0) {
      (focusableElements[0] as HTMLElement).focus();
    }
  }

  function handleOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget && closeable) {
      close();
    }
  }

  // ==================== REACTIVE ====================

  $: if (visible && dialogElement) {
    trapFocus();
  }

  // ==================== ASCII BORDER GENERATION ====================

  function generateTopBorder(): string {
    const innerWidth = width - 2;
    return `╔${"═".repeat(innerWidth)}╗`;
  }

  function generateBottomBorder(): string {
    const innerWidth = width - 2;
    return `╚${"═".repeat(innerWidth)}╝`;
  }

  function generateDivider(): string {
    const innerWidth = width - 2;
    return `╠${"═".repeat(innerWidth)}╣`;
  }

  function padLine(text: string): string {
    const innerWidth = width - 2;
    const padding = innerWidth - text.length;
    return `║${text}${" ".repeat(Math.max(0, padding))}║`;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if visible}
  <div
    class="ascii-dialog-overlay"
    on:click={handleOverlayClick}
    role="presentation"
  >
    <div
      bind:this={dialogElement}
      class="ascii-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      style="--dialog-width: {width}ch; --dialog-height: {height}em;"
    >
      <!-- Top Border -->
      <div class="ascii-border-line">{generateTopBorder()}</div>

      <!-- Header -->
      <div class="ascii-header">
        <div class="ascii-border-line" id="dialog-title">
          {padLine(`${title}${closeable ? " ".repeat(width - title.length - 8) + "[X]" : ""}`)}
        </div>
        <div class="ascii-border-line">{generateDivider()}</div>
      </div>

      <!-- Content -->
      <div class="ascii-content">
        <slot />
      </div>

      <!-- Footer (optional) -->
      {#if showFooter && $$slots.footer}
        <div class="ascii-footer">
          <div class="ascii-border-line">{generateDivider()}</div>
          <div class="ascii-footer-content">
            <slot name="footer" />
          </div>
        </div>
      {/if}

      <!-- Bottom Border -->
      <div class="ascii-border-line">{generateBottomBorder()}</div>

      <!-- Scanline Effect -->
      <div class="scanline-effect" aria-hidden="true"></div>
    </div>
  </div>
{/if}

<style>
  /* ==================== OVERLAY ==================== */

  .ascii-dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 20, 0, 0.85);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* ==================== DIALOG CONTAINER ==================== */

  .ascii-dialog {
    position: relative;
    font-family: "IBM Plex Mono", "Courier New", monospace;
    font-size: 14px;
    line-height: 1.5;
    color: #00ff00;
    background: #000000;
    border: 2px solid #00ff00;
    box-shadow: 0 0 30px rgba(0, 255, 0, 0.6), inset 0 0 20px rgba(0, 255, 0, 0.1);
    max-width: 95vw;
    max-height: 90vh;
    width: var(--dialog-width, 80ch);
    min-height: 300px;
    animation: dialogSlideIn 0.2s ease-out;
    overflow: hidden;
  }

  @keyframes dialogSlideIn {
    from {
      opacity: 0;
      transform: translateY(-20px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ==================== BORDER LINES ==================== */

  .ascii-border-line {
    font-family: "IBM Plex Mono", "Courier New", monospace;
    white-space: pre;
    color: #00ff00;
    user-select: none;
    letter-spacing: 0;
  }

  /* ==================== HEADER ==================== */

  .ascii-header {
    background: rgba(0, 51, 0, 0.3);
  }

  #dialog-title {
    font-weight: bold;
    text-transform: uppercase;
  }

  /* ==================== CONTENT ==================== */

  .ascii-content {
    padding: 0;
    overflow-y: auto;
    overflow-x: hidden;
    max-height: calc(90vh - 200px);
    scrollbar-width: thin;
    scrollbar-color: #00ff00 #002200;
  }

  .ascii-content::-webkit-scrollbar {
    width: 8px;
  }

  .ascii-content::-webkit-scrollbar-track {
    background: #002200;
  }

  .ascii-content::-webkit-scrollbar-thumb {
    background: #00ff00;
    border-radius: 4px;
  }

  .ascii-content::-webkit-scrollbar-thumb:hover {
    background: #00ff00;
  }

  /* ==================== FOOTER ==================== */

  .ascii-footer {
    background: rgba(0, 51, 0, 0.2);
  }

  .ascii-footer-content {
    padding: 0.5em 1em;
  }

  /* ==================== SCANLINE EFFECT ==================== */

  .scanline-effect {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 255, 0, 0.03),
      rgba(0, 255, 0, 0.03) 1px,
      transparent 1px,
      transparent 2px
    );
    pointer-events: none;
    z-index: 1;
  }

  /* ==================== RESPONSIVE ==================== */

  @media (max-width: 768px) {
    .ascii-dialog {
      font-size: 12px;
      max-width: 98vw;
      max-height: 95vh;
    }

    .ascii-content {
      max-height: calc(95vh - 180px);
    }
  }

  /* ==================== ACCESSIBILITY ==================== */

  .ascii-dialog:focus {
    outline: 2px solid #00ff00;
    outline-offset: 4px;
  }

  /* ==================== GLOW EFFECT ==================== */

  @keyframes glow {
    0%,
    100% {
      box-shadow: 0 0 30px rgba(0, 255, 0, 0.6),
        inset 0 0 20px rgba(0, 255, 0, 0.1);
    }
    50% {
      box-shadow: 0 0 40px rgba(0, 255, 0, 0.8),
        inset 0 0 25px rgba(0, 255, 0, 0.15);
    }
  }

  .ascii-dialog {
    animation: dialogSlideIn 0.2s ease-out, glow 3s ease-in-out infinite;
  }
</style>
