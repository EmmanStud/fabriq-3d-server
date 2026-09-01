const express = require('express');
const https = require('https');
const http = require('http');
const app = express();


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

// Only these hosts may be fetched through the proxy. This server is public,
// so without an allowlist anyone can use it to fetch arbitrary URLs (SSRF).
const ALLOWED_PROXY_HOSTS = ['res.cloudinary.com', 'assets.meshy.ai'];

const isAllowedProxyUrl = (url) => {
  try {
    const parsed = new URL(url);
    return ALLOWED_PROXY_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
};

// Proxy route for GLB files
app.get('/proxy', (req, res) => {
  let url = sanitizeUrl(req.query.url);
  if (!url) {
    console.log('[ERROR] No URL provided to /proxy');
    return res.status(400).send('No URL provided');
  }

  if (!isAllowedProxyUrl(url)) {
    console.log(`[PROXY BLOCKED] Disallowed host: ${url}`);
    return res.status(403).send('URL host not allowed');
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
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const proxiedUrl = `${protocol}://${host}/proxy?url=${encodeURIComponent(glbUrl)}`;
  const showDebugBar = req.query.debug === '1';
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
  <div id="debug" style="position:fixed;bottom:0;left:0;right:0;z-index:999;background:rgba(0,0,0,0.85);color:#D4AF37;font-size:11px;font-family:monospace;padding:8px 12px;display:${showDebugBar ? 'block' : 'none'};">Initializing...</div>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.4.0/model-viewer.min.js"></script>
  <script>
    /* Classic (non-module) script — window.applyColor is globally accessible from injectJavaScript */
    var mv = document.getElementById('mv');
    var loading = document.getElementById('loading');
    var debug = document.getElementById('debug');
    var pendingColor = null;
    var modelReady = false;
    var pendingFabric = null;
    var fabricProps = {
      satin:   { roughness: 0.25, metalness: 0.05 },
      silk:    { roughness: 0.15, metalness: 0.05 },
      velvet:  { roughness: 0.90, metalness: 0.0  },
      chiffon: { roughness: 0.55, metalness: 0.0  },
      lace:    { roughness: 0.75, metalness: 0.0  },
      tulle:   { roughness: 0.70, metalness: 0.0  },
      organza: { roughness: 0.45, metalness: 0.08 },
      crepe:   { roughness: 0.60, metalness: 0.0  },
    };

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

    window.applyFabric = function(fabricId) {
      log('applyFabric called: ' + fabricId);
      if (modelReady) {
        doApplyFabric(fabricId);
      } else {
        pendingFabric = fabricId;
        log('Queued fabric: ' + fabricId + ' (model not ready yet)');
      }
    };

    function doApplyFabric(fabricId) {
      try {
        var mats = mv.model ? mv.model.materials : null;
        if (!mats || mats.length === 0) { log('No materials found for fabric'); return; }
        var props = fabricProps[fabricId] || { roughness: 0.5, metalness: 0.0 };
        for (var i = 0; i < mats.length; i++) {
          mats[i].pbrMetallicRoughness.setRoughnessFactor(props.roughness);
          mats[i].pbrMetallicRoughness.setMetallicFactor(props.metalness);
        }
        log('Fabric applied: ' + fabricId + ' (roughness ' + props.roughness + ')');
      } catch(e) {
        log('Fabric error: ' + e.message);
      }
    }

    // Material names containing any of these words are treated as the
    // mannequin/body, not the garment, and are skipped when recoloring.
    var EXCLUDED_MATERIAL_PATTERN = /body|skin|mannequin|figure|base_mesh/i;

    function getRecolorableMaterials(mats) {
      var targets = [];
      for (var i = 0; i < mats.length; i++) {
        var name = mats[i].name || '';
        if (!EXCLUDED_MATERIAL_PATTERN.test(name)) targets.push(mats[i]);
      }
      // Safety net: if every material matched the exclusion pattern (e.g.
      // an unnamed single-material model), fall back to all materials so
      // color application never silently does nothing.
      return targets.length > 0 ? targets : mats;
    }

    function doApply(hex) {
      try {
        var mats = mv.model ? mv.model.materials : null;
        if (!mats || mats.length === 0) { log('No materials found'); return; }
        var targets = getRecolorableMaterials(mats);
        var r = parseInt(hex.slice(1,3), 16) / 255;
        var g = parseInt(hex.slice(3,5), 16) / 255;
        var b = parseInt(hex.slice(5,7), 16) / 255;
        var toLinear = function(c) { return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
        var factor = [toLinear(r), toLinear(g), toLinear(b), 1.0];
        for (var i = 0; i < targets.length; i++) {
          targets[i].pbrMetallicRoughness.setBaseColorFactor(factor);
        }
        log('Done! ' + hex + ' on ' + targets.length + '/' + mats.length + ' mat(s)');
      } catch(e) {
        log('Error: ' + e.message);
      }
    }

    mv.addEventListener('load', function() {
      modelReady = true;
      loading.style.display = 'none';
      mv.classList.add('ready');
      var c = mv.model ? mv.model.materials.length : 0;
      var names = [];
      for (var i = 0; i < c; i++) { names.push(i + ':' + (mv.model.materials[i].name || 'unnamed')); }
      log('Model ready! ' + c + ' materials [' + names.join(', ') + ']');
      if (pendingColor) {
        var col = pendingColor;
        pendingColor = null;
        setTimeout(function(){ doApply(col); }, 300);
      }
      if (pendingFabric) {
        var fab = pendingFabric;
        pendingFabric = null;
        setTimeout(function(){ doApplyFabric(fab); }, 300);
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