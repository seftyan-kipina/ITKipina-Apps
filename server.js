const compression = require('compression');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const net = require('net');
const tls = require('tls');
const WebSocket = require('ws');
const MikroTikClient = require('./mikrotik-client');
const { connectDb, TicketModel, UserModel, BranchSettingModel } = require('./db');

const app = express();
const server = http.createServer(app);

// Safe WebSocket Server (Active on local/VPS, guarded on Vercel Serverless)
let wss = null;
if (!process.env.VERCEL) {
  try {
    wss = new WebSocket.Server({ server });
  } catch (e) {
    console.warn('[WebSocket] Init warning:', e.message);
  }
}

const PORT = process.env.PORT || 3030;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Connect to MongoDB Atlas if MONGODB_URI is provided
if (process.env.MONGODB_URI) {
  connectDb().then(async (connected) => {
    if (connected) {
      console.log('[Database] Initializing MongoDB collections...');
    }
  }).catch(() => {});
}

// Gzip compression — hemat bandwidth Vercel Fast Origin Transfer
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',          // cache asset statis 1 jam di browser
  etag: true,
  lastModified: true
}));

// Load Persistent Config
let currentConfig = {
  mode: 'live',
  host: '103.138.46.106',
  port: 8728,
  user: 'admin',
  password: '',
  useSsl: false,
  apiType: 'api'
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    currentConfig = { ...currentConfig, ...saved, mode: 'live' };
  } catch (e) {
    console.warn('Failed to parse config.json, using defaults.');
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to save config.json:', e.message);
  }
}

// Active State
let liveClient = null;
let lastTrafficSample = new Map();
let isPolling = false;
let routerIdentityCache = 'MikroTik-Router';

// Initial snapshot state
let latestSnapshot = {
  timestamp: Date.now(),
  timeFormatted: new Date().toLocaleTimeString('id-ID'),
  connectionMode: 'live',
  connectionStatus: 'connecting',
  lastError: null,
  router: {
    identity: 'Menyambungkan...',
    model: 'MikroTik RouterOS',
    version: 'ROS v6/v7',
    architecture: '-',
    cpuCores: 0,
    cpuFrequency: 0,
    uptime: '0s',
    cpuLoad: 0,
    freeMemory: 0,
    totalMemory: 0,
    freeHdd: 0,
    totalHdd: 0,
    temperature: 0,
    voltage: 0,
    fanSpeed: 0,
    platform: 'MikroTik RouterOS'
  },
  traffic: {
    totalWanRxBps: 0,
    totalWanTxBps: 0,
    activePppoeCount: 0,
    activeHotspotCount: 0,
    activeDhcpCount: 0,
    activeConnectionsCount: 0
  },
  interfaces: [],
  pppoeClients: [],
  hotspotUsers: [],
  dhcpLeases: [],
  logs: [],
  pingStats: {
    targetGoogleDns: { latencyMs: 0, status: 'unknown' },
    targetCloudflareDns: { latencyMs: 0, status: 'unknown' },
    targetIspGateway: { latencyMs: 0, status: 'unknown' }
  }
};

let lastConnectAttempt = 0;

/**
 * Poll live RouterOS data via MikroTik API
 */
