import os
import shutil
import tempfile
import base64
from datetime import datetime, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .ivim_lsq import fit_least_squares_array, goodness_of_fit

APP_ROOT = Path(__file__).resolve().parents[2]

app = FastAPI(title="qMRI IVIM LSQ API", version="0.2.0")

allowed_origins = os.environ.get("QMRI_ALLOWED_ORIGINS", "http://localhost:4200")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def _safe_float(value, field_name):
    try:
        return float(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid numeric value for '{field_name}'.") from exc


def _safe_int(value, field_name):
    try:
        return int(value)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid integer value for '{field_name}'.") from exc


def _load_bvalues(path):
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"b-values file not found: {path}")

    bvalues = np.genfromtxt(path)
    bvalues = np.asarray(bvalues, dtype=float).reshape(-1)
    if bvalues.size == 0:
        raise HTTPException(status_code=500, detail=f"b-values file is empty: {path}")
    return bvalues


def _load_nifti(path):
    if not path.exists():
        raise HTTPException(status_code=500, detail=f"NIfTI file not found: {path}")

    img = nib.load(str(path))
    data = np.asarray(img.get_fdata(), dtype=float)
    if data.ndim != 4:
        raise HTTPException(status_code=422, detail="Expected a 4D IVIM NIfTI file (x,y,z,b).")
    return img, data


def _prepare_voxel_matrix(data_4d, bvalues, max_voxels):
    if data_4d.shape[-1] != bvalues.size:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Mismatch between NIfTI volumes ({data_4d.shape[-1]}) and b-values ({bvalues.size})."
            ),
        )

    shape_3d = data_4d.shape[:3]
    flat = data_4d.reshape(-1, data_4d.shape[-1])
    b0_mask = bvalues == 0
    if not np.any(b0_mask):
        raise HTTPException(status_code=422, detail="At least one b=0 sample is required for LSQ fitting.")

    s0 = np.nanmean(flat[:, b0_mask], axis=1)
    positive = s0[s0 > 0]
    if positive.size == 0:
        raise HTTPException(status_code=422, detail="No valid positive S0 voxels were found.")

    valid_mask = s0 > (0.5 * np.median(positive))
    valid_indices = np.where(valid_mask)[0]
    voxel_matrix = flat[valid_indices]
    if voxel_matrix.size == 0:
        raise HTTPException(status_code=422, detail="No valid voxels passed S0 filtering.")

    if voxel_matrix.shape[0] > max_voxels:
        select_ids = np.linspace(0, voxel_matrix.shape[0] - 1, max_voxels, dtype=int)
        voxel_matrix = voxel_matrix[select_ids]
        valid_indices = valid_indices[select_ids]
        
    warnings = []
    if np.sum(valid_mask) > voxel_matrix.shape[0]:
        warnings.append(
            f"Fitted {voxel_matrix.shape[0]} of {int(np.sum(valid_mask))} valid voxels for this proof of concept."
        )

    s0_ref = np.nanmean(voxel_matrix[:, b0_mask], axis=1)
    safe_s0 = np.where(np.isclose(s0_ref, 0), 1.0, s0_ref)
    voxel_matrix = voxel_matrix / safe_s0[:, None]

    return voxel_matrix.astype(np.float32), valid_indices, shape_3d, warnings


def _resolve_runtime_dataset(upload_path, uploaded_bval_path=None):
    warnings = []
    bvals_override = os.environ.get("QMRI_BVAL_PATH")

    candidate_bvals = []
    if uploaded_bval_path is not None:
        candidate_bvals.append(uploaded_bval_path)

    if bvals_override:
        candidate_bvals.append(Path(bvals_override))

    # Try sidecar bval next to upload (same filename stem, .bval suffix).
    upload_name = upload_path.name
    stem = upload_name
    if stem.endswith(".nii.gz"):
        stem = stem[:-7]
    elif stem.endswith(".nii"):
        stem = stem[:-4]
    candidate_bvals.append(upload_path.with_name(f"{stem}.bval"))

    for bval_path in candidate_bvals:
        if bval_path.exists():
            return upload_path, bval_path, warnings

    raise HTTPException(
        status_code=422,
        detail=(
            "No b-values available for this upload. Upload a matching .bval file, provide "
            "a sidecar .bval with the same stem, or set QMRI_BVAL_PATH."
        ),
    )


def _finite_stats(values):
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return 0.0, 0.0, 0.0
    return float(np.min(finite)), float(np.max(finite)), float(np.mean(finite))


def _encode_float32(values):
    return base64.b64encode(values.astype(np.float32).tobytes()).decode("utf-8")


def _parameter_map(display_name, unit, values):
    minimum, maximum, mean = _finite_stats(values)
    return {
        "displayName": display_name,
        "unit": unit,
        "minValue": minimum,
        "maxValue": maximum,
        "meanValue": mean,
        "data": _encode_float32(values),
        "encoding": "base64-float32",
    }


