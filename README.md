# qMRI GUI Proof of Concept

This repository contains a proof-of-concept qMRI GUI for Amsterdam UMC. The current implementation focuses on one working analysis path: loading private diffusion MRI data, running IVIM least-squares fitting through a local Python backend, and inspecting the resulting parameter maps in the browser.

The project is intentionally small and practical. It shows how a qMRI workflow can be translated into a usable GUI, and gives the next project team a clear starting point for further development.

## Current Scope

The GUI is a qMRI proof of concept, not a finished clinical or research product. At this stage it supports IVIM-LSQ fitting only. Earlier generic AI-model options, NCDE/DCE concepts, uncertainty overlays, smoothing controls, confidence thresholds, and model-selection UI have been removed from the working flow.

What currently works:

- Load a private 4D diffusion NIfTI file (`.nii` or `.nii.gz`).
- Load a matching b-values file (`.bval`).
- Validate that the number of b-values matches the number of diffusion volumes.
- Run IVIM least-squares fitting on the local FastAPI backend.
- View IVIM parameter maps in the browser.
- Switch between `D`, `f`, `D*`, adjusted R2, and valid-mask maps.
- Scroll through slices.
- Adjust simple window and level display controls.
- Click a voxel to inspect the measured signal and fitted IVIM curve.
- Draw a rectangular ROI on a map slice and view basic summary statistics.

Still placeholder or future work:

- Export parameter maps.
- Export voxel-fit CSV files.
- Export reports.
- More qMRI models or workflows beyond IVIM-LSQ.
- Production-level error handling, authentication, deployment, and data governance.

## How The GUI Is Organized

The app opens directly on the qMRI workflow. The screen is divided into three working areas.

Left column:

- Upload the diffusion NIfTI file.
- Upload the `.bval` file.
- Optionally load both files together.
- Check validation feedback.
- Start the IVIM-LSQ analysis.
- Read the run log.

Center panel:

- View the parameter map canvas.
- Choose which parameter map to display.
- Move through slices with the Z-slice slider.
- Change window and level for display.
- Click a voxel for fit inspection.
- Drag a rectangle for ROI statistics.

Right column:

- View ROI summary statistics.
- View selected voxel parameters and the fit graph.
- View global fit-quality metrics.
- See export placeholders for future development.

## Input Data

Use private/local data only. Do not place patient, research, or example imaging datasets in `public/`.

The GUI expects:

- A 4D diffusion MRI NIfTI file: `.nii` or `.nii.gz`.
- A matching b-values file: `.bval`.

The NIfTI file must have shape like:

```text
x, y, z, diffusion-volume
```

The `.bval` file must contain one b-value for every diffusion volume in the NIfTI file. For example, if the NIfTI contains 16 diffusion volumes, the `.bval` file must contain 16 b-values.

The filenames do not need to match when both files are uploaded through the GUI. The backend also supports a private fallback b-values path through `QMRI_BVAL_PATH`, but uploading the `.bval` file in the GUI is the clearest workflow.

## Project Structure

```text
backend/
  requirements.txt
  qmri_api/
    main.py              FastAPI backend and IVIM result contract
    ivim_lsq.py          IVIM least-squares fitting code

src/app/features/qmri/
  qmri-shell.component.* Main qMRI GUI layout
  components/maps-viewer Parameter map canvas, voxel click, ROI selection
  domain/               TypeScript result models
  services/             Data ingest and backend API calls
  state/                qMRI session state

docs/
  project-blueprint.md
  design-principles.md
  evaluation-plan.md

public/
  assets/images/amc_logo.png
  favicon.ico
```

## First-Time Setup

These steps assume you start from a fresh clone of the repository.

### 1. Open the project

```bash
cd amc_ui
```

### 2. Install the frontend dependencies

```bash
npm install
```

This installs Angular and the JavaScript packages defined in `package.json`.

### 3. Create a Python virtual environment for the backend

From the project root:

```bash
python3 -m venv backend/.venv
```

Activate it:

```bash
source backend/.venv/bin/activate
```

After activation, your terminal prompt usually shows `(.venv)`.

### 4. Install the backend Python dependencies

With the virtual environment active:

```bash
pip install -r backend/requirements.txt
```

This installs FastAPI, Uvicorn, NumPy, SciPy, nibabel, and the other Python packages needed for the IVIM-LSQ backend.

## Start The Project

You need two terminals: one for the backend and one for the frontend.

### Terminal 1: start the backend

From the project root:

```bash
source backend/.venv/bin/activate
uvicorn qmri_api.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

The backend should now be available at:

```text
http://127.0.0.1:8000
```

You can test it in a browser or terminal with:

```bash
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

The exact response also includes a timestamp.

### Terminal 2: start the frontend

From the project root:

```bash
npm start
```

Open the URL shown in the terminal. It is normally:

```text
http://localhost:4200
```

The frontend expects the backend to run on port `8000`.

## Run An Analysis In The GUI

1. Start the backend.
2. Start the frontend.
3. Open `http://localhost:4200`.
4. In the Dataset panel, choose a diffusion NIfTI file (`.nii` or `.nii.gz`).
5. Choose the matching `.bval` file.
6. Check the Validation panel. It should say that the number of volumes and b-values match.
7. Click `Run IVIM LSQ fitting`.
8. Wait for the run log to show completion.
9. Use the center map viewer to inspect the parameter maps.
10. Click a voxel to inspect the fit graph in the right column.
11. Drag a rectangle on the map to calculate ROI summary statistics.

## Optional Backend Settings

The backend can be configured with environment variables before starting Uvicorn.

Allow a different frontend origin:

```bash
export QMRI_ALLOWED_ORIGINS=http://localhost:4200
```

Use a private default `.bval` file when no `.bval` is uploaded:

```bash
export QMRI_BVAL_PATH=/absolute/private/path/to/bvalues.bval
```

Control the number of parallel LSQ jobs:

```bash
export QMRI_LSQ_JOBS=4
```

## Development Commands

Build the frontend:

```bash
npm run build
```

Run frontend tests:

```bash
npm test
```

Compile-check the backend Python files:

```bash
python3 -m compileall backend/qmri_api
```

## Privacy And Data Handling

Do not store imaging datasets in `public/`. Everything in `public/` is part of the Angular web assets and can be copied into the build output.

For this POC, imaging data should stay in a private local folder and be selected through the browser file picker. The backend receives uploaded files temporarily during analysis and does not serve public example datasets.

## Troubleshooting

Backend is not reachable:

- Make sure the backend terminal is still running.
- Check that it is running on port `8000`.
- Test `http://127.0.0.1:8000/health`.

Frontend does not start:

- Run `npm install` again.
- Check that you are in the project root.
- Run `npm start`.

Python package install fails:

- Make sure the virtual environment is activated.
- Upgrade pip if needed with `python -m pip install --upgrade pip`.
- Then rerun `pip install -r backend/requirements.txt`.

Validation fails in the GUI:

- Check that the NIfTI is 4D.
- Check that the `.bval` file has one value per diffusion volume.
- Check that the `.bval` file is the correct file for this scan.

Analysis fails after clicking Run:

- Check the Run Log in the GUI.
- Check the backend terminal for the Python error.
- Verify the backend dependencies were installed in `backend/.venv`.
- Verify the backend was started with `uvicorn qmri_api.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload`.

## Related Documents

- [docs/project-blueprint.md](docs/project-blueprint.md)
- [docs/design-principles.md](docs/design-principles.md)
- [docs/evaluation-plan.md](docs/evaluation-plan.md)