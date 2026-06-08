# qMRI GUI Prototype (Amsterdam UMC)

Human-centered Angular prototype for deep learning-based qMRI workflows.

The system is designed to support both technical and non-technical stakeholders through role-based interaction, transparency features, and workflow-oriented UI structure.

## Thesis Alignment

- RQ1: design principles and best practices
- RQ2: workflow translation into a GUI prototype
- RQ3: evaluation through usability tasks and qualitative feedback (outside this prototype UI)

See:

- `docs/project-blueprint.md`
- `docs/design-principles.md`
- `docs/evaluation-plan.md`

## Project Structure

```text
src/app/
	app.ts
	features/
		qmri/
			qmri-shell.component.ts
			qmri.types.ts
			domain/
			services/
			state/
			components/
```

## Development

Start local development:

```bash
ng serve
```

Build the project:

```bash
ng build
```

Run tests:

```bash
ng test
```
