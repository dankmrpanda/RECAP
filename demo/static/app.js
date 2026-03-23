/* ═══════════════════════════════════════════════
   RECAP Demo — Client-side JavaScript
   ═══════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
    // Detect which page we're on based on DOM elements and JS globals
    const hasTask = typeof TASK_ID !== "undefined" && TASK_ID !== null;
    const hasSaved = typeof SAVED_RESULT_PATH !== "undefined" && SAVED_RESULT_PATH !== null && SAVED_RESULT_PATH;
    const hasUploadForm = document.getElementById("upload-form") !== null;

    if (hasSaved) {
        initSavedResultPage();
    } else if (hasTask) {
        initResultsPage();
    } else if (hasUploadForm) {
        initUploadPage();
    }
    // browse.html — no init needed (inline script handles it)
});


/* ── Saved Result Page ──────────────────────── */

function initSavedResultPage() {
    const statusIcon = document.getElementById("status-icon");
    const statusText = document.getElementById("status-text");
    const progressBar = document.getElementById("progress-bar");
    const progressSection = document.getElementById("progress-section");

    // Hide log section, show results immediately
    statusIcon.textContent = "✅";
    statusIcon.classList.remove("pulsing");
    statusText.textContent = "Loaded from saved results";
    progressBar.style.width = "100%";
    document.getElementById("log-container").style.display = "none";

    loadSavedResult(SAVED_RESULT_PATH);
}


async function loadSavedResult(filepath) {
    const resultsSection = document.getElementById("results-section");
    const summaryStats = document.getElementById("summary-stats");
    const chapterNav = document.getElementById("chapter-nav");
    const eventsContainer = document.getElementById("events-container");

    try {
        const resp = await fetch(`/api/saved-results/${encodeURIComponent(filepath)}`);
        if (!resp.ok) return;
        const data = await resp.json();

        // Reuse the same rendering logic
        renderResultsData(data, summaryStats, chapterNav, eventsContainer);
        resultsSection.classList.remove("hidden");
    } catch (err) {
        console.error("Failed to load saved result:", err);
    }
}


/* ── Upload Page ────────────────────────────── */

function initUploadPage() {
    const form = document.getElementById("upload-form");
    const dropZone = document.getElementById("drop-zone");
    const fileInput = document.getElementById("file-input");
    const filePreview = document.getElementById("file-preview");
    const dropContent = dropZone.querySelector(".drop-zone-content");
    const fileName = document.getElementById("file-name");
    const fileSize = document.getElementById("file-size");
    const fileRemove = document.getElementById("file-remove");
    const submitBtn = document.getElementById("submit-btn");
    const submitError = document.getElementById("submit-error");

    let selectedFile = null;

    // Drag & Drop
    dropZone.addEventListener("click", () => fileInput.click());

    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });

    dropZone.addEventListener("dragleave", () => {
        dropZone.classList.remove("drag-over");
    });

    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener("change", () => {
        if (fileInput.files.length > 0) {
            handleFile(fileInput.files[0]);
        }
    });

    function handleFile(file) {
        const ext = file.name.split(".").pop().toLowerCase();
        if (!["txt", "epub", "pdf"].includes(ext)) {
            showError("Unsupported file format. Please use .txt, .epub, or .pdf");
            return;
        }

        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = formatBytes(file.size);
        dropContent.classList.add("hidden");
        filePreview.classList.remove("hidden");
        submitBtn.disabled = false;
        hideError();
    }

    fileRemove.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedFile = null;
        fileInput.value = "";
        dropContent.classList.remove("hidden");
        filePreview.classList.add("hidden");
        submitBtn.disabled = true;
    });

    // Form submission
    form.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!selectedFile) {
            showError("Please select a book file first.");
            return;
        }

        // Check that at least one API key is provided
        const keys = ["openai", "gemini", "anthropic", "deepseek"];
        const hasKey = keys.some(k => document.getElementById(`api_key_${k}`).value.trim());
        if (!hasKey) {
            showError("Please provide at least one API key.");
            return;
        }

        submitBtn.disabled = true;
        submitBtn.querySelector(".btn-text").textContent = "Uploading...";
        hideError();

        const formData = new FormData(form);
        // The hidden file input might not have the dropped file, so add it explicitly
        formData.set("file", selectedFile);

        try {
            const resp = await fetch("/upload", { method: "POST", body: formData });
            const data = await resp.json();

            if (data.error) {
                showError(data.error);
                submitBtn.disabled = false;
                submitBtn.querySelector(".btn-text").textContent = "Start Extraction";
                return;
            }

            // Redirect to progress page
            window.location.href = data.redirect;
        } catch (err) {
            showError("Upload failed. Please try again.");
            submitBtn.disabled = false;
            submitBtn.querySelector(".btn-text").textContent = "Start Extraction";
        }
    });

    function showError(msg) {
        submitError.textContent = msg;
        submitError.classList.remove("hidden");
    }

    function hideError() {
        submitError.classList.add("hidden");
    }

}



