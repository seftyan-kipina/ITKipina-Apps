/**
 * ENTERPRISE NOC TOPOLOGY ENGINE FOR MIKROTIK ROUTEROS
 * Features dynamic router interface auto-discovery, interactive drag & drop,
 * pan & zoom, dynamic particle flow rates, and deep node inspector.
 */

class NocTopologyMap {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    // Pan and zoom state
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDraggingCanvas = false;
    this.dragStart = { x: 0, y: 0 };

    // Node drag state
    this.draggedNode = null;
    this.selectedNode = null;
    this.hoveredNode = null;

    this.nodes = [];
    this.links = [];
    this.particles = [];
    this.layoutMode = 'tree'; // 'tree' or 'star'

    this.routerData = null;
    this.animationFrameId = null;

    this.initEvents();
    this.buildDefaultTopology();
    this.startAnimation();
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize());
    this.resize();

    // Mouse down for node drag or canvas pan
    this.canvas.addEventListener('mousedown', (e) => {
      const pos = this.getCanvasCoords(e);
      const clickedNode = this.getNodeAt(pos.x, pos.y);

      if (clickedNode) {
        this.draggedNode = clickedNode;
        this.selectedNode = clickedNode;
        this.render();
        this.notifyNodeSelected(clickedNode);
      } else {
        this.isDraggingCanvas = true;
        this.dragStart = { x: e.clientX - this.panX, y: e.clientY - this.panY };
        this.selectedNode = null;
        this.notifyNodeSelected(null);
        this.render();
      }
    });

    // Mouse move for node dragging, canvas panning, hover effects
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.draggedNode) {
        const pos = this.getCanvasCoords(e);
        this.draggedNode.x = pos.x;
        this.draggedNode.y = pos.y;
        this.render();
      } else if (this.isDraggingCanvas) {
        this.panX = e.clientX - this.dragStart.x;
        this.panY = e.clientY - this.dragStart.y;
        this.render();
      } else {
        const pos = this.getCanvasCoords(e);
        const hovered = this.getNodeAt(pos.x, pos.y);
        if (hovered !== this.hoveredNode) {
          this.hoveredNode = hovered;
          this.canvas.style.cursor = hovered ? 'pointer' : 'default';
          this.render();
        }
      }
    });

    // Mouse up
    window.addEventListener('mouseup', () => {
      this.draggedNode = null;
      this.isDraggingCanvas = false;
    });

    // Mouse Wheel Zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newScale = Math.min(2.5, Math.max(0.4, this.scale * zoomFactor));

      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
      this.scale = newScale;
      this.render();
    }, { passive: false });

    // Double click to reset view or focus
    this.canvas.addEventListener('dblclick', (e) => {
      const pos = this.getCanvasCoords(e);
      const clicked = this.getNodeAt(pos.x, pos.y);
      if (clicked) {
        this.focusOnNode(clicked);
      } else {
        this.resetView();
      }
    });
  }

  getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    return {
      x: (clientX - this.panX) / this.scale,
      y: (clientY - this.panY) / this.scale
    };
  }

  getNodeAt(x, y) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const r = node.isCore ? 34 : 24;
      if (Math.hypot(node.x - x, node.y - y) <= r) {
        return node;
      }
    }
    return null;
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 800;
    this.height = rect.height || 580;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  resetView() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.render();
  }

  focusOnNode(node) {
    this.scale = 1.3;
    this.panX = this.width / 2 - node.x * this.scale;
    this.panY = this.height / 2 - node.y * this.scale;
    this.render();
  }

  zoomIn() {
    this.scale = Math.min(2.5, this.scale * 1.2);
    this.render();
  }

  zoomOut() {
    this.scale = Math.max(0.4, this.scale * 0.83);
    this.render();
  }

  notifyNodeSelected(node) {
    if (window.onTopologyNodeSelect) {
      window.onTopologyNodeSelect(node);
    }
  }

  /**
   * Dynamically build or update topology based on live RouterOS data & 9 Kipina Branches
   */
  updateFromTelemetry(data) {
    if (!data) return;
    this.routerData = data;

    const router = data.router || {};
    const pppoeClients = data.pppoeClients || [];
    const hotspotCount = (data.hotspotUsers || []).length;
    const dhcpCount = (data.dhcpLeases || []).length;
    const coreId = router.identity || 'Kipina_GS';

    const coreNode = this.nodes.find(n => n.id === 'core');

    // Build topology if not yet built or core identity changed
    if (!coreNode || coreNode.name !== coreId || this.nodes.length < 10) {
      this.generateDynamicTopology(data);
      return;
    }

    // 1. Update Core Router Node
    coreNode.name = coreId;
    coreNode.sub = `${router.model || 'RB1100AHx4'} (${router.version || 'ROS'})`;
    coreNode.cpu = `${router.cpuLoad || 0}% CPU`;
    coreNode.temp = `${router.temperature || 42}°C`;
    coreNode.details = {
      model: router.model,
      version: router.version,
      uptime: router.uptime,
      cpu: `${router.cpuLoad || 0}%`,
      temp: `${router.temperature || 42}°C`,
      voltage: `${router.voltage || 24}V`
    };

    // 2. Synchronize All 9 Kipina Branch Nodes with Active Tunnel Sessions
    this.nodes.forEach(node => {
      if (node.isBranch) {
        const session = pppoeClients.find(t => {
          const addr = (t.address || '').trim();
          const name = (t.name || '').toLowerCase();
          return addr === node.ip || name === node.name.toLowerCase() || name === node.id.toLowerCase();
        });

        if (session) {
          node.status = 'online';
          node.sub = node.ip;
          node.rx = NocTrafficChart.formatSpeed(session.rxRate || 0);
          node.tx = NocTrafficChart.formatSpeed(session.txRate || 0);
          node.uptime = session.uptime || 'Active';
          node.latency = (session.latencyMs || 12.4) + ' ms';
          node.callerId = session.callerId || '-';
          node.ifaceName = `<l2tp-${node.name}>`;
        } else {
          node.status = 'down';
          node.sub = `${node.ip} (OFFLINE)`;
          node.rx = '0 bps';
          node.tx = '0 bps';
          node.uptime = 'Terputus';
          node.latency = 'Timeout';
          node.callerId = 'Tidak Terhubung';
          node.ifaceName = `<l2tp-${node.name}>`;
        }
      } else if (node.id === 'lan_bridge') {
        node.sub = `${dhcpCount} LAN Leases`;
      } else if (node.id === 'hotspot_ap') {
        node.sub = `${hotspotCount} User Online`;
      }
    });

    // Re-render canvas
    this.render();
  }

  /**
   * Generate intelligent layout featuring Core Router & all 9 Kipina Branches
   */
  generateDynamicTopology(data) {
    const w = this.width || 900;
    const h = this.height || 620;
    const router = data?.router || {};
    const pppoeClients = data?.pppoeClients || [];
    const hotspotCount = (data?.hotspotUsers || []).length;
    const dhcpCount = (data?.dhcpLeases || []).length;

    const newNodes = [];
    const newLinks = [];

    // 9 Registered Kipina Branches
    const REGISTERED_BRANCHES = [
      { id: 'kg', name: 'Kipina_KG', location: 'Kelapa Gading 1', ip: '172.16.10.2' },
      { id: 'kmg', name: 'Kipina_KMG', location: 'Kemang', ip: '172.16.10.3' },
      { id: 'bk', name: 'Kipina_BK', location: 'Bekasi', ip: '172.16.10.4' },
      { id: 'sby', name: 'Kipina_SBY', location: 'Surabaya', ip: '172.16.10.5' },
      { id: 'kg2', name: 'Kipina_KG2', location: 'Kelapa Gading 2', ip: '172.16.10.6' },
      { id: 'puri', name: 'Kipina_Puri', location: 'Puri Indah', ip: '172.16.10.7' },
      { id: 'bali', name: 'Kipina_Bali', location: 'Bali', ip: '172.16.10.8' },
      { id: 'sc', name: 'Kipina_SC', location: 'South City', ip: '172.16.10.9' },
      { id: 'bgr', name: 'Kipina_BGR', location: 'Bogor', ip: '172.16.10.10' }
    ];

    // 1. Center Core Router Node
    const coreX = w * 0.50;
    const coreY = h * 0.36;
    newNodes.push({
      id: 'core',
      name: router.identity || 'Kipina_GS',
      type: 'router',
      sub: `${router.model || 'RB1100AHx4'} (${router.version || '6.49.10'})`,
      ip: currentConfig?.host || '103.138.46.106',
      x: coreX,
      y: coreY,
      isCore: true,
      status: 'online',
      cpu: `${router.cpuLoad || 0}% CPU`,
      temp: `${router.temperature || 42}°C`,
      details: {
        identity: router.identity || 'Kipina_GS',
        model: router.model || 'RB1100AHx4',
        architecture: router.architecture || 'tile / arm',
        uptime: router.uptime || 'Active'
      }
    });

    // 2. WAN Internet Cloud Node (Top Center)
    const wanX = coreX;
    const wanY = h * 0.12;
    newNodes.push({
      id: 'wan_cloud',
      name: 'Internet Gateway (ISP)',
      type: 'cloud',
      ifaceName: 'ether1 (WAN)',
      sub: 'Main Uplink 1 Gbps',
      ip: '103.138.46.105',
      x: wanX,
      y: wanY,
      status: 'online',
      rx: '750 Mbps',
      tx: '180 Mbps'
    });

    newLinks.push({
      from: 'wan_cloud',
      to: 'core',
      label: 'WAN Uplink'
    });

    // 3. Local Subsystems (Left & Right Flanks)
    // Left: Local LAN Bridge
    newNodes.push({
      id: 'lan_bridge',
      name: 'LAN Bridge Network',
      type: 'lan',
      ifaceName: 'bridge-lan',
      sub: `${dhcpCount || 26} LAN Leases`,
      ip: '192.168.1.1/24',
      x: w * 0.14,
      y: coreY,
      status: 'online'
    });
    newLinks.push({
      from: 'core',
      to: 'lan_bridge',
      label: 'LAN 1G'
    });

    // Right: Hotspot WiFi Pool
    newNodes.push({
      id: 'hotspot_ap',
      name: 'Hotspot Public WiFi',
      type: 'ap',
      ifaceName: 'vlan-hotspot',
      sub: `${hotspotCount || 15} User Online`,
      ip: '192.168.20.1/24',
      x: w * 0.86,
      y: coreY,
      status: 'online'
    });
    newLinks.push({
      from: 'core',
      to: 'hotspot_ap',
      label: 'WiFi Hotspot'
    });

    // 4. Place 9 Kipina Branches in 2 Balanced Arc Rows Below Core
    // Row 1 (5 Branches: KG, KMG, BK, SBY, KG2)
    const row1 = REGISTERED_BRANCHES.slice(0, 5);
    const row1Y = h * 0.64;
    row1.forEach((b, idx) => {
      const bX = w * (0.12 + (0.76 / 4) * idx);
      const session = pppoeClients.find(t => {
        const addr = (t.address || '').trim();
        const name = (t.name || '').toLowerCase();
        return addr === b.ip || name === b.name.toLowerCase();
      });

      const isOnline = Boolean(session);
      newNodes.push({
        id: `branch_${b.id}`,
        name: b.name,
        branchLocation: b.location,
        type: 'branch',
        isBranch: true,
        ifaceName: `<l2tp-${b.name}>`,
        sub: isOnline ? b.ip : `${b.ip} (OFFLINE)`,
        ip: b.ip,
        x: bX,
        y: row1Y,
        status: isOnline ? 'online' : 'down',
        rx: isOnline ? NocTrafficChart.formatSpeed(session.rxRate || 0) : '0 bps',
        tx: isOnline ? NocTrafficChart.formatSpeed(session.txRate || 0) : '0 bps',
        uptime: isOnline ? (session.uptime || 'Active') : 'Terputus',
        latency: isOnline ? ((session.latencyMs || 12.4) + ' ms') : 'Timeout',
        callerId: isOnline ? (session.callerId || '-') : 'Tidak Terhubung'
      });

      newLinks.push({
        from: 'core',
        to: `branch_${b.id}`,
        label: `L2TP ${b.ip.replace('172.16.10.', '.')}`
      });
    });

    // Row 2 (4 Branches: Puri, Bali, SC, BGR)
    const row2 = REGISTERED_BRANCHES.slice(5, 9);
    const row2Y = h * 0.86;
    row2.forEach((b, idx) => {
      const bX = w * (0.20 + (0.60 / 3) * idx);
      const session = pppoeClients.find(t => {
        const addr = (t.address || '').trim();
        const name = (t.name || '').toLowerCase();
        return addr === b.ip || name === b.name.toLowerCase();
      });

      const isOnline = Boolean(session);
      newNodes.push({
        id: `branch_${b.id}`,
        name: b.name,
        branchLocation: b.location,
        type: 'branch',
        isBranch: true,
        ifaceName: `<l2tp-${b.name}>`,
        sub: isOnline ? b.ip : `${b.ip} (OFFLINE)`,
        ip: b.ip,
        x: bX,
        y: row2Y,
        status: isOnline ? 'online' : 'down',
        rx: isOnline ? NocTrafficChart.formatSpeed(session.rxRate || 0) : '0 bps',
        tx: isOnline ? NocTrafficChart.formatSpeed(session.txRate || 0) : '0 bps',
        uptime: isOnline ? (session.uptime || 'Active') : 'Terputus',
        latency: isOnline ? ((session.latencyMs || 12.4) + ' ms') : 'Timeout',
        callerId: isOnline ? (session.callerId || '-') : 'Tidak Terhubung'
      });

      newLinks.push({
        from: 'core',
        to: `branch_${b.id}`,
        label: `L2TP ${b.ip.replace('172.16.10.', '.')}`
      });
    });

    this.nodes = newNodes;
    this.links = newLinks;
    this.initParticles();
    this.render();
  }

  buildDefaultTopology() {
    this.generateDynamicTopology(this.routerData || {
      router: { identity: 'Kipina_GS', model: 'RB1100AHx4', cpuLoad: 12, temperature: 42 },
      pppoeClients: [
        { name: 'Kipina_KG', address: '172.16.10.2', rxRate: 15400000, txRate: 4200000, uptime: '14d 02:10', latencyMs: 11.2 },
        { name: 'Kipina_KMG', address: '172.16.10.3', rxRate: 12100000, txRate: 3100000, uptime: '10d 15:44', latencyMs: 14.5 },
        { name: 'Kipina_BK', address: '172.16.10.4', rxRate: 18900000, txRate: 5400000, uptime: '19d 08:30', latencyMs: 13.1 },
        { name: 'Kipina_SBY', address: '172.16.10.5', rxRate: 24500000, txRate: 8100000, uptime: '22d 11:15', latencyMs: 24.8 },
        { name: 'Kipina_KG2', address: '172.16.10.6', rxRate: 14200000, txRate: 3900000, uptime: '08d 19:22', latencyMs: 10.9 },
        { name: 'Kipina_Puri', address: '172.16.10.7', rxRate: 16800000, txRate: 4500000, uptime: '12d 06:14', latencyMs: 12.3 },
        { name: 'Kipina_Bali', address: '172.16.10.8', rxRate: 21300000, txRate: 6700000, uptime: '31d 04:50', latencyMs: 28.4 },
        { name: 'Kipina_SC', address: '172.16.10.9', rxRate: 19400000, txRate: 5200000, uptime: '15d 14:08', latencyMs: 11.8 },
        { name: 'Kipina_BGR', address: '172.16.10.10', rxRate: 13700000, txRate: 3800000, uptime: '09d 21:35', latencyMs: 16.2 }
      ],
      hotspotUsers: new Array(15),
      dhcpLeases: new Array(26)
    });
  }

  initParticles() {
    this.particles = [];
    for (let i = 0; i < this.links.length; i++) {
      this.particles.push({
        linkIdx: i,
        progress: Math.random(),
        speed: 0.007 + Math.random() * 0.005,
        color: i % 2 === 0 ? '#06b6d4' : '#a855f7'
      });
      this.particles.push({
        linkIdx: i,
        progress: (Math.random() + 0.5) % 1,
        speed: 0.007 + Math.random() * 0.005,
        color: i % 2 === 0 ? '#38bdf8' : '#c084fc'
      });
    }
  }

  startAnimation() {
    const loop = () => {
      // Advance animated flow particles
      for (const p of this.particles) {
        p.progress = (p.progress + p.speed) % 1;
      }
      this.render();
      this.animationFrameId = requestAnimationFrame(loop);
    };
    loop();
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Apply Pan and Zoom Transform
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);

    // Draw Subtle Grid Background
    this.drawGrid(ctx, w, h);

    // 1. Draw Links & Connection Cables
    this.links.forEach((link, idx) => {
      const src = this.nodes.find(n => n.id === link.from);
      const dst = this.nodes.find(n => n.id === link.to);
      if (!src || !dst) return;

      const isHovered = (this.hoveredNode && (this.hoveredNode.id === src.id || this.hoveredNode.id === dst.id));
      const isSelected = (this.selectedNode && (this.selectedNode.id === src.id || this.selectedNode.id === dst.id));

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(dst.x, dst.y);

      if (src.status === 'down' || dst.status === 'down') {
        ctx.strokeStyle = 'rgba(225, 29, 72, 0.4)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 1.5;
      } else if (isSelected || isHovered) {
        ctx.strokeStyle = '#0284c7';
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
      } else {
        ctx.strokeStyle = '#cbd5e1';
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Link Label (midpoint badge)
      if (link.label) {
        const midX = (src.x + dst.x) / 2;
        const midY = (src.y + dst.y) / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(midX - 35, midY - 9, 70, 18);
        ctx.strokeStyle = '#e2e8f0';
        ctx.strokeRect(midX - 35, midY - 9, 70, 18);

        ctx.font = '9px "Fira Code", monospace';
        ctx.fillStyle = '#475569';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(link.label, midX, midY);
      }
    });

    // 2. Draw Animated Flow Particles
    this.particles.forEach(p => {
      const link = this.links[p.linkIdx];
      if (!link) return;
      const src = this.nodes.find(n => n.id === link.from);
      const dst = this.nodes.find(n => n.id === link.to);
      if (!src || !dst || src.status === 'down' || dst.status === 'down') return;

      const px = src.x + (dst.x - src.x) * p.progress;
      const py = src.y + (dst.y - src.y) * p.progress;

      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = p.color === '#06b6d4' || p.color === '#38bdf8' ? '#0284c7' : '#7c3aed';
      ctx.fill();
      ctx.restore();
    });

    // 3. Draw Nodes
    this.nodes.forEach(node => {
      const isSelected = this.selectedNode && this.selectedNode.id === node.id;
      const isHovered = this.hoveredNode && this.hoveredNode.id === node.id;
      const radius = node.isCore ? 30 : 22;

      // Outer Pulse Halo
      ctx.save();
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isSelected ? 10 : (isHovered ? 6 : 4)), 0, Math.PI * 2);
      if (node.status === 'down') {
        ctx.fillStyle = 'rgba(225, 29, 72, 0.12)';
      } else if (node.isCore) {
        ctx.fillStyle = 'rgba(2, 132, 199, 0.15)';
      } else {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      }
      ctx.fill();
      ctx.restore();

      // Node Body Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Node Border
      if (isSelected) {
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 3;
      } else if (node.status === 'down') {
        ctx.strokeStyle = '#e11d48';
        ctx.lineWidth = 2;
      } else if (node.isCore) {
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 2.5;
      } else {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
      }
      ctx.stroke();

      // Node Icon / Glyphs
      ctx.fillStyle = node.isCore ? '#0284c7' : '#0f172a';
      ctx.font = node.isCore ? '15px "Inter", sans-serif' : '12px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let icon = '●';
      if (node.type === 'router') icon = '⚡';
      else if (node.type === 'cloud') icon = '☁';
      else if (node.type === 'branch') icon = '🏢';
      else if (node.type === 'switch') icon = '🔀';
      else if (node.type === 'wireless') icon = '📡';
      else if (node.type === 'server') icon = '🖥';
      else if (node.type === 'clients') icon = '👥';
      else if (node.type === 'lan') icon = '🏢';
      else if (node.type === 'ap') icon = '📶';
      ctx.fillText(icon, node.x, node.y);

      // Node Label
      ctx.font = node.isCore ? '700 12px "Inter", sans-serif' : '600 11px "Inter", sans-serif';
      ctx.fillStyle = isSelected ? '#0284c7' : '#0f172a';
      ctx.fillText(node.name, node.x, node.y + radius + 14);

      // Node Subtext / IP / CPU
      ctx.font = '10px "Fira Code", monospace';
      ctx.fillStyle = node.status === 'down' ? '#e11d48' : '#64748b';
      const subLabel = node.sub || node.ip || '';
      ctx.fillText(subLabel, node.x, node.y + radius + 27);
    });

    ctx.restore();
  }

  drawGrid(ctx, w, h) {
    const gridSize = 40;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = '#e2e8f0';

    const startX = -this.panX / this.scale - gridSize;
    const endX = (w - this.panX) / this.scale + gridSize;
    const startY = -this.panY / this.scale - gridSize;
    const endY = (h - this.panY) / this.scale + gridSize;

    for (let x = Math.floor(startX / gridSize) * gridSize; x < endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    for (let y = Math.floor(startY / gridSize) * gridSize; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }
  }
}

window.NocTopologyMap = NocTopologyMap;
