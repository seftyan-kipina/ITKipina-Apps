/**
 * High-Fidelity Realistic MikroTik RouterOS NOC Simulator
 * Generates dynamic, realistic telemetry and real-time networking data.
 */

class MikroTikSimulator {
  constructor() {
    this.startTime = Date.now() - (14 * 86400000 + 5 * 3600000 + 22 * 60000); // 14 days ago
    this.identity = 'NOC-CORE-CCR2004-JKT01';
    this.model = 'CCR2004-1G-12S+2XS';
    this.version = '7.15.2 (stable)';
    this.arch = 'arm64';
    this.cpuCores = 16;
    this.cpuFreq = 1700;
    this.totalMemory = 4294967296; // 4 GB
    this.totalHdd = 134217728; // 128 MB

    this.simulatedSpike = false;
    this.tickCount = 0;

    // Interface definitions
    this.interfaces = [
      {
        id: '*1',
        name: 'sfp-sfpplus1-WAN-Telkom',
        type: 'ether',
        macAddress: '48:8F:5A:12:34:01',
        running: true,
        disabled: false,
        comment: 'Uplink 10G Telkom Astinet',
        speed: '10Gbps',
        mtu: 1500,
        baseRx: 740 * 1024 * 1024, // 740 Mbps
        baseTx: 190 * 1024 * 1024, // 190 Mbps
        rxBytes: 1584920391000,
        txBytes: 439201948000,
        rxPackets: 928392100,
        txPackets: 382910400,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*2',
        name: 'ether1-WAN-Indosat',
        type: 'ether',
        macAddress: '48:8F:5A:12:34:02',
        running: true,
        disabled: false,
        comment: 'Backup Uplink 1G Indosat BGP',
        speed: '1Gbps',
        mtu: 1500,
        baseRx: 420 * 1024 * 1024, // 420 Mbps
        baseTx: 110 * 1024 * 1024, // 110 Mbps
        rxBytes: 894029100200,
        txBytes: 239019200100,
        rxPackets: 512039200,
        txPackets: 192049100,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 1
      },
      {
        id: '*3',
        name: 'sfp-sfpplus2-Trunk-Distribution',
        type: 'ether',
        macAddress: '48:8F:5A:12:34:03',
        running: true,
        disabled: false,
        comment: 'Trunk to CRS328 Distribution Switch',
        speed: '10Gbps',
        mtu: 1500,
        baseRx: 610 * 1024 * 1024,
        baseTx: 680 * 1024 * 1024,
        rxBytes: 2490192049100,
        txBytes: 2840192049100,
        rxPackets: 1492039200,
        txPackets: 1692039200,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*4',
        name: 'sfp-sfpplus3-BTS-Tower-North',
        type: 'ether',
        macAddress: '48:8F:5A:12:34:04',
        running: true,
        disabled: false,
        comment: 'Wireless PTP to BTS Tower Kebon Jeruk',
        speed: '1Gbps',
        mtu: 1500,
        baseRx: 245 * 1024 * 1024,
        baseTx: 48 * 1024 * 1024,
        rxBytes: 619204910000,
        txBytes: 119204910000,
        rxPackets: 419204910,
        txPackets: 98402910,
        rxDrops: 2,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*5',
        name: 'sfp-sfpplus4-BTS-Tower-South',
        type: 'ether',
        macAddress: '48:8F:5A:12:34:05',
        running: true,
        disabled: false,
        comment: 'Wireless PTP to BTS Tower Cilandak',
        speed: '1Gbps',
        mtu: 1500,
        baseRx: 195 * 1024 * 1024,
        baseTx: 36 * 1024 * 1024,
        rxBytes: 489204910000,
        txBytes: 89204910000,
        rxPackets: 329204910,
        txPackets: 74402910,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*6',
        name: 'vlan10-Servers-DMZ',
        type: 'vlan',
        macAddress: '48:8F:5A:12:34:06',
        running: true,
        disabled: false,
        comment: 'VLAN 10 Datacenter & Cloud Proxmox Cluster',
        speed: '10Gbps',
        mtu: 1500,
        baseRx: 320 * 1024 * 1024,
        baseTx: 510 * 1024 * 1024,
        rxBytes: 984029104000,
        txBytes: 1484029104000,
        rxPackets: 682039200,
        txPackets: 942039200,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*7',
        name: 'vlan20-Hotspot-Public',
        type: 'vlan',
        macAddress: '48:8F:5A:12:34:07',
        running: true,
        disabled: false,
        comment: 'VLAN 20 Public Guest & Lobby Hotspot',
        speed: '1Gbps',
        mtu: 1500,
        baseRx: 145 * 1024 * 1024,
        baseTx: 28 * 1024 * 1024,
        rxBytes: 429104910000,
        txBytes: 92104910000,
        rxPackets: 284019200,
        txPackets: 68401920,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*8',
        name: 'bridge-LAN-Corporate',
        type: 'bridge',
        macAddress: '48:8F:5A:12:34:08',
        running: true,
        disabled: false,
        comment: 'Bridge LAN Internal Staff & VoIP',
        speed: '1Gbps',
        mtu: 1500,
        baseRx: 95 * 1024 * 1024,
        baseTx: 135 * 1024 * 1024,
        rxBytes: 284019200000,
        txBytes: 394019200000,
        rxPackets: 184019200,
        txPackets: 248019200,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      },
      {
        id: '*9',
        name: 'wg-site2site-VPC',
        type: 'wireguard',
        macAddress: '00:00:00:00:00:00',
        running: true,
        disabled: false,
        comment: 'WireGuard Tunnel to AWS Singapore VPC',
        speed: '1Gbps',
        mtu: 1420,
        baseRx: 68 * 1024 * 1024,
        baseTx: 72 * 1024 * 1024,
        rxBytes: 198402910000,
        txBytes: 218402910000,
        rxPackets: 138402910,
        txPackets: 152402910,
        rxDrops: 0,
        txDrops: 0,
        rxErrors: 0,
        txErrors: 0,
        linkDowns: 0
      }
    ];

    // Seed realistic PPPoE & L2TP VPN Tunnel Clients
    this.pppoeClients = [
      // Enterprise L2TP / IPsec Site-to-Site & Branch Tunnels
      { name: 'branch_surabaya_l2tp', service: 'l2tp', callerId: '180.250.12.98', address: '10.20.30.2', uptime: '14d 08:22:15', profile: 'VPN-L2TP-Branch-50M', rxRate: 48500000, txRate: 36200000, latencyMs: 18.4, status: 'bound' },
      { name: 'branch_bandung_l2tp', service: 'l2tp', callerId: '114.122.44.15', address: '10.20.30.3', uptime: '9d 12:45:00', profile: 'VPN-L2TP-Branch-50M', rxRate: 32400000, txRate: 24100000, latencyMs: 8.2, status: 'bound' },
      { name: 'branch_semarang_l2tp', service: 'l2tp', callerId: '125.160.88.201', address: '10.20.30.4', uptime: '11d 04:19:30', profile: 'VPN-L2TP-Branch-50M', rxRate: 28100000, txRate: 18400000, latencyMs: 14.1, status: 'bound' },
      { name: 'vpn_cctv_cikarang_l2tp', service: 'l2tp', callerId: '36.88.92.14', address: '10.20.30.5', uptime: '6d 19:30:12', profile: 'VPN-L2TP-CCTV-100M', rxRate: 64200000, txRate: 12100000, latencyMs: 6.5, status: 'bound' },
      { name: 'vpn_atm_bca_site44_l2tp', service: 'l2tp', callerId: '103.11.200.12', address: '10.20.30.6', uptime: '14d 01:10:05', profile: 'VPN-L2TP-ATM-10M', rxRate: 4500000, txRate: 4200000, latencyMs: 11.3, status: 'bound' },
      { name: 'vpn_remote_noc_sstp', service: 'sstp', callerId: '182.253.10.45', address: '10.50.10.2', uptime: '02:45:18', profile: 'VPN-SSTP-Admin', rxRate: 18200000, txRate: 15400000, latencyMs: 12.8, status: 'bound' },
      
      // Dedicated & Biz PPPoE Customers
      { name: 'cust_bca_sudirman', service: 'pppoe', callerId: '70:4D:7B:11:A2:31', address: '10.10.10.2', uptime: '12d 04:12:35', profile: 'Profile-100M-Dedicated', rxRate: 74200000, txRate: 81400000, latencyMs: 2.3, status: 'bound' },
      { name: 'cust_mandiri_hq', service: 'pppoe', callerId: '00:1A:2B:64:89:C1', address: '10.10.10.3', uptime: '9d 18:22:10', profile: 'Profile-200M-Dedicated', rxRate: 148000000, txRate: 162000000, latencyMs: 1.9, status: 'bound' },
      { name: 'cust_hotel_santika', service: 'pppoe', callerId: 'E4:8D:8C:3B:55:09', address: '10.10.10.4', uptime: '4d 08:54:19', profile: 'Profile-100M-Biz', rxRate: 64200000, txRate: 18200000, latencyMs: 3.5, status: 'bound' },
      { name: 'cust_kafe_kopi_kenangan', service: 'pppoe', callerId: '18:E8:29:43:88:2F', address: '10.10.10.5', uptime: '14d 02:11:05', profile: 'Profile-50M-Biz', rxRate: 38400000, txRate: 8200000, latencyMs: 4.1, status: 'bound' },
      { name: 'cust_pt_sinarmas_branch', service: 'pppoe', callerId: 'B8:27:EB:10:98:C4', address: '10.10.10.6', uptime: '6d 14:02:44', profile: 'Profile-100M-Biz', rxRate: 82100000, txRate: 24500000, latencyMs: 2.8, status: 'bound' },
      
      // Residential Broadband PPPoE
      { name: 'cust_res_andi_wijaya', service: 'pppoe', callerId: '3C:52:82:11:22:45', address: '10.10.20.12', uptime: '2d 06:19:12', profile: 'Profile-50M-Home', rxRate: 46200000, txRate: 9800000, latencyMs: 5.2, status: 'bound' },
      { name: 'cust_res_budi_santoso', service: 'pppoe', callerId: 'F4:F5:DB:88:31:AA', address: '10.10.20.15', uptime: '7d 11:23:49', profile: 'Profile-100M-Home', rxRate: 92400000, txRate: 14100000, latencyMs: 4.8, status: 'bound' },
      { name: 'cust_res_citra_lestari', service: 'pppoe', callerId: '90:32:4B:C8:10:04', address: '10.10.20.18', uptime: '1d 21:05:30', profile: 'Profile-30M-Home', rxRate: 18400000, txRate: 3200000, latencyMs: 6.1, status: 'bound' },
      { name: 'cust_res_dian_pratama', service: 'pppoe', callerId: '54:E6:FC:3D:88:99', address: '10.10.20.21', uptime: '14d 05:00:11', profile: 'Profile-50M-Home', rxRate: 31200000, txRate: 6400000, latencyMs: 5.5, status: 'bound' }
    ];

    // Seed realistic Hotspot active users
    this.hotspotUsers = [
      { user: 'guest_vip_01', address: '192.168.20.105', mac: '8C:85:90:3A:41:2B', uptime: '02:45:10', bytesIn: 482910491, bytesOut: 58291048, comment: 'Lobby VIP Lounge' },
      { user: 'guest_auditorium_14', address: '192.168.20.118', mac: 'F0:18:98:C4:2B:90', uptime: '01:12:44', bytesIn: 219204910, bytesOut: 19402910, comment: 'Townhall Meeting' },
      { user: 'visitor_it_consultant', address: '192.168.20.134', mac: '38:F9:D3:55:18:AE', uptime: '04:50:22', bytesIn: 984029100, bytesOut: 184029100, comment: 'Server Room Access' },
      { user: 'voucher_10k_4819', address: '192.168.20.155', mac: '7C:2A:DB:88:14:62', uptime: '00:45:18', bytesIn: 104920190, bytesOut: 12049100, comment: 'Cafeteria Public' },
      { user: 'voucher_20k_9921', address: '192.168.20.162', mac: 'A4:83:E7:09:41:C3', uptime: '01:58:39', bytesIn: 349201948, bytesOut: 24920190, comment: 'Co-working Space' },
      { user: 'guest_meeting_room_b', address: '192.168.20.180', mac: '60:F8:1D:91:EE:54', uptime: '03:15:02', bytesIn: 720491029, bytesOut: 98402910, comment: 'Boardroom Presentation' }
    ];

    // Seed realistic DHCP Leases
    this.dhcpLeases = [
      { address: '192.168.88.10', mac: '00:1E:67:88:99:A1', hostName: 'PRX-NODE01-CLUSTER', server: 'dhcp-lan', status: 'bound', expiresAfter: '2d 23:40:10' },
      { address: '192.168.88.11', mac: '00:1E:67:88:99:A2', hostName: 'PRX-NODE02-CLUSTER', server: 'dhcp-lan', status: 'bound', expiresAfter: '2d 23:40:10' },
      { address: '192.168.88.15', mac: 'B8:27:EB:55:12:88', hostName: 'NOC-ZABBIX-MONITOR', server: 'dhcp-lan', status: 'bound', expiresAfter: '2d 22:15:00' },
      { address: '192.168.88.20', mac: '00:0C:29:4F:88:12', hostName: 'SYNOLOGY-NAS-BACKUP', server: 'dhcp-lan', status: 'bound', expiresAfter: '2d 21:04:19' },
      { address: '192.168.88.45', mac: 'E8:80:2E:3B:44:91', hostName: 'CCTV-NVR-MAIN', server: 'dhcp-lan', status: 'bound', expiresAfter: '1d 18:45:30' },
      { address: '192.168.88.78', mac: '3C:22:FB:41:98:2C', hostName: 'MacBook-Pro-NetworkLead', server: 'dhcp-lan', status: 'bound', expiresAfter: '0d 14:22:10' },
      { address: '192.168.88.92', mac: 'F4:D4:88:12:76:E3', hostName: 'Dell-Precision-NOC01', server: 'dhcp-lan', status: 'bound', expiresAfter: '0d 19:10:04' },
      { address: '192.168.88.93', mac: 'F4:D4:88:12:76:E4', hostName: 'Dell-Precision-NOC02', server: 'dhcp-lan', status: 'bound', expiresAfter: '0d 19:11:15' },
      { address: '192.168.88.105', mac: '40:9B:CD:88:99:41', hostName: 'iPhone-15-Director', server: 'dhcp-lan', status: 'bound', expiresAfter: '0d 08:33:12' }
    ];

    // Seed recent RouterOS logs
    this.logs = [
      { id: '*1', time: this.formatTimeAgo(120), topics: 'system,info', message: 'router rebooted by admin: upgrade to RouterOS v7.15.2', severity: 'info' },
      { id: '*2', time: this.formatTimeAgo(95), topics: 'interface,info', message: 'sfp-sfpplus1-WAN-Telkom link up (speed 10Gbps, full duplex)', severity: 'info' },
      { id: '*3', time: this.formatTimeAgo(94), topics: 'interface,info', message: 'ether1-WAN-Indosat link up (speed 1Gbps, full duplex)', severity: 'info' },
      { id: '*4', time: this.formatTimeAgo(70), topics: 'bgp,info', message: 'BGP session 103.11.20.1 (AS13335) state changed to ESTABLISHED', severity: 'info' },
      { id: '*5', time: this.formatTimeAgo(45), topics: 'firewall,warning', message: 'DROP SYN-FLOOD from 185.220.101.5:41920 to 103.144.20.1:443 (defconf drop)', severity: 'warning' },
      { id: '*6', time: this.formatTimeAgo(30), topics: 'pppoe,info', message: 'PPPoE connection established: cust_mandiri_hq assigned 10.10.10.3', severity: 'info' },
      { id: '*7', time: this.formatTimeAgo(15), topics: 'firewall,warning', message: 'DROP PORT-SCAN from 45.143.200.12:51244 to 103.144.20.1:8291 (winbox blocked)', severity: 'warning' },
      { id: '*8', time: this.formatTimeAgo(5), topics: 'dhcp,info', message: 'dhcp-lan assigned 192.168.88.78 to MacBook-Pro-NetworkLead', severity: 'info' }
    ];
  }

