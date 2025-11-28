<script lang="ts">
    import { onMount, createEventDispatcher } from "svelte";
    import AsciiDialog from "./AsciiDialog.svelte";
    import { terminalService } from "../services/terminal";

    // ==================== PROPS ====================

    export let visible: boolean = false;
    export let initialData: any = null;

    // ==================== EVENTS ====================

    const dispatch = createEventDispatcher();

    // ==================== TYPES ====================

    interface ForumPost {
        id: string;
        title: string;
        author: string;
        date: string;
        replies: number;
        views: number;
        content?: string;
    }

    type ViewState = "sections" | "threads" | "post";

    // ==================== STATE ====================

    let view: ViewState = "sections";
    let sections: string[] = ["General", "Marketplace", "Hacking", "Intel"];
    let currentSection: string = "";
    let threads: ForumPost[] = [];
    let currentPost: ForumPost | null = null;
    let postReplies: any[] = []; // If we support replies viewing

    let loading: boolean = false;
    let error: string = "";
    let selectedIndex: number = 0;

    // ==================== LIFECYCLE ====================

    onMount(() => {
        if (initialData?.section) {
            loadSection(initialData.section);
        } else if (initialData?.postId) {
            loadPost(initialData.postId);
        } else {
            // Default to sections view
            view = "sections";
        }
    });

    // ==================== NAVIGATION ====================

    function handleKeydown(event: KeyboardEvent) {
        if (!visible) return;

        switch (event.key) {
            case "Escape":
                event.preventDefault();
                if (view === "post") {
                    view = "threads";
                    selectedIndex = 0;
                } else if (view === "threads") {
                    view = "sections";
                    selectedIndex = sections.indexOf(currentSection);
                    currentSection = "";
                } else {
                    close();
                }
                break;
            case "ArrowUp":
                event.preventDefault();
                navigate(-1);
                break;
            case "ArrowDown":
                event.preventDefault();
                navigate(1);
                break;
            case "Enter":
                event.preventDefault();
                selectCurrent();
                break;
        }
    }

    function navigate(direction: number) {
        if (view === "sections") {
            selectedIndex = (selectedIndex + direction + sections.length) % sections.length;
        } else if (view === "threads") {
            if (threads.length === 0) return;
            selectedIndex = (selectedIndex + direction + threads.length) % threads.length;
        }
        // Post view scrolling handled natively by div overflow
    }

    function selectCurrent() {
        if (view === "sections") {
            loadSection(sections[selectedIndex]);
        } else if (view === "threads") {
            if (threads[selectedIndex]) {
                loadPost(threads[selectedIndex].id);
            }
        }
    }

    // ==================== DATA LOADING ====================

    async function loadSection(section: string) {
        loading = true;
        error = "";
        currentSection = section;
        
        try {
            const response = await terminalService.executeCommand(`forum ${section}`);
            if (response.success && response.data?.posts) {
                threads = response.data.posts.map((p: any) => ({
                    id: p.id,
                    title: p.title,
                    author: p.author,
                    date: new Date(p.createdAt).toLocaleDateString(),
                    replies: p._count?.replies || 0,
                    views: p.views || 0
                }));
                view = "threads";
                selectedIndex = 0;
            } else {
                error = "Failed to load section";
            }
        } catch (err) {
            error = "Error loading section";
            console.error(err);
        } finally {
            loading = false;
        }
    }

    async function loadPost(postId: string) {
        loading = true;
        error = "";
        
        try {
            const response = await terminalService.executeCommand(`forum read ${postId}`);
            if (response.success && response.data?.post) {
                const p = response.data.post;
                currentPost = {
                    id: p.id,
                    title: p.title,
                    author: p.author.username,
                    date: new Date(p.createdAt).toLocaleString(),
                    replies: p.replies?.length || 0,
                    views: p.views,
                    content: p.content
                };
                postReplies = p.replies || [];
                view = "post";
            } else {
                error = "Failed to load post";
            }
        } catch (err) {
            error = "Error loading post";
            console.error(err);
        } finally {
            loading = false;
        }
    }

    function close() {
        dispatch("close");
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<AsciiDialog {visible} title="FORUM" width={90} height={28} on:close={close}>
    <div class="forum-container">
        {#if loading}
            <div class="loading">
                <pre>
╔═════════════════════════════════════════════════╗
║                                                 ║
║           ACCESSING FORUM NETWORK...            ║
║                                                 ║
║              [████████░░░░░░░░]                 ║
║                                                 ║
╚═════════════════════════════════════════════════╝
                </pre>
            </div>
        {:else if error}
            <div class="error-message">
                <pre>
╔═══════════════════════════════════════════════════╗
║  ⚠️  ERROR                                        ║
╠═══════════════════════════════════════════════════╣
║  {error.padEnd(48)}║
╚═══════════════════════════════════════════════════╝
                </pre>
                <div class="error-hint">Press ESC to go back</div>
            </div>
        {:else}
            <!-- BREADCRUMBS -->
            <div class="breadcrumbs">
                <span class:active={view === "sections"}>ROOT</span>
                {#if currentSection}
                    <span class="separator">></span>
                    <span class:active={view === "threads"}>{currentSection.toUpperCase()}</span>
                {/if}
                {#if currentPost}
                    <span class="separator">></span>
                    <span class:active={view === "post"}>POST</span>
                {/if}
            </div>
            
            <div class="divider">{"═".repeat(88)}</div>

            <!-- SECTIONS VIEW -->
            {#if view === "sections"}
                <div class="list-view">
                    <div class="list-header">
                        <span class="col-name">SECTION NAME</span>
                        <span class="col-status">STATUS</span>
                    </div>
                    {#each sections as section, i}
                        <div 
                            class="list-item" 
                            class:selected={i === selectedIndex}
                            on:click={() => loadSection(section)}
                        >
                            <span class="col-name">[{section}]</span>
                            <span class="col-status">ONLINE</span>
                        </div>
                    {/each}
                </div>

            <!-- THREADS VIEW -->
            {:else if view === "threads"}
                <div class="list-view">
                    {#if threads.length === 0}
                        <div class="empty-state">No threads in this section.</div>
                    {:else}
                        <div class="list-header">
                            <span class="col-title">TOPIC</span>
                            <span class="col-author">AUTHOR</span>
                            <span class="col-stats">REPLIES</span>
                        </div>
                        {#each threads as thread, i}
                            <div 
                                class="list-item" 
                                class:selected={i === selectedIndex}
                                on:click={() => loadPost(thread.id)}
                            >
                                <span class="col-title">{thread.title}</span>
                                <span class="col-author">{thread.author}</span>
                                <span class="col-stats">{thread.replies}</span>
                            </div>
                        {/each}
                    {/if}
                </div>

            <!-- POST VIEW -->
            {:else if view === "post" && currentPost}
                <div class="post-view">
                    <div class="post-header">
                        <div class="post-title">{currentPost.title}</div>
                        <div class="post-meta">
                            By: {currentPost.author} | {currentPost.date}
                        </div>
                    </div>
                    <div class="divider-dashed">{"-".repeat(88)}</div>
                    <div class="post-content">
                        {currentPost.content}
                    </div>
                    
                    {#if postReplies.length > 0}
                        <div class="replies-section">
                            <div class="replies-header">REPLIES ({postReplies.length})</div>
                            {#each postReplies as reply}
                                <div class="reply-item">
                                    <div class="reply-meta">{reply.author.username} says:</div>
                                    <div class="reply-content">{reply.content}</div>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        {/if}
    </div>

    <div slot="footer" class="footer-help">
        <pre>
║ [↑/↓] Navigate  [ENTER] Select  [ESC] Back/Close                                  ║
        </pre>
    </div>
</AsciiDialog>

<style>
    .forum-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        font-family: "IBM Plex Mono", monospace;
        color: #00ff00;
    }

    .loading, .error-message {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .error-hint {
        margin-top: 1em;
        color: #008800;
    }

    .breadcrumbs {
        padding: 0.5em 1em;
        font-weight: bold;
    }

    .separator {
        margin: 0 0.5em;
        color: #008800;
    }

    .active {
        color: #ffff00;
        text-decoration: underline;
    }

    .divider {
        color: #004400;
        line-height: 1;
        overflow: hidden;
    }

    .divider-dashed {
        color: #004400;
        margin: 0.5em 0;
    }

    /* LIST VIEW */
    .list-view {
        flex: 1;
        overflow-y: auto;
        padding: 0.5em 0;
    }

    .list-header {
        display: flex;
        padding: 0.5em 1em;
        color: #008800;
        border-bottom: 1px solid #004400;
        margin-bottom: 0.5em;
    }

    .list-item {
        display: flex;
        padding: 0.3em 1em;
        cursor: pointer;
    }

    .list-item:hover {
        background: rgba(0, 255, 0, 0.1);
    }

    .list-item.selected {
        background: rgba(0, 255, 0, 0.2);
        color: #ffff00;
    }

    .col-name { flex: 1; }
    .col-status { width: 100px; text-align: right; }
    
    .col-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .col-author { width: 150px; }
    .col-stats { width: 80px; text-align: right; }

    /* POST VIEW */
    .post-view {
        flex: 1;
        overflow-y: auto;
        padding: 1em;
    }

    .post-title {
        font-size: 1.2em;
        font-weight: bold;
        color: #ffff00;
        margin-bottom: 0.2em;
    }

    .post-meta {
        color: #008800;
        font-size: 0.9em;
    }

    .post-content {
        white-space: pre-wrap;
        line-height: 1.4;
        margin-bottom: 2em;
    }

    .replies-header {
        color: #008800;
        border-bottom: 1px solid #004400;
        margin-bottom: 1em;
    }

    .reply-item {
        margin-bottom: 1em;
        padding-left: 1em;
        border-left: 2px solid #004400;
    }

    .reply-meta {
        color: #00aa00;
        font-weight: bold;
        margin-bottom: 0.2em;
    }

    .empty-state {
        padding: 2em;
        text-align: center;
        color: #006600;
    }
</style>
