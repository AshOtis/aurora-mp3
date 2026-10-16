/* Aurora MP3: music library — scans folders, reads tags, caches covers, groups albums/artists/folders.
 * host: { fs (node fs), path (node path), loadIndex(), saveIndex(obj), coverExists(name), writeCover(name, bytes), coverUrl(name) } */

const AM_EXTS = new Set(['mp3', 'flac', 'm4a', 'mp4', 'm4b', 'aac', 'ogg', 'oga', 'opus', 'wav']);
const AM_FOLDER_COVERS = ['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'];
const AM_INDEX_VERSION = 1;

function amHash(bytes) { // FNV-1a 32-bit, sampled for big images
  let h = 0x811c9dc5; const step = bytes.length > 65536 ? Math.floor(bytes.length / 65536) : 1;
  for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
}
function amKey(s) { return (s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function amSortKey(s) { return (s || '').replace(/^the\s+/i, '').toLowerCase(); }

class AMLibrary {
  constructor(host) {
    this.host = host;
    this.tracks = new Map();      // path -> track
    this.albums = []; this.artists = []; this.folderTree = null;
    this.scanning = false; this.progress = { done: 0, total: 0 };
    this.listeners = new Set();
    this.scannedAt = 0;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(what) { for (const fn of this.listeners) try { fn(what); } catch (e) { /* keep going */ } }

  async load() {
    const idx = await this.host.loadIndex();
    if (idx && idx.version === AM_INDEX_VERSION && idx.tracks) {
      for (const t of idx.tracks) this.tracks.set(t.path, t);
      this.scannedAt = idx.scannedAt || 0;
    }
    this.group();
  }

  async save() {
    await this.host.saveIndex({ version: AM_INDEX_VERSION, scannedAt: this.scannedAt, tracks: [...this.tracks.values()] });
  }

  async listFiles(folders) {
    const { fs, path } = this.host, files = [], seen = new Set();
    const walk = async (dir, depth) => {
      if (depth > 24) return;
      let entries; try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (e.isFile()) {
          const ext = e.name.split('.').pop().toLowerCase();
          if (AM_EXTS.has(ext) && !seen.has(full)) { seen.add(full); files.push(full); }
        }
      }
    };
    for (const f of folders) await walk(f, 0);
    return files;
  }

  async scan(folders) {
    if (this.scanning) return;
    this.scanning = true; this.stop = false;
    const { fs, path } = this.host;
    try {
      const files = await this.listFiles(folders);
      this.progress = { done: 0, total: files.length };
      this.emit('progress');
      const keep = new Set(files);
      for (const p of [...this.tracks.keys()]) if (!keep.has(p)) this.tracks.delete(p);
      const folderCovers = new Map();
      let i = 0;
      const worker = async () => {
        while (i < files.length && !this.stop) {
          const file = files[i++];
          try {
            const st = await fs.promises.stat(file);
            const old = this.tracks.get(file);
            if (!old || old.mtime !== st.mtimeMs || old.size !== st.size) {
              this.tracks.set(file, await this.readTrack(file, st, folderCovers));
            } else if (!old.cover) {
              const fc = await this.folderCover(path.dirname(file), folderCovers);
              if (fc) old.cover = fc;
            }
          } catch (e) { /* unreadable file: skip */ }
          this.progress.done++;
          if (this.progress.done % 25 === 0) this.emit('progress');
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      this.scannedAt = Date.now();
      this.group();
      await this.save();
    } finally {
      this.scanning = false;
      this.emit('progress');
      this.emit('changed');
    }
  }

  async readTrack(file, st, folderCovers) {
    const { fs, path } = this.host;
    const fh = await fs.promises.open(file, 'r');
    let tags;
    try {
      const read = async (off, len) => {
        len = Math.max(0, Math.min(len, st.size - off));
        if (len <= 0 || off < 0) return new Uint8Array(0);
        const buf = new Uint8Array(len);
        const { bytesRead } = await fh.read(buf, 0, len, off);
        return bytesRead < len ? buf.subarray(0, bytesRead) : buf;
      };
      tags = await amReadTags(read, st.size, file.split('.').pop().toLowerCase());
    } finally { await fh.close(); }
    let cover = null;
    if (tags.cover && tags.cover.data.length < 12 * 1024 * 1024) {
      const ext = tags.cover.mime.includes('png') ? 'png' : 'jpg';
      cover = amHash(tags.cover.data) + '.' + ext;
      try { if (!(await this.host.coverExists(cover))) await this.host.writeCover(cover, tags.cover.data); } catch (e) { cover = null; }
    }
    if (!cover) cover = await this.folderCover(path.dirname(file), folderCovers);
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const dir = path.basename(path.dirname(file));
    let title = tags.title, track = tags.track;
    if (!title) { const m = /^(\d{1,3})[\s._-]+(.+)$/.exec(base); title = m ? m[2] : base; if (m && !track) track = Number(m[1]); }
    return {
      path: file, mtime: st.mtimeMs, size: st.size,
      title, artist: tags.artist || '', albumArtist: tags.albumArtist || '', album: tags.album || dir,
      year: tags.year || '', track: track || 0, trackTotal: tags.trackTotal || 0, disc: tags.disc || 0,
      genre: tags.genre || '', duration: Math.round((tags.duration || 0) * 10) / 10, cover
    };
  }

  async folderCover(dir, cache) {
    if (cache.has(dir)) return cache.get(dir);
    const p = (async () => {
      const { fs, path } = this.host;
      let entries; try { entries = await fs.promises.readdir(dir); } catch (e) { return null; }
      const pick = entries.find(n => { const m = /^(.+)\.(jpe?g|png)$/i.exec(n); return m && AM_FOLDER_COVERS.includes(m[1].toLowerCase()); })
        || entries.find(n => /\.(jpe?g|png)$/i.test(n));
      if (!pick) return null;
      try {
        const buf = await fs.promises.readFile(path.join(dir, pick));
        if (buf.length > 12 * 1024 * 1024) return null;
        const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
        const name = amHash(bytes) + (/png$/i.test(pick) ? '.png' : '.jpg');
        if (!(await this.host.coverExists(name))) await this.host.writeCover(name, bytes);
        return name;
      } catch (e) { return null; }
    })();
    cache.set(dir, p);
    return p;
  }

  /* ---------- grouping ---------- */

  group() {
    const albums = new Map(), artists = new Map();
    for (const t of this.tracks.values()) {
      const who = t.albumArtist || t.artist || 'Unknown artist';
      const dir = t.path.slice(0, Math.max(t.path.lastIndexOf('/'), t.path.lastIndexOf('\\')));
      // albums without an album artist are grouped by album name + folder, so compilations stay together
      const ak = t.albumArtist ? amKey(t.albumArtist) + '|' + amKey(t.album) : 'dir|' + dir + '|' + amKey(t.album);
      let a = albums.get(ak);
      if (!a) { a = { id: ak, title: t.album || 'Unknown album', artist: who, artists: new Set(), year: t.year, cover: t.cover, tracks: [], duration: 0 }; albums.set(ak, a); }
      a.tracks.push(t); a.duration += t.duration || 0; a.artists.add(t.artist || who);
      if (!a.cover && t.cover) a.cover = t.cover;
      if (!a.year && t.year) a.year = t.year;
      const rk = amKey(t.artist || who);
      let r = artists.get(rk);
      if (!r) { r = { id: rk, name: t.artist || who, albums: new Set(), tracks: [] }; artists.set(rk, r); }
      r.tracks.push(t); r.albums.add(a);
    }
    for (const a of albums.values()) {
      if (!a.tracks.some(t => t.albumArtist) && a.artists.size > 1) a.artist = 'Various artists';
      a.tracks.sort((x, y) => (x.disc || 0) - (y.disc || 0) || (x.track || 999) - (y.track || 999) || x.path.localeCompare(y.path));
      a.artists = [...a.artists];
    }
    this.albums = [...albums.values()].sort((x, y) => amSortKey(x.title).localeCompare(amSortKey(y.title)));
    this.artists = [...artists.values()].map(r => ({ ...r, albums: [...r.albums].sort((x, y) => (x.year || '').localeCompare(y.year || '')) }))
      .sort((x, y) => amSortKey(x.name).localeCompare(amSortKey(y.name)));
    for (const r of this.artists) r.tracks.sort((x, y) => (x.album || '').localeCompare(y.album || '') || (x.track || 0) - (y.track || 0));
    this.folderTree = null;
  }

  albumOf(t) { return this.albums.find(a => a.tracks.includes(t)) || null; }

  // folders: built lazily, relative to the configured roots
  folders(roots) {
    if (this.folderTree) return this.folderTree;
    const sep = p => p.includes('\\') ? '\\' : '/';
    const rootNodes = roots.map(r => ({ name: r.split(/[\\/]/).filter(Boolean).pop() || r, path: r, dirs: new Map(), tracks: [] }));
    for (const t of this.tracks.values()) {
      const root = rootNodes.find(n => t.path.startsWith(n.path));
      if (!root) continue;
      const rel = t.path.slice(root.path.length).split(/[\\/]/).filter(Boolean);
      let node = root;
      for (let i = 0; i < rel.length - 1; i++) {
        let next = node.dirs.get(rel[i]);
        if (!next) { next = { name: rel[i], path: node.path + sep(node.path) + rel[i], dirs: new Map(), tracks: [] }; node.dirs.set(rel[i], next); }
        node = next;
      }
      node.tracks.push(t);
    }
    const fin = n => ({ name: n.name, path: n.path, dirs: [...n.dirs.values()].map(fin).sort((a, b) => a.name.localeCompare(b.name)), tracks: n.tracks.sort((a, b) => (a.track || 0) - (b.track || 0) || a.path.localeCompare(b.path)) });
    this.folderTree = rootNodes.map(fin);
    return this.folderTree;
  }

  search(q) {
    q = amKey(q); if (!q) return { albums: [], artists: [], tracks: [] };
    const words = q.split(' ');
    const hit = s => { const k = amKey(s); return words.every(w => k.includes(w)); };
    return {
      albums: this.albums.filter(a => hit(a.title + ' ' + a.artist)).slice(0, 30),
      artists: this.artists.filter(r => hit(r.name)).slice(0, 20),
      tracks: [...this.tracks.values()].filter(t => hit(t.title + ' ' + t.artist + ' ' + t.album)).slice(0, 80)
    };
  }
}
