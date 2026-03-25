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

        resultsSection.classList.remove("hidden");
        // Reuse the same rendering logic
        renderResultsData(data, summaryStats, chapterNav, eventsContainer);
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
    const folderHiddenInput = document.getElementById("upload-folder-input");
    const folderBreadcrumb = document.getElementById("folder-breadcrumb");
    const folderChildren = document.getElementById("folder-children");
    const folderNewName = document.getElementById("folder-new-name");
    const folderNewBtn = document.getElementById("folder-new-btn");

    // Current folder path segments: ["level1", "level2", ...]
    let folderPath = [];

    function getFolderString() {
        return folderPath.join("/");
    }

    function updateFolderHidden() {
        folderHiddenInput.value = getFolderString();
    }

    function renderBreadcrumb() {
        folderBreadcrumb.innerHTML = "";
        // Root crumb
        const rootCrumb = document.createElement("span");
        rootCrumb.className = "folder-crumb folder-crumb--root" + (folderPath.length === 0 ? " active" : "");
        rootCrumb.textContent = "/";
        rootCrumb.dataset.level = "0";
        rootCrumb.addEventListener("click", () => navigateToLevel(0));
        folderBreadcrumb.appendChild(rootCrumb);

        folderPath.forEach((seg, i) => {
            const sep = document.createElement("span");
            sep.className = "folder-crumb-sep";
            sep.textContent = "/";
            folderBreadcrumb.appendChild(sep);

            const crumb = document.createElement("span");
            crumb.className = "folder-crumb" + (i === folderPath.length - 1 ? " active" : "");
            crumb.textContent = seg;
            crumb.dataset.level = String(i + 1);
            crumb.addEventListener("click", () => navigateToLevel(i + 1));
            folderBreadcrumb.appendChild(crumb);
        });

        updateFolderHidden();
    }

    async function loadChildren(parentPath) {
        folderChildren.innerHTML = "";
        try {
            const url = parentPath
                ? `/api/upload-folders?parent=${encodeURIComponent(parentPath)}`
                : "/api/upload-folders";
            const resp = await fetch(url);
            const children = await resp.json();
            if (children.length === 0) {
                folderChildren.innerHTML = '<span class="folder-no-children">no subfolders</span>';
                return;
            }
            children.forEach(fullPath => {
                // Show only the last segment as the label
                const parts = fullPath.split("/");
                const label = parts[parts.length - 1];
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "folder-child-btn";
                btn.textContent = label;
                btn.addEventListener("click", () => {
                    folderPath = fullPath.split("/");
                    renderBreadcrumb();
                    loadChildren(fullPath);
                    refreshExistingBooks();
                });
                folderChildren.appendChild(btn);
            });
        } catch (err) {
            folderChildren.innerHTML = '<span class="folder-no-children">failed to load</span>';
        }
    }

    function navigateToLevel(level) {
        // Truncate path to this level
        folderPath = folderPath.slice(0, level);
        renderBreadcrumb();
        loadChildren(getFolderString());
        refreshExistingBooks();
    }

    // Create new subfolder
    folderNewBtn.addEventListener("click", () => createSubfolder());
    folderNewName.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); createSubfolder(); }
    });

    function createSubfolder() {
        const name = folderNewName.value.trim().replace(/[\/\\]/g, "").replace(/\.\./g, "");
        if (!name) return;
        folderPath.push(name);
        renderBreadcrumb();
        loadChildren(getFolderString());
        refreshExistingBooks();
        folderNewName.value = "";
    }

    // Initialize
    renderBreadcrumb();
    loadChildren("");

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
        // Reset JSON-mode UI when switching back to upload
        const jsonNotice = document.getElementById("json-mode-notice");
        const prepGroup = document.getElementById("preprocessor-group");
        if (jsonNotice) jsonNotice.classList.add("hidden");
        if (prepGroup) prepGroup.classList.remove("setting-group--disabled");
        // Update submit button state based on file selection
        submitBtn.disabled = !selectedFile;
    });

    toggleExisting.addEventListener("click", () => {
        sourceMode = "existing";
        toggleExisting.classList.add("active");
        toggleUpload.classList.remove("active");
        existingSection.classList.remove("hidden");
        uploadNewSection.classList.add("hidden");
        loadExistingBooks();
        submitBtn.disabled = !existingSelect.value;
    });

    existingSelect.addEventListener("change", () => {
        if (sourceMode === "existing") {
            submitBtn.disabled = !existingSelect.value;
            const isJson = existingSelect.value.toLowerCase().endsWith(".json");
            const jsonNotice = document.getElementById("json-mode-notice");
            const prepGroup = document.getElementById("preprocessor-group");
            if (jsonNotice) jsonNotice.classList.toggle("hidden", !isJson);
            if (prepGroup) prepGroup.classList.toggle("setting-group--disabled", isJson);
        }
    });

    async function loadExistingBooks() {
        const folder = getFolderString();
        try {
            const resp = await fetch(`/api/uploaded-books?folder=${encodeURIComponent(folder)}`);
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
            existingSelect.appendChild(new Option("-- Select a file --", ""));

            const rawBooks = books.filter(b => b.type !== "summary");
            const summaries = books.filter(b => b.type === "summary");
            if (rawBooks.length > 0) {
                const grp = document.createElement("optgroup");
                grp.label = "Books (TXT · EPUB · PDF)";
                for (const book of rawBooks) {
                    grp.appendChild(new Option(`${truncateFilename(book.filename)}  (${formatBytes(book.size)})`, book.filename));
                }
                existingSelect.appendChild(grp);
            }
            if (summaries.length > 0) {
                const grp = document.createElement("optgroup");
                grp.label = "Pre-processed Summaries (JSON)";
                for (const book of summaries) {
                    grp.appendChild(new Option(`${truncateFilename(book.filename)}  (${formatBytes(book.size)})`, book.filename));
                }
                existingSelect.appendChild(grp);
            }
        } catch (err) {
            existingSelect.innerHTML = "";
            existingSelect.appendChild(new Option("Failed to load books", ""));
        }
    }

    function refreshExistingBooks() {
        if (sourceMode === "existing") {
            loadExistingBooks();
            submitBtn.disabled = true;
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
        if (!["txt", "epub", "pdf", "json"].includes(ext)) {
            showError("Unsupported file format. Please use .txt, .epub, .pdf, or .json");
            return;
        }

        const isJson = ext === "json";
        const jsonNotice = document.getElementById("json-mode-notice");
        const prepGroup = document.getElementById("preprocessor-group");
        if (jsonNotice) jsonNotice.classList.toggle("hidden", !isJson);
        if (prepGroup) prepGroup.classList.toggle("setting-group--disabled", isJson);

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
        const jsonNotice = document.getElementById("json-mode-notice");
        const prepGroup = document.getElementById("preprocessor-group");
        if (jsonNotice) jsonNotice.classList.add("hidden");
        if (prepGroup) prepGroup.classList.remove("setting-group--disabled");
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

    let _sse_error_handling = false;
    evtSource.onerror = () => {
        if (_sse_error_handling) return;
        _sse_error_handling = true;

        fetch(`/api/task/${TASK_ID}`)
            .then(r => r.json())
            .then(task => {
                const s = task.status;
                if (s === "complete") {
                    evtSource.close();
                    statusIcon.textContent = "✅";
                    statusIcon.classList.remove("pulsing");
                    statusText.textContent = "Extraction complete!";
                    progressBar.style.width = "100%";
                    hideControls();
                    loadResults();
                } else if (s === "interrupted" || s === "error") {
                    evtSource.close();
                    statusIcon.textContent = "⚠";
                    statusIcon.classList.remove("pulsing");
                    progressBar.style.background = "var(--warning)";
                    hideControls();
                    // Show inline resume button so the user doesn't have to go back to main page
                    statusText.innerHTML = "Pipeline interrupted &mdash; ";
                    const resumeBtn = document.createElement("a");
                    resumeBtn.href = "#";
                    resumeBtn.textContent = "click to resume";
                    resumeBtn.style.color = "var(--accent)";
                    resumeBtn.addEventListener("click", async (e) => {
                        e.preventDefault();
                        resumeBtn.textContent = "resuming…";
                        const resp = await fetch(`/api/task/${TASK_ID}/restart`, { method: "POST" });
                        if (resp.ok) window.location.reload();
                    });
                    statusText.appendChild(resumeBtn);
                } else if (s === "cancelled") {
                    evtSource.close();
                    statusIcon.textContent = "⏹";
                    statusIcon.classList.remove("pulsing");
                    statusText.textContent = "Pipeline cancelled — progress saved";
                    progressBar.style.background = "var(--warning)";
                    hideControls();
                } else {
                    // Task is still running (starting / preprocessing / extracting / paused)
                    // — a transient connection drop. Let EventSource auto-reconnect.
                    _sse_error_handling = false;
                }
            })
            .catch(() => {
                // Network error — let EventSource auto-reconnect
                _sse_error_handling = false;
            });
        // Do NOT call evtSource.close() here — only close inside the status handler
        // so transient errors don't permanently kill a live pipeline stream
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

        resultsSection.classList.remove("hidden");
        renderResultsData(data, summaryStats, chapterNav, eventsContainer);
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
    let weightedRougeSum = 0;
    let totalRefWords = 0;
    let totalPassages = 0;
    const MIN_TOKENS = 40;
    const MAX_MISMATCH = 5;

    // P3: Method effectiveness tracking
    const methodCounts = {};  // { method: count }
    const methodScores = {};  // { method: { sum, count } }
    let agentBlockedTotal = 0;
    let jailbreakRecovered = 0;

    const chapters = data.chapters || [];
    chapters.forEach(ch => {
        (ch.events || []).forEach(ev => {
            totalEvents++;
            const info = _getEventExtractionInfo(ev);
            if (info.isBlocked) {
                totalBlocked++;
            } else {
                totalExtracted++;
                weightedRougeSum += info.score * info.refLen;
                totalRefWords += info.refLen;
                totalPassages += countMemorizedPassages(info.goldText, info.extractedText, MIN_TOKENS, MAX_MISMATCH);
            }

            // P3: Track method source
            const llm = ev.LLM_completions || {};
            const agent = llm.Agent_Extraction || {};
            const method = info.extractionLabel.startsWith("Refined") ? "Refined" : info.extractionLabel;
            methodCounts[method] = (methodCounts[method] || 0) + 1;
            if (!info.isBlocked) {
                if (!methodScores[method]) methodScores[method] = { sum: 0, count: 0 };
                methodScores[method].sum += info.score;
                methodScores[method].count++;
            }

            // Track jailbreak recovery
            const agentText = agent.simple_agent_extraction || "";
            if (agentText.includes("MODEL_RESPONSE_BLOCKED")) {
                agentBlockedTotal++;
                const jbText = agent.simple_agent_jailbreak || "";
                if (jbText && !jbText.includes("MODEL_RESPONSE_BLOCKED")) {
                    jailbreakRecovered++;
                }
            }
        });
    });

    const avgRougeL = totalRefWords > 0 ? weightedRougeSum / totalRefWords : 0;
    const jbRecoveryRate = agentBlockedTotal > 0 ? jailbreakRecovered / agentBlockedTotal : 0;

    // Render summary
    summaryStats.innerHTML = `
        <div class="stat-box" data-tooltip="Weighted avg ROUGE-L across all events (by word count)">
            <div class="stat-value">${avgRougeL.toFixed(3)}</div>
            <div class="stat-label">ROUGE-L</div>
        </div>
        <div class="stat-box" data-tooltip="${MIN_TOKENS}-token segments with \u2264${MAX_MISMATCH} token mismatches">
            <div class="stat-value">${totalPassages.toLocaleString()}</div>
            <div class="stat-label">Passages</div>
        </div>
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

    // P3: Method effectiveness breakdown
    const methodBreakdown = document.createElement("div");
    methodBreakdown.className = "method-breakdown";
    methodBreakdown.innerHTML = `<div class="method-breakdown-title">Pipeline Method Breakdown</div>`;

    const methodOrder = ["Prefix Probing", "Agent", "Jailbreak", "Refined", "No extraction"];
    const methodColors = {"Prefix Probing": "#e55050", "Agent": "#e5a000", "Jailbreak": "#5bc0de", "Refined": "#00e5a0", "No extraction": "#555"};
    const allMethods = methodOrder.filter(m => methodCounts[m]);

    if (allMethods.length > 0) {
        let tableHTML = `<table class="method-table">
            <thead><tr><th>Source</th><th>Events</th><th>Avg ROUGE-L</th></tr></thead><tbody>`;
        allMethods.forEach(m => {
            const count = methodCounts[m] || 0;
            const avg = methodScores[m] ? (methodScores[m].sum / methodScores[m].count) : 0;
            const color = methodColors[m] || "var(--text-dim)";
            tableHTML += `<tr>
                <td><span class="method-dot" style="background:${color}"></span>${m}</td>
                <td>${count}</td>
                <td>${methodScores[m] ? avg.toFixed(3) : "—"}</td>
            </tr>`;
        });
        tableHTML += `</tbody></table>`;

        if (agentBlockedTotal > 0) {
            tableHTML += `<div class="jailbreak-stat">Jailbreak recovery: <strong>${jailbreakRecovered}/${agentBlockedTotal}</strong> blocked events recovered (${(jbRecoveryRate * 100).toFixed(0)}%)</div>`;
        }

        methodBreakdown.innerHTML += tableHTML;
        summaryStats.parentElement.appendChild(methodBreakdown);
    }

    // P6: Cost estimate (based on token counts from results)
    const modelName = data.model_name || data.target_model || "";
    const costEstimate = _estimateCost(chapters, modelName);
    if (costEstimate > 0) {
        const costBox = document.createElement("div");
        costBox.className = "stat-box";
        costBox.setAttribute("data-tooltip", `Estimated API cost based on token counts for ${modelName || "unknown model"}`);
        costBox.innerHTML = `<div class="stat-value">$${costEstimate < 0.01 ? costEstimate.toFixed(4) : costEstimate.toFixed(2)}</div><div class="stat-label">Est. Cost</div>`;
        summaryStats.appendChild(costBox);
    }

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

    // Render charts
    renderCharts(data);

    // Store chapters for "All" view
    _allChapters = chapters;

    // Render chapter navigation
    chapterNav.innerHTML = "";

    // "All" button
    const allBtn = document.createElement("button");
    allBtn.className = "chapter-btn";
    allBtn.textContent = "All";
    allBtn.addEventListener("click", () => {
        document.querySelectorAll(".chapter-btn").forEach(b => b.classList.remove("active"));
        allBtn.classList.add("active");
        _showingAll = true;
        const searchEl = document.getElementById("event-search");
        const filterEl = document.getElementById("event-status-filter");
        if (searchEl) searchEl.value = "";
        if (filterEl) filterEl.value = "all";
        renderAllChapterEvents();
    });
    chapterNav.appendChild(allBtn);

    chapters.forEach((ch, idx) => {
        const btn = document.createElement("button");
        btn.className = "chapter-btn" + (idx === 0 ? " active" : "");
        btn.textContent = ch.chapter_title || `Chapter ${idx + 1}`;
        btn.dataset.chapter = idx;
        btn.addEventListener("click", () => {
            document.querySelectorAll(".chapter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            _showingAll = false;
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
let _allChapters = [];
let _showingAll = false;

function _applyEventFilters() {
    const searchText = (document.getElementById("event-search")?.value || "").toLowerCase();
    const statusFilter = document.getElementById("event-status-filter")?.value || "all";
    if (_showingAll) {
        renderAllChapterEvents(searchText, statusFilter);
    } else if (_currentChapter) {
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
    const rougeInfo = isBlocked ? {score: 0, lcsLen: 0, refLen: 0, candLen: 0} : computeRougeL(goldText, extractedText);

    return { goldText, extractedText, extractionLabel, isBlocked,
             score: rougeInfo.score, lcsLen: rougeInfo.lcsLen, refLen: rougeInfo.refLen, candLen: rougeInfo.candLen };
}


/* ── Pipeline Step Extraction (P1) ────────── */

function _getAllPipelineSteps(ev) {
    const goldText = ev.text_segment || "";
    const llm = ev.LLM_completions || {};
    const agent = llm.Agent_Extraction || {};
    const steps = [];

    // 1. Prefix Probing
    const pp = llm["prefix-probing"] || "";
    if (pp) {
        const blocked = pp.includes("MODEL_RESPONSE_BLOCKED");
        const r = blocked ? {score: 0} : computeRougeL(goldText, pp);
        steps.push({ id: "prefix", label: "Prefix Probing", text: pp, blocked, score: r.score });
    }

    // 2. Agent Extraction
    const ae = agent.simple_agent_extraction || "";
    if (ae) {
        const blocked = ae.includes("MODEL_RESPONSE_BLOCKED");
        const r = blocked ? {score: 0} : computeRougeL(goldText, ae);
        steps.push({ id: "agent", label: "Agent", text: ae, blocked, score: r.score });
    }

    // 3. Jailbreak (only if agent was blocked)
    const jb = agent.simple_agent_jailbreak || "";
    if (jb) {
        const blocked = jb.includes("MODEL_RESPONSE_BLOCKED");
        const r = blocked ? {score: 0} : computeRougeL(goldText, jb);
        steps.push({ id: "jailbreak", label: "Jailbreak", text: jb, blocked, score: r.score });
    }

    // 4. Refined iterations
    const refinedKeys = Object.keys(agent)
        .filter(k => k.startsWith("simple_agent_extraction_refined_") && k.match(/_\d+$/))
        .sort((a, b) => parseInt(a.split("_").pop()) - parseInt(b.split("_").pop()));

    refinedKeys.forEach(k => {
        const iterNum = parseInt(k.split("_").pop());
        const raw = agent[k];
        const text = typeof raw === "object" ? (raw.text || "") : (raw || "");
        const feedback = typeof raw === "object" ? (raw.refinement_prompt || null) : null;
        const blocked = text.includes("MODEL_RESPONSE_BLOCKED");
        const r = blocked ? {score: 0} : computeRougeL(goldText, text);
        steps.push({
            id: `refined_${iterNum}`, label: `Refined ${iterNum}`,
            text, blocked, score: r.score, feedback
        });
    });

    return steps;
}


/* ── Per-Event Iteration Scores (P2) ─────── */

function _getIterationScores(ev) {
    const goldText = ev.text_segment || "";
    const llm = ev.LLM_completions || {};
    const agent = llm.Agent_Extraction || {};
    const scores = [];

    // Base score (jailbreak if exists, else agent)
    const baseText = agent.simple_agent_jailbreak || agent.simple_agent_extraction || "";
    if (baseText && !baseText.includes("MODEL_RESPONSE_BLOCKED")) {
        scores.push({ label: "Base", score: computeRougeL(goldText, baseText).score });
    }

    // Refined iterations
    for (let i = 0; i <= 10; i++) {
        const rk = `simple_agent_extraction_refined_${i}`;
        if (!agent[rk]) break;
        const rt = typeof agent[rk] === "object" ? (agent[rk].text || "") : (agent[rk] || "");
        if (rt && !rt.includes("MODEL_RESPONSE_BLOCKED")) {
            scores.push({ label: `R${i}`, score: computeRougeL(goldText, rt).score });
        }
    }

    return scores;
}

function _renderSparkline(scores) {
    if (scores.length < 2) return "";
    const w = 80, h = 22, pad = 2;
    const min = Math.min(...scores.map(s => s.score));
    const max = Math.max(...scores.map(s => s.score));
    const range = max - min || 0.01;
    const points = scores.map((s, i) => {
        const x = pad + (i / (scores.length - 1)) * (w - pad * 2);
        const y = h - pad - ((s.score - min) / range) * (h - pad * 2);
        return `${x},${y}`;
    });
    const improved = scores[scores.length - 1].score > scores[0].score;
    const color = improved ? "var(--accent)" : "var(--text-faint)";
    const lastScore = scores[scores.length - 1].score;
    const firstScore = scores[0].score;
    const delta = ((lastScore - firstScore) * 100).toFixed(0);
    const deltaStr = improved ? `+${delta}%` : `${delta}%`;

    return `<span class="sparkline-wrap" data-tooltip="Feedback: ${scores[0].label} ${(firstScore*100).toFixed(0)}% → ${scores[scores.length-1].label} ${(lastScore*100).toFixed(0)}% (${deltaStr})">
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
            <polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="${points[points.length-1].split(",")[0]}" cy="${points[points.length-1].split(",")[1]}" r="2" fill="${color}"/>
        </svg>
    </span>`;
}


function _buildEventCardHTML(ev, chapterIdx, evIdx) {
    const info = _getEventExtractionInfo(ev);
    const { goldText, extractedText, extractionLabel, isBlocked, score, lcsLen, refLen } = info;
    const scoreClass = score >= 0.7 ? "score-high" : (score >= 0.3 ? "score-mid" : "score-low");
    const scoreTooltip = isBlocked
        ? "Model refused to reproduce this passage"
        : `ROUGE-L \u00b7 LCS ${lcsLen} of ${refLen} ref words`;

    // P2: Sparkline
    const iterScores = _getIterationScores(ev);
    const sparkline = _renderSparkline(iterScores);

    // P4: Passage heatmap
    const heatmap = isBlocked ? "" : _renderPassageHeatmap(goldText, extractedText);

    // P1: Pipeline steps
    const steps = _getAllPipelineSteps(ev);
    const cardId = `ev-${chapterIdx}-${evIdx}`;

    let stepsTabsHTML = "";
    let stepsContentHTML = "";

    if (steps.length > 1) {
        // Tab bar
        stepsTabsHTML = `<div class="step-tabs">
            <button class="step-tab active" data-tab="${cardId}-best">Best</button>
            ${steps.map(s => `<button class="step-tab" data-tab="${cardId}-${s.id}">
                <span class="step-tab-label">${s.label}</span>
                <span class="step-tab-score ${s.blocked ? "score-low" : (s.score >= 0.7 ? "score-high" : (s.score >= 0.3 ? "score-mid" : "score-low"))}">${s.blocked ? "X" : (s.score * 100).toFixed(0) + "%"}</span>
            </button>`).join("")}
        </div>`;

        // "Best" tab content (default)
        stepsContentHTML = `<div class="step-content active" id="${cardId}-best">
            <div class="comparison-grid">
                <div class="text-panel">
                    <div class="text-panel-label">Original Text</div>
                    <div class="text-panel-content">${escapeHtml(goldText)}</div>
                </div>
                <div class="text-panel">
                    <div class="text-panel-label">${extractionLabel}</div>
                    <div class="text-panel-content">${isBlocked
                        ? '<span style="color: var(--error)">Model refused to reproduce this passage.</span>'
                        : highlightMatches(goldText, extractedText)
                    }</div>
                </div>
            </div>
        </div>`;

        // Per-step content
        steps.forEach(s => {
            const feedbackHTML = s.feedback
                ? `<div class="feedback-block"><div class="feedback-label">Feedback Guidance</div><div class="feedback-text">${escapeHtml(s.feedback)}</div></div>`
                : "";
            stepsContentHTML += `<div class="step-content" id="${cardId}-${s.id}">
                ${feedbackHTML}
                <div class="comparison-grid">
                    <div class="text-panel">
                        <div class="text-panel-label">Original Text</div>
                        <div class="text-panel-content">${escapeHtml(goldText)}</div>
                    </div>
                    <div class="text-panel">
                        <div class="text-panel-label">${s.label} <span class="step-score-inline ${s.blocked ? "score-low" : (s.score >= 0.7 ? "score-high" : (s.score >= 0.3 ? "score-mid" : "score-low"))}">${s.blocked ? "BLOCKED" : (s.score * 100).toFixed(0) + "%"}</span></div>
                        <div class="text-panel-content">${s.blocked
                            ? '<span style="color: var(--error)">Model refused to reproduce this passage.</span>'
                            : highlightMatches(goldText, s.text)
                        }</div>
                    </div>
                </div>
            </div>`;
        });
    } else {
        // Single step — original layout
        stepsContentHTML = `<div class="comparison-grid">
            <div class="text-panel">
                <div class="text-panel-label">Original Text</div>
                <div class="text-panel-content">${escapeHtml(goldText)}</div>
            </div>
            <div class="text-panel">
                <div class="text-panel-label">${extractionLabel}</div>
                <div class="text-panel-content">${isBlocked
                    ? '<span style="color: var(--error)">Model refused to reproduce this passage.</span>'
                    : highlightMatches(goldText, extractedText)
                }</div>
            </div>
        </div>`;
    }

    return { info, html: `
        <div class="event-header" onclick="this.nextElementSibling.classList.toggle('open')">
            <span class="event-title">
                <span style="color: var(--text-muted)">${chapterIdx + 1}.${evIdx + 1}</span>
                ${ev.title || "Untitled Event"}
            </span>
            <span class="event-header-right">
                ${sparkline}
                <span class="event-score ${scoreClass}" data-tooltip="${escapeHtml(scoreTooltip)}">
                    ${isBlocked ? "BLOCKED" : (score * 100).toFixed(0) + "% match"}
                </span>
            </span>
        </div>
        <div class="event-body">
            ${heatmap}
            ${stepsTabsHTML}
            ${stepsContentHTML}
        </div>
    ` };
}

function _attachTabListeners(card) {
    card.querySelectorAll(".step-tab").forEach(tab => {
        tab.addEventListener("click", (e) => {
            e.stopPropagation();
            const tabId = tab.dataset.tab;
            const body = tab.closest(".event-body");
            body.querySelectorAll(".step-tab").forEach(t => t.classList.remove("active"));
            body.querySelectorAll(".step-content").forEach(c => c.classList.remove("active"));
            tab.classList.add("active");
            const target = document.getElementById(tabId);
            if (target) target.classList.add("active");
        });
    });
}

function _applyEventFilter(info, searchText, statusFilter, ev) {
    if (searchText) {
        const title = (ev.title || "").toLowerCase();
        const text = (info.goldText || "").toLowerCase();
        if (!title.includes(searchText) && !text.includes(searchText)) return false;
    }
    if (statusFilter === "extracted" && info.isBlocked) return false;
    if (statusFilter === "blocked" && !info.isBlocked) return false;
    if (statusFilter === "high" && (info.isBlocked || info.score < 0.7)) return false;
    if (statusFilter === "mid" && (info.isBlocked || info.score < 0.3 || info.score >= 0.7)) return false;
    if (statusFilter === "low" && (info.isBlocked || info.score >= 0.3)) return false;
    return true;
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
        const { info, html } = _buildEventCardHTML(ev, chapterIdx, evIdx);
        if (!_applyEventFilter(info, searchText, statusFilter, ev)) return;

        const card = document.createElement("div");
        card.className = "card event-card";
        card.innerHTML = html;
        _attachTabListeners(card);
        container.appendChild(card);
    });
}


function renderAllChapterEvents(searchText, statusFilter) {
    _showingAll = true;
    searchText = searchText || "";
    statusFilter = statusFilter || "all";

    const container = document.getElementById("events-container");
    container.innerHTML = "";

    _allChapters.forEach((chapter, chapterIdx) => {
        const chapterCards = [];
        (chapter.events || []).forEach((ev, evIdx) => {
            const { info, html } = _buildEventCardHTML(ev, chapterIdx, evIdx);
            if (!_applyEventFilter(info, searchText, statusFilter, ev)) return;

            const card = document.createElement("div");
            card.className = "card event-card";
            card.innerHTML = html;
            _attachTabListeners(card);
            chapterCards.push(card);
        });

        if (chapterCards.length > 0) {
            const heading = document.createElement("div");
            heading.className = "all-chapter-heading";
            heading.textContent = chapter.chapter_title || `Chapter ${chapterIdx + 1}`;
            container.appendChild(heading);
            chapterCards.forEach(c => container.appendChild(c));
        }
    });
}


/* ── P6: Cost Estimation ──────────────────── */

const MODEL_PRICING = {
    // Per million tokens: [input, output]
    "gpt-4.1": [2.00, 8.00],
    "gpt-4.1-mini": [0.40, 1.60],
    "gpt-4.1-nano": [0.10, 0.40],
    "gpt-4o": [2.50, 10.00],
    "gpt-4o-mini": [0.15, 0.60],
    "claude-3-7-sonnet": [3.00, 15.00],
    "claude-3.7-sonnet": [3.00, 15.00],
    "claude-sonnet-4": [3.00, 15.00],
    "gemini-2.5-pro": [1.25, 10.00],
    "gemini-2.5-flash": [0.15, 0.60],
    "deepseek-v3": [0.27, 1.10],
    "deepseek-chat": [0.27, 1.10],
    "qwen3": [0.40, 1.20],
};

function _getModelPricing(modelName) {
    if (!modelName) return null;
    const lower = modelName.toLowerCase();
    for (const [key, price] of Object.entries(MODEL_PRICING)) {
        if (lower.includes(key)) return price;
    }
    return null;
}

function _estimateCost(chapters, modelName) {
    const pricing = _getModelPricing(modelName);
    if (!pricing) return 0;

    const [inputPerM, outputPerM] = pricing;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Estimate: each event has ~1 extraction call + possible feedback iterations
    // Input: ~500 tokens prompt + summary per event
    // Output: text length of extraction
    chapters.forEach(ch => {
        (ch.events || []).forEach(ev => {
            const goldText = ev.text_segment || "";
            const goldTokens = goldText.split(/\s+/).length;
            const llm = ev.LLM_completions || {};
            const agent = llm.Agent_Extraction || {};

            // Base extraction (prompt ~500 tokens + context)
            totalInputTokens += 500 + goldTokens;
            const aeText = agent.simple_agent_extraction || "";
            totalOutputTokens += aeText.split(/\s+/).length;

            // Prefix probing
            if (llm["prefix-probing"]) {
                totalInputTokens += 100;
                totalOutputTokens += llm["prefix-probing"].split(/\s+/).length;
            }

            // Jailbreak
            if (agent.simple_agent_jailbreak) {
                totalInputTokens += 600;
                totalOutputTokens += agent.simple_agent_jailbreak.split(/\s+/).length;
            }

            // Feedback iterations (evaluator + feedback agent + re-extraction)
            for (let i = 0; i <= 10; i++) {
                const rk = `simple_agent_extraction_refined_${i}`;
                if (!agent[rk]) break;
                const rt = typeof agent[rk] === "object" ? (agent[rk].text || "") : (agent[rk] || "");
                // Feedback evaluation: input = gold + extraction (~2x gold tokens)
                totalInputTokens += goldTokens * 2 + 500;
                // Feedback generation output
                totalOutputTokens += 200;
                // Re-extraction: input = prompt + feedback
                totalInputTokens += 700 + goldTokens;
                totalOutputTokens += rt.split(/\s+/).length;
            }

            // Evaluator/classifier call
            totalInputTokens += 200;
            totalOutputTokens += 10;
        });
    });

    // Convert word counts to approximate token counts (1 word ≈ 1.3 tokens)
    totalInputTokens = Math.round(totalInputTokens * 1.3);
    totalOutputTokens = Math.round(totalOutputTokens * 1.3);

    return (totalInputTokens / 1_000_000) * inputPerM + (totalOutputTokens / 1_000_000) * outputPerM;
}


/* ── P4: Passage Location Heatmap ─────────── */

function _renderPassageHeatmap(goldText, extractedText) {
    if (!goldText || !extractedText) return "";
    const a = _normalizeTokens(goldText);
    const b = _normalizeTokens(extractedText);
    if (a.length === 0 || b.length === 0) return "";

    const blocks = _getMatchingBlocks(a, b);
    if (blocks.length === 0) return "";

    // Build a boolean array: which gold tokens are matched
    const matched = new Array(a.length).fill(false);
    blocks.forEach(([ai, , k]) => {
        for (let x = ai; x < ai + k; x++) matched[x] = true;
    });

    // Render as a thin horizontal bar
    const totalTokens = a.length;
    const barWidth = 100; // percentage
    let segments = "";
    let i = 0;
    while (i < totalTokens) {
        const isMatch = matched[i];
        let j = i;
        while (j < totalTokens && matched[j] === isMatch) j++;
        const widthPct = ((j - i) / totalTokens * barWidth).toFixed(2);
        const color = isMatch ? "var(--accent)" : "var(--border)";
        segments += `<span class="heatmap-seg" style="width:${widthPct}%;background:${color}"></span>`;
        i = j;
    }

    const matchCount = matched.filter(Boolean).length;
    const matchPct = (matchCount / totalTokens * 100).toFixed(0);

    return `<div class="passage-heatmap" data-tooltip="${matchCount}/${totalTokens} tokens matched (${matchPct}%)">
        <div class="heatmap-bar">${segments}</div>
    </div>`;
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
    if (!gold || !candidate) return {score: 0, matches: 0, total: 0};
    const goldFreq = _wordFreqs(gold.split(/\s+/));
    const candFreq = _wordFreqs(candidate.split(/\s+/));
    const total = Object.values(goldFreq).reduce((a, b) => a + b, 0);
    if (total === 0) return {score: 0, matches: 0, total: 0};

    // Count overlap capped by gold frequency (no inflation from repeats)
    let matches = 0;
    for (const word in candFreq) {
        if (goldFreq[word]) {
            matches += Math.min(candFreq[word], goldFreq[word]);
        }
    }

    return {score: Math.min(1, matches / total), matches, total};
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
            if (clean.length > 0 && goldWords.has(clean)) {
                result += `<span class="match">${escapeHtml(token)}</span>`;
            } else {
                result += escapeHtml(token);
            }
        }
    });

    return result;
}


/* ── ROUGE-L & Passage Counting (paper metrics) ─ */

function _normalizeTokens(text) {
    return text.toLowerCase()
        .replace(/[\u201c\u201d\u201e\u201f\u2018\u2019\u201a\u201b]/g, "'")
        .replace(/[\u2014\u2013]/g, " ")
        .replace(/[^\w\s']/g, "")
        .split(/\s+/)
        .filter(w => w.length > 0);
}

function _lcsLength(a, b) {
    if (a.length === 0 || b.length === 0) return 0;
    const [rows, cols] = a.length > b.length ? [a, b] : [b, a];
    const C = cols.length;
    let prev = new Array(C + 1).fill(0);
    let curr = new Array(C + 1).fill(0);
    for (let i = 0; i < rows.length; i++) {
        for (let j = 0; j < C; j++) {
            curr[j + 1] = (rows[i] === cols[j])
                ? prev[j] + 1
                : Math.max(prev[j + 1], curr[j]);
        }
        [prev, curr] = [curr, prev];
        curr.fill(0);
    }
    return prev[C];
}

function computeRougeL(gold, candidate) {
    if (!gold || !candidate) return {score: 0, lcsLen: 0, refLen: 0, candLen: 0};
    const ref = _normalizeTokens(gold);
    const cand = _normalizeTokens(candidate);
    if (ref.length === 0) return {score: 0, lcsLen: 0, refLen: 0, candLen: 0};
    if (cand.length === 0) return {score: 0, lcsLen: 0, refLen: ref.length, candLen: 0};
    const lcsLen = _lcsLength(ref, cand);
    const R = lcsLen / ref.length;
    const P = lcsLen / cand.length;
    const beta2 = 1.44; // β = 1.2
    const score = (R === 0 && P === 0) ? 0 : ((1 + beta2) * P * R) / (R + beta2 * P);
    return {score, lcsLen, refLen: ref.length, candLen: cand.length};
}

function _getMatchingBlocks(a, b) {
    const results = [];
    function findLongest(aLo, aHi, bLo, bHi) {
        let bestI = aLo, bestJ = bLo, bestK = 0;
        const bIdx = {};
        for (let j = bLo; j < bHi; j++) {
            if (!bIdx[b[j]]) bIdx[b[j]] = [];
            bIdx[b[j]].push(j);
        }
        let j2len = {};
        for (let i = aLo; i < aHi; i++) {
            const nj = {};
            for (const j of (bIdx[a[i]] || [])) {
                const k = (j2len[j - 1] || 0) + 1;
                nj[j] = k;
                if (k > bestK) { bestI = i - k + 1; bestJ = j - k + 1; bestK = k; }
            }
            j2len = nj;
        }
        return [bestI, bestJ, bestK];
    }
    function recurse(aLo, aHi, bLo, bHi) {
        const [i, j, k] = findLongest(aLo, aHi, bLo, bHi);
        if (k === 0) return;
        if (aLo < i && bLo < j) recurse(aLo, i, bLo, j);
        results.push([i, j, k]);
        if (i + k < aHi && j + k < bHi) recurse(i + k, aHi, j + k, bHi);
    }
    recurse(0, a.length, 0, b.length);
    return results;
}

function countMemorizedPassages(goldText, extractedText, minTokens, maxMismatch) {
    if (!goldText || !extractedText) return 0;
    const a = _normalizeTokens(goldText);
    const b = _normalizeTokens(extractedText);
    if (a.length === 0 || b.length === 0) return 0;
    const blocks = _getMatchingBlocks(a, b);
    if (blocks.length === 0) return 0;

    let passages = 0;
    for (let i = 0; i < blocks.length; i++) {
        let totalMatch = blocks[i][2];
        let endG = blocks[i][0] + blocks[i][2];
        let endC = blocks[i][1] + blocks[i][2];
        let mismatches = 0;
        for (let j = i + 1; j < blocks.length; j++) {
            const gapG = blocks[j][0] - endG;
            const gapC = blocks[j][1] - endC;
            if (gapG < 0 || gapC < 0) continue;
            const gap = Math.max(gapG, gapC);
            if (mismatches + gap > maxMismatch) break;
            mismatches += gap;
            totalMatch += blocks[j][2];
            endG = blocks[j][0] + blocks[j][2];
            endC = blocks[j][1] + blocks[j][2];
        }
        if (totalMatch >= minTokens) {
            passages += Math.floor(totalMatch / minTokens);
        }
    }
    return passages;
}


/* ── Chart Drawing (D3.js) ─────────────────── */

function drawBarChart(container, labels, values, opts) {
    const {yLabel, colors, maxVal} = Object.assign({yLabel: "", colors: null, maxVal: null}, opts);
    const defaultColor = "#00e5a0";

    if (values.length === 0) {
        d3.select(container).append("div").attr("class", "chart-empty").text("No data");
        return;
    }

    const margin = {top: 20, right: 30, bottom: 56, left: 70};
    const width = container.clientWidth - margin.left - margin.right;
    const height = 230 - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain(labels).range([0, width]).padding(0.35);
    const yMax = maxVal || d3.max(values) * 1.15 || 1;
    const y = d3.scaleLinear().domain([0, yMax]).range([height, 0]);

    // Grid lines
    svg.append("g").attr("class", "d3-grid")
        .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""))
        .selectAll("line").attr("stroke", "#2a2a2a");
    svg.selectAll(".d3-grid .domain").remove();

    // Y-axis
    svg.append("g").attr("class", "d3-axis")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d => d >= 1 ? d3.format("d")(d) : d3.format(".2f")(d)))
        .selectAll("text").attr("fill", "#888").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace");
    svg.selectAll(".d3-axis .domain, .d3-axis line").attr("stroke", "#2a2a2a");

    // Y-axis label
    if (yLabel) {
        svg.append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", -margin.left + 20).attr("x", -height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "#666").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
            .text(yLabel);
    }

    // Bars
    svg.selectAll(".d3-bar").data(values).enter()
      .append("rect").attr("class", "d3-bar")
        .attr("x", (d, i) => x(labels[i]))
        .attr("y", d => y(d))
        .attr("width", x.bandwidth())
        .attr("height", d => height - y(d))
        .attr("fill", (d, i) => colors ? (colors[i] || defaultColor) : defaultColor)
        .attr("rx", 2);

    // Value labels above bars
    if (values.length <= 15) {
        svg.selectAll(".d3-val").data(values).enter()
          .append("text").attr("class", "d3-val")
            .attr("x", (d, i) => x(labels[i]) + x.bandwidth() / 2)
            .attr("y", d => y(d) - 5)
            .attr("text-anchor", "middle")
            .attr("fill", "#e0e0e0").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace")
            .text(d => d >= 1 ? d.toFixed(0) : d.toFixed(3));
    }

    // X-axis labels (rotated for long labels)
    const needRotate = labels.some(l => l.length > 10) && labels.length > 4;
    svg.append("g").attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).tickSize(0))
        .selectAll("text")
            .attr("fill", "#888")
            .style("font-size", "10px")
            .style("font-family", "'JetBrains Mono', monospace")
            .attr("transform", needRotate ? "rotate(-35)" : null)
            .style("text-anchor", needRotate ? "end" : "middle")
            .attr("dx", needRotate ? "-0.8em" : "0")
            .attr("dy", needRotate ? "0.15em" : "0.71em")
            .text(d => d.length > 16 ? d.substring(0, 14) + ".." : d);
    svg.selectAll("g:last-of-type .domain").attr("stroke", "#2a2a2a");
}


function drawLineChart(container, xLabels, datasets, opts) {
    const {yLabel} = Object.assign({yLabel: ""}, opts);

    if (xLabels.length === 0) {
        d3.select(container).append("div").attr("class", "chart-empty").text("No data");
        return;
    }

    const margin = {top: 20, right: 30, bottom: 46, left: 70};
    const width = container.clientWidth - margin.left - margin.right;
    const height = 230 - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    let allVals = [];
    datasets.forEach(ds => allVals.push(...ds.values));
    const yMax = Math.max(d3.max(allVals) * 1.15, 0.01);

    const x = d3.scalePoint().domain(xLabels).range([0, width]).padding(0.3);
    const y = d3.scaleLinear().domain([0, yMax]).range([height, 0]);

    // Grid
    svg.append("g").attr("class", "d3-grid")
        .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""))
        .selectAll("line").attr("stroke", "#2a2a2a");
    svg.selectAll(".d3-grid .domain").remove();

    // Y-axis
    svg.append("g").attr("class", "d3-axis")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".2f")))
        .selectAll("text").attr("fill", "#888").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace");
    svg.selectAll(".d3-axis .domain, .d3-axis line").attr("stroke", "#2a2a2a");

    if (yLabel) {
        svg.append("text")
            .attr("transform", "rotate(-90)")
            .attr("y", -margin.left + 20).attr("x", -height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "#666").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
            .text(yLabel);
    }

    // X-axis
    svg.append("g").attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).tickSize(0))
        .selectAll("text").attr("fill", "#888").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace");
    svg.selectAll("g:last-of-type .domain").attr("stroke", "#2a2a2a");

    // Lines + dots
    const line = d3.line().x((d, i) => x(xLabels[i])).y(d => y(d));

    datasets.forEach(ds => {
        const color = ds.color || "#00e5a0";

        // Area fill
        svg.append("path")
            .datum(ds.values)
            .attr("fill", color).attr("fill-opacity", 0.08)
            .attr("d", d3.area()
                .x((d, i) => x(xLabels[i]))
                .y0(height)
                .y1(d => y(d)));

        // Line
        svg.append("path")
            .datum(ds.values)
            .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2.5)
            .attr("d", line);

        // Dots
        svg.selectAll(`.dot-${ds.label}`).data(ds.values).enter()
          .append("circle")
            .attr("cx", (d, i) => x(xLabels[i]))
            .attr("cy", d => y(d))
            .attr("r", 4).attr("fill", color).attr("stroke", "#111").attr("stroke-width", 1.5);

        // Value labels
        if (xLabels.length <= 15) {
            svg.selectAll(`.lbl-${ds.label}`).data(ds.values).enter()
              .append("text")
                .attr("x", (d, i) => x(xLabels[i]))
                .attr("y", d => y(d) - 10)
                .attr("text-anchor", "middle")
                .attr("fill", "#e0e0e0").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
                .text(d => d.toFixed(3));
        }
    });

    // Legend
    if (datasets.length > 1) {
        const legend = svg.append("g").attr("transform", `translate(${width - 120}, -10)`);
        datasets.forEach((ds, i) => {
            legend.append("rect").attr("x", 0).attr("y", i * 16).attr("width", 12).attr("height", 3).attr("fill", ds.color || "#00e5a0");
            legend.append("text").attr("x", 16).attr("y", i * 16 + 4)
                .attr("fill", "#888").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
                .text(ds.label || "");
        });
    }
}


function drawDonutChart(container, entries, colorMap) {
    const size = 200;
    const radius = size / 2;
    const innerRadius = radius * 0.55;
    const total = entries.reduce((s, [, v]) => s + v, 0);

    const svg = d3.select(container).append("svg")
        .attr("width", container.clientWidth)
        .attr("height", size + 20)
      .append("g")
        .attr("transform", `translate(${size / 2 + 10}, ${size / 2 + 10})`);

    const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);
    const pie = d3.pie().value(d => d[1]).sort(null);

    svg.selectAll("path").data(pie(entries)).enter()
      .append("path")
        .attr("d", arc)
        .attr("fill", d => colorMap[d.data[0]] || "#888")
        .attr("stroke", "#111")
        .attr("stroke-width", 1.5);

    // Center total
    svg.append("text")
        .attr("text-anchor", "middle").attr("dy", "-0.1em")
        .attr("fill", "#e0e0e0").style("font-size", "22px").style("font-weight", "700").style("font-family", "'JetBrains Mono', monospace")
        .text(total);
    svg.append("text")
        .attr("text-anchor", "middle").attr("dy", "1.3em")
        .attr("fill", "#888").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
        .text("events");

    // Legend to the right
    const legend = d3.select(container).select("svg").append("g")
        .attr("transform", `translate(${size + 30}, 20)`);

    entries.forEach(([label, count], i) => {
        const pct = (count / total * 100).toFixed(0);
        legend.append("rect").attr("x", 0).attr("y", i * 20).attr("width", 10).attr("height", 10)
            .attr("rx", 2).attr("fill", colorMap[label] || "#888");
        legend.append("text").attr("x", 16).attr("y", i * 20 + 9)
            .attr("fill", "#888").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace")
            .text(`${label} ${count} (${pct}%)`);
    });
}


function drawHistogram(container, values) {
    const margin = {top: 20, right: 30, bottom: 40, left: 70};
    const width = container.clientWidth - margin.left - margin.right;
    const height = 200 - margin.top - margin.bottom;

    const svg = d3.select(container).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
      .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, 1]).range([0, width]);
    const bins = d3.bin().domain([0, 1]).thresholds(20)(values);
    const y = d3.scaleLinear().domain([0, d3.max(bins, d => d.length)]).range([height, 0]);

    // Grid
    svg.append("g").attr("class", "d3-grid")
        .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""))
        .selectAll("line").attr("stroke", "#2a2a2a");
    svg.selectAll(".d3-grid .domain").remove();

    // Bars
    svg.selectAll("rect").data(bins).enter()
      .append("rect")
        .attr("x", d => x(d.x0) + 1)
        .attr("y", d => y(d.length))
        .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
        .attr("height", d => height - y(d.length))
        .attr("fill", d => {
            const mid = (d.x0 + d.x1) / 2;
            return mid >= 0.7 ? "#00e5a0" : (mid >= 0.3 ? "#e5a000" : "#e55050");
        })
        .attr("rx", 1)
        .attr("fill-opacity", 0.8);

    // Axes
    svg.append("g").attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d => (d * 100).toFixed(0) + "%"))
        .selectAll("text").attr("fill", "#888").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace");

    svg.append("g").attr("class", "d3-axis")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")))
        .selectAll("text").attr("fill", "#888").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace");
    svg.selectAll(".d3-axis .domain, .d3-axis line").attr("stroke", "#2a2a2a");

    // Y label
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -margin.left + 20).attr("x", -height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#666").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
        .text("Events");
}


function renderCharts(data) {
    const grid = document.getElementById("charts-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const chapters = data.chapters || [];
    if (chapters.length === 0) return;

    // Aggregate data
    const methodAggregates = {};
    const chapterRougeL = [];
    const chapterPassages = [];
    const iterationScores = {};
    const MIN_TOKENS = 40;
    const MAX_MISMATCH = 5;

    chapters.forEach((ch, ci) => {
        let chWeightedSum = 0, chRefWords = 0, chPassages = 0;
        const events = ch.events || [];

        events.forEach(ev => {
            const goldText = ev.text_segment || "";
            if (!goldText.trim()) return;
            const llm = ev.LLM_completions || {};
            const agent = llm.Agent_Extraction || {};

            const methods = {
                "Prefix Probing": llm["prefix-probing"] || "",
                "Agent": agent.simple_agent_extraction || "",
                "Jailbreak": agent.simple_agent_jailbreak || agent.simple_agent_extraction || "",
            };

            const refinedKeys = Object.keys(agent)
                .filter(k => k.startsWith("simple_agent_extraction_refined_") && k.match(/_\d+$/))
                .sort((a, b) => parseInt(b.split("_").pop()) - parseInt(a.split("_").pop()));
            if (refinedKeys.length > 0) {
                const best = agent[refinedKeys[0]];
                methods["RECAP"] = typeof best === "object" ? (best.text || "") : (best || "");
            }

            for (const [method, text] of Object.entries(methods)) {
                if (!text || text.includes("MODEL_RESPONSE_BLOCKED")) continue;
                const r = computeRougeL(goldText, text);
                if (!methodAggregates[method]) methodAggregates[method] = {weightedSum: 0, totalRefWords: 0};
                methodAggregates[method].weightedSum += r.score * r.refLen;
                methodAggregates[method].totalRefWords += r.refLen;
            }

            const info = _getEventExtractionInfo(ev);
            if (!info.isBlocked) {
                chWeightedSum += info.score * info.refLen;
                chRefWords += info.refLen;
                chPassages += countMemorizedPassages(goldText, info.extractedText, MIN_TOKENS, MAX_MISMATCH);
            }

            const baseText = agent.simple_agent_jailbreak || agent.simple_agent_extraction || "";
            if (baseText && !baseText.includes("MODEL_RESPONSE_BLOCKED")) {
                const baseR = computeRougeL(goldText, baseText);
                if (!iterationScores[0]) iterationScores[0] = {weightedSum: 0, totalRefWords: 0};
                iterationScores[0].weightedSum += baseR.score * baseR.refLen;
                iterationScores[0].totalRefWords += baseR.refLen;
            }
            for (let ri = 0; ri <= 10; ri++) {
                const rk = `simple_agent_extraction_refined_${ri}`;
                if (agent[rk]) {
                    const rt = typeof agent[rk] === "object" ? (agent[rk].text || "") : (agent[rk] || "");
                    if (rt && !rt.includes("MODEL_RESPONSE_BLOCKED")) {
                        const rr = computeRougeL(goldText, rt);
                        const iter = ri + 1;
                        if (!iterationScores[iter]) iterationScores[iter] = {weightedSum: 0, totalRefWords: 0};
                        iterationScores[iter].weightedSum += rr.score * rr.refLen;
                        iterationScores[iter].totalRefWords += rr.refLen;
                    }
                }
            }
        });

        const chLabel = ch.chapter_title || `Ch ${ci + 1}`;
        chapterRougeL.push({label: chLabel, value: chRefWords > 0 ? chWeightedSum / chRefWords : 0});
        chapterPassages.push({label: chLabel, value: chPassages});
    });

    function makeChartDiv(titleText) {
        const container = document.createElement("div");
        container.className = "chart-container";
        const titleRow = document.createElement("div");
        titleRow.className = "chart-title-row";
        const title = document.createElement("div");
        title.className = "chart-title";
        title.textContent = titleText;
        const expandBtn = document.createElement("button");
        expandBtn.className = "chart-expand-btn";
        expandBtn.innerHTML = "⛶";
        expandBtn.title = "Expand chart";
        expandBtn.addEventListener("click", () => _openChartModal(container, titleText));
        titleRow.appendChild(title);
        titleRow.appendChild(expandBtn);
        container.appendChild(titleRow);
        grid.appendChild(container);
        return container;
    }

    // 1. Method Comparison
    const methodNames = Object.keys(methodAggregates);
    if (methodNames.length > 0) {
        const methodOrder = ["Prefix Probing", "Agent", "Jailbreak", "RECAP"];
        const orderedMethods = methodOrder.filter(m => methodNames.includes(m));
        methodNames.forEach(m => { if (!orderedMethods.includes(m)) orderedMethods.push(m); });

        const mValues = orderedMethods.map(m => {
            const a = methodAggregates[m];
            return a.totalRefWords > 0 ? a.weightedSum / a.totalRefWords : 0;
        });
        const mColors = orderedMethods.map(m => {
            if (m === "RECAP") return "#00e5a0";
            if (m === "Jailbreak") return "#5bc0de";
            if (m === "Agent") return "#e5a000";
            if (m === "Prefix Probing") return "#e55050";
            return "#888";
        });
        drawBarChart(makeChartDiv("ROUGE-L by Extraction Method"), orderedMethods, mValues,
                     {yLabel: "ROUGE-L", maxVal: 1.0, colors: mColors});
    }

    // 2. Per-Chapter ROUGE-L
    if (chapterRougeL.length > 0) {
        drawBarChart(makeChartDiv("ROUGE-L by Chapter"), chapterRougeL.map(c => c.label), chapterRougeL.map(c => c.value),
                     {yLabel: "ROUGE-L", maxVal: 1.0});
    }

    // 3. Feedback Iteration
    const iterKeys = Object.keys(iterationScores).map(Number).sort((a, b) => a - b);
    if (iterKeys.length > 1) {
        const iLabels = iterKeys.map(k => k === 0 ? "Base" : `Iter ${k}`);
        const iValues = iterKeys.map(k => {
            const s = iterationScores[k];
            return s.totalRefWords > 0 ? s.weightedSum / s.totalRefWords : 0;
        });
        drawLineChart(makeChartDiv("ROUGE-L by Feedback Iteration"), iLabels,
                      [{label: "ROUGE-L", values: iValues, color: "#00e5a0"}], {yLabel: "ROUGE-L"});
    }

    // 4. Passages per Chapter
    if (chapterPassages.some(c => c.value > 0)) {
        drawBarChart(makeChartDiv("Memorized Passages by Chapter"), chapterPassages.map(c => c.label), chapterPassages.map(c => c.value),
                     {yLabel: "Passages"});
    }

    // P7: 5. Extraction Source Donut Chart
    const sourceCounts = {};
    const sourceColors = {"Prefix Probing": "#e55050", "Agent": "#e5a000", "Jailbreak": "#5bc0de", "Refined": "#00e5a0", "No extraction": "#555", "Blocked": "#888"};
    chapters.forEach(ch => {
        (ch.events || []).forEach(ev => {
            const info = _getEventExtractionInfo(ev);
            if (info.isBlocked) {
                sourceCounts["Blocked"] = (sourceCounts["Blocked"] || 0) + 1;
            } else {
                const method = info.extractionLabel.startsWith("Refined") ? "Refined" : info.extractionLabel;
                sourceCounts[method] = (sourceCounts[method] || 0) + 1;
            }
        });
    });

    const sourceEntries = Object.entries(sourceCounts).filter(([, v]) => v > 0);
    if (sourceEntries.length > 0) {
        drawDonutChart(makeChartDiv("Extraction Source Distribution"), sourceEntries, sourceColors);
    }

    // P7: 6. ROUGE-L Score Histogram
    const allScores = [];
    chapters.forEach(ch => {
        (ch.events || []).forEach(ev => {
            const info = _getEventExtractionInfo(ev);
            if (!info.isBlocked) allScores.push(info.score);
        });
    });

    if (allScores.length > 0) {
        drawHistogram(makeChartDiv("ROUGE-L Score Distribution"), allScores);
    }

    // 7. Per-Event ROUGE-L Line Chart
    const perEventScores = [];
    const chapterBoundaries = [];  // { startIdx, label }
    let eventIdx = 0;
    chapters.forEach((ch, ci) => {
        chapterBoundaries.push({ startIdx: eventIdx, label: ch.chapter_title || `Ch ${ci + 1}` });
        (ch.events || []).forEach(ev => {
            const info = _getEventExtractionInfo(ev);
            perEventScores.push(info.isBlocked ? 0 : info.score);
            eventIdx++;
        });
    });

    if (perEventScores.length > 0) {
        const evChartDiv = makeChartDiv("ROUGE-L by Event (sequential)");
        evChartDiv.classList.add("chart-container--full");
        drawEventRougeLine(evChartDiv, perEventScores, chapterBoundaries);
    }
}


function _renderEventRougeLine(container, scores, chapterBoundaries, isModal) {
    const numCh = chapterBoundaries.length;
    const margin = {top: 20, right: 30, bottom: 36, left: 60}; // increased right margin slightly for avg label
    
    // In modal, container has 32px horizontal padding each side that clientWidth includes
    const paddingX = isModal ? 64 : 0; 
    const containerWidth = (container.clientWidth || 400) - paddingX;
    
    const width = Math.max(200, containerWidth - margin.left - margin.right);
    const height = (isModal ? 420 : 200) - margin.top - margin.bottom;
    const totalW = width + margin.left + margin.right;
    const totalH = height + margin.top + margin.bottom;

    const svg = d3.select(container).append("svg")
        .attr("width", totalW)
        .attr("height", totalH)
        .style("max-width", "100%")
        .style("display", "block")
      .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([0, scores.length - 1]).range([0, width]);
    const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

    // Grid
    svg.append("g").attr("class", "d3-grid")
        .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""))
        .selectAll("line").attr("stroke", "#2a2a2a");
    svg.selectAll(".d3-grid .domain").remove();

    // Y-axis
    svg.append("g").attr("class", "d3-axis")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".2f")))
        .selectAll("text").attr("fill", "#888").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace");
    svg.selectAll(".d3-axis .domain, .d3-axis line").attr("stroke", "#2a2a2a");

    // Y-axis label
    svg.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -margin.left + 16).attr("x", -height / 2)
        .attr("text-anchor", "middle")
        .attr("fill", "#666").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
        .text("ROUGE-L");

    // Chapter boundary lines and labels on x-axis
    const chapterColors = ["rgba(0,229,160,0.06)", "rgba(91,192,222,0.06)"];
    // Compute available pixel width per chapter for label truncation
    chapterBoundaries.forEach((ch, ci) => {
        const nextStart = ci < chapterBoundaries.length - 1 ? chapterBoundaries[ci + 1].startIdx : scores.length;
        const x0 = x(ch.startIdx);
        const x1 = x(nextStart - 1);
        const bandWidth = x1 - x0;
        const midX = (x0 + x1) / 2;

        // Alternating background bands
        svg.append("rect")
            .attr("x", x0).attr("y", 0)
            .attr("width", Math.max(0, bandWidth))
            .attr("height", height)
            .attr("fill", chapterColors[ci % 2]);

        // Vertical boundary line (skip first)
        if (ci > 0) {
            svg.append("line")
                .attr("x1", x0).attr("x2", x0)
                .attr("y1", 0).attr("y2", height)
                .attr("stroke", "#3a3a3a").attr("stroke-width", 1)
                .attr("stroke-dasharray", "3,3");
        }

        // Chapter number label below x-axis
        const labelY = height + 14;
        svg.append("text")
            .attr("x", midX).attr("y", labelY)
            .attr("text-anchor", "middle")
            .attr("fill", "#666").style("font-size", "9px").style("font-family", "'JetBrains Mono', monospace")
            .text(ci + 1);
    });

    // X-axis line
    svg.append("line")
        .attr("x1", 0).attr("x2", width)
        .attr("y1", height).attr("y2", height)
        .attr("stroke", "#2a2a2a");

    // Area fill
    svg.append("path")
        .datum(scores)
        .attr("fill", "#00e5a0").attr("fill-opacity", 0.08)
        .attr("d", d3.area()
            .x((d, i) => x(i))
            .y0(height)
            .y1(d => y(d)));

    // Line
    svg.append("path")
        .datum(scores)
        .attr("fill", "none").attr("stroke", "#00e5a0").attr("stroke-width", 2)
        .attr("d", d3.line().x((d, i) => x(i)).y(d => y(d)));

    // Average reference line — rendered last so it's on top
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    svg.append("line")
        .attr("x1", 0).attr("x2", width)
        .attr("y1", y(avg)).attr("y2", y(avg))
        .attr("stroke", "#e5a000").attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4").attr("opacity", 0.7);

    // Average label with background rect for readability
    const avgLabelText = `avg ${avg.toFixed(3)}`;
    const avgLabel = svg.append("g");
    const avgTextNode = avgLabel.append("text")
        .attr("x", width - 4).attr("y", y(avg) - 8)
        .attr("text-anchor", "end")
        .attr("fill", "#e5a000").style("font-size", "10px").style("font-family", "'JetBrains Mono', monospace")
        .text(avgLabelText);
    // Add background behind the text
    const bbox = avgTextNode.node().getBBox();
    avgLabel.insert("rect", "text")
        .attr("x", bbox.x - 3).attr("y", bbox.y - 1)
        .attr("width", bbox.width + 6).attr("height", bbox.height + 2)
        .attr("fill", "var(--bg-panel, #111)").attr("rx", 2).attr("opacity", 0.9);

    // Tooltip overlay for hover
    const focus = svg.append("g").style("display", "none");
    focus.append("line").attr("class", "focus-vline")
        .attr("y1", 0).attr("y2", height)
        .attr("stroke", "#555").attr("stroke-width", 1).attr("stroke-dasharray", "2,2");
    focus.append("circle").attr("r", 5).attr("fill", "#00e5a0").attr("stroke", "#111").attr("stroke-width", 2);
    // Tooltip background + text
    const tooltipG = focus.append("g").attr("class", "focus-tooltip");
    tooltipG.append("rect").attr("class", "focus-bg")
        .attr("rx", 3).attr("fill", "#222").attr("stroke", "#444").attr("stroke-width", 1);
    tooltipG.append("text").attr("class", "focus-label")
        .attr("fill", "#e0e0e0").style("font-size", "11px").style("font-family", "'JetBrains Mono', monospace");

    svg.append("rect")
        .attr("width", width).attr("height", height)
        .attr("fill", "none").attr("pointer-events", "all")
        .on("mouseover", () => focus.style("display", null))
        .on("mouseout", () => focus.style("display", "none"))
        .on("mousemove", function(event) {
            const mx = d3.pointer(event, this)[0];
            const idx = Math.round(x.invert(mx));
            const ci = Math.max(0, Math.min(scores.length - 1, idx));
            // Find which chapter this event belongs to
            let chapterLabel = "";
            for (let k = chapterBoundaries.length - 1; k >= 0; k--) {
                if (ci >= chapterBoundaries[k].startIdx) {
                    chapterLabel = chapterBoundaries[k].label;
                    break;
                }
            }
            const tipText = `#${ci + 1}: ${(scores[ci] * 100).toFixed(1)}% · ${chapterLabel}`;
            focus.attr("transform", `translate(${x(ci)},0)`);
            focus.select("circle").attr("cy", y(scores[ci]));
            focus.select(".focus-vline").attr("x1", 0).attr("x2", 0);
            const textEl = focus.select(".focus-label")
                .attr("x", 10).attr("y", 16)
                .text(tipText);
            const tb = textEl.node().getBBox();
            // Flip tooltip to left side if near right edge
            const flipX = x(ci) > width - tb.width - 30;
            textEl.attr("x", flipX ? -tb.width - 10 : 10);
            focus.select(".focus-bg")
                .attr("x", flipX ? -tb.width - 16 : 4)
                .attr("y", tb.y - 4)
                .attr("width", tb.width + 12).attr("height", tb.height + 8);
        });
}

