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

    // Source toggle (Upload New vs Previously Uploaded)
    const toggleUpload = document.getElementById("toggle-upload");
    const toggleExisting = document.getElementById("toggle-existing");
    const uploadNewSection = document.getElementById("upload-new-section");
    const existingSection = document.getElementById("existing-books-section");
    const existingSelect = document.getElementById("existing-book-select");
    const noBooksMsg = document.getElementById("no-books-msg");

    let sourceMode = "upload"; // "upload" or "existing"
    let existingBooksLoaded = false;

    // "Set All" model selector
    const setAllSelect = document.getElementById("set_all_model");
    if (setAllSelect) {
        setAllSelect.addEventListener("change", () => {
            const val = setAllSelect.value;
            if (!val) return;
            const selects = ["target_model", "feedback_model", "evaluation_model", "preprocessing_model"];
            selects.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const option = el.querySelector('option[value="' + val + '"]');
                    if (option) {
                        el.value = val;
                    }
                }
            });
        });
    }

    toggleUpload.addEventListener("click", () => {
        sourceMode = "upload";
        toggleUpload.classList.add("active");
        toggleExisting.classList.remove("active");
        uploadNewSection.classList.remove("hidden");
        existingSection.classList.add("hidden");
        // Update submit button state based on file selection
        submitBtn.disabled = !selectedFile;
    });

    toggleExisting.addEventListener("click", () => {
        sourceMode = "existing";
        toggleExisting.classList.add("active");
        toggleUpload.classList.remove("active");
        existingSection.classList.remove("hidden");
        uploadNewSection.classList.add("hidden");
        if (!existingBooksLoaded) loadExistingBooks();
        submitBtn.disabled = !existingSelect.value;
    });

    existingSelect.addEventListener("change", () => {
        if (sourceMode === "existing") {
            submitBtn.disabled = !existingSelect.value;
        }
    });

    async function loadExistingBooks() {
        try {
            const resp = await fetch("/api/uploaded-books");
            const books = await resp.json();
            existingBooksLoaded = true;
            existingSelect.innerHTML = "";
            if (books.length === 0) {
                existingSelect.classList.add("hidden");
                noBooksMsg.classList.remove("hidden");
                return;
            }
            noBooksMsg.classList.add("hidden");
            existingSelect.classList.remove("hidden");
            existingSelect.appendChild(new Option("-- Select a book --", ""));
            for (const book of books) {
                const sizeStr = formatBytes(book.size);
                existingSelect.appendChild(new Option(`${book.name} (${sizeStr})`, book.filename));
            }
        } catch (err) {
            existingSelect.innerHTML = "";
            existingSelect.appendChild(new Option("Failed to load books", ""));
        }
    }

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

        if (sourceMode === "upload" && !selectedFile) {
            showError("Please select a book file first.");
            return;
        }
        if (sourceMode === "existing" && !existingSelect.value) {
            showError("Please select a previously uploaded book.");
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
        hideError();

        // Validate API keys before uploading
        submitBtn.querySelector(".btn-text").textContent = "Validating keys...";
        try {
            const validateResp = await fetch("/api/validate-keys", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    target_model: document.getElementById("target_model").value,
                    feedback_model: document.getElementById("feedback_model").value,
                    evaluation_model: document.getElementById("evaluation_model").value,
                    preprocessing_model: document.getElementById("preprocessing_model").value,
                    api_keys: {
                        openai: document.getElementById("api_key_openai").value,
                        gemini: document.getElementById("api_key_gemini").value,
                        anthropic: document.getElementById("api_key_anthropic").value,
                        deepseek: document.getElementById("api_key_deepseek").value,
                    }
                })
            });
            if (!validateResp.ok) {
                const vdata = await validateResp.json();
                showError((vdata.errors || ["API key validation failed"]).join("\n"));
                submitBtn.disabled = false;
                submitBtn.querySelector(".btn-text").textContent = "Start Extraction";
                return;
            }
        } catch (err) {
            showError("Could not validate API keys. Check your connection.");
            submitBtn.disabled = false;
            submitBtn.querySelector(".btn-text").textContent = "Start Extraction";
            return;
        }

        submitBtn.querySelector(".btn-text").textContent = "Uploading...";

        const formData = new FormData(form);
        if (sourceMode === "upload") {
            // The hidden file input might not have the dropped file, so add it explicitly
            formData.set("file", selectedFile);
            formData.delete("existing_file");
        } else {
            // Remove file field, use existing_file instead
            formData.delete("file");
            formData.set("existing_file", existingSelect.value);
        }

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

    // Load resumable tasks
    loadResumableTasks();
}


