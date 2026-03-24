#!/usr/bin/env python3
"""
RECAP Demo — Flask Web Application
-----------------------------------
A visual demo for the RECAP verbatim extraction pipeline.
Upload a book (TXT, EPUB, PDF), configure models, and see extraction results.
"""

import json
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from queue import Queue

from flask import (
    Flask, render_template, request, jsonify,
    Response, send_from_directory, redirect, url_for
)
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Add Code directory to path so we can import RECAP modules
CODE_DIR = Path(__file__).resolve().parent.parent / "Code"
sys.path.insert(0, str(CODE_DIR))

# Heavy ML imports (torch, transformers) are lazy-loaded inside extraction_utils.
# Pre-warm lightweight pipeline modules in a background thread so the first
# pipeline run doesn't pay the import cost.
def _prewarm_imports():
    try:
        import openai          # noqa: F401
        import tqdm            # noqa: F401
        from book_preprocessor import preprocess_book  # noqa: F401
        from extraction_utils import BookExtractionTask  # noqa: F401
    except Exception:
        pass

threading.Thread(target=_prewarm_imports, daemon=True).start()

load_dotenv()

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 100 * 1024 * 1024  # 100 MB upload limit
app.config["UPLOAD_FOLDER"] = Path(__file__).resolve().parent / "uploads"
app.config["RESULTS_FOLDER"] = Path(__file__).resolve().parent / "results"

ALLOWED_EXTENSIONS = {"txt", "epub", "pdf"}

# In-memory task store
tasks = {}   # task_id -> task info dict
task_logs = {}  # task_id -> Queue of log messages
task_controls = {}  # task_id -> {"pause": threading.Event, "cancel": bool}

# ---------------------------------------------------------------------------
# Task persistence (survives server restarts)
# ---------------------------------------------------------------------------
TASK_STATE_FOLDER = Path(__file__).resolve().parent / "task_state"
TASK_STATE_FOLDER.mkdir(parents=True, exist_ok=True)
_persist_lock = threading.Lock()


