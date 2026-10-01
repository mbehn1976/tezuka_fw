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
// Minimal viable visualization on purpose: a live phase-per-bin trace,
// same canvas-2D style as the existing /waterfall consumers, rather
// than a full constellation/spectrogram -- the point right now is to
// prove the plumbing end to end on real hardware, not to ship a
// finished view.

const { useState: useSIq, useEffect: useEIq, useRef: useRIq } = React;

function iqDrawPhase(ctx, w, h, phases) {
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, w, h);
  if (!phases || phases.length === 0) return;
  ctx.strokeStyle = '#5BB1F5'; // matches TWEAK_DEFAULTS.accent2's default; canvas
  // can't resolve CSS custom properties directly, unlike styled elements
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const n = phases.length;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    // phase in [-pi, pi] -> y in [0, h], pi at the top
    const y = h * (0.5 - phases[i] / (2 * Math.PI));
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function IqWaterfallPage({ d }) {
  const canvasRef = useRIq(null);
  const rafRef = useRIq(0);
  const wsRef = useRIq(null);
  const phasesRef = useRIq(null);
  const dirtyRef = useRIq(false);
  const [wsState, setWsState] = useSIq('connecting');
  const [captureState, setCaptureState] = useSIq('idle'); // idle | capturing | error
  const [captureError, setCaptureError] = useSIq(null);

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
        const phases = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const off = i * 4;
          const q = view.getInt16(off, true);
          const iq = view.getInt16(off + 2, true);
          phases[i] = Math.atan2(q, iq);
        }
        phasesRef.current = phases;
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
        iqDrawPhase(ctx, canvas.width, canvas.height, phasesRef.current);
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
        body: JSON.stringify({ state_change: 'start' }),
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
        <div style={{ position: 'relative', width: '100%', height: 320 }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 8 }} />
        </div>
        <p className="dim" style={{ marginTop: 8 }}>
          Phase per bin (-&pi; at the bottom, +&pi; at the top). Minimal viewer for now --
          the point is proving the FPGA/Rust plumbing end to end, not a finished visualization.
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
