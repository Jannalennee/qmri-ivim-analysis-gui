# qMRI Deep Learning Analysis Tool (AMC Prototype)

Angular prototype for a simplified qMRI analysis workflow UI.

This repository now contains both:

- an Angular front-end workflow prototype
- a local FastAPI backend that runs IVIM LSQ fitting on NIfTI data

## Thesis Alignment

- RQ1: design principles and best practices
- RQ2: workflow translation into a GUI prototype
- RQ3: evaluation through usability tasks and qualitative feedback (outside this prototype UI)

Supporting documents:

- [docs/project-blueprint.md](docs/project-blueprint.md)
- [docs/design-principles.md](docs/design-principles.md)
- [docs/evaluation-plan.md](docs/evaluation-plan.md)

## What This App Contains

- Simplified 3-column IVIM LSQ workflow:
	- Left: private dataset loading, validation, run action
	- Center: IVIM parameter map viewer with voxel and ROI tools
	- Right: voxel fit, ROI summary, validation summary, export placeholders
- Role and workflow state management using Angular signals
- IVIM LSQ inference flow through the local backend API
- No imaging datasets are stored under `public/`; load private NIfTI and `.bval` files through the UI.

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

## Local Backend (IVIM LSQ)

The backend endpoint keeps the existing front-end contract at `POST /api/inference/run`.

It performs this flow:

1. Receive uploaded NIfTI from the UI
2. Receive the matching uploaded `.bval` file, or use `QMRI_BVAL_PATH` for a private local b-value file
3. Run LSQ fitting (`D`, `f`, `D*`) on filtered voxels
4. Return parameter maps, QC, voxel-fit support, and ROI-readable map data to the UI

### 1. Install backend dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Start the backend API

```bash
cd backend
source .venv/bin/activate
uvicorn qmri_api.main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Start Angular UI

```bash
npm start
```

### 4. Dataset sources

Do not keep patient or research imaging datasets under `public/`. Files in `public/` are copied into the Angular build output and can be served by the frontend.

Use the UI file pickers to load a private `.nii` or `.nii.gz` file plus its matching `.bval` file from a local folder outside the web app. The filenames do not need to match; the number of b-values must match the number of diffusion volumes.

### 5. Optional backend environment variables

```bash
export QMRI_ALLOWED_ORIGINS=http://localhost:4200
export QMRI_BVAL_PATH=/absolute/path/to/bvalues.bval
export QMRI_LSQ_JOBS=4
```

## Notes and Limitations

- The current backend computes voxel-wise IVIM LSQ maps (`D`, `f`, `D*`) and quality metric (`Adjusted R2`).
- Export buttons in the UI are still prototype placeholders.

## Troubleshooting

- If `ng` or Angular commands fail locally, ensure `npm install` completed successfully.
- If backend fails with NIfTI errors, verify your input is a 4D `.nii` or `.nii.gz` with matching number of b-values.
- If no `.bval` is uploaded, set `QMRI_BVAL_PATH=/absolute/private/path/to/bvalues.bval` before starting the backend.