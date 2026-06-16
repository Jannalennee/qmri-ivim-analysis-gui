import numpy as np
from joblib import Parallel, delayed
from scipy.optimize import curve_fit


def ivim_n(bvalues, dt, fp, dp, s0):
    return s0 * ivim_n_no_s0(bvalues, dt, fp, dp)


def ivim_n_no_s0(bvalues, dt, fp, dp):
    return fp / 10.0 * np.exp(-bvalues * dp / 10.0) + (1 - fp / 10.0) * np.exp(-bvalues * dt / 1000.0)


def ivim(bvalues, dt, fp, dp, s0):
    return s0 * (fp * np.exp(-bvalues * dp) + (1 - fp) * np.exp(-bvalues * dt))


def order(dt, fp, dp, s0=None):
    if dp < dt:
        dp, dt = dt, dp
        fp = 1 - fp
    if s0 is None:
        return dt, fp, dp
    return dt, fp, dp, s0


def fit_segmented(
    bvalues,
    dw_data,
    bounds=([0, 0, 0.005], [0.005, 0.7, 0.2]),
    cutoff=75,
    p0=[0.001, 0.1, 0.01, 1],
):
    try:
        dw_data = dw_data / np.mean(dw_data[bvalues == 0])
        high_b = bvalues[bvalues >= cutoff]
        high_dw_data = dw_data[bvalues >= cutoff]

        bounds1 = ([bounds[0][0], 0], [bounds[1][0], 1e10])
        params, _ = curve_fit(
            lambda b, dt, intercept: intercept * np.exp(-b * dt),
            high_b,
            high_dw_data,
            p0=(p0[0], p0[3] - p0[1]),
            bounds=bounds1,
        )

        dt, fp = params[0], 1 - params[1]
        fp = float(np.clip(fp, bounds[0][1], bounds[1][1]))

        dw_data_remaining = dw_data - (1 - fp) * np.exp(-bvalues * dt)
        bounds2 = (bounds[0][2], bounds[1][2])
        params, _ = curve_fit(
            lambda b, dp: fp * np.exp(-b * dp),
            bvalues,
            dw_data_remaining,
            p0=p0[2],
            bounds=bounds2,
        )
        dp = float(params[0])
        return dt, fp, dp
    except Exception:
        return 0.0, 0.0, 0.0


def fit_least_squares(
    bvalues,
    dw_data,
    s0_output=False,
    fit_s0=True,
    bounds=([0, 0, 0.005, 0.7], [0.005, 0.7, 0.2, 1.3]),
    p0=[0.001, 0.1, 0.01, 1],
):
    try:
        if not fit_s0:
            bounds2 = (
                [bounds[0][0] * 1000, bounds[0][1] * 10, bounds[0][2] * 10],
                [bounds[1][0] * 1000, bounds[1][1] * 10, bounds[1][2] * 10],
            )
            p1 = [p0[0] * 1000, p0[1] * 10, p0[2] * 10]
            params, _ = curve_fit(ivim_n_no_s0, bvalues, dw_data, p0=p1, bounds=bounds2)
            s0 = 1.0
        else:
            bounds2 = (
                [bounds[0][0] * 1000, bounds[0][1] * 10, bounds[0][2] * 10, bounds[0][3]],
                [bounds[1][0] * 1000, bounds[1][1] * 10, bounds[1][2] * 10, bounds[1][3]],
            )
            p1 = [p0[0] * 1000, p0[1] * 10, p0[2] * 10, p0[3]]
            params, _ = curve_fit(ivim_n, bvalues, dw_data, p0=p1, bounds=bounds2)
            s0 = float(params[3])

        dt, fp, dp = float(params[0] / 1000), float(params[1] / 10), float(params[2] / 10)
        if s0_output:
            return order(dt, fp, dp, s0)
        return order(dt, fp, dp)
    except Exception:
        if s0_output:
            dt, fp, dp = fit_segmented(bvalues, dw_data, bounds=bounds, p0=p0)
            return dt, fp, dp, 1.0
        return fit_segmented(bvalues, dw_data, bounds=bounds, p0=p0)


