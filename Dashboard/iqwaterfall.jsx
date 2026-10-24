// iqwaterfall.jsx — Continuous I/Q waterfall + raw complex FFT capture
//
// Two independent features, both new on the maia-httpd side (see
// maia-sdr PR #12): a continuous low-rate complex (I/Q) channel at
// /iq-waterfall (same cadence as the existing magnitude /waterfall feed
// pages1.jsx/radioastro.jsx/classifier.jsx already consume, but a
// *different* wire format -- raw interleaved 16-bit I/Q per bin, not
// the fp-encoded Float32Array /waterfall uses), and a one-shot "raw
// capture" burst triggered over a small REST API (first fetch()-based
// request/response pattern in this Dashboard -- everything else is
// MQTT publish or a separate raw WebSocket for bulk I/Q, e.g. IQTape).
//
// The bins are FFT output, so each bin is a frequency. They are shown in
// fftshift order (DC in the middle), spanning rxSampling around rxFreq.
//
// Views of the same complex frame, selected with a toggle:
//   - amplitude over phase, stacked
//   - real and imaginary parts over frequency
//   - Smith chart: the complex bins traced in frequency order, normalized
//     to the frame peak (a normalized reflection-coefficient plane; this is
//     not an impedance measurement unless the bins are one)
// Amplitude is either relative to the frame peak (dB) or absolute (dBm),
// where dBm = 20*log10(counts) + calibration offset. The offset must come
// from a calibration; without one the absolute scale is in dB re 1 count.

const { useState: useSIq, useEffect: useEIq, useRef: useRIq } = React;

const IQ_VIEWS = [
  { id: 'amp-phase', label: 'Amplitude / Phase' },
  { id: 'reim', label: 'Real / Imag' },
  { id: 'smith', label: 'Smith' },
];

// Bins below this (dB relative to the frame peak) have meaningless phase,
// so the phase trace is skipped there.
const IQ_PHASE_MASK_DB = -40;
const IQ_AMP_FLOOR_DB = -80;

// Left gutter for y-axis tick labels and units; the plot area starts after it.
const IQ_GUTTER = 58;
const IQ_BOTTOM = 18; // room for the frequency labels along the bottom edge
const IQ_LABEL = '#c0cad8';

function iqFmtMHz(hz) {
  return (hz / 1e6).toFixed(3) + ' MHz';
}

// Frequency ticks along the bottom edge, in MHz, with the axis unit.
function iqDrawFreqAxis(ctx, w, h, axis) {
  if (!axis || !(axis.spanHz > 0)) return;
  const x0 = IQ_GUTTER, x1 = w - 6;
  ctx.font = '12px sans-serif';
  ctx.fillStyle = IQ_LABEL;
  ctx.strokeStyle = '#3a4656';
  ctx.lineWidth = 1;
  const f0 = axis.centerHz - axis.spanHz / 2;
  for (let k = 0; k <= 4; k++) {
    const frac = k / 4;
    const x = x0 + frac * (x1 - x0);
    const f = f0 + frac * axis.spanHz;
    ctx.beginPath();
    ctx.moveTo(x, h - IQ_BOTTOM); ctx.lineTo(x, h - IQ_BOTTOM + 4);
    ctx.stroke();
    const text = (f / 1e6).toFixed(3);
    const tw = ctx.measureText(text).width;
    const tx = k === 0 ? x : k === 4 ? x - tw : x - tw / 2;
    ctx.fillText(text, tx, h - 4);
  }
  ctx.fillStyle = IQ_LABEL;
  ctx.fillText('frequency, MHz', w - 110, h - 4 - 14);
}

