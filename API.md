# FrugalCast API: send a job, compute in the browser

FrugalCast has no server. You send a **job** (JSON) to the page. The page fills in the series and the settings; **nothing is computed until the reader clicks Run**. The reader's browser then computes the job and gives the results back (JSON, CSV, plots). No data are uploaded: a job in a link sits after the `#`, and browsers never send that part of the address to any server.

Why a click: the reader sees what will be computed (series, models, settings) before the computation starts, and a link or a page cannot make a browser compute without its user's consent.

Free for research, teaching and any non-commercial use. Please cite it (see the end of this file).

Page address (provisional): `https://pred.cyrilvoyant.com/`

## 1. The job

```json
{
  "format": "frugalcast-job/1",
  "label": "Hourly load, my utility, 2024",
  "learn": [512.3, 498.1, 470.0],
  "forecast": [530.2, 541.7],
  "period": 24,
  "weekly": false,
  "annual": false,
  "horizon": 1,
  "models": ["cliper", "artu", "arma", "elm"],
  "search": { "inputs": false, "neurons": false, "ridge": false, "smooth": true },
  "fixed": { "inputs": 24, "neurons": 500, "ridge": 1e-6, "activation": "sigmoid" },
  "pca": false,
  "interval": { "kind": "conformal", "coverage": 80 },
  "prep": "none",
  "norm": "mean",
  "clip": true
}
```

Every field is optional. A **settings file** has no `learn` and no `forecast`: it sets the page and keeps the series already there. If you give the data, give both `learn` and `forecast`. Missing fields keep the value shown on the page.

| Field | Values | Meaning |
|---|---|---|
| `learn` | array of numbers (or one string, one value per line) | Learning series: at most **50,000** values in a job file or link (10,000 when pasted by hand). Fits, choices of settings and intervals all come from it. |
| `forecast` | array of numbers | Series to forecast: at most **50,000** values in a job file or link (10,000 when pasted by hand). It follows `learn` directly, with the same time step. It is used once, for scoring. |
| `period` | whole number of steps, or `"none"` | Steps per period (24 for hourly data with a daily cycle). `"none"`: no clock inputs; cyclic models are set aside. |
| `weekly`, `annual` | true / false | Add the weekly or annual clock inputs (needs a period). |
| `horizon` | 1 to 100 | Lead time in steps (lags). |
| `models` | exactly 4 ids | See § 4. |
| `search` | `inputs`, `neurons`, `ridge`, `smooth`: true / false | Settings chosen by temporal cross-validation; `ridge: true` means λ of the ELM ridge by generalised cross-validation (GCV, Golub, Heath and Wahba 1979) in each fit. A searched setting cannot also be fixed. |
| `fixed.inputs` | number of lags | Rounded to the nearest offered value (0.5, 1, 1.5 or 2 periods; 1, 2, 4 or 8 lags without a period). |
| `fixed.neurons` | 10, 50, 100, 500 | Hidden neurons of the ELMs (nearest value). |
| `fixed.ridge` | 1e-6 | Ridge λ when it is not chosen by GCV (only value). |
| `fixed.activation` | sigmoid, tanh, relu, sine, gaussian | ELM activation. |
| `pca` | true / false | PCA of the inputs, keeping 95 % of the variance. |
| `interval` | `{kind, coverage}` or `{kind, lower, upper}` | `kind`: conformal or gaussian. `coverage` in % (10–99), or `lower` and `upper` levels in %. |
| `interval.perPhase` | true (default) / false | Empirical quantiles of the out-of-fold errors of the same phase of the period. Width can vary with phase. Needs a period. No formal coverage guarantee after time-based model selection. |
| `prep` | none, center, standard | Centre, or centre and scale, the series; outputs come back in the original units. |
| `norm` | mean, sd, none | Divisor of the normalized errors (nRMSE, nMAE…). Normalized errors are fractions: 0.22, not 22 %. |
| `clip` | true (default) / false | Set forecasts and limits below 0 to 0, when the learning series has no negative value. For GHI, GTI or PV, keep every hour (a regular grid is needed) and see `solar`. |
| `label` | text | Shown above the data. |
| `solar` | `{scoreOn, cvOn}` or null | Nonnegative solar series (GHI, GTI, PV). `scoreOn: "day"` (default) evaluates positive observed targets only. `"all"` evaluates all observed targets. Where the observed target is 0 (night), the forecast, its limits and its centiles are written as 0, and so is the persistence reference: **not causal**, a retrospective view. In prospective use, filtering the night is the user's job (sun position, outside the tool). Scores on positive targets do not depend on this rule; `"all"` includes the zeroed night and is optimistic. `cvOn: "day"` uses positive validation targets and skips empty folds in the selection mean, falling back to all targets if no fold qualifies. `cvOn: "all"` is the default. Calibration always uses all validation errors. Preserve the regular time grid. |

