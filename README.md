# FrugalCast

**Does your forecast beat persistence?** Paste any time series and compare 30 frugal forecasting models with prediction intervals and 20 deterministic and probabilistic metrics. The computation runs in your browser, so your data are never uploaded.

**Live tool: https://pred.cyrilvoyant.com/**

- **30 models:**
  - persistences, climatology, CLIPER, BLEND, smart persistence, exponential smoothing, ARTU;
  - Holt-Winters, Theta, AR, ARMA (Hannan-Rissanen), periodic AR (PAR-BIC), complex-valued AR;
  - 14 extreme learning machines.

  Each model follows its paper or reference code exactly.
- **Intervals:**
  - empirical quantiles of out-of-fold residuals, global or per phase of the period;
  - or Gaussian intervals.
- **20 metrics:** RMSE, nRMSE, MAE, MBE, R², NICE¹ to NICE³ (skill against persistence), PICP, ACE, MIL, interval score, CRPS, and more.
- **Validation:** purged, expanding-window, time-ordered.

## Data rules

1. No gap: one value per time step, night included.
2. No missing value: no NaN, NA or empty line.
3. Start exactly at the beginning of a period, for instance 00:00 for hourly data with a daily cycle. The forecast series follows the learning series directly.

## FrugalCast Local (in preparation, not available yet)

FrugalCast Local is an offline Windows kit for data sovereignty and edge computing:
- every model and every horizon in a single run;
- saved models, reloaded with bit-identical forecasts;
- scheduled forecasting from your latest data.

The kit and programmatic access (API) are not available for now. To be told when they are, use the [Collaborate](https://www.cyrilvoyant.com/collaborate/) page.

## Licence and citation

Free for research, teaching and any other non-commercial use: code under [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/), texts under CC BY-NC 4.0 (see `LICENSE.md`). Please cite:

> Voyant, C. (2026). FrugalCast: a benchmark of frugal forecasting models with prediction intervals. Mines Paris – PSL. https://pred.cyrilvoyant.com/

Example data: hourly GHI in Kragujevac (Serbia), which contains modified Copernicus Atmosphere Monitoring Service information, 2026; EDF SEI open data, Corsica.
