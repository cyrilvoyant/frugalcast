/* pred-lab engine (Nov 2026). Frugal forecasting models of Cyril Voyant's repositories, without clear sky.
   Pure functions, no DOM: runs in a Web Worker (worker.js) and in Node (checks against the Python reference).
   Conventions follow PV_ELM_pred (utils.py, elm_common.py, blend_*.py, dr_ar_ols.py, dr_elm_ridge.py):
   - the forecast series follows the learning series in time; index j of the joined series S has phase j mod T;
   - a sample is an issue time t: inputs S[t-LB+1..t], target S[t+h];
   - lag inputs standardized with the mean and sd (ddof = 1) of the learning rows; cyclic sin/cos of the target index;
   - hyperparameters chosen by expanding-window temporal CV (k = 5, 4 folds) on the learning series only;
   - ELM: H = g(X IW' + bias), IW ~ U(-1, 1), bias ~ U(0, 1), target centred and scaled on the fit part,
     beta = (H'H + lam I)^-1 H'z; random generator mulberry32 so that the Python reference gives the same draws.
   Intervals (all models): split-conformal on the out-of-fold residuals of the 4 CV folds, per horizon. */
(function (root) {
  'use strict';
  const E = {};

  // ---------- random numbers (same as the Python reference) ----------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0; let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  E.mulberry32 = mulberry32;

  // ---------- parsing ----------
  /* Accepts values separated by new lines, spaces, tabs or semicolons; a decimal comma (12,5) is read as 12.5.
     Commas are separators only when a token holds several of them or mixes them with a dot (1.2,3.4).
     Returns {values} or {error} with the exact place of the first problem. */
  E.parse = function (text, label, maxN) {
    const values = [];
    if (!text || !text.trim()) return { error: label + ': nothing pasted.' };
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li].trim();
      if (!raw) continue;
      for (let tok of raw.split(/[;\s]+/)) {
        if (!tok) continue;
        let parts = [tok];
        const nc = (tok.match(/,/g) || []).length;
        if (nc > 1 || (nc === 1 && tok.includes('.'))) parts = tok.split(',').filter(Boolean);
        for (let p of parts) {
          const q = p.replace(',', '.');
          if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(q)) {
            const what = /^(nan|na|n\/a|null|none|-|\?)$/i.test(p) ? 'a missing value' : 'not a number';
            return { error: `${label}: line ${li + 1}, value "${p}" is ${what}. Remove it or replace it with a number (missing values are not filled in automatically).` };
          }
          values.push(parseFloat(q));
          if (maxN && values.length > maxN) return { error: `${label}: more than ${maxN.toLocaleString('en')} values. Keep ${/forecast/i.test(label) ? 'the first' : 'the last'} ${maxN.toLocaleString('en')}${maxN < 50000 ? ', or send the series as a job file or link (up to 50,000 values)' : ''}, or use FrugalCast Local (no fixed limit).` };
        }
      }
    }
    return { values };
  };

  // ---------- small linear algebra ----------
  function cholSolve(A, n, b, ld) { // A: n x n block (row stride ld), symmetric positive definite; returns x or null
    const L = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = A[i * ld + j];
        for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
        if (i === j) { if (!(s > 0)) return null; L[i * n + i] = Math.sqrt(s); }
        else L[i * n + j] = s / L[j * n + j];
      }
    }
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
    return x;
  }
  function luSolve(A0, n, b0, ld) { // Gaussian elimination with partial pivoting, fallback
    const A = new Float64Array(n * n), b = Float64Array.from(b0.subarray ? b0.subarray(0, n) : b0.slice(0, n));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = A0[i * ld + j];
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[p * n + c])) p = r;
      if (Math.abs(A[p * n + c]) < 1e-300) return null;
      if (p !== c) { for (let k = 0; k < n; k++) { const t = A[c * n + k]; A[c * n + k] = A[p * n + k]; A[p * n + k] = t; } const t = b[c]; b[c] = b[p]; b[p] = t; }
      for (let r = c + 1; r < n; r++) { const f = A[r * n + c] / A[c * n + c]; if (!f) continue; for (let k = c; k < n; k++) A[r * n + k] -= f * A[c * n + k]; b[r] -= f * b[c]; }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let k = i + 1; k < n; k++) s -= A[i * n + k] * x[k]; x[i] = s / A[i * n + i]; }
    return x;
  }
  function solveSym(A, n, b, ld) { return cholSolve(A, n, b, ld) || luSolve(A, n, b, ld); }
  function applyHouseholder(A, m, k, tau, vector, offset) {
    const col = k * m;
    let dot = vector[offset + k];
    for (let i = k + 1; i < m; i++) dot += A[col + i] * vector[offset + i];
    dot *= tau;
    vector[offset + k] -= dot;
    for (let i = k + 1; i < m; i++) vector[offset + i] -= A[col + i] * dot;
  }

  function qrReduce(A, m, n, rhs) {
    const reflectors = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const col = k * m, first = A[col + k];
      let norm2 = 0;
      for (let i = k; i < m; i++) norm2 += A[col + i] ** 2;
      const norm = Math.sqrt(norm2);
      if (!norm) continue;
      const diagonal = first >= 0 ? -norm : norm;
      const lead = first - diagonal, tau = (diagonal - first) / diagonal;
      reflectors[k] = tau;
      A[col + k] = diagonal;
      for (let i = k + 1; i < m; i++) A[col + i] /= lead;
      for (let j = k + 1; j < n; j++) applyHouseholder(A, m, k, tau, A, j * m);
      if (rhs) applyHouseholder(A, m, k, tau, rhs, 0);
    }
    return reflectors;
  }

  /* Unregularized minimum-norm least squares: Householder QR reduces the
     rectangular design before a one-sided Jacobi SVD of the small R factor.
     The singular-value cutoff is the NumPy lstsq default, eps*max(m,n)*sigma_max.
     Weighting is applied to the design and response, never via normal equations. */
  function leastSquares(m, n, value, y, weights = null) {
    const size = Math.min(m, n), tall = m >= n, leading = Math.max(m, n);
    const empty = () => Object.assign(new Float64Array(n), { rank: 0 });
    if (!size) return empty();
    const A = new Float64Array(m * n), rhs = new Float64Array(m);
    let magnitude = 0;
    for (let i = 0; i < m; i++) {
      const weight = weights ? Math.sqrt(weights[i]) : 1;
      rhs[i] = y[i] * weight;
      for (let j = 0; j < n; j++) {
        const a = value(i, j) * weight;
        A[tall ? j * m + i : i * n + j] = a;
        magnitude = Math.max(magnitude, Math.abs(a));
      }
    }
    if (!magnitude) return empty();
    for (let i = 0; i < A.length; i++) A[i] /= magnitude;
    for (let i = 0; i < m; i++) rhs[i] /= magnitude;
    // If wide, factor A^T = Q R and solve R^T z = y, then recover beta = Q [z; 0].
    const reflectors = qrReduce(A, leading, size, tall ? rhs : null);
    const R = new Float64Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i <= j; i++) {
      R[tall ? j * size + i : i * size + j] = A[j * leading + i];
    }
    const fit = jacobiMinimum(R, rhs, size, Number.EPSILON * leading);
    if (tall) return fit;
    const beta = empty();
    beta.set(fit);
    beta.rank = fit.rank;
    for (let k = size - 1; k >= 0; k--) {
      if (reflectors[k]) applyHouseholder(A, leading, k, reflectors[k], beta, 0);
    }
    return beta;
  }

  function jacobiMinimum(R, rhs, n, rcond) {
    const V = new Float64Array(n * n);
    let largestColumn = 0;
    for (let j = 0; j < n; j++) {
      V[j * n + j] = 1;
      let norm2 = 0;
      for (let i = 0; i < n; i++) norm2 += R[j * n + i] ** 2;
      largestColumn = Math.max(largestColumn, Math.sqrt(norm2));
    }
    const negligible = (rcond * largestColumn) ** 2;
    let converged = false;
    for (let sweep = 0; sweep < 60; sweep++) {
      let rotations = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        const i = p * n, j = q * n;
        let aa = 0, bb = 0, ab = 0;
        for (let k = 0; k < n; k++) {
          const a = R[i + k], b = R[j + k];
          aa += a * a;
          bb += b * b;
          ab += a * b;
        }
        if (Math.min(aa, bb) <= negligible || Math.abs(ab) <= 4 * Number.EPSILON * Math.sqrt(aa * bb)) continue;
        const tau = (bb - aa) / (2 * ab);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.hypot(1, tau));
        const c = 1 / Math.hypot(1, t), s = c * t;
        for (let k = 0; k < n; k++) {
          const a = R[i + k], b = R[j + k];
          R[i + k] = c * a - s * b;
          R[j + k] = s * a + c * b;
        }
        const vp = p * n, vq = q * n;
        for (let k = 0; k < n; k++) {
          const a = V[vp + k], b = V[vq + k];
          V[vp + k] = c * a - s * b;
          V[vq + k] = s * a + c * b;
        }
        rotations++;
      }
      if (!rotations) { converged = true; break; }
    }
    if (!converged) throw new Error('The least-squares SVD did not converge.');
    const norms = new Float64Array(n);
    let maxNorm = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) norms[j] += R[j * n + i] ** 2;
      maxNorm = Math.max(maxNorm, norms[j]);
    }
    const threshold = rcond * rcond * maxNorm, beta = new Float64Array(n);
    let rank = 0;
    for (let j = 0; j < n; j++) {
      if (norms[j] <= threshold) continue;
      rank++;
      let dot = 0;
      for (let i = 0; i < n; i++) dot += R[j * n + i] * rhs[i];
      const factor = dot / norms[j];
      for (let i = 0; i < n; i++) beta[i] += V[j * n + i] * factor;
    }
    beta.rank = rank;
    return beta;
  }

  function lstsq(rows, y, d) {
    return leastSquares(rows.length, d, (i, j) => rows[i][j], y);
  }
  E.lstsq = lstsq;

  // ---------- statistics ----------
  const mean = a => { let s = 0; for (const v of a) s += v; return s / a.length; };
  const sd1 = a => { const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / (a.length - 1)); };
  function quantile(sorted, p) { // linear interpolation (numpy default)
    const n = sorted.length; if (!n) return NaN;
    const x = p * (n - 1), i = Math.floor(x), f = x - i;
    return i + 1 < n ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[n - 1];
  }
  E.quantile = quantile;

  // ---------- activations ----------
  const ACT = {
    sigmoid: x => 1 / (1 + Math.exp(-x)),
    tanh: x => Math.tanh(x),
    relu: x => (x > 0 ? x : 0),
    sine: x => Math.sin(x),
    gaussian: x => Math.exp(-x * x),
  };
  E.ACTIVATIONS = Object.keys(ACT);

  // ---------- context: joined series, samples, features ----------
  /* cfg: {T, weekly, annual, horizons:[...], lbOpts:[...], nhOpts:[...], lamOpts:[...], ncand, act, qlo, qhi, norm, seed, folds} */
  E.context = function (train, test, cfg) {
    const S = Float64Array.from(train.concat(test)), Ntr = train.length, N = S.length;
    const nonneg = train.every(v => v >= 0);
    return { S, Ntr, N, cfg, nonneg, T: cfg.T };
  };
  E.inputOptions = function (T) { // 0.5, 1, 1.5, 2 periods
    if (T < 8) return [1, 2, 4, 8];
    return [0.5, 1, 1.5, 2].map(k => Math.max(1, Math.round(k * T)));
  };
  /* issue times: learning samples (target inside the learning series) and forecast samples (target in the forecast series).
     t0 leaves room for the longest input window and for one cycle, so that every model is scored on the same samples. */
  E.samples = function (ctx, h) {
    const T = ctx.T, lbMax = Math.max(...E.inputOptions(T));
    // also room for ARTU (t - h) and for the longest exponential smoothing window (48 values)
    const t0 = Math.max(lbMax - 1, T * Math.ceil(h / Math.max(T, 1)) - h, h, 47, 0);
    const tr = [], te = [];
    for (let t = t0; t + h <= ctx.Ntr - 1; t++) tr.push(t);
    // The last learning observation is available at the first scored issue time.
    for (let t = Math.max(ctx.Ntr - 1, t0); t + h < ctx.N; t++) te.push(t);
    return { tr, te };
  };
  E.folds = function (n, k) { // expanding window, as temporal_cv_splits of elm_common.py
    k = k || 5; const b = []; for (let j = 0; j <= k; j++) b.push(Math.round(n * j / k));
    const out = []; for (let i = 1; i < k; i++) if (b[i + 1] > b[i] && b[i] > 0) out.push([b[i], b[i + 1]]);
    return out;
  };
  E.purgedFolds = function (issues, h, k) {
    return E.folds(issues.length, k).flatMap(([a, b]) => {
      let fitEnd = a;
      // An adjustment label must precede the first validation issue strictly.
      while (fitEnd && issues[fitEnd - 1] + h >= issues[a]) fitEnd--;
      return fitEnd > 1 ? [{ a, b, fitEnd }] : [];
    });
  };

  function preparedContext(raw, ntrain, cfg) {
    const train = raw.subarray(0, ntrain);
    const center = cfg.prep && cfg.prep !== 'none' ? mean(train) : 0;
    const scale = cfg.prep === 'standard' ? (sd1(train) || 1) : 1;
    const S = center !== 0 || scale !== 1 ? raw.map(v => (v - center) / scale) : raw;
    const nonneg = S.subarray(0, ntrain).every(v => v >= 0);
    const origNonneg = train.every(v => v >= 0);
    const clip = cfg.clip !== false && origNonneg ? (v => Math.max(0, v)) : (v => v);
    return { S, Ntr: ntrain, N: raw.length, cfg, T: cfg.T, center, scale, nonneg, origNonneg, clip,
      toOriginal: v => clip(v * scale + center) };
  }
  function timeFeat(ctx, j) {
    const T = ctx.T, c = ctx.cfg, f = [];
    if (T >= 2) { const a = 2 * Math.PI * (j % T) / T; f.push(Math.sin(a), Math.cos(a)); }
    if (T < 2) return f; // non-periodic series: no time features
    if (c.weekly) { const a = 2 * Math.PI * (j % (7 * T)) / (7 * T); f.push(Math.sin(a), Math.cos(a)); }
    if (c.annual) { const d = Math.floor(j / T) % 365.25, a = 2 * Math.PI * d / 365.25; f.push(Math.sin(a), Math.cos(a)); }
    return f;
  }
  /* design rows for issue times `ts`: standardized lags (stats of the learning rows `trTs`) + time features of the target */
  function rowMaker(ctx, trTs, LB, h, withTime) {
    const S = ctx.S, mu = new Float64Array(LB), sd = new Float64Array(LB);
    for (let k = 0; k < LB; k++) {
      let s = 0; for (const t of trTs) s += S[t - LB + 1 + k]; mu[k] = s / trTs.length;
      let v = 0; for (const t of trTs) { const d = S[t - LB + 1 + k] - mu[k]; v += d * d; }
      sd[k] = Math.sqrt(v / (trTs.length - 1)) || 1;
    }
    const lags = t => { const r = []; for (let k = 0; k < LB; k++) r.push((S[t - LB + 1 + k] - mu[k]) / sd[k]); return r; };
    // optional PCA of the standardized lags (fitted on the rows trTs only), keeping cfg.pcaVar of the variance
    let P = null, K = LB;
    if (ctx.cfg.pca && LB > 1) {
      const C = new Float64Array(LB * LB);
      for (const t of trTs) { const r = lags(t); for (let i = 0; i < LB; i++) for (let j = 0; j <= i; j++) C[i * LB + j] += r[i] * r[j]; }
      for (let i = 0; i < LB; i++) for (let j = 0; j <= i; j++) { C[i * LB + j] /= (trTs.length - 1); C[j * LB + i] = C[i * LB + j]; }
      const { vals, vecs } = eigSym(C, LB), tot = vals.reduce((a, b) => a + Math.max(b, 0), 0);
      let cum = 0; K = 0; while (K < LB && cum < (ctx.cfg.pcaVar || 0.95) * tot) cum += Math.max(vals[K++], 0);
      P = vecs.slice(0, Math.max(1, K)); K = P.length;
    }
    const f = t => {
      let r = lags(t);
      if (P) r = P.map(v => { let s = 0; for (let i = 0; i < LB; i++) s += v[i] * r[i]; return s; });
      return withTime ? r.concat(timeFeat(ctx, t + h)) : r;
    };
    f.k = K;
    f.state = { mu, sd, P, k: K };
    return f;
  }
  /* symmetric eigen-decomposition (cyclic Jacobi); eigenvectors sorted by decreasing eigenvalue */
  function eigSym(A0, n) {
    const A = Float64Array.from(A0), V = new Float64Array(n * n);
    for (let i = 0; i < n; i++) V[i * n + i] = 1;
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] ** 2;
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
        const th = (A[q * n + q] - A[p * n + p]) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
      }
    }
    const idx = [...Array(n).keys()].sort((a, b) => A[b * n + b] - A[a * n + a]);
    return { vals: idx.map(i => A[i * n + i]), vecs: idx.map(i => { const v = []; for (let k = 0; k < n; k++) v.push(V[k * n + i]); return v; }) };
  }
  E.eigSym = eigSym;
  function acf(x, k) { // numpy-style autocorrelation at lag k, as in the ARTU code
    const m = mean(x); let num = 0, den = 0;
    for (let i = 0; i < x.length; i++) { const d = x[i] - m; den += d * d; if (i + k < x.length) num += d * (x[i + k] - m); }
    return den > 0 ? num / den : 0;
  }
  const fitSeries = (ctx, ts, h) => Array.from(ctx.S.subarray(0, ts[ts.length - 1] + h + 1)); // values known when fitting
  function designRows(f, ts, LB, padPca) {
    if (!padPca || f.k === LB) return ts.map(f);
    // Keep one random input layer across folds whose PCA retain different numbers of components.
    const zeros = new Array(LB - f.k).fill(0);
    return ts.map(t => { const row = f(t); return row.slice(0, f.k).concat(zeros, row.slice(f.k)); });
  }
  function design(ctx, ts, trTs, LB, h, withTime, padPca = false) {
    return designRows(rowMaker(ctx, trTs, LB, h, withTime), ts, LB, padPca);
  }

  // ---------- the cycle (no clear sky): helpers ----------
  const cyc = (ctx, t, h) => t + h - ctx.T * Math.ceil(h / ctx.T); // same phase, last cycle known at issue time
  function profile(ctx, upto) { // mean value per phase over S[0..upto]
    const T = ctx.T, s = new Float64Array(T), n = new Float64Array(T);
    for (let j = 0; j <= upto; j++) { s[j % T] += ctx.S[j]; n[j % T]++; }
    for (let p = 0; p < T; p++) s[p] = n[p] ? s[p] / n[p] : 0;
    return s;
  }

  /* ---------- models ----------
     Each model: fit(ctx, h, fitTs, p) -> predictor(t) ; fitTs = learning issue times usable for fitting (targets known).
     `grid(ctx)` lists the hyperparameter combinations searched by CV (one entry = fixed). */
  const REF = 'https://www.cyrilvoyant.com';
  const M = {};
  const fitted = (predict, state) => Object.assign(predict, { state });
  M.persistence = {
    name: 'Persistence', family: 'Persistence', ref: [REF + '/latest-publications-and-news/nice-forecast-evaluation/', 'NICE: errors relative to persistence'],
    fit: ctx => fitted(t => ctx.S[t], {}),
  };
  M.cyclic = {
    name: 'Cyclic persistence', family: 'Persistence', needsCycle: true, ref: [REF + '/tools/forecast-comparison/', 'Compare forecasts'],
    fit: (ctx, h) => fitted(t => ctx.S[cyc(ctx, t, h)], {}),
  };
  M.climatology = {
    name: 'Climatology', family: 'Persistence', ref: [REF + '/stories/solar-forecast-baseline-deep-learning/', 'Which baseline must a model beat?'],
    fit: (ctx, h, ts) => { const m = mean(ts.map(t => ctx.S[t + h])); return fitted(() => m, { m }); },
  };
  M.cycleclim = {
    name: 'Cyclic climatology (mean daily profile)', family: 'Persistence', needsCycle: true, ref: [REF + '/stories/variability-memory-forecastability/', 'Which forecast for which signal?'],
    fit: (ctx, h, ts) => { const c = profile(ctx, ts[ts.length - 1] + h); return fitted(t => c[(t + h) % ctx.T], { c }); },
  };
  M.cliper = {
    name: 'CLIPER', family: 'Persistence', ref: [REF + '/stories/solar-forecast-baseline-deep-learning/', 'Benchmarks for solar forecasting'],
    fit: (ctx, h, ts) => { // rho = autocorrelation at lag h on the fit targets; y = rho x_t + (1 - rho) mean
      const a = ts.map(t => ctx.S[t]), b = ts.map(t => ctx.S[t + h]), ma = mean(a), mb = mean(b);
      let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
      const rho = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0, m = mb;
      return fitted(t => rho * ctx.S[t] + (1 - rho) * m, { rho, m });
    },
  };
  M.blendcorr = {
    name: 'BLEND (λ from the phase correlation)', family: 'Persistence', needsCycle: true, ref: [REF + '/tools/forecast-comparison/', 'BLEND: cyclostationary persistence'],
    fit: (ctx, h, ts) => { // compute_cyclic_correlation (blend_correlation.py): rho per issue phase, lam = (1 + rho)/2 on the cyclic term
      const T = ctx.T, S = ctx.S, end = ts[ts.length - 1] + h, lam = new Float64Array(T).fill(0.5);
      for (let phi = 0; phi < T; phi++) {
        const x = [], y = [];
        for (let t = phi; t <= end - h; t += T) { const c = cyc(ctx, t, h); if (c >= 0) { x.push(S[t]); y.push(S[c]); } }
        if (x.length < 3) continue;
        const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
        for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
        if (sxx < 1e-24 || syy < 1e-24) { lam[phi] = 0.5; continue; }
        lam[phi] = Math.min(1, Math.max(0, 0.5 * (1 + sxy / Math.sqrt(sxx * syy))));
      }
      return fitted(t => { const l = lam[t % T]; return l * S[cyc(ctx, t, h)] + (1 - l) * S[t]; }, { lam });
    },
  };
  M.blendls = {
    name: 'BLEND (λ by least squares)', family: 'Persistence', needsCycle: true, ref: [REF + '/tools/forecast-comparison/', 'BLEND: cyclostationary persistence'],
    fit: (ctx, h, ts) => { // fit_blend_lambda_per_phase (blend_optimisation.py): lam on P, per target phase, clipped to [0, 1]
      const T = ctx.T, S = ctx.S, end = ts[ts.length - 1] + h, lam = new Float64Array(T).fill(0.5);
      for (let k = 0; k < T; k++) {
        let num = 0, den = 0, n = 0;
        for (let t = ((k - h) % T + T) % T; t <= end - h; t += T) {
          const c = cyc(ctx, t, h); if (c < 0) continue;
          const d = S[c] - S[t]; num += (S[c] - S[t + h]) * d; den += d * d; n++;
        }
        if (n >= 3 && den >= 1e-12) lam[k] = Math.min(1, Math.max(0, num / den));
      }
      return fitted(t => { const l = lam[(t + h) % T]; return l * S[t] + (1 - l) * S[cyc(ctx, t, h)]; }, { lam });
    },
  };
  M.gap = {
    name: 'Smart persistence (gap to the mean profile)', family: 'Persistence', needsCycle: true, ref: [REF + '/stories/variability-memory-forecastability/', 'Difference to the cycle'],
    // predict_P_smart.m: y(t+h) = y(t) + CS(t+h) - CS(t), with the mean profile per phase in place of the clear sky
    fit: (ctx, h, ts) => { const c = profile(ctx, ts[ts.length - 1] + h), T = ctx.T; return fitted(t => c[(t + h) % T] + ctx.S[t] - c[t % T], { c }); },
  };
  M.ar = {
    name: 'AR (least squares)', family: 'Classical', usesInputs: true, ref: [REF + '/teaching/solar-forecasting-course/', 'Solar forecasting course: AR models'],
    fit: (ctx, h, ts, p) => { // dr_ar_ols.py: [1, standardized lags, time features], lstsq
      const row = rowMaker(ctx, ts, p.LB, h, true), X = ts.map(t => [1].concat(row(t)));
      const w = lstsq(X, ts.map(t => ctx.S[t + h]), X[0].length);
      return fitted(t => { const r = [1].concat(row(t)); let s = 0; for (let i = 0; i < r.length; i++) s += r[i] * w[i]; return s; }, { row: row.state, w });
    },
  };

  /* --- benchmark paper (Voyant et al., Renewable Energy 191, 2022, ARTU.pdf). The paper works on the clear-sky index kappa;
     without a clear sky, kappa is the series itself (I_CS = 1), as the paper allows for "any kind of time series".
     The bound min(., beta) and the night filtering, which need I_CS, are dropped. --- */
  const BENCH = [REF + '/latest-publications-and-news/forecasting-with-less/', 'Benchmarks for time series forecasting'];
  M.es = {
    name: 'Exponential smoothing (ES)', family: 'Persistence', ref: BENCH,
    grid: ctx => ctx.cfg.opt.smooth ? [10, 24, 48].map(mx => ({ window: mx })) : [{ window: 24 }], // Algorithm 4: max in [10, 48]; 24 or chosen by CV
    fit: (ctx, h, ts, p) => {
      const S = ctx.S, x = fitSeries(ctx, ts, h), kb = mean(x), rho = acf(x, h), mx = p.window;
      return fitted(t => { let s = 0; for (let i = 0; i < mx; i++) s += (1 - rho) ** i * (t - i >= 0 ? S[t - i] : kb); return rho * s + kb * (1 - rho) ** mx; }, { kb, rho, mx });
    },
  };
  const KA = (typeof module !== 'undefined' && module.exports) ? require('./kalpha.js') : root.PRED_KALPHA;
  function kalpha(r1, r2) { // interp2 of K_alpha.m: rows rho(h), columns rho(2h), grid -1:0.05:1, bilinear
    const at = (Z, r, c) => Z[r][c], cl = v => Math.min(40, Math.max(0, (Math.min(1, Math.max(-1, v)) + 1) / 0.05));
    const fi = cl(r1), fj = cl(r2), i = Math.min(39, Math.floor(fi)), j = Math.min(39, Math.floor(fj)), u = fi - i, v = fj - j;
    const bil = Z => (1 - u) * (1 - v) * at(Z, i, j) + u * (1 - v) * at(Z, i + 1, j) + (1 - u) * v * at(Z, i, j + 1) + u * v * at(Z, i + 1, j + 1);
    return { K: bil(KA.K), alpha: bil(KA.a) };
  }
  E.kalpha = kalpha;
  M.artu = {
    name: 'ARTU (AR with tabulated coefficients)', family: 'Persistence', ref: BENCH,
    fit: (ctx, h, ts) => { // Algorithm 5, R = 0.05: (alpha, K) from rho(h), rho(2h); y = S y(t) - P y(t-h) + (1 + P - S) mean
      const S = ctx.S, x = fitSeries(ctx, ts, h), kb = mean(x), { K, alpha } = kalpha(acf(x, h), acf(x, 2 * h)), Su = alpha + K, P = alpha * K;
      return fitted(t => Su * S[t] - P * (t - h >= 0 ? S[t - h] : kb) + (1 + P - Su) * kb, { Su, P, kb });
    },
  };

  /* --- cyclostationary-forecasting-matlab --- */
  const CYCLO = [REF + '/tools/forecast-comparison/', 'Compare forecasts'];
  M.holtwinters = {
    name: 'Holt-Winters (level, trend, season)', family: 'Classical', needsCycle: true, ref: CYCLO,
    // fixed: the parameters of predict_HW.m; searched: grid search by the same cross-validation (no closed form for HW)
    grid: ctx => ctx.cfg.opt.smooth
      ? cross(cross(g1('alpha', [0.0837, 0.05, 0.1, 0.2, 0.4, 0.6]), g1('beta', [0, 0.05, 0.2, 0.4657])), g1('gamma', [0, 0.05, 0.2]))
      : [{ alpha: 0.0837, beta: 0.4657, gamma: 0 }],
    fit: (ctx, h, ts, p) => { // the recursion only uses values up to t, so one pass serves every fold
      const key = `${h}_${p.alpha}_${p.beta}_${p.gamma}`; (ctx._hw = ctx._hw || {});
      if (!ctx._hw[key]) ctx._hw[key] = holtWinters(ctx, h, p.alpha, p.beta, p.gamma); const P = ctx._hw[key]; return fitted(t => P[t], P.state);
    },
  };
  function holtWinters(ctx, h, a, b, g) { // predict_HW.m and its stability checks
    const S = ctx.S, T = ctx.T, N = ctx.N;
    let m1 = 0, m2 = 0; for (let i = 0; i < T; i++) { m1 += S[i]; m2 += S[T + i]; } m1 /= T; m2 /= T;
    const level0 = m1, trend0 = (m2 - m1) / T, seas = new Float64Array(T); for (let i = 0; i < T; i++) seas[i] = S[i] - level0;
    let maxS = -Infinity; for (let i = 0; i < ctx.Ntr; i++) maxS = Math.max(maxS, S[i]);
    const P = new Float64Array(N); let L = level0, B = trend0; // the .m reads levels(T) = 0 at the first step; here the initial level is used
    for (let t = 0; t < T; t++) P[t] = S[t];
    for (let t = T; t < N; t++) {
      const Lp = L, Bp = B;
      L = a * (S[t] - seas[t % T]) + (1 - a) * (Lp + Bp);
      B = b * (L - Lp) + (1 - b) * Bp;
      seas[t % T] = g * (S[t] - L) + (1 - g) * seas[t % T];
      if (Math.abs(L) > 5 * maxS) L = Lp;
      if (Math.abs(B) > Math.abs(level0 / T)) B = Bp;
      P[t] = L + h * B + seas[(t + h) % T];
      if (t === ctx.Ntr - 1) P.state = { L, B, seas: seas.slice(), level0, maxS, a, b, g };
    }
    return P;
  }
  M.theta = {
    name: 'Theta method', family: 'Classical', needsCycle: true, ref: CYCLO,
    // fixed: theta = 0.6205 of predict_Theta.m; searched: the forecast is linear in theta, so theta comes from least squares on the fit part
    fit: (ctx, h, ts) => { // causal version of predict_Theta.m: trailing mean over one period, seasonal profile of the fit part
      const S = ctx.S, T = ctx.T, cs = new Float64Array(ctx.N + 1); for (let i = 0; i < ctx.N; i++) cs[i + 1] = cs[i] + S[i];
      const trend = t => { const a = Math.max(0, t - T + 1); return (cs[t + 1] - cs[a]) / (t + 1 - a); };
      const end = ts[ts.length - 1] + h, prof = new Float64Array(T), n = new Float64Array(T);
      for (let j = 0; j <= end; j++) { prof[j % T] += S[j] - trend(j); n[j % T]++; }
      for (let p = 0; p < T; p++) prof[p] = n[p] ? prof[p] / n[p] : 0;
      let th = 0.6205;
      if (ctx.cfg.opt.smooth) { // y(t+h) - trend - prof = theta (S_t - trend_t)
        let num = 0, den = 0; for (const t of ts) { const d = S[t] - trend(t); num += d * (S[t + h] - trend(t) - prof[(t + h) % T]); den += d * d; }
        if (den > 0) th = num / den;
      }
      const f = fitted(t => th * S[t] - (th - 1) * trend(t) + prof[(t + h) % T],
        { th, prof, cumulative: cs.slice(Math.max(0, end + 1 - T), end + 2) });
      f.theta = th; return f;
    },
  };
  M.par = {
    name: 'Periodic AR, order by BIC (PAR-BIC)', family: 'Classical', needsCycle: true,
    ref: ['https://doi.org/10.1016/j.solener.2018.08.076', 'Voyant, De Gooijer and Notton (2018), Solar Energy 174'],
    // Voyant, De Gooijer, Notton (2018), Sol. Energy 174, 121-129 (PAR-BIC of Table 3):
    //  Eq. (4)  y(t) = sum_{k=1..p(h)} phi_k(h) y(t-k) + eps(t), h = phase of t, no constant;
    //  Eq. (6)  the same on y - TMY(d, h), TMY = mean over the years for each day of the year d and phase h (when "annual" is ticked);
    //  Eq. (5)  phi(h) by least squares on the observations of phase h;
    //  Eq. (11) p(h) minimizes BIC = log sigma2_h(p) + p log(n)/n, sigma2_h = LS residual variance, n = observations of phase h;
    //  Eq. (8)  l-step forecast by recursion, each step with the coefficients of its own phase (Eq. 4), then + TMY of the target.
    //  Tool bounds, not in the paper: p(h) from 1 to min(2 T, 48); the paper's backward bootstrap intervals are replaced by the common CV residuals.
    needs: (job, cfg) => cfg.annual && job.train.length < 5 * 365 * cfg.T
      ? `the TMY version (Eq. 6, "annual" ticked) needs a full year in every cross-validation fit, i.e. at least ${(5 * 365 * cfg.T).toLocaleString('en')} learning values; untick "annual" for the PAR of Eq. (4)` : '',
    fit: (ctx, h, ts) => {
      const S = ctx.S, T = ctx.T, N = ctx.N, end = ts[ts.length - 1] + h, pmax = Math.min(2 * T, 48), Y = 365 * T;
      const w = new Float64Array(N); let tmy = () => 0, annualProfile = null;
      if (ctx.cfg.annual) { // TMY(d, h) over the years of the fit part
        const tm = new Float64Array(Y), n = new Float64Array(Y);
        for (let j = 0; j <= end; j++) { tm[j % Y] += S[j]; n[j % Y]++; }
        annualProfile = tm.map((sum, j) => n[j] ? sum / n[j] : 0);
        tmy = j => annualProfile[j % Y];
      }
      for (let j = 0; j < N; j++) w[j] = S[j] - tmy(j);
      const W = [], order = [];
      for (let k = 0; k < T; k++) {
        const X = [], y = [];
        for (let j = pmax + ((k - pmax) % T + T) % T; j <= end; j += T) {
          y.push(w[j]);
          X.push(Array.from({ length: pmax }, (_, i) => w[j - 1 - i]));
        }
        const n = y.length;
        let best = null;
        for (let q = 1; q <= Math.min(pmax, n - 1); q++) {
          const phi = lstsq(X, y, q);
          if (!phi.rank) continue;
          let rss = 0;
          for (let i = 0; i < n; i++) {
            let estimate = 0;
            for (let j = 0; j < q; j++) estimate += X[i][j] * phi[j];
            rss += (y[i] - estimate) ** 2;
          }
          const bic = Math.log(rss / n) + q * Math.log(n) / n;
          if (!best || bic < best.bic) best = { bic, phi: Float64Array.from(Array.prototype.slice.call(phi, 0, q)) };
        }
        W.push(best ? best.phi : new Float64Array(1)); order.push(best ? best.phi.length : 0); // all-zero phase (night): no LS solution, phi = 0
      }
      // Default follows the target phase in Eqs. (4)–(5). The origin reading of Eqs. (7)–(8)
      // is available for comparison until the author confirms the intended notation.
      const buf = new Float64Array(pmax + h), offset = ctx.cfg.parIndex === 'origin' ? 1 : 0;
      const f = t => {
        for (let i = 0; i < pmax; i++) buf[i] = t - pmax + 1 + i >= 0 ? w[t - pmax + 1 + i] : 0; // buf[pmax-1] = w(t)
        for (let l = 1; l <= h; l++) { const c = W[(t + l - offset) % T]; let s = 0; for (let i = 0; i < c.length; i++) s += c[i] * buf[pmax - 2 + l - i]; buf[pmax - 1 + l] = s; }
        return buf[pmax - 1 + h] + tmy(t + h);
      };
      f.orders = order; return fitted(f, { W, offset, annualProfile });
    },
  };

  M.arma = {
    name: 'ARMA(p, 1), Hannan-Rissanen', family: 'Classical', usesInputs: true, ref: [REF + '/teaching/solar-forecasting-course/', 'Solar forecasting course: ARMA models'],
    // An ARMA model assumes a stationary series. With a period T, the seasonal component is first removed by the mean of each phase
    // (classical decomposition, Brockwell and Davis, Introduction to Time Series and Forecasting, 3rd ed. 2016, Section 1.5.2, without trend);
    // without a period, the mean. The ARMA(p, 1) is fitted on what is left, and the seasonal component of the target is added back.
    // Default estimator, Hannan-Rissanen (Brockwell and Davis, Section 5.1.4): (1) long AR(m) by Yule-Walker, residuals z;
    //  (2) least squares of w(t) on w(t-1..t-p) and z(t-1). Forecast: e(t) = w(t) - sum phi_j w(t-j) - theta e(t-1);
    //  one step = sum phi_j w + theta e(t), next steps recursive. Tool choices: m = max(20, p + 1); p = number of input lags (fixed or by CV).
    // Option cfg.armaMethod = 'moments': Box-Jenkins initial estimates by the method of moments (Box, Jenkins, Reinsel and Ljung 2016, Section 6.3.4):
    //  extended Yule-Walker rho(k) = sum_j phi_j rho(k - j), k = 2..p+1; MA from the autocovariances of the filtered series,
    //  r1 = -theta/(1+theta^2), invertible root. Outside the feasible range (|r1| > 0.5),
    //  theta = -sign(r1) is the tool's boundary convention, not a real root. Large p can diverge.
    fit: (ctx, h, ts, p) => {
      const S = ctx.S, N = ctx.N, end = ts[ts.length - 1] + h, P = p.LB, per = ctx.T >= 2 ? ctx.T : 1;
      const sea = new Float64Array(per), cnt = new Float64Array(per); // classical decomposition (Brockwell and Davis, Section 1.5.2): mean of each phase
      for (let j = 0; j <= end; j++) { sea[j % per] += S[j]; cnt[j % per]++; }
      for (let k = 0; k < per; k++) sea[k] = cnt[k] ? sea[k] / cnt[k] : 0;
      const w = new Float64Array(N); for (let j = 0; j < N; j++) w[j] = S[j] - sea[j % per];
      const x = Array.from(w.subarray(0, end + 1)), mu = 0;
      if (ctx.cfg.armaMethod !== 'moments') { // default. Hannan-Rissanen (Brockwell and Davis, Section 5.1.4): long AR(m) by Yule-Walker, then OLS on lags and innovations
        const m = Math.max(20, P + 1), Rm = new Float64Array(m + 1); for (let k = 0; k <= m; k++) Rm[k] = k ? acf(x, k) : 1;
        const Am = new Float64Array(m * m), bm = new Float64Array(m); for (let i = 0; i < m; i++) { bm[i] = Rm[i + 1]; for (let j = 0; j < m; j++) Am[i * m + j] = Rm[Math.abs(i - j)]; }
        const al = solveSym(Am, m, bm, m) || new Float64Array(m), z = new Float64Array(N);
        for (let j = m; j < N; j++) { let s = w[j]; for (let i = 0; i < m; i++) s -= al[i] * w[j - 1 - i]; z[j] = s; }
        const rows = [], ys = []; for (let j = m + 1; j <= end; j++) { const r = []; for (let i = 0; i < P; i++) r.push(w[j - 1 - i]); r.push(z[j - 1]); rows.push(r); ys.push(w[j]); }
        // a non-invertible MA(1) (|theta| > 1) has the same autocovariances as the invertible one with 1/theta (Brockwell and Davis, Section 3.1):
        // the innovations recursion needs the invertible form, so theta is replaced by 1/theta
        const c = lstsq(rows, ys, P + 1), phi = c.slice(0, P), th = Math.abs(c[P]) > 1 ? 1 / c[P] : c[P], a = new Float64Array(N);
        for (let j = P; j < N; j++) { let s = w[j]; for (let i = 0; i < P; i++) s -= phi[i] * w[j - 1 - i]; a[j] = s - th * a[j - 1]; }
        const buf = new Float64Array(P + h);
        const f = t => {
          for (let i = 0; i < P; i++) buf[i] = t - P + 1 + i >= 0 ? w[t - P + 1 + i] : 0;
          for (let k = 1; k <= h; k++) { let s = k === 1 ? th * a[t] : 0; for (let i = 0; i < P; i++) s += phi[i] * buf[P - 2 + k - i]; buf[P - 1 + k] = s; }
          return buf[P - 1 + h] + sea[(t + h) % per];
        };
        f.theta = th; return fitted(f, { phi, sea, innovation: a[end], signTheta: th });
      }
      const R = new Float64Array(2 * P + 3); for (let k = 0; k < R.length; k++) R[k] = k === 0 ? 1 : acf(x, k);
      const rho = k => R[Math.abs(k)];
      const A = new Float64Array(P * P), b = new Float64Array(P);
      for (let i = 0; i < P; i++) { b[i] = rho(i + 2); for (let j = 0; j < P; j++) A[i * P + j] = rho(i + 1 - j); }
      const phi = luSolve(A, P, b, P) || new Float64Array(P);
      const ph = [-1].concat(Array.from(phi));
      const cj = j => { let s = 0; for (let i = 0; i <= P; i++) for (let k = 0; k <= P; k++) s += ph[i] * ph[k] * rho(j + i - k); return s; };
      const r1 = cj(1) / cj(0);
      const theta = Math.abs(r1) < 1e-12 ? 0 : Math.abs(r1) >= 0.5 ? -Math.sign(r1) : (-1 + Math.sqrt(1 - 4 * r1 * r1)) / (2 * r1);
      const a = new Float64Array(N);
      for (let j = P; j < N; j++) { let s = w[j]; for (let i = 0; i < P; i++) s -= phi[i] * w[j - 1 - i]; a[j] = s + theta * a[j - 1]; }
      const buf = new Float64Array(P + h);
      const f = t => {
        for (let i = 0; i < P; i++) buf[i] = t - P + 1 + i >= 0 ? w[t - P + 1 + i] : 0; // buf[P-1] = w(t)
        for (let k = 1; k <= h; k++) { let s = k === 1 ? -theta * a[t] : 0; for (let i = 0; i < P; i++) s += phi[i] * buf[P - 2 + k - i]; buf[P - 1 + k] = s; }
        return buf[P - 1 + h] + mu + sea[(t + h) % per];
      };
      f.theta = theta; return fitted(f, { phi, sea, innovation: a[end], signTheta: -theta });
    },
  };

  M.complexar = {
    name: 'Complex-valued AR (level + volatility)', family: 'Classical', ref: [REF + '/complex-valued-forecasting/', 'Forecasting with complex numbers'],
    // Voyant et al., J. Renew. Sustain. Energy 14, 066502 (2022): z = kappa + j sigma_tau, sigma_tau = sd of the step changes over tau = 30 steps,
    // complex AR with 6 coefficients, complex least squares with lambda = 3.74; interval y_hat +/- mu sigma_hat, mu calibrated on the learning data
    // (here: conformal quantiles of the residuals divided by sigma_hat). Without clear sky: kappa = series / its sd on the fit part.
    fit: (ctx, h, ts) => {
      const S = ctx.S, x = fitSeries(ctx, ts, h), s = sd1(x) || 1, tau = 30, p = 6, lam = 3.74, N = ctx.N;
      const sg = new Float64Array(N), d = new Float64Array(N); for (let i = 1; i < N; i++) d[i] = (S[i] - S[i - 1]) / s;
      let a1 = 0, a2 = 0, state;
      for (let i = 1; i < N; i++) {
        a1 += d[i]; a2 += d[i] * d[i];
        if (i > tau) { a1 -= d[i - tau]; a2 -= d[i - tau] ** 2; }
        const n = Math.min(i, tau); sg[i] = n > 1 ? Math.sqrt(Math.max(0, (a2 - a1 * a1 / n) / (n - 1))) : 0;
        if (i === ctx.Ntr - 1) state = { a1, a2, deltas: d.slice(i - tau + 1, i + 1), sigmas: sg.slice(i - p + 1, i + 1) };
      }
      const zr = j => S[j] / s, zi = j => sg[j];
      const Ar = new Float64Array(p * p), Ai = new Float64Array(p * p), br = new Float64Array(p), bi = new Float64Array(p);
      for (const t of ts) {
        if (t - p + 1 < 1) continue;
        const yr = zr(t + h), yi = zi(t + h);
        for (let i = 0; i < p; i++) {
          const xr = zr(t - i), xi = zi(t - i); // conj(x_i) * ...
          br[i] += xr * yr + xi * yi; bi[i] += xr * yi - xi * yr;
          for (let j = 0; j < p; j++) { const ur = zr(t - j), ui = zi(t - j); Ar[i * p + j] += xr * ur + xi * ui; Ai[i * p + j] += xr * ui - xi * ur; }
        }
      }
      for (let i = 0; i < p; i++) Ar[i * p + i] += lam;
      const c = csolve(Ar, Ai, br, bi, p), floor = 0.05 * (mean(Array.from(sg.subarray(1, x.length))) || 1);
      const zhat = t => { let r = 0, im = 0; for (let i = 0; i < p; i++) { const u = zr(t - i), v = zi(t - i); r += c.r[i] * u - c.i[i] * v; im += c.r[i] * v + c.i[i] * u; } return [r, im]; };
      const f = t => zhat(t)[0] * s;
      f.scale = t => Math.max(Math.abs(zhat(t)[1]), floor) * s;
      return fitted(f, { ...state, c, floor, s, tau, p });
    },
  };
  function csolve(Ar0, Ai0, br0, bi0, n) { // complex Gaussian elimination with partial pivoting
    const Ar = Float64Array.from(Ar0), Ai = Float64Array.from(Ai0), br = Float64Array.from(br0), bi = Float64Array.from(bi0);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.hypot(Ar[r * n + c], Ai[r * n + c]) > Math.hypot(Ar[p * n + c], Ai[p * n + c])) p = r;
      if (p !== c) { for (let k = 0; k < n; k++) { [Ar[c * n + k], Ar[p * n + k]] = [Ar[p * n + k], Ar[c * n + k]]; [Ai[c * n + k], Ai[p * n + k]] = [Ai[p * n + k], Ai[c * n + k]]; } [br[c], br[p]] = [br[p], br[c]]; [bi[c], bi[p]] = [bi[p], bi[c]]; }
      const dr = Ar[c * n + c], di = Ai[c * n + c], dd = dr * dr + di * di;
      for (let r = c + 1; r < n; r++) {
        const nr = Ar[r * n + c], ni = Ai[r * n + c], fr = (nr * dr + ni * di) / dd, fi = (ni * dr - nr * di) / dd;
        for (let k = c; k < n; k++) { const ur = Ar[c * n + k], ui = Ai[c * n + k]; Ar[r * n + k] -= fr * ur - fi * ui; Ai[r * n + k] -= fr * ui + fi * ur; }
        br[r] -= fr * br[c] - fi * bi[c]; bi[r] -= fr * bi[c] + fi * br[c];
      }
    }
    const xr = new Float64Array(n), xi = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let sr = br[i], si = bi[i]; for (let k = i + 1; k < n; k++) { sr -= Ar[i * n + k] * xr[k] - Ai[i * n + k] * xi[k]; si -= Ar[i * n + k] * xi[k] + Ai[i * n + k] * xr[k]; }
      const dr = Ar[i * n + i], di = Ai[i * n + i], dd = dr * dr + di * di; xr[i] = (sr * dr + si * di) / dd; xi[i] = (si * dr - sr * di) / dd;
    }
    return { r: xr, i: xi };
  }
  E.MODELS = M;

  // ---------- ELM (vectorized path with nested hidden sizes and incremental folds) ----------
  /* One candidate layer of nMax neurons; sizes in nhOpts use its first n neurons (nested), lam in lamOpts.
     Returns, for each (n, lam), the mean validation RMSE over the folds. Also usable for the final refit. */
  function elmLayer(d, nMax, rnd) {
    const IW = new Float64Array(nMax * d), bias = new Float64Array(nMax);
    for (let i = 0; i < nMax; i++) for (let k = 0; k < d; k++) IW[i * d + k] = 2 * rnd() - 1;
    for (let i = 0; i < nMax; i++) bias[i] = rnd();
    return { IW, bias, d, nMax };
  }
  function hidden(X, L, g, nMax) {
    const n = X.length, d = L.d, H = new Float64Array(n * nMax);
    for (let r = 0; r < n; r++) { const x = X[r]; for (let i = 0; i < nMax; i++) { let s = L.bias[i]; for (let k = 0; k < d; k++) s += x[k] * L.IW[i * d + k]; H[r * nMax + i] = g(s); } }
    return H;
  }
  /* Each scalar sum accumulates samples in chronological order.
     The single block is faster than tiling by 32 on the reference workstation. */
  function hiddenStats(H, y, nMax, end) {
    const A = new Float64Array(nMax * nMax), hy = new Float64Array(nMax), h1 = new Float64Array(nMax);
    const block = nMax;
    for (let start = 0; start < nMax; start += block) {
      const stop = Math.min(start + block, nMax);
      for (let r = 0; r < end; r++) {
        const offset = r * nMax, target = y[r];
        for (let i = start; i < stop; i++) {
          const hi = H[offset + i], row = i * nMax;
          hy[i] += hi * target;
          h1[i] += hi;
          for (let j = 0; j <= i; j++) A[row + j] += hi * H[offset + j];
        }
      }
    }
    for (let i = 0; i < nMax; i++) for (let j = 0; j < i; j++) A[j * nMax + i] = A[i * nMax + j];
    return { A, hy, h1 };
  }
  function elmBeta(st, yFit, n, nMax, lam) { // target centred and scaled on the fit part (PV_ELM_pred, July 2026)
    const mu = mean(yFit), sd = sd1(yFit) || 1, A = new Float64Array(n * n), b = new Float64Array(n);
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i * n + j] = st.A[i * nMax + j]; A[i * n + i] += lam; b[i] = (st.hy[i] - mu * st.h1[i]) / sd; }
    return { beta: solveSym(A, n, b, n), mu, sd };
  }
  /* symmetric eigen-decomposition: Householder tridiagonalisation then implicit QL (tred2 / tql2 of EISPACK, as in JAMA). A = V diag(d) V' */
  function eigTri(A0, n) {
    const V = Float64Array.from(A0), d = new Float64Array(n), e = new Float64Array(n), at = (i, j) => i * n + j;
    for (let j = 0; j < n; j++) d[j] = V[at(n - 1, j)];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[at(i - 1, j)]; V[at(i, j)] = 0; V[at(j, i)] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g;
        e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j]; V[at(j, i)] = f; g = e[j] + V[at(j, j)] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[at(k, j)] * d[k]; e[k] += V[at(k, j)] * f; }
          e[j] = g;
        }
        f = 0;
        for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) {
          f = d[j]; g = e[j];
          for (let k = j; k <= i - 1; k++) V[at(k, j)] -= f * e[k] + g * d[k];
          d[j] = V[at(i - 1, j)]; V[at(i, j)] = 0;
        }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[at(n - 1, i)] = V[at(i, i)]; V[at(i, i)] = 1; const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[at(k, i + 1)] / h;
        for (let j = 0; j <= i; j++) { let g = 0; for (let k = 0; k <= i; k++) g += V[at(k, i + 1)] * V[at(k, j)]; for (let k = 0; k <= i; k++) V[at(k, j)] -= g * d[k]; }
      }
      for (let k = 0; k <= i; k++) V[at(k, i + 1)] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[at(n - 1, j)]; V[at(n - 1, j)] = 0; }
    V[at(n - 1, n - 1)] = 1; e[0] = 0;
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0; const eps = Math.pow(2, -52);
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l; while (m < n) { if (Math.abs(e[m]) <= eps * tst1) break; m++; }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 60) break;
          let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1); if (p < 0) r = -r;
          d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1]; let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let sn = 0, s2 = 0;
          for (let i = m - 1; i >= l; i--) {
            c3 = c2; c2 = c; s2 = sn; g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
            e[i + 1] = sn * r; sn = e[i] / r; c = p / r; p = c * d[i] - sn * g; d[i + 1] = h + sn * (c * g + sn * d[i]);
            for (let k = 0; k < n; k++) { h = V[at(k, i + 1)]; V[at(k, i + 1)] = sn * V[at(k, i)] + c * h; V[at(k, i)] = c * V[at(k, i)] - sn * h; }
          }
          p = -sn * s2 * c3 * el1 * e[l] / dl1; e[l] = sn * p; d[l] = c * p;
        } while (Math.abs(e[l]) > eps * tst1);
      }
      d[l] += f; e[l] = 0;
    }
    return { d, V };
  }
  E.eigTri = eigTri;
  /* ridge lambda by generalised cross-validation (Golub, Heath and Wahba 1979, Technometrics 21, 215-223):
     lambda minimises GCV = N ||z - H beta_lambda||^2 / (N - tr A_lambda)^2, A_lambda = H (H'H + lambda I)^-1 H', z = centred and scaled target.
     With H'H = V diag(d) V' and b = V' H'z: RSS = z'z - sum b_i^2 (d_i + 2 lambda)/(d_i + lambda)^2, tr A = sum d_i/(d_i + lambda).
     The minimum is taken on lambda = 10^k, k = -8 to 6 by steps of 0.02 (tool choice, reported); beta = V diag(1/(d + lambda)) b. */
  function elmGCV(st, yFit, n, nMax) {
    const mu = mean(yFit), sd = sd1(yFit) || 1, N = yFit.length, A = new Float64Array(n * n), hz = new Float64Array(n);
    for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) A[i * n + j] = st.A[i * nMax + j]; hz[i] = (st.hy[i] - mu * st.h1[i]) / sd; }
    const { d, V } = eigTri(A, n), b = new Float64Array(n);
    for (let j = 0; j < n; j++) { let t = 0; for (let i = 0; i < n; i++) t += V[i * n + j] * hz[i]; b[j] = t; }
    let zz = 0;
    for (const y of yFit) zz += ((y - mu) / sd) ** 2;
    let best = null;
    for (let k = -8; k <= 6 + 1e-9; k += 0.02) {
      const lam = Math.pow(10, k); let rss = zz, tr = 0;
      for (let j = 0; j < n; j++) { const dj = Math.max(d[j], 0), q = dj + lam; rss -= b[j] * b[j] * (dj + 2 * lam) / (q * q); tr += dj / q; }
      const g = N * Math.max(rss, 0) / ((N - tr) * (N - tr));
      if (N - tr > 0 && (!best || g < best.g)) best = { g, lam };
    }
    const beta = new Float64Array(n);
    for (let j = 0; j < n; j++) { const w = b[j] / (Math.max(d[j], 0) + best.lam); for (let i = 0; i < n; i++) beta[i] += V[i * n + j] * w; }
    return { beta, mu, sd, lam: best.lam };
  }
  const predRow = (H, r, nMax, B, n) => { let s = 0; const o = r * nMax; for (let i = 0; i < n; i++) s += H[o + i] * B.beta[i]; return s * B.sd + B.mu; };

  M.elm = {
    name: 'ELM, ridge', family: 'ELM', usesInputs: true, isELM: true, ref: [REF + '/tools/extreme-learning-machine/', 'Understanding the ELM'],
  };
  M.elmols = {
    name: 'ELM, least squares (pseudo-inverse)', family: 'ELM', usesInputs: true, isELM: true, ols: true, ref: [REF + '/tools/extreme-learning-machine/', 'Understanding the ELM'],
  };

  /* --- ELM variants of the frugality study (PV_ELM_pred/scripts/dr_elm_*.py, Applied Energy 2026). Same hidden layer and CV;
     only the solve for beta changes. Each variant searches its own grid, the one of its script; "2-pass" variants:
     pass 1 = ridge, pass 2 = one weighted solve (no iteration), exactly as in the scripts. --- */
  const ELMREF = [REF + '/tools/extreme-learning-machine/', 'Understanding the ELM'];
  const cross = (a, b) => a.flatMap(x => b.map(y => Object.assign({}, x, y)));
  const g1 = (k, vals) => vals.map(v => ({ [k]: v }));
  const madSigma = r => { const s = Float64Array.from(r).sort(), med = quantile(s, 0.5), d = Float64Array.from(r, v => Math.abs(v - med)).sort(); return quantile(d, 0.5) / 0.6745; };
  const twoPass = wfun => c => { // pass 1 ridge on z, pass 2 one solve with weights w(r)
    const { z, mu, sd } = c.stdz(), b0 = c.ridge(z, c.p.lam), r = c.resid(b0, z), w = wfun(r, c.p);
    return c.lin(c.lstsq(z, w), mu, sd);
  };
  const V = {
    elmrr: { name: 'ELM, robust risk', grid: g1('eps', [0.01, 0.1, 0, Math.sqrt(10), 5, 10]),
      fit: c => { const { z, mu, sd } = c.stdz(); return c.lin(c.p.eps === 0 ? c.lstsq(z) : c.ridge(z, c.p.eps ** 2), mu, sd); } },
    elmtik: { name: 'ELM, anisotropic Tikhonov', grid: g1('lam', [10, 25]),
      fit: c => { const { z, mu, sd } = c.stdz(), A = c.G(); for (let j = 0; j < c.n; j++) A[j * c.n + j] += c.p.lam * A[j * c.n + j] / c.a; return c.lin(c.solve(A, c.hz(z)), mu, sd); } },
    elmen: { name: 'ELM, elastic net (2-pass)', grid: cross(g1('lam1', [1, 10]), g1('lam2', [10, 25])),
      fit: c => { const { z, mu, sd } = c.stdz(), b0 = c.ridge(z, c.p.lam2), A = c.G(); for (let j = 0; j < c.n; j++) A[j * c.n + j] += c.p.lam2 + c.p.lam1 / (Math.abs(b0[j]) + 1e-6); return c.lin(c.solve(A, c.hz(z)), mu, sd); } },
    elmmae: { name: 'ELM, MAE loss (2-pass)', grid: cross(g1('lam', [10, 25]), g1('delta', [0.05, 0.1, 0.5])),
      fit: twoPass((r, p) => r.map(v => 1 / Math.sqrt(v * v + p.delta * p.delta))) },
    elml3: { name: 'ELM, L3 loss (2-pass)', grid: cross(g1('lam', [10, 25]), g1('delta', [0.05, 0.1, 0.5])),
      fit: twoPass((r, p) => r.map(v => Math.sqrt(v * v + p.delta * p.delta))) },
    elmlp: { name: 'ELM, Lp loss (2-pass)', grid: cross(g1('lam', [10, 25]), g1('p', [1.25, 1.5, 1.75])),
      fit: twoPass((r, p) => r.map(v => Math.max(Math.abs(v), 1e-6) ** (p.p - 2))) },
    elmhuber: { name: 'ELM, Huber loss (2-pass)', grid: g1('lam', [10, 25]),
      fit: twoPass(r => { const dl = Math.max(1.345 * madSigma(r), 1e-6); return r.map(v => Math.abs(v) <= dl ? 1 : dl / Math.max(Math.abs(v), 1e-6)); }) },
    elmm: { name: 'ELM, M-estimator Welsch (2-pass)', grid: g1('lam', [10, 25]),
      fit: twoPass(r => { const cc = Math.max(2.985 * madSigma(r), 1e-6); return r.map(v => Math.exp(-((v / cc) ** 2))); }) },
    elmlogmse: { name: 'ELM, log-MSE', needsNonneg: true, grid: cross(g1('lam', [25]), g1('c', [0.1, 1, 10, 100])),
      fit: c => { const z0 = c.y.slice(0, c.a).map(v => Math.log(v + c.p.c)), mu = mean(z0), sd = sd1(z0) || 1, beta = c.ridge(z0.map(v => (v - mu) / sd), c.p.lam);
        return fitted((Hm, r) => Math.max(0, Math.exp(Math.min(c.dot(Hm, r, beta) * sd + mu, 20)) - c.p.c), { beta, mu, sd, offset: c.p.c }); } },
    elmboxcox: { name: 'ELM, Box-Cox target', needsNonneg: true, grid: cross(g1('lam', [25]), g1('lbc', [0, 0.25, 0.5, 0.75, 1])),
      fit: c => { const L = c.p.lbc, bc = v => L === 0 ? Math.log(v) : (v ** L - 1) / L, inv = z => L === 0 ? Math.exp(z) : Math.max(1 + L * z, 1e-12) ** (1 / L);
        const z0 = c.y.slice(0, c.a).map(v => bc(v + 1)), mu = mean(z0), sd = sd1(z0) || 1, beta = c.ridge(z0.map(v => (v - mu) / sd), c.p.lam);
        return fitted((Hm, r) => Math.max(0, inv(c.dot(Hm, r, beta) * sd + mu) - 1), { beta, mu, sd, power: L }); } },
    elmglm: { name: 'ELM, GLM Gamma log-link (2-pass)', needsNonneg: true, grid: cross(g1('lam', [25]), g1('c', [0.1, 1, 10, 100])),
      fit: c => { const y = c.y.slice(0, c.a), b0 = c.ridge(y, c.p.lam), muh = c.fitted(b0).map(v => Math.max(v, 1e-3));
        const zz = y.map((v, i) => Math.log(muh[i]) + (v + c.p.c - muh[i]) / muh[i]), w = muh.map(v => v * v), A = c.gramW(w);
        for (let j = 0; j < c.n; j++) A[j * c.n + j] += c.p.lam;
        const beta = c.solve(A, c.hz(zz, w)); return fitted((Hm, r) => Math.max(0, Math.exp(Math.min(c.dot(Hm, r, beta), 20)) - c.p.c), { beta, offset: c.p.c }); } },
    elmcorr: { name: 'ELM, correlated errors (Corr-ELM)', grid: cross(g1('tau', [1, 4, 12]), g1('sigma2', [10, 25])), // tau in steps (script: 0.5, 2, 6 h at 30 min)
      fit: c => { const { z, mu, sd } = c.stdz(), tau = c.p.tau, K = Math.max(1, Math.ceil(5 * tau)), n = c.n, a = c.a;
        const band = col => { const out = Float64Array.from(col); for (let k = 1; k <= K; k++) { const wk = Math.exp(-k / tau); for (let i = 0; i + k < a; i++) { out[i] += wk * col[i + k]; out[i + k] += wk * col[i]; } } return out; };
        const A = new Float64Array(n * n), Hc = [];
        for (let j = 0; j < n; j++) { const col = new Float64Array(a); for (let r = 0; r < a; r++) col[r] = c.H[r * c.nMax + j]; Hc.push(col); }
        const CH = Hc.map(band);
        for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = 0; const hi = Hc[i], cj = CH[j]; for (let r = 0; r < a; r++) s += hi[r] * cj[r]; A[i * n + j] = A[j * n + i] = s; }
        for (let i = 0; i < n; i++) A[i * n + i] += c.p.sigma2;
        const Cz = band(Float64Array.from(z)), b = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let r = 0; r < a; r++) s += Hc[i][r] * Cz[r]; b[i] = s; }
        return c.lin(c.solve(A, b), mu, sd); } },
  };
  for (const id in V) M[id] = Object.assign({ family: 'ELM', usesInputs: true, isELMv: true, ref: ELMREF }, V[id]);

  /* helper object handed to a variant: hidden matrix H (rows 0..a-1 = fit part), size n, combination p */
  function variantCtx(H, nMax, n, a, y, p, st) {
    const c = { H, nMax, n, a, y, p };
    c.G = () => { const A = new Float64Array(n * n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) A[i * n + j] = st.A[i * nMax + j]; return A; };
    c.hz = (z, w) => { const b = new Float64Array(n); for (let r = 0; r < a; r++) { const o = r * nMax, zr = w ? w[r] * z[r] : z[r]; for (let i = 0; i < n; i++) b[i] += H[o + i] * zr; } return b; };
    c.gramW = w => { const A = new Float64Array(n * n); for (let r = 0; r < a; r++) { const o = r * nMax, wr = w[r]; for (let i = 0; i < n; i++) { const hi = H[o + i] * wr; for (let j = 0; j <= i; j++) A[i * n + j] += hi * H[o + j]; } } for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) A[j * n + i] = A[i * n + j]; return A; };
    c.solve = (A, b) => solveSym(A, n, b, n) || new Float64Array(n);
    c.lstsq = (z, w) => leastSquares(a, n, (i, j) => H[i * nMax + j], z, w);
    c.ridge = (z, lam) => { const A = c.G(); for (let i = 0; i < n; i++) A[i * n + i] += lam; return c.solve(A, c.hz(z)); };
    c.stdz = () => { const yf = y.slice(0, a), mu = mean(yf), sd = sd1(yf) || 1; return { z: yf.map(v => (v - mu) / sd), mu, sd }; };
    c.dot = (Hm, r, beta) => { let s = 0; const o = r * nMax; for (let i = 0; i < n; i++) s += Hm[o + i] * beta[i]; return s; };
    c.fitted = beta => { const out = new Array(a); for (let r = 0; r < a; r++) out[r] = c.dot(H, r, beta); return out; };
    c.resid = (beta, z) => c.fitted(beta).map((v, r) => z[r] - v);
    c.lin = (beta, mu, sd) => fitted((Hm, r) => c.dot(Hm, r, beta) * sd + mu, { beta, mu, sd });
    return c;
  }

  // ---------- running one model on one horizon ----------

  /* models without inputs; `grid` (if any) searched by CV; a predictor with .scale(t) gives scaled intervals (residual / scale) */
  /* validation RMSE of one fold: all targets, or only those flagged in smp.cvKeep (solar series, cvOn: 'day' = observed target > 0) */
  const foldStats = (sum, bias, n, scale) => ({
    n, rmse: n ? Math.sqrt(sum / n) * scale : null, bias: n ? -bias / n * scale : null,
  });
  const keepCV = (smp, i) => !smp.cvKeep || smp.cvKeep[i] === 1;
  function runSimple(ctx, m, h, smp, clip) {
    const tr = smp.tr, grid = m.grid ? m.grid(ctx, h) : [{}];
    let best = null; const tried = [];
    for (const p of grid) {
      const resid = [], sc = [];
      for (const { a, b, fitTs, context, errorAt } of smp.folds) {
        const f = m.fit(context, h, fitTs, p); let s = 0, nk = 0, bias = 0;
        for (let i = a; i < b; i++) {
          const t = tr[i], e = errorAt(t, f(t)); if (keepCV(smp, i)) { s += e * e; bias += e; nk++; }
          resid.push(f.scale ? e * ctx.scale / (f.scale(t) * context.scale) : e);
        }
        sc.push(foldStats(s, bias, nk, ctx.scale));
      }
      const cv = mean(sc.filter(f => f.n).map(f => f.rmse / ctx.scale));
      tried.push(Object.assign({}, p, { cv, cvFolds: sc })); if (Number.isFinite(cv) && (!best || cv < best.cv)) best = { cv, p, resid, cvFolds: sc };
    }
    if (!best) throw new Error('No finite candidate for ' + m.name + '.');
    const f = m.fit(ctx, h, tr, best.p);
    return { tried: grid.length > 1 ? tried : [], pred: smp.te.map(t => clip(f(t))), resid: best.resid, cv: best.cv, cvFolds: best.cvFolds, fittedState: f.state, chosen: Object.assign(f.theta !== undefined ? { theta: +f.theta.toFixed(4) } : {}, f.orders ? { 'orders p(h)': `${Math.min(...f.orders)} to ${Math.max(...f.orders)}, median ${f.orders.slice().sort((x, y) => x - y)[f.orders.length >> 1]}` } : {}, best.p), scale: f.scale ? smp.te.map(t => f.scale(t)) : null };
  }

  function runAR(ctx, m, h, smp, clip, progress) {
    const tr = smp.tr, lbs = ctx.cfg.opt.inputs ? ctx.cfg.lbOpts : [ctx.cfg.lbFixed];
    let best = null; const tried = [];
    for (const LB of lbs) {
      const resid = [], sc = [];
      for (const { a, b, fitTs, context, errorAt } of smp.folds) {
        const f = m.fit(context, h, fitTs, { LB, _trTs: fitTs });
        let sum = 0, nk = 0, bias = 0;
        for (let i = a; i < b; i++) {
          const e = errorAt(tr[i], f(tr[i])); if (keepCV(smp, i)) { sum += e * e; bias += e; nk++; } resid.push(e);
        }
        sc.push(foldStats(sum, bias, nk, ctx.scale));
      }
      const cv = mean(sc.filter(f => f.n).map(f => f.rmse / ctx.scale));
      tried.push({ inputs: LB, cv, cvFolds: sc }); if (Number.isFinite(cv) && (!best || cv < best.cv)) best = { cv, LB, resid, cvFolds: sc };
      progress && progress();
    }
    if (!best) throw new Error('No finite candidate for ' + m.name + '.');
    const f = m.fit(ctx, h, tr, { LB: best.LB, _trTs: tr });
    const chosen = { inputs: best.LB }; if (f.theta !== undefined) chosen.theta = +(+f.theta).toFixed(4);
    return { tried: lbs.length > 1 ? tried : [], pred: smp.te.map(t => clip(f(t))), resid: best.resid, chosen, cv: best.cv, cvFolds: best.cvFolds, fittedState: f.state, nparams: best.LB + 1 + timeFeat(ctx, 0).length };
  }

  function elmParameters(m, cfg) {
    if (m.isELMv) return m.grid;
    if (m.ols) return [{}];
    return [{ ridge: cfg.opt.ridge ? 'gcv' : cfg.lamFixed }];
  }

  function fitHiddenModel(m, H, nMax, n, y, fitEnd, params, stats) {
    if (m.isELMv) return m.fit(variantCtx(H, nMax, n, fitEnd, y, params, stats));
    const target = y.slice(0, fitEnd);
    let fit;
    if (m.ols) {
      const mu = mean(target), sd = sd1(target) || 1;
      const beta = leastSquares(fitEnd, n, (i, j) => H[i * nMax + j], target.map(v => (v - mu) / sd));
      fit = { beta, mu, sd };
    } else {
      fit = params.ridge === 'gcv' ? elmGCV(stats, target, n, nMax) : elmBeta(stats, target, n, nMax, params.ridge);
    }
    const predict = fit.beta ? (matrix, row) => predRow(matrix, row, nMax, fit, n) : () => NaN;
    predict.lambda = fit.lam;
    predict.state = fit;
    return predict;
  }

  function runELM(ctx, m, h, smp, clip, progress, shouldStop) {
    const c = ctx.cfg, tr = smp.tr, activation = ACT[c.act] || ACT.sigmoid;
    const lbs = c.opt.inputs ? c.lbOpts : [c.lbFixed];
    const nhs = c.opt.neurons ? c.nhOpts : [c.nhFixed];
    const ncand = (c.opt.inputs || c.opt.neurons) ? c.ncand : c.ncandFixed;
    const nMax = Math.max(...nhs), rnd = mulberry32((c.seed + h) >>> 0);
    const options = nhs.flatMap(n => elmParameters(m, c).map(params => ({ n, params })));
    const calibrationSize = smp.folds.reduce((size, { a, b }) => size + b - a, 0);
    const foldInputs = (LB, { b, fitTs, context }) => {
      const issues = tr.slice(0, b);
      return { x: design(context, issues, fitTs, LB, h, true, true), y: issues.map(t => context.S[t + h]) };
    };
    let best = null; const tried = [];
    for (const LB of lbs) {
      const prepared = smp.folds.map(fold => foldInputs(LB, fold));
      const d = prepared[0].x[0].length;
      for (let candidate = 1; candidate <= ncand; candidate++) {
        if (shouldStop && shouldStop()) throw new Error('stopped');
        const layer = elmLayer(d, nMax, rnd), foldResults = options.map(() => []);
        const residuals = options.map(() => new Float64Array(calibrationSize));
        let offset = 0;
        for (const [fi, fold] of smp.folds.entries()) {
          const { a, b, fitEnd, errorAt } = fold, { x, y } = prepared[fi];
          const H = hidden(x, layer, activation, nMax);
          const stats = m.ols ? null : hiddenStats(H, y, nMax, fitEnd);
          for (const [i, { n, params }] of options.entries()) {
            const predict = fitHiddenModel(m, H, nMax, n, y, fitEnd, params, stats);
            let sum = 0, nk = 0, bias = 0;
            for (let r = a; r < b; r++) {
              const e = errorAt(tr[r], predict(H, r));
              residuals[i][offset + r - a] = e;
              if (keepCV(smp, r)) { sum += e * e; bias += e; nk++; }
            }
            foldResults[i].push(foldStats(sum, bias, nk, ctx.scale));
          }
          offset += b - a;
        }
        for (const [i, { n, params }] of options.entries()) {
          const cvFolds = foldResults[i];
          const cv = mean(cvFolds.filter(f => f.n).map(f => f.rmse / ctx.scale));
          tried.push(Object.assign({ inputs: LB, neurons: n }, params.ridge === 'gcv' ? { ridge: 'GCV' } : params, { candidate, cv, cvFolds }));
          if (Number.isFinite(cv) && (!best || cv < best.cv)) {
            best = { cv, LB, candidate, n, params, layer, resid: residuals[i], cvFolds };
          }
        }
        progress && progress();
      }
    }
    if (!best) throw new Error('No finite candidate for ' + m.name + '.');

    const { cv, LB, candidate, n, params, layer, resid } = best;
    const row = rowMaker(ctx, tr, LB, h, true);
    const x = designRows(row, tr, LB, true), y = tr.map(t => ctx.S[t + h]);
    const H = hidden(x, layer, activation, nMax);
    const stats = m.ols ? null : hiddenStats(H, y, nMax, tr.length);
    const predict = fitHiddenModel(m, H, nMax, n, y, tr.length, params, stats);
    const xTest = designRows(row, smp.te, LB, true), testHidden = hidden(xTest, layer, activation, nMax);
    const pred = smp.te.map((_, row) => clip(predict(testHidden, row)));
    const settings = params.ridge === 'gcv' ? { 'ridge λ (GCV)': +predict.lambda.toPrecision(3) } : params;
    return { tried: tried.length > 1 ? tried : [], pred, resid, cv, cvFolds: best.cvFolds, chosen: { inputs: LB, neurons: n, ...settings, candidate },
      nparams: n * (x[0].length + 2), fittedState: { row: row.state, layer, n, nMax, fit: predict.state } };
  }

  /* ---------- intervals and scores ---------- */
  /* inverse of the standard normal CDF (Acklam), for Gaussian bands and QQ plots */
  function probit(p) {
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
      b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
      d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  E.probit = probit;
  /* conformal: empirical quantiles of the out-of-fold residuals r = y - y_hat; gaussian: mean(r) + z sd(r).
     ph = {T, rph, tph}: per phase of the period (Mondrian conformal, Vovk, Gammerman and Shafer 2005, Algorithmic Learning in a Random World,
     Ch. 4): the quantiles of the residuals whose target has the same phase as the target forecast (rph: phase of each residual, tph: of each
     forecast). A phase with fewer than 20 residuals uses all of them (tool rule). Every quantile goes through clip: with values >= 0 the
     forecast distribution is censored at 0, so its quantiles are max(0, q) (lower limits, fan charts, CRPS, PIT). */
  function band(pred, resid, qlo, qhi, clip, kind, scale, ph) {
    const mk = rs => {
      const r = Float64Array.from(rs).sort(), gm = mean(r), gs = r.length > 1 ? sd1(r) : 0;
      const Q = kind === 'gaussian' ? (p => gm + gs * probit(p)) : (p => quantile(r, p));
      const cent = []; for (let p = 1; p <= 99; p++) cent.push(Q(p / 100));
      return { lo: Q(qlo), hi: Q(qhi), cent, r, gm, gs };
    };
    const G = mk(resid); let tab = null, cph = null;
    if (ph && ph.T >= 2 && ph.rph.length === resid.length) {
      const groups = Array.from({ length: ph.T }, () => []); for (let k = 0; k < resid.length; k++) groups[ph.rph[k]].push(resid[k]);
      tab = groups.map(g => (g.length >= 20 ? mk(g) : G)); cph = ph.tph;
    }
    const at = i => (tab ? tab[cph[i]] : G), sc = scale || pred.map(() => 1);
    return { lo: pred.map((v, i) => clip(v + at(i).lo * sc[i])), hi: pred.map((v, i) => clip(v + at(i).hi * sc[i])),
      cq: (i, k) => clip(pred[i] + at(i).cent[k] * sc[i]), cent: tab ? tab.map(t => t.cent) : G.cent, cph, sc, rlo: G.lo, rhi: G.hi,
      offsets: tab ? tab.map(({ lo, hi }) => ({ lo, hi })) : { lo: G.lo, hi: G.hi },
      pitSpan: (y, i) => {
        const { r, gm, gs } = at(i), shift = pred[i], factor = sc[i];
        const point = v => y === v ? [0, 1] : y < v ? [0, 0] : [1, 1];
        const zeroClip = clip(-1) === 0;
        if (zeroClip && y < 0) return [0, 0];
        if (factor === 0) return point(clip(shift));
        if (kind === 'gaussian') {
          const center = shift + gm * factor, sigma = gs * factor;
          if (!sigma) return point(clip(center));
          const u = normalCdf((y - center) / sigma);
          return [zeroClip && y === 0 ? 0 : u, u];
        }
        // Invert the linearly interpolated empirical quantile including both sample endpoints.
        // Outside the empirical support, the CDF is exactly 0 or 1.
        const q = j => shift + r[j] * factor, n = r.length;
        if (q(0) === q(n - 1)) return point(clip(q(0)));
        const bound = inclusive => {
          let a = 0, b = n;
          while (a < b) {
            const m = (a + b) >> 1, v = q(m);
            if (v < y || (inclusive && v === y)) a = m + 1; else b = m;
          }
          return a;
        };
        const lower = bound(false), upper = bound(true);
        if (lower !== upper) return [zeroClip && y === 0 ? 0 : lower / (n - 1), (upper - 1) / (n - 1)];
        let u;
        if (lower === 0) u = 0;
        else if (lower === n) u = 1;
        else u = (lower - 1 + (y - q(lower - 1)) / (q(lower) - q(lower - 1))) / (n - 1);
        return [zeroClip && y === 0 ? 0 : u, u];
      } };
  }
  /* ---------- solar series: sun elevation and night mask (option cfg.solar) ----------
     Sun position: U.S. Naval Observatory, Astronomical Applications Department, "Approximate Solar Coordinates"
     (about 1 arcminute from 1950 to 2050). D = JD - 2451545.0 (UT); g = 357.529 + 0.98560028 D; q = 280.459 + 0.98564736 D;
     L = q + 1.915 sin g + 0.020 sin 2g; e = 23.439 - 0.00000036 D; RA = atan2(cos e sin L, cos L); dec = asin(sin e sin L);
     GMST = 18.697374558 + 24.06570982441908 D (hours); hour angle = 15 GMST + longitude (east +) - RA;
     elevation = asin(sin lat sin dec + cos lat cos dec cos(hour angle)). Geometric elevation, no refraction. */
  function sunElevation(ms, lat, lon) {
    const rad = Math.PI / 180, D = ms / 86400000 + 2440587.5 - 2451545.0;
    const g = (357.529 + 0.98560028 * D) * rad, q = 280.459 + 0.98564736 * D;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * D) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const gmst = (18.697374558 + 24.06570982441908 * D) % 24, H = gmst * 15 * rad + lon * rad - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(H)) / rad;
  }
  E.sunElevation = sunElevation;
  /* Not used by the page (endogenous rule, see E.run). Kept, checked against pvlib SPA (0.006 deg), for prospective use
     with time-stamped data (local kit), where the observation is not known in advance.
     For each value j of the series (learning then forecast): its averaging interval [a, b] from the time stamp of the
     first learning value (UTC), the step and the stamp convention ('start', 'centre' or 'end' of the interval).
     night[j] = 1 when the sun is below the horizon at a, at the centre and at b (tool rule): known in advance, from
     astronomy only, so forecasts set to 0 there stay causal and the rule works in prospective use.
     day[j] = 1 when the elevation at the centre exceeds dayMin (degrees, 5 by default): the hours scored with "daytime". */
  function solarMask(sol, N) {
    const t0 = Date.parse(sol.start), step = sol.stepMin * 60000;
    if (!isFinite(t0)) throw new Error('Solar series: the start time is not a date (use ISO 8601, for instance 2023-09-01T00:00Z)');
    if (!(Math.abs(sol.lat) <= 90) || !(Math.abs(sol.lon) <= 180)) throw new Error('Solar series: latitude must be within ±90° and longitude within ±180°');
    const off = sol.stamp === 'end' ? -step : sol.stamp === 'centre' ? -step / 2 : 0, dmin = sol.dayMin ?? 5;
    const night = new Uint8Array(N), day = new Uint8Array(N), elev = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const a = t0 + j * step + off, ea = sunElevation(a, sol.lat, sol.lon), ec = sunElevation(a + step / 2, sol.lat, sol.lon), eb = sunElevation(a + step, sol.lat, sol.lon);
      elev[j] = ec; night[j] = ea < 0 && ec < 0 && eb < 0 ? 1 : 0; day[j] = ec > dmin ? 1 : 0;
    }
    return { night, day, elev };
  }
  E.solarMask = solarMask;

  // Normal CDF via inversion of the same Acklam quantile used to construct the bands.
  function normalCdf(z) {
    if (z === 0) return 0.5;
    let lo = 0, hi = 0.5;
    for (let k = 0; k < 52; k++) {
      const p = (lo + hi) / 2;
      if (probit(p) < -Math.abs(z)) lo = p; else hi = p;
    }
    const p = (lo + hi) / 2;
    return z < 0 ? p : 1 - p;
  }

  // Czado, Gneiting and Held (2009): distribute mass uniformly across [F(y-), F(y)].
  const pitSpan = (y, bd, i) => bd.pitSpan(y, i);
  const Gof = (sp, u) => sp[0] === sp[1] ? +(u >= sp[0]) : Math.min(1, Math.max(0, (u - sp[0]) / (sp[1] - sp[0])));

  /* QQ data: residual quantiles against the normal law; calibration = observed share below each forecast centile
     (non-randomised PIT for ties, see pitSpan) */
  function qq(y, p, bd, resid) {
    const r = Float64Array.from(resid).sort(), m = mean(r), s = sd1(r) || 1, normal = [];
    for (let k = 1; k <= 99; k += 2) normal.push([probit(k / 100), (quantile(r, k / 100) - m) / s]);
    const calib = [];
    if (!y.length) return { normal, calib, pit: [] };
    const spans = y.map((v, i) => pitSpan(v, bd, i));
    for (let k = 4; k < 99; k += 5) { let below = 0; for (let i = 0; i < y.length; i++) below += Gof(spans[i], (k + 1) / 100); calib.push([(k + 1) / 100, below / y.length]); }
    // PIT: position of each observation in its forecast distribution (99 centiles), histogram in 10 bins
    const pit = new Array(10).fill(0);
    for (let i = 0; i < y.length; i++) for (let j = 0; j < 10; j++) pit[j] += Gof(spans[i], (j + 1) / 10) - (j ? Gof(spans[i], j / 10) : 0);
    return { normal, calib, pit: pit.map(v => v / y.length) };
  }
  function normalizer(values, norm) {
    if (norm === 'none') return { value: 1, method: 'none' };
    if (!values.length) return { value: NaN, method: norm, note: 'No eligible observations.' };
    if (norm === 'mean') {
      const avg = mean(values);
      let amplitude = 0;
      for (const v of values) amplitude = Math.max(amplitude, Math.abs(v));
      if (avg > 0 && avg >= 1e-9 * amplitude) return { value: avg, method: 'mean' };
    }
    const sd = sd1(values);
    if (!(sd > 0) || !Number.isFinite(sd)) return { value: NaN, method: 'sd', note: 'Normalization unavailable: standard deviation is zero or undefined.' };
    return { value: sd, method: 'sd', note: norm === 'mean' ? 'Normalized by standard deviation because the mean is nonpositive or close to zero.' : undefined };
  }

  /* every metric, deterministic and probabilistic; the page shows those the user ticks */
  function scores(y, p, pers, bd, norm, qlo, qhi) {
    const n = y.length, L = (a, k) => { let s = 0; for (let i = 0; i < n; i++) s += Math.abs(y[i] - a[i]) ** k; return (s / n) ** (1 / k); };
    const rmse = L(p, 2), mae = L(p, 1), my = mean(y);
    const normal = normalizer(y, norm), den = normal.value;
    const ref = L(pers, 2);
    const n1 = ref > 0 ? mae / L(pers, 1) : NaN;
    const n2 = ref > 0 ? rmse / ref : NaN;
    const n3 = ref > 0 ? L(p, 3) / L(pers, 3) : NaN;
    const notes = {};
    if (!n) notes.sample = 'No positive observed targets in the aligned test window.';
    else {
      if (normal.note) notes.normalization = normal.note;
      if (ref === 0) notes.nice = 'NICE unavailable: the persistence error is zero.';
    }
    let mbe = 0, sse = 0, sst = 0, maxae = n ? 0 : NaN, spp = 0, syp = 0; const mp = mean(p);
    for (let i = 0; i < n; i++) { const e = p[i] - y[i]; mbe += e; sse += e * e; sst += (y[i] - my) ** 2; maxae = Math.max(maxae, Math.abs(e)); syp += (y[i] - my) * (p[i] - mp); spp += (p[i] - mp) ** 2; }
    mbe /= n;
    let inside = 0, width = 0, crps = 0, wink = 0;
    for (let i = 0; i < n; i++) {
      const lo = bd.lo[i], hi = bd.hi[i];
      if (lo <= y[i] && y[i] <= hi) inside++;
      width += hi - lo;
      // interval score (Winkler; Gneiting & Raftery 2007), with separate lower and upper levels
      wink += (hi - lo) + (y[i] < lo ? (lo - y[i]) / qlo : 0) + (y[i] > hi ? (y[i] - hi) / (1 - qhi) : 0);
      let s = 0; // CRPS from the 99 centiles: 2 x mean pinball loss
      for (let k = 0; k < 99; k++) { const q = bd.cq(i, k), u = y[i] - q, tau = (k + 1) / 100; s += u * (tau - (u < 0 ? 1 : 0)); }
      crps += 2 * s / 99;
    }
    const mil = width / n, picp = inside / n;
    return { rmse, nrmse: rmse / den, mae, nmae: mae / den, mbe, nmbe: mbe / den, maxae, r2: sst > 0 ? 1 - sse / sst : NaN, r: n ? syp / Math.sqrt(sst * spp || 1) : NaN,
      nice1: n1, nice2: n2, nice3: n3, niceS: (n1 + n2 + n3) / 3,
      picp, ace: picp - (qhi - qlo), mil, nmil: mil / den, wink: wink / n, crps: crps / n, ncrps: crps / n / den,
      target: qhi - qlo, n, normalization: { method: normal.method, denominator: den }, notes };
  }

  /* ---------- public entry: run the chosen models on every horizon ----------
     job: {train, test, cfg, models:[ids]} ; hooks: {progress(frac, text), stop()} */
  E.run = function (job, hooks) {
    hooks = hooks || {};
    const cfg = job.cfg;
    const Sorig = Float64Array.from(job.train.concat(job.test));
    const ctx = preparedContext(Sorig, job.train.length, cfg);
    const { center: m0, scale: s0, origNonneg, clip: clipO } = ctx;
    cfg.lbOpts = cfg.lbOpts || E.inputOptions(cfg.T);
    const clip = (cfg.clip !== false && ctx.nonneg) ? (v => (v < 0 ? 0 : v)) : (v => v);
    const out = { horizons: [], skipped: [], nonneg: origNonneg, prep: { mean: m0, sd: s0 } };
    let sol = null;
    if (cfg.solar) {
      if (!origNonneg || job.test.some(v => v < 0)) throw new Error('Solar series: learning and test values must be nonnegative before centring or scaling. Correct the source data or untick Solar series.');
      sol = { scoreOn: cfg.solar.scoreOn || 'day', cvOn: cfg.solar.cvOn || 'all' };
      const z = job.train.filter(v => v === 0).length;
      // Author's rule (2026-11-13): where the observed target is 0 (night), the forecast, its limits
      // and its centiles are written as 0. NOT causal (uses the observation): a retrospective view. In prospective use the
      // night filtering is the user's job (sun position, outside the tool). Daytime scores (observed > 0) do not depend on it.
      out.solar = { rule: 'observed zero → forecast 0 (not causal, retrospective; night filtering is the user’s job in prospective use)', scoreOn: sol.scoreOn, cvOn: sol.cvOn, zeroShareLearn: z / job.train.length };
    }
    // which models can run on this series
    const ids = [];
    for (const id of job.models) {
      const m = M[id];
      if (!m) { out.skipped.push({ id, why: 'unknown model' }); continue; }
      if (m.needs && cfg.T >= 2) { const why = m.needs(job, cfg); if (why) { out.skipped.push({ id, name: m.name, why }); continue; } }
      if (m.needsCycle && cfg.T < 2) { out.skipped.push({ id, name: m.name, why: 'needs a period, and the series was declared non-periodic (or with fewer than 2 steps per period)' }); continue; }
      if (m.needsPositive && !ctx.S.subarray(0, ctx.Ntr).every(v => v > 0)) { out.skipped.push({ id, name: m.name, why: 'needs strictly positive values' }); continue; }
      if (m.needsNonneg && !ctx.nonneg) { out.skipped.push({ id, name: m.name, why: 'needs values ≥ 0 (its transform takes the logarithm of y + c)' + (m0 !== 0 ? '; use the series as it is, not centred' : '') }); continue; }
      if (m.needsCycle && job.train.length < 3 * cfg.T) { out.skipped.push({ id, name: m.name, why: 'needs at least three periods in the learning series' }); continue; }
      ids.push(id);
    }
    // amount of work, for the progress bar
    const unit = id => { const m = M[id]; if (m.isELMv) { const n = (cfg.opt.inputs ? cfg.lbOpts.length : 1) * ((cfg.opt.inputs || cfg.opt.neurons) ? cfg.ncand : cfg.ncandFixed); return n * m.grid.length * Math.max(...(cfg.opt.neurons ? cfg.nhOpts : [cfg.nhFixed])) / 50; } if (m.isELM) { const n = (cfg.opt.inputs ? cfg.lbOpts.length : 1) * ((cfg.opt.inputs || cfg.opt.neurons) ? cfg.ncand : cfg.ncandFixed); return n * Math.max(...(cfg.opt.neurons ? cfg.nhOpts : [cfg.nhFixed])) / 50; } if (m.usesInputs) return cfg.opt.inputs ? cfg.lbOpts.length : 1; return 0.2; };
    const total = cfg.horizons.length * ids.reduce((s, id) => s + unit(id), 0) || 1; let done = 0;
    for (const h of cfg.horizons) {
      const smp = E.samples(ctx, h);
      if (smp.tr.length < 50) throw new Error(`Horizon ${h}: only ${smp.tr.length} learning samples once the input windows are set aside; paste a longer learning series (at least ${3 * Math.max(...cfg.lbOpts) + h + 50} values).`);
      if (!smp.te.length && !hooks.capture) throw new Error(`Horizon ${h}: the forecast series is too short to score anything at this horizon.`);
      smp.folds = E.purgedFolds(smp.tr, h, cfg.folds).map(({ a, b, fitEnd }) => {
        const fitTs = smp.tr.slice(0, fitEnd);
        const context = preparedContext(Sorig, fitTs[fitEnd - 1] + h + 1, cfg);
        // One common unit for CV comparison and interval calibration, even with per-fold preparation.
        const errorAt = (t, prediction) => (Sorig[t + h] - context.toOriginal(prediction)) / s0;
        return { a, b, fitEnd, fitTs, context, errorAt };
      });
      if (!smp.folds.length) throw new Error(`Horizon ${h}: not enough learning samples for purged cross-validation; paste a longer learning series.`);
      // solar series, cvOn 'day': validation RMSE (choice of the settings) on observed learning targets > 0 only;
      // causal, the learning targets are known when the settings are chosen; residuals for the intervals keep every target
      smp.cvKeep = sol && sol.cvOn === 'day' ? Uint8Array.from(smp.tr, t => (Sorig[t + h] > 0 ? 1 : 0)) : null;
      const y = smp.te.map(t => Sorig[t + h]), pers = smp.te.map(t => Sorig[t]);
      const requested = sol ? sol.cvOn : 'all';
      const eligible = smp.folds.map(({ a, b }) => {
        if (!smp.cvKeep) return b - a;
        let count = 0;
        for (let i = a; i < b; i++) count += smp.cvKeep[i];
        return count;
      });
      const fallback = requested === 'day' && !eligible.some(Boolean);
      if (fallback) smp.cvKeep = null;
      const folds = smp.folds.map(({ a, b }, i) => ({ total: b - a, eligible: eligible[i], n: fallback ? b - a : eligible[i] }));
      const cvNormal = normalizer(smp.cvKeep ? job.train.filter(v => v > 0) : job.train, cfg.norm);
      const cvValidation = { requested, effective: fallback ? 'all' : requested, folds, used: folds.filter(f => f.n).length,
        warning: fallback ? 'No validation targets above zero. Settings were chosen using all validation targets.' : undefined,
        normalization: { method: cvNormal.method, denominator: cvNormal.value }, normalizationNote: cvNormal.note };
      const H = { h, t: smp.te.map(t => t + h - ctx.Ntr), y, models: {}, cvValidation };
      const pick = sol && sol.scoreOn === 'day' ? y.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0) : null;
      const sub = a => pick ? pick.map(i => a[i]) : a;
      const selectBand = bd => pick ? {
        lo: sub(bd.lo), hi: sub(bd.hi), cq: (j, k) => bd.cq(pick[j], k),
        pitSpan: (v, j) => bd.pitSpan(v, pick[j]),
      } : bd;
      const night = sol ? Uint8Array.from(y, v => (v === 0 ? 1 : 0)) : null;
      // the persistence reference follows the same rule, so that NICE compares like with like on every hour
      const persAll = night ? pers.map((v, i) => (night[i] ? 0 : v)) : pers;
      const sy = sub(y), sp = sub(persAll);
      for (const id of ids) {
        const m = M[id], u = unit(id), nIt = (cfg.opt.inputs ? cfg.lbOpts.length : 1) * ((cfg.opt.inputs || cfg.opt.neurons) ? cfg.ncand : cfg.ncandFixed);
        const step = (m.isELM || m.isELMv) ? u / nIt : m.usesInputs ? 1 : u;
        const tick = () => { done += step; hooks.progress && hooks.progress(Math.min(1, done / total), `${m.name}, horizon ${h}`); };
        let r;
        if (m.isELMv || m.isELM) r = runELM(ctx, m, h, smp, clip, tick, hooks.stop);
        else if (m.usesInputs) r = runAR(ctx, m, h, smp, clip, tick);
        else { r = runSimple(ctx, m, h, smp, clip); tick(); }
        // back to the units of the series (residuals scaled by s0; scaled residuals of complex AR stay unitless, their scale is mapped)
        r.pred = r.pred.map(ctx.toOriginal);
        if (r.scale) r.scale = r.scale.map(v => v * s0); else r.resid = r.resid.map(v => v * s0);
        let ph = null;
        if (cfg.bandPhase && cfg.T >= 2) { // phase of the target of each out-of-fold residual (same folds and order in every run* routine)
          const rph = []; for (const { a, b } of smp.folds) for (let i = a; i < b; i++) rph.push((smp.tr[i] + h) % cfg.T);
          ph = { T: cfg.T, rph, tph: smp.te.map(t => (t + h) % cfg.T) };
        }
        const bd0 = band(r.pred, r.resid, cfg.qlo, cfg.qhi, clipO, cfg.bandKind, r.scale, ph);
        if (hooks.capture) hooks.capture({ id, h, ctx, smp, r, bd: bd0 });
        // solar rule (S1): observed 0 → forecast, limits and centiles 0; the forecast distribution there is a point mass at 0
        const bd = night ? Object.assign({}, bd0, { lo: bd0.lo.map((v, i) => (night[i] ? 0 : v)), hi: bd0.hi.map((v, i) => (night[i] ? 0 : v)),
          cq: (i, k) => (night[i] ? 0 : bd0.cq(i, k)), pitSpan: (v, i) => (night[i] ? (v === 0 ? [0, 1] : v < 0 ? [0, 0] : [1, 1]) : bd0.pitSpan(v, i)) }) : bd0;
        if (night) r.pred = r.pred.map((v, i) => (night[i] ? 0 : v));
        const sbd = selectBand(bd);
        H.models[id] = { pred: r.pred, lo: bd.lo, hi: bd.hi, chosen: r.chosen || {}, nparams: r.nparams || 0, cv: r.cv,
          tried: (r.tried || []).map(o => Object.assign({}, o, { cvRmse: o.cv * s0 })), cvDen: cvNormal.value, cvFolds: r.cvFolds,
          cvRmse: r.cv * s0, score: scores(sy, sub(r.pred), sp, sbd, cfg.norm, cfg.qlo, cfg.qhi), resid: { lo: bd.rlo, hi: bd.rhi, n: r.resid.length },
          scoreAll: pick ? scores(y, r.pred, persAll, bd, cfg.norm, cfg.qlo, cfg.qhi) : undefined, night: night ? night.reduce((a, b) => a + b, 0) : 0,
          qq: qq(sy, sub(r.pred), sbd, r.resid), cent: bd.cent, cph: bd.cph, low0: clipO(-1) === 0, sc: r.scale ? bd.sc : null };
      }
      H.persistence = scores(sy, sp, sp, band(sp, [0], cfg.qlo, cfg.qhi, v => v), cfg.norm, cfg.qlo, cfg.qhi);
      out.horizons.push(H);
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = E; else root.PredEngine = E;
})(typeof self !== 'undefined' ? self : this);
