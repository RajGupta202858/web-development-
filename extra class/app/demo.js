    /*
BodyFit - Single-file React app
Instructions:
1. Create a React project (e.g. using `npx create-react-app bodyfit`) and replace src/App.jsx with this file's contents.
2. Install dependencies if desired (none required). This file dynamically loads MediaPipe Pose from CDN at runtime.
3. Run `npm start` and open http://localhost:3000.

Notes:
- This is an MVP that runs entirely in-browser (default). No uploads required.
- Calibration offers "Enter height" and a manual reference-box option (user draws a box over a credit-card in the video) to compute cm-per-pixel.
- Skin sampling uses a small forehead patch; results are shown in RGB and LAB and mapped to an undertone.
- Simple rule-based recommender suggests styles and color families.
- This code is intentionally self-contained and documented.
*/

import React, { useEffect, useRef, useState } from 'react';

export default function App() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [poseLoaded, setPoseLoaded] = useState(false);
  const poseRef = useRef(null);
  const [landmarks, setLandmarks] = useState(null);
  const [heightCm, setHeightCm] = useState('');
  const [scaleCmPerPx, setScaleCmPerPx] = useState(null);
  const [measurements, setMeasurements] = useState(null);
  const [skinLab, setSkinLab] = useState(null);
  const [skinRgb, setSkinRgb] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [processLocally, setProcessLocally] = useState(true);
  const [drawRefBox, setDrawRefBox] = useState(false);
  const refBox = useRef(null); // {x,y,w,h}

  // Load MediaPipe Pose script dynamically
  useEffect(() => {
    if (window.Pose) {
      setPoseLoaded(true);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/pose.js';
    s.async = true;
    s.onload = () => setPoseLoaded(true);
    s.onerror = () => setStatus('failed to load MediaPipe Pose');
    document.body.appendChild(s);
    // also load camera_utils (optional)
    const s2 = document.createElement('script');
    s2.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
    s2.async = true;
    document.body.appendChild(s2);
  }, []);

  // Start camera
  async function startCamera() {
    setStatus('starting camera...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setStatus('camera started');
      initPose();
    } catch (e) {
      console.error(e);
      setStatus('camera permission denied or not available');
    }
  }

  // Initialize MediaPipe Pose and processing loop
  function initPose() {
    if (!poseLoaded || !window.Pose) {
      setStatus('waiting for pose library...');
      return;
    }

    // create pose
    const pose = new window.Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`,
    });
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false, minDetectionConfidence: 0.5 });
    pose.onResults(onResults);
    poseRef.current = pose;
    setPoseLoaded(true);

    // Use camera_utils if available
    if (window.Camera && videoRef.current) {
      // eslint-disable-next-line no-unused-vars
      const camera = new window.Camera(videoRef.current, {
        onFrame: async () => {
          await pose.send({ image: videoRef.current });
        },
        width: 640,
        height: 480,
      });
      camera.start();
    } else {
      // fallback: simple interval processing
      const interval = setInterval(async () => {
        if (videoRef.current && !videoRef.current.paused && poseRef.current) {
          await poseRef.current.send({ image: videoRef.current });
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }

  // onResults callback
  function onResults(results) {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    if (results.poseLandmarks) {
      setLandmarks(results.poseLandmarks);
      drawLandmarks(ctx, results.poseLandmarks, canvas.width, canvas.height);
      // sample skin and calculate measurements if scale known or height provided
      if (scaleCmPerPx || heightCm) {
        const meas = computeMeasurements(results.poseLandmarks, canvas.width, canvas.height, scaleCmPerPx, heightCm);
        setMeasurements(meas);
        const skin = sampleSkin(results.poseLandmarks, canvas, ctx);
        if (skin) {
          setSkinRgb(skin.rgb);
          setSkinLab(rgbToLab(skin.rgb));
          const recs = recommendOutfits(meas, rgbToLab(skin.rgb));
          setRecommendations(recs);
        }
      }
    }

    // draw reference box if user drawing
    if (refBox.current) {
      ctx.strokeStyle = 'yellow';
      ctx.lineWidth = 2;
      const r = refBox.current;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }

    ctx.restore();
  }

  // drawing landmarks (simple)
  function drawLandmarks(ctx, lm, w, h) {
    ctx.fillStyle = 'red';
    for (let i = 0; i < lm.length; i++) {
      const x = lm[i].x * w;
      const y = lm[i].y * h;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // draw some skeleton lines (pairs)
    const pairs = [[11,13],[13,15],[12,14],[14,16],[11,12],[23,24],[11,23],[12,24],[23,25],[24,26]];
    ctx.strokeStyle = 'lime'; ctx.lineWidth = 2;
    for (const p of pairs) {
      const a = lm[p[0]], b = lm[p[1]];
      ctx.beginPath(); ctx.moveTo(a.x*w, a.y*h); ctx.lineTo(b.x*w, b.y*h); ctx.stroke();
    }
  }

  // Compute px distance
  function pxDistance(a, b, w, h) {
    const x1 = a.x * w, y1 = a.y * h;
    const x2 = b.x * w, y2 = b.y * h;
    return Math.hypot(x2 - x1, y2 - y1);
  }

  // Compute measurements using landmarks and either scale or known height
  function computeMeasurements(lm, w, h, scale, knownHeight) {
    // landmarks indices: 0: nose, 11:left_shoulder,12:right_shoulder,23:left_hip,24:right_hip,27:left_knee,28:right_knee,31:left_ankle,32:right_ankle,0.. etc
    const leftShoulder = lm[11], rightShoulder = lm[12];
    const leftHip = lm[23], rightHip = lm[24];
    const leftAnkle = lm[31] || lm[27], rightAnkle = lm[32] || lm[28];
    const topHead = lm[0];

    const shoulderPx = pxDistance(leftShoulder, rightShoulder, w, h);
    const hipPx = pxDistance(leftHip, rightHip, w, h);
    const anklePx = (leftAnkle && rightAnkle) ? Math.max(pxDistance(leftAnkle, topHead, w, h), pxDistance(rightAnkle, topHead, w, h)) : null;
    const headToAnklePx = (topHead && leftAnkle) ? pxDistance(topHead, leftAnkle, w, h) : null;

    // determine scale
    let S = scale;
    if (!S && knownHeight && headToAnklePx) {
      S = knownHeight / headToAnklePx; // cm per px
      // save scale for further frames
      setScaleCmPerPx(S);
    }

    const shoulderCm = S ? shoulderPx * S : null;
    const hipCm = S ? hipPx * S : null;
    const heightCmEst = S && headToAnklePx ? headToAnklePx * S : (knownHeight ? parseFloat(knownHeight) : null);

    // circumferences using shape factors
    const chestCirc = shoulderCm ? shoulderCm * 2.35 : null;
    const waistCirc = hipCm ? hipCm * 2.4 : null;
    const thighCirc = hipCm ? (hipCm * 0.55) * 2.6 : null; // rough

    return {
      shoulderCm, hipCm, heightCm: heightCmEst, chestCirc, waistCirc, thighCirc, scale: S
    };
  }

  // sample skin from forehead region (use nose landmark to jump up)
  function sampleSkin(lm, canvas, ctx) {
    if (!lm || !canvas) return null;
    const w = canvas.width, h = canvas.height;
    const nose = lm[0];
    if (!nose) return null;
    const cx = nose.x * w; const cy = nose.y * h - 60; // forehead above nose
    const size = 30;
    const x = Math.max(0, Math.floor(cx - size/2));
    const y = Math.max(0, Math.floor(cy - size/2));
    const img = ctx.getImageData(x, y, size, size);
    const pixels = [];
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i+1], b = img.data[i+2];
      const a = img.data[i+3];
      if (a < 200) continue;
      // discard very bright specular
      if (r > 240 && g > 240 && b > 240) continue;
      pixels.push([r,g,b]);
    }
    if (pixels.length === 0) return null;
    const med = sampleMedianColor(pixels);
    return { rgb: med, box: [x,y,size,size] };
  }

  function sampleMedianColor(pixels) {
    const rs = pixels.map(p => p[0]).sort((a,b)=>a-b);
    const gs = pixels.map(p => p[1]).sort((a,b)=>a-b);
    const bs = pixels.map(p => p[2]).sort((a,b)=>a-b);
    const mid = Math.floor(pixels.length/2);
    return [rs[mid], gs[mid], bs[mid]];
  }

  // RGB -> XYZ -> LAB conversion
  function rgbToXyz([r,g,b]){
    // sRGB 0..255 to 0..1
    r/=255; g/=255; b/=255;
    // gamma correction
    r = r > 0.04045 ? Math.pow((r + 0.055)/1.055, 2.4) : (r/12.92);
    g = g > 0.04045 ? Math.pow((g + 0.055)/1.055, 2.4) : (g/12.92);
    b = b > 0.04045 ? Math.pow((b + 0.055)/1.055, 2.4) : (b/12.92);
    // Observer = 2°, Illuminant = D65
    const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const z = r * 0.0193 + g * 0.1192 + b * 0.9505;
    return [x,y,z];
  }
  function xyzToLab([x,y,z]){
    // D65 reference white
    const xr = x / 0.95047;
    const yr = y / 1.00000;
    const zr = z / 1.08883;
    function f(t){ return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16/116); }
    const fx = f(xr), fy = f(yr), fz = f(zr);
    const L = (116 * fy) - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);
    return [L,a,b];
  }
  function rgbToLab(rgb){ return xyzToLab(rgbToXyz(rgb)); }

  // simple recommender combining shape and skin undertone
  function recommendOutfits(meas, lab) {
    const recs = [];
    if (!meas) return recs;
    const { shoulderCm, hipCm, heightCm, chestCirc, waistCirc } = meas;
    // shape classification
    let shape = 'Unknown';
    if (shoulderCm && hipCm) {
      const ratio = shoulderCm / hipCm;
      if (Math.abs(ratio - 1) < 0.08) shape = 'Rectangle/Hourglass-ish';
      else if (ratio > 1.08) shape = 'Inverted Triangle';
      else shape = 'Pear/Triangle';
    }
    // height bucket
    const isShort = heightCm && heightCm < 165;
    // skin undertone
    let undertone = 'Neutral';
    if (lab) {
      const [L,a,b] = lab;
      // heuristic: positive a => red (warm), negative a => green (cool-ish)
      if (a > 6) undertone = 'Warm';
      else if (a < -4) undertone = 'Cool';
      else undertone = 'Neutral';
    }

    // rule examples
    if (shape.includes('Rectangle')) {
      recs.push({ title: 'Create curves', reasons: ['Use belts, peplum, cinched waists', 'Structured jackets'], score: 8 });
    }
    if (shape.includes('Inverted')) {
      recs.push({ title: 'Soften shoulders', reasons: ['V-necks, darker tops', 'Patterned bottoms to add balance'], score: 9 });
    }
    if (shape.includes('Pear')) {
      recs.push({ title: 'Balance hips', reasons: ['Boat necks, statement necklaces', 'A-line skirts'], score: 9 });
    }
    if (isShort) recs.push({ title: 'Create vertical lines', reasons: ['Vertical stripes, monochrome outfits, avoid oversized bottoms'], score: 7 });

    if (undertone === 'Warm') recs.push({ title: 'Warm palette', reasons: ['Terracotta, mustard, olive, warm browns'], score: 10 });
    if (undertone === 'Cool') recs.push({ title: 'Cool palette', reasons: ['Sapphire, emerald, cool greys, deep blues'], score: 10 });
    if (undertone === 'Neutral') recs.push({ title: 'Flexible palette', reasons: ['Both warm and cool palettes work; try jewel tones and earth tones'], score: 8 });

    // measurement-based rules
    if (chestCirc && chestCirc > 100) recs.push({ title: 'Tailored tops', reasons: ['Avoid clingy fabrics; choose structured fits'], score: 6 });

    // sort by score
    recs.sort((a,b)=>b.score - a.score);
    // attach simple confidence (normalized)
    const max = recs.length ? recs[0].score : 1;
    return recs.map(r => ({ ...r, confidence: Math.min(0.99, r.score / (max || 1)) }));
  }

  // UI event handlers for drawing reference box
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let drawing = false;
    let start = null;
    function mDown(e){
      if (!drawRefBox) return;
      drawing = true;
      const rect = canvas.getBoundingClientRect();
      start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      refBox.current = { x: start.x, y: start.y, w: 0, h: 0 };
    }
    function mMove(e){
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const cur = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      refBox.current = { x: Math.min(start.x, cur.x), y: Math.min(start.y, cur.y), w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
    }
    function mUp(){
      if (!drawing) return;
      drawing = false;
      // compute scale from refBox: assume user selected credit card width horizontally
      const box = refBox.current;
      if (box && box.w > 10) {
        const cmPerPx = 8.56 / box.w; // credit card width 8.56 cm
        setScaleCmPerPx(cmPerPx);
        setDrawRefBox(false);
        setStatus('Reference object captured.');
      }
    }
    canvas.addEventListener('mousedown', mDown);
    window.addEventListener('mousemove', mMove);
    window.addEventListener('mouseup', mUp);
    return () => {
      canvas.removeEventListener('mousedown', mDown);
      window.removeEventListener('mousemove', mMove);
      window.removeEventListener('mouseup', mUp);
    };
  }, [drawRefBox]);

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: 16 }}>
      <h1>BodyFit — Measurement + Skin Tone + Recommender (MVP)</h1>

      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ marginBottom: 8 }}>
            <button onClick={startCamera}>Start Camera</button>
            <label style={{ marginLeft: 12 }}><input type="checkbox" checked={processLocally} onChange={e=>setProcessLocally(e.target.checked)} /> Process locally (no uploads)</label>
          </div>
          <video ref={videoRef} style={{ width: '100%', maxWidth: 640 }} playsInline muted></video>
          <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 640, border: '1px solid #ddd', marginTop:8 }} />

          <div style={{ marginTop: 10 }}>
            <strong>Calibration</strong>
            <div>
              <label>Enter your height (cm): <input value={heightCm} onChange={e=>setHeightCm(e.target.value)} placeholder="e.g. 175" /></label>
              <button style={{ marginLeft: 8 }} onClick={()=>{ if (heightCm) { setScaleCmPerPx(null); setStatus('Using known height for scale — will compute when pose detected.'); }}}>Use height</button>
            </div>
            <div style={{ marginTop: 6 }}>
              <button onClick={()=>{ setDrawRefBox(true); setStatus('Draw a box around a reference card in the video (drag on canvas)'); }}>Use reference card (draw box)</button>
            </div>
            <div style={{ marginTop:6 }}><small>Calibration required for cm measurements. Credit card width = 8.56 cm.</small></div>
          </div>

        </div>

        <div style={{ width: 360 }}>
          <div style={{ background: '#fafafa', padding: 10, borderRadius: 6, border: '1px solid #eee' }}>
            <h3>Status</h3>
            <div>{status}</div>
            <div>Pose library: {poseLoaded ? 'Loaded' : 'Loading...'}</div>
            <div>Scale: {scaleCmPerPx ? scaleCmPerPx.toFixed(4) + ' cm/px' : 'not set'}</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <h3>Measurements (estimates)</h3>
            {measurements ? (
              <div>
                <div>Height: {measurements.heightCm ? measurements.heightCm.toFixed(1)+' cm' : '—'}</div>
                <div>Shoulder width: {measurements.shoulderCm ? measurements.shoulderCm.toFixed(1)+' cm' : '—'}</div>
                <div>Hip width: {measurements.hipCm ? measurements.hipCm.toFixed(1)+' cm' : '—'}</div>
                <div>Chest circ: {measurements.chestCirc ? measurements.chestCirc.toFixed(1)+' cm' : '—'}</div>
                <div>Waist circ: {measurements.waistCirc ? measurements.waistCirc.toFixed(1)+' cm' : '—'}</div>
              </div>
            ) : (<div>No measurements yet — calibrate and allow camera, then stand in frame.</div>)}
          </div>

          <div style={{ marginTop: 10 }}>
            <h3>Skin sample</h3>
            {skinRgb ? (
              <div style={{ display: 'flex', gap:8, alignItems:'center' }}>
                <div style={{ width:48, height:48, background:`rgb(${skinRgb.join(',')})`, border:'1px solid #ccc' }}></div>
                <div>
                  <div>RGB: {skinRgb.join(', ')}</div>
                  <div>LAB: {skinLab ? skinLab.map(v=>v.toFixed(1)).join(', ') : '—'}</div>
                </div>
              </div>
            ) : (<div>No skin sample yet.</div>)}
            <div style={{ marginTop:8 }}><small>Skin tone detection is affected by lighting — allow manual override in production.</small></div>
          </div>

          <div style={{ marginTop: 10 }}>
            <h3>Recommendations</h3>
            {recommendations.length ? (
              <div>
                {recommendations.map((r, i) => (
                  <div key={i} style={{ marginBottom:8, padding:8, border:'1px solid #eee', borderRadius:6 }}>
                    <div style={{ fontWeight:600 }}>{r.title} <small style={{ color:'#666' }}>({Math.round(r.confidence*100)}% confidence)</small></div>
                    <div style={{ fontSize:13 }}>{r.reasons.join(' • ')}</div>
                  </div>
                ))}
              </div>
            ) : (<div>No recommendations yet.</div>)}
          </div>

        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <strong>Privacy</strong>
        <div>By default the app processes data locally in your browser. Images and frames are not uploaded unless you explicitly enable server upload.</div>
      </div>

    </div>
  );
}