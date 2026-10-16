/* Aurora MP3: a small, dependency-free tag reader.
 * Reads title, artist, album artist, album, year, track and disc numbers, genre, duration and the
 * embedded cover from MP3 (ID3v2.2/2.3/2.4, ID3v1), FLAC, MP4/M4A, Ogg Vorbis/Opus and WAV.
 *
 * amReadTags(read, size, ext) -> Promise<tags>
 *   read(offset, length) -> Promise<Uint8Array>  (may return fewer bytes at end of file)
 *   size: file size in bytes; ext: lower-case extension without the dot */

const AM_GENRES = ['Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock'];

const amLatin1 = (b, s = 0, e = b.length) => { let o = ''; for (let i = s; i < e; i++) o += String.fromCharCode(b[i]); return o; };
const amUtf8 = (b, s = 0, e = b.length) => new TextDecoder('utf-8').decode(b.subarray(s, e));
const amBE = (b, o, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[o + i]; return v; };
const amLE = (b, o, n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + b[o + i]; return v; };
const amSync = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const amClean = s => (s || '').replace(/\0+$/g, '').replace(/\0/g, ' / ').trim();
const amNum = s => { const m = /^\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(s || ''); return m ? [Number(m[1]), m[2] ? Number(m[2]) : 0] : [0, 0]; };

function amEmpty() {
  return { title: '', artist: '', albumArtist: '', album: '', year: '', track: 0, trackTotal: 0, disc: 0, genre: '', duration: 0, cover: null };
}

async function amReadTags(read, size, ext) {
  const t = amEmpty();
  const head = await read(0, Math.min(size, 65536));
  try {
    if (amLatin1(head, 4, 8) === 'ftyp' || ext === 'm4a' || ext === 'mp4' || ext === 'm4b' || ext === 'aac' && amLatin1(head, 4, 8) === 'ftyp') await amMp4(read, size, t);
    else if (amLatin1(head, 0, 4) === 'OggS') await amOgg(read, size, head, t);
    else if (amLatin1(head, 0, 4) === 'RIFF' && amLatin1(head, 8, 12) === 'WAVE') await amWav(read, size, head, t);
    else {
      let start = 0;
      if (amLatin1(head, 0, 3) === 'ID3') start = await amId3v2(read, head, t);
      const at = await read(start, 4);
      if (amLatin1(at, 0, 4) === 'fLaC') await amFlac(read, start + 4, t);
      else if (ext === 'mp3' || ext === 'mp2' || start > 0) {
        await amMp3Duration(read, size, start, t);
        if (!t.title && !t.artist) await amId3v1(read, size, t);
      }
    }
  } catch (e) { t.error = String(e && e.message || e); }
  if (t.genre) t.genre = amGenre(t.genre);
  return t;
}

function amGenre(g) {
  const m = /^\((\d+)\)(.*)$/.exec(g);
  if (m) return m[2] || AM_GENRES[Number(m[1])] || g;
  if (/^\d+$/.test(g)) return AM_GENRES[Number(g)] || g;
  return g;
}

/* ---------- ID3v2 ---------- */

function amDeunsync(b) {
  const out = []; for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
  return Uint8Array.from(out);
}

function amId3Text(b) {
  const enc = b[0], s = b.subarray(1);
  if (enc === 0) return amClean(amLatin1(s));
  if (enc === 3) return amClean(amUtf8(s));
  return amClean(amUtf16(s, enc === 2));
}

function amUtf16(s, be) {
  let i = 0, out = '';
  if (s[0] === 0xff && s[1] === 0xfe) { be = false; i = 2; } else if (s[0] === 0xfe && s[1] === 0xff) { be = true; i = 2; }
  for (; i + 1 < s.length; i += 2) {
    const c = be ? (s[i] << 8) | s[i + 1] : s[i] | (s[i + 1] << 8);
    if (c === 0) { // a new string in a multi-value frame starts with its own BOM
      if (i + 3 < s.length && ((s[i + 2] === 0xff && s[i + 3] === 0xfe) || (s[i + 2] === 0xfe && s[i + 3] === 0xff))) { out += '\0'; be = s[i + 2] === 0xfe; i += 2; continue; }
      out += '\0'; continue;
    }
    out += String.fromCharCode(c);
  }
  return out;
}

