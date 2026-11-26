/* FrugalCast — page logic. The computation is in engine.js, run in worker.js. */
(() => {
  'use strict';
  const E = window.PredEngine, $ = id => document.getElementById(id);
  const COLORS = ['#07569a', '#b8306b', '#0f8a7e', '#b07d12'];
  const INK = '#172536', MUTED = '#46586a', GRID = '#e3e9ef';
  const DEFAULT = ['blendls', 'artu', 'arma', 'elm'];
  const FAMILIES = ['Persistence', 'Classical', 'ELM'];
  const store = { get(k, d) { try { const v = localStorage.getItem('frugalcast.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('frugalcast.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

  const ABOUT = {
    persistence: 'The next value equals the last one. The reference of every score.',
    cyclic: 'The value one period earlier, at the same phase.',
    climatology: 'The mean of the learning series, whatever the time (CLIM).',
    cycleclim: 'The mean profile over one period, phase by phase.',
    cliper: 'Blend of persistence and mean, weighted by the autocorrelation at the horizon.',
    blendcorr: 'Blend of persistence and cyclic persistence; weight from the correlation of each phase.',
    blendls: 'Blend of persistence and cyclic persistence; weight per phase by least squares.',
    gap: 'Last value plus the change of the mean profile: smart persistence without clear sky.',
    es: 'Exponentially weighted past values, pulled toward the mean by the autocorrelation.',
    artu: 'Second-order AR whose two coefficients come from tables of ρ(h) and ρ(2h).',
    ar: 'Linear model on the last values (and clock inputs), fitted by least squares.',
    arma: 'ARMA(p, 1) on the series minus its seasonal component (mean of each phase): Hannan-Rissanen estimation, a long Yule-Walker AR for the innovations, then least squares (Brockwell and Davis, 2016).',
    par: 'One AR model per phase, fitted by least squares, order of each phase chosen by BIC, forecast by recursion (Voyant, De Gooijer and Notton, 2018). With "annual" ticked: on the gap to the average year (Eq. 6).',
    holtwinters: 'Level, trend and seasonal profile updated at each step.',
    theta: 'Theta line: the series pulled toward its trailing trend, plus the seasonal profile.',
    complexar: 'Level and volatility as one complex number; its interval opens when the series gets unstable.',
    elm: 'Random frozen hidden layer; output weights by ridge regression, λ = 10⁻⁶ or chosen by generalised cross-validation (GCV) in each fit.',
    elmols: 'Random frozen hidden layer; output weights by least squares.',
    elmrr: 'Ridge with an uncertainty radius ε on the hidden outputs (robust risk).',
    elmtik: 'Ridge penalty scaled by the energy of each neuron (anisotropic Tikhonov).',
    elmen: 'Elastic net in two passes: sparse and smooth output weights.',
    elmmae: 'Absolute-error loss, in two passes: less sensitive to large errors.',
    elml3: 'Cubic loss, in two passes: insists on the large errors.',
    elmlp: 'Lp loss with 1 < p < 2, in two passes: between MAE and MSE.',
    elmhuber: 'Huber loss, in two passes: squared for small errors, absolute for large ones.',
    elmm: 'Welsch M-estimator, in two passes: large errors get almost no weight.',
    elmlogmse: 'Fits the logarithm of y + c: relative errors, positive forecasts.',
    elmboxcox: 'Fits a Box-Cox transform of y: the transform is chosen by cross-validation.',
    elmglm: 'Gamma GLM with log link, in two passes: errors proportional to the level.',
    elmcorr: 'Least squares that know successive errors are correlated (Corr-ELM).',
  };

  /* metrics: id, label, sub-label, kind, rule for "best", definition */
  const MET = [
    ['rmse', 'RMSE', 'units', 'det', 'min', 'Root mean square error.'],
    ['nrmse', 'nRMSE', 'fraction', 'det', 'min', 'RMSE divided by the mean (or the standard deviation) of the observations. 0.22 = 22 % of the mean.'],
    ['mae', 'MAE', 'units', 'det', 'min', 'Mean absolute error.'],
    ['nmae', 'nMAE', 'fraction', 'det', 'min', 'MAE divided by the mean (or the standard deviation) of the observations.'],
    ['mbe', 'MBE', 'units', 'det', 'zero', 'Mean bias error: mean of forecast minus observation. Best close to 0.'],
    ['nmbe', 'nMBE', 'fraction', 'det', 'zero', 'MBE divided by the mean (or the standard deviation) of the observations.'],
    ['maxae', 'MaxAE', 'units', 'det', 'min', 'Largest absolute error.'],
    ['r2', 'R²', '', 'det', 'max', 'Coefficient of determination, 1 − SSE/SST: share of the variance of the observations explained. 1 is perfect; below 0, worse than the mean.'],
    ['r', 'r', 'Pearson', 'det', 'max', 'Correlation between forecasts and observations.'],
    ['nice1', 'NICE¹', '', 'det', 'min', 'Mean absolute error divided by that of persistence. Below 1: better than persistence.'],
    ['nice2', 'NICE²', '', 'det', 'min', 'RMSE divided by that of persistence.'],
    ['nice3', 'NICE³', '', 'det', 'min', 'Cubic-mean error divided by that of persistence: weighs the large errors.'],
    ['niceS', 'NICE<sup>Σ</sup>', '', 'det', 'min', 'Mean of NICE¹, NICE² and NICE³.'],
    ['picp', 'PICP', 'target', 'prob', 'target', 'Prediction interval coverage probability: share of observations with lower ≤ observation ≤ upper (limits included). Best close to the nominal coverage.'],
    ['ace', 'ACE', 'PICP − target', 'prob', 'zero', 'Average coverage error. Best close to 0; negative = intervals too narrow.'],
    ['mil', 'MIL', 'units', 'prob', 'min', 'Mean interval length. At equal coverage, narrower is better.'],
    ['nmil', 'nMIL', 'fraction', 'prob', 'min', 'MIL divided by the mean (or the standard deviation) of the observations.'],
    ['wink', 'Interval score', 'Winkler', 'prob', 'min', 'Width plus a penalty for each observation outside, divided by the level left outside (Gneiting and Raftery, 2007). Rewards coverage and sharpness together.'],
    ['crps', 'CRPS', 'units', 'prob', 'min', 'Continuous ranked probability score, approximated from 99 centiles (twice the mean pinball loss); not the exact integral. Lower is better.'],
    ['ncrps', 'nCRPS', 'fraction', 'prob', 'min', 'CRPS divided by the mean (or the standard deviation) of the observations.'],
  ];
  const MDEF = Object.fromEntries(MET.map(m => [m[0], m]));
  let picked = store.get('metrics', ['rmse', 'nrmse', 'nmae', 'r2', 'nice1', 'niceS', 'picp', 'mil', 'wink', 'crps']).filter(k => MDEF[k]);
  let worker = null, result = null, job = null, ran = null, t0 = 0; // ran: the settings actually run, frozen at the click
  let filledNote = ''; // note left in the learning check by the last gap filling
  let maxLearn = 10000;   // pasted by hand; a job sent through the API may hold up to 50,000 values (API.md)

  // ---------- model pickers, references, metric list ----------
  const ids = Object.keys(E.MODELS);
  const opts = d => FAMILIES.map(f => `<optgroup label="${f}">` + ids.filter(i => E.MODELS[i].family === f)
    .map(i => `<option value="${i}"${i === d ? ' selected' : ''}>${E.MODELS[i].name}</option>`).join('') + '</optgroup>').join('');
  const saved = store.get('models', DEFAULT).filter(i => E.MODELS[i]);
  const start = saved.length === 4 && new Set(saved).size === 4 ? saved : DEFAULT;
  $('models').innerHTML = start.map((d, k) => `<div class="card top mcard" style="--c:${COLORS[k]}">
    <h3><span class="sw"></span>Model ${k + 1}<span class="fam" style="margin-left:auto"></span></h3>
    <select data-k="${k}" aria-label="Model ${k + 1}">${opts(d)}</select><p class="about"></p></div>`).join('');
  const sels = [...document.querySelectorAll('#models select')];
  function about(s) {
    const m = E.MODELS[s.value], c = s.closest('.mcard'), need = [m.needsCycle && 'needs a period', m.needsNonneg && 'needs values ≥ 0'].filter(Boolean);
    c.querySelector('.fam').textContent = m.family;
    c.querySelector('.about').innerHTML = `${ABOUT[s.value] || ''}${need.length ? ` <i>(${need.join(', ')})</i>` : ''} <a href="${m.ref[0]}" target="_blank" rel="noopener">${m.ref[1]} →</a>`;
  }
  sels.forEach(s => { about(s); s.addEventListener('change', () => { about(s); store.set('models', sels.map(x => x.value)); }); });
  function lockCycle(none) { // no period: the models that need one cannot be chosen; the previous choice comes back with the period
    sels.forEach(s => {
      [...s.options].forEach(o => { o.disabled = none && !!E.MODELS[o.value].needsCycle; });
      if (none && E.MODELS[s.value].needsCycle) {
        const used = new Set(sels.map(x => x.value)), alt = ids.find(i => !E.MODELS[i].needsCycle && !used.has(i));
        s.dataset.prev = s.value; s.value = alt; about(s);
      } else if (!none && s.dataset.prev) { if (!sels.some(x => x.value === s.dataset.prev)) { s.value = s.dataset.prev; about(s); } delete s.dataset.prev; }
    });
    store.set('models', sels.map(x => x.value));
  }
  $('refs').innerHTML = ids.map(i => `<li><b>${E.MODELS[i].name}</b> — ${ABOUT[i] || ''} <a href="${E.MODELS[i].ref[0]}">${E.MODELS[i].ref[1]}</a></li>`).join('') +
    '<li><b>Prediction intervals</b> — <a href="https://www.cyrilvoyant.com/tools/probabilistic-solar-forecasting/">Probabilistic forecasting</a></li>' +
    '<li><b>NICE<sup>k</sup> scores</b> — <a href="https://www.cyrilvoyant.com/latest-publications-and-news/nice-forecast-evaluation/">NICE: errors relative to persistence</a></li>' +
    '<li><b>PCA of the inputs</b> — <a href="https://www.cyrilvoyant.com/prevision-pv-reduction-dimension/">Reducing the dimension</a> (<a href="https://cyrilvoyant.github.io/methods/pv-dimensionality-reduction-en.html">English</a>)</li>' +
    '<li><b>Course</b> — <a href="https://www.cyrilvoyant.com/teaching/solar-forecasting-course/">Solar forecasting course</a></li>';
  $('metdefs').innerHTML = MET.map(m => `<dt>${m[1]}${m[2] && m[2] !== 'target' ? ` <small>(${m[2]})</small>` : ''}</dt><dd>${m[5]}</dd>`).join('');
  function drawMetsel() {
    $('metsel').innerHTML = ['det', 'prob'].map(k => `<div><span class="mk">${k === 'det' ? 'Deterministic' : 'Probabilistic'}</span>` +
      MET.filter(m => m[3] === k).map(m => `<label title="${m[5].replace(/"/g, '&quot;')}"><input type="checkbox" value="${m[0]}"${picked.includes(m[0]) ? ' checked' : ''}> ${m[1]}</label>`).join('') + '</div>').join('');
  }
  drawMetsel();
  $('metsel').addEventListener('change', () => { picked = [...document.querySelectorAll('#metsel input:checked')].map(c => c.value); store.set('metrics', picked); if (result) table(); });

  // ---------- inputs ----------
  let learnN = 0;
  const count = (id, out) => { const r = E.parse(seriesText(id), 'x'); const n = r.values ? r.values.length : 0; $(out).textContent = n ? `${n.toLocaleString('en')} values` : ''; if (id === 'learn') { learnN = n; syncAnnual(); if ($('fore').value.trim()) qc('fore'); } qc(id); };
  // optional date column: "date;value" or "date<TAB>value" on every line (ISO 8601: 2026-06-01, 2026-06-01T10:00, 2026-06-01 10:00+02:00, or 2026-06 for months)
  const DATE = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;
  function splitDates(text) { // null when the lines are not dated; otherwise the values (same line numbers) and the dates
    const lines = text.replace(/\r\n?/g, '\n').split('\n'), dates = [], vals = [], multi = [], invalid = [], blank = [];
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim(); if (!s) { vals.push(''); continue; }
      const f = s.split(/[;\t]/).map(x => x.trim()), m = f.length > 1 ? DATE.exec(f[0]) : null;
      if (!m) { if (!dates.length && !vals.some(Boolean) && !/\d/.test(f[f.length - 1])) { vals.push(''); continue; } return null; } // a header line is skipped
      if (f.length > 2) multi.push(i + 1);
      if (!realDate(m)) invalid.push(i + 1);
      if (!f[1]) blank.push(i + 1); // a dated line without its value is a missing value, not a final line break
      dates.push({ m, s: f[0], line: i + 1 }); vals.push(f[1]);
    }
    return dates.length ? { dates, multi, invalid, blank, text: vals.join('\n') } : null;
  }
  function realDate(m) { // the calendar date and the time exist (no 30 February, no 24:00, no 10:75)
    const y = +m[1], mo = +m[2], d = m[3] ? +m[3] : 1, h = +(m[4] || 0), mi = +(m[5] || 0), s = +(m[6] || 0);
    if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
    if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return false;
    if (m[7] && m[7] !== 'Z') { const z = m[7].slice(1).replace(':', ''); if (+z.slice(0, 2) > 14 || +z.slice(2) > 59) return false; }
    return true;
  }
  const offMin = z => { if (!z || z === 'Z') return 0; const s = z[0] === '-' ? -1 : 1, d = z.slice(1).replace(':', ''); return s * (+d.slice(0, 2) * 60 + +d.slice(2)); };
  function stamps(dates) { // month index for monthly dates, else minutes (a written offset is applied; no offset: read as written)
    const monthly = dates.every(d => !d.m[4] && (!d.m[3] || d.m[3] === dates[0].m[3]));
    return { monthly, t: dates.map(({ m }) => monthly ? +m[1] * 12 + +m[2] - 1
      : Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1), +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 60000 - offMin(m[7])) };
  }
  const stepName = (s, monthly) => monthly ? (s === 1 ? 'month' : `${s} months`) : s % 1440 === 0 ? (s === 1440 ? 'day' : `${s / 1440} days`) : s % 60 === 0 ? (s === 60 ? 'hour' : `${s / 60} hours`) : `${s} min`;
  const seriesText = id => { const d = splitDates($(id).value); return d ? d.text : $(id).value; };
  // data check, shared by the box under each series and by the Run button: each check passed (✓) or what is wrong (✗)
  function analyse(id) {
    const raw = $(id).value;
    if (!raw.trim()) return null;
    const D = splitDates(raw), text = D ? D.text : raw;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let gapCount = 0;
    let last = lines.length - 1; while (last > 0 && !lines[last].trim()) last--;
    let first = 0; while (first < last && !lines[first].trim()) first++;
    const empty = []; for (let i = first; i <= last; i++) if (!lines[i].trim()) empty.push(i + 1);
    const r = E.parse(text, 'Line check'), v = r.values || [];
    const ln = a => (a.length > 3 ? a.slice(0, 3).join(', ') + ` and ${(a.length - 3).toLocaleString('en')} more` : a.join(', '));
    const checks = [
      [!r.error, 'Every value is a number (no NaN, no empty cell, no text)', r.error ? r.error.replace(/^Line check: line/, 'Line') : ''],
      [!empty.length, 'No empty line inside the series', empty.length ? `Empty line ${ln(empty)}: a missing value? Put a number instead (0, the previous value or a mean) so that the line still exists.` : ''],
      [v.length < 2 || Math.max(...v) > Math.min(...v), 'The series is not constant', 'All values are equal: nothing to forecast.'],
    ], notes = [];
    const per = readT(), T = per.error ? 0 : per.T;
    if (D) {
      checks.push([!D.multi.length, 'One value after each date', `Line ${ln(D.multi)}: several values after the date; keep only the date and one value.`]);
      checks.push([!D.blank.length, 'A value after each date', `Line ${ln(D.blank)}: a date without its value. Put a number (0, the previous value or a mean).`]);
      checks.push([!D.invalid.length, 'Every date written is a real calendar date (no 30 February, no 24:00)', `Line ${ln(D.invalid)}: this date or time does not exist (30 February, 24:00, 10:75…).`]);
      if (!D.invalid.length) {
        const S = stamps(D.dates), t = S.t, cnt = new Map(), bad = [], gaps = [], odd = [];
        for (let i = 1; i < t.length; i++) { const x = t[i] - t[i - 1]; if (x > 0) cnt.set(x, (cnt.get(x) || 0) + 1); }
        const step = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0];
        for (let i = 1; i < t.length; i++) { const x = t[i] - t[i - 1]; if (x <= 0) bad.push(D.dates[i].line); else if (x % step) odd.push(D.dates[i].line); else if (x > step) gaps.push(i - 1); }
        if (step === 1440 && !S.monthly && gaps.length) { // trading days: weekends and holidays absent, one value per trading day (EUR/USD, rates)
          const weekend = gaps.filter(g => { for (let m = t[g] + 1440; m < t[g + 1]; m += 1440) { const wd = new Date(m * 60000).getUTCDay(); if (wd !== 0 && wd !== 6) return false; } return true; }).length;
          if (weekend >= gaps.length / 2 && gaps.every(g => t[g + 1] - t[g] <= 5 * 1440)) { notes.push(`ℹ Trading days: ${gaps.length.toLocaleString('en')} jumps of 2 to 5 days (weekends, holidays) are not gaps; one value per trading day.`); gaps.length = 0; }
        }
        notes.push(`ℹ Dates read: ${D.dates[0].s} to ${D.dates[D.dates.length - 1].s}${step ? `, one line per ${stepName(step, S.monthly)}` : ''}. Only the values are used by the models.`);
        checks.push([!bad.length, 'Dates in increasing order, no duplicate', `Line ${ln(bad)}: date not after the previous one (duplicate or out of order; a clock change in local time?).`]);
        if (step) checks.push([!odd.length, `Same time step everywhere (${stepName(step, S.monthly)})`, `Line ${ln(odd)}: the time since the previous line is not a whole number of steps (one step = one ${stepName(step, S.monthly)}). Use one time step for the whole series.`]);
        gapCount = !bad.length && !odd.length ? gaps.length : 0;
        const g0 = gaps[0], gtxt = gaps.length ? `${gaps.length.toLocaleString('en')} gap${gaps.length > 1 ? 's' : ''}, the first after line ${D.dates[g0].line} (${D.dates[g0].s} → ${D.dates[g0 + 1].s})` : '';
        checks.push([!gaps.length, 'No gap: one line for every time step', `${gtxt}: fill them with one of the two buttons below (previous value or mean), or add one line per missing step with a number, so that every step has its line.`]);
        if (id === 'fore' && step) {
          const L = splitDates($('learn').value);
          if (L && !L.invalid.length) {
            const SL = stamps(L.dates);
            if (SL.monthly === S.monthly) {
              const gap = t[0] - SL.t[SL.t.length - 1], gd = gapDates(), okc = gd && gd.follows !== undefined ? gd.follows : gap === step /* trading days: Friday → Monday follows */, msg = `The learning series ends at ${L.dates[L.dates.length - 1].s} and this one starts at ${D.dates[0].s}`;
              if (T && $('gap').checked) {
                checks.push([gap > 0, 'Taken after the learning series', `${msg}: it must start later.`]);
              }
              else if (T) checks.push([okc, 'Follows the learning series with no step missing', `${msg}: it should start one step later, or tick “Not right after the learning series” if it does not follow.`]);
              else if (!okc) notes.push(`ℹ ${msg}.`);
            }
          }
        }
      }
    }
    if (id === 'learn' && T >= 2 && v.length % T && $('gap').checked) notes.push(`ℹ Not right after: the last ${v.length % T} learning value${v.length % T > 1 ? 's are' : ' is'} not used, so that the series to forecast starts at the hour of the first learning value.`);
    if (T >= 2 && !D && id === 'fore' && !$('gap').checked) notes.push('⚠ No dates: the page takes this series as following the learning series right after its last value, so the phase is known. If it does not (later, or another site), tick the box below.');
    else if (id === 'fore' && T >= 2 && !$('gap').checked) notes.push('ℹ Right after the learning series: the phase is known, all sine/cosine inputs are kept.');
    if (id === 'fore' && $('gap').checked) notes.unshift(gapNote());
    if (v.length && Math.min(...v) < 0) notes.push('ℹ Some values are negative: the three ELMs that take a logarithm will be set aside.');
    if (!D) notes.push('ℹ No date column: gaps and the start of the period cannot be checked here. Optional: put the date before each value (2026-06-01T10:00;412.5).');
    if (id === 'learn' && filledNote) notes.unshift(filledNote);
    return { checks, notes, v, ok: checks.every(c => c[0]), gaps: gapCount };
  }
  // series to forecast taken later (Cyril, 2026-11-25): the user confirms, or the dates show, whether both series start at the same hour
  // and on the same day of the year. Not the same hour: no period at all (steps per period = none). Not the same day: no day of the year.
  let gapT = null; // steps per period saved while "taken later" switches the period off
  let gapAuto = false; // the last state came from the dates
  const sunTimes = () => { // the two UTC times of the sun-position option, when the series to forecast does not follow
    if (!$('solar').checked || $('solNight').value !== 'sun' || !$('gap').checked) return null;
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/, a = $('solStart').value.trim(), b = $('solStartTest').value.trim();
    if (!iso.test(a) || !iso.test(b) || !isFinite(Date.parse(a)) || !isFinite(Date.parse(b))) return null;
    const x = new Date(Date.parse(a)), y = new Date(Date.parse(b)), md = d => d.toISOString().slice(5, 16);
    return { follows: undefined, hour: md(x).slice(5) === md(y).slice(5), day: md(x).slice(0, 5) === md(y).slice(0, 5), week: x.getUTCDay() === y.getUTCDay(), a: md(x).replace('T', ' '), b: md(y).replace('T', ' '), sun: true };
  };
  function gapDates() {
    const L = splitDates($('learn').value), F = splitDates($('fore').value);
    if (!L || !F || L.invalid.length || F.invalid.length || L.dates.length < 2 || !F.dates.length) return sunTimes();
    const a = stamps(L.dates), b = stamps(F.dates); if (a.monthly !== b.monthly) return null;
    if (a.monthly) { // month indices: follows when the first month to forecast is the month after the last learning month
      const after = b.t[0] - a.t[a.t.length - 1], d = b.t[0] - a.t[0], mo = m => `${Math.floor(m / 12)}-${String(m % 12 + 1).padStart(2, '0')}`;
      return { follows: after === 1, hour: d % 12 === 0, day: false, kind: 'month', a: mo(a.t[0]), b: mo(b.t[0]), monthly: true }; // monthly: question 2 = same month of the year
    }
    const cnt = new Map(); for (let i = 1; i < a.t.length; i++) { const z = a.t[i] - a.t[i - 1]; if (z > 0) cnt.set(z, (cnt.get(z) || 0) + 1); }
    const step = [...cnt].sort((p, q) => q[1] - p[1])[0][0], md = m => new Date(m * 60000).toISOString().slice(5, 16), x = md(a.t[0]), y = md(b.t[0]);
    const daily = step >= 1440, wd = m => new Date(m * 60000).getUTCDay(), days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']; // daily data: question 2 = same day of the week (Cyril 2026-11-25)
    let maxGap = step; for (let i = 1; i < a.t.length; i++) maxGap = Math.max(maxGap, a.t[i] - a.t[i - 1]); // trading days: weekends already inside the learning series
    const after = b.t[0] - a.t[a.t.length - 1];
    return daily ? { follows: after > 0 && after <= maxGap, hour: wd(a.t[0]) === wd(b.t[0]), day: false, kind: 'day', a: `${x.slice(0, 5)} (${days[wd(a.t[0])]})`, b: `${y.slice(0, 5)} (${days[wd(b.t[0])]})` }
      : { follows: after > 0 && after <= maxGap, hour: x.slice(5) === y.slice(5), day: x.slice(0, 5) === y.slice(0, 5), kind: 'hour', a: x.replace('T', ' '), b: y.replace('T', ' ') };
  }
  function presetsFromDates() { // the presets that fit the step read from the learning dates; null without dates or with another step
    const L = splitDates($('learn').value); if (!L || L.invalid.length || L.dates.length < 2) return null;
    const S = stamps(L.dates); if (S.monthly) return ['12', '132'];
    const cnt = new Map(); for (let i = 1; i < S.t.length; i++) { const x = S.t[i] - S.t[i - 1]; if (x > 0) cnt.set(x, (cnt.get(x) || 0) + 1); }
    const step = [...cnt].sort((x, y) => y[1] - x[1])[0]?.[0];
    return ({ 60: ['24'], 30: ['48'], 15: ['96'], 5: ['288'], 1440: ['7'] })[step] || null;
  }
  function gapKind(D) { // what question 2 means: from the dates; without dates from the period chosen; otherwise a general wording
    if (D && D.kind) return D.kind; const n = parseInt(gapT !== null ? gapT : $('T').value, 10);
    return n === 7 ? 'day' : n === 12 ? 'month' : n >= 24 && 1440 % n === 0 ? 'hour' : 'nodates';
  }
  function syncGap() {
    const D = gapDates();
    const auto = D && D.follows !== undefined; // series dates: the page sees whether the series to forecast follows
    if (auto) $('gap').checked = !D.follows;
    else if (gapAuto) { $('gap').checked = false; $('sameHour').checked = true; $('sameDay').checked = false; } // dates gone: back to the user's own answer
    gapAuto = !!auto;
    $('gap').disabled = !!auto; $('gap').parentElement.classList.toggle('gapoff', !!auto);
    $('gap').parentElement.classList.toggle('hidden', !!auto && D.follows); // the dates show that it follows: nothing to tick
    const g = $('gap').checked, kind = gapKind(D);
    $('sameHourTxt').textContent = { hour: 'Same hour of the day', day: 'Same day of the week', month: 'Same month of the year', nodates: 'Same hour (hourly data), same day of the week (daily), same month (monthly)' }[kind];
    $('sameDayTxt').textContent = kind === 'nodates' ? 'Same day of the year (hourly or finer data only)' : 'Same day of the year';
    $('sameDay').parentElement.classList.toggle('hidden', kind !== 'hour' && kind !== 'nodates'); if (kind !== 'hour' && kind !== 'nodates') $('sameDay').checked = false; // the day of the year only for hourly or finer data
    $('gapBox').classList.toggle('hidden', !g);
    if (D && g) { $('sameHour').checked = D.hour; $('sameDay').checked = D.day; }
    for (const id of ['sameHour', 'sameDay']) { $(id).disabled = !!D; $(id).parentElement.classList.toggle('gapoff', !!D); } // set from the dates: greyed, not editable
    $('gapHint').textContent = !g ? '' : D ? `From the ${D.sun ? 'two sun-position times' : 'dates'}: learning ${D.a}, to forecast ${D.b} (UTC).` : 'No dates: tick what is true.';
    const st = Date.parse($('solStart').value.trim()); $('solStartTest').placeholder = isFinite(st) ? new Date(new Date(st).setUTCFullYear(new Date(st).getUTCFullYear() + 1)).toISOString().slice(0, 16) + 'Z (for instance)' : 'UTC, with Z or an offset';
    $('solStartTest').classList.toggle('need', g && $('solar').checked && $('solNight').value === 'sun' && !$('solStartTest').value.trim());
    const off = g && !$('sameHour').checked;
    if (off && gapT === null) { gapT = $('T').value; $('T').value = 'none'; } else if (!off && gapT !== null) { $('T').value = gapT; gapT = null; }
    $('T').disabled = off; $('T').title = off ? 'None: the series to forecast does not start at the same hour.' : '';
    const fit = presetsFromDates(); // with dates, only the presets that match the time step (Cyril 2026-11-25)
    if (!off && fit && fit.length && !fit.includes($('T').value)) $('T').value = fit[0];
    $('Tquick').querySelectorAll('button').forEach(b => { b.disabled = off || !!(fit && b.dataset.v !== 'none' && !fit.includes(b.dataset.v)); }); $('Tquick').classList.toggle('gapoff', off); // no period at all: the presets are greyed too
    syncSolar(); syncPeriod();
  }
  function gapNote() { // short: which sine and cosine inputs are kept when the series to forecast does not follow
    if ($('solar').checked && $('solNight').value === 'sun' && !$('solStartTest').value.trim()) return '⚠ Not right after, with the sun position: give the time of the first value TO FORECAST (Solar series, below), in UTC.';
    const kind = gapKind(gapDates()), what = { hour: 'hour', day: 'day of the week', month: 'month', nodates: 'hour, day or month' }[kind];
    if (!$('sameHour').checked) return `⚠ Not right after, not the same ${what}: no period, so no sine/cosine and no cyclic model (PAR, BLEND, Holt-Winters, Theta…).`;
    if (kind === 'nodates') return `${$('sameDay').checked ? 'ℹ' : '⚠'} Not right after, same ${what}: sine/cosine of the period kept${$('sameDay').checked ? ' with the day of the year' : '; day of the year not used'}.`;
    if (kind === 'day' || kind === 'month') return `ℹ Not right after, same ${what}: sine/cosine of the ${what} kept.`;
    return $('sameDay').checked ? 'ℹ Not right after, same day and hour: all sine/cosine inputs kept (hour, day of the week, day of the year).' : '⚠ Not right after, same hour: sine/cosine of the hour kept; day of the year not used.';
  }
  function qc(id) {
    const box = $('qc-' + id), A = analyse(id);
    box.textContent = '';
    if (!A) { box.hidden = true; return; }
    const h = document.createElement('b'); h.textContent = A.ok ? `Data check: OK (${A.v.length.toLocaleString('en')} values)` : 'Data check: to fix'; box.append(h);
    for (const [pass, label, why] of A.checks) { const p = document.createElement('div'); p.className = pass ? 'ok' : 'ko'; p.textContent = (pass ? '✓ ' : '✗ ') + (pass ? label : why); box.append(p); }
    for (const n of A.notes) { const p = document.createElement('div'); p.className = n.startsWith('⚠') ? 'warn' : 'info'; p.textContent = n; box.append(p); }
    if (A.gaps) {
      const row = document.createElement('div'); row.className = 'fill';
      row.append(document.createTextNode('Fill the gaps of both series, one line per step: '));
      for (const [mode, text] of [['prev', 'with the previous value'], ['mean', 'with the mean of the values before and after']]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.addEventListener('click', () => fillGaps(mode)); row.append(b, ' ');
      }
      const why = document.createElement('small'); why.textContent = ' The added values are not measurements: they only keep the time grid regular.'; row.append(why);
      box.append(row);
    }
    box.classList.toggle('bad', !A.ok); box.hidden = false;
  }
  // fills every missing step of the two series (and between them) on their common time grid, then cuts the learning series
  // at the end of the learning series. Daily data get the period 7.
  function fillGaps(mode) {
    const L = splitDates($('learn').value), F = $('fore').value.trim() ? splitDates($('fore').value) : null;
    if (!L || L.invalid.length || L.multi.length || L.blank.length || F && (F.invalid.length || F.multi.length || F.blank.length)) return fail('Fill the gaps: first correct the dates marked ✗ in the data check.');
    const dates = F ? [...L.dates, ...F.dates] : L.dates;
    const vl = E.parse(L.text, 'Learning series'), vf = F ? E.parse(F.text, 'Series to forecast') : { values: [] };
    if (vl.error || vf.error) return fail('Fill the gaps: ' + (vl.error || vf.error));
    const y = [...vl.values, ...vf.values];
    if (y.length !== dates.length) return fail('Fill the gaps: every date needs one value first.');
    const S = stamps(dates), t = S.t, cnt = new Map();
    for (let i = 1; i < t.length; i++) { const x = t[i] - t[i - 1]; if (x > 0) cnt.set(x, (cnt.get(x) || 0) + 1); }
    const step = [...cnt].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!step) return fail('Fill the gaps: at least two dates are needed.');
    for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1] || (t[i] - t[i - 1]) % step) return fail(`Fill the gaps: at ${dates[i].s} the dates are not in order or not on a ${stepName(step, S.monthly)} grid; correct this first.`);
    const m0 = dates[0].m, off = offMin(m0[7]), p2 = n => String(n).padStart(2, '0');
    const fmt = x => {
      if (S.monthly) return `${Math.floor(x / 12)}-${p2(x % 12 + 1)}`;
      const d = new Date((x + off) * 60000), day = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
      return m0[4] === undefined ? day : `${day}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${m0[6] !== undefined ? ':' + p2(d.getUTCSeconds()) : ''}${m0[7] || ''}`;
    };
    const out = [], lastLearn = t[L.dates.length - 1]; let added = 0, nL = 0;
    for (let i = 0; i < t.length; i++) {
      if (i) for (let x = t[i - 1] + step; x < t[i]; x += step) { out.push([fmt(x), mode === 'prev' ? y[i - 1] : +((y[i - 1] + y[i]) / 2).toPrecision(12)]); added++; if (x < lastLearn) nL++; }
      out.push([dates[i].s, y[i]]); if (t[i] <= lastLearn) nL++;
    }
    let note = `ℹ Filled: ${added.toLocaleString('en')} line${added > 1 ? 's' : ''} added ${mode === 'prev' ? 'with the previous value' : 'with the mean of the values before and after'}.`;
    if (!S.monthly && step === 1440 && !readT().error && readT().T === 0) { $('T').value = '7'; note += ' One value per day now: period set to 7 (the week).'; }
    const keep = nL;
    $('learn').value = out.slice(0, keep).map(([s, v]) => s + ';' + v).join(String.fromCharCode(10));
    $('fore').value = out.slice(keep).map(([s, v]) => s + ';' + v).join(String.fromCharCode(10));
    filledNote = note;
    syncPeriod(); count('learn', 'nlearn'); count('fore', 'nfore');
  }
  // annual cycle: only when one period is one day and the learning series covers one year (Cyril, 2026-11-25; was two years)
  function annualNeed() { const r = readT(); return !r.error && r.T >= 24 && 1440 % r.T === 0 ? 365 * r.T : 0; } // the day of the year is j / T: only when one period is one day (24, 48, 96, 288… steps)
  function syncAnnual() {
    const need = annualNeed(), gap = $('gap').checked && !($('sameDay').checked && $('sameHour').checked), ok = need > 0 && learnN >= need && !gap;
    $('annualL').classList.toggle('off', !ok); if (!ok) $('annual').checked = false;
    const noWeek = $('gap').checked && !($('sameDay').checked && $('sameHour').checked); // not right after: the week only when both questions are ticked (Cyril 2026-11-25)
    $('weeklyL').classList.toggle('gapoff', noWeek); if (noWeek) $('weekly').checked = false; // taken later: no day of the week or of the year across the gap (Cyril, 2026-11-25)
    $('annualWhy').textContent = ok ? '' : gap ? '(not right after: needs the same day and the same hour)' : need ? `(needs one year of learning data: ${need.toLocaleString('en')} values)` : '(needs one period = one day: 24, 48 or 96 steps)';
  }
  // typed or pasted data are no longer the example: its description goes (Cyril, 2026-11-25)
  $('learn').addEventListener('input', e => { if (e.isTrusted) $('exlabel').textContent = ''; maxLearn = 10000; filledNote = ''; count('learn', 'nlearn'); syncGap(); });
  $('fore').addEventListener('input', e => { if (e.isTrusted) $('exlabel').textContent = ''; count('fore', 'nfore'); syncGap(); });
  function syncSearch() {
    const any = $('optIn').checked || $('optNh').checked || $('optLam').checked;
    $('slow').classList.toggle('hidden', !any);
    for (const [o, f] of [['optIn', 'lbFix'], ['optNh', 'nhFix'], ['optLam', 'lamFix']]) { $(f).disabled = $(o).checked; $(f).title = $(o).checked ? 'Searched: untick it in "Search" to fix it' : ''; }
  }
  ['optIn', 'optNh', 'optLam'].forEach(id => $(id).addEventListener('change', syncSearch));
  $('asym').addEventListener('change', () => { $('asymBox').classList.toggle('hidden', !$('asym').checked); syncLevels(); });
  $('cov').addEventListener('input', syncLevels);
  ['qlo', 'qhi'].forEach(id => $(id).addEventListener('input', syncLevels));
  function syncLevels() {
    const asymmetric = $('asym').checked;
    $('cov').readOnly = asymmetric;
    $('cov').title = asymmetric ? 'Calculated from Upper minus Lower; edit those two levels below.' : '';
    $('coverageHelp').classList.toggle('hidden', !asymmetric);
    if (asymmetric) {
      const lower = $('qlo').value, upper = $('qhi').value;
      $('cov').value = lower !== '' && upper !== '' && Number.isFinite(+lower) && Number.isFinite(+upper)
        ? Math.round((+upper - +lower) * 1e10) / 1e10 : '';
    } else {
      const c = +$('cov').value;
      $('qlo').value = (100 - c) / 2; $('qhi').value = 100 - (100 - c) / 2;
    }
  }

  // period: a whole number of steps, or "none"
  function readT() {
    const s = $('T').value.trim().toLowerCase();
    if (s === '' || s === 'none' || s === '0' || s === '-') return { T: 0 };
    const v = Number(s.replace(',', '.'));
    if (!Number.isInteger(v) || v < 1 || v > 10000) return { error: `Steps per period: "${$('T').value}" is not understood. Enter a whole number between 2 and 10,000, or "none".` };
    return { T: v < 2 ? 0 : v };
  }
  function syncPeriod() {
    const r = readT(), none = !r.error && r.T === 0;
    ['weeklyL', 'prepProfL'].forEach(id => $(id).classList.toggle('off', none || !!r.error));
    lockCycle(none); if ($('learn').value.trim()) qc('learn'); if ($('fore').value.trim()) qc('fore');
    if (none) { $('weekly').checked = false; $('annual').checked = false; const pp = document.querySelector('input[name="prep"][value="profile"]'); if (pp.checked) document.querySelector('input[name="prep"][value="none"]').checked = true; }
    const lb = r.error ? null : E.inputOptions(r.T), capped = !r.error && r.T > 500, short = !r.error && r.T > 0 && r.T < 8;
    $('Thint').textContent = r.error ? 'Enter a whole number of steps, or none.' : none
      ? 'Non-periodic: no clock inputs; cyclic models are set aside. Inputs: 3, 8, 16 or 32 lags (no period, so no natural scale: up to 32 past values).'
      : `Clock inputs (sine and cosine): ${r.T >= 24 && 1440 % r.T === 0 ? `hour of the day (${r.T} steps)` : `place in the period (${r.T} steps)`}CLOCKX. Inputs: ${lb.join(', ')} lags${capped ? ' (capped at 500 past values)' : short ? ' (period under 8 steps: up to 32 past values)' : ' (one tenth, a quarter, half or all of one period)'}.`;
    $('lbUnit').textContent = none || capped || short ? '(lags)' : '(periods)';
    if (lb) [...$('lbFix').options].forEach((o, i) => { o.textContent = none || capped || short ? `${lb[i]} lag${lb[i] > 1 ? 's' : ''}` : `${['1/10', '1/4', '1/2', '1'][i]} period = ${lb[i]} lag${lb[i] > 1 ? 's' : ''}`; });
    $('optInL').textContent = none || short ? `Inputs: ${lb.join(', ')} lags` : capped ? `Inputs: ${lb.join(', ')} lags` : 'Inputs: 1/10, 1/4, 1/2, 1 period';
    syncAnnual();
    // the clock inputs actually given to the AR and the ELMs: sin/cos of the hour, plus the week and the day in the year when ticked
    const extra = (!none && !r.error ? [$('weekly').checked ? ' + day of the week (1 to 7)' : '', $('annual').checked ? ' + day of the year (365.25 days)' : ''] : []).join('');
    $('Thint').textContent = $('Thint').textContent.replace('CLOCKX', extra);
  }
  $('T').addEventListener('input', () => { syncPeriod(); syncGap(); }); // the questions follow the period when there are no dates
  $('weekly').addEventListener('change', syncPeriod); $('annual').addEventListener('change', syncPeriod);
  $('Tquick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || $('T').disabled) return; $('T').value = b.dataset.v; syncPeriod(); syncGap(); });

  const EXAMPLES = { ghi: ['example-ghi.js?v=1.4.1', () => (self.PRED_EXAMPLES || {}).ghi, { scoreOn: 'day', night: 'sun', lat: 44.0128, lon: 20.9114, start: '2023-09-01T00:00Z', stamp: 'start' }], edf: ['example.js?v=1.4.1', () => self.PRED_EXAMPLE, null], gti: ['example-gti.js?v=1.4.1', () => (self.PRED_EXAMPLES || {}).gti, { scoreOn: 'day', night: 'observed' }], sunspots: ['example-sunspots.js?v=1.4.1', () => (self.PRED_EXAMPLES || {}).sunspots, null], eurusd: ['example-eurusd.js?v=1.4.1', () => (self.PRED_EXAMPLES || {}).eurusd, null], us10y: ['example-us10y.js?v=1.4.1', () => (self.PRED_EXAMPLES || {}).us10y, null], dkasc: ['example-dkasc.js?v=1.4.1', () => (self.PRED_EXAMPLES || {}).dkasc, { scoreOn: 'day', night: 'sun', lat: -23.762, lon: 133.875, start: '2021-02-25T14:35Z', stamp: 'end' }] };
  const syncSolar = () => { $('solarBox').classList.toggle('hidden', !$('solar').checked); $('sunBox').classList.toggle('hidden', $('solNight').value !== 'sun'); for (const id of ['solStartTest', 'solStartTestL']) $(id).classList.toggle('hidden', !$('gap').checked); };
  $('solar').addEventListener('change', syncGap); $('solNight').addEventListener('change', syncGap); ['solStart', 'solStartTest'].forEach(id => $(id).addEventListener('input', syncGap)); $('gap').addEventListener('change', syncGap);
  ['sameHour', 'sameDay'].forEach(id => $(id).addEventListener('change', syncGap));
  function setSolar(o) {
    $('solar').checked = !!o;
    if (o) {
      if (o.scoreOn) $('solScore').value = o.scoreOn; if (o.cvOn) $('solCv').value = o.cvOn;
      $('solNight').value = ['sun', 'none'].includes(o.night) ? o.night : 'observed';
      $('solLat').value = o.lat ?? ''; $('solLon').value = o.lon ?? ''; $('solStart').value = o.start || ''; $('solStartTest').value = o.startTest || ''; $('solStamp').value = o.stamp || 'start';
    }
    syncSolar();
  }
  function loadExample(then, key) {
    const [file, get, sol] = EXAMPLES[key || $('exsel').value] || EXAMPLES.ghi;
    const load = () => {
      const x = get();
      filledNote = ''; $('gap').checked = false; if (gapT !== null) { $('T').disabled = false; gapT = null; } // an example follows its learning series: no leftover "not right after"
      const dl = (v, d) => d ? v.map((y, i) => d[i] + ';' + y) : v; $('learn').value = dl(x.learn, x.dates && x.dates.learn).join('\n'); $('fore').value = dl(x.forecast, x.dates && x.dates.forecast).join('\n'); $('T').value = x.T; $('weekly').checked = !!x.weekly; $('annual').checked = !!x.annual; syncPeriod(); // the example's cycles before the hint is written
      setSolar(sol); $('exlabel').textContent = x.label; count('learn', 'nlearn'); count('fore', 'nfore'); syncGap(); then && then();
    };
    if (get()) return load();
    const s = document.createElement('script'); s.src = file; s.onload = load; document.head.append(s);
  }
  $('example').addEventListener('click', () => loadExample());
  $('tryEx').addEventListener('click', () => loadExample(() => { $('go').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('go').focus(); }));

  const radio = n => (document.querySelector(`input[name="${n}"]:checked`) || {}).value;
  function fail(msg, title) { const e = $('err'); e.innerHTML = `<b>${title || 'Something needs fixing'}</b>`; e.append(document.createTextNode(msg)); e.classList.add('on'); e.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function solarCfg() {
    if (!$('solar').checked) return null;
    const o = { scoreOn: $('solScore').value, cvOn: $('solCv').value, night: $('solNight').value };
    if (o.night !== 'sun') return o;
    const lat = $('solLat').value.trim(), lon = $('solLon').value.trim(), start = $('solStart').value.trim();
    if (lat === '' || !(Math.abs(+lat) <= 90)) return { error: 'Sun position: give the latitude of the site, in degrees between -90 and 90 (north positive), or choose "observed zeros".' };
    if (lon === '' || !(Math.abs(+lon) <= 180)) return { error: 'Sun position: give the longitude of the site, in degrees between -180 and 180 (east positive).' };
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(start) || !isFinite(Date.parse(start))) return { error: 'Sun position: give the time of the first learning value with its time zone, for instance 2021-02-25T14:35Z (UTC) or 2021-02-26T00:05+09:30.' };
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/, startTest = $('solStartTest').value.trim();
    if ($('gap').checked && (!iso.test(startTest) || !isFinite(Date.parse(startTest)))) return { error: `Sun position: the series to forecast does not follow the learning series, so give the time of its first value too, in UTC (for instance ${isFinite(Date.parse(start)) ? new Date(new Date(Date.parse(start)).setUTCFullYear(new Date(Date.parse(start)).getUTCFullYear() + 1)).toISOString().slice(0, 16) + 'Z' : '2024-09-01T00:00Z'}, one year after the first learning value).` };
    return Object.assign(o, { lat: +lat, lon: +lon, start, stamp: $('solStamp').value }, $('gap').checked ? { startTest } : {});
  }
  function readJob() {
    $('err').classList.remove('on');
    for (const [id, name] of [['learn', 'Learning series'], ['fore', 'Series to forecast']]) { const A = analyse(id), k = A && A.checks.find(c => !c[0]); if (k) { qc(id); return fail(`${name}: ${k[2]} (see the data check under the box).`); } }
    const L = E.parse(seriesText('learn'), 'Learning series', maxLearn); if (L.error) return fail(L.error);
    if (L.values.length > 10000) $('status').textContent = `Long learning series (${L.values.length.toLocaleString('en')} values): the search can take several minutes.`;
    const F = E.parse(seriesText('fore'), 'Series to forecast', maxLearn); if (F.error) return fail(F.error);
    const P = readT(); if (P.error) return fail(P.error);
    const T = P.T, h = Number($('horizon').value);
    if (!Number.isInteger(h) || h < 1 || h > 100) return fail(`Horizon: "${$('horizon').value}" is not a whole number of lags between 1 and 100.`);
    const lbOpts = E.inputOptions(T), lbMax = Math.max(...lbOpts);
    const need = 5 * (Math.max(lbMax, 48) + h + T) + 100;
    if (L.values.length < need) return fail(`Learning series: ${L.values.length.toLocaleString('en')} values; at least ${need.toLocaleString('en')} are needed here (inputs up to ${lbMax} lags, horizon ${h}${T ? `, period ${T}` : ''}, 5 cross-validation blocks). Paste a longer series, or lower the horizon.`);
    if (F.values.length < h + 1) return fail(`Series to forecast: ${F.values.length} values; at least ${h + 1} are needed to score horizon ${h}.`);
    if (L.values.every(v => v === L.values[0])) return fail('Learning series: all values are equal; there is nothing to forecast.');
    if (!$('asym').checked) { const c = +$('cov').value; if (!(c >= 10 && c <= 99)) return fail('Nominal coverage: enter a value between 10 and 99 %.'); }
    const qlo = +$('qlo').value / 100, qhi = +$('qhi').value / 100;
    if (!(qlo > 0 && qlo < 0.5 && qhi > 0.5 && qhi < 1)) return fail('Interval levels: the lower level must lie between 0 and 50 %, the upper level between 50 and 100 %.');
    const models = sels.map(s => s.value);
    if (new Set(models).size < 4) return fail('Models: choose four different models.');
    const sol = solarCfg(); if (sol && sol.error) return fail(sol.error);
    if (sol && sol.night === 'sun' && 1440 % T) return fail('Sun position: the period T must divide one day (24 for hourly steps, 96 for 15 min, 288 for 5 min), so that the step is known.');
    return {
      train: L.values, test: F.values, models,
      cfg: { T, gap: $('gap').checked, gapSameDay: $('gap').checked && $('sameDay').checked && $('sameHour').checked, weekly: $('weekly').checked, annual: $('annual').checked, horizons: [h], lbOpts, pca: $('pca').checked, pcaVar: 0.95,
        opt: { inputs: $('optIn').checked, neurons: $('optNh').checked, ridge: $('optLam').checked, smooth: $('optSm').checked },
        nhOpts: [10, 50, 100, 500], ncand: 5, ncandFixed: 5, // every ELM keeps the best of 5 random hidden layers, for each input size tried when searched (Cyril, 2026-11-26: 30 made runs 6 to 30 times longer)
        lbFixed: lbOpts[+$('lbFix').value], nhFixed: +$('nhFix').value, lamFixed: +$('lamFix').value,
        act: $('act').value, qlo, qhi, bandKind: $('bandKind').value, bandAsym: $('asym').checked, bandPhase: $('bandPhase').checked, norm: radio('norm'), prep: radio('prep'), clip: $('clip').checked, solar: sol, seed: 42, folds: 5 },
    };
  }

  // ---------- run ----------
  // the three data rules, recalled once per visit before the first run (the tool cannot see time stamps)
  let rulesOk = false; try { rulesOk = sessionStorage.getItem('frugalcast.rulesOk') === '1'; } catch (e) { /* storage blocked */ }
  $('go').addEventListener('click', () => {
    if (rulesOk) return runNow();
    try { $('rulesDlg').showModal(); } catch (e) { runNow(); }
  });
  $('rulesBack').addEventListener('click', () => $('rulesDlg').close());
  $('rulesOk').addEventListener('click', () => {
    if ($('rulesSkip').checked) { rulesOk = true; try { sessionStorage.setItem('frugalcast.rulesOk', '1'); } catch (e) { /* storage blocked */ } }
    $('rulesDlg').close(); runNow();
  });
  function runNow() {
    const nj = readJob(); if (!nj) { API.error($('err').textContent); return; }
    job = nj; result = null; ran = API.snapshot(); $('results').classList.add('hidden'); $('kpis').innerHTML = ''; $('err').classList.remove('on'); // nothing from the previous run stays on screen
    $('go').disabled = true; $('stop').disabled = false; $('barfill').style.width = '0';
    $('status').textContent = 'Starting…'; t0 = performance.now();
    try { worker = new Worker('worker.js?v=1.4.1'); } catch (e) { reset(); return fail('Open this page through a web server (not as a local file) so that the computation can run in the background.'); }
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { $('barfill').style.width = (100 * m.f).toFixed(1) + '%'; $('status').textContent = `${Math.round(100 * m.f)} % · ${m.text}`; }
      else if (m.type === 'done') { reset(); $('barfill').style.width = '100%'; $('status').textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`; result = m.out; show(); API.done(); }
      else if (m.type === 'error') { reset(); $('status').textContent = 'Stopped on an error.'; fail(m.message); API.error(m.message); }
    };
    worker.onerror = e => { reset(); fail((e.message || 'unknown error') + '. Please report it with the settings used.', 'Computation error'); API.error(e.message || 'unknown error'); };
    worker.postMessage(job);
  }
  $('stop').addEventListener('click', () => { if (worker) worker.terminate(); reset(); $('status').textContent = 'Stopped.'; });
  function reset() { $('go').disabled = false; $('stop').disabled = true; worker = null; }

  // ---------- results ----------
  const fmt = (v, k) => v === Infinity ? '∞' : v === -Infinity ? '−∞' : !Number.isFinite(v) ? '–' : (k === 'picp' || k === 'ace') ? v.toFixed(3) : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  const H = () => result.horizons[0];
  const col = id => COLORS[job.models.indexOf(id)];
  const live = h => job.models.filter(id => h.models[id]);
  const shown = h => live(h).filter(id => { const c = document.querySelector(`#pmsel input[value="${id}"]`); return !c || c.checked; });
  function show() {
    $('results').classList.remove('hidden');
    if (result.skipped.length) fail(result.skipped.map(s => `• ${s.name || s.id}: ${s.why}`).join('\n'), 'Set aside on this series');
    const h = H();
    $('pmsel').innerHTML = live(h).map(id => `<label style="--c:${col(id)}"><input type="checkbox" value="${id}" checked><span class="sw"></span>${E.MODELS[id].name}</label>`).join('');
    $('win').max = Math.max(0, h.y.length - winLen()); $('win').value = $('win').max;
    draw();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const winLen = () => { const T = job.cfg.T || 24; return Math.min(3 * T, Math.max(T, 150)); }; // 3 periods, at most 150 steps (one period if longer), so that the plot stays readable and scrolls
  $('pmsel').addEventListener('change', () => { drawSeries(); drawDx(); });
  $('win').addEventListener('input', () => { drawSeries(); if (on('fan')) PLOT.fan($('dx-fan'), H(), shown(H())); });
  document.querySelectorAll('.dx').forEach(c => c.addEventListener('change', drawDx));
  const on = k => document.querySelector(`.dx[value="${k}"]`).checked;
  function draw() { kpis(); table(); drawSeries(); drawDx(); }

  function best(k, vals, target) {
    const ok = vals.filter(Number.isFinite); if (!ok.length) return NaN;
    const rule = MDEF[k][4];
    if (rule === 'max') return Math.max(...ok);
    if (rule === 'zero') return ok.reduce((b, v) => Math.abs(v) < Math.abs(b) ? v : b);
    if (rule === 'target') return ok.reduce((b, v) => Math.abs(v - target) < Math.abs(b - target) ? v : b);
    return Math.min(...ok);
  }
  // result of the optimisation: what cross-validation kept (searched) and what was fixed, with the validation RMSE
  const SEARCHED = { inputs: 'inputs', neurons: 'neurons', ridge: 'ridge', 'ridge λ (GCV)': 'none' }; // GCV is not a CV search: no CV badge, the label says GCV
  function settings(id, m) {
    const c = m.chosen || {}, o = job.cfg.opt || {}, keys = Object.keys(c);
    const lab = k => k === 'inputs' ? 'inputs (lags)' : k === 'candidate' ? 'random layer no.' : k === 'PCA components' ? 'PCA components kept (95 %)' : k;
    const rows = keys.filter(k => c[k] !== null && c[k] !== undefined).map(k => {
      const searched = (SEARCHED[k] && o[SEARCHED[k]]) || (k === 'candidate' && (o.inputs || o.neurons)) || (!SEARCHED[k] && k !== 'candidate' && k !== 'theta' && k !== 'orders p(h)' && k !== 'PCA components' && o.smooth);
      return `<div class="row set"><span>${lab(k)}${searched ? ' <i class="cvk" title="Chosen by cross-validation on the learning series">CV</i>' : ''}</span><b>${typeof c[k] === 'number' ? +c[k].toPrecision(4) : c[k]}</b></div>`;
    }).join('');
    const T = (m.tried || []).slice().sort((a, b) => a.cvRmse - b.cvRmse), keysT = T.length ? Object.keys(T[0]).filter(k => k !== 'cv' && k !== 'cvRmse') : [];
    const canNormalize = Number.isFinite(m.cvDen) && m.cvDen > 0;
    const tried = T.length ? `<details class="tried"><summary>${T.length} configurations tested</summary><table><thead><tr>${keysT.map(k => `<th>${lab(k)}</th>`).join('')}<th>RMSE</th>${canNormalize ? '<th>nRMSE</th>' : ''}</tr></thead><tbody>${T.map((o, i) => `<tr${i ? '' : ' class="kept"'}>${keysT.map(k => `<td>${typeof o[k] === 'number' ? +o[k].toPrecision(4) : o[k]}</td>`).join('')}<td>${fmt(o.cvRmse)}</td>${canNormalize ? `<td>${Number.isFinite(o.cvRmse) ? (o.cvRmse / m.cvDen).toFixed(4) : '–'}</td>` : ''}</tr>`).join('')}</tbody></table></details>` : '';
    const folds = m.cvFolds?.length ? `<details class="tried"><summary>Validation by fold (${H().cvValidation?.used ?? m.cvFolds.length} used)</summary><table><thead><tr><th scope="col">Fold</th><th scope="col">Points scored</th><th scope="col">RMSE</th>${canNormalize ? '<th scope="col">nRMSE</th>' : ''}<th scope="col">Bias</th></tr></thead><tbody>${m.cvFolds.map((f, i) => `<tr><th scope="row">${i + 1}</th><td>${fmt(f.n)}</td><td>${fmt(f.rmse)}</td>${canNormalize ? `<td>${Number.isFinite(f.rmse) ? (f.rmse / m.cvDen).toFixed(4) : '–'}</td>` : ''}<td>${fmt(f.bias)}</td></tr>`).join('')}</tbody></table><small>Fold k: fitted on blocks 1 to k of the learning series, scored on block k + 1. A fold with a larger error often covers a harder season. Bias = forecast − observation.${canNormalize ? ` Validation scale ${fmt(m.cvDen)}.` : ''}</small></details>` : '';
    return `<div class="sets"><div class="row"><span>Settings kept</span><small>validation RMSE ${fmt(m.cvRmse)}</small></div>${rows || '<div class="row set"><span>none (no setting)</span></div>'}${folds}${tried}</div>`;
  }
  function kpis() {
    const h = H(), ms = live(h), bn = best('nrmse', ms.map(id => h.models[id].score.nrmse));
    const sc0 = h.persistence.n, positiveOnly = result.solar?.scoreOn === 'day';
    $('rsub').textContent = `Learning: ${job.train.length.toLocaleString('en')} values · Test: ${job.test.length.toLocaleString('en')} values · Horizon ${h.h} · ${sc0.toLocaleString('en')} of ${h.y.length.toLocaleString('en')} forecasts scored` + (positiveOnly ? (result.solar.night === 'sun' ? ` · daytime targets (sun above ${result.solar.dayMin}°)` : ' · observed targets > 0') : '') + (!result.solar ? '' : result.solar.night === 'sun' ? ' · night from the sun position written as 0 (causal)' : result.solar.night === 'none' ? ' · no night rule' : ' · night (observed 0) written as 0: not causal');
    const warnings = new Set(live(h).flatMap(id => Object.values(h.models[id].score.notes || {})).filter(x => typeof x === 'string'));
    if (h.cvValidation?.warning) warnings.add(h.cvValidation.warning);
    if (result.solar?.warning) warnings.add('Sun position: ' + result.solar.warning);
    if (h.cvValidation?.normalizationNote) warnings.add(`Validation: ${h.cvValidation.normalizationNote}`);
    if (!sc0 && positiveOnly) warnings.add('No positive observations remain at this horizon. Scores on positive targets are unavailable.');
    $('scoreNotes').textContent = [...warnings].join(' ');
    $('scoreNotes').hidden = !warnings.size;
    $('kpis').innerHTML = job.models.map((id, k) => {
      const m = h.models[id], name = E.MODELS[id].name;
      if (!m) { const why = (result.skipped.find(s => s.id === id) || {}).why;
        return `<div class="kpi gone" style="--c:${COLORS[k]}"><div class="nm">${name}</div><div class="row">set aside on this series</div>${why ? `<div class="row"><small>${why.replace(/</g, '&lt;')}</small></div>` : ''}</div>`; }
      const s = m.score;
      return `<div class="kpi" style="--c:${COLORS[k]}">${s.nrmse === bn ? '<span class="crown">best nRMSE</span>' : ''}<div class="nm">${name}</div>
        <div class="big">${fmt(s.nrmse, 'nrmse')}<small>nRMSE</small></div>
        <div class="row"><span>R²</span><b>${fmt(s.r2)}</b></div>
        <div class="row"><span>NICE² <small>(vs persistence)</small></span>${s.nice2 >= 1 ? `<b class="poor" title="NICE ≥ 1: no better than persistence">${fmt(s.nice2)}*</b>` : `<b>${fmt(s.nice2)}</b>`}</div>${s.nice2 >= 1 ? '<div class="row poor-note">* Not reliable: no better than persistence on this series</div>' : ''}
        <div class="row"><span>PICP (target ${(job.cfg.qhi - job.cfg.qlo).toFixed(2)})</span><b>${fmt(s.picp, 'picp')}</b></div>
        <div class="row"><span>CRPS</span><b>${fmt(s.crps)}</b></div>${settings(id, m)}</div>`;
    }).join('');
  }
  function rows() {
    const h = H(), out = [['Persistence (reference)', h.persistence, null]];
    job.models.forEach((id, k) => { if (h.models[id]) out.push([E.MODELS[id].name, h.models[id].score, k]); });
    return out;
  }
  const cols = () => MET.filter(m => picked.includes(m[0]));
  function table() {
    const R = rows(), M = R.slice(1), target = job.cfg.qhi - job.cfg.qlo, b = {}, C = cols();
    for (const [k] of C) b[k] = best(k, M.map(r => r[1][k]), target);
    $('met').innerHTML = '<thead><tr><th>Model</th>' + C.map(c => `<th title="${c[5].replace(/"/g, '&quot;')}">${c[1]}${c[2] ? `<small>${c[2] === 'target' ? 'target ' + target.toFixed(2) : c[2]}</small>` : ''}</th>`).join('') + '</tr></thead><tbody>' +
      R.map(([name, s, k]) => `<tr${k === null ? ' class="ref"' : ''}><td>${k === null ? name : `<span class="sw" style="background:${COLORS[k]}"></span>${name}`}</td>` + C.map(c => {
        if (k === null && c[3] === 'prob') return '<td>–</td>';
        // NICE ≥ 1 (Cyril, 2026-11-26): the model does no better than persistence; red with an asterisk, explained under the table
        const poor = k !== null && /^nice/.test(c[0]) && s[c[0]] >= 1;
        return `<td${k !== null && s[c[0]] === b[c[0]] ? ' class="best"' : poor ? ' class="poor"' : ''}>${fmt(s[c[0]], c[0])}${poor ? '*' : ''}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';
    if ($('wilBox').open) wilTable();
    const h = H(), anyPoor = M.some(r => C.some(c => /^nice/.test(c[0]) && r[1][c[0]] >= 1));
    $('chosen').innerHTML = `${anyPoor ? '<b class="poor">* NICE ≥ 1: not reliable.</b> The model does no better than persistence (repeating the last value) on this series. ' : ''}${job.cfg.norm === 'none' ? 'Errors shown in the units of the series.' : 'Normalized errors are fractions. See the notes for any change to the requested scale.'} ${job.cfg.prep === 'center' ? 'Series centred before modelling. ' : job.cfg.prep === 'standard' ? 'Series centred and scaled before modelling. ' : job.cfg.prep === 'profile' ? 'Mean profile removed before modelling and added back to forecasts and intervals. ' : ''}${Math.round(100 * target)} % ${job.cfg.bandKind === 'gaussian' ? 'Gaussian' : job.cfg.bandAsym ? 'asymmetric conformal-style' : 'symmetric conformal-style'} intervals. Best value in bold. Hover a column name for its definition.<br><b>Settings kept</b> — ` +
      live(h).map(id => { const c = h.models[id].chosen; const p = Object.entries(c).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toPrecision(4) : v}`).join(', '); return `${E.MODELS[id].name}${p ? ': ' + p : ': no setting'}`; }).join(' · ');
  }

  // ---------- Wilcoxon signed-rank test, pair by pair, on demand (Cyril, 2026-11-25) ----------
  // absolute errors of two models on the same scored targets of the horizon shown; E.wilcoxon gives the two-sided p-value
  function wilTable() {
    const h = H(), ids = live(h), idx = E.spacedTargets(h.scored || h.y.map((_, i) => i), h.h); // one target every h steps: errors that do not overlap
    const err = id => idx.map(i => h.y[i] - h.models[id].pred[i]), name = id => E.MODELS[id].name, esc = t => String(t).replace(/</g, '&lt;');
    if (ids.length < 2) { $('wil').innerHTML = '<p class="note">Tick at least two models.</p>'; return; }
    const E_ = Object.fromEntries(ids.map(id => [id, err(id)])), pairs = ids.length * (ids.length - 1) / 2;
    const fp = p => !Number.isFinite(p) ? '–' : p < 0.001 ? '&lt; 0.001' : p.toFixed(3);
    let rows = '';
    for (const a of ids) {
      rows += `<tr><th scope="row">${esc(name(a))}</th>`;
      for (const b of ids) {
        if (a === b) { rows += '<td class="diag"></td>'; continue; }
        const w = E.wilcoxon(E_[a], E_[b]);
        if (!Number.isFinite(w.p)) { rows += `<td class="ns">–<small>no nonzero difference</small></td>`; continue; }
        const sig = w.p < 0.05, win = w.better === 'a' ? a : w.better === 'b' ? b : null, ea = E_[a], eb = E_[b];
        let closer = 0; for (let i = 0; i < ea.length; i++) if (Math.abs(win === b ? eb[i] : ea[i]) < Math.abs(win === b ? ea[i] : eb[i])) closer++;
        rows += `<td class="${sig ? 'sig' : 'ns'}" title="n = ${w.n} nonzero differences, ${w.zeros} ties at 0; median of |error| ${esc(name(a))} − |error| ${esc(name(b))} = ${+w.medianDiff.toPrecision(3)}">p ${fp(w.p)}<small>${sig && win ? esc(name(win)) + ' better, closer on ' + Math.round(100 * closer / ea.length) + ' % of targets' : 'no significant difference'}</small></td>`;
      }
      rows += '</tr>';
    }
    $('wil').innerHTML = `<p class="note">Horizon ${h.h}, ${idx.length.toLocaleString('en')} scored targets${h.h > 1 ? `, one every ${h.h} steps so that the errors do not overlap` : ''}${h.scored ? ' (taken from the scored targets above)' : ''}. Each cell compares the model of its row with the model of its column.</p>
      <div class="tablewrap"><table><thead><tr><th></th>${ids.map(id => `<th scope="col">${esc(name(id))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <p class="note"><b>What the test does.</b> For every scored target, it takes the absolute error of each of the two models and looks at the difference. It ranks these differences by size and checks whether one model wins more often, and by larger margins, than chance would give (Wilcoxon signed-rank test, paired, two-sided; normal approximation with continuity and tie corrections, exact p-value below 20 pairs). At horizon h, two neighbouring targets share h − 1 steps of the same path, so their errors are not independent: the test keeps one target every h steps. Few targets give large p-values: not significant, not proof of equality.</p>
      <p class="note"><b>What the p-value means.</b> It is the probability of seeing a difference at least this large if the two models were in fact equally accurate.</p>
      <ul class="note"><li><b>p &lt; 0.05</b>: the difference is significant at the 5 % level; the cell names the model with the smaller errors.</li>
      <li><b>p ≥ 0.05</b>: these data do not show a difference. This does not prove that the two models are equal.</li>
      <li>The test looks at the typical error (ranks of the differences), while RMSE is driven by the largest errors. Two close nRMSE can hide very different typical errors: one model can be closer most of the time while both miss the same big jumps.</li><li>The p-value says nothing about the size of the gain: a tiny gain on many targets can be significant. Look at the MAE and the nRMSE for the size.</li>
      <li>Successive errors of a time series are correlated, so the test is optimistic: the true p-value is larger than the one shown.</li>
      <li>${pairs} pair${pairs > 1 ? 's are' : ' is'} tested here: even with equally good models, about ${(0.05 * pairs).toFixed(pairs < 20 ? 2 : 1)} would come out below 0.05 by chance.</li></ul>`;
  }
  $('wilBox').addEventListener('toggle', () => { if ($('wilBox').open && result) wilTable(); });

  // ---------- canvas helpers ----------
  function setup(cv, hgt) {
    const r = window.devicePixelRatio || 1, w = cv.clientWidth || cv.parentNode.clientWidth;
    cv.width = w * r; cv.height = hgt * r; cv.style.height = hgt + 'px';
    const g = cv.getContext('2d'); g.scale(r, r); g.font = '12px system-ui,Segoe UI,sans-serif'; g.lineJoin = 'round'; return [g, w, hgt];
  }
  const tick = v => { const a = Math.abs(v); return a >= 1000 ? Math.round(v).toLocaleString('en') : a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2); };
  function yAxis(g, x0, y0, w, hh, lo, hi, n) {
    g.lineWidth = 1; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let i = 0; i <= n; i++) { const v = lo + (hi - lo) * i / n, y = Math.round(y0 + hh - hh * i / n) + .5; g.strokeStyle = GRID; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke(); g.fillStyle = MUTED; g.fillText(tick(v), x0 - 6, y); }
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  }
  function xAxis(g, x0, y0, w, lo, hi, n, f) {
    g.textAlign = 'center'; g.fillStyle = MUTED;
    for (let i = 0; i <= n; i++) { const v = lo + (hi - lo) * i / n, x = Math.round(x0 + w * i / n) + .5; g.strokeStyle = GRID; g.beginPath(); g.moveTo(x, 8); g.lineTo(x, y0); g.stroke(); g.fillText(f ? f(v) : tick(v), x, y0 + 16); }
    g.textAlign = 'left';
  }
  function path(g, a, b, X, Yf, c, lw, dash) { g.strokeStyle = c; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath(); for (let i = a; i < b; i++) i === a ? g.moveTo(X(i), Yf(i)) : g.lineTo(X(i), Yf(i)); g.stroke(); g.setLineDash([]); g.lineWidth = 1; }
  function dots(g, a, b, X, Yf, c) { g.fillStyle = '#fff'; g.strokeStyle = c; g.lineWidth = 1.4; const r = b - a > 150 ? 1.6 : 2.6; for (let i = a; i < b; i++) { g.beginPath(); g.arc(X(i), Yf(i), r, 0, 7); g.fill(); g.stroke(); } g.lineWidth = 1; }
  function area(g, a, b, X, Yup, Ylo, fill) { g.fillStyle = fill; g.beginPath(); for (let i = a; i < b; i++) g.lineTo(X(i), Yup(i)); for (let i = b - 1; i >= a; i--) g.lineTo(X(i), Ylo(i)); g.closePath(); g.fill(); }
  const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
  const pad = (lo, hi) => { const p = (hi - lo) * 0.06 || 1; return [lo - p, hi + p]; };
  // night rule: the engine sets the forecast and both limits to 0 there, and every centile too (point mass at 0)
  const cen = (m, i, k) => { if (m.pred[i] === 0 && m.lo[i] === 0 && m.hi[i] === 0) return 0; const sc = m.sc ? m.sc[i] : 1, v = m.pred[i] + (sc === 0 ? 0 : (m.cph ? m.cent[m.cph[i]] : m.cent)[k] * sc); return m.low0 && v < 0 ? 0 : v; };
  function title(g, x, y, txt, c) { g.font = '600 13px system-ui,Segoe UI,sans-serif'; g.fillStyle = c; g.fillText(txt, x, y); g.font = '12px system-ui,Segoe UI,sans-serif'; }

  function drawSeries() {
    if (!result) return;
    const h = H(), a = +$('win').value, b = Math.min(h.y.length, a + winLen()), ms = shown(h);
    $('winlab').textContent = `forecasts ${(a + 1).toLocaleString('en')}–${b.toLocaleString('en')} of ${h.y.length.toLocaleString('en')}`;
    // deterministic view: all the ticked models on one plot, one colour and one marker each; the intervals are in the fan charts below
    const [g, W] = setup($('series'), 420);
    if (!ms.length) { g.fillStyle = MUTED; g.fillText('Tick at least one model above.', 20, 24); return; }
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i < b; i++) { lo = Math.min(lo, h.y[i]); hi = Math.max(hi, h.y[i]); for (const id of ms) { lo = Math.min(lo, h.models[id].pred[i]); hi = Math.max(hi, h.models[id].pred[i]); } }
    [lo, hi] = pad(lo, hi);
    const x0 = 64, pw = W - x0 - 14, y0 = 40, ph = 420 - y0 - 30, X = i => x0 + pw * (i - a) / Math.max(1, b - a - 1), Y = v => y0 + ph - ph * (v - lo) / (hi - lo);
    yAxis(g, x0, y0, pw, ph, lo, hi, 5);
    const T = job.cfg.T;
    if (T) for (let i = a; i < b; i++) if (h.t[i] % T === 0) { g.strokeStyle = '#d3dce5'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(X(i), y0); g.lineTo(X(i), y0 + ph); g.stroke(); g.setLineDash([]); }
    const every = Math.max(1, Math.ceil((b - a) / 80));
    path(g, a, b, X, i => Y(h.y[i]), INK, 2.2);
    for (let i = a; i < b; i += every) { g.fillStyle = INK; g.beginPath(); g.arc(X(i), Y(h.y[i]), 2.4, 0, 7); g.fill(); }
    ms.forEach(id => {
      const m = h.models[id], c = col(id), mk = MARK[job.models.indexOf(id)];
      path(g, a, b, X, i => Y(m.pred[i]), c, 1.6);
      for (let i = a; i < b; i += every) mark(g, mk, X(i), Y(m.pred[i]), c, 3.4);
    });
    // legend
    let lx = x0; g.font = '12.5px system-ui,Segoe UI,sans-serif'; g.textBaseline = 'middle';
    const item = (draw, txt) => { draw(lx + 11, 16); g.fillStyle = INK; g.fillText(txt, lx + 26, 16); lx += 36 + g.measureText(txt).width; };
    item((x, y) => { g.strokeStyle = INK; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x + 11, y); g.stroke(); g.fillStyle = INK; g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); g.lineWidth = 1; }, 'observed');
    ms.forEach(id => { const c = col(id), mk = MARK[job.models.indexOf(id)]; item((x, y) => { g.strokeStyle = c; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x - 11, y); g.lineTo(x + 11, y); g.stroke(); g.lineWidth = 1; mark(g, mk, x, y, c, 3.6); }, E.MODELS[id].name); });
    g.textBaseline = 'alphabetic'; g.font = '12px system-ui,Segoe UI,sans-serif';
  }
  const MARK = ['circle', 'square', 'triangle', 'diamond'];
  function mark(g, kind, x, y, c, r) { // open markers, white inside, so the lines and the observed points stay readable
    g.fillStyle = '#fff'; g.strokeStyle = c; g.lineWidth = 1.5; g.beginPath();
    if (kind === 'circle') g.arc(x, y, r, 0, 7);
    else if (kind === 'square') g.rect(x - r, y - r, 2 * r, 2 * r);
    else if (kind === 'triangle') { g.moveTo(x, y - 1.2 * r); g.lineTo(x + 1.1 * r, y + 0.8 * r); g.lineTo(x - 1.1 * r, y + 0.8 * r); g.closePath(); }
    else { g.moveTo(x, y - 1.3 * r); g.lineTo(x + 1.3 * r, y); g.lineTo(x, y + 1.3 * r); g.lineTo(x - 1.3 * r, y); g.closePath(); }
    g.fill(); g.stroke(); g.lineWidth = 1;
  }

  function drawDx() {
    if (!result) return;
    const sel = [...document.querySelectorAll('.dx:checked')].map(c => c.value), h = H(), ms = shown(h);
    $('dx').innerHTML = sel.map(k => `<figure class="${k === 'fan' ? 'wide' : ''}"><canvas id="dx-${k}"></canvas><figcaption>${CAP[k]}</figcaption></figure>`).join('');
    for (const k of sel) PLOT[k]($('dx-' + k), h, ms);
  }
  const CAP = {
    fan: '<b>Fan charts</b> over the window above, one per model ticked: centile bands 10–90, 20–80, 30–70 and 40–60 % of the forecast distribution; dashed line = median; dots = observations.',
    rel: '<b>Reliability.</b> Share of observations below each forecast centile, against the centile. On the diagonal: calibrated.',
    pit: '<b>PIT histogram</b>, 10 bins. Flat: calibrated. U shape: intervals too narrow. Hump: too wide. Dashed line: the flat level.',
    qq: '<b>Normal QQ plot</b> of the standardized validation residuals. On the diagonal: Gaussian residuals; heavy tails bend away at the ends.',
    sc: '<b>Forecast against observed</b>, every forecast. On the diagonal: perfect.',
    hist: '<b>Error histogram</b> (forecast − observation) on the series to forecast, 40 bins. Centred on 0 and narrow is best.',
  };
  const PLOT = {
    fan(cv, h, ms) {
      if (!cv) return;
      const panel = 220, [g, W] = setup(cv, Math.max(40, panel * ms.length + 6));
      if (!ms.length) { g.fillStyle = MUTED; g.fillText('Tick at least one model above.', 20, 24); return; }
      const a = +$('win').value, b = Math.min(h.y.length, a + winLen()), x0 = 64, pw = W - 78, X = i => x0 + pw * (i - a) / Math.max(1, b - a - 1);
      ms.forEach((id, k) => {
        const m = h.models[id], c = col(id), y0 = 6 + k * panel, ph = panel - 22;
        let lo = Infinity, hi = -Infinity, unbounded = false;
        for (let i = a; i < b; i++) for (const v of [h.y[i], m.pred[i], cen(m, i, 9), cen(m, i, 89)]) {
          if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); } else unbounded = true;
        }
        [lo, hi] = pad(lo, hi); const Y = v => y0 + ph - ph * (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo);
        yAxis(g, x0, y0, pw, ph, lo, hi, 3);
        for (const [p, q, al] of [[9, 89, .12], [19, 79, .14], [29, 69, .17], [39, 59, .22]]) area(g, a, b, X, i => Y(cen(m, i, q)), i => Y(cen(m, i, p)), rgba(c, al));
        path(g, a, b, X, i => Y(cen(m, i, 49)), c, 1.8, [5, 4]);
        dots(g, a, b, X, i => Y(h.y[i]), INK);
        title(g, x0 + 8, y0 + 15, E.MODELS[id].name, c);
        if (unbounded) title(g, x0 + 8, y0 + 32, 'Unbounded interval: clipped to the plot frame', MUTED);
      });
    },
    rel(cv, h, ms) { square(cv, 'forecast centile', 'observed share below', [0, 1], [0, 1], ms.map(id => [h.models[id].qq.calib, id]), true); },
    qq(cv, h, ms) { square(cv, 'normal quantile', 'residual quantile', [-2.6, 2.6], [-4, 4], ms.map(id => [h.models[id].qq.normal, id]), false); },
    sc(cv, h, ms) {
      const [g, W, Ht] = setup(cv, 300), x0 = 64, pw = W - 78, ph = Ht - 36;
      let lo = Infinity, hi = -Infinity; for (const v of h.y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      for (const id of ms) for (const v of h.models[id].pred) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      [lo, hi] = pad(lo, hi);
      const X = v => x0 + pw * (v - lo) / (hi - lo), Y = v => 8 + ph - ph * (v - lo) / (hi - lo);
      yAxis(g, x0, 8, pw, ph, lo, hi, 4); xAxis(g, x0, 8 + ph, pw, lo, hi, 4);
      const step = Math.max(1, Math.floor(h.y.length / 1500));
      ms.forEach(id => { g.fillStyle = rgba(col(id), .35); for (let i = 0; i < h.y.length; i += step) g.fillRect(X(h.y[i]) - 1.5, Y(h.models[id].pred[i]) - 1.5, 3, 3); });
      g.strokeStyle = INK; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(X(lo), Y(lo)); g.lineTo(X(hi), Y(hi)); g.stroke(); g.setLineDash([]);
      g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText('observed →', x0 + pw - 4, 8 + ph - 6); g.textAlign = 'left'; g.fillText('↑ forecast', x0 + 6, 22);
    },
    pit(cv, h, ms) {
      const [g, W, Ht] = setup(cv, 300), x0 = 52, pw = W - 66, ph = Ht - 36, top = Math.max(0.2, ...ms.flatMap(id => h.models[id].qq.pit)) * 1.08;
      yAxis(g, x0, 8, pw, ph, 0, top, 4); xAxis(g, x0, 8 + ph, pw, 0, 1, 5, v => v.toFixed(1));
      const gw = pw / 10, bw = (gw - 6) / Math.max(1, ms.length);
      ms.forEach((id, k) => h.models[id].qq.pit.forEach((v, i) => { g.fillStyle = rgba(col(id), .8); const hh = ph * v / top; g.fillRect(x0 + i * gw + 3 + k * bw, 8 + ph - hh, bw - 1, hh); }));
      const yf = 8 + ph - ph * 0.1 / top; g.strokeStyle = INK; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(x0, yf); g.lineTo(x0 + pw, yf); g.stroke(); g.setLineDash([]);
    },
    hist(cv, h, ms) {
      const [g, W, Ht] = setup(cv, 300), x0 = 52, pw = W - 66, ph = Ht - 36, nb = 40;
      const errs = ms.map(id => h.models[id].pred.map((p, i) => p - h.y[i])), all = errs.flat().sort((a, b) => a - b);
      const lo = all[Math.floor(0.005 * all.length)] || 0, hi = all[Math.floor(0.995 * all.length)] || 1, wdt = (hi - lo) / nb || 1;
      const H2 = errs.map(e => { const c = new Array(nb).fill(0); for (const v of e) { const k = Math.floor((v - lo) / wdt); if (k >= 0 && k < nb) c[k]++; } return c.map(x => x / e.length); });
      const top = Math.max(0.01, ...H2.flat()) * 1.08;
      yAxis(g, x0, 8, pw, ph, 0, top, 4); xAxis(g, x0, 8 + ph, pw, lo, hi, 4);
      ms.forEach((id, k) => { g.strokeStyle = col(id); g.lineWidth = 2; g.beginPath(); H2[k].forEach((v, i) => { const x = x0 + pw * (i + 0.5) / nb, y = 8 + ph - ph * v / top; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1; });
      const z = x0 + pw * (0 - lo) / (hi - lo); if (z > x0 && z < x0 + pw) { g.strokeStyle = INK; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(z, 8); g.lineTo(z, 8 + ph); g.stroke(); g.setLineDash([]); }
    },
  };
  function square(cv, xl, yl, xr, yr, sets, markers) {
    const [g, W, Ht] = setup(cv, 300), x0 = 52, pw = W - 66, ph = Ht - 36;
    const X = v => x0 + pw * (v - xr[0]) / (xr[1] - xr[0]), Y = v => 8 + ph - ph * (Math.max(yr[0], Math.min(yr[1], v)) - yr[0]) / (yr[1] - yr[0]);
    yAxis(g, x0, 8, pw, ph, yr[0], yr[1], 4); xAxis(g, x0, 8 + ph, pw, xr[0], xr[1], 4);
    g.strokeStyle = INK; g.setLineDash([5, 4]); const d0 = Math.max(xr[0], yr[0]), d1 = Math.min(xr[1], yr[1]); g.beginPath(); g.moveTo(X(d0), Y(d0)); g.lineTo(X(d1), Y(d1)); g.stroke(); g.setLineDash([]);
    for (const [pts, id] of sets) {
      g.strokeStyle = col(id); g.lineWidth = 2; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.stroke(); g.lineWidth = 1;
      if (markers) { g.fillStyle = col(id); pts.forEach(([x, y]) => { g.beginPath(); g.arc(X(x), Y(y), 2.6, 0, 7); g.fill(); }); }
    }
    g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText(xl + ' →', x0 + pw - 4, 8 + ph - 6); g.textAlign = 'left'; g.fillText('↑ ' + yl, x0 + 6, 22);
  }

  // ---------- copy and download ----------
  function matrix(sep) {
    const h = H(), ms = live(h);
    const head = ['step', 'observed'].concat(...ms.map(id => [`${id}_lower`, `${id}_forecast`, `${id}_upper`]));
    const lines = [head.join(sep)];
    for (let i = 0; i < h.y.length; i++) lines.push([h.t[i] + 1, h.y[i]].concat(...ms.map(id => [h.models[id].lo[i], h.models[id].pred[i], h.models[id].hi[i]].map(v => +v.toPrecision(7)))).join(sep));
    return lines.join('\n');
  }
  function metricsText() {
    const C = cols();
    return ['model\t' + C.map(c => c[1].replace(/<[^>]+>/g, '')).join('\t')].concat(rows().map(([n, s, k]) => n + '\t' + C.map(c => (k === null && c[3] === 'prob') ? '' : s[c[0]] === Infinity || s[c[0]] === -Infinity ? String(s[c[0]]) : !Number.isFinite(s[c[0]]) ? '' : +s[c[0]].toPrecision(6)).join('\t'))).join('\n');
  }
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); $('copied').textContent = `✓ ${what} copied: tab-separated, it pastes into a spreadsheet.`; }
    catch { $('copied').textContent = 'The browser refused the copy: use Download CSV.'; }
  }
  $('copyMet').addEventListener('click', () => copy(metricsText(), 'Metrics'));
  $('copyMat').addEventListener('click', () => copy(matrix('\t'), `Forecast matrix (horizon ${H().h})`));
  $('csv').addEventListener('click', () => {
    const blob = new Blob([matrix(',')], { type: 'text/csv' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `frugalcast_h${H().h}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($(b.dataset.copy).textContent); b.textContent = '✓ Copied'; } catch { b.textContent = 'Select and copy'; }
    setTimeout(() => (b.textContent = 'Copy BibTeX'), 1800);
  }));
  // ---------- citations: tick the papers, download one .bib ----------
  const PAPERS_OF = id => {
    if (/^elm/.test(id)) return ['Voyant2026Short', 'Despotovic2024Solar', 'PVELMpred'];
    if (id === 'par') return ['Voyant2018Periodic', 'Voyant2026Symmetry', 'Cyclo'];
    if (['blendcorr', 'blendls', 'holtwinters', 'theta', 'cyclic', 'cycleclim'].includes(id)) return ['Voyant2026Symmetry', 'Cyclo'];
    if (['persistence', 'climatology', 'cliper', 'es', 'artu'].includes(id)) return ['Voyant2022Benchmarks'];
    if (id === 'gap') return ['Voyant2018Solar', 'Voyant2025Importance'];
    if (id === 'complexar') return ['Voyant2022Complex'];
    if (id === 'ar' || id === 'arma') return ['Despotovic2024Solar', 'Voyant2012Numerical'];
    return [];
  };
  const pks = () => [...document.querySelectorAll('.pk')];
  const bibText = () => pks().filter(c => c.checked).map(c => (self.PRED_BIB || {})[c.value]).filter(Boolean).join('\n\n') + '\n';
  const pkCount = () => { $('pkN').textContent = pks().filter(c => c.checked).length; };
  document.addEventListener('change', e => { if (e.target.classList && e.target.classList.contains('pk')) pkCount(); });
  $('pkAll').addEventListener('click', () => { pks().forEach(c => (c.checked = true)); pkCount(); });
  $('pkNone').addEventListener('click', () => { pks().forEach(c => (c.checked = false)); pkCount(); });
  $('pkUsed').addEventListener('click', () => {
    const want = new Set(['FrugalCast', 'Voyant2025Nice'].concat(...sels.map(s => PAPERS_OF(s.value))));
    pks().forEach(c => (c.checked = want.has(c.value))); pkCount();
  });
  $('bibDl').addEventListener('click', () => {
    const blob = new Blob([bibText()], { type: 'application/x-bibtex' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'frugalcast-references.bib'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('bibCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(bibText()); $('bibCopy').textContent = '✓ Copied'; } catch { $('bibCopy').textContent = 'Copy refused'; }
    setTimeout(() => ($('bibCopy').textContent = 'Copy'), 1800);
  });
  pkCount();

  // ---------- jobs from outside (API.md): #job= link, .json file (opened or dropped). ?job=<url> and postMessage removed (Cyril, 13 Nov. 2026): automation goes through FrugalCast Local ----------
  // Everything is computed here, in the visitor's browser. The #fragment of a URL is never sent to the server.
  const SITE = 'https://frugalcast.cyrilvoyant.com/';   // provisional address, until Cyril chooses the subdomain
  const CITE = `Voyant, C. (2026). FrugalCast: a browser benchmark of frugal forecasting models with prediction intervals (Version 1.4.0) [Software]. Mines Paris – PSL. https://doi.org/10.5281/zenodo.24197717`;
  const API = (() => {
    let via = null, asked = false;
    const enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    const dec = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const pipe = async (u8, T) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new T('deflate-raw'))).arrayBuffer());
    async function pack(o) { const u = new TextEncoder().encode(JSON.stringify(o)); return self.CompressionStream ? 'z' + enc(await pipe(u, CompressionStream)) : 'j' + enc(u); }
    async function unpack(s) {
      s = decodeURIComponent(s.trim());
      if (s[0] === '{') return JSON.parse(s);
      if (s[0] === 'z') return JSON.parse(new TextDecoder().decode(await pipe(dec(s.slice(1)), DecompressionStream)));
      if (s[0] === 'j') return JSON.parse(new TextDecoder().decode(dec(s.slice(1))));
      throw new Error('the link is cut or damaged');
    }
    const near = (v, list) => list.reduce((b, x) => Math.abs(Math.log(x) - Math.log(v)) < Math.abs(Math.log(b) - Math.log(v)) ? x : b);
    const setRadio = (n, v) => { const r = document.querySelector(`input[name="${n}"][value="${v}"]`); if (!r) throw new Error(`"${n}" must be one of: ${[...document.querySelectorAll(`input[name="${n}"]`)].map(x => x.value).join(', ')}`); r.checked = true; };
    const arr = v => Array.isArray(v) ? v.join('\n') : String(v);
    function apply(j) {
      if (!j || typeof j !== 'object') throw new Error('the job is not a JSON object');
      if ((j.learn == null) !== (j.forecast == null)) throw new Error('give both "learn" and "forecast", or neither (settings only)');
      if (j.learn != null) { // settings files may hold no data: the series on the page are then kept
        maxLearn = 50000;
        $('learn').value = arr(j.learn); $('fore').value = arr(j.forecast); count('learn', 'nlearn'); count('fore', 'nfore');
        $('exlabel').textContent = j.label ? String(j.label).slice(0, 120) : 'Loaded from a settings file';
      }
      if (j.period !== undefined) $('T').value = j.period === null || j.period === 0 ? 'none' : String(j.period);
      syncPeriod();
      $('gap').checked = !!j.gap; $('sameHour').checked = j.gapSameHour !== false && !!j.gap; $('sameDay').checked = !!j.gapSameDay; syncSolar(); syncGap();
      if (j.weekly !== undefined) $('weekly').checked = !!j.weekly;
      if (j.annual) { const need = annualNeed(); if (!(need > 0 && learnN >= need)) throw new Error(need ? `"annual" needs one year of learning data: at least ${need.toLocaleString('en')} values` : '"annual" needs one period = one day (24, 48 or 96 steps, for instance)'); }
      if (j.annual !== undefined) $('annual').checked = !!j.annual;
      if (j.horizon !== undefined) { if (!(Number.isInteger(+j.horizon) && +j.horizon >= 1 && +j.horizon <= 100)) throw new Error('"horizon" must be a whole number from 1 to 100'); $('horizon').value = String(+j.horizon); }
      if (j.models) {
        const bad = j.models.filter(i => !E.MODELS[i]);
        if (bad.length) throw new Error(`unknown model id: ${bad.join(', ')} (ids are listed in API.md)`);
        if (j.models.length !== 4) throw new Error('"models" must hold exactly four ids');
        sels.forEach((s, k) => { s.value = j.models[k]; about(s); });
      }
      const s = j.search || {};
      [['inputs', 'optIn'], ['neurons', 'optNh'], ['ridge', 'optLam'], ['smooth', 'optSm']].forEach(([k, id]) => { if (s[k] !== undefined) $(id).checked = !!s[k]; });
      syncSearch();
      const f = j.fixed || {}, r = readT();
      if (f.inputs !== undefined && !r.error) { const lb = E.inputOptions(r.T); $('lbFix').value = lb.indexOf(near(+f.inputs, lb)); }
      if (f.neurons !== undefined) $('nhFix').value = near(+f.neurons, [10, 50, 100, 500]);
      if (f.ridge !== undefined) $('lamFix').value = '1e-6';
      if (f.activation !== undefined) { if (![...$('act').options].some(o => o.value === f.activation)) throw new Error('"fixed.activation" must be sigmoid, tanh, relu, sine or gaussian'); $('act').value = f.activation; }
      if (j.pca !== undefined) $('pca').checked = !!j.pca;
      const iv = j.interval || {};
      if (iv.kind) { if (!['conformal', 'gaussian'].includes(iv.kind)) throw new Error('"interval.kind" must be conformal or gaussian'); $('bandKind').value = iv.kind; }
      if (iv.mode !== undefined && !['symmetric', 'asymmetric'].includes(iv.mode)) throw new Error('"interval.mode" must be symmetric or asymmetric');
      if (iv.lower !== undefined || iv.upper !== undefined) {
        if (iv.mode === 'symmetric') throw new Error('Use interval.coverage for symmetric intervals, or choose interval.mode asymmetric for separate levels.');
        $('asym').checked = true; $('qlo').value = iv.lower ?? 10; $('qhi').value = iv.upper ?? 90;
      } else if (iv.coverage !== undefined) {
        const c = +iv.coverage;
        if (!(c >= 10 && c <= 99)) throw new Error('"interval.coverage" must lie between 10 and 99 %.');
        $('cov').value = c; $('qlo').value = (100 - c) / 2; $('qhi').value = (100 + c) / 2;
        $('asym').checked = iv.mode !== 'symmetric';
      } else if (iv.mode !== undefined) $('asym').checked = iv.mode === 'asymmetric';
      $('asymBox').classList.toggle('hidden', !$('asym').checked);
      syncLevels();
      if (iv.perPhase !== undefined) $('bandPhase').checked = !!iv.perPhase;
      if (j.prep) setRadio('prep', j.prep);
      if (j.prep === 'profile' && !(readT().T >= 2)) { setRadio('prep', 'none'); throw new Error('"prep": "profile" (remove the mean profile) needs a period of 2 steps or more'); }
      if (j.norm) setRadio('norm', j.norm);
      if (j.clip !== undefined) $('clip').checked = !!j.clip;
      if (j.solar !== undefined) setSolar(j.solar || null);
    }
    function current() {
      const r = readT(), lb = r.error ? null : E.inputOptions(r.T);
      return { format: 'frugalcast-job/1', label: $('exlabel').textContent || undefined,
        learn: E.parse(seriesText('learn'), 'x').values || [], forecast: E.parse(seriesText('fore'), 'x').values || [],
        period: r.T || 'none', gap: $('gap').checked || undefined, gapSameHour: $('gap').checked ? $('sameHour').checked : undefined, gapSameDay: $('gap').checked ? $('sameDay').checked : undefined, weekly: $('weekly').checked, annual: $('annual').checked, horizon: +$('horizon').value,
        models: sels.map(s => s.value),
        search: { inputs: $('optIn').checked, neurons: $('optNh').checked, ridge: $('optLam').checked, smooth: $('optSm').checked },
        fixed: { inputs: lb ? lb[+$('lbFix').value] : undefined, neurons: +$('nhFix').value, ridge: +$('lamFix').value, activation: $('act').value },
        pca: $('pca').checked,
        interval: Object.assign($('asym').checked ? { kind: $('bandKind').value, mode: 'asymmetric', lower: +$('qlo').value, upper: +$('qhi').value } : { kind: $('bandKind').value, mode: 'symmetric', coverage: +$('cov').value }, { perPhase: $('bandPhase').checked }),
        prep: radio('prep'), norm: radio('norm'), clip: $('clip').checked, solar: solarCfg() };
    }
    function results() {
      const h = H(), j = ran; // settings frozen at the click: changing a field afterwards does not alter the export
      return { format: 'frugalcast-results/1', tool: 'FrugalCast', url: SITE, cite: CITE, licence: 'Free for non-commercial use (PolyForm Noncommercial 1.0.0 / CC BY-NC 4.0). Please cite.',
        settings: j, horizon: h.h, step: h.t.map(t => t + 1), observed: h.y,
        models: Object.fromEntries(live(h).map(id => {
          const m = h.models[id];
          return [id, { name: E.MODELS[id].name, forecast: m.pred, lower: m.lo, upper: m.hi, interval: m.interval, score: m.score, scoreAll: m.scoreAll, chosen: m.chosen, lambda: m.lambda ?? m.chosen?.['ridge λ (GCV)'] ?? m.chosen?.ridge, validationRmse: m.cvRmse, validationScale: m.cvDen, validationFolds: m.cvFolds, tried: m.tried }];
        })),
        solar: result.solar || null, cvValidation: h.cvValidation, persistence: h.persistence,
        skipped: result.skipped };
    }
    // provenance (2026-11-25): what is needed to check and repeat the run; computed in the browser, nothing is sent
    const sha256 = async text => { try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { return null; } };
    async function provenance(h) {
      let engine = null;
      try { engine = await sha256((await (await fetch(document.querySelector('script[src^="engine.js"]').src, { cache: 'force-cache' })).text()).replace(/\r\n?/g, '\n')); } catch (e) { /* offline copy */ }
      const ids = live(h), idx = h.scored || h.y.map((_, i) => i), err = id => idx.map(i => h.y[i] - h.models[id].pred[i]), wil = [];
      const sidx = E.spacedTargets(idx, h.h), errS = id => sidx.map(i => h.y[i] - h.models[id].pred[i]);
      for (let i = 0; i < ids.length; i++) for (let k = i + 1; k < ids.length; k++) { const w = E.wilcoxon(errS(ids[i]), errS(ids[k])); wil.push({ a: ids[i], b: ids[k], n: w.n, ties: w.zeros, medianDiff: w.medianDiff, z: w.z, p: w.p, exact: !!w.exact, better: w.better === 'a' ? ids[i] : w.better === 'b' ? ids[k] : null }); }
      return {
        created_utc: new Date().toISOString(), engine: { version: (/Version ([\d.]+)/.exec(CITE) || [])[1] || null, sha256: engine, note: 'SHA-256 of engine.js with LF line ends, as the local kit computes it' },
        inputs: { learning: { n: job.train.length, sha256: await sha256(job.train.join('\n')) }, forecast: { n: job.test.length, sha256: await sha256(job.test.join('\n')) }, note: 'SHA-256 of the values, one per line, as JavaScript writes numbers' },
        scoredTargets: idx.length, wilcoxon: { test: 'Wilcoxon signed-rank, paired, two-sided, on absolute errors of one scored target every h steps (errors that do not overlap); normal approximation with tie and continuity corrections from 20 nonzero pairs, exact p-value below; successive errors can still be correlated', targets: sidx.length, step: h.h, pairs: wil },
        reproduce: 'Same series (same SHA-256), same settings and same engine SHA-256 give the same numbers (random draws seeded, seed 42).',
        bibtex: [...new Set(['FrugalCast', 'Voyant2025Nice'].concat(...job.models.map(PAPERS_OF)))].map(k => (self.PRED_BIB || {})[k]).filter(Boolean).join('\n\n'),
      };
    }
    async function take(j, how) {
      via = how;
      try { apply(j); } catch (e) { via = null; fail(`The job could not be read: ${e.message}.`, 'Job not loaded'); return; }
      // never computed on arrival: the reader checks the series and settings, then clicks Run
      $('status').textContent = `${j.learn != null ? 'Settings and data' : 'Settings'} loaded from ${how}. Check the series and the settings, then click Run.`;
      $('go').scrollIntoView({ behavior: 'smooth', block: 'center' }); try { $('go').focus({ preventScroll: true }); } catch (e) { /* old browser */ }
    }
    function citeBox() {
      if (asked) return; asked = true;
      const want = new Set(['FrugalCast', 'Voyant2025Nice'].concat(...job.models.map(PAPERS_OF)));
      const bib = [...want].map(k => (self.PRED_BIB || {})[k]).filter(Boolean).join('\n\n') + '\n';
      $('citeTxt').textContent = CITE;
      $('citeCopy').onclick = async () => { try { await navigator.clipboard.writeText(CITE); $('citeCopy').textContent = '✓ Copied'; } catch { $('citeCopy').textContent = 'Select and copy'; } };
      $('citeBib').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bib], { type: 'application/x-bibtex' })); a.download = 'frugalcast-references.bib'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
      $('citeN').textContent = want.size;
      try { $('citeDlg').showModal(); } catch (e) { $('citeDlg').setAttribute('open', ''); }
    }
    $('citeOk').addEventListener('click', () => $('citeDlg').close());

    // routes in
    async function fromHash() {
      const m = /[#&]job=([^&]+)/.exec(location.hash); if (!m) return;
      try { await take(await unpack(m[1]), 'a link'); } catch (e) { fail(`The job in the link could not be read: ${e.message}.`, 'Job not loaded'); }
    }
    fromHash();
    window.addEventListener('hashchange', fromHash);
    async function readFile(file) {
      try { await take(JSON.parse(await file.text()), file.name); } catch (e) { fail(`${file.name}: ${e.message}.`, 'Job not loaded'); }
    }
    $('jobFile').addEventListener('change', e => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
    $('jobLoad').addEventListener('click', () => $('jobFile').click());
    document.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) { e.preventDefault(); document.body.classList.add('dropping'); } });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
    document.addEventListener('drop', e => {
      document.body.classList.remove('dropping');
      const f = [...e.dataTransfer.files].find(x => /\.json$/i.test(x.name)); if (!f) return; e.preventDefault(); readFile(f);
    });

    // routes out
    // settings only by default; the series only when "Include my series" is ticked
    const outJob = () => { const j = current(); if (!$('jobData').checked) { delete j.learn; delete j.forecast; delete j.label; return j; } return j.learn.length ? j : null; };
    $('jobShare').addEventListener('click', async () => {
      const j = outJob(); if (!j) return fail('Paste or load the series first, or untick "Include my series".');
      const link = location.origin + location.pathname + '#job=' + await pack(j);
      try { await navigator.clipboard.writeText(link); $('status').textContent = `✓ Link copied (${link.length < 2000 ? link.length + ' characters' : (link.length / 1000).toFixed(0) + ' k characters'}). It holds the settings${j.learn ? ' and the series' : ' only (no data)'}; opening it fills the page, and the bench runs in the reader's browser when they click Run.`; }
      catch { $('status').textContent = 'The browser refused the copy.'; }
    });
    $('jobSave').addEventListener('click', () => {
      const j = outJob(); if (!j) return fail('Paste or load the series first, or untick "Include my series".');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' })); a.download = j.learn ? 'frugalcast-settings-and-data.json' : 'frugalcast-settings.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('resJson').addEventListener('click', async () => {
      const out = results(); out.provenance = await provenance(H());
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, (_, v) => v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v)], { type: 'application/json' })); a.download = `frugalcast_results_h${H().h}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    return {
      done() { if (!via) return; citeBox(); via = null; },
      error() { via = null; },
      snapshot() { const { learn, forecast, ...settings } = current(); return settings; },
      pack, unpack,
    };
  })();
  self.FrugalCast = { pack: API.pack, unpack: API.unpack };

  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => result && (drawSeries(), drawDx()), 150); });
  // video tour, hosted on YouTube: a local thumbnail (21 kB) stays hidden until an id is set; nothing is loaded from YouTube before the click
  const YT_ID = 'GGKfmyKVib8' || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('yt')) || '';
  if (YT_ID) {
    const fig = $('video'), play = () => {
      if (fig.querySelector('iframe')) return;
      $('vidBox').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${YT_ID}?autoplay=1&rel=0&cc_load_policy=1&hl=en" title="FrugalCast: a guided tour" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    };
    fig.hidden = false; fig.closest('.hero').classList.add('has-video');
    $('vidYT').href = `https://www.youtube.com/watch?v=${YT_ID}`;
    $('vidPlay').addEventListener('click', play);
    document.querySelectorAll('.vidOpen').forEach(a => { a.hidden = false; a.addEventListener('click', e => { e.preventDefault(); fig.scrollIntoView({ behavior: 'smooth', block: 'center' }); play(); }); });
  }
  syncPeriod(); syncSearch(); syncLevels();
})();
