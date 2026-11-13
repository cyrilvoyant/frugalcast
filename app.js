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
    par: 'One AR model per phase, fitted by least squares, order of each phase chosen by BIC, forecast by recursion (Voyant, De Gooijer and Notton, 2018). With "annual" ticked: on the series minus its typical year (TMY).',
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
  const count = (id, out) => { const r = E.parse($(id).value, 'x'); $(out).textContent = r.values && r.values.length ? `${r.values.length.toLocaleString('en')} values` : ''; };
  $('learn').addEventListener('input', () => { maxLearn = 10000; count('learn', 'nlearn'); });
  $('fore').addEventListener('input', () => count('fore', 'nfore'));
  function syncSearch() {
    const any = $('optIn').checked || $('optNh').checked || $('optLam').checked;
    $('slow').classList.toggle('hidden', !any);
    for (const [o, f] of [['optIn', 'lbFix'], ['optNh', 'nhFix'], ['optLam', 'lamFix']]) { $(f).disabled = $(o).checked; $(f).title = $(o).checked ? 'Searched: untick it in "Search" to fix it' : ''; }
  }
  ['optIn', 'optNh', 'optLam'].forEach(id => $(id).addEventListener('change', syncSearch));
  $('asym').addEventListener('change', () => { $('asymBox').classList.toggle('hidden', !$('asym').checked); syncLevels(); });
  $('cov').addEventListener('input', syncLevels);
  function syncLevels() { if ($('asym').checked) return; const c = +$('cov').value; $('qlo').value = (100 - c) / 2; $('qhi').value = 100 - (100 - c) / 2; }

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
    ['weeklyL', 'annualL'].forEach(id => $(id).classList.toggle('off', none || !!r.error));
    if (none) { $('weekly').checked = false; $('annual').checked = false; }
    const lb = r.error ? null : E.inputOptions(r.T);
    $('Thint').textContent = r.error ? 'Enter a whole number of steps, or none.' : none
      ? 'Non-periodic: no clock inputs; cyclic models are set aside. Inputs are 1, 2, 4 or 8 lags.'
      : `Clock inputs: sin/cos of the phase over ${r.T} steps. Inputs of 0.5 to 2 periods = ${lb.join(', ')} lags.`;
    $('lbUnit').textContent = none ? '(lags)' : '(periods)';
    if (lb) [...$('lbFix').options].forEach((o, i) => { o.textContent = none ? `${lb[i]} lag${lb[i] > 1 ? 's' : ''}` : `${['0.5', '1', '1.5', '2'][i]} period${i ? 's' : ''} = ${lb[i]} lags`; });
    $('optInL').textContent = none ? 'Inputs: 1, 2, 4, 8 lags' : 'Inputs: 0.5, 1, 1.5, 2 periods';
  }
  $('T').addEventListener('input', syncPeriod);
  $('Tquick').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $('T').value = b.dataset.v; syncPeriod(); });

  const EXAMPLES = { ghi: ['example-ghi.js', () => (self.PRED_EXAMPLES || {}).ghi, { scoreOn: 'day' }], edf: ['example.js', () => self.PRED_EXAMPLE, null] };
  const syncSolar = () => $('solarBox').classList.toggle('hidden', !$('solar').checked);
  $('solar').addEventListener('change', syncSolar);
  function setSolar(o) { $('solar').checked = !!o; if (o && o.scoreOn) $('solScore').value = o.scoreOn; if (o && o.cvOn) $('solCv').value = o.cvOn; syncSolar(); }
  function loadExample(then, key) {
    const [file, get, sol] = EXAMPLES[key || $('exsel').value] || EXAMPLES.ghi;
    const load = () => {
      const x = get();
      $('learn').value = x.learn.join('\n'); $('fore').value = x.forecast.join('\n'); $('T').value = x.T; syncPeriod();
      $('weekly').checked = x.weekly; setSolar(sol); $('exlabel').textContent = x.label; count('learn', 'nlearn'); count('fore', 'nfore'); then && then();
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
    return { scoreOn: $('solScore').value, cvOn: $('solCv').value };
  }
  function readJob() {
    $('err').classList.remove('on');
    const L = E.parse($('learn').value, 'Learning series', maxLearn); if (L.error) return fail(L.error);
    if (L.values.length > 10000) $('status').textContent = `Long learning series (${L.values.length.toLocaleString('en')} values): the search can take several minutes.`;
    const F = E.parse($('fore').value, 'Series to forecast', maxLearn); if (F.error) return fail(F.error);
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
    return {
      train: L.values, test: F.values, models,
      cfg: { T, weekly: $('weekly').checked, annual: $('annual').checked, horizons: [h], lbOpts, pca: $('pca').checked, pcaVar: 0.95,
        opt: { inputs: $('optIn').checked, neurons: $('optNh').checked, ridge: $('optLam').checked, smooth: $('optSm').checked },
        nhOpts: [10, 50, 100, 500], ncand: 30, ncandFixed: 1,
        lbFixed: lbOpts[+$('lbFix').value], nhFixed: +$('nhFix').value, lamFixed: +$('lamFix').value,
        act: $('act').value, qlo, qhi, bandKind: $('bandKind').value, bandPhase: $('bandPhase').checked, norm: radio('norm'), prep: radio('prep'), clip: $('clip').checked, solar: solarCfg(), seed: 42, folds: 5 },
    };
  }

  // ---------- run ----------
  $('go').addEventListener('click', () => {
    const nj = readJob(); if (!nj) { API.error($('err').textContent); return; }
    job = nj; result = null; ran = API.snapshot(); $('results').classList.add('hidden'); $('kpis').innerHTML = ''; $('err').classList.remove('on'); // nothing from the previous run stays on screen
    $('go').disabled = true; $('stop').disabled = false; $('barfill').style.width = '0';
    $('status').textContent = 'Starting…'; t0 = performance.now();
    try { worker = new Worker('worker.js'); } catch (e) { reset(); return fail('Open this page through a web server (not as a local file) so that the computation can run in the background.'); }
    worker.onmessage = e => {
      const m = e.data;
      if (m.type === 'progress') { $('barfill').style.width = (100 * m.f).toFixed(1) + '%'; $('status').textContent = `${Math.round(100 * m.f)} % · ${m.text}`; }
      else if (m.type === 'done') { reset(); $('barfill').style.width = '100%'; $('status').textContent = `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s.`; result = m.out; show(); API.done(); }
      else if (m.type === 'error') { reset(); $('status').textContent = 'Stopped on an error.'; fail(m.message); API.error(m.message); }
    };
    worker.onerror = e => { reset(); fail((e.message || 'unknown error') + '. Please report it with the settings used.', 'Computation error'); API.error(e.message || 'unknown error'); };
    worker.postMessage(job);
  });
  $('stop').addEventListener('click', () => { if (worker) worker.terminate(); reset(); $('status').textContent = 'Stopped.'; });
  function reset() { $('go').disabled = false; $('stop').disabled = true; worker = null; }

  // ---------- results ----------
  const fmt = (v, k) => !Number.isFinite(v) ? '–' : (k === 'picp' || k === 'ace') ? v.toFixed(3) : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
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
  const winLen = () => 3 * (job.cfg.T || 24);
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
    const lab = k => k === 'inputs' ? 'inputs (lags)' : k === 'candidate' ? 'random layer no.' : k;
    const rows = keys.filter(k => c[k] !== null && c[k] !== undefined).map(k => {
      const searched = (SEARCHED[k] && o[SEARCHED[k]]) || (k === 'candidate' && (o.inputs || o.neurons)) || (!SEARCHED[k] && k !== 'candidate' && k !== 'theta' && k !== 'orders p(h)' && o.smooth);
      return `<div class="row set"><span>${lab(k)}${searched ? ' <i class="cvk">CV</i>' : ''}</span><b>${typeof c[k] === 'number' ? +c[k].toPrecision(4) : c[k]}</b></div>`;
    }).join('');
    const T = (m.tried || []).slice().sort((a, b) => a.cvRmse - b.cvRmse), keysT = T.length ? Object.keys(T[0]).filter(k => k !== 'cv' && k !== 'cvRmse') : [];
    const canNormalize = Number.isFinite(m.cvDen) && m.cvDen > 0;
    const tried = T.length ? `<details class="tried"><summary>${T.length} configurations tested</summary><table><thead><tr>${keysT.map(k => `<th>${lab(k)}</th>`).join('')}<th>RMSE</th>${canNormalize ? '<th>nRMSE</th>' : ''}</tr></thead><tbody>${T.map((o, i) => `<tr${i ? '' : ' class="kept"'}>${keysT.map(k => `<td>${typeof o[k] === 'number' ? +o[k].toPrecision(4) : o[k]}</td>`).join('')}<td>${fmt(o.cvRmse)}</td>${canNormalize ? `<td>${Number.isFinite(o.cvRmse) ? (o.cvRmse / m.cvDen).toFixed(4) : '–'}</td>` : ''}</tr>`).join('')}</tbody></table></details>` : '';
    const folds = m.cvFolds?.length ? `<details class="tried"><summary>Validation by fold (${H().cvValidation?.used ?? m.cvFolds.length} used)</summary><table><thead><tr><th scope="col">Fold</th><th scope="col">Targets</th><th scope="col">RMSE</th><th scope="col">Bias</th></tr></thead><tbody>${m.cvFolds.map((f, i) => `<tr><th scope="row">${i + 1}</th><td>${fmt(f.n)}</td><td>${fmt(f.rmse)}</td><td>${fmt(f.bias)}</td></tr>`).join('')}</tbody></table><small>Bias = forecast − observation.${canNormalize ? ` Validation scale ${fmt(m.cvDen)}.` : ''}</small></details>` : '';
    return `<div class="sets"><div class="row"><span>Settings kept</span><small>validation RMSE ${fmt(m.cvRmse)}</small></div>${rows || '<div class="row set"><span>none (no setting)</span></div>'}${folds}${tried}</div>`;
  }
  function kpis() {
    const h = H(), ms = live(h), bn = best('nrmse', ms.map(id => h.models[id].score.nrmse));
    const sc0 = h.persistence.n, positiveOnly = result.solar?.scoreOn === 'day';
    $('rsub').textContent = `Horizon ${h.h} · ${sc0.toLocaleString('en')} of ${h.y.length.toLocaleString('en')} forecasts scored` + (positiveOnly ? ' · observed targets > 0' : '') + (result.solar ? ' · night (observed 0) written as 0: not causal' : '');
    const warnings = new Set(live(h).flatMap(id => Object.values(h.models[id].score.notes || {})).filter(x => typeof x === 'string'));
    if (h.cvValidation?.warning) warnings.add(h.cvValidation.warning);
    if (h.cvValidation?.normalizationNote) warnings.add(`Validation: ${h.cvValidation.normalizationNote}`);
    if (!sc0 && positiveOnly) warnings.add('No positive observations remain at this horizon. Scores on positive targets are unavailable.');
    $('scoreNotes').textContent = [...warnings].join(' ');
    $('scoreNotes').hidden = !warnings.size;
    $('kpis').innerHTML = job.models.map((id, k) => {
      const m = h.models[id], name = E.MODELS[id].name;
      if (!m) return `<div class="kpi gone" style="--c:${COLORS[k]}"><div class="nm">${name}</div><div class="row">set aside on this series</div></div>`;
      const s = m.score;
      return `<div class="kpi" style="--c:${COLORS[k]}">${s.nrmse === bn ? '<span class="crown">best nRMSE</span>' : ''}<div class="nm">${name}</div>
        <div class="big">${fmt(s.nrmse, 'nrmse')}<small>nRMSE</small></div>
        <div class="row"><span>R²</span><b>${fmt(s.r2)}</b></div>
        <div class="row"><span>NICE² <small>(vs persistence)</small></span><b>${fmt(s.nice2)}</b></div>
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
        return `<td${k !== null && s[c[0]] === b[c[0]] ? ' class="best"' : ''}>${fmt(s[c[0]], c[0])}</td>`;
      }).join('') + '</tr>').join('') + '</tbody>';
    const h = H();
    $('chosen').innerHTML = `${job.cfg.norm === 'none' ? 'Errors shown in the units of the series.' : 'Normalized errors are fractions. See the notes for any change to the requested scale.'} ${job.cfg.prep === 'center' ? 'Series centred before modelling. ' : job.cfg.prep === 'standard' ? 'Series centred and scaled before modelling. ' : ''}${Math.round(100 * target)} % ${job.cfg.bandKind === 'gaussian' ? 'Gaussian' : 'empirical'} intervals. Best value in bold. Hover a column name for its definition.<br><b>Settings kept</b> — ` +
      live(h).map(id => { const c = h.models[id].chosen; const p = Object.entries(c).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k} ${typeof v === 'number' ? +v.toPrecision(4) : v}`).join(', '); return `${E.MODELS[id].name}${p ? ': ' + p : ': no setting'}`; }).join(' · ');
  }

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
  const cen = (m, i, k) => { const v = m.pred[i] + (m.cph ? m.cent[m.cph[i]] : m.cent)[k] * (m.sc ? m.sc[i] : 1); return m.low0 && v < 0 ? 0 : v; };
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
        let lo = Infinity, hi = -Infinity; for (let i = a; i < b; i++) { lo = Math.min(lo, h.y[i], cen(m, i, 9)); hi = Math.max(hi, h.y[i], cen(m, i, 89)); }
        [lo, hi] = pad(lo, hi); const Y = v => y0 + ph - ph * (v - lo) / (hi - lo);
        yAxis(g, x0, y0, pw, ph, lo, hi, 3);
        for (const [p, q, al] of [[9, 89, .12], [19, 79, .14], [29, 69, .17], [39, 59, .22]]) area(g, a, b, X, i => Y(cen(m, i, q)), i => Y(cen(m, i, p)), rgba(c, al));
        path(g, a, b, X, i => Y(cen(m, i, 49)), c, 1.8, [5, 4]);
        dots(g, a, b, X, i => Y(h.y[i]), INK);
        title(g, x0 + 8, y0 + 15, E.MODELS[id].name, c);
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
    return ['model\t' + C.map(c => c[1].replace(/<[^>]+>/g, '')).join('\t')].concat(rows().map(([n, s, k]) => n + '\t' + C.map(c => (k === null && c[3] === 'prob') || !Number.isFinite(s[c[0]]) ? '' : +s[c[0]].toPrecision(6)).join('\t'))).join('\n');
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
  const CITE = `Voyant, C. (2026). FrugalCast: a browser benchmark of frugal forecasting models with prediction intervals (Version 1.0.0) [Software]. Mines Paris – PSL. https://doi.org/10.5281/zenodo.24197717`;
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
      if (j.weekly !== undefined) $('weekly').checked = !!j.weekly;
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
      if (iv.lower !== undefined || iv.upper !== undefined) { $('asym').checked = true; $('qlo').value = iv.lower ?? 10; $('qhi').value = iv.upper ?? 90; }
      else if (iv.coverage !== undefined) { $('asym').checked = false; $('cov').value = iv.coverage; syncLevels(); }
      $('asymBox').classList.toggle('hidden', !$('asym').checked);
      if (iv.perPhase !== undefined) $('bandPhase').checked = !!iv.perPhase;
      if (j.prep) setRadio('prep', j.prep);
      if (j.norm) setRadio('norm', j.norm);
      if (j.clip !== undefined) $('clip').checked = !!j.clip;
      if (j.solar !== undefined) setSolar(j.solar || null);
    }
    function current() {
      const r = readT(), lb = r.error ? null : E.inputOptions(r.T);
      return { format: 'frugalcast-job/1', label: $('exlabel').textContent || undefined,
        learn: E.parse($('learn').value, 'x').values || [], forecast: E.parse($('fore').value, 'x').values || [],
        period: r.T || 'none', weekly: $('weekly').checked, annual: $('annual').checked, horizon: +$('horizon').value,
        models: sels.map(s => s.value),
        search: { inputs: $('optIn').checked, neurons: $('optNh').checked, ridge: $('optLam').checked, smooth: $('optSm').checked },
        fixed: { inputs: lb ? lb[+$('lbFix').value] : undefined, neurons: +$('nhFix').value, ridge: +$('lamFix').value, activation: $('act').value },
        pca: $('pca').checked,
        interval: Object.assign($('asym').checked ? { kind: $('bandKind').value, lower: +$('qlo').value, upper: +$('qhi').value } : { kind: $('bandKind').value, coverage: +$('cov').value }, { perPhase: $('bandPhase').checked }),
        prep: radio('prep'), norm: radio('norm'), clip: $('clip').checked, solar: solarCfg() };
    }
    function results() {
      const h = H(), j = ran; // settings frozen at the click: changing a field afterwards does not alter the export
      return { format: 'frugalcast-results/1', tool: 'FrugalCast', url: SITE, cite: CITE, licence: 'Free for non-commercial use (PolyForm Noncommercial 1.0.0 / CC BY-NC 4.0). Please cite.',
        settings: j, horizon: h.h, step: h.t.map(t => t + 1), observed: h.y,
        models: Object.fromEntries(live(h).map(id => {
          const m = h.models[id];
          return [id, { name: E.MODELS[id].name, forecast: m.pred, lower: m.lo, upper: m.hi, score: m.score, scoreAll: m.scoreAll, chosen: m.chosen, lambda: m.lambda ?? m.chosen?.['ridge λ (GCV)'] ?? m.chosen?.ridge, validationRmse: m.cvRmse, validationScale: m.cvDen, validationFolds: m.cvFolds, tried: m.tried }];
        })),
        solar: result.solar || null, cvValidation: h.cvValidation, persistence: h.persistence,
        skipped: result.skipped };
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
    // settings only by default; the series only when "with the data" is ticked
    const outJob = () => { const j = current(); if (!$('jobData').checked) { delete j.learn; delete j.forecast; delete j.label; return j; } return j.learn.length ? j : null; };
    $('jobShare').addEventListener('click', async () => {
      const j = outJob(); if (!j) return fail('Paste or load the series first, or untick "with the data".');
      const link = location.origin + location.pathname + '#job=' + await pack(j);
      try { await navigator.clipboard.writeText(link); $('status').textContent = `✓ Link copied (${link.length < 2000 ? link.length + ' characters' : (link.length / 1000).toFixed(0) + ' k characters'}). It holds the settings${j.learn ? ' and the series' : ' only (no data)'}; opening it fills the page, and the bench runs in the reader's browser when they click Run.`; }
      catch { $('status').textContent = 'The browser refused the copy.'; }
    });
    $('jobSave').addEventListener('click', () => {
      const j = outJob(); if (!j) return fail('Paste or load the series first, or untick "with the data".');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' })); a.download = j.learn ? 'frugalcast-settings-and-data.json' : 'frugalcast-settings.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    $('resJson').addEventListener('click', () => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(results())], { type: 'application/json' })); a.download = `frugalcast_results_h${H().h}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  syncPeriod(); syncSearch();
})();