def fit_least_squares_array(
    bvalues,
    dw_data,
    fit_s0=True,
    njobs=4,
    bounds=([0, 0, 0.005, 0.7], [0.005, 0.7, 0.2, 1.3]),
    p0=[0.001, 0.1, 0.01, 1],
):
    s0 = np.mean(dw_data[:, bvalues == 0], axis=1)
    safe_s0 = np.where(np.isclose(s0, 0), 1.0, s0)
    dw_data_norm = dw_data / safe_s0[:, None]

    def _parfun(i):
        return fit_least_squares(
            bvalues,
            dw_data_norm[i, :],
            s0_output=True,
            fit_s0=fit_s0,
            bounds=bounds,
            p0=p0,
        )

    if njobs > 1:
        try:
            output = Parallel(n_jobs=njobs)(delayed(_parfun)(i) for i in range(len(dw_data_norm)))
            dt, fp, dp, s0_fit = np.transpose(output)
            return np.asarray(dt), np.asarray(fp), np.asarray(dp), np.asarray(s0_fit)
        except Exception:
            pass

    dp = np.zeros(len(dw_data_norm), dtype=float)
    dt = np.zeros(len(dw_data_norm), dtype=float)
    fp = np.zeros(len(dw_data_norm), dtype=float)
    s0_fit = np.zeros(len(dw_data_norm), dtype=float)
    for i in range(len(dw_data_norm)):
        dt[i], fp[i], dp[i], s0_fit[i] = fit_least_squares(
            bvalues,
            dw_data_norm[i, :],
            s0_output=True,
            fit_s0=fit_s0,
            bounds=bounds,
            p0=p0,
        )

    return dt, fp, dp, s0_fit


def goodness_of_fit(
    bvalues,
    dt,
    fp,
    dp,
    s0,
    dw_data,
):
    data_sim = ivim(
        np.tile(np.expand_dims(bvalues, axis=0), (len(dt), 1)),
        np.tile(np.expand_dims(dt, axis=1), (1, len(bvalues))),
        np.tile(np.expand_dims(fp, axis=1), (1, len(bvalues))),
        np.tile(np.expand_dims(dp, axis=1), (1, len(bvalues))),
        np.tile(np.expand_dims(s0, axis=1), (1, len(bvalues))),
    ).astype("f")

    norm = np.mean(dw_data, axis=1)
    ss_tot = np.sum(np.square(dw_data - norm[:, None]), axis=1)
    ss_res = np.sum(np.square(dw_data - data_sim), axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        r2 = 1 - (ss_res / ss_tot)
    adjusted_r2 = 1 - ((1 - r2) * (len(bvalues)) / (len(bvalues) - 4 - 1))
    r2 = np.nan_to_num(r2, nan=0.0, posinf=0.0, neginf=0.0)
    adjusted_r2 = np.nan_to_num(adjusted_r2, nan=0.0, posinf=0.0, neginf=0.0)
    r2[r2 < 0] = 0
    adjusted_r2[adjusted_r2 < 0] = 0
    return r2, adjusted_r2


def summarise_parameters(dt, fp, dp, r2):
    valid = (dt > 0) & (fp >= 0) & (fp <= 1) & (dp > 0)
    if not np.any(valid):
        return {
            "dt": 0.0,
            "fp": 0.0,
            "dp": 0.0,
            "r2": 0.0,
            "valid_voxels": 0.0,
        }

    return {
        "dt": float(np.mean(dt[valid])),
        "fp": float(np.mean(fp[valid])),
        "dp": float(np.mean(dp[valid])),
        "r2": float(np.mean(r2[valid])),
        "valid_voxels": float(np.sum(valid)),
    }
