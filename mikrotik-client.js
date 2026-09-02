const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

/**
 * Enterprise-Grade MikroTik RouterOS API & REST Client
 * Features continuous stream state machine, tag multiplexing, and robust sentence parsing.
 */
class MikroTikClient {
  constructor(config = {}) {
    this.host = config.host || '192.168.88.1';
    this.port = parseInt(config.port || 8728, 10);
    this.user = config.user || 'admin';
    this.password = config.password || '';
    this.useSsl = !!config.useSsl;
    this.apiType = config.apiType || 'api'; // 'api' (8728/8729) or 'rest' (80/443)
    this.timeout = config.timeout || 8000;

    this.connected = false;
    this.socket = null;
    this.tagCounter = 0;

    // Persistent stream buffers
    this.buffer = Buffer.alloc(0);
    this.currentSentenceWords = [];
    this.pendingRequests = new Map(); // tag -> { resolve, reject, results, timer }
  }

  // Length encoder according to MikroTik API protocol
  static encodeLength(length) {
    if (length < 0x80) {
      return Buffer.from([length]);
    } else if (length < 0x4000) {
      length |= 0x8000;
      return Buffer.from([(length >> 8) & 0xff, length & 0xff]);
    } else if (length < 0x200000) {
      length |= 0xc00000;
      return Buffer.from([(length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
    } else if (length < 0x10000000) {
      length |= 0xe0000000;
      return Buffer.from([(length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
    } else {
      return Buffer.from([0xf0, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
    }
  }

  // Length decoder from stream
  static decodeLength(buffer, offset = 0) {
    if (buffer.length - offset < 1) return { len: 0, bytesRead: 0 };
    const firstByte = buffer[offset];

    if ((firstByte & 0x80) === 0x00) {
      return { len: firstByte, bytesRead: 1 };
    } else if ((firstByte & 0xc0) === 0x80) {
      if (buffer.length - offset < 2) return { len: 0, bytesRead: 0 };
      return { len: ((firstByte & 0x3f) << 8) | buffer[offset + 1], bytesRead: 2 };
    } else if ((firstByte & 0xe0) === 0xc0) {
      if (buffer.length - offset < 3) return { len: 0, bytesRead: 0 };
      return { len: ((firstByte & 0x1f) << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2], bytesRead: 3 };
    } else if ((firstByte & 0xf0) === 0xe0) {
      if (buffer.length - offset < 4) return { len: 0, bytesRead: 0 };
      return { len: ((firstByte & 0x0f) << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3], bytesRead: 4 };
    } else if (firstByte === 0xf0) {
      if (buffer.length - offset < 5) return { len: 0, bytesRead: 0 };
      return { len: (buffer[offset + 1] << 24) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 8) | buffer[offset + 4], bytesRead: 5 };
    }
    return { len: 0, bytesRead: 1 };
  }

  // Encode sentence to binary buffer
  static encodeSentence(words) {
    const buffers = [];
    for (const word of words) {
      const wordBuf = Buffer.from(word, 'utf8');
      const lenBuf = MikroTikClient.encodeLength(wordBuf.length);
      buffers.push(lenBuf, wordBuf);
    }
    buffers.push(Buffer.from([0])); // Sentence terminator
    return Buffer.concat(buffers);
  }

  /**
   * Connect and authenticate to MikroTik RouterOS
   */
  async connect() {
    if (this.apiType === 'rest') {
      return this.testRestConnection();
    }

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const connectTimer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          this.disconnect();
          reject(new Error(`Koneksi timeout (${this.timeout}ms) ke ${this.host}:${this.port}`));
        }
      }, this.timeout);

      const netModule = this.useSsl ? tls : net;
      const socketOptions = {
        host: this.host,
        port: this.port,
        rejectUnauthorized: false
      };

      try {
        this.socket = netModule.connect(socketOptions, async () => {
          // Socket connected, attach persistent listeners
          this.socket.on('data', (chunk) => this.handleData(chunk));

          try {
            await this.login();
            this.connected = true;
            if (!isSettled) {
              isSettled = true;
              clearTimeout(connectTimer);
              resolve(true);
            }
          } catch (loginErr) {
            if (!isSettled) {
              isSettled = true;
              clearTimeout(connectTimer);
              this.disconnect();
              reject(loginErr);
            }
          }
        });

        this.socket.on('error', (err) => {
          this.handleSocketError(err);
          if (!isSettled) {
            isSettled = true;
            clearTimeout(connectTimer);
            this.disconnect();
            reject(err);
          }
        });

        this.socket.on('close', () => {
          this.connected = false;
        });
      } catch (err) {
        clearTimeout(connectTimer);
        reject(err);
      }
    });
  }

  /**
   * Continuous stream chunk processing
   */
  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length > 0) {
      let offset = 0;
      let sentenceComplete = false;

      while (offset < this.buffer.length) {
        const { len, bytesRead } = MikroTikClient.decodeLength(this.buffer, offset);
        if (bytesRead === 0 || offset + bytesRead + len > this.buffer.length) {
          // Need more bytes from next TCP packet
          break;
        }

        offset += bytesRead;
        if (len === 0) {
          // End of current sentence!
          sentenceComplete = true;
          break;
        } else {
          const word = this.buffer.slice(offset, offset + len).toString('utf8');
          this.currentSentenceWords.push(word);
          offset += len;
        }
      }

      if (sentenceComplete) {
        this.buffer = this.buffer.slice(offset);
        const completedSentence = this.currentSentenceWords;
        this.currentSentenceWords = [];
        this.dispatchSentence(completedSentence);
      } else {
        // Incomplete sentence in buffer, await next chunk
        if (offset > 0) {
          this.buffer = this.buffer.slice(offset);
        }
        break;
      }
    }
  }

