/* Aurora MP3: player — queue, shuffle/repeat, resume, volume, media keys and a level meter.
 * host: { fs, getData(), saveData(), coverUrl(name), library } */

class AMPlayer {
  constructor(host) {
    this.host = host;
    this.d = host.getData();
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.url = null; this.current = null; this.loadToken = 0;
    this.listeners = new Set();
    this.ctx = null; this.analyser = null; this.level = 0;
    this.audio.volume = this.d.volume;
    this.audio.addEventListener('ended', () => this.onEnded());
    this.audio.addEventListener('timeupdate', () => this.onTime());
    for (const ev of ['play', 'pause', 'loadedmetadata', 'durationchange']) this.audio.addEventListener(ev, () => this.emit());
    this.audio.addEventListener('error', () => { this.error = 'Could not play this file'; this.emit(); });
    this.setupMediaKeys();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) try { fn(); } catch (e) { /* keep going */ } }
  save() { this.host.saveData(); }

  get playing() { return !this.audio.paused && !!this.current; }
  get queue() { return this.d.queue; }

  track(p) { return this.host.library.tracks.get(p) || null; }

  /* ---------- queue ---------- */

  // play a list of track paths, starting at index (shuffle respects the setting)
  playList(paths, start = 0, opts = {}) {
    paths = paths.filter(p => this.track(p));
    if (!paths.length) return;
    this.d.originalQueue = paths.slice();
    let q = paths.slice(), idx = Math.max(0, Math.min(start, q.length - 1));
    if (this.d.shuffle || opts.shuffle) {
      if (opts.shuffle) this.d.shuffle = true;
      const first = opts.shuffle && opts.randomStart !== false ? q[Math.floor(Math.random() * q.length)] : q[idx];
      q = amShuffled(q.filter(p => p !== first)); q.unshift(first); idx = 0;
    }
    this.d.queue = q; this.d.index = idx;
    this.save();
    this.load(q[idx], true);
  }

  enqueue(paths, next = false) {
    paths = paths.filter(p => this.track(p));
    if (!this.d.queue.length) { this.playList(paths); return; }
    if (next) this.d.queue.splice(this.d.index + 1, 0, ...paths); else this.d.queue.push(...paths);
    this.save(); this.emit();
  }

  removeAt(i) {
    if (i < 0 || i >= this.d.queue.length) return;
    this.d.queue.splice(i, 1);
    if (i < this.d.index) this.d.index--;
    else if (i === this.d.index) { if (this.d.index >= this.d.queue.length) this.d.index = 0; if (this.d.queue.length) this.load(this.d.queue[this.d.index], this.playing); else this.unload(); }
    this.save(); this.emit();
  }

  jump(i) { if (i >= 0 && i < this.d.queue.length) { this.d.index = i; this.save(); this.load(this.d.queue[i], true); } }

  next(auto = false) {
    const q = this.d.queue; if (!q.length) return;
    if (auto && this.d.repeat === 'one') { this.audio.currentTime = 0; this.audio.play(); return; }
    let i = this.d.index + 1;
    if (i >= q.length) {
      if (this.d.repeat === 'all' || !auto) { i = 0; if (this.d.shuffle) { const cur = q[this.d.index]; this.d.queue = amShuffled(q.filter(p => p !== cur)); this.d.queue.push(cur); } }
      else { this.audio.pause(); this.audio.currentTime = 0; this.forgetPosition(); this.emit(); return; }
    }
    this.d.index = i; this.save();
    this.load(this.d.queue[i], true);
  }

  prev() {
    if (this.audio.currentTime > 4) { this.audio.currentTime = 0; return; }
    const q = this.d.queue; if (!q.length) return;
    this.d.index = (this.d.index - 1 + q.length) % q.length; this.save();
    this.load(q[this.d.index], true);
  }

  toggleShuffle() {
    this.d.shuffle = !this.d.shuffle;
    const cur = this.d.queue[this.d.index];
    if (this.d.shuffle) { const rest = this.d.queue.filter(p => p !== cur); this.d.queue = cur ? [cur, ...amShuffled(rest)] : amShuffled(rest); this.d.index = 0; }
    else if (this.d.originalQueue && this.d.originalQueue.length) { this.d.queue = this.d.originalQueue.filter(p => this.track(p)); this.d.index = Math.max(0, this.d.queue.indexOf(cur)); }
    this.save(); this.emit();
  }

  cycleRepeat() { this.d.repeat = ({ off: 'all', all: 'one', one: 'off' })[this.d.repeat] || 'all'; this.save(); this.emit(); }

  /* ---------- playback ---------- */

  async load(path, autoplay) {
    const t = this.track(path);
    if (!t) { this.error = 'File not found'; this.emit(); return; }
    const token = ++this.loadToken;
    this.rememberPosition();
    this.error = null; this.current = t; this.emit();
    let buf;
    try { buf = await this.host.fs.promises.readFile(t.path); }
    catch (e) { if (token === this.loadToken) { this.error = 'File missing — rescan the library?'; this.emit(); } return; }
    if (token !== this.loadToken) return;
    const mime = ({ mp3: 'audio/mpeg', flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav' })[t.path.split('.').pop().toLowerCase()] || 'audio/mpeg';
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = url;
    this.audio.src = url;
    const resume = this.d.positions[t.path];
    if (resume && resume > 5 && (!t.duration || resume < t.duration - 10)) {
      const seek = () => { this.audio.currentTime = resume; this.audio.removeEventListener('loadedmetadata', seek); };
      this.audio.addEventListener('loadedmetadata', seek);
    }
    this.d.last = t.path;
    this.updateMediaSession();
    if (autoplay) this.play(); else this.emit();
  }

  // after a restart: show the last track, paused where it was
  async restore() {
    const p = this.d.queue[this.d.index] || this.d.last;
    if (!p || !this.track(p)) return;
    const at = this.d.lastTime || 0;
    await this.load(p, false);
    if (at > 2 && this.current && this.current.path === p) {
      const seek = () => { this.audio.currentTime = at; this.audio.removeEventListener('loadedmetadata', seek); this.emit(); };
      if (this.audio.readyState >= 1) seek(); else this.audio.addEventListener('loadedmetadata', seek);
    }
  }

  unload() { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); if (this.url) URL.revokeObjectURL(this.url); this.url = null; this.current = null; this.emit(); }

  async play() {
    if (!this.current) { const p = this.d.queue[this.d.index] || this.d.last; if (p) return this.load(p, true); return; }
    if (!this.audio.src) return this.load(this.current.path, true);
    this.ensureMeter();
    try { if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume(); await this.audio.play(); }
    catch (e) { this.error = 'Playback was blocked — press play again'; }
    this.emit();
  }
  pause() { this.audio.pause(); this.rememberPosition(true); this.emit(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  seek(t) { if (this.current && isFinite(t)) { this.audio.currentTime = Math.max(0, Math.min(t, (this.audio.duration || 1e9) - 0.2)); this.emit(); } }
  setVolume(v) { v = Math.max(0, Math.min(1, v)); this.audio.volume = v; this.d.volume = v; this.save(); this.emit(); }

  get time() { return this.audio.currentTime || 0; }
  get duration() { return isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : (this.current && this.current.duration) || 0; }

  onTime() {
    const now = Date.now();
    if (!this.lastSave || now - this.lastSave > 5000) { this.rememberPosition(true); this.lastSave = now; }
    this.emit();
  }

  rememberPosition(persist) {
    if (!this.current) return;
    const t = this.audio.currentTime || 0, d = this.duration;
    // resume long tracks only (mixes, podcasts, audiobooks): over 8 minutes
    this.d.lastTime = Math.round(t);
    if (d > 480 && t > 5 && t < d - 10) this.d.positions[this.current.path] = Math.round(t);
    else delete this.d.positions[this.current.path];
    if (persist) this.save();
  }
  forgetPosition() { if (this.current) { delete this.d.positions[this.current.path]; this.save(); } }

  onEnded() {
    this.forgetPosition();
    this.host.onTrackEnded && this.host.onTrackEnded(this.current);
    this.next(true);
  }

  /* ---------- level meter for the glows ---------- */

  ensureMeter() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback' });
      const src = this.ctx.createMediaElementSource(this.audio);
      this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0.8;
      src.connect(this.analyser); this.analyser.connect(this.ctx.destination);
      this.buf = new Uint8Array(this.analyser.fftSize);
    } catch (e) { this.ctx = null; this.analyser = null; }
  }
  meter() {
    if (!this.analyser || !this.playing) return 0;
    this.analyser.getByteTimeDomainData(this.buf);
    let s = 0; for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / this.buf.length) * 3);
  }

  /* ---------- media keys ---------- */

  setupMediaKeys() {
    const ms = navigator.mediaSession; if (!ms) return;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* unsupported action */ } };
    set('play', () => this.play()); set('pause', () => this.pause());
    set('previoustrack', () => this.prev()); set('nexttrack', () => this.next());
    set('seekto', e => this.seek(e.seekTime));
  }
  updateMediaSession() {
    const ms = navigator.mediaSession, t = this.current; if (!ms || !t || typeof MediaMetadata === 'undefined') return;
    try {
      const art = t.cover ? [{ src: this.host.coverUrl(t.cover), sizes: '512x512' }] : [];
      ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art });
    } catch (e) { /* ignore */ }
  }

  destroy() {
    this.rememberPosition(true);
    this.loadToken++;
    try { this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); } catch (e) { /* ignore */ }
    if (this.url) URL.revokeObjectURL(this.url);
    try { if (this.ctx) this.ctx.close(); } catch (e) { /* ignore */ }
    const ms = navigator.mediaSession;
    if (ms) for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']) try { ms.setActionHandler(a, null); } catch (e) { /* ignore */ }
  }
}

function amShuffled(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
