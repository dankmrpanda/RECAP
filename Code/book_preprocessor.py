#!/usr/bin/env python3
"""
Book Preprocessor
-----------------
Converts raw book files (TXT, EPUB, PDF) into RECAP's structured JSON format
by using an LLM to segment chapters into events with metadata.
"""

import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from openai import OpenAI


# ---------------------------------------------------------------------------
# Text extraction helpers
# ---------------------------------------------------------------------------

def extract_text_from_txt(filepath: str) -> str:
    """Read plain text from a .txt file."""
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def extract_text_from_epub(filepath: str) -> str:
    """Read plain text from an .epub file using ebooklib + BeautifulSoup."""
    try:
        import ebooklib
        from ebooklib import epub
        from bs4 import BeautifulSoup
    except ImportError:
        raise ImportError(
            "ebooklib and beautifulsoup4 are required for EPUB support. "
            "Install with: pip install ebooklib beautifulsoup4"
        )

    book = epub.read_epub(filepath, options={"ignore_ncx": True})
    texts = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        text = soup.get_text(separator="\n")
        text = text.strip()
        if text:
            texts.append(text)
    return "\n\n".join(texts)


def extract_text_from_pdf(filepath: str) -> str:
    """Read plain text from a PDF file using PyMuPDF."""
    try:
        import fitz  # PyMuPDF
    except ImportError:
        raise ImportError(
            "PyMuPDF is required for PDF support. "
            "Install with: pip install PyMuPDF"
        )

    doc = fitz.open(filepath)
    texts = []
    for page in doc:
        text = page.get_text()
        if text.strip():
            texts.append(text)
    doc.close()
    return "\n\n".join(texts)


def extract_text(filepath: str) -> str:
    """
    Auto-detect file type and extract plain text.
    
    Supports: .txt, .epub, .pdf
    """
    ext = Path(filepath).suffix.lower()
    if ext == ".txt":
        return extract_text_from_txt(filepath)
    elif ext == ".epub":
        return extract_text_from_epub(filepath)
    elif ext == ".pdf":
        return extract_text_from_pdf(filepath)
    else:
        raise ValueError(f"Unsupported file format: {ext}. Use .txt, .epub, or .pdf")


# ---------------------------------------------------------------------------
# LLM-based book structuring
# ---------------------------------------------------------------------------

CONTENT_CLEANING_PROMPT = """You are given numbered chunks of text extracted from a book file. For EACH chunk, classify whether it is actual book narrative/story content or non-book material.

Non-book material includes:
- Title pages, half-title pages, publisher information
- Copyright notices, ISBN numbers, legal disclaimers
- Table of contents, list of figures/illustrations
- Dedications, acknowledgements, author bio/about the author
- Forewords, prefaces, introductions (by someone other than the author)
- Headers, footers, page numbers
- Indexes, glossaries, bibliographies, references
- Advertisements for other books
- Appendices with non-narrative content
- Blank pages or pages with only formatting artifacts
- Library cataloging data, printing information

Actual book content includes:
- Story narrative, dialogue, prose
- Author's own preface/introduction if it's part of the narrative
- Prologues, epilogues that are part of the story
- Chapter text

Respond with ONLY a JSON object:
{"results": [{"chunk_id": 1, "is_book_content": true/false, "reason": "brief explanation"}, ...]}"""

CHAPTER_DETECTION_PROMPT = """You are given the full text of a book. Your task is to identify chapter boundaries.

Return a JSON object with a single key "chapters" containing an array of objects, each with:
- "chapter_title": the title of the chapter (e.g. "Chapter 1: The Beginning")
- "start_text": the first ~20 words of the chapter (enough to uniquely locate its start in the text)

Rules:
- Include ALL chapters/sections you can detect.
- If there are no explicit chapter markers, split by major narrative sections.
- The "start_text" must be verbatim from the book text.
- Return ONLY valid JSON, no commentary."""

EVENT_SEGMENTATION_PROMPT = """You are given the text of a single chapter from a book. Your task is to segment it into narrative events (scenes/passages).

For EACH event, produce:
- "title": a short descriptive title for the event (5-10 words)
- "characters": list of character names present in this event
- "detailed_summary": list of 3-8 bullet-point descriptions of what happens
- "segmentation_boundaries": object with "first_sentence" (the exact first sentence) and "last_sentence" (the exact last sentence)
- "text_segment": the EXACT verbatim text of this event, copied character-for-character from the input

Rules:
- Events should be 100-500 words each. Split longer passages.
- "text_segment" MUST be an exact copy of the original text — do NOT paraphrase.
- "first_sentence" and "last_sentence" must appear verbatim in the text_segment.
- Cover the ENTIRE chapter text — no gaps between events.
- Return a JSON object: {"events": [...]}"""