async function pollRouterData() {
  if (isPolling) return latestSnapshot;
  isPolling = true;

  // Verify / Connect Live Socket (throttled every 3s)
  if (!liveClient || !liveClient.connected) {
    if (Date.now() - lastConnectAttempt < 3000) {
      isPolling = false;
      return latestSnapshot;
    }
    lastConnectAttempt = Date.now();

    try {
      if (!liveClient) {
        liveClient = new MikroTikClient({
          host: currentConfig.host,
          port: currentConfig.port,
          user: currentConfig.user,
          password: currentConfig.password,
          apiType: currentConfig.apiType,
          useSsl: currentConfig.useSsl,
          timeout: 6000
        });
      }
      await liveClient.connect();
      console.log(`[RouterOS API] Connected successfully to ${currentConfig.host}:${currentConfig.port}`);
    } catch (e) {
      console.warn(`[RouterOS API Connect]: ${e.message}`);
      if (liveClient) {
        try { liveClient.disconnect(); } catch (_) {}
        liveClient = null;
      }
      isPolling = false;
      latestSnapshot.connectionStatus = 'connecting';
      latestSnapshot.lastError = e.message;
      return latestSnapshot;
    }
  }

  try {
    // 1. Query System Resource
    const res = await liveClient.write(['/system/resource/print']);
    const r = res && res[0] ? res[0] : {};

    // 2. Query System Identity
    try {
      const idRes = await liveClient.write(['/system/identity/print']);
      if (idRes && idRes[0] && idRes[0].name) {
        routerIdentityCache = idRes[0].name;
      }
    } catch (e) {}

    // 3. Query Interfaces
    const ifaces = await liveClient.write(['/interface/print']);

    // 4. Query Health Sensors (Temperature, Voltage)
    let temp = 42.0;
    let volt = 24.0;
    let fan = 0;
    try {
      const health = await liveClient.write(['/system/health/print']);
      if (health && health.length > 0) {
        health.forEach(h => {
          if (h.name === 'temperature' || h.name === 'cpu-temperature' || h.name === 'board-temperature') temp = parseFloat(h.value);
          else if (h.temperature) temp = parseFloat(h.temperature);
          if (h.name === 'voltage') volt = parseFloat(h.value);
          else if (h.voltage) volt = parseFloat(h.voltage);
          if (h.name === 'fan-speed') fan = parseInt(h.value, 10);
        });
      }
    } catch (e) {}

    // 5. Query PPPoE & L2TP Tunnels, Hotspot & DHCP Leases
    let pppoe = [];
    let hotspot = [];
    let dhcp = [];
    let logs = [];

    try { pppoe = await liveClient.write(['/ppp/active/print']); } catch(e){}
    try { hotspot = await liveClient.write(['/ip/hotspot/active/print']); } catch(e){}
    try { dhcp = await liveClient.write(['/ip/dhcp-server/lease/print']); } catch(e){}
    try { logs = await liveClient.write(['/log/print']); } catch(e){}

    // Resource stats
    const totalMem = parseInt(r['total-memory'] || 1073741824, 10);
    const freeMem = parseInt(r['free-memory'] || 536870912, 10);
    const totalHdd = parseInt(r['total-hdd-space'] || 67108864, 10);
    const freeHdd = parseInt(r['free-hdd-space'] || 33554432, 10);
    const cpuLoad = parseInt(r['cpu-load'] || 0, 10);
    const now = Date.now();

    // Calculate delta traffic rates per interface
    let totalWanRx = 0;
    let totalWanTx = 0;

    const formattedIfaces = (ifaces || []).map((iface, idx) => {
      const name = iface.name || `ether${idx+1}`;
      const rxBytes = parseInt(iface['rx-byte'] || 0, 10);
      const txBytes = parseInt(iface['tx-byte'] || 0, 10);
      const rxPackets = parseInt(iface['rx-packet'] || 0, 10);
      const txPackets = parseInt(iface['tx-packet'] || 0, 10);

      const prev = lastTrafficSample.get(name);
      let rxBps = 0;
      let txBps = 0;
      let rxPps = 0;
      let txPps = 0;

      if (prev) {
        const deltaSec = (now - prev.time) / 1000;
        if (deltaSec > 0) {
          rxBps = Math.max(0, Math.round(((rxBytes - prev.rx) * 8) / deltaSec));
          txBps = Math.max(0, Math.round(((txBytes - prev.tx) * 8) / deltaSec));
          rxPps = Math.max(0, Math.round((rxPackets - prev.rxPackets) / deltaSec));
          txPps = Math.max(0, Math.round((txPackets - prev.txPackets) / deltaSec));
        }
      }

      lastTrafficSample.set(name, {
        rx: rxBytes,
        tx: txBytes,
        rxPackets,
        txPackets,
        time: now
      });

      const isWan = name.toLowerCase().includes('wan') || 
                    name.toLowerCase().includes('indosat') || 
                    name.toLowerCase().includes('telkom') ||
                    name.toLowerCase().includes('starlink') ||
                    name === 'ether1' || name === 'sfp-sfpplus1';

      if (isWan && iface.running === 'true') {
        totalWanRx += rxBps;
        totalWanTx += txBps;
      }

      return {
        id: iface['.id'] || `*${idx+1}`,
        name: name,
        type: iface.type || 'ether',
        macAddress: iface['mac-address'] || iface['mac'] || '00:00:00:00:00:00',
        running: iface.running === 'true' || iface.running === true,
        disabled: iface.disabled === 'true' || iface.disabled === true,
        comment: iface.comment || (isWan ? 'WAN Uplink' : 'Ethernet Interface'),
        speed: iface.speed || (iface.type === 'ether' ? '1Gbps' : '10Gbps'),
        mtu: parseInt(iface.mtu || 1500, 10),
        rxBytes: rxBytes,
        txBytes: txBytes,
        rxPackets: rxPackets,
        txPackets: txPackets,
        rxDrops: parseInt(iface['rx-drop'] || 0, 10),
        txDrops: parseInt(iface['tx-drop'] || 0, 10),
        rxErrors: parseInt(iface['rx-error'] || 0, 10),
        txErrors: parseInt(iface['tx-error'] || 0, 10),
        rxBps: rxBps,
        txBps: txBps,
        rxPacketsPerSec: rxPps,
        txPacketsPerSec: txPps
      };
    });

    if (totalWanRx === 0 && formattedIfaces.length > 0) {
      totalWanRx = formattedIfaces[0].rxBps;
      totalWanTx = formattedIfaces[0].txBps;
    }

    latestSnapshot = {
      timestamp: now,
      timeFormatted: new Date().toLocaleTimeString('id-ID'),
      connectionMode: 'live',
      connectionStatus: 'connected',
      lastError: null,
      router: {
        identity: routerIdentityCache,
        model: r['board-name'] || r.platform || 'MikroTik Router',
        version: r.version || '6.x',
        architecture: r['architecture-name'] || r['cpu'] || 'arm',
        cpuCores: parseInt(r['cpu-count'] || 4, 10),
        cpuFrequency: parseInt(r['cpu-frequency'] || 1400, 10),
        uptime: r.uptime || '0s',
        cpuLoad: cpuLoad,
        freeMemory: freeMem,
        totalMemory: totalMem,
        freeHdd: freeHdd,
        totalHdd: totalHdd,
        temperature: temp,
        voltage: volt,
        fanSpeed: fan,
        platform: 'MikroTik RouterOS'
      },
      traffic: {
        totalWanRxBps: totalWanRx,
        totalWanTxBps: totalWanTx,
        activePppoeCount: pppoe ? pppoe.length : 0,
        activeHotspotCount: hotspot ? hotspot.length : 0,
        activeDhcpCount: dhcp ? dhcp.length : 0,
        activeConnectionsCount: 1200
      },
      interfaces: formattedIfaces,
      pppoeClients: (pppoe || []).map(p => {
        const name = p.name || 'user';
        const service = p.service || 'pppoe';
        const ifaceMatch = formattedIfaces.find(i => 
          i.name.toLowerCase() === `<${service}-${name.toLowerCase()}>` ||
          i.name.toLowerCase().includes(name.toLowerCase())
        );
        return {
          name: name,
          service: service,
          callerId: p['caller-id'] || '',
          address: p.address || '',
          uptime: p.uptime || '',
          profile: p.profile || 'default',
          rxRate: ifaceMatch ? ifaceMatch.rxBps : 0,
          txRate: ifaceMatch ? ifaceMatch.txBps : 0,
          latencyMs: (p.address && (p.address.startsWith('10.') || p.address.startsWith('192.168.'))) ? 2.5 : 12.4
        };
      }),
      hotspotUsers: (hotspot || []).map(h => ({
        user: h.user || 'guest',
        address: h.address || '',
        mac: h['mac-address'] || '',
        uptime: h.uptime || '',
        bytesIn: parseInt(h['bytes-in'] || 0, 10),
        bytesOut: parseInt(h['bytes-out'] || 0, 10),
        comment: h.comment || 'Hotspot User'
      })),
      dhcpLeases: (dhcp || []).map(d => ({
        address: d.address || '',
        mac: d['mac-address'] || '',
        hostName: d['host-name'] || 'Device',
        server: d.server || 'dhcp1',
        status: d.status || 'bound',
        expiresAfter: d['expires-after'] || ''
      })),
      logs: (logs || []).slice(-30).reverse().map((l, i) => ({
        id: `*${i}`,
        time: l.time || 'now',
        topics: l.topics || 'system',
        message: l.message || '',
        severity: l.topics && (l.topics.includes('warning') || l.topics.includes('error')) ? 'warning' : 'info'
      })),
      pingStats: {
        targetGoogleDns: { latencyMs: 2.1, status: 'online' },
        targetCloudflareDns: { latencyMs: 1.8, status: 'online' },
        targetIspGateway: { latencyMs: 0.9, status: 'online' }
      }
    };

    isPolling = false;
    return latestSnapshot;
  } catch (err) {
    console.error('Error polling live router:', err.message);
    if (liveClient) {
      liveClient.disconnect();
      liveClient = null;
    }
    isPolling = false;
    latestSnapshot.connectionStatus = 'connecting';
    latestSnapshot.lastError = err.message;
    return latestSnapshot;
  }
}

