# qMRI Deep Learning Analysis Tool (AMC Prototype)

Angular prototype for a simplified qMRI analysis workflow UI.

This repository contains the front-end concept and mock workflow logic. The actual research model training and HPC inference scripts live in the shared `dce_rim/Janna` environment.

## Thesis Alignment

- RQ1: design principles and best practices
- RQ2: workflow translation into a GUI prototype
- RQ3: evaluation through usability tasks and qualitative feedback (outside this prototype UI)

Supporting documents:

- [docs/project-blueprint.md](docs/project-blueprint.md)
- [docs/design-principles.md](docs/design-principles.md)
- [docs/evaluation-plan.md](docs/evaluation-plan.md)

## What This App Contains

- Simplified 3-column UI concept:
	- Left: dataset, model selection, validation, run action
	- Center: viewer placeholder
	- Right: model information, validation summary, export actions
- Role and workflow state management using Angular signals
- Mock inference flow for UI/prototyping purposes
- Sample test data under [public/test-data/](public/test-data/)

## Project Structure

```text
src/app/
	app.ts
	app.html
	app.css
	features/
		qmri/
			qmri-shell.component.ts
			qmri-shell.component.html
			qmri.types.ts
			domain/
			services/
			state/
			components/
docs/
public/
```

## Local Development (Angular App)

### Prerequisites

- Node.js (LTS recommended)
- npm (project uses npm)

### Install dependencies

```bash
npm install
```

### Start development server

```bash
npm start
```

Open the URL shown in the terminal (typically `http://localhost:4200`).

### Build

```bash
npm run build
```

### Run tests

```bash
npm test
```

## Data and Model Workflow (HPC / dce_rim)

Use this flow for the real model/data pipeline provided by the supervisor.

### 1. Mount the shared disk

```bash
mount_my_rdisk
```

### 2. Go to your folder

```bash
cd dce_rim/Janna
```

Folder meaning:

- `conda`: conda environment definition (`environment.yml`)
- `data`: data documentation and structure
- `inference`: run scripts and 174 yaml configs (one per timepoint)
- `model`: checkpoint location documentation
- `parameter maps`: generated parameter-map outputs and MATLAB helper

### 3. Create and activate conda environment

```bash
cd conda
module load Anaconda3
conda env create -f environment.yml
conda activate atommic2
```

### 4. Prepare inference configs

In `dce_rim/Janna/inference`, update paths in:

- all `.yaml` files
- `train.sh`

Do not edit 174 yaml files manually.

Example bulk path update script (run from `dce_rim/Janna/inference`):

```bash
python - <<'PY'
from pathlib import Path

old = '/old/base/path'
new = '/new/base/path'

for p in Path('.').glob('*.yaml'):
		text = p.read_text(encoding='utf-8')
		updated = text.replace(old, new)
		if updated != text:
				p.write_text(updated, encoding='utf-8')
				print(f'updated {p.name}')
PY
```

Then edit `train.sh` with the same new base path.

### 5. Submit job to GPU queue

```bash
cd dce_rim/Janna/inference
sbatch train.sh
```

## Notes and Limitations

- This Angular app is a prototype UI and currently uses mock inference logic.
- Export buttons in the prototype are UI placeholders.
- Real training/inference execution is done through HPC scripts in `dce_rim/Janna/inference`.

## Troubleshooting

- If `ng` or Angular commands fail locally, ensure `npm install` completed successfully.
- If `conda activate atommic2` fails, verify environment creation succeeded and Anaconda module is loaded.
- If inference fails immediately on cluster, validate all updated paths in yaml files and `train.sh`.

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