// skips an encoded, zero-terminated string; returns the index just after it
function amSkipStr(b, i, enc) {
  if (enc === 1 || enc === 2) { while (i + 1 < b.length && !(b[i] === 0 && b[i + 1] === 0)) i += 2; return i + 2; }
  while (i < b.length && b[i] !== 0) i++;
  return i + 1;
}

async function amId3v2(read, head, t) {
  const ver = head[3], flags = head[5], tagSize = amSync(head, 6), total = tagSize + 10 + (flags & 0x10 ? 10 : 0);
  let b = total <= head.length ? head.subarray(0, total) : await read(0, total);
  let p = 10, end = 10 + tagSize;
  if (ver < 4 && (flags & 0x80)) { b = Uint8Array.from([...b.subarray(0, 10), ...amDeunsync(b.subarray(10, end))]); end = b.length; }
  if (flags & 0x40) p += ver === 4 ? amSync(b, 10) : amBE(b, 10, 4) + 4;
  let bestCover = null;
  while (p < end) {
    let id, sz, fflags = 0, hdr;
    if (ver === 2) { id = amLatin1(b, p, p + 3); sz = amBE(b, p + 3, 3); hdr = 6; }
    else { id = amLatin1(b, p, p + 4); sz = ver === 4 ? amSync(b, p + 4) : amBE(b, p + 4, 4); fflags = amBE(b, p + 8, 2); hdr = 10; }
    if (!/^[A-Z0-9]{3,4}$/.test(id) || sz <= 0 || p + hdr + sz > b.length) break;
    let d = b.subarray(p + hdr, p + hdr + sz);
    p += hdr + sz;
    if (ver === 4) {
      if (fflags & 0x0001) d = d.subarray(4);           // data length indicator
      if (fflags & 0x0002) d = amDeunsync(d);           // per-frame unsynchronisation
      if (fflags & 0x000c) continue;                    // compressed / encrypted: skip
    } else if (ver === 3 && (fflags & 0x00c0)) continue;
    const key = id.length === 3 ? ({ TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TYE: 'TYER', TRK: 'TRCK', TPA: 'TPOS', TCO: 'TCON', PIC: 'APIC', TLE: 'TLEN' })[id] || id : id;
    switch (key) {
      case 'TIT2': t.title = amId3Text(d); break;
      case 'TPE1': t.artist = amId3Text(d); break;
      case 'TPE2': t.albumArtist = amId3Text(d); break;
      case 'TALB': t.album = amId3Text(d); break;
      case 'TYER': case 'TDRC': case 'TDOR': if (!t.year || key === 'TDRC') t.year = amId3Text(d).slice(0, 4); break;
      case 'TRCK': [t.track, t.trackTotal] = amNum(amId3Text(d)); break;
      case 'TPOS': t.disc = amNum(amId3Text(d))[0]; break;
      case 'TCON': t.genre = amId3Text(d).split('\0')[0]; break;
      case 'TLEN': { const ms = Number(amId3Text(d)); if (ms > 0) t.duration = ms / 1000; break; }
      case 'APIC': {
        const enc = d[0]; let i, mime, type;
        if (id === 'PIC') { const f = amLatin1(d, 1, 4).toLowerCase(); mime = f === 'png' ? 'image/png' : 'image/jpeg'; type = d[4]; i = 5; }
        else { i = 1; while (i < d.length && d[i] !== 0) i++; mime = amLatin1(d, 1, i).toLowerCase() || 'image/jpeg'; i++; type = d[i]; i++; }
        i = amSkipStr(d, i, enc);
        if (!mime.includes('/')) mime = 'image/' + (mime === 'png' ? 'png' : 'jpeg');
        const pic = { mime, data: d.slice(i) };
        if (!bestCover || type === 3) bestCover = pic;
        break;
      }
    }
  }
  if (bestCover && bestCover.data.length > 32) t.cover = bestCover;
  return total;
}