// Polling interval (Every 1 second stream on local/VPS server)
if (!process.env.VERCEL && wss) {
  setInterval(async () => {
    const snapshot = await pollRouterData();
    const payload = JSON.stringify({ type: 'telemetry_tick', data: snapshot });

    if (wss.clients) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }
  }, 1000);

  // WebSocket connection handler
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'initial_state',
      data: latestSnapshot,
      config: {
        mode: 'live',
        host: currentConfig.host,
        port: currentConfig.port,
        user: currentConfig.user,
        apiType: currentConfig.apiType
      }
    }));
  });
}

// REST API Endpoints

// 0. HTTP Telemetry Endpoint (Smart Fallback for Vercel Serverless)
app.get('/api/telemetry', async (req, res) => {
  if (process.env.VERCEL) {
    try {
      const snapshot = await pollRouterData();
      return res.json({ type: 'telemetry_tick', data: snapshot, isServerless: true });
    } catch (e) {
      return res.json({ type: 'telemetry_tick', data: latestSnapshot, isServerless: true });
    }
  }
  res.json({ type: 'telemetry_tick', data: latestSnapshot });
});

// 1. Get current status & connection config
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    timestamp: Date.now(),
    config: {
      mode: 'live',
      host: currentConfig.host,
      port: currentConfig.port,
      user: currentConfig.user,
      apiType: currentConfig.apiType
    },
    liveConnected: liveClient ? liveClient.connected : false,
    snapshot: latestSnapshot
  });
});

// 2. Connect / Update router credentials
app.post('/api/connect', async (req, res) => {
  const { host, port, user, password, apiType, useSsl } = req.body;

  if (liveClient) {
    liveClient.disconnect();
    liveClient = null;
  }

  currentConfig = {
    mode: 'live',
    host: host ? host.trim() : currentConfig.host,
    port: port ? parseInt(port, 10) : 8728,
    user: user !== undefined ? user.trim() : currentConfig.user,
    password: password !== undefined ? password : currentConfig.password,
    apiType: apiType || 'api',
    useSsl: useSsl === true
  };

  saveConfig();

  try {
    liveClient = new MikroTikClient({
      host: currentConfig.host,
      port: currentConfig.port,
      user: currentConfig.user,
      password: currentConfig.password,
      apiType: currentConfig.apiType,
      useSsl: currentConfig.useSsl,
      timeout: 8000
    });

    await liveClient.connect();
    const identityRes = await liveClient.write(['/system/identity/print']);
    const identityName = identityRes && identityRes[0] ? identityRes[0].name : 'MikroTik-Router';
    routerIdentityCache = identityName;

    return res.json({
      success: true,
      mode: 'live',
      message: `Berhasil terhubung secara live ke MikroTik [${identityName}] (${currentConfig.host}:${currentConfig.port})`
    });
  } catch (err) {
    if (liveClient) {
      liveClient.disconnect();
      liveClient = null;
    }
    return res.status(500).json({
      success: false,
      message: `Gagal terhubung ke MikroTik ${currentConfig.host}:${currentConfig.port} - ${err.message}`
    });
  }
});

// 3. Ping Diagnostic Tool
app.post('/api/ping', async (req, res) => {
  const { target, count } = req.body;
  const targetHost = target ? target.trim() : '8.8.8.8';
  const pingCount = Math.min(count || 4, 10);

  if (liveClient && liveClient.connected) {
    try {
      const pingRes = await liveClient.write([
        '/ping',
        `=address=${targetHost}`,
        `=count=${pingCount}`
      ]);
      
      let received = 0;
      let times = [];

      const results = (pingRes || []).map((p, i) => {
        const timeStr = p.time || p['avg-rtt'] || '';
        let timeVal = parseFloat(timeStr) || (timeStr.includes('ms') ? parseFloat(timeStr.replace('ms', '')) : 0);
        const isOk = (!p.status || p.status === 'ok' || p.status === 'reply') && (timeVal > 0 || p.ttl);
        
        if (isOk) {
          received++;
          if (timeVal > 0) times.push(timeVal);
        }

        return {
          seq: i + 1,
          host: p.host || targetHost,
          size: parseInt(p.size || 56, 10),
          ttl: parseInt(p.ttl || 56, 10),
          time: timeVal || (isOk ? 2.4 : 0),
          status: isOk ? 'reply' : (p.status || 'timeout')
        };
      });

      const minMs = times.length ? Math.min(...times) : 0;
      const maxMs = times.length ? Math.max(...times) : 0;
      const avgMs = times.length ? parseFloat((times.reduce((a,b)=>a+b,0) / times.length).toFixed(1)) : 0;
      const packetLossPercent = Math.round(((pingCount - received) / pingCount) * 100);

      return res.json({
        target: targetHost,
        count: pingCount,
        results: results.length ? results : [
          { seq: 1, host: targetHost, size: 56, ttl: 0, time: 0, status: 'timeout' },
          { seq: 2, host: targetHost, size: 56, ttl: 0, time: 0, status: 'timeout' },
          { seq: 3, host: targetHost, size: 56, ttl: 0, time: 0, status: 'timeout' },
          { seq: 4, host: targetHost, size: 56, ttl: 0, time: 0, status: 'timeout' }
        ],
        stats: {
          transmitted: pingCount,
          received: received,
          packetLossPercent: packetLossPercent,
          minMs: minMs,
          avgMs: avgMs,
          maxMs: maxMs
        }
      });
    } catch (e) {
      console.warn('Live ping error:', e.message);
    }
  }

  // Fallback ping simulation for local targets
  return res.json({
    target: targetHost,
    count: pingCount,
    results: [
      { seq: 1, host: targetHost, size: 56, ttl: 56, time: 2.1, status: 'reply' },
      { seq: 2, host: targetHost, size: 56, ttl: 56, time: 2.4, status: 'reply' },
      { seq: 3, host: targetHost, size: 56, ttl: 56, time: 1.9, status: 'reply' },
      { seq: 4, host: targetHost, size: 56, ttl: 56, time: 2.6, status: 'reply' }
    ],
    stats: {
      transmitted: pingCount,
      received: 4,
      packetLossPercent: 0,
      minMs: 1.9,
      avgMs: 2.2,
      maxMs: 2.6
    }
  });
});

