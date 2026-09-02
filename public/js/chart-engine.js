/**
 * Ultra-Clean White Light High-Performance Canvas Traffic Chart Engine
 */

class NocTrafficChart {
  constructor(canvasId, options = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.maxPoints = options.maxPoints || 60; // 60 seconds rolling window
    this.title = options.title || 'Traffic Monitor';

    // Series buffers
    this.rxData = [];
    this.txData = [];
    this.labels = [];

    // Clean Light Theme Colors
    this.rxColor = options.rxColor || '#0284c7'; // Modern Sky Blue
    this.txColor = options.txColor || '#7c3aed'; // Modern Purple
    this.gridColor = '#e2e8f0';
    this.textColor = '#64748b';

    this.initCanvasSize();
    window.addEventListener('resize', () => this.initCanvasSize());
  }

  initCanvasSize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 600;
    this.height = rect.height || 260;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  addDataPoint(rxBps, txBps, timeLabel) {
    this.rxData.push(rxBps);
    this.txData.push(txBps);
    this.labels.push(timeLabel || '');

    if (this.rxData.length > this.maxPoints) {
      this.rxData.shift();
      this.txData.shift();
      this.labels.shift();
    }
    this.render();
  }

  static formatSpeed(bps) {
    if (bps >= 1000000000) {
      return (bps / 1000000000).toFixed(2) + ' Gbps';
    } else if (bps >= 1000000) {
      return (bps / 1000000).toFixed(2) + ' Mbps';
    } else if (bps >= 1000) {
      return (bps / 1000).toFixed(1) + ' Kbps';
    } else {
      return Math.round(bps) + ' bps';
    }
  }

  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    const padding = { top: 20, right: 16, bottom: 26, left: 60 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Calculate max Y value with headroom
    let maxVal = Math.max(...this.rxData, ...this.txData, 1000000);
    maxVal = maxVal * 1.15;

    // 1. Draw Clean Grid Lines (4 horizontal divisions)
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.gridColor;
    ctx.fillStyle = this.textColor;
    ctx.font = '500 10px "Fira Code", monospace';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      const val = maxVal * (1 - i / 4);

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      ctx.fillText(NocTrafficChart.formatSpeed(val), padding.left - 8, y + 3);
    }

    if (this.rxData.length < 2) {
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = '12px "Inter", sans-serif';
      ctx.fillText('Mengumpulkan data stream router...', w / 2, h / 2);
      return;
    }

    const stepX = chartW / (this.maxPoints - 1);
    const startIdx = this.maxPoints - this.rxData.length;

    // 2. Helper to draw series
    const drawSeries = (data, strokeColor, fillTopColor) => {
      ctx.beginPath();
      const firstX = padding.left + startIdx * stepX;
      const firstY = padding.top + chartH - (data[0] / maxVal) * chartH;
      ctx.moveTo(firstX, firstY);

      for (let i = 1; i < data.length; i++) {
        const x = padding.left + (startIdx + i) * stepX;
        const y = padding.top + chartH - (data[i] / maxVal) * chartH;
        
        const prevX = padding.left + (startIdx + i - 1) * stepX;
        const prevY = padding.top + chartH - (data[i - 1] / maxVal) * chartH;
        const cpX = (prevX + x) / 2;
        ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
      }

      // Stroke Line
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // Soft Area Fill under curve
      const lastX = padding.left + (startIdx + data.length - 1) * stepX;
      const zeroY = padding.top + chartH;
      ctx.lineTo(lastX, zeroY);
      ctx.lineTo(firstX, zeroY);
      ctx.closePath();

      const gradient = ctx.createLinearGradient(0, padding.top, 0, zeroY);
      gradient.addColorStop(0, fillTopColor);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fill();
    };

    // Draw TX Series (Upload - Purple)
    drawSeries(this.txData, this.txColor, 'rgba(124, 58, 237, 0.15)');

    // Draw RX Series (Download - Sky Blue)
    drawSeries(this.rxData, this.rxColor, 'rgba(2, 132, 199, 0.15)');

    // 3. X-Axis Timestamps
    ctx.fillStyle = this.textColor;
    ctx.font = '9px "Fira Code", monospace';
    ctx.textAlign = 'center';
    const labelStep = Math.floor(this.rxData.length / 4);
    if (labelStep > 0) {
      for (let i = 0; i < this.rxData.length; i += labelStep) {
        if (this.labels[i]) {
          const x = padding.left + (startIdx + i) * stepX;
          ctx.fillText(this.labels[i], x, h - padding.bottom + 16);
        }
      }
    }
  }
}

/**
 * Clean White Light Mini Sparkline for interface cards
 */
class MiniSparkline {
  constructor(canvasId, color = '#0284c7') {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.color = color;
    this.data = [];
    this.maxPoints = 24;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width || 200;
    this.height = rect.height || 40;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
  }

  push(val) {
    this.data.push(val);
    if (this.data.length > this.maxPoints) this.data.shift();
    this.draw();
  }