async function loadResumableTasks() {
    const section = document.getElementById("resumable-tasks");
    const list = document.getElementById("resumable-tasks-list");
    if (!section || !list) return;

    try {
        const resp = await fetch("/api/tasks?status=interrupted,cancelled,error");
        const tasks = await resp.json();
        if (!tasks.length) {
            section.classList.add("hidden");
            return;
        }

        list.innerHTML = "";
        section.classList.remove("hidden");

        tasks.forEach(t => {
            const item = document.createElement("div");
            item.className = "resumable-task-item";

            const statusClass = t.status === "error" ? "status-error" :
                                t.status === "interrupted" ? "status-interrupted" : "status-cancelled";
            const statusLabel = t.status.charAt(0).toUpperCase() + t.status.slice(1);
            const progress = t.progress || 0;

            const date = t.updated_at ? new Date(t.updated_at) : null;
            const dateStr = date ? date.toLocaleDateString() + " " +
                date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "";

            item.innerHTML = `
                <div class="resumable-task-info">
                    <div class="resumable-task-header">
                        <span class="resumable-task-name">${escapeHtml(t.filename || "Unknown")}</span>
                        <span class="resumable-task-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <span class="resumable-task-meta">
                        ${escapeHtml(t.target_model || "")} &middot; ${progress}% &middot; ${dateStr}
                    </span>
                    ${t.error ? '<span class="resumable-task-error">' + escapeHtml(t.error).substring(0, 120) + '</span>' : ''}
                </div>
                <div class="resumable-task-actions">
                    <button class="resumable-btn resume-btn" data-id="${t.id}">Resume</button>
                    <button class="resumable-btn dismiss-btn" data-id="${t.id}">Dismiss</button>
                </div>
            `;
            list.appendChild(item);
        });

        // Resume button handlers
        list.querySelectorAll(".resume-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                btn.disabled = true;
                btn.textContent = "Resuming...";
                try {
                    const resp = await fetch(`/api/task/${btn.dataset.id}/restart`, { method: "POST" });
                    const data = await resp.json();
                    if (resp.ok && data.redirect) {
                        window.location.href = data.redirect;
                    } else {
                        alert(data.error || "Failed to restart task");
                        btn.disabled = false;
                        btn.textContent = "Resume";
                    }
                } catch (err) {
                    alert("Failed to restart task");
                    btn.disabled = false;
                    btn.textContent = "Resume";
                }
            });
        });

        // Dismiss button handlers
        list.querySelectorAll(".dismiss-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                try {
                    await fetch(`/api/task/${btn.dataset.id}`, { method: "DELETE" });
                    btn.closest(".resumable-task-item").remove();
                    if (!list.children.length) section.classList.add("hidden");
                } catch (err) {
                    // ignore
                }
            });
        });

    } catch (err) {
        // Don't break the page if this fails
    }
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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
    let hasStructuredProgress = false;

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

            // Fallback progress heuristic (only before structured progress arrives)
            if (!hasStructuredProgress) {
                const lineCount = logOutput.textContent.split("\n").length;
                const estimatedProgress = Math.min(25, 5 + lineCount);
                progressBar.style.width = estimatedProgress + "%";
            }

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
                if (!hasStructuredProgress) progressBar.style.width = "30%";
            } else if (msg.includes("Segmenting chapter")) {
                statusText.textContent = msg.replace("[Preprocessor] ", "");
            } else if (msg.includes("Cleaning non-book")) {
                statusText.textContent = "Cleaning non-book content...";
            }
        }

        // Structured progress: event completion count
        if (data.type === "progress") {
            hasStructuredProgress = true;
            const pct = data.phase === "preprocessing"
                ? Math.round((data.current / Math.max(data.total, 1)) * 30)
                : 30 + Math.round((data.current / Math.max(data.total, 1)) * 70);
            progressBar.style.width = pct + "%";
            if (data.phase === "extracting") {
                statusText.textContent = `Extracting event ${data.current} of ${data.total}...`;
            }
        }

        // Sub-event phase labels
        if (data.type === "phase") {
            const labels = {
                "prefix_probing": "Prefix probing",
                "agent_extraction": "Agent extraction",
                "jailbreak_prompt": "Generating jailbreak",
                "jailbreak_extraction": "Jailbreak extraction",
                "feedback_loop": "Feedback refinement",
            };
            const label = labels[data.phase] || data.phase;
            statusText.textContent = `${label}: ${data.event}`;
        }

        // Feedback loop iteration progress
        if (data.type === "feedback") {
            statusText.textContent = `Refinement ${data.iteration}/${data.max_iterations} (ROUGE-L: ${(data.rouge_score * 100).toFixed(1)}%)`;
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
    // Render pipeline log if present
    const pipelineLog = data.pipeline_log || [];
    const logCard = document.getElementById("pipeline-log-card");
    const logOutput = document.getElementById("pipeline-log-output");
    if (logCard && logOutput && pipelineLog.length > 0) {
        logOutput.textContent = pipelineLog.join("\n");
        logCard.classList.remove("hidden");
    }

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

    // Add download button
    const downloadUrl = TASK_ID
        ? `/api/download/${TASK_ID}`
        : (SAVED_RESULT_PATH ? `/api/download-saved/${encodeURIComponent(SAVED_RESULT_PATH)}` : null);
    if (downloadUrl) {
        const dlBox = document.createElement("div");
        dlBox.className = "stat-box";
        dlBox.innerHTML = `<a href="${downloadUrl}" class="ctrl-btn" style="text-decoration:none;display:inline-block;margin-top:0.25rem;">Download JSON</a>`;
        summaryStats.appendChild(dlBox);
    }

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
            // Reset filters on chapter switch
            const searchEl = document.getElementById("event-search");
            const filterEl = document.getElementById("event-status-filter");
            if (searchEl) searchEl.value = "";
            if (filterEl) filterEl.value = "all";
            renderChapterEvents(chapters[idx], idx);
        });
        chapterNav.appendChild(btn);
    });

    // Add filter bar
    let filterBar = document.getElementById("event-filter-bar");
    if (!filterBar) {
        filterBar = document.createElement("div");
        filterBar.id = "event-filter-bar";
        filterBar.className = "card filter-bar";
        filterBar.innerHTML = `
            <input type="text" id="event-search" class="filter-input"
                   placeholder="Search events by title or text...">
            <select id="event-status-filter" class="filter-select">
                <option value="all">All events</option>
                <option value="extracted">Extracted only</option>
                <option value="blocked">Blocked only</option>
                <option value="high">High match (70%+)</option>
                <option value="mid">Mid match (30–70%)</option>
                <option value="low">Low match (&lt;30%)</option>
            </select>
        `;
        eventsContainer.parentElement.insertBefore(filterBar, eventsContainer);

        document.getElementById("event-search").addEventListener("input", _applyEventFilters);
        document.getElementById("event-status-filter").addEventListener("change", _applyEventFilters);
    }

    // Render first chapter events
    if (chapters.length > 0) {
        renderChapterEvents(chapters[0], 0);
    }
}