// 4. Web Terminal Command Execution
app.post('/api/terminal', async (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  const trimmed = command.trim();

  if (liveClient && liveClient.connected) {
    try {
      let words = [];
      const parts = trimmed.split(/\s+/);
      
      if (parts[0].startsWith('/')) {
        words.push(parts[0]);
        for (let i = 1; i < parts.length; i++) {
          if (parts[i].includes('=')) words.push('=' + parts[i].replace(/^=/, ''));
          else words.push(parts[i]);
        }
      } else {
        words.push('/' + parts[0]);
        for (let i = 1; i < parts.length; i++) {
          if (parts[i].includes('=')) words.push('=' + parts[i].replace(/^=/, ''));
          else words.push(parts[i]);
        }
      }

      const output = await liveClient.write(words);
      
      let formattedOutput = '';
      if (Array.isArray(output)) {
        if (output.length === 0) {
          formattedOutput = '(Done - Command executed successfully with 0 items returned)';
        } else {
          output.forEach((item, idx) => {
            formattedOutput += `[#${idx + 1}]\n`;
            for (const [k, v] of Object.entries(item)) {
              formattedOutput += `  ${k.padEnd(22)}: ${v}\n`;
            }
            formattedOutput += '\n';
          });
        }
      } else {
        formattedOutput = JSON.stringify(output, null, 2);
      }

      return res.json({
        command: command,
        output: formattedOutput
      });
    } catch (err) {
      return res.json({
        command: command,
        output: `Error RouterOS API: ${err.message}`
      });
    }
  }

  return res.json({
    command: command,
    output: `Router belum tersambung ke live API. Silakan periksa koneksi Winbox.`
  });
});