def _empty_parameter_map(display_name, unit):
    return {
        "displayName": display_name,
        "unit": unit,
        "minValue": 0.0,
        "maxValue": 0.0,
        "meanValue": 0.0,
        "data": "",
        "encoding": "base64-float32",
    }


def _error_payload(message):
    return {
        "status": "error",
        "message": message,
        "metadata": {
            "imageShape": [0, 0, 0],
            "numberOfSlices": 0,
            "numberOfBValues": 0,
            "bValues": [],
        },
        "parameterMaps": {
            "D": _empty_parameter_map("D", "mm2/s"),
            "f": _empty_parameter_map("f", "fraction"),
            "Dstar": _empty_parameter_map("D*", "mm2/s"),
            "r2": _empty_parameter_map("Adjusted R²", "score"),
            "validMask": _empty_parameter_map("Valid mask", "mask"),
        },
        "qc": {
            "meanAdjustedR2": 0.0,
            "validVoxelPercentage": 0.0,
            "failedVoxelCount": 0,
        },
        "voxelFitSupport": False,
        "voxelFit": None,
        "referenceImage": None,
    }


def _build_result_payload(
    message,
    bvalues,
    shape_3d,
    parameter_arrays,
    valid_mask_3d,
    adjusted_r2,
    signal_4d,
    reference_b0_3d=None,
    nifti_image=None,
    source_file_name=None,
    source_bval_file_name=None,
    run_start_iso=None,
    run_duration_ms=None,
):
    d_3d, f_3d, dstar_3d, r2_3d = parameter_arrays
    total_voxels = int(np.prod(shape_3d))
    valid_voxels = int(np.sum(valid_mask_3d))
    failed_voxels = total_voxels - valid_voxels
    mean_adjusted_r2 = _finite_stats(adjusted_r2)[2]
    unique_bvalues = sorted(float(value) for value in np.unique(bvalues))

    voxel_spacing = None
    affine = None
    orientation_labels = None
    if nifti_image is not None:
        try:
            zooms = nifti_image.header.get_zooms()
            if len(zooms) >= 3:
                voxel_spacing = [float(zooms[0]), float(zooms[1]), float(zooms[2])]
        except Exception:
            voxel_spacing = None

        try:
            affine_matrix = np.asarray(nifti_image.affine, dtype=float)
            affine = [float(value) for value in affine_matrix.flatten(order="C")]
        except Exception:
            affine = None

        try:
            ax = nib.aff2axcodes(nifti_image.affine)
            if len(ax) >= 3:
                orientation_labels = {"x": str(ax[0]), "y": str(ax[1]), "z": str(ax[2])}
        except Exception:
            orientation_labels = None

    result = {
        "status": "success",
        "message": message,
        "metadata": {
            "imageShape": list(shape_3d),
            "numberOfSlices": int(shape_3d[2]),
            "numberOfBValues": int(bvalues.size),
            "bValues": [float(value) for value in bvalues],
            "uniqueBValues": unique_bvalues,
            "voxelSpacing": voxel_spacing,
            "affine": affine,
            "orientationLabels": orientation_labels,
            "sourceFileName": source_file_name,
            "sourceBvalFileName": source_bval_file_name,
        },
        "parameterMaps": {
            "D": _parameter_map("D", "mm2/s", d_3d),
            "f": _parameter_map("f", "fraction", f_3d),
            "Dstar": _parameter_map("D*", "mm2/s", dstar_3d),
            "r2": _parameter_map("Adjusted R²", "score", r2_3d),
            "validMask": _parameter_map("Valid mask", "mask", valid_mask_3d.astype(np.float32)),
        },
        "qc": {
            "meanAdjustedR2": mean_adjusted_r2,
            "validVoxelPercentage": (valid_voxels / total_voxels * 100) if total_voxels else 0.0,
            "failedVoxelCount": failed_voxels,
            "validVoxelCount": valid_voxels,
            "evaluatedVoxelCount": total_voxels,
        },
        "analysisInfo": {
            "modelName": "IVIM least-squares fitting",
            "runStartIso": run_start_iso,
            "runDurationMs": run_duration_ms,
            "softwareVersion": app.version,
        },
        "voxelFitSupport": True,
        "voxelFit": {
            "shape": list(signal_4d.shape),
            "signals": _encode_float32(signal_4d),
            "encoding": "base64-float32",
        },
    }

    if reference_b0_3d is not None:
        result["referenceImage"] = {
            "data": _encode_float32(reference_b0_3d),
            "encoding": "base64-float32",
        }

    return result


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": _utc_now_iso()}