  formatTimeAgo(secondsAgo) {
    const d = new Date(Date.now() - secondsAgo * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  getUptimeString() {
    const diff = Math.floor((Date.now() - this.startTime) / 1000);
    const weeks = Math.floor(diff / (86400 * 7));
    const days = Math.floor((diff % (86400 * 7)) / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    return `${weeks > 0 ? weeks + 'w ' : ''}${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /**
   * Main telemetry tick called every 1 second
   */
  getRealtimeSnapshot() {
    this.tickCount++;
    const now = Date.now();
    const timeStr = this.formatTimeAgo(0);

    // Natural sinusoidal time-of-day wave with random jitter
    const sinWave = Math.sin(this.tickCount * 0.15);
    const cosWave = Math.cos(this.tickCount * 0.08);

    // Dynamic CPU calculation (14% - 55% normal, up to 75% on simulated micro-spikes)
    let cpuLoad = Math.floor(22 + (sinWave * 12) + (Math.random() * 8));
    if (this.tickCount % 45 === 0) {
      cpuLoad = Math.floor(68 + Math.random() * 18); // Periodic spike (e.g. BGP route recalculation or crypto tunnel sync)
    }
    cpuLoad = Math.max(8, Math.min(96, cpuLoad));

    // Memory usage (~32% - 38%)
    const freeMemory = Math.floor(this.totalMemory * (0.64 + cosWave * 0.04 + (Math.random() * 0.02)));
    const freeHdd = Math.floor(this.totalHdd * 0.74);

    // Hardware sensors
    const temperature = Math.round((43.5 + sinWave * 2.5 + Math.random() * 0.8) * 10) / 10;
    const voltage = Math.round((24.1 + (Math.random() * 0.2 - 0.1)) * 10) / 10;
    const fanSpeed = Math.floor(3150 + (cpuLoad * 15) + (Math.random() * 80));

    // Update each interface rate dynamically
    let totalRxBps = 0;
    let totalTxBps = 0;

    const updatedInterfaces = this.interfaces.map(iface => {
      // Fluctuate rate by +/- 18% around baseRate
      const jitterFactor = 0.82 + (Math.random() * 0.36) + (sinWave * 0.08);
      const rxRate = Math.floor(iface.baseRx * jitterFactor);
      const txRate = Math.floor(iface.baseTx * jitterFactor);

      // Accumulate total bytes
      iface.rxBytes += rxRate;
      iface.txBytes += txRate;

      const rxPacketsDelta = Math.floor(rxRate / 1100);
      const txPacketsDelta = Math.floor(txRate / 1100);
      iface.rxPackets += rxPacketsDelta;
      iface.txPackets += txPacketsDelta;

      if (iface.name.includes('WAN')) {
        totalRxBps += rxRate;
        totalTxBps += txRate;
      }

      return {
        id: iface.id,
        name: iface.name,
        type: iface.type,
        running: iface.running,
        disabled: iface.disabled,
        comment: iface.comment,
        speed: iface.speed,
        macAddress: iface.macAddress,
        mtu: iface.mtu,
        rxBps: rxRate,
        txBps: txRate,
        rxPacketsPerSec: rxPacketsDelta,
        txPacketsPerSec: txPacketsDelta,
        rxTotalBytes: iface.rxBytes,
        txTotalBytes: iface.txBytes,
        rxDrops: iface.rxDrops,
        txDrops: iface.txDrops,
        rxErrors: iface.rxErrors,
        txErrors: iface.txErrors,
        linkDowns: iface.linkDowns
      };
    });

    // Random new log entry generation every ~10-15 seconds
    if (this.tickCount % 12 === 0) {
      const logTemplates = [
        { topics: 'firewall,warning', message: `DROP Port-Scan from ${185 + Math.floor(Math.random()*60)}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}.${Math.floor(Math.random()*254)}:5${Math.floor(Math.random()*8999)} to 103.144.20.1:8291`, severity: 'warning' },
        { topics: 'dhcp,info', message: `dhcp-lan: assigned 192.168.88.${100 + Math.floor(Math.random()*50)} to client device`, severity: 'info' },
        { topics: 'pppoe,info', message: `PPPoE link quality OK for cust_res_andi_wijaya (MTU 1492)`, severity: 'info' },
        { topics: 'system,info', message: `DNS cache sync OK (${Math.floor(4800 + Math.random()*500)} entries cached)`, severity: 'info' },
        { topics: 'bgp,info', message: `BGP route update received from AS13335 (Prefixes: 942,019)`, severity: 'info' }
      ];
      const randomLog = logTemplates[Math.floor(Math.random() * logTemplates.length)];
      this.logs.unshift({
        id: `*${this.logs.length + 1}`,
        time: timeStr,
        topics: randomLog.topics,
        message: randomLog.message,
        severity: randomLog.severity
      });
      if (this.logs.length > 50) this.logs.pop();
    }

    // Active connections simulation count
    const activeConnectionsCount = Math.floor(2850 + (sinWave * 450) + (Math.random() * 120));

    return {
      timestamp: now,
      timeFormatted: timeStr,
      router: {
        identity: this.identity,
        model: this.model,
        version: this.version,
        architecture: this.arch,
        cpuCores: this.cpuCores,
        cpuFrequency: this.cpuFreq,
        uptime: this.getUptimeString(),
        cpuLoad: cpuLoad,
        freeMemory: freeMemory,
        totalMemory: this.totalMemory,
        freeHdd: freeHdd,
        totalHdd: this.totalHdd,
        temperature: temperature,
        voltage: voltage,
        fanSpeed: fanSpeed,
        boardName: this.model,
        platform: 'MikroTik RouterOS'
      },
      traffic: {
        totalWanRxBps: totalRxBps,
        totalWanTxBps: totalTxBps,
        activePppoeCount: this.pppoeClients.length,
        activeHotspotCount: this.hotspotUsers.length,
        activeDhcpCount: this.dhcpLeases.length,
        activeConnectionsCount: activeConnectionsCount
      },
      interfaces: updatedInterfaces,
      pppoeClients: this.pppoeClients,
      hotspotUsers: this.hotspotUsers,
      dhcpLeases: this.dhcpLeases,
      logs: this.logs.slice(0, 20),
      pingStats: {
        targetIspGateway: { host: '103.144.20.1', latencyMs: Math.round((2.1 + Math.random() * 1.2) * 10) / 10, packetLossPercent: 0, status: 'online' },
        targetGoogleDns: { host: '8.8.8.8', latencyMs: Math.round((14.2 + (Math.random() * 2.8) - 1.4) * 10) / 10, packetLossPercent: 0, status: 'online' },
        targetCloudflareDns: { host: '1.1.1.1', latencyMs: Math.round((11.8 + (Math.random() * 2.2) - 1.1) * 10) / 10, packetLossPercent: 0, status: 'online' },
        targetBtsNorth: { host: '10.200.1.1', latencyMs: Math.round((3.8 + Math.random() * 1.5) * 10) / 10, packetLossPercent: 0, status: 'online' },
        targetBtsSouth: { host: '10.200.2.1', latencyMs: Math.round((4.4 + Math.random() * 1.8) * 10) / 10, packetLossPercent: 0, status: 'online' }
      }
    };
  }

  /**
   * Execute simulated CLI Terminal Command
   */
  executeCommand(command) {
    const cmd = (command || '').trim();
    if (!cmd) return '';

    if (cmd === '/system/resource/print' || cmd === '/system resource print') {
      return `                   uptime: ${this.getUptimeString()}
                  version: ${this.version}
               build-time: Jun/18/2026 10:14:22
         factory-software: 7.1.0
              free-memory: ${(this.totalMemory * 0.65 / 1024 / 1024).toFixed(1)}MiB
             total-memory: ${(this.totalMemory / 1024 / 1024).toFixed(1)}MiB
                      cpu: arm64
                cpu-count: ${this.cpuCores}
            cpu-frequency: ${this.cpuFreq}MHz
                 cpu-load: 24%
           free-hdd-space: ${(this.totalHdd * 0.74 / 1024 / 1024).toFixed(1)}MiB
          total-hdd-space: ${(this.totalHdd / 1024 / 1024).toFixed(1)}MiB
  write-sect-since-reboot: 49,201
         write-sect-total: 394,102
               board-name: ${this.model}
                 platform: MikroTik`;
    }

    if (cmd === '/interface/print' || cmd === '/interface print') {
      let output = `Flags: R - RUNNING; D - DYNAMIC; S - SLAVE\nColumns: NAME, TYPE, ACTUAL-MTU, MAC-ADDRESS\n#     NAME                            TYPE       ACTUAL-MTU  MAC-ADDRESS\n`;
      this.interfaces.forEach((iface, idx) => {
        const flag = iface.running ? 'R' : ' ';
        output += `${idx.toString().padEnd(2)} ${flag}  ${iface.name.padEnd(31)} ${iface.type.padEnd(10)} ${iface.mtu.toString().padEnd(11)} ${iface.macAddress}\n`;
      });
      return output;
    }

    if (cmd === '/ip/address/print' || cmd === '/ip address print') {
      return `Flags: D - DYNAMIC\nColumns: ADDRESS, NETWORK, INTERFACE\n#   ADDRESS            NETWORK         INTERFACE\n0   103.144.20.2/30    103.144.20.0    sfp-sfpplus1-WAN-Telkom\n1   180.250.99.14/29   180.250.99.8    ether1-WAN-Indosat\n2   192.168.88.1/24    192.168.88.0    bridge-LAN-Corporate\n3   10.10.0.1/16       10.10.0.0       sfp-sfpplus2-Trunk-Distribution\n4   192.168.20.1/24    192.168.20.0    vlan20-Hotspot-Public\n5   10.200.1.2/30      10.200.1.0      sfp-sfpplus3-BTS-Tower-North\n6   10.200.2.2/30      10.200.2.0      sfp-sfpplus4-BTS-Tower-South`;
    }

    if (cmd.startsWith('/ping') || cmd.startsWith('ping')) {
      const parts = cmd.split(' ');
      const target = parts[1] || '8.8.8.8';
      return `  SEQ HOST                                     SIZE TTL TIME       STATUS\n    0 ${target.padEnd(40)} 56  57 14ms412us \n    1 ${target.padEnd(40)} 56  57 13ms890us \n    2 ${target.padEnd(40)} 56  57 14ms102us \n    3 ${target.padEnd(40)} 56  57 13ms954us \n    sent=4 received=4 packet-loss=0% min-rtt=13ms890us avg-rtt=14ms089us max-rtt=14ms412us`;
    }

    if (cmd === '/system/identity/print' || cmd === '/system identity print') {
      return `name: ${this.identity}`;
    }

    if (cmd === '/ip/firewall/connection/print count-only' || cmd.includes('firewall connection')) {
      return `2894`;
    }

    return `[admin@${this.identity}] > ${cmd}\nCommand executed successfully. (Simulated output)`;
  }
}

module.exports = MikroTikSimulator;