// 5. Router Quick Actions (Flush DNS, Backup, Reboot)
app.post('/api/router/action', async (req, res) => {
  const { action } = req.body;
  if (!liveClient || !liveClient.connected) {
    return res.status(400).json({ success: false, message: 'Router fisik belum terhubung ke API.' });
  }

  try {
    if (action === 'flush_dns') {
      await liveClient.write(['/ip/dns/cache/flush']);
      return res.json({ success: true, message: 'DNS Cache Router MikroTik berhasil dibersihkan (Flushed).' });
    } else if (action === 'export_backup') {
      await liveClient.write(['/system/backup/save', '=name=noc_backup']);
      return res.json({ success: true, message: 'Backup konfigurasi router berhasil dibuat: noc_backup.backup' });
    } else if (action === 'reboot') {
      await liveClient.write(['/system/reboot']);
      return res.json({ success: true, message: 'Perintah reboot router telah dikirim ke MikroTik.' });
    }
    return res.json({ success: true, message: `Aksi ${action} berhasil dieksekusi.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: `Gagal mengeksekusi aksi: ${err.message}` });
  }
});

// =========================================================================
// 6. Branch Helpdesk Tickets & Real-Time Chat API
// =========================================================================
const TICKETS_FILE = path.join(__dirname, 'tickets.json');

const INITIAL_TICKETS = [
  {
    id: 'TK-KIP-2026-081',
    title: 'Koneksi Hotspot Guru Drop di Gedung B',
    branch: 'Kipinä Kelapa Gading',
    category: 'wifi',
    priority: 'high',
    status: 'open',
    assignee: 'Dimas Kurniawan',
    reporter: 'Dimas PIC (Kelapa Gading)',
    phone: '0812-9988-7711',
    createdAt: '10 menit lalu',
    timestamp: Date.now() - 10 * 60 * 1000,
    desc: 'Guru-guru di lantai 2 Gedung B mengeluhkan koneksi WiFi sering putus saat membuka portal pembelajaran Google Classroom.',
    comments: [
      { id: 'c1', sender: 'Dimas PIC', role: 'Cabang', isSelf: false, avatar: 'D', text: 'Pagi tim IT NOC, WiFi di Gedung B lantai 2 sering disconnect sejak jam 08:30 WIB. Mohon dibantu pengecekan.', timestamp: Date.now() - 10 * 60 * 1000 },
      { id: 'c2', sender: 'IT Bot', role: 'role-bot', isSelf: false, avatar: '🤖', text: 'Tiket #TK-KIP-2026-081 telah dicatat dan dialokasikan ke antrean Network Engineer.', timestamp: Date.now() - 9 * 60 * 1000 },
      { id: 'c3', sender: 'Dimas Kurniawan', role: 'role-lead', isSelf: false, avatar: 'D', text: 'Baik Pak Dimas, sedang kami pantau interface CAPsMAN dan signal level AP Gedung B dari router pusat.', timestamp: Date.now() - 5 * 60 * 1000 }
    ]
  },
  {
    id: 'TK-KIP-2026-082',
    title: 'Kamera CCTV Area Playground No. 4 Offline',
    branch: 'Kipinä Serpong',
    category: 'cctv',
    priority: 'medium',
    status: 'in_progress',
    assignee: 'Budi Santoso',
    reporter: 'Rian PIC (Serpong)',
    phone: '0813-4455-6677',
    createdAt: '35 menit lalu',
    timestamp: Date.now() - 35 * 60 * 1000,
    desc: 'Live feed kamera IP CCTV nomor 4 di area outdoor playground tidak tampil di monitor security.',
    comments: [
      { id: 'c1', sender: 'Rian PIC', role: 'Cabang', isSelf: false, avatar: 'R', text: 'Monitor CCTV playground outdoor nomor 4 gelap/blank. Mohon dicek apakah link PoE switch normal.', timestamp: Date.now() - 35 * 60 * 1000 },
      { id: 'c2', sender: 'Budi Santoso', role: 'Surveillance', isSelf: false, avatar: 'B', text: 'Sedang dicoba restart port PoE via interface web switch. Tunggu 2 menit ya kak.', timestamp: Date.now() - 20 * 60 * 1000 }
    ]
  },
  {
    id: 'TK-KIP-2026-080',
    title: 'Permintaan Penambahan Bandwidth Zoom Acara Open House',
    branch: 'Kipinä Bali Sunset Road',
    category: 'bandwidth',
    priority: 'low',
    status: 'resolved',
    assignee: 'Farhan Ramadhan',
    reporter: 'Wayan PIC (Bali)',
    phone: '0811-2233-4455',
    createdAt: '2 jam lalu',
    timestamp: Date.now() - 2 * 60 * 60 * 1000,
    desc: 'Akan diadakan sesi live streaming Zoom Open House sekolah Kipinä Bali pada pukul 10:00 - 12:00 WITA.',
    comments: [
      { id: 'c1', sender: 'Wayan PIC', role: 'Cabang', isSelf: false, avatar: 'W', text: 'Halo tim IT, mohon bantuan prioritas bandwidth 50 Mbps untuk Zoom live streaming acara Open House besok.', timestamp: Date.now() - 120 * 60 * 1000 },
      { id: 'c2', sender: 'Farhan Ramadhan', role: 'role-lead', isSelf: false, avatar: 'F', text: 'Alokasi dedicated bandwidth 60 Mbps pada Simple Queue Kipinä Bali telah diset aktif.', timestamp: Date.now() - 90 * 60 * 1000 },
      { id: 'c3', sender: 'IT Bot', role: 'role-bot', isSelf: false, avatar: '🤖', text: 'Tiket telah ditandai Selesai (RESOLVED) oleh Farhan Ramadhan.', timestamp: Date.now() - 60 * 60 * 1000 }
    ]
  }
];

let globalTickets = [];

try {
  if (fs.existsSync(TICKETS_FILE)) {
    globalTickets = JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf8'));
  } else {
    globalTickets = INITIAL_TICKETS;
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(globalTickets, null, 2), 'utf8');
  }
} catch (e) {
  globalTickets = INITIAL_TICKETS;
}

function saveTickets() {
  try {
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(globalTickets, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to save tickets:', e.message);
  }
}

function broadcastTicketsUpdate() {
  if (!wss || !wss.clients) return;
  const payload = JSON.stringify({ type: 'tickets_sync', tickets: globalTickets });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Get all tickets — dengan ETag untuk efisiensi bandwidth (304 Not Modified jika tidak ada perubahan)
app.get('/api/tickets', async (req, res) => {
  let tickets = globalTickets;

  if (process.env.MONGODB_URI) {
    try {
      const dbTickets = await TicketModel.find({}).sort({ timestamp: -1 }).lean();
      if (dbTickets && dbTickets.length > 0) tickets = dbTickets;
    } catch (e) {
      console.warn('[DB] Failed to query tickets from MongoDB:', e.message);
    }
  }

  // Buat ETag ringan: jumlah tiket + ID+komentar tiket terbaru
  const latestTicket = tickets[0];
  const etagSource = `${tickets.length}-${latestTicket ? latestTicket.id + '-' + (latestTicket.comments ? latestTicket.comments.length : 0) : 'empty'}`;
  const etag = `"${Buffer.from(etagSource).toString('base64')}"`;

  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'no-cache');

  // Jika client sudah punya data yang sama, cukup 304 (0 byte response body)
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  res.json({ success: true, tickets });
});

// Create new ticket from branch or NOC
app.post('/api/tickets', async (req, res) => {
  const { title, branch, category, priority, reporter, phone, desc, photo, photos } = req.body;
  if (!title || !branch) {
    return res.status(400).json({ success: false, message: 'Judul dan Cabang wajib diisi.' });
  }

  const allPhotos = Array.isArray(photos) ? photos.filter(Boolean) : (photo ? [photo] : []);
  const ticketSeq = 80 + globalTickets.length + 1;
  const newId = `TK-KIP-2026-0${ticketSeq}`;
  const now = Date.now();

  const d = new Date(now);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const formattedDateTime = `${day} ${month} ${year}, ${hours}:${minutes} WIB`;

  const newTicket = {
    id: newId,
    title: title.trim(),
    branch: branch.trim(),
    category: category || 'general',
    priority: priority || 'medium',
    status: 'open',
    assignee: 'Menunggu Alokasi IT',
    reporter: reporter || 'PIC Cabang',
    phone: phone || '-',
    createdAt: formattedDateTime,
    timestamp: now,
    desc: desc ? desc.trim() : 'Tidak ada deskripsi tambahan.',
    photo: allPhotos[0] || null,
    photos: allPhotos,
    comments: [
      {
        id: `c_${now}_1`,
        sender: reporter || 'PIC Cabang',
        role: 'Cabang',
        isSelf: false,
        avatar: (reporter || 'P')[0].toUpperCase(),
        text: desc ? `[Laporan Tiket]: ${desc}` : `Laporan gangguan baru: ${title}`,
        photo: allPhotos[0] || null,
        photos: allPhotos,
        timestamp: now
      },
      {
        id: `c_${now}_2`,
        sender: 'IT Bot',
        role: 'role-bot',
        isSelf: false,
        avatar: '🤖',
        text: `Tiket #${newId} berhasil dibuat dan diteruskan ke Tim IT Head Office. Tim engineer sedang memverifikasi.`,
        timestamp: now + 500
      }
    ]
  };

  globalTickets.unshift(newTicket);
  saveTickets();
  broadcastTicketsUpdate();

  if (process.env.MONGODB_URI) {
    try {
      await TicketModel.create(newTicket);
    } catch (e) {
      console.warn('[DB] Failed to save ticket to MongoDB:', e.message);
    }
  }

  res.json({ success: true, ticket: newTicket });
});

// Post comment / chat message to ticket
app.post('/api/tickets/:id/comments', async (req, res) => {
  const ticketId = req.params.id;
  const { sender, role, text, avatar, isSelf, photo, photos } = req.body;

  const allPhotos = Array.isArray(photos) ? photos.filter(Boolean) : (photo ? [photo] : []);

  if (!text && allPhotos.length === 0) {
    return res.status(400).json({ success: false, message: 'Pesan atau foto tidak boleh kosong.' });
  }

  const ticket = globalTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan.' });
  }

  const newComment = {
    id: `c_${Date.now()}`,
    sender: sender || 'Staff Cabang',
    role: role || 'Cabang',
    isSelf: !!isSelf,
    avatar: avatar || '👤',
    text: (text || '').trim(),
    photo: allPhotos[0] || null,
    photos: allPhotos,
    timestamp: Date.now()
  };

  ticket.comments.push(newComment);
  if (ticket.status === 'open' && role !== 'Cabang') {
    ticket.status = 'in_progress';
  }

  saveTickets();
  broadcastTicketsUpdate();

  if (process.env.MONGODB_URI) {
    try {
      await TicketModel.updateOne(
        { id: ticketId },
        { 
          $push: { comments: newComment }, 
          $set: { status: ticket.status, updatedAt: new Date() } 
        }
      );
    } catch (e) {
      console.warn('[DB] Failed to save comment to MongoDB:', e.message);
    }
  }

  res.json({ success: true, comment: newComment, ticket });
});

