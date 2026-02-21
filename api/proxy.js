const https = require('https');
const http = require('http');

const ALLOWED_HOST = 'live.banyuwangikab.go.id';

module.exports = async (req, res) => {
  // CORS headers - allow semua origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parameter url diperlukan' });
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
  } catch (e) {
    return res.status(400).json({ error: 'URL tidak valid' });
  }

  // Security: hanya izinkan domain CCTV Banyuwangi
  if (!targetUrl.includes(ALLOWED_HOST)) {
    return res.status(403).json({ error: 'Domain tidak diizinkan' });
  }

  const options = {
    headers: {
      'Referer': `https://${ALLOWED_HOST}/`,
      'Origin': `https://${ALLOWED_HOST}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
    },
  };

  try {
    const protocol = targetUrl.startsWith('https') ? https : http;
    
    const proxyReq = protocol.get(targetUrl, options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      
      // Set content type
      if (targetUrl.includes('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      } else if (targetUrl.includes('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
      } else {
        res.setHeader('Content-Type', contentType || 'application/octet-stream');
      }

      res.status(proxyRes.statusCode);

      // Jika ini file .m3u8, rewrite URL di dalamnya agar juga lewat proxy
      if (targetUrl.includes('.m3u8')) {
        let body = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', chunk => body += chunk);
        proxyRes.on('end', () => {
          // Dapatkan base URL untuk relative paths
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
          const proxyBase = `/api/proxy?url=`;

          // Rewrite setiap baris URL di playlist
          const rewritten = body.split('\n').map(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
              let fullUrl = line;
              if (!line.startsWith('http')) {
                fullUrl = baseUrl + line;
              }
              return proxyBase + encodeURIComponent(fullUrl);
            }
            return line;
          }).join('\n');

          res.end(rewritten);
        });
      } else {
        // Stream langsung untuk .ts dan file lain
        proxyRes.pipe(res);
      }
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err);
      res.status(502).json({ error: 'Gagal terhubung ke server CCTV', detail: err.message });
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy();
      res.status(504).json({ error: 'Timeout - server CCTV tidak merespons' });
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
};