/* ── Results Page ───────────────────────────── */

function initResultsPage() {
    const logOutput = document.getElementById("log-output");
    const logContainer = document.getElementById("log-container");
    const statusIcon = document.getElementById("status-icon");
    const statusText = document.getElementById("status-text");
    const progressBar = document.getElementById("progress-bar");
    const resultsSection = document.getElementById("results-section");

    // Pipeline control buttons
    const btnPause = document.getElementById("btn-pause");
    const btnResume = document.getElementById("btn-resume");
    const btnCancel = document.getElementById("btn-cancel");
    const controls = document.getElementById("pipeline-controls");

    function hideControls() {
        controls.classList.add("hidden");
    }

    function showPausedState() {
        btnPause.classList.add("hidden");
        btnResume.classList.remove("hidden");
    }

    function showRunningState() {
        btnPause.classList.remove("hidden");
        btnResume.classList.add("hidden");
    }

    btnPause.addEventListener("click", async () => {
        btnPause.disabled = true;
        await fetch(`/api/task/${TASK_ID}/pause`, { method: "POST" });
    });

    btnResume.addEventListener("click", async () => {
        btnResume.disabled = true;
        await fetch(`/api/task/${TASK_ID}/resume`, { method: "POST" });
    });

    btnCancel.addEventListener("click", async () => {
        if (!confirm("Cancel the pipeline? Progress will be saved and can be viewed from Results.")) return;
        btnCancel.disabled = true;
        btnPause.disabled = true;
        btnResume.disabled = true;
        await fetch(`/api/task/${TASK_ID}/cancel`, { method: "POST" });
    });

    // Connect to SSE
    const evtSource = new EventSource(`/status/${TASK_ID}`);

    evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === "log") {
            const msg = data.message;

            // tqdm progress lines (e.g. "Progress:  45%|███") update in-place
            const isTqdm = /^\s*(Progress|Processing|Refinements).*\|/.test(msg)
                        || /^\s*\d+%\|/.test(msg);

            if (isTqdm) {
                // Replace last line if it was also tqdm
                const lines = logOutput.textContent.split("\n");
                if (lines.length >= 2 && /^\s*(Progress|Processing|Refinements|.*\|)/.test(lines[lines.length - 2])) {
                    lines[lines.length - 2] = msg;
                    logOutput.textContent = lines.join("\n");
                } else {
                    logOutput.textContent += msg + "\n";
                }
            } else {
                logOutput.textContent += msg + "\n";
            }

            logContainer.scrollTop = logContainer.scrollHeight;

            // Update progress heuristic
            const lineCount = logOutput.textContent.split("\n").length;
            const estimatedProgress = Math.min(90, 5 + lineCount * 2);
            progressBar.style.width = estimatedProgress + "%";

            // Update status text from log content
            if (msg.includes("Initializing Pipeline")) {
                statusText.textContent = "Initializing pipeline...";
            } else if (msg.includes("Loading pipeline modules")) {
                statusText.textContent = "Loading pipeline modules...";
            } else if (msg.includes("Modules ready")) {
                statusText.textContent = "Modules loaded, starting...";
            } else if (msg.includes("Step 1")) {
                statusText.textContent = "Preprocessing book...";
            } else if (msg.includes("Step 2")) {
                statusText.textContent = "Running RECAP extraction...";
                progressBar.style.width = "30%";
            } else if (msg.includes("Segmenting chapter")) {
                statusText.textContent = msg.replace("[Preprocessor] ", "");
            } else if (msg.includes("Cleaning non-book")) {
                statusText.textContent = "Cleaning non-book content...";
            } else if (msg.includes("Performing") || msg.includes("Processing event")) {
                statusText.textContent = msg;
            } else if (msg.includes("Refinement") || msg.includes("refinement")) {
                statusText.textContent = "Running feedback refinement...";
            } else if (msg.includes("Prefix") || msg.includes("prefix")) {
                statusText.textContent = "Prefix probing...";
            } else if (msg.includes("Jailbreak") || msg.includes("jailbreak")) {
                statusText.textContent = "Jailbreak extraction...";
            } else if (msg.includes("Calculating metrics") || msg.includes("metrics")) {
                statusText.textContent = "Calculating metrics...";
            }
        }

        if (data.type === "paused") {
            statusIcon.textContent = "⏸";
            statusIcon.classList.remove("pulsing");
            statusText.textContent = "Pipeline paused";
            progressBar.style.background = "var(--warning)";
            showPausedState();
            btnResume.disabled = false;
            btnCancel.disabled = false;
        }

        if (data.type === "resumed") {
            statusIcon.textContent = "⏳";
            statusIcon.classList.add("pulsing");
            statusText.textContent = "Pipeline resumed...";
            progressBar.style.background = "var(--accent)";
            showRunningState();
            btnPause.disabled = false;
            btnCancel.disabled = false;
        }

        if (data.type === "complete") {
            statusIcon.textContent = "✅";
            statusIcon.classList.remove("pulsing");
            statusText.textContent = "Extraction complete!";
            progressBar.style.width = "100%";
            hideControls();
            evtSource.close();

            // Load and display results
            loadResults();
        }

        if (data.type === "cancelled") {
            statusIcon.textContent = "⏹";
            statusIcon.classList.remove("pulsing");
            statusText.textContent = "Pipeline cancelled — progress saved";
            progressBar.style.background = "var(--warning)";
            hideControls();
            evtSource.close();
        }

        if (data.type === "error") {
            statusIcon.textContent = "❌";
            statusIcon.classList.remove("pulsing");
            statusText.textContent = "Pipeline failed";
            progressBar.style.background = "var(--error)";
            hideControls();
            evtSource.close();
        }
    };

    evtSource.onerror = () => {
        // Check if task is already complete
        fetch(`/api/task/${TASK_ID}`)
            .then(r => r.json())
            .then(task => {
                if (task.status === "complete") {
                    statusIcon.textContent = "✅";
                    statusIcon.classList.remove("pulsing");
                    statusText.textContent = "Extraction complete!";
                    progressBar.style.width = "100%";
                    loadResults();
                }
            });
        evtSource.close();
    };
}