@app.get("/api/inference/datasets")
def list_public_datasets():
    return {
        "generatedAtIso": _utc_now_iso(),
        "datasets": [],
        "message": "No public IVIM datasets are served. Upload a NIfTI file and matching .bval file from a private location.",
    }


@app.post("/api/inference/run")
async def run_inference(
    file: UploadFile = File(...),
    bvalFile: UploadFile = File(None),
    maxVoxels: str = Form("30000"),
):
    try:
        run_start = datetime.now(timezone.utc)
        max_voxels = int(np.clip(_safe_int(maxVoxels, "maxVoxels"), 2000, 30000))

        if not file.filename:
            raise HTTPException(status_code=422, detail="Uploaded file has no filename.")

        with tempfile.TemporaryDirectory(prefix="qmri_ivim_") as tmp_dir:
            tmp_root = Path(tmp_dir)
            upload_path = tmp_root / file.filename
            with upload_path.open("wb") as target:
                shutil.copyfileobj(file.file, target)

            uploaded_bval_path = None
            if bvalFile is not None and bvalFile.filename:
                uploaded_bval_path = tmp_root / bvalFile.filename
                with uploaded_bval_path.open("wb") as target:
                    shutil.copyfileobj(bvalFile.file, target)

            runtime_data_path, runtime_bvals_path, _ = _resolve_runtime_dataset(
                upload_path,
                uploaded_bval_path=uploaded_bval_path,
            )

            bvalues = _load_bvalues(runtime_bvals_path)
            nifti_image, data_4d = _load_nifti(runtime_data_path)

            voxel_matrix, valid_indices, shape_3d, _ = _prepare_voxel_matrix(
                data_4d,
                bvalues,
                max_voxels=max_voxels,
            )

            njobs = max(1, int(os.environ.get("QMRI_LSQ_JOBS", "4")))
            lower = [0, 0, 0.005, 0.7]
            upper = [0.005, 0.7, 0.2, 1.3]
            d, f, dstar, s0 = fit_least_squares_array(
                bvalues,
                voxel_matrix,
                fit_s0=True,
                njobs=njobs,
                bounds=(lower, upper),
                p0=[0.001, 0.1, 0.01, 1],
            )
            _, adjusted_r2 = goodness_of_fit(bvalues, d, f, dstar, s0, voxel_matrix)

            d_3d = np.full(shape_3d, np.nan, dtype=np.float32)
            f_3d = np.full(shape_3d, np.nan, dtype=np.float32)
            dstar_3d = np.full(shape_3d, np.nan, dtype=np.float32)
            r2_3d = np.full(shape_3d, np.nan, dtype=np.float32)
            valid_mask_3d = np.zeros(shape_3d, dtype=np.float32)

            d_3d.flat[valid_indices] = d
            f_3d.flat[valid_indices] = f
            dstar_3d.flat[valid_indices] = dstar
            r2_3d.flat[valid_indices] = adjusted_r2
            valid_mask_3d.flat[valid_indices] = 1.0

            signal_4d = np.full((*shape_3d, bvalues.size), np.nan, dtype=np.float32)
            signal_4d.reshape(-1, bvalues.size)[valid_indices] = voxel_matrix

            # Extract b=0 reference image from original NIfTI data
            b0_mask = bvalues == 0
            b0_indices = np.where(b0_mask)[0]
            if len(b0_indices) > 0:
                # Average all b=0 volumes for better anatomical reference
                reference_b0_3d = np.mean(data_4d[:, :, :, b0_indices], axis=3).astype(np.float32)
                # Transpose from (x, y, z) to (z, y, x) so z-slices are contiguous
                # and within each slice pixels are in row-major (y, x) display order
                reference_b0_3d = np.ascontiguousarray(reference_b0_3d.transpose(2, 1, 0))
            else:
                reference_b0_3d = None

            duration_ms = int((datetime.now(timezone.utc) - run_start).total_seconds() * 1000)

            return _build_result_payload(
                message=f"IVIM LSQ fitting completed for {file.filename}.",
                bvalues=bvalues,
                shape_3d=shape_3d,
                parameter_arrays=(d_3d, f_3d, dstar_3d, r2_3d),
                valid_mask_3d=valid_mask_3d,
                adjusted_r2=adjusted_r2,
                signal_4d=signal_4d,
                reference_b0_3d=reference_b0_3d,
                nifti_image=nifti_image,
                source_file_name=file.filename,
                source_bval_file_name=bvalFile.filename if bvalFile is not None and bvalFile.filename else None,
                run_start_iso=run_start.isoformat(),
                run_duration_ms=duration_ms,
            )
    except HTTPException as exc:
        return JSONResponse(status_code=exc.status_code, content=_error_payload(str(exc.detail)))
    except Exception as exc:
        return JSONResponse(status_code=500, content=_error_payload(str(exc)))