// Smallest 1-2-5 value at or above x, for tidy axis limits.
function iqNiceCeil(x) {
  if (!(x > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

// dB value of each bin, either relative to the frame peak or absolute (dBm).
function iqBinDb(mag, ref, axis) {
  if (axis && axis.absolute) return 20 * Math.log10(mag + 1e-12) + axis.offsetDb;
  return 20 * Math.log10(mag / ref + 1e-12);
}

// Y ticks: a list of {value, label} placed between y0 (top) and y1 (bottom).
function iqDrawYTicks(ctx, ticks, x0, y0, y1, toY) {
  ctx.font = '12px sans-serif';
  ctx.strokeStyle = '#3a4656';
  ctx.lineWidth = 1;
  for (const t of ticks) {
    const y = toY(t.value);
    if (y < y0 - 1 || y > y1 + 1) continue;
    ctx.beginPath();
    ctx.moveTo(x0 - 4, y); ctx.lineTo(x0, y);
    ctx.stroke();
    ctx.fillStyle = IQ_LABEL;
    ctx.textAlign = 'right';
    ctx.fillText(t.label, x0 - 6, y + 4);
    ctx.textAlign = 'left';
  }
}

function iqDrawAmpPhase(ctx, w, h, data, axis) {
  const { re, im, n, mags, ref } = data;
  const x0 = IQ_GUTTER, x1 = w - 6;
  const plotH = h - IQ_BOTTOM;
  const half = plotH / 2;
  const topY0 = 12, topY1 = half - 12;
  const botY0 = half + 12, botY1 = plotH - 6;
  const xOf = (i) => x0 + (i / (n - 1)) * (x1 - x0);

  // dB scale for the amplitude trace. Relative mode runs down to the floor;
  // absolute mode uses a 90 dB window ending at the frame peak in dBm.
  const peakDb = axis && axis.absolute ? iqBinDb(ref, ref, axis) : 0;
  const floorDb = axis && axis.absolute ? peakDb - 90 : IQ_AMP_FLOOR_DB;
  const dbSpan = peakDb - floorDb;
  const dbToY = (db) => {
    const frac = Math.min(1, Math.max(0, (db - floorDb) / dbSpan));
    return topY0 + (1 - frac) * (topY1 - topY0);
  };
  // dB ticks every 20 dB; a tick is dropped if it would sit on the midline label.
  const ampTicks = [];
  for (let db = Math.ceil(floorDb / 20) * 20; db <= peakDb; db += 20) {
    if (Math.abs(dbToY(db) - topY1) < 9) continue;
    ampTicks.push({ value: db, label: `${db}` });
  }
  iqDrawYTicks(ctx, ampTicks, x0, topY0, topY1, dbToY);

  // Amplitude (top half).
  ctx.strokeStyle = '#5BB1F5';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xOf(i);
    const y = dbToY(iqBinDb(mags[i], ref, axis));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Phase (bottom half), wrapped to [-pi, pi], masked where amplitude is low.
  const phaseToY = (p) => botY0 + (0.5 - p / (2 * Math.PI)) * (botY1 - botY0);
  iqDrawYTicks(ctx, [
    { value: Math.PI, label: '+π' },
    { value: 0, label: '0' },
    { value: -Math.PI, label: '-π' },
  ], x0, botY0, botY1, phaseToY);
  ctx.strokeStyle = '#f5a25b';
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i < n; i++) {
    if (iqBinDb(mags[i], ref, axis) < (axis && axis.absolute ? peakDb - 40 : IQ_PHASE_MASK_DB)) { pen = false; continue; }
    const x = xOf(i);
    const phase = Math.atan2(im[i], re[i]);
    const y = phaseToY(phase);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = '#2a3441';
  ctx.beginPath();
  ctx.moveTo(x0, half); ctx.lineTo(x1, half);
  ctx.stroke();

  // Unit labels in the gutter, above each half.
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#5BB1F5';
  ctx.textAlign = 'left';
  ctx.fillText(axis && axis.absolute ? 'dBm' : 'dB', 4, topY0 + 12);
  ctx.fillStyle = '#f5a25b';
  ctx.fillText('rad', 4, botY0 + 12);
  if (axis && axis.absolute) {
    ctx.fillStyle = IQ_LABEL;
    ctx.fillText(`cal ${axis.offsetDb >= 0 ? '+' : ''}${axis.offsetDb} dB`, 4, half - 6);
  }
  iqDrawFreqAxis(ctx, w, h, axis);
}

function iqDrawReIm(ctx, w, h, data, axis) {
  const { re, im, n, ref } = data;
  const x0 = IQ_GUTTER, x1 = w - 6;
  const plotH = h - IQ_BOTTOM;
  const half = plotH / 2;
  // Round the scale up to a 1-2-5 value so the ticks read cleanly.
  const ymax = iqNiceCeil(ref);
  const yOf = (v) => half - (v / ymax) * (half - 8);
  const xOf = (i) => x0 + (i / (n - 1)) * (x1 - x0);
  const traces = [
    { vals: re, color: '#5BB1F5', name: 'real (I)' },
    { vals: im, color: '#f5a25b', name: 'imag (Q)' },
  ];
  for (const t of traces) {
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xOf(i);
      const y = yOf(t.vals[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Y ticks in counts, symmetric about zero, at the frame peak and half of it.
  const fmt = (v) => (v === 0 ? '0' : v.toLocaleString('en-US', { maximumFractionDigits: 0 }));
  const countTicks = [
    { value: ymax, label: fmt(ymax) },
    { value: ymax / 2, label: fmt(ymax / 2) },
    { value: 0, label: '0' },
    { value: -ymax / 2, label: fmt(-ymax / 2) },
    { value: -ymax, label: fmt(-ymax) },
  ];
  iqDrawYTicks(ctx, countTicks, x0, 8, plotH - 8, yOf);
  ctx.strokeStyle = '#2a3441';
  ctx.beginPath();
  ctx.moveTo(x0, half); ctx.lineTo(x1, half);
  ctx.stroke();

  // Legend in the top-right corner of the plot; unit shown in the gutter.
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = traces[1].color; ctx.fillText('Q  imag', x1 - 6, 16);
  ctx.fillStyle = traces[0].color; ctx.fillText('I  real', x1 - 64, 16);
  ctx.textAlign = 'left';
  ctx.fillStyle = IQ_LABEL; ctx.fillText('counts', 4, 32);
  iqDrawFreqAxis(ctx, w, h, axis);
}

function iqDrawSmith(ctx, w, h, data, axis) {
  const { re, im, n, ref } = data;
  // Leave a footer band for the note and the frequency colour bar.
  const plotH = h - 52;
  const cx = w / 2, cy = plotH / 2 + 10;
  const R = Math.min(w - 140, plotH) / 2 - 14;
  const toX = (gr) => cx + gr * R;
  const toY = (gi) => cy - gi * R;

  // Clip the grid to the unit circle.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.clip();

  ctx.strokeStyle = '#2a3441';
  ctx.lineWidth = 1;
  // Constant-resistance circles: centre (r/(r+1), 0), radius 1/(r+1).
  for (const r of [0.2, 0.5, 1, 2, 5]) {
    ctx.beginPath();
    ctx.arc(toX(r / (r + 1)), toY(0), R / (r + 1), 0, 2 * Math.PI);
    ctx.stroke();
  }
  // Constant-reactance arcs: centre (1, 1/x), radius 1/|x|.
  for (const x of [0.2, 0.5, 1, 2, 5]) {
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.arc(toX(1), toY(s / x), R / x, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Unit circle and real axis.
  ctx.strokeStyle = '#4a5666';
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
  ctx.stroke();

  // The complex value of each bin, in frequency order, traced as one path:
  // the tip of the phasor sweeps across frequency, so a delay appears as a
  // spiral. Colour runs from the lowest to the highest frequency.
  ctx.lineWidth = 1.2;
  for (let i = 1; i < n; i++) {
    ctx.strokeStyle = `hsl(${200 - (160 * i) / n}, 70%, 60%)`;
    ctx.beginPath();
    ctx.moveTo(toX(re[i - 1] / ref), toY(im[i - 1] / ref));
    ctx.lineTo(toX(re[i] / ref), toY(im[i] / ref));
    ctx.stroke();
  }

  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#8a97a8';
  // Axes are the real and imaginary parts of the normalized value, not
  // frequency. Frequency is shown as the trace colour, with a colour bar.
  // Axis names sit outside the unit circle, at the ends of the real axis and
  // above the imaginary axis.
  ctx.font = '12px sans-serif';
  ctx.fillStyle = IQ_LABEL;
  ctx.textAlign = 'left';
  ctx.fillText('Re Γ', cx + R + 6, cy + 4);
  ctx.textAlign = 'center';
  ctx.fillText('Im Γ', cx, cy - R - 6);
  ctx.textAlign = 'left';

  // Footer band: the note, then the frequency colour bar with its end labels.
  ctx.font = '11px sans-serif';
  ctx.fillStyle = '#8a97a8';
  ctx.fillText('normalized to frame peak (|Γ| ≤ 1); not an impedance measurement', 8, h - 44);
  if (axis && axis.spanHz > 0) {
    const f0 = axis.centerHz - axis.spanHz / 2;
    const barX0 = 150, barX1 = w - 150, barY = h - 18, barH = 8;
    const grad = ctx.createLinearGradient(barX0, 0, barX1, 0);
    grad.addColorStop(0, 'hsl(200, 70%, 60%)');
    grad.addColorStop(1, 'hsl(40, 70%, 60%)');
    ctx.fillStyle = grad;
    ctx.fillRect(barX0, barY, barX1 - barX0, barH);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = IQ_LABEL;
    ctx.textAlign = 'right';
    ctx.fillText(iqFmtMHz(f0), barX0 - 8, barY + barH);
    ctx.textAlign = 'left';
    ctx.fillText(iqFmtMHz(f0 + axis.spanHz), barX1 + 8, barY + barH);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8a97a8';
    ctx.fillText('frequency (trace colour)', (barX0 + barX1) / 2, barY - 6);
    ctx.textAlign = 'left';
  }
}

function iqDraw(ctx, w, h, data, view, axis) {
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);
  if (!data || data.n === 0) return;
  if (view === 'reim') iqDrawReIm(ctx, w, h, data, axis);
  else if (view === 'smith') iqDrawSmith(ctx, w, h, data, axis);
  else iqDrawAmpPhase(ctx, w, h, data, axis);
}

function IqWaterfallPage({ d }) {
  const canvasRef = useRIq(null);
  const rafRef = useRIq(0);
  const wsRef = useRIq(null);
  const dataRef = useRIq(null);
  const viewRef = useRIq('amp-phase');
  const axisRef = useRIq(null);
  const dirtyRef = useRIq(false);
  const [view, setView] = useSIq('amp-phase');
  const [absolute, setAbsolute] = useSIq(false);
  const [calOffset, setCalOffset] = useSIq('0');
  const [wsState, setWsState] = useSIq('connecting');
  const [captureState, setCaptureState] = useSIq('idle'); // idle | capturing | error
  const [captureError, setCaptureError] = useSIq(null);

  // Frequency axis: the bins span the RX sample rate around the RX frequency.
  // Assumes the spectrometer runs at the RX sample rate; verify on hardware.
  const centerHz = d && d.rxFreq != null ? d.rxFreq : null;
  const spanHz = d && d.rxSampling != null ? d.rxSampling : null;

  // Switching views or units only needs a redraw of the frame we already have.
  useEIq(() => {
    viewRef.current = view;
    dirtyRef.current = true;
  }, [view]);

  useEIq(() => {
    const off = parseFloat(calOffset);
    axisRef.current = {
      centerHz,
      spanHz,
      absolute,
      offsetDb: isFinite(off) ? off : 0,
    };
    dirtyRef.current = true;
  }, [centerHz, spanHz, absolute, calOffset]);

  // WebSocket connection to the continuous I/Q waterfall channel.
  useEIq(() => {
    let destroyed = false;
    const host = window._tezukaDevHost || window.location.hostname;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(`${proto}//${host}/iq-waterfall`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      setWsState('connecting');

      ws.onopen = () => setWsState('connected');
      ws.onclose = () => {
        setWsState('disconnected');
        if (!destroyed) setTimeout(connect, 2000);
      };
      ws.onerror = () => {};

      ws.onmessage = (evt) => {
        if (!(evt.data instanceof ArrayBuffer)) return;
        // Wire format: one 32-bit little-endian word per bin, Q (im) in
        // the low 16 bits, I (re) in the high 16 bits -- see
        // Spectrometer.elaborate()'s iq_write_data in maia-hdl. This is
        // NOT the same encoding /waterfall uses.
        const view = new DataView(evt.data);
        const n = evt.data.byteLength >> 2;
        // The bins are FFT output, so index 0 is DC. Reorder them as fftshift
        // does (negative frequencies first, DC in the middle) so every view
        // runs monotonically in frequency; a delay then shows as a spiral.
        const re = new Float32Array(n);
        const im = new Float32Array(n);
        const mags = new Float32Array(n);
        let ref = 0;
        const half = n >> 1;
        for (let i = 0; i < n; i++) {
          const off = ((i + half) % n) * 4;
          const q = view.getInt16(off, true);
          const iq = view.getInt16(off + 2, true);
          re[i] = iq;
          im[i] = q;
          mags[i] = Math.hypot(iq, q);
          if (mags[i] > ref) ref = mags[i];
        }
        dataRef.current = { re, im, mags, n, ref: ref || 1 };
        dirtyRef.current = true;
      };
    }
    connect();
    return () => { destroyed = true; try { wsRef.current?.close(); } catch (_) {} };
  }, []);

  // Canvas render loop -- same ResizeObserver + rAF + dirty-flag pattern
  // as pages1.jsx's SpectrumPage.
  useEIq(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const syncSize = () => {
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        dirtyRef.current = true;
      }
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    let running = true;
    const frame = () => {
      if (!running) return;
      syncSize();
      if (dirtyRef.current && canvas.width > 0 && canvas.height > 0) {
        iqDraw(ctx, canvas.width, canvas.height, dataRef.current, viewRef.current, axisRef.current);
        dirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    return () => { running = false; cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, []);

  async function startRawCapture() {
    setCaptureState('capturing');
    setCaptureError(null);
    try {
      const patchResp = await fetch('/api/raw-capture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state_change: 'Start' }),
      });
      if (!patchResp.ok) throw new Error(`start failed: HTTP ${patchResp.status}`);

      // The capture is a small, fixed-size, fast single-shot burst (one
      // FFT frame). Poll briefly for completion rather than assuming a
      // fixed delay, but don't wait forever if something's wrong.
      let finished = false;
      for (let attempt = 0; attempt < 20 && !finished; attempt++) {
        await new Promise((r) => setTimeout(r, 100));
        const statusResp = await fetch('/api/raw-capture');
        if (!statusResp.ok) throw new Error(`status check failed: HTTP ${statusResp.status}`);
        const status = await statusResp.json();
        if (status.state === 'Stopped') finished = true;
      }
      if (!finished) throw new Error('capture did not finish in time');

      const dataResp = await fetch('/raw-capture');
      if (!dataResp.ok) throw new Error(`fetching capture failed: HTTP ${dataResp.status}`);
      const blob = await dataResp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raw-capture-${Date.now()}.iq16`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setCaptureState('idle');
    } catch (err) {
      setCaptureState('error');
      setCaptureError(String(err && err.message || err));
    }
  }

  return (
    <>
      <Card
        title="I/Q Waterfall"
        sub="Continuous complex spectrum, same cadence as the magnitude waterfall"
        right={<Pill tone={wsState === 'connected' ? 'ok' : 'warn'}>{wsState}</Pill>}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {IQ_VIEWS.map((v) => (
            <button
              key={v.id}
              className={'btn' + (view === v.id ? ' primary' : '')}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
          {view !== 'smith' && (
            <>
              <button
                className={'btn' + (absolute ? ' primary' : '')}
                onClick={() => setAbsolute(!absolute)}
              >
                {absolute ? 'Absolute (dBm)' : 'Relative (dB)'}
              </button>
              {absolute && (
                <label className="dim" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  cal offset (dB)
                  <input
                    type="number"
                    step="0.1"
                    value={calOffset}
                    onChange={(e) => setCalOffset(e.target.value)}
                    style={{ width: 80 }}
                  />
                </label>
              )}
            </>
          )}
        </div>
        <div style={{ position: 'relative', width: '100%', height: 320 }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 8 }} />
        </div>
        <p className="dim" style={{ marginTop: 8 }}>
          {centerHz != null && spanHz != null
            ? `Frequency axis: ${iqFmtMHz(centerHz - spanHz / 2)} to ${iqFmtMHz(centerHz + spanHz / 2)} (centre ${iqFmtMHz(centerHz)}, span = RX sample rate ${iqFmtMHz(spanHz)}). `
            : 'Frequency axis: waiting for the RX frequency and sample rate. '}
          {view === 'amp-phase' && (absolute
            ? 'Amplitude in dBm = 20·log10(counts) + calibration offset. The offset is not known without a calibration, so treat absolute values as dB re 1 count until one is entered.'
            : 'Amplitude in dB relative to the frame peak; phase is hidden where the amplitude is low.')}
          {view === 'reim' && 'Real (I) and imaginary (Q) parts per bin, in counts, scaled to the frame peak.'}
          {view === 'smith' && 'Complex bins traced in frequency order (DC in the middle), normalized to the frame peak. A delay shows as a spiral. Not an impedance measurement unless the bins are one.'}
        </p>
      </Card>

      <Card
        title="Raw Complex Capture"
        sub="Single-shot burst of raw I/Q bins, tapped before magnitude/phase are computed"
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn primary"
            disabled={captureState === 'capturing'}
            onClick={startRawCapture}
          >
            {captureState === 'capturing' ? 'Capturing…' : 'Start Capture & Download'}
          </button>
          {captureState === 'error' && <span style={{ color: 'var(--bad)' }}>{captureError}</span>}
        </div>
      </Card>
    </>
  );
}