def _persist_task(task_id):
    """Write task metadata to disk (atomic write)."""
    task = tasks.get(task_id)
    if not task:
        return
    task["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = TASK_STATE_FOLDER / f"{task_id}.tmp"
    dst = TASK_STATE_FOLDER / f"{task_id}.json"
    with _persist_lock:
        with open(str(tmp), "w", encoding="utf-8") as f:
            json.dump(task, f, indent=2, ensure_ascii=False)
        os.replace(str(tmp), str(dst))


def _delete_task_state(task_id):
    """Remove persisted task state file."""
    path = TASK_STATE_FOLDER / f"{task_id}.json"
    with _persist_lock:
        if path.exists():
            path.unlink()


def _load_persisted_tasks():
    """Load persisted tasks on startup. Mark in-progress ones as interrupted."""
    for f in TASK_STATE_FOLDER.glob("*.json"):
        try:
            with open(str(f), "r", encoding="utf-8") as fp:
                task = json.load(fp)
            task_id = task.get("id")
            if not task_id:
                continue
            # Tasks that were running when the server died → interrupted
            if task["status"] in ("starting", "preprocessing", "extracting", "paused"):
                task["status"] = "interrupted"
            tasks[task_id] = task
            # Re-persist if status changed
            _persist_task(task_id)
        except Exception:
            continue


_load_persisted_tasks()

app.config["TEMPLATES_AUTO_RELOAD"] = True
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0

@app.after_request
def add_header(r):
    r.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    r.headers["Pragma"] = "no-cache"
    r.headers["Expires"] = "0"
    return r


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ---------------------------------------------------------------------------
# Model & provider configuration
# ---------------------------------------------------------------------------

# Provider defaults: first model in list is the default for that provider
PROVIDER_DEFAULTS = {
    "gemini": "gemini-2.5-flash",
    "openai": "gpt-5.4-mini",
    "deepseek": "deepseek-chat",
    "anthropic": "claude-sonnet-4-6",
}

# Priority order when choosing which provider to default to
PROVIDER_PRIORITY = ["gemini", "openai", "deepseek", "anthropic"]

KEY_ENV_MAP = {
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
}


def _get_configured_providers():
    """Return dict of provider -> bool indicating if an API key is set."""
    return {
        provider: bool(os.environ.get(env_var, "").strip())
        for provider, env_var in KEY_ENV_MAP.items()
    }


def _get_default_provider():
    """Return the first provider that has an API key configured."""
    configured = _get_configured_providers()
    for provider in PROVIDER_PRIORITY:
        if configured.get(provider):
            return provider
    return "gemini"  # fallback


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Render the main upload page."""
    configured = _get_configured_providers()
    default_provider = _get_default_provider()
    default_model = PROVIDER_DEFAULTS.get(default_provider, "gemini-3-flash-lite")
    # Pass env key values so the form can pre-fill them (masked in UI)
    env_keys = {
        provider: os.environ.get(env_var, "")
        for provider, env_var in KEY_ENV_MAP.items()
    }
    return render_template(
        "index.html",
        configured=configured,
        default_provider=default_provider,
        default_model=default_model,
        env_keys=env_keys,
    )


@app.route("/api/config")
def api_config():
    """Return provider configuration for frontend auto-defaults."""
    configured = _get_configured_providers()
    default_provider = _get_default_provider()
    return jsonify({
        "configured": configured,
        "default_provider": default_provider,
        "default_model": PROVIDER_DEFAULTS.get(default_provider, "gemini-3-flash-lite"),
        "provider_defaults": PROVIDER_DEFAULTS,
    })


@app.route("/results")
def results_browser():
    """Render the results browser page."""
    return render_template("browse.html")


@app.route("/tasks")
def tasks_page():
    """Render the tasks page."""
    return render_template("tasks.html")


@app.route("/api/validate-keys", methods=["POST"])
def api_validate_keys():
    """Validate that required API keys work before starting the pipeline."""
    from concurrent.futures import ThreadPoolExecutor

    data = request.get_json() or {}
    models = [data.get("target_model"), data.get("feedback_model"),
              data.get("evaluation_model"), data.get("preprocessing_model")]
    api_keys = data.get("api_keys", {})

    # Determine which providers are needed based on selected models
    needed = set()
    for m in models:
        if not m:
            continue
        ml = m.lower()
        if "gemini" in ml:
            needed.add("gemini")
        elif "gpt" in ml or "o1" in ml or "o3" in ml or "o4" in ml:
            needed.add("openai")
        elif "claude" in ml:
            needed.add("anthropic")
        elif "deepseek" in ml:
            needed.add("deepseek")

    if not needed:
        return jsonify({"valid": False, "errors": ["Could not determine required providers from selected models."]}), 400

    PROVIDER_BASE_URLS = {
        "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "deepseek": "https://api.deepseek.com/v1/",
    }

    def _validate_provider(provider):
        key = (api_keys.get(provider) or "").strip()
        if not key:
            key = os.environ.get(KEY_ENV_MAP.get(provider, ""), "").strip()
        if not key:
            return f"No API key provided for {provider} (required by selected models)"
        try:
            from openai import OpenAI
            kwargs = {"api_key": key, "timeout": 10.0}
            if provider in PROVIDER_BASE_URLS:
                kwargs["base_url"] = PROVIDER_BASE_URLS[provider]
            client = OpenAI(**kwargs)
            # Lightweight auth check — tiny completion
            test_model = PROVIDER_DEFAULTS.get(provider, "gpt-4o-mini")
            client.chat.completions.create(
                model=test_model,
                messages=[{"role": "user", "content": "Hi"}],
                max_tokens=1,
            )
            return None  # success
        except Exception as e:
            err = str(e)
            # Extract a concise message
            if "authentication" in err.lower() or "api key" in err.lower() or "401" in err:
                return f"{provider}: Invalid API key"
            if "404" in err or "not found" in err.lower():
                return None  # Model not found but key is valid
            return f"{provider}: {err[:150]}"

    errors = []
    with ThreadPoolExecutor(max_workers=len(needed)) as pool:
        results = pool.map(_validate_provider, needed)
        errors = [e for e in results if e is not None]

    if errors:
        return jsonify({"valid": False, "errors": errors}), 400
    return jsonify({"valid": True})


@app.route("/upload", methods=["POST"])
def upload():
    """Handle book upload and start the extraction pipeline."""
    existing_file = request.form.get("existing_file", "").strip()

    if existing_file:
        # Use a previously uploaded book
        app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
        filepath = (app.config["UPLOAD_FOLDER"] / existing_file).resolve()
        # Prevent path traversal
        if not str(filepath).startswith(str(app.config["UPLOAD_FOLDER"].resolve())):
            return jsonify({"error": "Invalid file path"}), 403
        if not filepath.exists():
            return jsonify({"error": "Selected file no longer exists"}), 404
        filename = filepath.name
    else:
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files["file"]
        if file.filename == "" or not allowed_file(file.filename):
            return jsonify({"error": "Invalid file. Please upload a .txt, .epub, or .pdf file."}), 400

        # Save uploaded file
        app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
        filename = secure_filename(file.filename)
        filepath = app.config["UPLOAD_FOLDER"] / filename
        file.save(str(filepath))

    # Get settings from form (defaults come from env-configured provider)
    default_provider = _get_default_provider()
    fallback = PROVIDER_DEFAULTS.get(default_provider, "gemini-3-flash-lite")
    target_model = request.form.get("target_model", fallback)
    feedback_model = request.form.get("feedback_model", fallback)
    evaluation_model = request.form.get("evaluation_model", fallback)
    preprocessing_model = request.form.get("preprocessing_model", fallback)

    api_keys = {}
    for key_name in ["openai", "gemini", "anthropic", "deepseek"]:
        # Prefer form value, fall back to env var
        val = request.form.get(f"api_key_{key_name}", "").strip()
        if not val:
            val = os.environ.get(KEY_ENV_MAP[key_name], "").strip()
        if val:
            api_keys[key_name] = val

    # Set API keys as environment variables for this process
    for key_name, env_name in KEY_ENV_MAP.items():
        if key_name in api_keys:
            os.environ[env_name] = api_keys[key_name]

    # Create task
    task_id = str(uuid.uuid4())[:8]
    task_logs[task_id] = Queue()
    tasks[task_id] = {
        "id": task_id,
        "status": "starting",
        "filename": filename,
        "filepath": str(filepath),
        "target_model": target_model,
        "feedback_model": feedback_model,
        "evaluation_model": evaluation_model,
        "preprocessing_model": preprocessing_model,
        "progress": 0,
        "result_path": None,
        "preprocessed_path": None,
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "api_provider_keys": [k for k in api_keys if api_keys[k]],
    }
    _persist_task(task_id)

    # Set up task controls
    pause_event = threading.Event()
    pause_event.set()  # Not paused initially
    task_controls[task_id] = {"pause": pause_event, "cancel": False}

    # Start background thread
    thread = threading.Thread(
        target=_run_pipeline,
        args=(task_id, str(filepath), target_model, feedback_model,
              evaluation_model, preprocessing_model, api_keys),
        daemon=True,
    )
    thread.start()

    return jsonify({"task_id": task_id, "redirect": f"/progress/{task_id}"})


@app.route("/progress/<task_id>")
def progress_page(task_id):
    """Render the progress / results page."""
    task = tasks.get(task_id)
    if not task:
        return redirect(url_for("index"))
    return render_template("results.html", task_id=task_id, task=task)


@app.route("/status/<task_id>")
def status_stream(task_id):
    """SSE endpoint for streaming progress logs."""
    def generate():
        q = task_logs.get(task_id)
        if not q:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Unknown task'})}\n\n"
            return

        while True:
            try:
                msg = q.get(timeout=30)
                yield f"data: {json.dumps(msg)}\n\n"
                if msg.get("type") in ("complete", "error", "cancelled"):
                    break
            except Exception:
                # Send heartbeat
                yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/results/<task_id>")
def api_results(task_id):
    """Return extraction results as JSON."""
    task = tasks.get(task_id)
    if not task or not task.get("result_path"):
        return jsonify({"error": "Results not available"}), 404

    result_path = task["result_path"]
    if not os.path.exists(result_path):
        return jsonify({"error": "Results file not found"}), 404

    with open(result_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)


@app.route("/api/download/<task_id>")
def api_download(task_id):
    """Download extraction results as a JSON file."""
    task = tasks.get(task_id)
    if not task or not task.get("result_path"):
        return jsonify({"error": "Results not available"}), 404
    result_path = Path(task["result_path"])
    if not result_path.exists():
        return jsonify({"error": "File not found"}), 404
    return send_from_directory(
        str(result_path.parent), result_path.name,
        as_attachment=True, mimetype="application/json"
    )


@app.route("/api/download-saved/<path:filepath>")
def api_download_saved(filepath):
    """Download a saved result JSON file."""
    results_dir = app.config["RESULTS_FOLDER"]
    target = (results_dir / filepath).resolve()
    if not str(target).startswith(str(results_dir.resolve())):
        return jsonify({"error": "Invalid path"}), 403
    if not target.exists():
        return jsonify({"error": "File not found"}), 404
    return send_from_directory(
        str(target.parent), target.name,
        as_attachment=True, mimetype="application/json"
    )


@app.route("/api/task/<task_id>")
def api_task(task_id):
    """Return task status."""
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "Unknown task"}), 404
    return jsonify(task)


@app.route("/api/task/<task_id>/pause", methods=["POST"])
def api_pause(task_id):
    """Pause a running pipeline. It will stop after the current event finishes."""
    ctrl = task_controls.get(task_id)
    task = tasks.get(task_id)
    if not ctrl or not task:
        return jsonify({"error": "Unknown task"}), 404
    if task["status"] not in ("preprocessing", "extracting"):
        return jsonify({"error": f"Cannot pause task in state '{task['status']}'"}), 400
    ctrl["pause"].clear()  # Block the pipeline thread
    task["status"] = "paused"
    _persist_task(task_id)
    q = task_logs.get(task_id)
    if q:
        q.put({"type": "log", "message": "⏸ Pipeline paused. Progress has been saved."})
        q.put({"type": "paused", "message": "Pipeline paused"})
    return jsonify({"status": "paused"})


@app.route("/api/task/<task_id>/resume", methods=["POST"])
def api_resume(task_id):
    """Resume a paused pipeline."""
    ctrl = task_controls.get(task_id)
    task = tasks.get(task_id)
    if not ctrl or not task:
        return jsonify({"error": "Unknown task"}), 404
    if task["status"] != "paused":
        return jsonify({"error": f"Cannot resume task in state '{task['status']}'"}), 400
    task["status"] = "extracting"
    _persist_task(task_id)
    ctrl["pause"].set()  # Unblock the pipeline thread
    q = task_logs.get(task_id)
    if q:
        q.put({"type": "log", "message": "▶ Pipeline resumed."})
        q.put({"type": "resumed", "message": "Pipeline resumed"})
    return jsonify({"status": "extracting"})


@app.route("/api/task/<task_id>/cancel", methods=["POST"])
def api_cancel(task_id):
    """Cancel a running or paused pipeline. Progress is saved automatically."""
    ctrl = task_controls.get(task_id)
    task = tasks.get(task_id)
    if not ctrl or not task:
        return jsonify({"error": "Unknown task"}), 404
    if task["status"] not in ("preprocessing", "extracting", "paused"):
        return jsonify({"error": f"Cannot cancel task in state '{task['status']}'"}), 400
    ctrl["cancel"] = True
    ctrl["pause"].set()  # Unblock if paused so thread can exit
    task["status"] = "cancelled"
    _persist_task(task_id)
    q = task_logs.get(task_id)
    if q:
        q.put({"type": "log", "message": "✗ Pipeline cancelled. Progress has been saved."})
        q.put({"type": "cancelled", "message": "Pipeline cancelled"})
    return jsonify({"status": "cancelled"})


@app.route("/api/tasks")
def api_tasks():
    """Return all tasks, optionally filtered by status."""
    status_filter = request.args.get("status", "").strip()
    allowed = set(status_filter.split(",")) if status_filter else None
    result = []
    for t in tasks.values():
        if allowed and t.get("status") not in allowed:
            continue
        result.append(t)
    result.sort(key=lambda t: t.get("updated_at", ""), reverse=True)
    return jsonify(result)


@app.route("/api/task/<task_id>/restart", methods=["POST"])
def api_restart(task_id):
    """Restart an interrupted, cancelled, or errored task."""
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "Unknown task"}), 404
    if task["status"] not in ("interrupted", "cancelled", "error"):
        return jsonify({"error": f"Cannot restart task in state '{task['status']}'"}), 400

    # Validate the source file still exists
    if not Path(task["filepath"]).exists():
        return jsonify({"error": "Source file no longer exists on disk"}), 400

    # Rebuild API keys from environment variables
    api_keys = {}
    for provider in task.get("api_provider_keys", []):
        env_var = KEY_ENV_MAP.get(provider, "")
        val = os.environ.get(env_var, "").strip()
        if val:
            api_keys[provider] = val

    # Determine resume paths
    resume_preprocessed_path = task.get("preprocessed_path")
    resume_result_path = task.get("result_path")

    # Reset task state
    task["status"] = "starting"
    task["error"] = None
    task["progress"] = 0
    _persist_task(task_id)

    # Create fresh queue and controls
    task_logs[task_id] = Queue()
    pause_event = threading.Event()
    pause_event.set()
    task_controls[task_id] = {"pause": pause_event, "cancel": False}

    # Spawn pipeline thread
    thread = threading.Thread(
        target=_run_pipeline,
        args=(task_id, task["filepath"], task["target_model"],
              task["feedback_model"], task["evaluation_model"],
              task["preprocessing_model"], api_keys),
        kwargs={
            "resume_preprocessed_path": resume_preprocessed_path,
            "resume_result_path": resume_result_path,
        },
        daemon=True,
    )
    thread.start()

    return jsonify({"task_id": task_id, "redirect": f"/progress/{task_id}"})


@app.route("/api/task/<task_id>", methods=["DELETE"])
def api_delete_task(task_id):
    """Delete a task's persisted state (dismiss from UI)."""
    task = tasks.get(task_id)
    if not task:
        return jsonify({"error": "Unknown task"}), 404
    if task["status"] in ("starting", "preprocessing", "extracting", "paused"):
        return jsonify({"error": "Cannot delete a running task"}), 400
    tasks.pop(task_id, None)
    task_logs.pop(task_id, None)
    task_controls.pop(task_id, None)
    _delete_task_state(task_id)
    return jsonify({"status": "deleted"})


@app.route("/api/uploaded-books")
def api_uploaded_books():
    """List all previously uploaded book files."""
    uploads_dir = app.config["UPLOAD_FOLDER"]
    uploads_dir.mkdir(parents=True, exist_ok=True)
    books = []
    for f in sorted(uploads_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file() and f.suffix.lower() in {".txt", ".epub", ".pdf"}:
            books.append({
                "name": f.stem.replace("_", " ").replace("-", " "),
                "filename": f.name,
                "size": f.stat().st_size,
                "modified": f.stat().st_mtime,
            })
    return jsonify(books)


@app.route("/api/saved-results")
def api_saved_results():
    """List all saved result files in the results folder."""
    results_dir = app.config["RESULTS_FOLDER"]
    results_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for f in sorted(results_dir.glob("**/*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        rel = f.relative_to(results_dir)
        files.append({
            "name": f.stem,
            "path": str(rel).replace("\\", "/"),
            "size": f.stat().st_size,
            "modified": f.stat().st_mtime,
        })
    return jsonify(files)


@app.route("/api/saved-results/<path:filepath>")
def api_load_saved_result(filepath):
    """Load a saved result JSON file for visualization."""
    results_dir = app.config["RESULTS_FOLDER"]
    target = (results_dir / filepath).resolve()
    # Prevent path traversal
    if not str(target).startswith(str(results_dir.resolve())):
        return jsonify({"error": "Invalid path"}), 403
    if not target.exists():
        return jsonify({"error": "File not found"}), 404
    with open(target, "r", encoding="utf-8") as f:
        data = json.load(f)
    return jsonify(data)


@app.route("/view/<path:filepath>")
def view_saved_result(filepath):
    """Render the results page for a previously saved result."""
    results_dir = app.config["RESULTS_FOLDER"]
    target = (results_dir / filepath).resolve()
    if not str(target).startswith(str(results_dir.resolve())) or not target.exists():
        return redirect(url_for("index"))
    task = {
        "filename": Path(filepath).name,
        "status": "complete",
    }
    return render_template("results.html", task_id=None, task=task,
                           saved_result_path=filepath)


# ---------------------------------------------------------------------------
# Background pipeline
# ---------------------------------------------------------------------------

class PipelineCancelled(Exception):
    """Raised when the user cancels the pipeline."""
    pass


def _check_controls(task_id, log_fn):
    """Check pause/cancel controls. Blocks if paused, raises if cancelled."""
    ctrl = task_controls.get(task_id)
    if not ctrl:
        return
    if ctrl["cancel"]:
        raise PipelineCancelled()
    # Block here if paused (Event is cleared)
    ctrl["pause"].wait()
    # Check cancel again after resuming from pause
    if ctrl["cancel"]:
        raise PipelineCancelled()


def _save_pipeline_log(result_path: str, logs: list):
    """Append the pipeline log to the result JSON file."""
    try:
        with open(result_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["pipeline_log"] = logs
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception:
        pass  # Non-critical — don't break the pipeline for log persistence


def _run_pipeline(task_id, filepath, target_model, feedback_model,
                  evaluation_model, preprocessing_model, api_keys,
                  resume_preprocessed_path=None, resume_result_path=None):
    """Run the full pipeline in a background thread."""
    q = task_logs[task_id]
    task = tasks[task_id]
    collected_logs = []

    def log(msg):
        collected_logs.append(msg)
        q.put({"type": "log", "message": msg})

    try:
        import time as _time
        t0 = _time.monotonic()

        def tlog(msg):
            elapsed = _time.monotonic() - t0
            log(f"[{elapsed:6.1f}s] {msg}")

        tlog("━━━ Initializing Pipeline ━━━")
        tlog(f"File: {Path(filepath).name}")
        tlog(f"Target: {target_model}  |  Feedback: {feedback_model}")
        tlog(f"Evaluator: {evaluation_model}  |  Preprocessor: {preprocessing_model}")
        configured = [k for k in api_keys if api_keys[k]]
        tlog(f"API keys: {', '.join(configured) if configured else 'none'}")

        # Lazy imports
        _check_controls(task_id, log)
        tlog("Loading book_preprocessor...")
        from book_preprocessor import preprocess_book
        tlog("Loading extraction_utils...")

        _check_controls(task_id, log)
        from extraction_utils import BookExtractionTask
        tlog("Modules ready.")

        # Redirect stdout/stderr for the ENTIRE pipeline so nothing is lost
        import io

        class LogCapture(io.TextIOBase):
            def write(self, s):
                if not s:
                    return 0
                for line in s.splitlines():
                    line = line.strip()
                    if line:
                        log(line)
                return len(s)

            def flush(self):
                pass

        capture = LogCapture()
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        sys.stdout = capture
        sys.stderr = capture

        try:
            _check_controls(task_id, log)

            # ---- Step 1: Preprocess book ----
            if resume_preprocessed_path and Path(resume_preprocessed_path).exists():
                tlog("━━━ Step 1/2: Preprocessing (skipped — resuming) ━━━")
                preprocessed_path = Path(resume_preprocessed_path)
                with open(str(preprocessed_path), "r", encoding="utf-8") as f:
                    json_data = json.load(f)
                total_events = sum(len(ch.get("events", [])) for ch in json_data.get("chapters", []))
                tlog(f"Loaded preprocessed data: {len(json_data.get('chapters', []))} chapters, {total_events} events")
            else:
                task["status"] = "preprocessing"
                _persist_task(task_id)
                tlog("━━━ Step 1/2: Preprocessing Book ━━━")
                tlog(f"Converting {Path(filepath).name} into structured format...")

                json_data = preprocess_book(
                    filepath=filepath,
                    model_name=preprocessing_model,
                    api_keys=api_keys,
                    progress_callback=log,
                )

                # Save preprocessed JSON
                book_name = json_data.get("book_name", Path(filepath).stem)
                preprocessed_dir = Path(filepath).parent
                preprocessed_path = preprocessed_dir / f"{book_name}_summary_{preprocessing_model}.json"
                with open(str(preprocessed_path), "w", encoding="utf-8") as f:
                    json.dump(json_data, f, indent=2, ensure_ascii=False)

                total_events = sum(len(ch.get("events", [])) for ch in json_data.get("chapters", []))
                tlog(f"✓ Preprocessing complete: {len(json_data['chapters'])} chapters, {total_events} events")

            task["preprocessed_path"] = str(preprocessed_path)
            _persist_task(task_id)
            _check_controls(task_id, log)

            # ---- Step 2: Run extraction ----
            task["status"] = "extracting"
            task["progress"] = 30
            _persist_task(task_id)
            tlog("━━━ Step 2/2: Running RECAP Extraction ━━━")

            # Build keys lists
            gemini_keys = ["GEMINI_API_KEY"] if api_keys.get("gemini") else None
            openai_keys = ["OPENAI_API_KEY"] if api_keys.get("openai") else None
            anthropic_keys = ["ANTHROPIC_API_KEY"] if api_keys.get("anthropic") else None
            deepseek_keys = ["DEEPSEEK_API_KEY"] if api_keys.get("deepseek") else None

            _check_controls(task_id, log)
            tlog("Initializing extraction task...")

            extraction_task = BookExtractionTask(
                json_file_path=str(preprocessed_path),
                model_name=target_model,
                evaluation_model_name=evaluation_model,
                jailbreaker_model_name=evaluation_model,
                feedback_model_name=feedback_model,
                results_base_folder=str(app.config["RESULTS_FOLDER"]),
                gemini_keys=gemini_keys,
                openai_keys=openai_keys,
                anthropic_keys=anthropic_keys,
                deepseek_keys=deepseek_keys,
                output_path_override=resume_result_path,
            )
            tlog("Extraction task ready.")

            # Persist result_path so resume knows where to find partial results
            task["result_path"] = str(extraction_task.output_path)
            _persist_task(task_id)

            _check_controls(task_id, log)

            # Wrap _needs_processing to check pause/cancel between events
            orig_needs_processing = extraction_task._needs_processing

            def _checked_needs_processing(event):
                _check_controls(task_id, log)
                return orig_needs_processing(event)

            extraction_task._needs_processing = _checked_needs_processing

            # Wire progress callbacks to SSE queue
            extraction_task.event_callback = lambda done, total: q.put({
                "type": "progress", "phase": "extracting",
                "current": done, "total": total,
            })
            extraction_task.phase_callback = lambda event_title, phase: q.put({
                "type": "phase", "event": event_title, "phase": phase,
            })
            extraction_task.feedback_callback = lambda info: q.put({
                "type": "feedback",
                "iteration": info["iteration"],
                "max_iterations": info["max_iterations"],
                "rouge_score": info.get("rouge_score", 0),
            })

            extraction_task.run()

            # Find the results file
            result_path = str(extraction_task.output_path)
            task["result_path"] = result_path
            task["status"] = "complete"
            task["progress"] = 100
            _persist_task(task_id)
            log("")
            log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            log("✓ Extraction complete!")
            log(f"Results saved to: {result_path}")

            # Save pipeline log into the result JSON so it persists for the results tab
            _save_pipeline_log(result_path, collected_logs)

            q.put({"type": "complete", "message": "Pipeline complete!", "result_path": result_path})

        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

    except PipelineCancelled:
        # Progress already saved by the extraction pipeline's incremental saves
        try:
            result_path = str(extraction_task.output_path)
            if Path(result_path).exists():
                task["result_path"] = result_path
                log(f"Progress saved to: {result_path}")
                _save_pipeline_log(result_path, collected_logs)
        except NameError:
            pass
        task["status"] = "cancelled"
        _persist_task(task_id)

    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)
        _persist_task(task_id)
        log(f"✗ Error: {e}")
        q.put({"type": "error", "message": str(e)})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import glob as globmod

    app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    app.config["RESULTS_FOLDER"].mkdir(parents=True, exist_ok=True)

    # Collect templates + static files so the reloader watches them too
    demo_dir = Path(__file__).resolve().parent
    extra = (
        list(demo_dir.glob("templates/**/*"))
        + list(demo_dir.glob("static/**/*"))
        + list((demo_dir.parent / "Code").glob("*.py"))
    )

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
        threaded=True,
        use_reloader=True,
        extra_files=[str(f) for f in extra if f.is_file()],
    )