## 2. Two ways to send it

### a. A link: `#job=…`

The button **Share settings** builds it from the page: settings only, or settings and series when *with the data* is ticked. You can also write it yourself:

- `#job=` followed by the JSON, URL-encoded (`encodeURIComponent`): fine for short series;
- or `#job=z` followed by the JSON compressed with raw DEFLATE and encoded in base64url. This is what the button makes; it is about 3 times shorter.

Python:

```python
import json, zlib, base64, webbrowser
job = {"learn": learn, "forecast": test, "period": 24, "horizon": 1,
       "models": ["cliper", "artu", "arma", "elm"]}
c = zlib.compressobj(9, zlib.DEFLATED, -15)          # raw DEFLATE
z = c.compress(json.dumps(job).encode()) + c.flush()
link = "https://pred.cyrilvoyant.com/#job=z" + base64.urlsafe_b64encode(z).decode().rstrip("=")
webbrowser.open(link)        # the page opens filled in; click Run
```

R: `paste0(url, "#job=", URLencode(jsonlite::toJSON(job, auto_unbox = TRUE), reserved = TRUE))`.

Browsers accept links of several megabytes. For long series, a file is simpler.

### b. A local file

Button **Open settings**, or drop the `.json` file on the page. **Save settings** writes the current settings as a file (with the series when *with the data* is ticked).

### Automation

The page does not take jobs from other websites or pages (no `?job=` address, no `postMessage`): it is meant to be used by a person. To automate forecasts (scheduled runs, saved models, several horizons, forecasts of the future, all 30 models, no size limit), use **FrugalCast Local**, the Windows kit (free key).

## 3. The results

**Download JSON** gives:

```json
{
  "format": "frugalcast-results/1",
  "tool": "FrugalCast", "url": "https://pred.cyrilvoyant.com/",
  "cite": "Voyant, C. (2026). FrugalCast: …",
  "settings": { "period": 24, "horizon": 1, "models": ["cliper", "artu", "arma", "elm"] },
  "horizon": 1,
  "step": [1, 2, 3],
  "observed": [530.2, 541.7, 538.0],
  "models": {
    "artu": { "name": "ARTU", "forecast": [], "lower": [], "upper": [],
              "score": { "rmse": 0, "nrmse": 0, "r2": 0, "nice1": 0, "picp": 0, "crps": 0 },
              "chosen": {} }
  },
  "skipped": [{ "id": "par", "why": "needs a period" }]
}
```

The `settings` object holds the full settings (§ 1). `score` holds all the metric keys: rmse, nrmse, mae, nmae, mbe, nmbe, maxae, r2, r, nice1, nice2, nice3, niceS, picp, ace, mil, nmil, wink, crps, ncrps.

`step` is the index in the series to forecast (1 = first value). At horizon h, the first forecast is issued from the last learning observation and targets step h. `chosen` gives the settings picked by cross-validation. `score` uses the selected test targets, including for the `persistence` reference. In solar mode with `scoreOn: "day"`, `scoreAll` uses all targets with the same forecasts. `score.notes` explains unavailable or adjusted metrics. `cvValidation` records the requested and effective selection mode, eligible folds and any fallback. Each model reports `validationFolds` (count, RMSE, and bias, as forecast minus observation), `validationScale`, and `tried` with each searched configuration's `cvRmse` in the units of the series. The export freezes the settings at the Run click.

## 4. Model ids

- **Persistences:** persistence, cyclic, climatology, cycleclim, cliper, es, artu, blendcorr, blendls, gap.
- **Classical:** ar, arma, par, holtwinters, theta, complexar.
- **ELMs:** elm, elmols, elmrr, elmtik, elmen, elmmae, elml3, elmlp, elmhuber, elmm, elmlogmse, elmboxcox, elmglm, elmcorr.

Models that cannot run on a series (no period, negative values) are set aside, with the reason in `skipped`.

## 5. Beyond the page

The page is meant to be used by a person, with up to 50,000 values in a job. For automated or larger work (no fixed size limit, all 30 models, several horizons, saved models, forecasts of the future, scheduled runs), use **FrugalCast Local**, the Windows kit with a free personal key (in preparation).

## 6. Cite and licence

The tool is free for research, teaching and any non-commercial use, provided you cite it:

> Voyant, C. (2026). FrugalCast: a browser benchmark of frugal forecasting models with prediction intervals. Mines Paris – PSL. https://pred.cyrilvoyant.com/

Cite the papers of the models you use as well. After a job opened from a file or a link, the page offers a `.bib` file with the papers of the four models.

- Code: PolyForm Noncommercial 1.0.0.
- Texts and figures: CC BY-NC 4.0.
- Commercial use: ask the author.
- See `LICENSE.md`.