async function amId3v1(read, size, t) {
  if (size < 128) return;
  const b = await read(size - 128, 128);
  if (amLatin1(b, 0, 3) !== 'TAG') return;
  const s = (a, z) => amLatin1(b, a, z).replace(/\0.*$/, '').trim();
  t.title = s(3, 33); t.artist = s(33, 63); t.album = s(63, 93); t.year = s(93, 97);
  if (b[125] === 0 && b[126]) t.track = b[126];
  if (b[127] < AM_GENRES.length) t.genre = AM_GENRES[b[127]];
}

/* ---------- MP3 duration ---------- */

async function amMp3Duration(read, size, start, t) {
  if (t.duration) return;
  const b = await read(start, 16384);
  let i = 0;
  for (; i + 4 < b.length; i++) if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0 && (b[i + 1] & 0x18) !== 0x08 && (b[i + 1] & 0x06) !== 0 && (b[i + 2] & 0xf0) !== 0xf0 && (b[i + 2] & 0x0c) !== 0x0c) break;
  if (i + 4 >= b.length) return;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, mpeg1 = ver === 3;
  const brIdx = b[i + 2] >> 4, srIdx = (b[i + 2] >> 2) & 3, mono = (b[i + 3] >> 6) === 3;
  const br1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], br2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const bitrate = (layer === 1 ? (mpeg1 ? br1 : br2)[brIdx] : (mpeg1 ? br1 : br2)[brIdx]) * 1000;
  const sr = [44100, 48000, 32000][srIdx] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
  const spf = layer === 3 ? 384 : (layer === 1 && !mpeg1) ? 576 : 1152;
  const side = mpeg1 ? (mono ? 17 : 32) : (mono ? 9 : 17);
  const x = i + 4 + side, tag = amLatin1(b, x, x + 4);
  if ((tag === 'Xing' || tag === 'Info') && (b[x + 7] & 1)) { t.duration = amBE(b, x + 8, 4) * spf / sr; return; }
  if (amLatin1(b, i + 36, i + 40) === 'VBRI') { t.duration = amBE(b, i + 36 + 14, 4) * spf / sr; return; }
  if (bitrate) t.duration = (size - start - i) * 8 / bitrate;
}

/* ---------- FLAC ---------- */

function amVorbisComments(b, t, off = 0) {
  let p = off; const vlen = amLE(b, p, 4); p += 4 + vlen;
  const n = amLE(b, p, 4); p += 4;
  for (let k = 0; k < n && p + 4 <= b.length; k++) {
    const len = amLE(b, p, 4); p += 4;
    const s = amUtf8(b, p, p + len); p += len;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const key = s.slice(0, eq).toUpperCase(), v = s.slice(eq + 1).trim();
    if (key === 'TITLE') t.title = v;
    else if (key === 'ARTIST') t.artist = t.artist ? t.artist : v;
    else if (key === 'ALBUMARTIST' || key === 'ALBUM ARTIST') t.albumArtist = v;
    else if (key === 'ALBUM') t.album = v;
    else if (key === 'DATE' || key === 'YEAR') t.year = t.year || v.slice(0, 4);
    else if (key === 'TRACKNUMBER') { const [a, z] = amNum(v); t.track = a; if (z) t.trackTotal = z; }
    else if (key === 'TRACKTOTAL' || key === 'TOTALTRACKS') t.trackTotal = Number(v) || t.trackTotal;
    else if (key === 'DISCNUMBER') t.disc = amNum(v)[0];
    else if (key === 'GENRE') t.genre = t.genre || v;
    else if (key === 'METADATA_BLOCK_PICTURE' && !t.cover) {
      try { const bin = Uint8Array.from(atob(v), c => c.charCodeAt(0)); amFlacPicture(bin, t); } catch (e) { /* ignore a broken picture */ }
    }
  }
}