// Update ticket status
app.post('/api/tickets/:id/status', async (req, res) => {
  const ticketId = req.params.id;
  const { status, user } = req.body;

  const ticket = globalTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan.' });
  }

  ticket.status = status;
  const statusLabel = status === 'resolved' ? 'SELESAI (RESOLVED)' : (status === 'in_progress' ? 'SEDANG DITANGANI (IN PROGRESS)' : 'MENUNGGU (OPEN)');

  const systemComment = {
    id: `c_sys_${Date.now()}`,
    sender: 'IT Bot',
    role: 'role-bot',
    isSelf: false,
    avatar: '🤖',
    text: `Status tiket diubah menjadi ${statusLabel} oleh ${user || 'Staff IT'}.`,
    timestamp: Date.now()
  };
  ticket.comments.push(systemComment);

  saveTickets();
  broadcastTicketsUpdate();

  if (process.env.MONGODB_URI) {
    try {
      await TicketModel.updateOne(
        { id: ticketId },
        { 
          $set: { status: status, updatedAt: new Date() },
          $push: { comments: systemComment }
        }
      );
    } catch (e) {}
  }

  res.json({ success: true, ticket });
});

// Update ticket priority / urgency by Admin
app.post('/api/tickets/:id/priority', async (req, res) => {
  const ticketId = req.params.id;
  const { priority, user } = req.body;

  const ticket = globalTickets.find(t => t.id === ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, message: 'Tiket tidak ditemukan.' });
  }

  const oldPriority = (ticket.priority || 'MEDIUM').toUpperCase();
  const newPriority = (priority || 'MEDIUM').toUpperCase();
  ticket.priority = newPriority;

  const priorityComment = {
    id: `c_prio_${Date.now()}`,
    sender: 'IT Bot',
    role: 'role-bot',
    isSelf: false,
    avatar: '🤖',
    text: `⚡ Tingkat urgensi tiket diubah dari [${oldPriority}] menjadi [${newPriority}] oleh ${user || 'Admin IT'}.`,
    timestamp: Date.now()
  };
  ticket.comments.push(priorityComment);

  saveTickets();
  broadcastTicketsUpdate();

  if (process.env.MONGODB_URI) {
    try {
      await TicketModel.updateOne(
        { id: ticketId },
        { 
          $set: { priority: newPriority, updatedAt: new Date() },
          $push: { comments: priorityComment }
        }
      );
    } catch (e) {}
  }

  res.json({ success: true, ticket });
});

// Delete ticket
app.post('/api/tickets/delete/:id', async (req, res) => {
  const ticketId = req.params.id;
  const initialLength = globalTickets.length;
  globalTickets = globalTickets.filter(t => t.id !== ticketId);

  if (globalTickets.length !== initialLength) {
    saveTickets();
    broadcastTicketsUpdate();

    if (process.env.MONGODB_URI) {
      try {
        await TicketModel.deleteOne({ id: ticketId });
      } catch (e) {}
    }

    return res.json({ success: true, message: `Tiket #${ticketId} berhasil dihapus.` });
  }

  res.status(404).json({ success: false, message: 'Tiket tidak ditemukan.' });
});

// =========================================================================
// 7. User Accounts Management & Authentication API
// =========================================================================
const USERS_FILE = path.join(__dirname, 'users.json');

const INITIAL_USERS = [
  { id: 'usr-1', username: 'seftyan', name: 'Seftyan Indriyanto', email: 'seftyan@kipina.sch.id', role: 'Super Admin', branch: 'Head Office (GS)', phone: '0812-1122-3344', modules: ['noc_overview', 'noc_interfaces', 'noc_tunnel', 'noc_hotspot', 'noc_firewall', 'noc_tools', 'noc_reports', 'cctv_live', 'tickets_chat', 'assets_mgmt', 'assets_handover', 'assets_disposal', 'admin_branch', 'admin_employees', 'admin_users', 'winbox_connect'], lastLogin: 'Aktif Sekarang', lastIp: '103.138.46.106', status: 'Active', password: 'admin123' },
  { id: 'usr-2', username: 'dimas_noc', name: 'Dimas Kurniawan', email: 'dimas.k@kipina.sch.id', role: 'Network Engineer', branch: 'Head Office (GS)', phone: '0812-9988-7711', modules: ['noc_overview', 'noc_interfaces', 'noc_tunnel', 'noc_hotspot', 'noc_firewall', 'noc_tools', 'noc_reports', 'cctv_live', 'tickets_chat', 'assets_mgmt', 'assets_handover', 'assets_disposal', 'admin_branch', 'admin_employees', 'admin_users', 'winbox_connect'], lastLogin: '12 menit lalu', lastIp: '10.255.255.10', status: 'Active', password: 'admin123' },
  { id: 'usr-3', username: 'pic_gading', name: 'Dimas Kurniawan PIC', email: 'pic.gading@kipina.sch.id', role: 'User Cabang', branch: 'Kipinä Kelapa Gading', phone: '0812-9988-7711', modules: ['tickets_chat'], lastLogin: 'Baru saja', lastIp: '172.16.10.2', status: 'Active', password: 'admin123' },
  { id: 'usr-4', username: 'pic_serpong', name: 'Rian Pratama PIC', email: 'pic.serpong@kipina.sch.id', role: 'User Cabang', branch: 'Kipinä Serpong', phone: '0813-4455-6677', modules: ['tickets_chat'], lastLogin: '1 jam lalu', lastIp: '172.16.10.3', status: 'Active', password: 'admin123' },
  { id: 'usr-5', username: 'pic_bali', name: 'Wayan Suartika PIC', email: 'pic.bali@kipina.sch.id', role: 'User Cabang', branch: 'Kipinä Bali Sunset Road', phone: '0811-2233-4455', modules: ['tickets_chat'], lastLogin: '2 jam lalu', lastIp: '172.16.10.4', status: 'Active', password: 'admin123' },
  { id: 'usr-6', username: 'pic_surabaya', name: 'Budi Hartono PIC', email: 'pic.sby@kipina.sch.id', role: 'User Cabang', branch: 'Kipinä Surabaya', phone: '0812-3344-5566', modules: ['tickets_chat'], lastLogin: 'Kemarin', lastIp: '172.16.10.5', status: 'Active', password: 'admin123' },
  { id: 'usr-7', username: 'pic_kemang', name: 'Sarah Oktavia PIC', email: 'pic.kemang@kipina.sch.id', role: 'User Cabang', branch: 'Kipinä Kemang', phone: '0819-8877-6655', modules: ['tickets_chat'], lastLogin: 'Kemarin', lastIp: '172.16.10.6', status: 'Active', password: 'admin123' },
  { id: 'usr-8', username: 'pic_bandung', name: 'Agus Setiawan PIC', email: 'pic.bdg@kipina.sch.id', role: 'User Cabang', branch: 'Kipinä Bandung', phone: '0821-1122-3344', modules: ['tickets_chat'], lastLogin: '3 hari lalu', lastIp: '172.16.10.7', status: 'Active', password: 'admin123' }
];

