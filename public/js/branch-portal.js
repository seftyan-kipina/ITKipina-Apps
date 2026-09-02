/**
 * Kipinä IT Helpdesk - Mobile Branch Ticket Portal & Authentication Controller
 */

class BranchTicketApp {
  constructor() {
    this.session = null;
    this.users = [];
    this.tickets = [];
    this.activeTab = 'view-history';
    this.selectedCategory = 'wifi';
    this.selectedUrgency = 'medium';
    this.attachedPhotos = [];
    this.activeTicketId = null;
    this.filterStatus = 'all';
    this.searchQuery = '';
    this.ws = null;

    this.init();
  }

  async init() {
    this.initWebSocket();
    await this.fetchUsers();
    await this.fetchTickets();
    this.loadSession();
    this.startAutoPolling();

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeImagePreview();
      }
    });
  }

  async fetchUsers() {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        this.users = data.users;
        return;
      }
    } catch (e) {}

    try {
      const local = localStorage.getItem('kipina_noc_users_data');
      if (local) this.users = JSON.parse(local);
    } catch (e) {}
  }

  loadSession() {
    try {
      const saved = localStorage.getItem('kipina_branch_user_session') || sessionStorage.getItem('kipina_branch_user_session');
      if (saved) {
        this.session = JSON.parse(saved);
        this.applySessionUI();
        this.switchTab('view-history');
        return;
      }
    } catch (e) {}

    // No active session -> show login view
    this.session = null;
    this.showLoginView();
  }

  showLoginView() {
    const topBar = document.getElementById('mobile-top-bar');
    const statusRibbon = document.getElementById('mobile-status-ribbon');
    const bottomNav = document.getElementById('mobile-bottom-nav');

    if (topBar) topBar.style.display = 'none';
    if (statusRibbon) statusRibbon.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';

    document.querySelectorAll('.mobile-view').forEach(el => el.classList.remove('active'));
    const loginView = document.getElementById('view-branch-login');
    if (loginView) loginView.classList.add('active');
  }

  applySessionUI() {
    const topBar = document.getElementById('mobile-top-bar');
    const statusRibbon = document.getElementById('mobile-status-ribbon');
    const bottomNav = document.getElementById('mobile-bottom-nav');

    if (topBar) topBar.style.display = 'flex';
    if (statusRibbon) statusRibbon.style.display = 'flex';
    if (bottomNav) bottomNav.style.display = 'grid';

    const branchBadge = document.getElementById('mb-branch-name');
    const userBadge = document.getElementById('mb-user-name');
    const userAvatar = document.getElementById('mb-user-avatar');

    if (this.session) {
      if (branchBadge) branchBadge.textContent = this.session.branch || 'Kipinä Cabang';
      if (userBadge) userBadge.textContent = this.session.name || this.session.username;
      if (userAvatar) userAvatar.textContent = (this.session.name || this.session.username || 'P')[0].toUpperCase();

      // Form defaults
      const branchDisplay = document.getElementById('ticket-branch-display');
      const reporterInput = document.getElementById('ticket-reporter-name');
      const phoneInput = document.getElementById('ticket-reporter-phone');

      if (branchDisplay) branchDisplay.value = this.session.branch || 'Kipinä Cabang';
      if (reporterInput) reporterInput.value = this.session.name || this.session.username;
      if (phoneInput) phoneInput.value = this.session.phone || '';
    }

    this.renderHistory();
  }

  async handleLogin(event) {
    if (event) event.preventDefault();

    const usernameInput = document.getElementById('branch-login-username')?.value.trim().toLowerCase();
    const passwordInput = document.getElementById('branch-login-password')?.value.trim();
    const alertBox = document.getElementById('branch-login-alert');
    const alertText = document.getElementById('branch-login-alert-text');
    const submitBtn = document.getElementById('btn-branch-login-submit');

    if (!usernameInput || !passwordInput) {
      if (alertBox && alertText) {
        alertText.textContent = 'Harap masukkan username dan kata sandi.';
        alertBox.style.display = 'block';
      }
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Memverifikasi Akun...</span>';
    }

    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password: passwordInput })
      });
      const data = await res.json();

      if (data.success && data.user) {
        this.session = {
          id: data.user.id,
          username: data.user.username,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          branch: data.user.branch || 'Kipinä Cabang',
          phone: data.user.phone || '-'
        };

        localStorage.setItem('kipina_branch_user_session', JSON.stringify(this.session));
        if (alertBox) alertBox.style.display = 'none';

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>🚀 Masuk ke Portal Tiket</span>';
        }

        this.applySessionUI();
        this.switchTab('view-history');
        return;
      } else {
        if (alertBox && alertText) {
          alertText.textContent = data.message || 'Username atau kata sandi salah!';
          alertBox.style.display = 'block';
        }
      }
    } catch (e) {
      // Local fallback verification
      const user = this.users.find(u => 
        (u.username.toLowerCase() === usernameInput || u.email.toLowerCase() === usernameInput)
      );

      if (user) {
        if (user.status === 'Suspended') {
          if (alertBox && alertText) {
            alertText.textContent = 'Akun Anda sedang ditangguhkan. Hubungi IT Admin.';
            alertBox.style.display = 'block';
          }
        } else {
          this.session = {
            id: user.id,
            username: user.username,
            name: user.name,
            email: user.email,
            role: user.role,
            branch: user.branch || 'Kipinä Cabang',
            phone: user.phone || '-'
          };
          localStorage.setItem('kipina_branch_user_session', JSON.stringify(this.session));
          if (alertBox) alertBox.style.display = 'none';
          this.applySessionUI();
          this.switchTab('view-history');
          return;
        }
      } else {
        if (alertBox && alertText) {
          alertText.textContent = `Akun @${usernameInput} belum didaftarkan oleh IT Admin!`;
          alertBox.style.display = 'block';
        }
      }
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚀 Masuk ke Portal Tiket</span>';
    }
  }

  fillDemoLogin(username, password) {
    const uInput = document.getElementById('branch-login-username');
    const pInput = document.getElementById('branch-login-password');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = password;
    this.handleLogin();
  }

  togglePasswordVisibility() {
    const pInput = document.getElementById('branch-login-password');
    if (pInput) {
      pInput.type = pInput.type === 'password' ? 'text' : 'password';
    }
  }

  logout() {
    this.openLogoutModal();
  }

  openLogoutModal() {
    const branchEl = document.getElementById('logout-modal-branch');
    const userEl = document.getElementById('logout-modal-user');
    if (branchEl) branchEl.textContent = `📍 ${this.session?.branch || 'Kipinä Cabang'}`;
    if (userEl) userEl.textContent = `👤 ${this.session?.name || this.session?.username || 'Staff Cabang'}`;

    const modal = document.getElementById('mobile-logout-modal');
    if (modal) modal.style.display = 'flex';
  }

  closeLogoutModal(event) {
    if (event && event.target && event.target.id !== 'mobile-logout-modal') return;
    const modal = document.getElementById('mobile-logout-modal');
    if (modal) modal.style.display = 'none';
  }

  confirmLogout() {
    const modal = document.getElementById('mobile-logout-modal');
    if (modal) modal.style.display = 'none';

    localStorage.removeItem('kipina_branch_user_session');
    sessionStorage.removeItem('kipina_branch_user_session');
    this.session = null;
    this.showToast('Anda telah berhasil keluar dari akun cabang.', 'info');
    this.showLoginView();
  }

  playNotificationChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      // Tone 1: 880Hz (A5)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.2, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.16);

      // Tone 2: 1174Hz (D6)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1174.66, now + 0.10);
      gain2.gain.setValueAtTime(0.24, now + 0.10);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.10);
      osc2.stop(now + 0.36);
    } catch (e) {}
  }

  showIncomingChatPushBanner(ticket, comment) {
    this.pendingPushTicketId = ticket.id;
    this.playNotificationChime();
    if (navigator.vibrate) {
      navigator.vibrate([80, 50, 100]);
    }

    const banner = document.getElementById('mobile-chat-push-banner');
    const ticketBadge = document.getElementById('push-banner-ticket');
    const msgEl = document.getElementById('push-banner-msg');
    const timeEl = document.getElementById('push-banner-time');
    const avatarEl = document.getElementById('push-banner-avatar');

    if (ticketBadge) ticketBadge.textContent = `#${ticket.id}`;
    if (msgEl) {
      const sender = comment.sender || 'Tim IT NOC';
      const text = comment.text || 'Mengirim tanggapan atau lampiran foto';
      msgEl.textContent = `${sender}: "${text}"`;
    }
    if (timeEl) timeEl.textContent = 'Baru saja';
    if (avatarEl) avatarEl.textContent = (comment.avatar && comment.avatar.length <= 2) ? comment.avatar : '💬';

    if (banner) {
      banner.style.display = 'flex';
      banner.style.opacity = '1';
      banner.style.transform = 'translateY(0)';
      banner.style.animation = 'none';
      banner.offsetHeight; // trigger reflow
      banner.style.animation = 'slideDownPush 0.35s cubic-bezier(0.16, 1, 0.3, 1)';

      if (this.pushBannerTimer) clearTimeout(this.pushBannerTimer);
      this.pushBannerTimer = setTimeout(() => {
        this.dismissPushBanner();
      }, 5500);
    }
  }

  dismissPushBanner() {
    const banner = document.getElementById('mobile-chat-push-banner');
    if (!banner) return;
    banner.style.opacity = '0';
    banner.style.transform = 'translateY(-30px)';
    setTimeout(() => {
      banner.style.display = 'none';
      banner.style.opacity = '1';
      banner.style.transform = '';
    }, 250);
  }

  handlePushBannerClick() {
    const tId = this.pendingPushTicketId;
    this.dismissPushBanner();
    if (tId) {
      this.renderChatDetail(tId);
    }
  }

  initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'tickets_sync' && Array.isArray(data.tickets)) {
            this.tickets = data.tickets;
            this.renderHistory();
            if (this.activeTicketId) {
              this.renderChatDetail(this.activeTicketId, false);
            }
          }
        } catch (e) {}
      };
    } catch (e) {}
  }

  async fetchTickets() {
    try {
      const res = await fetch('/api/tickets');
      const data = await res.json();
      if (data.success && Array.isArray(data.tickets)) {
        this.tickets = data.tickets;
        if (!this.ticketCommentCounts) {
          this.ticketCommentCounts = {};
          this.tickets.forEach(t => {
            this.ticketCommentCounts[t.id] = (t.comments || []).length;
          });
        }
        return;
      }
    } catch (e) {}

    // Local fallback
    try {
      const local = localStorage.getItem('kipina_noc_tickets_data');
      if (local) {
        this.tickets = JSON.parse(local);
      }
    } catch (e) {}
  }

  startAutoPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      // Auto poll every 2.5 seconds when looking at history or in chat detail
      if (this.activeTicketId || this.activeTab === 'view-history' || this.activeTab === 'view-chat-detail') {
        await this.pollTicketUpdates();
      }
    }, 2500);
  }

  stopAutoPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async pollTicketUpdates() {
    try {
      const res = await fetch('/api/tickets');
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !Array.isArray(data.tickets)) return;

      const serverTickets = data.tickets;

      // Detect and notify incoming responses from IT Team across all tickets
      if (!this.ticketCommentCounts) {
        this.ticketCommentCounts = {};
        serverTickets.forEach(t => {
          this.ticketCommentCounts[t.id] = (t.comments || []).length;
        });
      } else {
        serverTickets.forEach(st => {
          const oldLen = this.ticketCommentCounts[st.id] ?? (st.comments || []).length;
          const newComments = st.comments || [];
          if (newComments.length > oldLen) {
            const latest = newComments[newComments.length - 1];
            const isFromIt = !latest.isSelf && latest.role !== 'Cabang' && (latest.role || '').toLowerCase() !== 'user cabang';
            if (isFromIt) {
              this.showIncomingChatPushBanner(st, latest);
            }
          }
          this.ticketCommentCounts[st.id] = newComments.length;
        });
      }

      const currentSelected = this.activeTicketId ? this.tickets.find(t => t.id === this.activeTicketId) : null;
      const currentCommentsCount = currentSelected && currentSelected.comments ? currentSelected.comments.length : 0;

      const newSelected = this.activeTicketId ? serverTickets.find(t => t.id === this.activeTicketId) : null;
      const newCommentsCount = newSelected && newSelected.comments ? newSelected.comments.length : 0;

      const hasNewMessage = newCommentsCount !== currentCommentsCount;
      const hasCountChange = serverTickets.length !== this.tickets.length;
      const hasStatusChange = currentSelected && newSelected && (currentSelected.status !== newSelected.status || currentSelected.priority !== newSelected.priority);

      if (hasNewMessage || hasCountChange || hasStatusChange) {
        this.tickets = serverTickets;
        this.saveTicketsLocal();

        if (this.activeTab === 'view-history') {
          this.renderHistory();
        }

        if (this.activeTicketId && newSelected) {
          // Update status badge dynamically
          const statusBadge = document.getElementById('chat-ticket-status');
          if (statusBadge) {
            const isResolved = (newSelected.status || '').toUpperCase() === 'RESOLVED';
            const isInProgress = (newSelected.status || '').toUpperCase() === 'IN_PROGRESS';
            statusBadge.className = `ticket-status-pill ${newSelected.status.toLowerCase()}`;
            statusBadge.textContent = isResolved ? 'Selesai' : (isInProgress ? 'Diproses IT' : 'Menunggu IT');
          }

          if (hasNewMessage) {
            this.renderChatDetail(this.activeTicketId, true);
          }
        }
      }
    } catch (e) {}
  }

  async manualRefreshChat() {
    await this.fetchTickets();
    if (this.activeTicketId) {
      this.renderChatDetail(this.activeTicketId, true);
    }
    this.showToast('Chat percakapan tiket berhasil disegarkan!', 'success');
  }

  switchTab(tabName) {
    if (!this.session && tabName !== 'view-branch-login') {
      this.showLoginView();
      return;
    }

    this.activeTab = tabName;

    document.querySelectorAll('.mobile-view').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(tabName);
    if (target) target.classList.add('active');

    // Update Bottom Nav
    document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
      const btnTab = btn.getAttribute('data-tab');
      if (btnTab === tabName || (tabName === 'view-chat-detail' && btnTab === 'view-history')) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  selectCategory(categoryKey) {
    this.selectedCategory = categoryKey;
    document.querySelectorAll('.category-chip-btn').forEach(btn => {
      if (btn.getAttribute('data-category') === categoryKey) {
        btn.classList.add('selected');
      } else {
        btn.classList.remove('selected');
      }
    });
  }

  selectUrgency(urgencyLevel) {
    this.selectedUrgency = urgencyLevel;
    document.querySelectorAll('.urgency-radio-btn').forEach(btn => {
      if (btn.getAttribute('data-urgency') === urgencyLevel) {
        btn.className = `urgency-radio-btn selected ${urgencyLevel}`;
      } else {
        btn.className = 'urgency-radio-btn';
      }
    });
  }

  handlePhotoUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = (e) => {
        this.attachedPhotos.push(e.target.result);
        this.renderPhotoPreviews();
      };
      reader.readAsDataURL(file);
    }
  }

  renderPhotoPreviews() {
    const container = document.getElementById('photo-preview-container');
    if (!container) return;

    if (this.attachedPhotos.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = this.attachedPhotos.map((src, idx) => `
      <div class="photo-preview-item" title="Klik untuk melihat foto">
        <img src="${src}" alt="Lampiran Foto ${idx+1}" onclick="portalApp.openImagePreview('${src}')" style="cursor: pointer;">
        <button type="button" class="photo-remove-btn" onclick="event.stopPropagation(); portalApp.removePhoto(${idx})">&times;</button>
      </div>
    `).join('');
  }

  removePhoto(index) {
    this.attachedPhotos.splice(index, 1);
    this.renderPhotoPreviews();
  }

  async handleCreateTicket(event) {
    if (event) event.preventDefault();

    const branch = this.session?.branch || 'Kipinä Cabang';
    const reporter = document.getElementById('ticket-reporter-name')?.value.trim() || this.session?.name || 'PIC Cabang';
    const phone = document.getElementById('ticket-reporter-phone')?.value.trim() || this.session?.phone || '-';
    const title = document.getElementById('ticket-title-input')?.value.trim();
    const desc = document.getElementById('ticket-desc-input')?.value.trim();

    if (!title) {
      alert('Harap isi judul kendala dengan jelas!');
      return;
    }

    const payload = {
      title,
      branch,
      category: this.selectedCategory,
      priority: 'medium', // Urgency determined by IT Admin on dashboard
      reporter,
      phone,
      desc,
      photo: this.attachedPhotos[0] || null,
      photos: this.attachedPhotos
    };

    const submitBtn = document.getElementById('btn-submit-new-ticket');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Mengirim ke Tim IT...</span>';
    }

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (data.success && data.ticket) {
        this.tickets.unshift(data.ticket);
        this.saveTicketsLocal();
        
        // Reset form
        document.getElementById('form-create-ticket')?.reset();
        this.attachedPhotos = [];
        this.renderPhotoPreviews();

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>🚀 Kirim Tiket Gangguan ke Tim IT</span>';
        }

        // Switch to ticket chat detail
        this.openTicketChat(data.ticket.id);
        return;
      }
    } catch (e) {}

    // Fallback Offline Creation
    const newId = `TK-KIP-2026-0${80 + this.tickets.length + 1}`;
    const newTicket = {
      id: newId,
      title,
      branch,
      category: this.selectedCategory,
      priority: 'medium',
      status: 'open',
      assignee: 'Menunggu Alokasi IT',
      reporter,
      phone,
      createdAt: this.formatTicketDateTime(Date.now()),
      timestamp: Date.now(),
      desc,
      photo: this.attachedPhotos[0] || null,
      comments: [
        {
          id: `c-init-${Date.now()}`,
          sender: 'SysBot',
          role: 'bot',
          avatar: '🤖',
          text: `Tiket #${newId} telah berhasil dibuat dan diteruskan ke Tim IT.`,
          timestamp: Date.now() + 500
        }
      ]
    };

    this.tickets.unshift(newTicket);
    this.saveTicketsLocal();

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚀 Kirim Tiket Gangguan ke Tim IT</span>';
    }

    document.getElementById('form-create-ticket')?.reset();
    this.attachedPhotos = [];
    this.renderPhotoPreviews();

    this.openTicketChat(newId);
  }

  saveTicketsLocal() {
    try {
      localStorage.setItem('kipina_noc_tickets_data', JSON.stringify(this.tickets));
    } catch (e) {}
  }

  filterHistory(status) {
    this.filterStatus = status;
    document.querySelectorAll('.filter-chip-tab').forEach(chip => {
      if (chip.getAttribute('data-status') === status) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });
    this.renderHistory();
  }

  searchTickets(query) {
    this.searchQuery = (query || '').toLowerCase().trim();
    this.renderHistory();
  }

  renderHistory() {
    const listContainer = document.getElementById('branch-tickets-list');
    const badgeCounter = document.getElementById('bottom-nav-open-count');

    // Filter tickets for current branch (or all if Super)
    let branchTickets = this.tickets;
    if (this.session && this.session.branch && this.session.role === 'User Cabang') {
      branchTickets = this.tickets.filter(t => 
        t.branch.toLowerCase().includes(this.session.branch.toLowerCase()) || 
        this.session.branch.toLowerCase().includes(t.branch.toLowerCase())
      );
    }

    const openCount = branchTickets.filter(t => t.status !== 'resolved').length;
    if (badgeCounter) {
      badgeCounter.textContent = openCount > 0 ? openCount : '';
      badgeCounter.style.display = openCount > 0 ? 'inline-block' : 'none';
    }

    if (!listContainer) return;

    let filtered = branchTickets;
    if (this.filterStatus !== 'all') {
      filtered = filtered.filter(t => t.status === this.filterStatus);
    }

    if (this.searchQuery) {
      filtered = filtered.filter(t => 
        t.title.toLowerCase().includes(this.searchQuery) ||
        t.id.toLowerCase().includes(this.searchQuery) ||
        t.desc.toLowerCase().includes(this.searchQuery)
      );
    }

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 16px; color: var(--text-muted); background: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📭</div>
          <div style="font-size: 0.88rem; font-weight: 750; color: var(--text-primary); margin-bottom: 4px;">Tidak Ada Tiket</div>
          <div style="font-size: 0.74rem;">Belum ada riwayat tiket gangguan untuk cabang ini.</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered.map(t => {
      let statusLabel = 'Menunggu IT';
      if (t.status === 'in_progress') statusLabel = 'Sedang Ditangani';
      if (t.status === 'resolved') statusLabel = 'Selesai';

      const commentCount = (t.comments || []).length;

      return `
        <div class="ticket-card-item" onclick="portalApp.openTicketChat('${t.id}')">
          <div class="ticket-card-top">
            <span class="ticket-code-badge">#${t.id}</span>
            <span class="ticket-status-pill ${t.status}">${statusLabel}</span>
          </div>
          <div class="ticket-card-title">${this.escapeHtml(t.title)}</div>
          <div class="ticket-card-desc">${this.escapeHtml(t.desc)}</div>
          <div class="ticket-card-footer">
            <span class="ticket-card-time" title="Tanggal & Jam Request Tiket">📅 ${this.formatTicketDateTime(t.timestamp, t.createdAt)}</span>
            <div class="ticket-chat-count">
              <span>💬</span>
              <span>${commentCount} Pesan</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  openTicketChat(ticketId) {
    this.activeTicketId = ticketId;
    this.renderChatDetail(ticketId, true);
    this.switchTab('view-chat-detail');
  }

  renderChatDetail(ticketId, scrollToBottom = true) {
    const ticket = this.tickets.find(t => t.id === ticketId);
    if (!ticket) return;

    // Header Meta
    const codeEl = document.getElementById('chat-ticket-code');
    const statusEl = document.getElementById('chat-ticket-status');
    const titleEl = document.getElementById('chat-ticket-title');
    const descEl = document.getElementById('chat-ticket-desc');
    const assigneeEl = document.getElementById('chat-ticket-assignee');
    const branchEl = document.getElementById('chat-ticket-branch');

    if (codeEl) codeEl.textContent = `#${ticket.id}`;
    if (statusEl) {
      statusEl.className = `ticket-status-pill ${ticket.status}`;
      statusEl.textContent = ticket.status === 'resolved' ? 'Selesai (Resolved)' : (ticket.status === 'in_progress' ? 'Sedang Ditangani IT' : 'Menunggu IT');
    }
    if (titleEl) titleEl.textContent = ticket.title;
    if (descEl) descEl.textContent = ticket.desc;
    if (assigneeEl) assigneeEl.textContent = ticket.assignee || 'Menunggu IT';
    if (branchEl) branchEl.textContent = ticket.branch;

    const datetimeEl = document.getElementById('chat-ticket-datetime');
    if (datetimeEl) datetimeEl.textContent = `📅 ${this.formatTicketDateTime(ticket.timestamp, ticket.createdAt)}`;

    // Messages
    const container = document.getElementById('mobile-chat-stream');
    if (!container) return;

    const comments = ticket.comments || [];
    container.innerHTML = comments.map(c => {
      const isBot = (c.role === 'role-bot') || (c.sender && c.sender.toLowerCase().includes('bot'));
      const isBranch = (c.role === 'Cabang') || (c.role === 'User Cabang') || 
        (c.sender && (
          c.sender.toLowerCase().includes('pic') || 
          c.sender.toLowerCase().includes('cabang') || 
          c.sender.toLowerCase().includes('guru') || 
          c.sender.toLowerCase().includes('security') || 
          c.sender.toLowerCase().includes('staf') || 
          c.sender.toLowerCase().includes('admin kemang') || 
          c.sender.toLowerCase().includes('kepala sekolah')
        )) ||
        (this.session && c.sender && (
          c.sender.toLowerCase().includes((this.session.name || '').toLowerCase()) || 
          c.sender.toLowerCase().includes((this.session.username || '').toLowerCase())
        ));
      
      const isIT = !isBot && !isBranch;
      const isSelf = isBranch; // On mobile branch portal, Branch User is on the RIGHT

      if (isBot) {
        return `
          <div class="chat-bubble-row bot">
            <div class="chat-bot-pill">🤖 ${this.escapeHtml(c.text)}</div>
          </div>
        `;
      }

      const timeFormatted = c.timestamp ? new Date(c.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
      // Badge ONLY for IT NOC messages, never on Branch User
      const roleBadge = isIT ? '<span style="font-size:0.62rem; padding:1px 5px; border-radius:3px; background:#dbeafe; color:#1d4ed8; font-weight:800;">🛡️ IT NOC</span>' : '';

      const photos = Array.isArray(c.photos) && c.photos.length > 0 ? c.photos : (c.photo ? [c.photo] : []);

      return `
        <div class="chat-bubble-row ${isSelf ? 'self' : 'it-msg'}">
          <div class="chat-bubble-avatar">${(c.sender || 'U')[0].toUpperCase()}</div>
          <div class="chat-bubble-body">
            <div class="chat-bubble-header">
              <span>${this.escapeHtml(c.sender)}</span>
              ${roleBadge}
              <span>&bull;</span>
              <span>${timeFormatted}</span>
            </div>
            <div class="chat-bubble-text">
              ${photos.length > 0 ? `
                <div class="chat-photo-gallery">
                  ${photos.map((src, i) => `
                    <div class="chat-photo-item-wrap" onclick="portalApp.openImagePreview('${src}')" title="Klik untuk melihat foto ukuran penuh">
                      <img src="${src}" class="chat-photo-img" alt="Lampiran Foto ${i+1}">
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${c.text ? `<div>${this.escapeHtml(c.text)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (scrollToBottom) {
      setTimeout(() => {
        container.scrollTop = container.scrollHeight;
      }, 50);
    }
  }

  async sendChatMessage(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('mobile-chat-text-input');
    const text = input?.value.trim();
    if (!text || !this.activeTicketId) return;

    input.value = '';

    const ticket = this.tickets.find(t => t.id === this.activeTicketId);
    if (!ticket) return;

    const newComment = {
      id: `c_${Date.now()}`,
      sender: this.session?.name || this.session?.username || 'PIC Cabang',
      role: 'Cabang',
      isSelf: true,
      avatar: (this.session?.name || 'P')[0].toUpperCase(),
      text: text,
      timestamp: Date.now()
    };

    ticket.comments = ticket.comments || [];
    ticket.comments.push(newComment);
    this.saveTicketsLocal();
    this.renderChatDetail(this.activeTicketId, true);

    // Send to server
    try {
      await fetch(`/api/tickets/${this.activeTicketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newComment)
      });
    } catch (e) {}

    // Simulated IT Auto-Reply for instant feedback
    setTimeout(() => {
      const itResponses = [
        'Baik kak, pesan diterima. Tim Network Engineer sedang memverifikasi link Mikrotik GS.',
        'Sedang kami lakukan remote check interface router cabang ya kak.',
        'Noted, bandwidth queue sudah kami sesuaikan. Mohon dicek kembali dalam 1 menit.',
        'Terima kasih update informasinya kak, tiket sedang kami tindak lanjuti.'
      ];
      const randomReply = itResponses[Math.floor(Math.random() * itResponses.length)];
      
      const itComment = {
        id: `c_it_${Date.now()}`,
        sender: 'Dimas NOC (Head Office)',
        role: 'role-lead',
        isSelf: false,
        avatar: 'D',
        text: randomReply,
        timestamp: Date.now()
      };

      ticket.comments.push(itComment);
      if (ticket.status === 'open') ticket.status = 'in_progress';
      this.saveTicketsLocal();
      if (this.activeTicketId === ticket.id) {
        this.renderChatDetail(ticket.id, true);
      }
    }, 1500);
  }

  sendQuickReply(text) {
    const input = document.getElementById('mobile-chat-text-input');
    if (input) {
      input.value = text;
      this.sendChatMessage();
    }
  }

  openImagePreview(src) {
    if (!src) return;
    const modal = document.getElementById('mobile-image-preview-modal');
    const target = document.getElementById('mobile-image-preview-target');
    const dl = document.getElementById('mobile-image-preview-download');
    if (target) target.src = src;
    if (dl) dl.href = src;
    if (modal) modal.style.display = 'flex';
  }

  closeImagePreview(event) {
    if (event && event.target && !event.target.classList.contains('image-preview-overlay') && !event.target.classList.contains('btn-close-preview') && !event.target.classList.contains('btn-preview-close')) {
      return;
    }
    const modal = document.getElementById('mobile-image-preview-modal');
    if (modal) modal.style.display = 'none';
  }

  escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatTicketDateTime(timestamp, fallback) {
    if (!timestamp && fallback && fallback.includes('202')) return fallback;
    const ts = typeof timestamp === 'number' ? timestamp : (Date.parse(timestamp) || Date.now());
    const d = new Date(ts);
    if (isNaN(d.getTime())) return fallback || 'Baru saja';
    const day = String(d.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year}, ${hours}:${minutes} WIB`;
  }
}

// Initialize on DOM loaded
window.addEventListener('DOMContentLoaded', () => {
  window.portalApp = new BranchTicketApp();
});