// Module-level state for filtering
let _currentChapter = null;
let _currentChapterIdx = 0;

function _applyEventFilters() {
    const searchText = (document.getElementById("event-search")?.value || "").toLowerCase();
    const statusFilter = document.getElementById("event-status-filter")?.value || "all";
    if (_currentChapter) {
        renderChapterEvents(_currentChapter, _currentChapterIdx, searchText, statusFilter);
    }
}

function _getEventExtractionInfo(ev) {
    const goldText = ev.text_segment || "";
    const llm = ev.LLM_completions || {};
    const agent = llm.Agent_Extraction || {};

    let extractedText = "";
    let extractionLabel = "No extraction";

    const refinedKeys = Object.keys(agent)
        .filter(k => k.startsWith("simple_agent_extraction_refined_") && k.match(/_\d+$/))
        .sort((a, b) => parseInt(b.split("_").pop()) - parseInt(a.split("_").pop()));

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
    const score = isBlocked ? 0 : computeSimpleOverlap(goldText, extractedText);

    return { goldText, extractedText, extractionLabel, isBlocked, score };
}


function renderChapterEvents(chapter, chapterIdx, searchText, statusFilter) {
    _currentChapter = chapter;
    _currentChapterIdx = chapterIdx;
    searchText = searchText || "";
    statusFilter = statusFilter || "all";

    const container = document.getElementById("events-container");
    container.innerHTML = "";

    const events = chapter.events || [];
    events.forEach((ev, evIdx) => {
        const info = _getEventExtractionInfo(ev);

        // Apply filters
        if (searchText) {
            const title = (ev.title || "").toLowerCase();
            const text = (info.goldText || "").toLowerCase();
            if (!title.includes(searchText) && !text.includes(searchText)) return;
        }
        if (statusFilter === "extracted" && info.isBlocked) return;
        if (statusFilter === "blocked" && !info.isBlocked) return;
        if (statusFilter === "high" && (info.isBlocked || info.score < 0.7)) return;
        if (statusFilter === "mid" && (info.isBlocked || info.score < 0.3 || info.score >= 0.7)) return;
        if (statusFilter === "low" && (info.isBlocked || info.score >= 0.3)) return;

        const { goldText, extractedText, extractionLabel, isBlocked, score } = info;
        const scoreClass = score >= 0.7 ? "score-high" : (score >= 0.3 ? "score-mid" : "score-low");

        const card = document.createElement("div");
        card.className = "card event-card";

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

function _cleanWord(w) {
    return w.toLowerCase().replace(/[^a-z0-9']/g, "");
}

function _wordFreqs(words) {
    const freq = {};
    words.forEach(w => {
        const c = _cleanWord(w);
        if (c.length > 0) freq[c] = (freq[c] || 0) + 1;
    });
    return freq;
}

function computeSimpleOverlap(gold, candidate) {
    if (!gold || !candidate) return 0;
    const goldFreq = _wordFreqs(gold.split(/\s+/));
    const candFreq = _wordFreqs(candidate.split(/\s+/));
    const goldTotal = Object.values(goldFreq).reduce((a, b) => a + b, 0);
    if (goldTotal === 0) return 0;

    // Count overlap capped by gold frequency (no inflation from repeats)
    let matches = 0;
    for (const word in candFreq) {
        if (goldFreq[word]) {
            matches += Math.min(candFreq[word], goldFreq[word]);
        }
    }

    return Math.min(1, matches / goldTotal);
}


function highlightMatches(gold, candidate) {
    if (!gold || !candidate) return escapeHtml(candidate);

    const goldWords = new Set(
        gold.split(/\s+/).map(w => _cleanWord(w)).filter(w => w.length > 0)
    );
    const candTokens = candidate.split(/(\s+)/);
    let result = "";

    candTokens.forEach(token => {
        if (/^\s+$/.test(token)) {
            result += token;
        } else {
            const clean = _cleanWord(token);
            if (clean.length > 2 && goldWords.has(clean)) {
                result += `<span class="match">${escapeHtml(token)}</span>`;
            } else {
                result += escapeHtml(token);
            }
        }
    });

    return result;
}


function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