def _get_client(model_name: str, api_keys: Optional[dict] = None) -> tuple:
    """Get an OpenAI-compatible client for the given model."""
    load_dotenv()
    name = model_name.lower()
    keys = api_keys or {}

    if "gemini" in name:
        api_key = keys.get("gemini") or os.getenv("GEMINI_API_KEY", "")
        base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif "gpt" in name or name.startswith("o") and any(c.isdigit() for c in name):
        api_key = keys.get("openai") or os.getenv("OPENAI_API_KEY", "")
        base_url = None
    elif "claude" in name:
        # Note: Anthropic API is not OpenAI-compatible for chat completions.
        # Claude models are not supported for preprocessing. Use Gemini or GPT instead.
        raise ValueError(
            f"Claude models are not supported for book preprocessing. "
            f"Please use a Gemini or GPT model instead."
        )
    elif "deepseek" in name:
        api_key = keys.get("deepseek") or os.getenv("DEEPSEEK_API_KEY", "")
        base_url = "https://api.deepseek.com/v1/"
    else:
        api_key = keys.get("openai") or os.getenv("OPENAI_API_KEY", "")
        base_url = None

    if not api_key:
        raise EnvironmentError(
            f"No API key found for model '{model_name}'. "
            "Please provide it via the UI or set the appropriate environment variable."
        )

    client_kwargs = {"api_key": api_key}
    if base_url:
        client_kwargs["base_url"] = base_url
    return OpenAI(**client_kwargs), model_name