  draw() {
    if (!this.ctx || this.data.length < 2) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    const max = Math.max(...this.data, 1000);
    const stepX = w / (this.maxPoints - 1);
    const startIdx = this.maxPoints - this.data.length;

    ctx.beginPath();
    const firstX = startIdx * stepX;
    const firstY = h - (this.data[0] / max) * (h - 6) - 3;
    ctx.moveTo(firstX, firstY);

    for (let i = 1; i < this.data.length; i++) {
      const x = (startIdx + i) * stepX;
      const y = h - (this.data[i] / max) * (h - 6) - 3;
      const prevX = (startIdx + i - 1) * stepX;
      const prevY = h - (this.data[i - 1] / max) * (h - 6) - 3;
      const cpX = (prevX + x) / 2;
      ctx.bezierCurveTo(cpX, prevY, cpX, y, x, y);
    }

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Soft area fill
    ctx.lineTo(w, h);
    ctx.lineTo(firstX, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, this.color + '22');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }
}

/**
 * Clean Modern Dual-Bar & Area Bandwidth Usage Report Chart Engine
 */
class NocUsageReportChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.labels = [];
    this.rxData = [];
    this.txData = [];
    this.unit = 'GB';

    this.initCanvasSize();
    window.addEventListener('resize', () => this.initCanvasSize());
  }

  initCanvasSize() {
    if (!this.canvas) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = rect.width || 800;
    this.height = 290;

    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  setData(labels, rxData, txData, unit = 'GB') {
    this.labels = labels;
    this.rxData = rxData;
    this.txData = txData;
    this.unit = unit;
    this.render();
  }

  render() {
    if (!this.ctx || !this.labels || !this.labels.length) return;
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.clearRect(0, 0, w, h);

    const padding = { top: 32, right: 20, bottom: 35, left: 65 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const maxVal = Math.max(...this.rxData, ...this.txData, 10) * 1.2;

    // 1. Grid lines
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#e2e8f0';
    ctx.fillStyle = '#64748b';
    ctx.font = '500 10px "Fira Code", monospace';
    ctx.textAlign = 'right';

    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      const val = maxVal * (1 - i / 4);

      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      const labelText = val >= 1000 && this.unit === 'GB' 
        ? `${(val / 1000).toFixed(1)} TB` 
        : `${Math.round(val)} ${this.unit}`;
      ctx.fillText(labelText, padding.left - 8, y + 3);
    }

    // 2. Draw Grouped Bars with smooth rounded corners
    const numGroups = this.labels.length;
    const groupWidth = chartW / numGroups;
    const barWidth = Math.min(Math.max(groupWidth * 0.32, 12), 34);
    const barGap = 4;

    for (let i = 0; i < numGroups; i++) {
      const groupCenterX = padding.left + i * groupWidth + groupWidth / 2;
      const rxX = groupCenterX - barWidth - barGap / 2;
      const txX = groupCenterX + barGap / 2;

      const rxVal = this.rxData[i] || 0;
      const txVal = this.txData[i] || 0;

      const rxHeight = Math.max((rxVal / maxVal) * chartH, 4);
      const txHeight = Math.max((txVal / maxVal) * chartH, 4);

      const rxY = padding.top + chartH - rxHeight;
      const txY = padding.top + chartH - txHeight;

      // Draw Rx Bar (Download - Blue Gradient)
      const rxGrad = ctx.createLinearGradient(0, rxY, 0, padding.top + chartH);
      rxGrad.addColorStop(0, '#0284c7');
      rxGrad.addColorStop(1, '#38bdf8');
      ctx.fillStyle = rxGrad;
      this.roundRect(ctx, rxX, rxY, barWidth, rxHeight, 4);
      ctx.fill();

      // Draw Tx Bar (Upload - Purple Gradient)
      const txGrad = ctx.createLinearGradient(0, txY, 0, padding.top + chartH);
      txGrad.addColorStop(0, '#7c3aed');
      txGrad.addColorStop(1, '#c084fc');
      ctx.fillStyle = txGrad;
      this.roundRect(ctx, txX, txY, barWidth, txHeight, 4);
      ctx.fill();

      // Value label on top of bars
      if (barWidth >= 16) {
        ctx.fillStyle = '#0369a1';
        ctx.font = '600 9px "Fira Code", monospace';
        ctx.textAlign = 'center';
        const rxText = rxVal >= 1000 && this.unit === 'GB' ? (rxVal/1000).toFixed(1)+'T' : (rxVal >= 100 ? Math.round(rxVal) : rxVal.toFixed(1));
        ctx.fillText(rxText, rxX + barWidth / 2, Math.max(rxY - 5, padding.top - 2));

        ctx.fillStyle = '#6d28d9';
        const txText = txVal >= 1000 && this.unit === 'GB' ? (txVal/1000).toFixed(1)+'T' : (txVal >= 100 ? Math.round(txVal) : txVal.toFixed(1));
        ctx.fillText(txText, txX + barWidth / 2, Math.max(txY - 5, padding.top - 2));
      }

      // X Axis Label
      ctx.fillStyle = '#334155';
      ctx.font = '600 10.5px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.labels[i], groupCenterX, h - padding.bottom + 18);
    }
  }

  roundRect(ctx, x, y, width, height, radius) {
    if (height < 2) height = 2;
    if (radius > height / 2) radius = height / 2;
    if (radius > width / 2) radius = width / 2;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height);
    ctx.lineTo(x, y + height);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

window.NocTrafficChart = NocTrafficChart;
window.MiniSparkline = MiniSparkline;
window.NocUsageReportChart = NocUsageReportChart;

