# qMRI GUI Project Blueprint

## Goal
Design and evaluate a human-centered GUI for deep learning-based qMRI workflows that supports both technical and non-technical users in clinical research settings.

## Research Questions to Engineering Mapping

- RQ1 (Design Principles): captured in UX and workflow requirements, transparency patterns, progressive disclosure.
- RQ2 (Workflow Translation): implemented as feature modules and step-based interaction flow.
- RQ3 (Evaluation): measured with task success, SUS, and qualitative interviews.

## Current Software Architecture

- app shell:
  - src/app/app.ts
- qMRI feature:
  - src/app/features/qmri/qmri-shell.component.ts
- domain models:
  - src/app/features/qmri/domain/
- state management:
  - src/app/features/qmri/state/
- workflow/services:
  - src/app/features/qmri/services/
- presentational components:
  - src/app/features/qmri/components/

## User Groups

- Clinician-researcher: simplified flow, strong visual output, low configuration burden.
- PhD researcher: intermediate controls, reproducibility metadata, richer visualization.
- Technical/IT developer: advanced controls, diagnostics, detailed configuration.

## Core Workflow

1. Load imaging data
2. Configure model parameters
3. Execute model inference
4. Interpret and export results

## Non-Functional Priorities

- Usability and low cognitive load
- Transparency and trust calibration
- Clinical workflow alignment
- Accessibility and responsive interface