function amFlacPicture(b, t) {
  let p = 0; const type = amBE(b, p, 4); p += 4;
  const ml = amBE(b, p, 4); p += 4; const mime = amLatin1(b, p, p + ml) || 'image/jpeg'; p += ml;
  const dl = amBE(b, p, 4); p += 4 + dl + 16;
  const len = amBE(b, p, 4); p += 4;
  if (len > 32 && (!t.cover || type === 3)) t.cover = { mime, data: b.slice(p, p + len) };
}

async function amFlac(read, pos, t) {
  for (let guard = 0; guard < 64; guard++) {
    const h = await read(pos, 4); if (h.length < 4) break;
    const last = h[0] & 0x80, type = h[0] & 0x7f, len = amBE(h, 1, 3);
    pos += 4;
    if (type === 0) {
      const b = await read(pos, 18);
      const sr = (b[10] << 12) | (b[11] << 4) | (b[12] >> 4);
      const total = (b[13] & 0x0f) * 4294967296 + amBE(b, 14, 4);
      if (sr) t.duration = total / sr;
    } else if (type === 4) amVorbisComments(await read(pos, len), t);
    else if (type === 6 && len < 16 * 1024 * 1024) amFlacPicture(await read(pos, len), t);
    pos += len;
    if (last) break;
  }
}

/* ---------- MP4 / M4A ---------- */

async function amMp4(read, size, t) {
  // walk the top level to find moov (it can sit after the audio data)
  let pos = 0, moov = null;
  for (let guard = 0; pos + 8 <= size && guard < 1000; guard++) {
    const h = await read(pos, 16);
    let len = amBE(h, 0, 4); const type = amLatin1(h, 4, 8);
    if (len === 1) len = amBE(h, 8, 8); else if (len === 0) len = size - pos;
    if (len < 8) break;
    if (type === 'moov') { moov = await read(pos, Math.min(len, 64 * 1024 * 1024)); break; }
    pos += len;
  }
  if (!moov) return;
  const kids = (b, s, e, cb) => { for (let p = s; p + 8 <= e;) { let l = amBE(b, p, 4); const ty = amLatin1(b, p + 4, p + 8); if (l < 8 || p + l > e) break; cb(ty, p + 8, p + l); p += l; } };
  kids(moov, 8, moov.length, (ty, s, e) => {
    if (ty === 'mvhd') {
      const v = moov[s]; const ts = v === 1 ? amBE(moov, s + 20, 4) : amBE(moov, s + 12, 4);
      const du = v === 1 ? amBE(moov, s + 24, 8) : amBE(moov, s + 16, 4);
      if (ts) t.duration = du / ts;
    }
    if (ty === 'udta') kids(moov, s, e, (ty2, s2, e2) => {
      if (ty2 !== 'meta') return;
      kids(moov, s2 + 4, e2, (ty3, s3, e3) => {
        if (ty3 !== 'ilst') return;
        kids(moov, s3, e3, (key, s4, e4) => {
          kids(moov, s4, e4, (dt, s5, e5) => {
            if (dt !== 'data') return;
            const kind = amBE(moov, s5, 4) & 0xffffff, v = moov.subarray(s5 + 8, e5);
            const str = () => amUtf8(v).trim();
            switch (key) {
              case '©nam': t.title = str(); break;
              case '©ART': t.artist = str(); break;
              case 'aART': t.albumArtist = str(); break;
              case '©alb': t.album = str(); break;
              case '©day': t.year = str().slice(0, 4); break;
              case '©gen': t.genre = str(); break;
              case 'gnre': if (v.length >= 2) t.genre = AM_GENRES[amBE(v, 0, 2) - 1] || ''; break;
              case 'trkn': if (v.length >= 6) { t.track = amBE(v, 2, 2); t.trackTotal = amBE(v, 4, 2); } break;
              case 'disk': if (v.length >= 4) t.disc = amBE(v, 2, 2); break;
              case 'covr': if (!t.cover && v.length > 32) t.cover = { mime: kind === 14 ? 'image/png' : 'image/jpeg', data: v.slice() }; break;
            }
          });
        });
      });
    });
  });
}