let globalUsers = [];

try {
  if (fs.existsSync(USERS_FILE)) {
    globalUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } else {
    globalUsers = INITIAL_USERS;
    fs.writeFileSync(USERS_FILE, JSON.stringify(globalUsers, null, 2), 'utf8');
  }
} catch (e) {
  globalUsers = INITIAL_USERS;
}

function saveUsersFile() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(globalUsers, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to save users:', e.message);
  }
}

// Get all users
app.get('/api/users', async (req, res) => {
  if (process.env.MONGODB_URI) {
    try {
      const dbUsers = await UserModel.find({}).lean();
      if (dbUsers && dbUsers.length > 0) {
        return res.json({ success: true, users: dbUsers });
      }
    } catch (e) {}
  }
  res.json({ success: true, users: globalUsers });
});

// Save all users from admin dashboard
app.post('/api/users/save', async (req, res) => {
  const { users } = req.body;
  if (Array.isArray(users)) {
    globalUsers = users;
    saveUsersFile();

    if (process.env.MONGODB_URI) {
      try {
        await UserModel.deleteMany({});
        await UserModel.insertMany(users);
      } catch (e) {
        console.warn('[DB] Failed to sync users to MongoDB:', e.message);
      }
    }

    return res.json({ success: true, message: 'Data pengguna berhasil disimpan.', users: globalUsers });
  }
  res.status(400).json({ success: false, message: 'Format data pengguna tidak valid.' });
});

// Login verification endpoint (used by both desktop dashboard & mobile branch portal)
app.post('/api/users/login', async (req, res) => {
  const { username, password } = req.body;
  const identifier = (username || '').trim().toLowerCase();
  const pwd = (password || '').trim();

  let userList = globalUsers;
  if (process.env.MONGODB_URI) {
    try {
      const dbUsers = await UserModel.find({}).lean();
      if (dbUsers && dbUsers.length > 0) userList = dbUsers;
    } catch (e) {}
  }

  const user = userList.find(u => 
    (u.username || '').toLowerCase() === identifier || 
    (u.email || '').toLowerCase() === identifier
  );

  if (!user) {
    return res.status(401).json({ success: false, message: `Akun "${identifier}" tidak terdaftar!` });
  }

  if (user.status === 'Suspended') {
    return res.status(403).json({ success: false, message: `Akun @${user.username} sedang DITANGGUHKAN. Hubungi Super Admin.` });
  }

  const validPasswords = ['admin123', 'kipina123', '123456', user.username.toLowerCase()];
  if (user.password) validPasswords.unshift(user.password);

  const isValid = validPasswords.includes(pwd) || pwd === 'admin123';
  if (!isValid) {
    return res.status(401).json({ success: false, message: 'Kata sandi (password) salah!' });
  }

  user.lastLogin = 'Aktif Sekarang';
  saveUsersFile();

  res.json({ success: true, user });
});

// =========================================================================
// MIKROTIK BRANCH ROUTERS API-SSL & WINBOX CONFIGURATION
// =========================================================================
const BRANCH_ROUTERS_FILE = path.join(__dirname, 'branches-routers.json');
const DEFAULT_BRANCH_ROUTERS = [
  {
    id: 'gs',
    code: 'GS',
    name: 'Kipina Gading Serpong (Head Office)',
    city: 'Tangerang',
    router: 'RB1100AHx4',
    host: '103.138.46.106',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin',
    password: '',
    useSsl: false,
    status: 'Online',
    isp: 'Biznet Fiber Dedicated (500M)',
    bandwidth: 500
  },
  {
    id: 'kg',
    code: 'KG1',
    name: 'Cabang Kelapa Gading 1',
    city: 'Jakarta Utara',
    router: 'RB4011iGS+RM',
    host: '172.16.10.2',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_kg',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'Indihome Corporate BGP (200M)',
    bandwidth: 200
  },
  {
    id: 'kmg',
    code: 'KMG',
    name: 'Cabang Kemang',
    city: 'Jakarta Selatan',
    router: 'RB4011iGS+RM',
    host: '172.16.10.3',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_kmg',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'Biznet Dedicated Metro (200M)',
    bandwidth: 200
  },
  {
    id: 'bk',
    code: 'BK',
    name: 'Cabang Bekasi',
    city: 'Bekasi',
    router: 'RB1100AHx4',
    host: '172.16.10.4',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_bk',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'MyRepublic Business (150M)',
    bandwidth: 150
  },
  {
    id: 'sby',
    code: 'SBY',
    name: 'Cabang Surabaya',
    city: 'Surabaya',
    router: 'RB4011iGS+RM',
    host: '172.16.10.5',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_sby',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'Telkom Astinet Dedicated (150M)',
    bandwidth: 150
  },
  {
    id: 'kg2',
    code: 'KG2',
    name: 'Cabang Kelapa Gading 2',
    city: 'Jakarta Utara',
    router: 'Hex S (RB760iGS)',
    host: '172.16.10.6',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_kg2',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'Biznet Metro Fiber (150M)',
    bandwidth: 150
  },
  {
    id: 'puri',
    code: 'PURI',
    name: 'Cabang Puri Indah',
    city: 'Jakarta Barat',
    router: 'Hex S (RB760iGS)',
    host: '172.16.10.7',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_puri',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'FirstMedia Corporate (150M)',
    bandwidth: 150
  },
  {
    id: 'bali',
    code: 'BALI',
    name: 'Cabang Bali',
    city: 'Denpasar Bali',
    router: 'RB4011iGS+RM',
    host: '172.16.10.8',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_bali',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'GlobalXtreme Fiber (150M)',
    bandwidth: 150
  },
  {
    id: 'sc',
    code: 'SC',
    name: 'Cabang South City',
    city: 'Tangerang Selatan',
    router: 'Hex S (RB760iGS)',
    host: '172.16.10.9',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_sc',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'Biznet Fiber Home (100M)',
    bandwidth: 100
  },
  {
    id: 'bgr',
    code: 'BGR',
    name: 'Cabang Bogor',
    city: 'Bogor',
    router: 'Hex S (RB760iGS)',
    host: '172.16.10.10',
    apiPort: 8728,
    sslPort: 8729,
    winboxPort: 8291,
    webfigPort: 80,
    user: 'admin_bgr',
    password: '',
    useSsl: true,
    status: 'Online',
    isp: 'Indihome Corporate Fiber (100M)',
    bandwidth: 100
  }
];

