const express = require('express');
const https = require('https');
const http = require('http');
const app = express();
const PORT = 3456;

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get('/', (req, res) => {
  res.send('FabriQ 3D Server is running! 🎉');
});

// Helper to sanitize URLs
const sanitizeUrl = (url) => {
  if (!url) return '';
  return url.replace(/`/g, '').trim();
};

// Proxy route for GLB files
app.get('/proxy', (req, res) => {
  let url = sanitizeUrl(req.query.url);
  if (!url) {
    console.log('[ERROR] No URL provided to /proxy');
    return res.status(400).send('No URL provided');
  }
  
  console.log(`[PROXY] Fetching: ${url}`);
  
  const client = url.startsWith('https') ? https : http;
  client.get(url, (stream) => {
    console.log(`[PROXY] Response status: ${stream.statusCode}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'model/gltf-binary');
    stream.pipe(res);
  }).on('error', (e) => {
    console.error('[PROXY ERROR]', e.message);
    res.status(500).send(`Proxy error: ${e.message}`);
  });
});

app.get('/viewer', (req, res) => {
  const glbUrl = sanitizeUrl(req.query.url);
  const proxiedUrl = `http://192.168.1.6:${PORT}/proxy?url=${encodeURIComponent(glbUrl)}`;
  console.log(`[VIEWER] Generating viewer for: ${glbUrl}`);
  console.log(`[VIEWER] Proxied URL: ${proxiedUrl}`);
  
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FabriQ 3D Viewer</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; background:#111; overflow:hidden; }
    #loading {
      position:fixed; inset:0; z-index:99;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      background:#111; gap:16px;
    }
    .spinner {
      width:52px; height:52px;
      border:3px solid rgba(212,175,55,0.15);
      border-top-color:#D4AF37;
      border-radius:50%;
      animation:spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform:rotate(360deg); } }
    .title { color:#D4AF37; font-size:14px; font-family:Georgia,serif; letter-spacing:1px; }
    .hint { color:rgba(255,255,255,0.4); font-size:11px; }
    model-viewer {
      width:100%; height:100%;
      background:#111;
      --progress-bar-color:#D4AF37;
      opacity:0; transition:opacity 0.5s;
    }
    model-viewer.ready { opacity:1; }
  </style>
</head>
<body>
  <div id="loading">
    <div class="spinner"></div>
    <div class="title">Loading 3D Model</div>
    <div class="hint">Drag to rotate · Pinch to zoom</div>
  </div>
  <model-viewer
    id="mv"
    src="${proxiedUrl}"
    alt="3D Gown"
    auto-rotate
    camera-controls
    rotation-per-second="12deg"
    shadow-intensity="1.5"
    exposure="1.3"
    environment-image="neutral"
    interaction-prompt="none"
  ></model-viewer>
  <div id="debug" style="position:fixed;bottom:0;left:0;right:0;z-index:999;background:rgba(0,0,0,0.85);color:#D4AF37;font-size:11px;font-family:monospace;padding:8px 12px;">Initializing...</div>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
  <script>
    /* Classic (non-module) script — window.applyColor is globally accessible from injectJavaScript */
    var mv = document.getElementById('mv');
    var loading = document.getElementById('loading');
    var debug = document.getElementById('debug');
    var pendingColor = null;
    var modelReady = false;

    function log(msg) {
      debug.textContent = msg;
      console.log('[3D]', msg);
    }

    log('Script loaded. Waiting for model...');

    window.applyColor = function(hex) {
      log('applyColor called: ' + hex);
      if (modelReady) {
        doApply(hex);
      } else {
        pendingColor = hex;
        log('Queued: ' + hex + ' (model not ready yet)');
      }
    };

    function doApply(hex) {
      try {
        var mats = mv.model ? mv.model.materials : null;
        if (!mats || mats.length === 0) { log('No materials found'); return; }
        var r = parseInt(hex.slice(1,3), 16) / 255;
        var g = parseInt(hex.slice(3,5), 16) / 255;
        var b = parseInt(hex.slice(5,7), 16) / 255;
        var toLinear = function(c) { return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
        var factor = [toLinear(r), toLinear(g), toLinear(b), 1.0];
        for (var i = 0; i < mats.length; i++) {
          mats[i].pbrMetallicRoughness.setBaseColorFactor(factor);
        }
        log('Done! ' + hex + ' on ' + mats.length + ' mat(s)');
      } catch(e) {
        log('Error: ' + e.message);
      }
    }

    mv.addEventListener('load', function() {
      modelReady = true;
      loading.style.display = 'none';
      mv.classList.add('ready');
      var c = mv.model ? mv.model.materials.length : 0;
      log('Model ready! ' + c + ' materials');
      if (pendingColor) {
        var col = pendingColor;
        pendingColor = null;
        setTimeout(function(){ doApply(col); }, 300);
      }
    });

    mv.addEventListener('error', function() {
      loading.style.display = 'none';
      mv.classList.add('ready');
      log('Model error! Check URL/proxy.');
    });

    setTimeout(function(){ loading.style.display = 'none'; mv.classList.add('ready'); }, 20000);
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ FabriQ 3D Server running on port ${PORT}`);
});