/* ---------- Ogg Vorbis / Opus ---------- */

async function amOgg(read, size, head, t) {
  // gather the first packets from the first pages
  let pos = 0, packets = [], cur = [], guard = 0;
  while (packets.length < 2 && pos < size && guard++ < 200) {
    const h = await read(pos, 27 + 255);
    if (amLatin1(h, 0, 4) !== 'OggS') break;
    const nseg = h[26], segs = h.subarray(27, 27 + nseg);
    let bodyLen = 0; for (const s of segs) bodyLen += s;
    const body = await read(pos + 27 + nseg, bodyLen);
    let o = 0;
    for (const s of segs) {
      cur.push(body.subarray(o, o + s)); o += s;
      if (s < 255) { packets.push(amConcat(cur)); cur = []; if (packets.length >= 2) break; }
    }
    pos += 27 + nseg + bodyLen;
    if (packets.length >= 2 && packets[1].length > 16 * 1024 * 1024) break;
  }
  if (!packets.length) return;
  const id = packets[0];
  let rate = 0, preSkip = 0;
  if (amLatin1(id, 1, 7) === 'vorbis') rate = amLE(id, 12, 4);
  else if (amLatin1(id, 0, 8) === 'OpusHead') { rate = 48000; preSkip = amLE(id, 10, 2); }
  const c = packets[1];
  if (c) {
    if (amLatin1(c, 1, 7) === 'vorbis') amVorbisComments(c, t, 7);
    else if (amLatin1(c, 0, 8) === 'OpusTags') amVorbisComments(c, t, 8);
  }
  // duration from the last page's granule position
  if (rate) {
    const n = Math.min(size, 65536), tail = await read(size - n, n);
    for (let i = tail.length - 27; i >= 0; i--) {
      if (tail[i] === 0x4f && tail[i + 1] === 0x67 && tail[i + 2] === 0x67 && tail[i + 3] === 0x53) {
        const g = amLE(tail, i + 6, 6); // 48-bit is plenty
        if (g > 0) { t.duration = Math.max(0, g - preSkip) / rate; break; }
      }
    }
  }
}

function amConcat(parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ---------- WAV ---------- */

async function amWav(read, size, head, t) {
  let p = 12, byteRate = 0;
  for (let guard = 0; p + 8 <= size && guard < 64; guard++) {
    const h = p + 8 <= head.length ? head.subarray(p, p + 8) : await read(p, 8);
    const id = amLatin1(h, 0, 4), len = amLE(h, 4, 4);
    if (id === 'fmt ') { const f = await read(p + 8, 16); byteRate = amLE(f, 8, 4); }
    else if (id === 'data' && byteRate) t.duration = Math.min(len, size - p - 8) / byteRate;
    else if (id === 'LIST') {
      const b = await read(p + 8, Math.min(len, 65536));
      if (amLatin1(b, 0, 4) === 'INFO') {
        for (let q = 4; q + 8 <= b.length;) {
          const k = amLatin1(b, q, q + 4), l = amLE(b, q + 4, 4), v = amClean(amUtf8(b, q + 8, q + 8 + l));
          if (k === 'INAM') t.title = v; else if (k === 'IART') t.artist = v; else if (k === 'IPRD') t.album = v;
          else if (k === 'ICRD') t.year = v.slice(0, 4); else if (k === 'IGNR') t.genre = v; else if (k === 'ITRK') t.track = amNum(v)[0];
          q += 8 + l + (l & 1);
        }
      }
    }
    p += 8 + len + (len & 1);
  }
}
