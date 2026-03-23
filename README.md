# RECAP 🔁

This is the official repository for the paper RECAP: Reproducing Copyrighted Data from LLMs Training with an Agentic Pipeline.<br>
Blog and Demo coming soon!

## Overview

RECAP is a method for extracting verbatim memorized content from large language models (LLMs).<br>
Building on dynamic soft prompts, RECAP introduces a feedback-driven refinement loop, in which an initial extraction is assessed by a second model that compares the output against a reference passage to identify discrepancies. These are distilled into high-level correction hints, which are then fed back into the target model to steer subsequent generations towards greater fidelity. RECAP also integrates a jailbreaking module to overcome model alignment refusals.<br><br>
We release our code in order to apply both RECAP as other baselines, such as [Prefix-Probing](https://arxiv.org/abs/2310.13771) and [Dynamic Soft Prompting](https://aclanthology.org/2024.emnlp-main.546/).


<p align="center">
  <img src="./pipeline_overview.png" width="80%" alt="Framework Overview">
</p>

## 🚀 Installation

In order to run RECAP, follow these steps:

```bash
# Clone the repository
git clone https://github.com/avduarte333/RECAP.git
cd RECAP

# Create a conda environment
conda create -n RECAP_env python=3.10 pip -y
conda activate RECAP_env
```

## 🔹 Installing Dependencies

Install the necessary dependencies:

```bash
pip install -r requirements.txt
```

## 🗄️ EchoTrace Structure

Our verbatim extraction script requires books from the EchoTrace dataset to be provided in a specific JSON format. Due to copyright restrictions, we are only able to release the public domain books.<br>
For access to these materials, please refer to [Public_Domain](./Public_Domain) or visit our [HuggingFace](https://huggingface.co/datasets/RECAP-Project/EchoTrace) repository.<br>
Our data will have a similar structure as this:

```json
{
  "book_title": "A Christmas Carol",
  "chapters": [
    {
      "chapter_title": "STAVE ONE. MARLEY’S GHOST.",
      "events": [
        {
          "title": "Marley’s Undeniable Death and Scrooge’s Miserly Nature",
          "characters": ["Narrator", "Scrooge", "Marley"],
          "detailed_summary": [
            "Establishes Jacob Marley’s undeniable death with burial records",
            "..."
          ],
          "segmentation_boundaries": {
            "first_sentence": "Marley was dead: to begin with.",
            "last_sentence": "Even the blind men’s dogs appeared to know him...",
          },
          "text_segment": "Marley was dead: to begin with. There is no doubt whatever about that..."
        }
      ]
    }
  ]
}
```

## 🎯 Running Book Extraction

### Basic Usage

The main way to run our RECAP extraction on a single book would be to fill the attributes of `run_verbatim_extraction.py` according to your needs:

```python
from extraction_utils import BookExtractionTask

task = BookExtractionTask(
    json_file_path="../Public_Domain/Christmas_Carol_summary_gemini-2.5-pro-exp-03-25.json",
    model_name="deepseek-chat",                              # Target model for extractions
    evaluation_model_name="gemini-2.5-flash",                # Model to evaluate if extraction is valid
    jailbreaker_model_name="gemini-2.5-flash",               # Model for jailbreak prompt generation  (not needed if doing the Narrative Tool Injection)
    feedback_model_name="gpt-4.1",                           # Feedback-Agent model.
    results_base_folder="./Results"                          # Base folder to save results
)

# Execute the book extraction task
task.run()
```


### Calculating Metrics
Once we have obtained the predictions for the target book, the next step is to evaluate the extraction's performance by running our `run_metrics_calculation.py`.
 
```python
from extraction_utils import MetricsCalculationTask

metrics_task = MetricsCalculationTask(
    extraction_json_path="./Results/Christmas_Carol/Extractions/Christmas_Carol_extraction_deepseek-chat_feedback_gpt-4.1.json",
    min_tokens=40,                    # Minimum tokens for contiguous spans
    max_mismatch_tokens=5             # Maximum mismatch tokens for span merging
)

# Execute the metrics calculation
metrics_task.run()
```



### API Keys
Don't forget to set the API keys in a `.env` file in the project root:


### Output Structure

Results are organized as follows:
```
Results/
└── BookName/             
    ├── Extractions/
    │   └── BookName_extraction_ModelName_feedback_FeedbackModel.json
    └── Metrics/
        ├── BookName_ModelName_metrics_feedback_FeedbackModel.json
        └── BookName_ModelName_feedback_FeedbackModel_report.txt
```


## 🖥️ Demo (Docker)

For a visual, no-code demo — ideal for publishers or anyone who wants to test RECAP without programming:

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/avduarte333/RECAP.git
cd RECAP

# 2. Configure your API keys
cp .env.example .env
# Edit .env and add your API keys (you only need the ones for the models you'll use)

# 3. Launch (builds, starts, and opens the browser automatically)
# Windows:
launch.bat
# Linux / macOS / Git Bash:
./launch.sh
```

> **Manual start:** If you prefer, you can still run `docker compose up --build` and open `http://localhost:5000` yourself.

### What You Can Do

1. **Upload a book** — drag & drop a `.txt`, `.epub`, or `.pdf` file
2. **Choose models** — pick which LLMs to use for extraction, feedback, and evaluation
3. **Watch progress** — real-time logs stream as the pipeline runs
4. **Explore results** — side-by-side comparison of original text vs. LLM extraction, with match highlighting and scores


## 📚 Citation

If you use this framework in your research, please cite our work:

```bibtex
 @misc{duarte2025recap,
      title={RECAP: Reproducing Copyrighted Data from LLMs Training with an Agentic Pipeline}, 
      author={André V. Duarte and Xuying li and Bin Zeng and Arlindo L. Oliveira and Lei Li and Zhuo Li},
      year={2025},
      eprint={2510.25941},
      archivePrefix={arXiv},
      primaryClass={cs.CL},
      url={https://arxiv.org/abs/2510.25941}, 
}
```