def _llm_call(client: OpenAI, model_name: str, system_prompt: str,
              user_prompt: str, max_tokens: int = 16000) -> str:
    """Make a single LLM call and return the content string."""
    resp = client.chat.completions.create(
        model=model_name,
        temperature=0,
        max_completion_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return resp.choices[0].message.content


def _extract_json(text: str) -> dict:
    """Extract JSON from an LLM response that may include markdown fences or be truncated."""
    s = text.strip()
    # Strip markdown code fences
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```\s*$", "", s)

    # First, try parsing as-is
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    # Try to extract the first JSON object from the text
    match = re.search(r'\{', s)
    if match:
        s = s[match.start():]

    # Attempt to repair truncated JSON by closing open structures
    # This handles cases where the LLM response was cut off by max_tokens
    for attempt in range(5):
        try:
            return json.loads(s)
        except json.JSONDecodeError as e:
            err_msg = str(e)
            if "Unterminated string" in err_msg:
                # Close the unterminated string, then close remaining structures
                s = s.rstrip()
                # Remove any trailing partial escape sequence
                if s.endswith("\\"):
                    s = s[:-1]
                s += '"'
            elif "Expecting ',' delimiter" in err_msg or "Expecting value" in err_msg:
                # Likely a truncated array/object — trim last partial element
                s = s.rstrip().rstrip(",")
            elif "Extra data" in err_msg:
                # Multiple JSON objects — take only the first
                pos = e.pos
                s = s[:pos]
                continue
            else:
                # Generic: try closing brackets
                pass

            # Count open/close braces and brackets to close them
            open_braces = s.count("{") - s.count("}")
            open_brackets = s.count("[") - s.count("]")
            s = s.rstrip().rstrip(",")
            s += "]" * max(0, open_brackets)
            s += "}" * max(0, open_braces)

    # Final attempt
    return json.loads(s)


def _fuzzy_find(haystack: str, needle: str, start_from: int = 0) -> int:
    """
    Find needle in haystack with increasingly fuzzy matching.
    Returns the index in haystack, or -1 if not found.
    """
    # 1. Exact match
    idx = haystack.find(needle, start_from)
    if idx != -1:
        return idx

    # 2. Case-insensitive
    idx = haystack.lower().find(needle.lower(), start_from)
    if idx != -1:
        return idx

    # 3. Normalized whitespace (collapse runs of whitespace to single space)
    norm_needle = re.sub(r'\s+', ' ', needle.strip())
    norm_haystack = re.sub(r'\s+', ' ', haystack)
    idx = norm_haystack.lower().find(norm_needle.lower(), start_from)
    if idx != -1:
        # Map back to approximate position in original haystack
        # by finding the same content nearby
        snippet = norm_needle[:30]
        nearby = haystack.lower().find(snippet.lower(), max(0, idx - 200))
        return nearby if nearby != -1 else idx

    # 4. Try first few words only (LLM may have paraphrased the rest)
    words = needle.split()
    for word_count in [6, 4, 3]:
        if len(words) >= word_count:
            prefix = " ".join(words[:word_count])
            idx = haystack.lower().find(prefix.lower(), start_from)
            if idx != -1:
                return idx

    return -1


def _split_chapters(full_text: str, chapter_starts: list) -> list:
    """
    Split the full book text into chapter chunks using the detected start_text markers.
    Returns list of (chapter_title, chapter_text) tuples.
    Uses fuzzy matching to handle minor LLM misquotes.
    """
    # First pass: find all chapter start positions
    found = []
    for i, ch in enumerate(chapter_starts):
        start_text = ch.get("start_text", "")
        if not start_text:
            continue
        idx = _fuzzy_find(full_text, start_text)
        if idx != -1:
            found.append((idx, ch["chapter_title"]))

    if not found:
        return []

    # Sort by position and deduplicate
    found.sort(key=lambda x: x[0])

    # Build chapter list
    chapters = []
    for i, (start_idx, title) in enumerate(found):
        end_idx = found[i + 1][0] if i + 1 < len(found) else len(full_text)
        chapter_text = full_text[start_idx:end_idx].strip()
        if chapter_text:
            chapters.append((title, chapter_text))

    return chapters


_CHEAP_MODEL_MAP = {
    "gemini": "gemini-2.0-flash-lite",
    "gpt": "gpt-4o-mini",
    "deepseek": "deepseek-chat",
}


def _get_cheap_model(model_name: str) -> str:
    """Pick the cheapest available model from the same provider for simple classification tasks."""
    name = model_name.lower()
    for key, cheap in _CHEAP_MODEL_MAP.items():
        if key in name:
            return cheap
    return model_name  # Fallback to same model


def _clean_non_book_content(
    full_text: str,
    client: OpenAI,
    model_name: str,
    chunk_size: int = 2000,
    batch_size: int = 10,
    scan_chunks: int = 15,
    log=print,
) -> str:
    """
    Remove non-book content (front/back matter, headers, footers, etc.)
    by classifying batches of text chunks with a cheap LLM.

    Only scans the first and last `scan_chunks` chunks — non-book material
    is virtually always at the beginning or end of a file.  Middle chunks
    are assumed to be book content, which avoids unnecessary API calls.
    """
    # Use cheapest model for this simple classification task
    cheap_model = _get_cheap_model(model_name)
    log(f"[Preprocessor] Using {cheap_model} for content cleaning (cost-effective).")

    # Split text into chunks by paragraph groups to avoid cutting mid-sentence
    paragraphs = full_text.split("\n\n")
    chunks = []
    current_chunk = []
    current_len = 0

    for para in paragraphs:
        para_len = len(para)
        if current_len + para_len > chunk_size and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = [para]
            current_len = para_len
        else:
            current_chunk.append(para)
            current_len += para_len

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    if not chunks:
        return full_text

    # Only scan the first and last N chunks — non-book material lives at the
    # edges of the file.  Middle content is assumed to be book narrative.
    total = len(chunks)
    if total <= scan_chunks * 2:
        # Small file — scan everything
        scan_indices = set(range(total))
    else:
        scan_indices = set(range(scan_chunks)) | set(range(total - scan_chunks, total))

    log(f"[Preprocessor] Scanning {len(scan_indices)}/{total} edge chunks for non-book content...")

    # Pre-filter: skip very short chunks
    indexed_chunks = []
    short_removed = 0
    for i in sorted(scan_indices):
        if len(chunks[i].strip()) < 20:
            short_removed += 1
        else:
            indexed_chunks.append((i, chunks[i]))

    # All non-scanned middle chunks are kept automatically
    keep_set = set(range(total)) - scan_indices
    removed_count = short_removed

    # Classify edge chunks in batches to minimize API calls
    for batch_start in range(0, len(indexed_chunks), batch_size):
        batch = indexed_chunks[batch_start:batch_start + batch_size]

        # Build batched prompt with numbered chunks
        prompt_parts = []
        for batch_idx, (orig_idx, chunk) in enumerate(batch):
            # Send first 500 chars per chunk — enough for classification, saves tokens
            preview = chunk.strip()[:500]
            prompt_parts.append(f"--- CHUNK {batch_idx + 1} ---\n{preview}")

        batched_prompt = "Classify each chunk:\n\n" + "\n\n".join(prompt_parts)

        try:
            response = _llm_call(
                client, cheap_model,
                system_prompt=CONTENT_CLEANING_PROMPT,
                user_prompt=batched_prompt,
                max_tokens=1000,
            )
            result = _extract_json(response)
            classifications = result.get("results", [])

            # Map results back to original chunk indices
            for cls in classifications:
                batch_idx = cls.get("chunk_id", 0) - 1  # 1-indexed to 0-indexed
                if 0 <= batch_idx < len(batch):
                    orig_idx = batch[batch_idx][0]
                    if cls.get("is_book_content", True):
                        keep_set.add(orig_idx)
                    else:
                        removed_count += 1
                        log(f"[Preprocessor]   Removed chunk {orig_idx+1}/{total}: {cls.get('reason', 'non-book content')}")
        except Exception:
            # On failure, keep all chunks in the batch
            for orig_idx, _ in batch:
                keep_set.add(orig_idx)

    # Rebuild text from kept chunks only
    kept_chunks = [chunks[i] for i in sorted(keep_set)]
    cleaned_text = "\n\n".join(kept_chunks)
    log(f"[Preprocessor] Content cleaning complete: kept {len(kept_chunks)}/{total} chunks, removed {removed_count}.")
    return cleaned_text


def preprocess_book(
    filepath: str,
    model_name: str = "gemini-2.5-flash",
    api_keys: Optional[dict] = None,
    progress_callback=None,
) -> dict:
    """
    Full pipeline: extract text → detect chapters → segment events → build RECAP JSON.

    Args:
        filepath: Path to the book file (.txt, .epub, .pdf)
        model_name: LLM to use for structuring
        api_keys: Optional dict of API keys {"gemini": "...", "openai": "...", ...}
        progress_callback: Optional callable(message: str) for progress updates

    Returns:
        RECAP-formatted JSON dict
    """
    def log(msg):
        if progress_callback:
            progress_callback(msg)
        else:
            print(msg, file=sys.stderr, flush=True)

    # 1. Extract raw text
    log(f"[Preprocessor] Extracting text from {Path(filepath).name}...")
    full_text = extract_text(filepath)
    word_count = len(full_text.split())
    log(f"[Preprocessor] Extracted {word_count:,} words.")

    if word_count < 50:
        raise ValueError("The uploaded file contains too little text to process.")

    # 2. Get LLM client
    client, model = _get_client(model_name, api_keys)

    # 3. Clean non-book content (headers, footers, front/back matter)
    #    Skip for plain .txt files — they rarely have front/back matter artifacts
    file_ext = Path(filepath).suffix.lower()
    if file_ext in (".epub", ".pdf"):
        log("[Preprocessor] Cleaning non-book content...")
        full_text = _clean_non_book_content(full_text, client, model, log=log)
        cleaned_word_count = len(full_text.split())
        log(f"[Preprocessor] {word_count - cleaned_word_count:,} words removed as non-book content. {cleaned_word_count:,} words remaining.")
    else:
        log("[Preprocessor] Skipping content cleaning (plain text file).")

    # 4. Detect chapters
    log("[Preprocessor] Detecting chapter boundaries...")
    chapter_response = _llm_call(
        client, model,
        system_prompt=CHAPTER_DETECTION_PROMPT,
        user_prompt=f"Here is the full book text:\n\n{full_text[:100000]}",  # Limit for context
        max_tokens=8000,
    )
    chapter_data = _extract_json(chapter_response)
    chapter_starts = chapter_data.get("chapters", [])
    log(f"[Preprocessor] Found {len(chapter_starts)} chapters.")

    # 5. Split the text into chapter chunks
    chapters = _split_chapters(full_text, chapter_starts)
    if not chapters:
        # Fallback: treat entire text as one chapter
        log("[Preprocessor] Could not split chapters. Treating as single chapter.")
        chapters = [("Full Text", full_text)]

    # 6. Segment each chapter into events
    book_name = Path(filepath).stem.replace(" ", "_")
    result = {
        "book_name": book_name,
        "chapters": []
    }

    # Maximum chars per LLM segmentation call.  The LLM must echo back every
    # character as text_segment, so the *output* is always larger than the
    # input.  Keeping input sections ≤ 12 000 chars (~2 500 words) ensures
    # the output comfortably fits within a 32k-token response.
    _SECTION_CHAR_LIMIT = 12000

    def _split_into_sections(text: str, limit: int = _SECTION_CHAR_LIMIT) -> list:
        """Split text into sections of roughly `limit` chars, breaking at paragraph boundaries."""
        if len(text) <= limit:
            return [text]

        paragraphs = text.split("\n\n")
        sections = []
        current = []
        current_len = 0

        for para in paragraphs:
            para_len = len(para)
            if current_len + para_len > limit and current:
                sections.append("\n\n".join(current))
                current = [para]
                current_len = para_len
            else:
                current.append(para)
                current_len += para_len

        if current:
            sections.append("\n\n".join(current))

        return sections

    def _segment_section(ch_title, section_text, section_label=""):
        """Segment a single section of text into events via LLM."""
        try:
            prompt_label = f"Chapter: {ch_title}"
            if section_label:
                prompt_label += f" ({section_label})"
            events_response = _llm_call(
                client, model,
                system_prompt=EVENT_SEGMENTATION_PROMPT,
                user_prompt=f"{prompt_label}\n\n{section_text}",
                max_tokens=32000,
            )
            events_data = _extract_json(events_response)
            return events_data.get("events", [])
        except Exception as e:
            log(f"[Preprocessor] Warning: Failed to segment '{ch_title}' {section_label}: {e}")
            first_sentence = section_text.split(".")[0] + "." if "." in section_text else section_text[:100]
            last_sentence = section_text.rstrip().rsplit(".", 1)
            last_sentence = (last_sentence[0] + ".") if len(last_sentence) > 1 else section_text[-100:]
            return [{
                "title": f"{ch_title} {section_label}".strip(),
                "characters": [],
                "detailed_summary": ["Full section text"],
                "segmentation_boundaries": {
                    "first_sentence": first_sentence,
                    "last_sentence": last_sentence,
                },
                "text_segment": section_text,
            }]

    def _segment_chapter(idx_title_text):
        idx, ch_title, ch_text = idx_title_text
        log(f"[Preprocessor] Segmenting chapter {idx + 1}/{len(chapters)}: {ch_title}")

        sections = _split_into_sections(ch_text)

        if len(sections) == 1:
            events = _segment_section(ch_title, sections[0])
        else:
            log(f"[Preprocessor]   Chapter too large ({len(ch_text):,} chars) — split into {len(sections)} sections")
            events = []
            for sec_idx, section in enumerate(sections):
                label = f"part {sec_idx + 1}/{len(sections)}"
                log(f"[Preprocessor]   Segmenting {ch_title} {label} ({len(section):,} chars)")
                events.extend(_segment_section(ch_title, section, label))

        return idx, {"chapter_title": ch_title, "events": events}

    # Parallelize chapter segmentation (up to 4 concurrent LLM calls)
    from concurrent.futures import ThreadPoolExecutor
    chapter_inputs = [(idx, ch_title, ch_text) for idx, (ch_title, ch_text) in enumerate(chapters)]
    seg_workers = min(4, len(chapters))
    if seg_workers > 1:
        log(f"[Preprocessor] Segmenting {len(chapters)} chapters in parallel ({seg_workers} workers)...")
        with ThreadPoolExecutor(max_workers=seg_workers) as pool:
            chapter_results = list(pool.map(_segment_chapter, chapter_inputs))
    else:
        chapter_results = [_segment_chapter(ci) for ci in chapter_inputs]

    # Sort by original index to preserve chapter order
    chapter_results.sort(key=lambda x: x[0])
    for _, ch_data in chapter_results:
        result["chapters"].append(ch_data)

    total_events = sum(len(ch["events"]) for ch in result["chapters"])
    log(f"[Preprocessor] Done! {len(result['chapters'])} chapters, {total_events} events.")
    return result


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Preprocess a book for RECAP extraction")
    parser.add_argument("filepath", help="Path to book file (.txt, .epub, .pdf)")
    parser.add_argument("--model", default="gemini-2.5-flash", help="LLM model for structuring")
    parser.add_argument("--output", default=None, help="Output JSON path (default: auto)")
    args = parser.parse_args()

    result = preprocess_book(args.filepath, model_name=args.model)

    output_path = args.output or f"{Path(args.filepath).stem}_summary_{args.model}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"Saved to {output_path}")
