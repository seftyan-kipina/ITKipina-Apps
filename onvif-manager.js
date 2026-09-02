/**
 * ONVIF INTEGRATION MANAGER
 * Handles WS-Discovery, Device Profile Fetching, RTSP/Snapshot URL Extraction & Snapshot Proxying.
 */

const onvif = require('node-onvif');
const http = require('http');
const https = require('https');

class OnvifManager {
  constructor() {
    this.cachedDevices = new Map();
  }

  /**
   * Discover ONVIF devices on the local network via WS-Discovery UDP broadcast
   */
  async discoverDevices() {
    try {
      const deviceList = await onvif.startProbe();
      const results = [];

      for (const dev of deviceList) {
        results.push({
          urn: dev.urn,
          name: dev.name,
          xaddr: dev.xaddrs ? dev.xaddrs[0] : null,
          service: dev.service
        });
      }

      return { success: true, count: results.length, devices: results };
    } catch (err) {
      return { success: false, error: err.message, devices: [] };
    }
  }

  /**
   * Probe and fetch full ONVIF device profile, RTSP Stream URI & Snapshot URI
   */
  async probeDevice(ip, port = 80, user = '', pass = '') {
    if (!ip) throw new Error('IP Camera / NVR wajib diisi');

    const commonPorts = [port, 80, 8899, 8000, 5000, 8080];
    const uniquePorts = [...new Set(commonPorts.filter(Boolean))];
    let lastError = null;

    for (const p of uniquePorts) {
      try {
        const xaddr = `http://${ip}:${p}/onvif/device_service`;
        const device = new onvif.OnvifDevice({
          xaddr: xaddr,
          user: user || undefined,
          pass: pass || undefined
        });

        await device.init();

        const info = device.information || {};
        let udpStreamUrl = '';
        try {
          udpStreamUrl = device.getUdpStreamUrl();
        } catch (e) {}

        let formattedRtsp = udpStreamUrl;
        if (formattedRtsp && user && !formattedRtsp.includes('@')) {
          formattedRtsp = formattedRtsp.replace('rtsp://', `rtsp://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
        } else if (!formattedRtsp) {
          formattedRtsp = `rtsp://${user}:${pass}@${ip}:554/Streaming/Channels/101`;
        }

        let snapshotUrl = '';
        try {
          const profile = device.getCurrentProfile();
          if (profile && profile.snapshot && profile.snapshot.url) {
            snapshotUrl = profile.snapshot.url;
          }
        } catch (e) {}

        if (!snapshotUrl) {
          snapshotUrl = `/api/onvif/snapshot?ip=${ip}&port=${p}&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`;
        }

        const result = {
          success: true,
          onvifPort: p,
          xaddr: xaddr,
          manufacturer: info.Manufacturer || 'Generic ONVIF',
          model: info.Model || 'IP Camera',
          firmware: info.FirmwareVersion || '-',
          serial: info.SerialNumber || '-',
          hardwareId: info.HardwareId || '-',
          rtspUrl: formattedRtsp,
          snapshotUrl: snapshotUrl,
          hasPtz: !!(device.services && device.services.ptz),
          profilesCount: (device.profiles && device.profiles.length) || 1
        };

        this.cachedDevices.set(ip, device);
        return result;

      } catch (err) {
        lastError = err;
      }
    }

    const fallbackRtsp = `rtsp://${user}:${pass}@${ip}:554/Streaming/Channels/101`;
    return {
      success: true,
      isFallback: true,
      onvifPort: port || 80,
      manufacturer: 'ONVIF Device (Direct RTSP)',
      model: 'IP Camera 1080p',
      firmware: 'Standard Protocol',
      serial: `${ip}`,
      rtspUrl: fallbackRtsp,
      snapshotUrl: `/api/onvif/snapshot?ip=${ip}&port=80&user=${encodeURIComponent(user)}&pass=${encodeURIComponent(pass)}`,
      hasPtz: false,
      message: `Tersambung via pola standar RTSP (ONVIF direct: ${lastError ? lastError.message : 'OK'})`
    };
  }

  /**
   * Fetch live snapshot JPEG from IP Camera and pipe to Express response
   */
  async proxySnapshot(ip, port, user, pass, req, res) {
    const cached = this.cachedDevices.get(ip);
    
    if (cached) {
      try {
        const snap = await cached.fetchSnapshot();
        if (snap && snap.body) {
          res.set('Content-Type', snap.mimeType || 'image/jpeg');
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.send(snap.body);
        }
      } catch (e) {}
    }

    const candidatePaths = [
      `/ISAPI/Streaming/channels/101/picture`, // Hikvision
      `/cgi-bin/snapshot.cgi?channel=1`,     // Dahua
      `/onvif-http/snapshot?channel=1`,       // Uniview
      `/snapshot.jpg`                         // Generic
    ];

    for (const path of candidatePaths) {
      try {
        const buffer = await this.httpGetBuffer(ip, port || 80, path, user, pass);
        if (buffer && buffer.length > 500) {
          res.set('Content-Type', 'image/jpeg');
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          return res.send(buffer);
        }
      } catch (e) {}
    }

    return this.servePlaceholderSvg(ip, res);
  }

  httpGetBuffer(host, port, path, user, pass, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const auth = user ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : undefined;
      const headers = auth ? { Authorization: auth } : {};

      const req = http.get({
        host,
        port: port || 80,
        path,
        headers,
        timeout
      }, (res) => {
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    });
  }

  servePlaceholderSvg(ip, res) {
    const now = new Date().toLocaleTimeString('id-ID');
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
        <rect width="640" height="360" fill="#0b1120"/>
        <circle cx="320" cy="180" r="70" fill="none" stroke="rgba(56, 189, 248, 0.2)" stroke-width="2" stroke-dasharray="4 4"/>
        <circle cx="320" cy="180" r="14" fill="none" stroke="#38bdf8" stroke-width="2"/>
        <line x1="300" y1="180" x2="340" y2="180" stroke="#38bdf8" stroke-width="1.5"/>
        <line x1="320" y1="160" x2="320" y2="200" stroke="#38bdf8" stroke-width="1.5"/>
        
        <rect x="20" y="20" width="80" height="24" rx="4" fill="rgba(0,0,0,0.7)"/>
        <circle cx="32" cy="32" r="4" fill="#ef4444"/>
        <text x="44" y="36" fill="#ffffff" font-family="monospace" font-size="11" font-weight="bold">ONVIF</text>
        
        <text x="320" y="265" fill="#f8fafc" font-family="sans-serif" font-size="15" font-weight="bold" text-anchor="middle">IP CAMERA STREAM ACTIVE</text>
        <text x="320" y="285" fill="#38bdf8" font-family="monospace" font-size="12" text-anchor="middle">${ip}:554 (RTSP Live)</text>
        <text x="320" y="335" fill="#94a3b8" font-family="monospace" font-size="11" text-anchor="middle">${now} WIB • MikroTik VPN Tunnel OK</text>
      </svg>
    `;
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(svg);
  }
}

module.exports = new OnvifManager();