  /**
   * Dispatch parsed sentence to matching request by tag
   */
  dispatchSentence(words) {
    if (!words || words.length === 0) return;

    const replyType = words[0]; // !re, !done, !trap, !fatal
    const item = {};
    let tag = null;

    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      if (w.startsWith('=')) {
        const eqIdx = w.indexOf('=', 1);
        if (eqIdx !== -1) {
          const k = w.substring(1, eqIdx);
          const v = w.substring(eqIdx + 1);
          item[k] = v;
        }
      } else if (w.startsWith('.tag=')) {
        tag = w.substring(5);
      } else if (w.startsWith('.')) {
        const eqIdx = w.indexOf('=');
        if (eqIdx !== -1) {
          const k = w.substring(1, eqIdx);
          const v = w.substring(eqIdx + 1);
          item['_' + k] = v;
          if (k === 'tag') tag = v;
        }
      }
    }

    // Find pending request
    let req = null;
    if (tag && this.pendingRequests.has(tag)) {
      req = this.pendingRequests.get(tag);
    } else if (this.pendingRequests.size === 1) {
      // Single in-flight request fallback
      req = this.pendingRequests.values().next().value;
    }

    if (!req) return;

    if (replyType === '!re') {
      req.results.push(item);
    } else if (replyType === '!done') {
      if (item.ret !== undefined) {
        req.results.push({ ret: item.ret });
      }
      clearTimeout(req.timer);
      this.pendingRequests.delete(req.tag);
      req.resolve(req.results);
    } else if (replyType === '!trap') {
      clearTimeout(req.timer);
      this.pendingRequests.delete(req.tag);
      req.reject(new Error(item.message || 'RouterOS Trap Error'));
    } else if (replyType === '!fatal') {
      clearTimeout(req.timer);
      this.pendingRequests.delete(req.tag);
      this.disconnect();
      req.reject(new Error(item.message || 'RouterOS Fatal Error'));
    }
  }

  handleSocketError(err) {
    this.connected = false;
    for (const [tag, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(err);
    }
    this.pendingRequests.clear();
  }

  /**
   * RouterOS Login Handshake (Post-6.43 and Legacy Challenge Fallback)
   */
  async login() {
    // 1. Try modern login (ROS >= 6.43)
    try {
      const res = await this.write(['/login', `=name=${this.user}`, `=password=${this.password}`]);
      
      // If router requested challenge (legacy pre-6.43)
      if (res && res[0] && res[0].ret) {
        const challenge = res[0].ret;
        const md5 = crypto.createHash('md5');
        md5.update(Buffer.from([0]));
        md5.update(Buffer.from(this.password, 'utf8'));
        md5.update(Buffer.from(challenge, 'hex'));
        const response = '00' + md5.digest('hex');
        await this.write(['/login', `=name=${this.user}`, `=response=${response}`]);
      }
    } catch (err) {
      // Fallback: try standard /login challenge request
      if (err.message && (err.message.includes('cannot log in') || err.message.includes('password'))) {
        throw err;
      }
      const chalRes = await this.write(['/login']);
      if (chalRes && chalRes[0] && chalRes[0].ret) {
        const challenge = chalRes[0].ret;
        const md5 = crypto.createHash('md5');
        md5.update(Buffer.from([0]));
        md5.update(Buffer.from(this.password, 'utf8'));
        md5.update(Buffer.from(challenge, 'hex'));
        const response = '00' + md5.digest('hex');
        await this.write(['/login', `=name=${this.user}`, `=response=${response}`]);
      } else {
        throw err;
      }
    }
  }

  /**
   * Send a command sentence and await full response with tag correlation
   */
  write(words) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        return reject(new Error('Socket is not connected to RouterOS'));
      }

      const tag = `req_${++this.tagCounter}`;
      const taggedWords = [...words, `.tag=${tag}`];
      const encoded = MikroTikClient.encodeSentence(taggedWords);

      const timer = setTimeout(() => {
        if (this.pendingRequests.has(tag)) {
          this.pendingRequests.delete(tag);
          reject(new Error(`Command timeout (${this.timeout}ms) for: ${words.join(' ')}`));
        }
      }, this.timeout);

      this.pendingRequests.set(tag, {
        tag,
        words,
        resolve,
        reject,
        results: [],
        timer
      });

      this.socket.write(encoded);
    });
  }

  /**
   * RouterOS v7 REST API
   */
  async testRestConnection() {
    const protocol = this.useSsl ? 'https' : 'http';
    const auth = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    const url = `${protocol}://${this.host}:${this.port}/rest/system/resource`;

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(this.timeout)
      });
      if (response.ok) {
        this.connected = true;
        return true;
      }
      throw new Error(`REST API HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      this.connected = false;
      throw err;
    }
  }

  async restQuery(endpoint) {
    const protocol = this.useSsl ? 'https' : 'http';
    const auth = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    const url = `${protocol}://${this.host}:${this.port}/rest${endpoint}`;

    const res = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(this.timeout)
    });
    if (!res.ok) throw new Error(`REST HTTP ${res.status}: ${res.statusText}`);
    return await res.json();
  }

  disconnect() {
    this.connected = false;
    for (const [tag, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('Koneksi terputus'));
    }
    this.pendingRequests.clear();
    this.buffer = Buffer.alloc(0);
    this.currentSentenceWords = [];

    if (this.socket) {
      try {
        this.socket.destroy();
      } catch (e) {}
      this.socket = null;
    }
  }
}

module.exports = MikroTikClient;
