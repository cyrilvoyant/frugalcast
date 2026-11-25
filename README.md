# FrugalCast

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24197717.svg)](https://doi.org/10.5281/zenodo.24197717)

**Does your model beat simple models?** Paste any time series and compare 30 frugal forecasting models with prediction intervals and 20 deterministic and probabilistic metrics. The computation runs in your browser, so your data are never uploaded.

**Live tool: https://frugalcast.cyrilvoyant.com/**

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

1. No gap: one value per time step, night included. A measurement is missing: put a number (0, the previous value or a mean), so that the line still exists.
2. No missing value: no NaN, NA or empty line.
3. Same phase: both series start at the same hour (the same phase of the period). The learning series holds whole periods (whole days with a daily cycle) and the series to forecast continues it from the very next step; otherwise the hour inputs (sine, cosine) are shifted and every score is wrong.

A data check appears under each box as soon as data are pasted. Each line may start with its date (`2026-06-01T10:00;412.5`): only the values go to the models, and the dates let the page also check rules 1 and 3.

## What is new in 1.2.0

- Same phase: both series start at the same hour (the same phase of the period). The data check refuses a learning series that is not whole periods (whole weeks when the week is ticked) and, with dates, a series to forecast that does not start at the same phase; without dates, a warning asks to check it. The examples are cut into whole days or weeks.
- Week: the clock input is now the day of the week (1 to 7, sine and cosine), not the hour in the week. Results change when "weekly" is ticked.
- Annual cycle (sine and cosine of the day of the year): one year of learning data is enough (was two).
- Dated series with gaps (weekends, holidays): one click fills every missing step of both series with the previous value or the mean of the values around it; daily data then get the period 7.
- Clock inputs written in full under the period (hour of the day, day of the week, day of the year).

## What is new in 1.1.0

- Inputs: 1/4, 1/2, 3/4 or all of M past values, with M = min(2 periods, 500); without a period, M = 32 (8 to 32 lags instead of 1 to 8). Series with a period of up to 250 steps give the same numbers as 1.0.0.
- Optional date column and a data check under each box; empty lines and non-finite values are refused with their line number.
- Models that need a period cannot be chosen when the series has none.
- New examples: GTI Ajaccio (5 min), PV production Alice Springs (5 min, DKASC), monthly sunspot number (SILSO), daily euro exchange rate (ECB), daily US 10-year Treasury yield (Federal Reserve); EDF Corsica on a regular UTC grid.
- Folds explained on the page and in the fold table; a reminder of the data rules before each run.

## FrugalCast Local (in preparation, not available yet)

FrugalCast Local is an offline Windows kit for data sovereignty and edge computing:
- every model and every horizon in a single run;
- saved models, reloaded with bit-identical forecasts;
- scheduled forecasting from your latest data.

The kit and programmatic access (API) are not available for now. To be told when they are, use the [Collaborate](https://www.cyrilvoyant.com/collaborate/) page.

## Licence and citation

Free for research, teaching and any other non-commercial use: code under [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/), texts under CC BY-NC 4.0 (see `LICENSE.md`). Please cite:

> Voyant, C. (2026). FrugalCast: a browser benchmark of frugal forecasting models with prediction intervals (Version 1.2.0) [Software]. Mines Paris – PSL. https://doi.org/10.5281/zenodo.24197717

Example data: hourly GHI in Kragujevac (Serbia), which contains modified Copernicus Atmosphere Monitoring Service information, 2026; EDF SEI open data, Corsica; GTI, Ajaccio; PV production, Alice Springs, from the [DimRed data set](https://stac.webservice-energy.org/collections/dimred) (Webservice-Energy STAC catalog, MINES Paris PSL), quality-checked data from the Desert Knowledge Australia Solar Centre; monthly sunspot number, WDC-SILSO, Royal Observatory of Belgium, Brussels (CC BY-NC 4.0); daily euro exchange rate, source: ECB statistics; daily US 10-year Treasury yield, source: Board of Governors of the Federal Reserve System (H.15) and U.S. Treasury.