function drawEventRougeLine(container, scores, chapterBoundaries) {
    if (scores.length === 0) {
        d3.select(container).append("div").attr("class", "chart-empty").text("No data");
        return;
    }
    // Store draw function for modal re-rendering
    container._chartDrawFn = (target, modal) => _renderEventRougeLine(target, scores, chapterBoundaries, modal);
    _renderEventRougeLine(container, scores, chapterBoundaries, false);
}


function _openChartModal(chartContainer, titleText) {
    // Remove existing modal if any
    const existing = document.getElementById("chart-modal-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "chart-modal-overlay";
    overlay.className = "chart-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "chart-modal";

    const header = document.createElement("div");
    header.className = "chart-modal-header";
    header.innerHTML = `<span class="chart-modal-title">${escapeHtml(titleText)}</span>`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "chart-modal-close";
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", () => overlay.remove());
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.className = "chart-modal-body";

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // If the chart has a re-render function, use it for full interactivity
    if (chartContainer._chartDrawFn) {
        // Use requestAnimationFrame so body has layout dimensions
        requestAnimationFrame(() => {
            chartContainer._chartDrawFn(body, true);
        });
    } else {
        // Fallback: clone SVG with viewBox scaling
        const originalSvg = chartContainer.querySelector("svg");
        if (originalSvg) {
            const clonedSvg = originalSvg.cloneNode(true);
            clonedSvg.style.width = "100%";
            clonedSvg.style.height = "auto";
            clonedSvg.setAttribute("viewBox", `0 0 ${originalSvg.getAttribute("width")} ${originalSvg.getAttribute("height")}`);
            clonedSvg.removeAttribute("width");
            clonedSvg.removeAttribute("height");
            clonedSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
            body.appendChild(clonedSvg);
        }
    }

    // Close on overlay click
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === "Escape") {
            overlay.remove();
            document.removeEventListener("keydown", escHandler);
        }
    };
    document.addEventListener("keydown", escHandler);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add("active"));
}


function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function truncateFilename(filepath, maxLen) {
    // Extract just the filename from a path like "folder/sub/file.txt"
    const name = filepath.includes("/") ? filepath.split("/").pop() : filepath;
    maxLen = maxLen || 40;
    if (name.length <= maxLen) return name;
    const dotIdx = name.lastIndexOf(".");
    if (dotIdx === -1) return name.slice(0, maxLen - 1) + "\u2026";
    const ext = name.slice(dotIdx);            // ".epub"
    const stem = name.slice(0, dotIdx);        // "very_long_name..."
    const available = maxLen - ext.length - 1;  // room for stem + ellipsis
    if (available < 1) return "\u2026" + ext;
    return stem.slice(0, available) + "\u2026" + ext;
}