async function loadResults() {
    const resultsSection = document.getElementById("results-section");
    const summaryStats = document.getElementById("summary-stats");
    const chapterNav = document.getElementById("chapter-nav");
    const eventsContainer = document.getElementById("events-container");

    try {
        const resp = await fetch(`/api/results/${TASK_ID}`);
        if (!resp.ok) return;
        const data = await resp.json();

        renderResultsData(data, summaryStats, chapterNav, eventsContainer);
        resultsSection.classList.remove("hidden");
    } catch (err) {
        console.error("Failed to load results:", err);
    }
}


function renderResultsData(data, summaryStats, chapterNav, eventsContainer) {
    // Count stats
    let totalEvents = 0;
    let totalExtracted = 0;
    let totalBlocked = 0;

    const chapters = data.chapters || [];
    chapters.forEach(ch => {
        (ch.events || []).forEach(ev => {
            totalEvents++;
            const llm = ev.LLM_completions || {};
            const agent = llm.Agent_Extraction || {};
            const hasExtraction = Object.keys(agent).some(k =>
                !agent[k]?.toString().includes("MODEL_RESPONSE_BLOCKED") &&
                !agent[k]?.toString().includes("Error")
            );
            if (hasExtraction) totalExtracted++;
            else totalBlocked++;
        });
    });

    // Render summary
    summaryStats.innerHTML = `
        <div class="stat-box">
            <div class="stat-value">${chapters.length}</div>
            <div class="stat-label">Chapters</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${totalEvents}</div>
            <div class="stat-label">Events</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${totalExtracted}</div>
            <div class="stat-label">Extracted</div>
        </div>
        <div class="stat-box">
            <div class="stat-value">${totalBlocked}</div>
            <div class="stat-label">Blocked</div>
        </div>
    `;

    // Render chapter navigation
    chapterNav.innerHTML = "";
    chapters.forEach((ch, idx) => {
        const btn = document.createElement("button");
        btn.className = "chapter-btn" + (idx === 0 ? " active" : "");
        btn.textContent = ch.chapter_title || `Chapter ${idx + 1}`;
        btn.dataset.chapter = idx;
        btn.addEventListener("click", () => {
            document.querySelectorAll(".chapter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderChapterEvents(chapters[idx], idx);
        });
        chapterNav.appendChild(btn);
    });

    // Render first chapter events
    if (chapters.length > 0) {
        renderChapterEvents(chapters[0], 0);
    }
}


function renderChapterEvents(chapter, chapterIdx) {
    const container = document.getElementById("events-container");
    container.innerHTML = "";

    const events = chapter.events || [];
    events.forEach((ev, evIdx) => {
        const card = document.createElement("div");
        card.className = "card event-card";

        const goldText = ev.text_segment || "";
        const llm = ev.LLM_completions || {};
        const agent = llm.Agent_Extraction || {};

        // Get the best extraction text
        let extractedText = "";
        let extractionLabel = "No extraction";

        // Try refined versions first, then jailbreak, then simple
        const refinedKeys = Object.keys(agent)
            .filter(k => k.startsWith("simple_agent_extraction_refined_") && k.match(/_\d+$/))
            .sort((a, b) => {
                const numA = parseInt(a.split("_").pop());
                const numB = parseInt(b.split("_").pop());
                return numB - numA;
            });

        if (refinedKeys.length > 0) {
            const best = agent[refinedKeys[0]];
            extractedText = typeof best === "object" ? (best.text || "") : (best || "");
            extractionLabel = `Refined (${refinedKeys[0].split("_").pop()})`;
        } else if (agent.simple_agent_jailbreak) {
            extractedText = agent.simple_agent_jailbreak;
            extractionLabel = "Jailbreak";
        } else if (agent.simple_agent_extraction) {
            extractedText = agent.simple_agent_extraction;
            extractionLabel = "Agent";
        } else if (llm["prefix-probing"]) {
            extractedText = llm["prefix-probing"];
            extractionLabel = "Prefix Probing";
        }

        const isBlocked = extractedText.includes("MODEL_RESPONSE_BLOCKED") ||
                          extractedText.startsWith("Error at Chapter");

        // Simple ROUGE-L approximation (word overlap)
        const score = isBlocked ? 0 : computeSimpleOverlap(goldText, extractedText);
        const scoreClass = score >= 0.7 ? "score-high" : (score >= 0.3 ? "score-mid" : "score-low");

        card.innerHTML = `
            <div class="event-header" onclick="this.nextElementSibling.classList.toggle('open')">
                <span class="event-title">
                    <span style="color: var(--text-muted)">${chapterIdx + 1}.${evIdx + 1}</span>
                    ${ev.title || "Untitled Event"}
                </span>
                <span class="event-score ${scoreClass}">
                    ${isBlocked ? "BLOCKED" : (score * 100).toFixed(0) + "% match"}
                </span>
            </div>
            <div class="event-body">
                <div class="comparison-grid">
                    <div class="text-panel">
                        <div class="text-panel-label">📗 Original Text</div>
                        <div class="text-panel-content">${escapeHtml(goldText)}</div>
                    </div>
                    <div class="text-panel">
                        <div class="text-panel-label">🤖 ${extractionLabel}</div>
                        <div class="text-panel-content">${isBlocked
                            ? '<span style="color: var(--error)">Model refused to reproduce this passage.</span>'
                            : highlightMatches(goldText, extractedText)
                        }</div>
                    </div>
                </div>
            </div>
        `;

        container.appendChild(card);
    });
}


/* ── Text Comparison Utilities ──────────────── */

function computeSimpleOverlap(gold, candidate) {
    if (!gold || !candidate) return 0;
    const goldWords = gold.toLowerCase().split(/\s+/);
    const candWords = candidate.toLowerCase().split(/\s+/);
    if (goldWords.length === 0) return 0;

    const goldSet = new Set(goldWords);
    let matches = 0;
    candWords.forEach(w => { if (goldSet.has(w)) matches++; });

    return Math.min(1, matches / goldWords.length);
}


function highlightMatches(gold, candidate) {
    if (!gold || !candidate) return escapeHtml(candidate);

    const goldWords = new Set(gold.toLowerCase().split(/\s+/));
    const candTokens = candidate.split(/(\s+)/);
    let result = "";

    candTokens.forEach(token => {
        if (/^\s+$/.test(token)) {
            result += token;
        } else {
            const clean = token.toLowerCase().replace(/[^a-z0-9']/g, "");
            if (goldWords.has(clean) && clean.length > 2) {
                result += `<span class="match">${escapeHtml(token)}</span>`;
            } else {
                result += escapeHtml(token);
            }
        }
    });

    return result;
}


/* ── Utilities ──────────────────────────────── */

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}


function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