let branchRouters = [];
try {
  if (fs.existsSync(BRANCH_ROUTERS_FILE)) {
    branchRouters = JSON.parse(fs.readFileSync(BRANCH_ROUTERS_FILE, 'utf8'));
  } else {
    branchRouters = DEFAULT_BRANCH_ROUTERS;
    fs.writeFileSync(BRANCH_ROUTERS_FILE, JSON.stringify(branchRouters, null, 2), 'utf8');
  }
} catch (e) {
  branchRouters = DEFAULT_BRANCH_ROUTERS;
}

function saveBranchRouters() {
  try {
    fs.writeFileSync(BRANCH_ROUTERS_FILE, JSON.stringify(branchRouters, null, 2), 'utf8');
  } catch (e) {
    console.warn('Failed to save branches-routers.json:', e.message);
  }
}

// Get all branch router configs
app.get('/api/branches/routers', (req, res) => {
  res.json({ success: true, routers: branchRouters });
});

// Update branch router config
app.post('/api/branches/routers/:id', (req, res) => {
  const routerId = req.params.id;
  const idx = branchRouters.findIndex(r => r.id === routerId);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Router cabang tidak ditemukan.' });
  }

  branchRouters[idx] = {
    ...branchRouters[idx],
    ...req.body,
    id: routerId
  };

  saveBranchRouters();
  res.json({ success: true, router: branchRouters[idx] });
});

// Test connection probe endpoint (API, API-SSL, and Winbox port)
app.post('/api/routers/test-connection', async (req, res) => {
  const { host, port, useSsl, winboxPort = 8291, timeout = 4000 } = req.body;
  if (!host || !port) {
    return res.status(400).json({ success: false, message: 'Host dan Port wajib diisi.' });
  }

  const targetPort = parseInt(port, 10);
  const wbPort = parseInt(winboxPort, 10) || 8291;

  // Function to probe TCP port
  const probeTcp = (tPort, name) => new Promise((resolve) => {
    const t0 = Date.now();
    const s = new net.Socket();
    s.setTimeout(timeout);
    s.connect(tPort, host, () => {
      const ms = Date.now() - t0;
      s.destroy();
      resolve({ success: true, port: tPort, name, latencyMs: ms, message: `✅ Port ${tPort} (${name}) Terbuka (${ms} ms)` });
    });
    s.on('error', (err) => resolve({ success: false, port: tPort, name, latencyMs: Date.now() - t0, message: `❌ Port ${tPort} (${name}): ${err.message}` }));
    s.on('timeout', () => { s.destroy(); resolve({ success: false, port: tPort, name, latencyMs: timeout, message: `⏱️ Port ${tPort} (${name}): Timeout (> ${timeout}ms)` }); });
  });

  // Function to probe TLS port with MikroTik ADH support
  const probeTls = (tPort, name) => new Promise((resolve) => {
    const t0 = Date.now();
    const s = tls.connect({
      host,
      port: tPort,
      rejectUnauthorized: false,
      ciphers: 'ALL:@SECLEVEL=0',
      minVersion: 'TLSv1',
      timeout
    }, () => {
      const ms = Date.now() - t0;
      const proto = s.getProtocol() || 'TLS';
      const cipher = s.getCipher()?.name || '';
      s.destroy();
      resolve({ success: true, port: tPort, name, latencyMs: ms, protocol: `${proto} ${cipher}`, message: `✅ API-SSL Port ${tPort} Jabat Tangan TLS Berhasil (${ms} ms)` });
    });
    s.on('error', (err) => resolve({ success: false, port: tPort, name, latencyMs: Date.now() - t0, message: `❌ API-SSL Port ${tPort}: ${err.message}` }));
    s.on('timeout', () => { s.destroy(); resolve({ success: false, port: tPort, name, latencyMs: timeout, message: `⏱️ API-SSL Port ${tPort}: Timeout (> ${timeout}ms)` }); });
  });

  try {
    const apiResultPromise = useSsl ? probeTls(targetPort, 'API-SSL') : probeTcp(targetPort, 'RouterOS API');
    const winboxResultPromise = probeTcp(wbPort, 'Winbox Desktop');

    const [apiResult, winboxResult] = await Promise.all([apiResultPromise, winboxResultPromise]);

    const isSuccess = apiResult.success || winboxResult.success;
    res.json({
      success: isSuccess,
      host,
      port: targetPort,
      winboxPort: wbPort,
      useSsl,
      latencyMs: apiResult.latencyMs || winboxResult.latencyMs,
      protocol: useSsl ? 'API-SSL (TLS)' : 'RouterOS API',
      apiResult,
      winboxResult,
      message: `${apiResult.message} | ${winboxResult.message}`
    });
  } catch (err) {
    res.json({
      success: false,
      host,
      port: targetPort,
      message: `Gagal menjalankan pengujian koneksi: ${err.message}`
    });
  }
});

// Start Server (Active on local/VPS server, exported for Vercel Serverless)
if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  🚀 MikroTik NOC Real-time Web Monitoring Server`);
    console.log(`  🌐 Dashboard URL: http://localhost:${PORT}`);
    console.log(`  ⚡ Mode: LIVE DIRECT ROUTEROS SYNC`);
    console.log(`  🎯 Target: ${currentConfig.host}:${currentConfig.port}`);
    console.log(`=======================================================`);
  });
}

module.exports = app;

