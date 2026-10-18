/* =====================================================================
 * Aurora MP3: Obsidian glue
 * ===================================================================== */

const AMP_VIEW = 'aurora-mp3-view';
const AMP_DEFAULTS = {
  folders: [], theme: 'glass', albumView: 'grid', motion: true, statusBar: true,
  volume: 0.8, shuffle: false, repeat: 'off', queue: [], originalQueue: [], index: 0, last: null, lastTime: 0,
  positions: {}, favourites: {}, playlists: [], tab: 'albums',
  logFormat: '- {{time}} ♪ {{title}} — {{artist}} ({{album}})',
  logTarget: 'daily', logNote: 'Music log.md', autoLog: false, systemNow: false
};

class AMPView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.ui = null; }
  getViewType() { return AMP_VIEW; }
  getDisplayText() { return 'Aurora MP3'; }
  getIcon() { return 'disc-3'; }
  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('amp-host');
    const root = this.contentEl.createDiv();
    this.ui = mountAmp(root, this.plugin.api());
  }
  async onClose() { if (this.ui) this.ui.destroy(); this.ui = null; }
}

class AuroraMP3Plugin extends Plugin {
  async onload() {
    const fs = require('fs'), path = require('path');
    this.fs = fs; this.path = path;
    this.d = Object.assign({}, AMP_DEFAULTS, await this.loadData());
    this.saveTimer = null;
    const dir = this.manifest.dir, adapter = this.app.vault.adapter;
    const coverPath = n => `${dir}/covers/${n}`;
    this.coverUrl = n => adapter.getResourcePath(coverPath(n));

    this.library = new AMLibrary({
      fs, path,
      loadIndex: async () => { try { return JSON.parse(await adapter.read(`${dir}/library.json`)); } catch (e) { return null; } },
      saveIndex: async o => adapter.write(`${dir}/library.json`, JSON.stringify(o)),
      coverExists: n => adapter.exists(coverPath(n)),
      writeCover: async (n, bytes) => {
        if (!(await adapter.exists(`${dir}/covers`))) await adapter.mkdir(`${dir}/covers`);
        await adapter.writeBinary(coverPath(n), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
    });
    await this.library.load();

    this.player = new AMPlayer({ fs, library: this.library, getData: () => this.d, saveData: () => this.save(), coverUrl: this.coverUrl });
    this.register(this.player.on(() => { this.updateStatus(); this.maybeAutoLog(); }));

    this.registerView(AMP_VIEW, leaf => new AMPView(leaf, this));
    this.addRibbonIcon('disc-3', 'Aurora MP3', () => this.activateView());

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('amp-status');
    this.registerDomEvent(this.statusEl, 'click', () => this.extShown() ? this.sysNow.control('toggle') : this.player.toggle());
    this.updateStatus();

    this.registerMarkdownCodeBlockProcessor('aurora-mp3', (src, el) => this.renderEmbed(src, el));
    this.addCommands();
    this.addSettingTab(new AMPSettingTab(this.app, this));

    // One player at a time: tell the other AshOtis players when music starts, and pause when one of them starts
    this.registerDomEvent(this.player.audio, 'play', () => this.app.workspace.trigger('ashotis:playing', 'aurora-mp3'));
    for (const ev of ['pause', 'ended']) this.registerDomEvent(this.player.audio, ev, () => this.app.workspace.trigger('ashotis:stopped', 'aurora-mp3'));
    this.registerEvent(this.app.workspace.on('ashotis:playing', src => {
      if (src === 'aurora-mp3' || this.d.playTogether === true) return;
      if (this.player.playing) this.player.pause();
      if (this.ext && this.ext.playing) this.sysNow.control('pause');
    }));
    // your own music starting pauses Spotify (or whatever else is playing on the computer)
    this.registerDomEvent(this.player.audio, 'play', () => {
      this.extLed = false;
      if (this.ext && this.ext.playing && this.d.playTogether !== true) this.sysNow.control('pause');
    });

    // What's playing on your computer (Spotify and friends), read from Windows
    this.ext = null; this.extLed = false;
    this.sysNow = new AMSystemNow(st => this.onExt(st));
    if (this.d.systemNow) this.app.workspace.onLayoutReady(() => this.sysNow.start());

    // Share the album cover's colours with the Static Aurora theme while music plays
    this.registerInterval(window.setInterval(() => this.syncTheme(), 1000));

    this.app.workspace.onLayoutReady(() => {
      this.player.restore();
      if (this.d.folders.length) window.setTimeout(() => this.rescan(true), 3000);
    });
  }

  setSystemNow(on) {
    this.d.systemNow = on; this.save();
    if (on) this.sysNow.start(); else { this.sysNow.stop(); this.extLed = false; }
    this.refreshViews();
  }

  // Spotify (or another app) changed track or started/paused
  onExt(st) {
    const was = this.ext;
    this.ext = st;
    if (st && st.playing && !(was && was.playing)) {
      this.extLed = true;                                             // it leads until your own music plays again
      this.app.workspace.trigger('ashotis:playing', 'aurora-mp3');      // the other players step aside
      if (this.player.playing && this.d.playTogether !== true) this.player.pause();
    }
    if (was && was.playing && !(st && st.playing) && this.extShown()) this.app.workspace.trigger('ashotis:stopped', 'aurora-mp3');
    if (!st) this.extLed = false;
    this.syncTheme(); this.updateStatus();
    for (const leaf of this.app.workspace.getLeavesOfType(AMP_VIEW)) if (leaf.view && leaf.view.ui && leaf.view.ui.paint) leaf.view.ui.paint();
  }

  // show the computer's track instead of yours: it is playing (or you paused it here) and your music isn't playing
  extShown() { return !!(this.d.systemNow && this.ext && this.extLed && !this.player.playing); }

  // Resume your own music: pause the other app, then play
  resumeOwn() { if (this.ext && this.ext.playing) this.sysNow.control('pause'); this.extLed = false; this.player.toggle(); }

  // Writes the theme colours only when they change (a new album), never on a timer tick:
  // every write makes Obsidian restyle the whole window, so frequent writes made the app sluggish.
  syncTheme() {
    const p = this.player, body = document.body, vars = ['--sa-c1', '--sa-c2', '--sa-c3'];
    const ext = this.extShown() ? this.ext : null;
    const t = ext ? { cover: 'ext:' + ext.app + '|' + ext.album + '|' + ext.title, art: ext.art } : p.current;
    if (this.d.themeSync === false || !t || !(ext ? ext.playing : p.playing)) {
      // paused or stopped: keep the last colours on the theme; only clear when syncing is switched off
      if (this.d.themeSync === false && this.synced) { delete body.dataset.saOwner; for (const v of vars) body.style.removeProperty(v); this.synced = false; this.syncKey = ''; }
      return;
    }
    if (t.cover !== this.syncCover) {
      this.syncCover = t.cover; this.syncCols = null;
      const url = t.art !== undefined ? (t.art || null) : (t.cover ? this.coverUrl(t.cover) : null);
      amPalette(url).then(cols => { if (this.syncCover === t.cover) this.syncCols = cols; });
    }
    if (!this.syncCols || !this.mayColourTheme('aurora-mp3')) return;
    const rgb = c => `rgb(${c.map(v => Math.round(v)).join(', ')})`;
    const vals = [rgb(this.syncCols[0]), rgb(this.syncCols[1]), rgb(this.syncCols[2].map(v => v * 0.75))];
    const key = vals.join('|');
    if (key === this.syncKey && this.synced) return;
    vals.forEach((v, i) => body.style.setProperty(vars[i], v));
    this.syncKey = key; this.synced = true;
  }

  // Only one plugin colours the theme at a time: whoever started first keeps it until they stop
  mayColourTheme(me) {
    const o = (document.body.dataset.saOwner || '').split(':');
    if (o[0] && o[0] !== me && Date.now() - Number(o[1]) < 3000) { this.synced = false; return false; }
    if (o[0] !== me) this.synced = false;   // taking over from another player: repaint
    document.body.dataset.saOwner = me + ':' + Date.now();
    return true;
  }

  onunload() {
    if (this.sysNow) this.sysNow.stop();
    if ((document.body.dataset.saOwner || '').startsWith('aurora-mp3:')) delete document.body.dataset.saOwner;
    for (const v of ['--sa-c1', '--sa-c2', '--sa-c3']) document.body.style.removeProperty(v);
    this.player.destroy();
    clearTimeout(this.saveTimer);
    this.saveData(this.d);
  }

  save() { clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => this.saveData(this.d), 500); }

  api() {
    return {
      player: this.player, library: this.library, data: this.d,
      save: () => this.save(),
      coverUrl: this.coverUrl,
      roots: () => this.d.folders,
      openSettings: () => { this.app.setting.open(); this.app.setting.openTabById(this.manifest.id); },
      rescan: () => this.rescan(),
      menu: (evt, items) => {
        const m = new Menu();
        for (const it of items) {
          if (it.section) { m.addSeparator(); continue; }
          m.addItem(i => i.setTitle(it.title).setIcon(it.icon || null).onClick(it.run));
        }
        m.showAtMouseEvent(evt);
      },
      logTrack: t => this.logTrack(t),
      logLabel: () => this.logLabel(),
      insertEmbed: (kind, ref) => this.insertEmbed(kind, ref),
      openUrl: u => window.open(u),
      ext: () => (this.extShown() ? this.ext : null),
      extControl: a => this.sysNow.control(a),
      resumeOwn: () => this.resumeOwn(),
      systemNowOn: () => !!this.d.systemNow
    };
  }

  async rescan(quiet) {
    if (!this.d.folders.length) { if (!quiet) new Notice('Aurora MP3: add a music folder in settings first'); return; }
    if (this.library.scanning) return;
    const before = this.library.tracks.size;
    await this.library.scan(this.d.folders);
    if (!quiet) new Notice(`Aurora MP3: ${this.library.tracks.size} tracks (${this.library.tracks.size - before >= 0 ? '+' : ''}${this.library.tracks.size - before})`);
    this.refreshViews();
  }

  refreshViews() { for (const leaf of this.app.workspace.getLeavesOfType(AMP_VIEW)) if (leaf.view && leaf.view.ui) leaf.view.ui.refresh(); }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(AMP_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: AMP_VIEW, active: true });
    }
    await workspace.revealLeaf(leaf);
    return leaf;
  }

  updateStatus() {
    if (!this.statusEl) return;
    if (this.extShown()) {
      const x = this.ext;
      this.statusEl.toggleClass('amp-hidden', !this.d.statusBar);
      this.statusEl.setText(`${x.playing ? '♪' : '❚❚'} ${x.title}${x.artist ? ' — ' + x.artist : ''}`);
      this.statusEl.setAttribute('aria-label', `Aurora MP3: playing on ${x.appName}. Click to ${x.playing ? 'pause' : 'play'}`);
      return;
    }
    const t = this.player.current;
    const show = this.d.statusBar && t && (this.player.playing || this.player.time > 0);
    this.statusEl.toggleClass('amp-hidden', !show);
    if (!show) return;
    this.statusEl.setText(`${this.player.playing ? '♪' : '❚❚'} ${t.title}${t.artist ? ' — ' + t.artist : ''}`);
    this.statusEl.setAttribute('aria-label', this.player.playing ? 'Aurora MP3: click to pause' : 'Aurora MP3: click to play');
  }

  addCommands() {
    const p = this.player;
    const cmds = [
      ['open', 'Open player', () => this.activateView()],
      ['toggle', 'Play / pause', () => this.extShown() ? this.sysNow.control('toggle') : p.toggle()],
      ['next', 'Next track', () => this.extShown() ? this.sysNow.control('next') : p.next()],
      ['previous', 'Previous track', () => this.extShown() ? this.sysNow.control('prev') : p.prev()],
      ['shuffle', 'Shuffle on / off', () => p.toggleShuffle()],
      ['repeat', 'Cycle repeat (off, all, one)', () => p.cycleRepeat()],
      ['favourite', 'Favourite / unfavourite current track', () => { const t = p.current; if (!t) return; if (this.d.favourites[t.path]) delete this.d.favourites[t.path]; else this.d.favourites[t.path] = Date.now(); this.save(); this.refreshViews(); }],
      ['log', 'Log current track', () => this.d.logTarget === 'off' ? new Notice('Aurora MP3: logging is off in settings') : p.current ? this.logTrack(p.current) : new Notice('Aurora MP3: nothing playing')],
      ['insert-embed-card', 'Insert player card for current track into note', () => p.current && this.insertEmbed('track', p.current)],
      ['rescan', 'Rescan music library', () => this.rescan()],
      ['theme', 'Switch look (glass / terminal)', () => { this.d.theme = this.d.theme === 'terminal' ? 'glass' : 'terminal'; this.save(); this.refreshViews(); }],
      ['search', 'Search music', async () => { const leaf = await this.activateView(); if (leaf && leaf.view.ui) leaf.view.ui.focusSearch(); }]
    ];
    for (const [id, name, callback] of cmds) this.addCommand({ id, name, callback });
    this.addCommand({
      id: 'insert-embed', name: 'Insert current track into note',
      editorCheckCallback: (checking, editor) => { if (!p.current) return false; if (!checking) editor.replaceSelection(this.embedText('track', p.current) + '\n'); return true; }
    });
  }

  /* ---------- notes ---------- */

  dailyNotePath() {
    let folder = '', format = 'YYYY-MM-DD';
    try {
      const dn = this.app.internalPlugins.getPluginById('daily-notes');
      const o = dn && dn.instance && dn.instance.options;
      if (o) { folder = o.folder || ''; format = o.format || format; }
    } catch (e) { /* daily notes core plugin off: use defaults */ }
    const name = window.moment().format(format);
    return (folder ? folder.replace(/\/+$/, '') + '/' : '') + name + '.md';
  }

  logPath() {
    if (this.d.logTarget === 'daily') return this.dailyNotePath();
    let p = (this.d.logNote || 'Music log').trim().replace(/^\/+/, '');
    if (!/\.md$/i.test(p)) p += '.md';
    return p;
  }

  // the label for the log button, or null when logging is off
  logLabel() {
    if (this.d.logTarget === 'off') return null;
    if (this.d.logTarget === 'daily') return 'Log to daily note';
    return 'Log to ' + this.logPath().replace(/^.*\//, '').replace(/\.md$/i, '');
  }

  // auto-log: once per play, after 30 seconds of listening
  maybeAutoLog() {
    const p = this.player;
    if (!this.d.autoLog || this.d.logTarget === 'off' || !p.current || !p.playing) return;
    if (this.autoLogged === p.loadToken || p.time < 30) return;
    this.autoLogged = p.loadToken;
    this.logTrack(p.current, true);
  }

  async logTrack(t, quiet) {
    if (this.d.logTarget === 'off') return;
    const line = this.d.logFormat
      .replace(/{{time}}/g, window.moment().format('HH:mm'))
      .replace(/{{date}}/g, window.moment().format('YYYY-MM-DD'))
      .replace(/{{title}}/g, t.title || '').replace(/{{artist}}/g, t.artist || t.albumArtist || 'Unknown artist')
      .replace(/{{album}}/g, t.album || '').replace(/{{year}}/g, t.year || '');
    const path = this.logPath();
    let file = this.app.vault.getAbstractFileByPath(path);
    try {
      if (!file) {
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
        file = await this.app.vault.create(path, line + '\n');
      } else {
        await this.app.vault.process(file, txt => (txt && !txt.endsWith('\n') ? txt + '\n' : txt) + line + '\n');
      }
      if (!quiet) new Notice(`Logged "${t.title}" to ${file.basename}`);
    } catch (e) { if (!quiet) new Notice('Aurora MP3: could not write to ' + path); }
  }

  embedText(kind, ref) {
    const lines = ['```aurora-mp3'];
    if (kind === 'track') lines.push(`track: ${ref.path}`);
    else if (kind === 'album') lines.push(`album: ${ref.title}`, `artist: ${ref.artist}`);
    else if (kind === 'artist') lines.push(`artist: ${ref.name}`);
    else if (kind === 'playlist') lines.push(`playlist: ${ref.name}`);
    else if (kind === 'folder') lines.push(`folder: ${ref.path}`);
    lines.push('```');
    return lines.join('\n');
  }

  // insert the embed block at the cursor of the note you were last editing
  insertEmbed(kind, ref) {
    const ed = this.app.workspace.activeEditor && this.app.workspace.activeEditor.editor;
    if (!ed) { new Notice('Aurora MP3: open a note first, then insert the embed'); return; }
    const cur = ed.getCursor(), line = ed.getLine(cur.line);
    const text = (line.trim() ? '\n' : '') + this.embedText(kind, ref) + '\n';
    ed.replaceRange(text, cur);
    new Notice('Embed added to the note');
  }

  resolveEmbed(src) {
    const kv = {}; for (const line of src.split('\n')) { const m = /^\s*(\w+)\s*:\s*(.+?)\s*$/.exec(line); if (m) kv[m[1].toLowerCase()] = m[2]; }
    const L = this.library, k = s => amKey(s);
    if (kv.track) { const t = L.tracks.get(kv.track); return t ? { title: t.title, sub: [t.artist, t.album].filter(Boolean).join(' · '), cover: t.cover, tracks: [t] } : null; }
    if (kv.album) { const a = L.albums.find(x => k(x.title) === k(kv.album) && (!kv.artist || k(x.artist) === k(kv.artist))) || L.albums.find(x => k(x.title) === k(kv.album)); return a ? { title: a.title, sub: [a.artist, a.year].filter(Boolean).join(' · '), cover: a.cover, tracks: a.tracks } : null; }
    if (kv.artist) { const r = L.artists.find(x => k(x.name) === k(kv.artist)); return r ? { title: r.name, sub: `${r.albums.length} albums · ${r.tracks.length} tracks`, cover: r.albums[0] && r.albums[0].cover, tracks: r.tracks } : null; }
    if (kv.playlist) { const pl = this.d.playlists.find(x => k(x.name) === k(kv.playlist)); if (!pl) return null; const tr = pl.tracks.map(p => L.tracks.get(p)).filter(Boolean); return { title: pl.name, sub: `Playlist · ${tr.length} tracks`, cover: tr[0] && tr[0].cover, tracks: tr }; }
    if (kv.folder) { const tr = [...L.tracks.values()].filter(t => t.path.startsWith(kv.folder)).sort((a, b) => a.path.localeCompare(b.path)); return tr.length ? { title: kv.folder.split(/[\\/]/).filter(Boolean).pop(), sub: `Folder · ${tr.length} tracks`, cover: tr[0].cover, tracks: tr } : null; }
    return null;
  }

  renderEmbed(src, el) {
    const r = this.resolveEmbed(src);
    const card = el.createDiv({ cls: 'amp-embed' });
    if (!r) { card.createDiv({ cls: 'amp-embed-miss', text: 'Aurora MP3: this music is not in your library (yet). Check the folder in settings and rescan.' }); return; }
    const art = card.createDiv({ cls: 'amp-embed-art' });
    if (r.cover) art.createEl('img', { attr: { src: this.coverUrl(r.cover), alt: '' } });
    const info = card.createDiv({ cls: 'amp-embed-info' });
    info.createDiv({ cls: 'amp-embed-title', text: r.title });
    info.createDiv({ cls: 'amp-embed-sub', text: r.sub });
    const b = card.createEl('button', { cls: 'amp-embed-play', text: 'Play' });
    b.setAttribute('aria-label', 'Play ' + r.title);
    b.addEventListener('click', () => this.player.playList(r.tracks.map(t => t.path), 0));
  }
}

class AMPSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this, p = this.plugin, d = p.d;
    containerEl.empty();
    new Setting(containerEl).setName('Music folders').setHeading();
    for (const f of d.folders) {
      new Setting(containerEl).setName(f).addExtraButton(b => b.setIcon('trash').setTooltip('Remove folder').onClick(() => {
        d.folders = d.folders.filter(x => x !== f); p.library.folderTree = null; p.save(); this.display();
      }));
    }
    let pending = '';
    new Setting(containerEl).setName('Add a folder')
      .setDesc('Paste the full path of a folder with music, e.g. C:\\Users\\you\\Music or /Users/you/Music. Subfolders are included.')
      .addText(t => t.setPlaceholder('Folder path').onChange(v => { pending = v.trim().replace(/^"(.*)"$/, '$1'); }))
      .addButton(b => b.setButtonText('Add').setCta().onClick(async () => {
        if (!pending) return;
        let ok = false; try { ok = (await p.fs.promises.stat(pending)).isDirectory(); } catch (e) { ok = false; }
        if (!ok) { new Notice('That folder was not found'); return; }
        if (!d.folders.includes(pending)) d.folders.push(pending);
        p.library.folderTree = null; p.save(); this.display();
        p.rescan();
      }));
    new Setting(containerEl).setName('Rescan library')
      .setDesc(p.library.tracks.size ? `${p.library.tracks.size} tracks, ${p.library.albums.length} albums. Unchanged files are skipped, so rescans are quick.` : 'Not scanned yet.')
      .addButton(b => b.setButtonText(p.library.scanning ? 'Scanning…' : 'Rescan').onClick(async () => { b.setDisabled(true); await p.rescan(); this.display(); }));

    new Setting(containerEl).setName('Look').setHeading();
    new Setting(containerEl).setName('Theme').setDesc('Glass: covers and drifting colour glows. Terminal: calm monospace text.')
      .addDropdown(dd => dd.addOptions({ glass: 'Glass', terminal: 'Terminal' }).setValue(d.theme).onChange(v => { d.theme = v; p.save(); p.refreshViews(); }));
    new Setting(containerEl).setName('Albums view').setDesc('Glass theme only. You can also switch with the buttons above the albums.')
      .addDropdown(dd => dd.addOptions({ grid: 'Grid', list: 'List' }).setValue(d.albumView).onChange(v => { d.albumView = v; p.save(); p.refreshViews(); }));
    new Setting(containerEl).setName('Background motion').setDesc('Slowly drifting glows tinted by the album cover. Turn off for a still background.')
      .addToggle(t => t.setValue(d.motion).onChange(v => { d.motion = v; p.save(); }));
    new Setting(containerEl).setName('Colour the Static Aurora theme').setDesc('While music plays, the Static Aurora theme glows in the colours of the album cover. Has no effect with other themes.')
      .addToggle(t => t.setValue(d.themeSync !== false).onChange(v => { d.themeSync = v; p.save(); p.syncTheme(); }));
    new Setting(containerEl).setName("Show what's playing on your computer")
      .setDesc(AMSystemNow.supported()
        ? 'When Spotify, a browser, Apple Music, VLC or another app is playing, show the track and its cover here, with play, pause, next and previous, and let its album colours tint the Static Aurora theme. Read from Windows; no account needed. Your own music takes over again when you press play.'
        : 'Windows only for now.')
      .addToggle(t => t.setValue(!!d.systemNow).setDisabled(!AMSystemNow.supported()).onChange(v => p.setSystemNow(v)));
    new Setting(containerEl).setName('Play alongside other players').setDesc('Off: starting Static FM, Hi-Fi Tuner or MFP Player pauses the music, and the other way round. On: let them play together.')
      .addToggle(t => t.setValue(d.playTogether === true).onChange(v => { d.playTogether = v; p.save(); }));
    new Setting(containerEl).setName('Show in status bar').setDesc('The current track. Click it to play or pause.')
      .addToggle(t => t.setValue(d.statusBar).onChange(v => { d.statusBar = v; p.save(); p.updateStatus(); }));

    new Setting(containerEl).setName('Listening log').setHeading();
    new Setting(containerEl).setName('Log tracks to')
      .setDesc('Where "Log" writes a line about the current track. Off hides the log button.')
      .addDropdown(dd => dd.addOptions({ daily: 'Daily note', note: 'A separate note', off: 'Off' }).setValue(d.logTarget)
        .onChange(v => { d.logTarget = v; p.save(); p.refreshViews(); this.display(); }));
    if (d.logTarget === 'note') {
      new Setting(containerEl).setName('Log note').setDesc('Path of the note in your vault. It is created if it does not exist.')
        .addText(t => t.setPlaceholder('Music log.md').setValue(d.logNote).onChange(v => { d.logNote = v.trim() || 'Music log.md'; p.save(); p.refreshViews(); }));
    }
    if (d.logTarget !== 'off') {
      new Setting(containerEl).setName('Log automatically').setDesc('Add every track you listen to for at least 30 seconds, without pressing the button.')
        .addToggle(t => t.setValue(d.autoLog).onChange(v => { d.autoLog = v; p.save(); }));
      new Setting(containerEl).setName('Line format').setDesc('Placeholders: {{date}}, {{time}}, {{title}}, {{artist}}, {{album}}, {{year}}.')
        .addText(t => t.setValue(d.logFormat).onChange(v => { d.logFormat = v || AMP_DEFAULTS.logFormat; p.save(); }));
    }
  }
}

module.exports = AuroraMP3Plugin;
