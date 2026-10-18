/* Aurora MP3: the view. One DOM, two themes (glass, terminal) chosen by a class on the root.
 * mountAmp(root, api) -> { destroy, refresh }
 * api: { player, library, data, save(), coverUrl(name), roots(), openSettings(), rescan(), menu(evt, items),
 *        logTrack(track), logLabel(), insertEmbed(kind, ref), openUrl(url) } */

const AM_ICONS = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
  prev: '<path d="M6 6h2v12H6zM20 6v12L9 12z" fill="currentColor"/>',
  next: '<path d="M16 6h2v12h-2zM4 6v12l11-6z" fill="currentColor"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  repeat: '<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M12 12v6M9 15h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  embed: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.4-9.3 9-9.3 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  heartOn: '<path d="M12 21s-7-4.6-9.3-9A5.3 5.3 0 0 1 12 6a5.3 5.3 0 0 1 9.3 6c-2.3 4.4-9.3 9-9.3 9z" fill="currentColor"/>',
  vol: '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11" stroke-linecap="round"/><rect x="3.5" y="4.5" width="3" height="3" rx=".5"/><rect x="3.5" y="10.5" width="3" height="3" rx=".5"/><rect x="3.5" y="16.5" width="3" height="3" rx=".5"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  more: '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  pc: '<rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 20h8M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  disc: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>'
};

function mountAmp(root, api) {
  const { player, library } = api;
  const d = api.data;
  let stopped = false, raf = 0;
  const nav = { tab: d.tab || 'albums', stack: [], query: '' };

  const NS = 'http://www.w3.org/2000/svg';
  const h = (tag, cls, text, parent) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; if (parent) parent.appendChild(n); return n; };
  const svg = (name, size = 20, extraCls) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', 'amp-ico' + (extraCls ? ' ' + extraCls : ''));
    if (name === 'grid' || name === 'list') { s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); }
    // icon markup is static and authored here; parse it with DOMParser
    const doc = new DOMParser().parseFromString('<svg xmlns="' + NS + '">' + AM_ICONS[name] + '</svg>', 'image/svg+xml');
    for (const c of [...doc.documentElement.childNodes]) s.appendChild(document.importNode(c, true));
    return s;
  };
  // a button with an icon (glass) and a bracket label (terminal)
  const btn = (parent, icon, label, title, cls, onClick) => {
    const b = h('button', 'amp-btn' + (cls ? ' ' + cls : ''), null, parent);
    if (icon) b.appendChild(svg(icon, cls && cls.includes('amp-big') ? 24 : 18));
    h('span', 'amp-lbl', label, b);
    if (cls && cls.includes('amp-pill') && !cls.includes('amp-pill-icon')) h('span', 'amp-txt', label.replace(/^\[|\]$/g, '').replace(/^./, c => c.toUpperCase()), b);
    b.setAttribute('aria-label', title); b.title = title;
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const hh = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = s % 60; return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0'); };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const coverImg = (name, cls, parent, label) => {
    const wrap = h('div', 'amp-art ' + (cls || ''), null, parent);
    if (name) { const im = h('img', null, null, wrap); im.loading = 'lazy'; im.decoding = 'async'; im.alt = ''; im.src = api.coverUrl(name); im.draggable = false; }
    else { wrap.classList.add('is-empty'); wrap.appendChild(svg('disc', 22)); }
    if (label) wrap.setAttribute('aria-label', label);
    return wrap;
  };

  root.classList.add('amp');
  root.textContent = '';
  const sky = h('div', 'amp-sky', null, root);
  const aurora = new AMAurora(sky);
  const scroll = h('div', 'amp-scroll', null, root);

  /* ---------- header + now playing ---------- */
  const head = h('header', 'amp-head', null, scroll);
  h('div', 'amp-title', 'Aurora MP3', head);
  const sub = h('div', 'amp-sub', '', head);

  const now = h('section', 'amp-now', null, scroll);
  const nowArt = h('div', 'amp-now-art', null, now);
  const nowInfo = h('div', 'amp-now-info', null, now);
  const nowSrc = h('div', 'amp-src', null, nowInfo); h('i', null, null, nowSrc); const nowSrcTxt = h('span', null, '', nowSrc);
  const nowTitle = h('div', 'amp-now-title', '', nowInfo);
  const nowArtist = h('button', 'amp-now-artist amp-link', '', nowInfo);
  const nowAlbum = h('button', 'amp-now-album amp-link', '', nowInfo);
  const nowMeta = h('div', 'amp-now-meta', '', nowInfo);
  nowArtist.addEventListener('click', () => { const t = player.current; if (t) openArtist(library.artists.find(r => amKey(r.name) === amKey(t.artist || t.albumArtist))); });
  nowAlbum.addEventListener('click', () => { const t = player.current; if (t) openAlbum(library.albumOf(t)); });

  const seekRow = h('div', 'amp-seek', null, scroll);
  const seek = h('input', 'amp-range', null, seekRow);
  Object.assign(seek, { type: 'range', min: 0, max: 1000, step: 1, value: 0 });
  seek.setAttribute('aria-label', 'Position');
  const times = h('div', 'amp-times', null, seekRow);
  const tNow = h('span', null, '0:00', times), tLeft = h('span', null, '0:00', times);
  const termBar = h('div', 'amp-termbar', '', seekRow);
  let seeking = false;
  seek.addEventListener('pointerdown', () => { seeking = true; });
  seek.addEventListener('input', () => { seeking = true; fill(seek); tNow.textContent = fmt(seek.value / 1000 * player.duration); });
  seek.addEventListener('change', () => { player.seek(seek.value / 1000 * player.duration); seeking = false; });

  const transport = h('div', 'amp-transport', null, scroll);
  const X = () => api.ext && api.ext();   // the computer's track, when it is showing instead of yours
  const bShuffle = btn(transport, 'shuffle', '[shuffle]', 'Shuffle', 'amp-small', () => player.toggleShuffle());
  btn(transport, 'prev', '[prev]', 'Previous', 'amp-mid', () => X() ? api.extControl('prev') : player.prev());
  const bPlay = btn(transport, 'play', '[play]', 'Play', 'amp-big', () => X() ? api.extControl('toggle') : player.toggle());
  btn(transport, 'next', '[next]', 'Next', 'amp-mid', () => X() ? api.extControl('next') : player.next());
  const bRepeat = btn(transport, 'repeat', '[repeat off]', 'Repeat', 'amp-small', () => player.cycleRepeat());

  const extNote = h('div', 'amp-extnote', '', scroll);
  const resume = h('button', 'amp-resume', null, scroll);
  resume.appendChild(svg('disc', 16));
  const resumeTxt = h('span', 'amp-resume-txt', '', resume);
  h('span', 'amp-resume-go', 'Resume', resume);
  resume.addEventListener('click', () => api.resumeOwn());

  const extras = h('div', 'amp-extras', null, scroll);
  const bLog = btn(extras, 'note', '[log]', 'Log', 'amp-small', () => { const x = X(); if (x) api.logTrack({ title: x.title, artist: x.artist, album: x.album }); else if (player.current) api.logTrack(player.current); });
  const bEmbed = btn(extras, 'embed', '[add to note]', 'Add player card to note', 'amp-small', () => player.current && api.insertEmbed('track', player.current));
  const bFav = btn(extras, 'heart', '[♥]', 'Favourite', 'amp-small', () => { const t = player.current; if (!t) return; toggleFav(t.path); });
  const volWrap = h('label', 'amp-vol', null, extras);
  volWrap.appendChild(svg('vol', 18));
  const volLbl = h('span', 'amp-lbl', '', volWrap);
  const vol = h('input', 'amp-range amp-range-vol', null, volWrap);
  Object.assign(vol, { type: 'range', min: 0, max: 100, step: 1, value: Math.round(d.volume * 100) });
  vol.setAttribute('aria-label', 'Volume');
  vol.addEventListener('input', () => { player.setVolume(vol.value / 100); fill(vol); });

  /* ---------- browse ---------- */
  const tabs = h('nav', 'amp-tabs', null, scroll);
  const TABS = [['albums', 'Albums'], ['artists', 'Artists'], ['folders', 'Folders'], ['playlists', 'Playlists'], ['queue', 'Queue']];
  const tabBtns = {};
  for (const [id, name] of TABS) {
    const b = h('button', 'amp-tab', name, tabs);
    b.addEventListener('click', () => { nav.tab = id; nav.stack = []; d.tab = id; api.save(); search.value = ''; nav.query = ''; renderBrowse(); });
    tabBtns[id] = b;
  }
  const searchRow = h('div', 'amp-search', null, scroll);
  const search = h('input', 'amp-input', null, searchRow);
  Object.assign(search, { type: 'search', placeholder: 'Search albums, artists, tracks' });
  search.setAttribute('aria-label', 'Search music');
  let searchTimer = 0;
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { nav.query = search.value; renderBrowse(); }, 150); });

  const toolbar = h('div', 'amp-toolbar', null, scroll);
  const browse = h('div', 'amp-browse', null, scroll);

  const foot = h('footer', 'amp-foot', null, scroll);
  const stats = h('span', 'amp-stats', '', foot);
  const bRescan = h('button', 'amp-link', 'Rescan', foot);
  bRescan.addEventListener('click', () => api.rescan());
  const bCoffee = h('button', 'amp-link', 'Buy me a coffee', foot);
  bCoffee.addEventListener('click', () => api.openUrl('https://buymeacoffee.com/ashotis'));

  const fill = inp => inp.style.setProperty('--amp-pct', ((inp.value - inp.min) / (inp.max - inp.min) * 100) + '%');

  /* ---------- helpers ---------- */
  function toggleFav(p) { if (d.favourites[p]) delete d.favourites[p]; else d.favourites[p] = Date.now(); api.save(); paintNow(); renderBrowse(); }
  function trackMenu(evt, t, list, i) {
    evt.preventDefault();
    const items = [
      { title: 'Play', icon: 'play', run: () => list ? player.playList(list.map(x => x.path), i) : player.playList([t.path]) },
      { title: 'Play next', icon: 'list-start', run: () => player.enqueue([t.path], true) },
      { title: 'Add to queue', icon: 'list-plus', run: () => player.enqueue([t.path]) },
      { title: d.favourites[t.path] ? 'Remove from favourites' : 'Add to favourites', icon: 'heart', run: () => toggleFav(t.path) },
      { section: true },
      ...playlistItems([t.path]),
      { section: true },
      ...(api.logLabel() ? [{ title: api.logLabel(), icon: 'calendar-plus', run: () => api.logTrack(t) }] : []),
      { title: 'Add player card to note', icon: 'link', run: () => api.insertEmbed('track', t) }
    ];
    api.menu(evt, items);
  }
  function listMenu(evt, title, paths, embedKind, embedRef) {
    evt.preventDefault();
    const items = [
      { title: 'Play', icon: 'play', run: () => player.playList(paths, 0) },
      { title: 'Shuffle', icon: 'shuffle', run: () => player.playList(paths, 0, { shuffle: true }) },
      { title: 'Play next', icon: 'list-start', run: () => player.enqueue(paths, true) },
      { title: 'Add to queue', icon: 'list-plus', run: () => player.enqueue(paths) },
      { section: true },
      ...playlistItems(paths)
    ];
    if (embedKind) items.push({ section: true }, { title: 'Add player card to note', icon: 'link', run: () => api.insertEmbed(embedKind, embedRef) });
    api.menu(evt, items);
  }
  function playlistItems(paths) {
    const items = d.playlists.map(pl => ({ title: 'Add to ' + pl.name, icon: 'list-music', run: () => { pl.tracks.push(...paths.filter(p => !pl.tracks.includes(p))); api.save(); renderBrowse(); } }));
    items.push({ title: 'New playlist with ' + (paths.length === 1 ? 'this track' : 'these tracks'), icon: 'plus', run: () => newPlaylist(paths) });
    return items;
  }
  function newPlaylist(paths) {
    const pl = { id: 'pl' + Date.now().toString(36), name: 'Playlist ' + (d.playlists.length + 1), tracks: paths ? paths.slice() : [] };
    d.playlists.push(pl); api.save();
    nav.tab = 'playlists'; nav.stack = [{ kind: 'playlist', id: pl.id, rename: true }]; renderBrowse();
  }

  function trackRows(parent, tracks, opts = {}) {
    const ol = h('ol', 'amp-tracks', null, parent);
    const LIMIT = 400;
    tracks.slice(0, opts.all ? tracks.length : LIMIT).forEach((t, i) => {
      const li = h('li', 'amp-track', null, ol);
      li.dataset.path = t.path;
      li.tabIndex = 0;
      const num = h('span', 'amp-tnum', opts.numbers === 'index' ? String(i + 1) : (t.track ? String(t.track) : '·'), li);
      if (opts.covers) { coverImg(t.cover, 'amp-art-xs', li); num.remove(); }
      const mid = h('span', 'amp-tmid', null, li);
      h('span', 'amp-tname', t.title, mid);
      if (opts.artist !== false) h('span', 'amp-tsub', [t.artist, opts.album ? t.album : ''].filter(Boolean).join(' · '), mid);
      if (d.favourites[t.path]) h('span', 'amp-tfav', '♥', li);
      h('span', 'amp-tdur', t.duration ? fmt(t.duration) : '', li);
      const play = () => opts.onPlay ? opts.onPlay(i) : player.playList(tracks.map(x => x.path), i);
      li.addEventListener('click', play);
      li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(); } });
      li.addEventListener('contextmenu', e => opts.onMenu ? opts.onMenu(e, t, i) : trackMenu(e, t, tracks, i));
      if (opts.removable) {
        const x = btn(li, 'close', '[x]', 'Remove', 'amp-small amp-tx', e => { e.stopPropagation(); opts.removable(i); });
        x.tabIndex = -1;
      }
    });
    if (!opts.all && tracks.length > LIMIT) {
      const more = h('button', 'amp-link amp-more', `Show all ${tracks.length}`, parent);
      more.addEventListener('click', () => { ol.remove(); more.remove(); trackRows(parent, tracks, { ...opts, all: true }); markCurrent(); });
    }
    return ol;
  }

  function markCurrent() {
    const cur = player.current && player.current.path;
    for (const li of browse.querySelectorAll('.amp-track')) li.classList.toggle('is-current', li.dataset.path === cur && (!li.dataset.qi || Number(li.dataset.qi) === d.index));
  }

  function backBar(label) {
    const bar = h('div', 'amp-backbar', null, browse);
    btn(bar, 'back', '[back]', 'Back', 'amp-small', () => { nav.stack.pop(); renderBrowse(); });
    h('span', 'amp-backlbl', label, bar);
    return bar;
  }

  function detailHead(coverName, title, subtitle, meta, paths, embed) {
    const box = h('div', 'amp-detail', null, browse);
    coverImg(coverName, 'amp-art-md', box, title);
    const info = h('div', 'amp-detail-info', null, box);
    h('div', 'amp-detail-title', title, info);
    if (subtitle) h('div', 'amp-detail-sub', subtitle, info);
    if (meta) h('div', 'amp-detail-meta', meta, info);
    const acts = h('div', 'amp-actions', null, browse);
    btn(acts, 'play', '[play]', 'Play', 'amp-pill', () => player.playList(paths, 0));
    btn(acts, 'shuffle', '[shuffle]', 'Shuffle', 'amp-pill', () => player.playList(paths, 0, { shuffle: true }));
    btn(acts, 'more', '[more]', 'More', 'amp-pill amp-pill-icon', e => listMenu(e, title, paths, embed && embed[0], embed && embed[1]));
    return acts;
  }

  /* ---------- views ---------- */
  function openAlbum(a) { if (!a) return; nav.tab = 'albums'; nav.stack = [{ kind: 'album', id: a.id }]; search.value = ''; nav.query = ''; renderBrowse(); browse.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  function openArtist(r) { if (!r) return; nav.tab = 'artists'; nav.stack = [{ kind: 'artist', id: r.id }]; search.value = ''; nav.query = ''; renderBrowse(); browse.scrollIntoView({ block: 'start', behavior: 'smooth' }); }

  function albumCards(parent, albums, view) {
    const term = d.theme === 'terminal';
    if (view === 'grid' && !term) {
      const grid = h('div', 'amp-grid', null, parent);
      for (const a of albums) {
        const card = h('button', 'amp-card', null, grid);
        card.setAttribute('aria-label', a.title + ' by ' + a.artist);
        coverImg(a.cover, 'amp-art-card', card);
        h('span', 'amp-card-title', a.title, card);
        h('span', 'amp-card-sub', a.artist, card);
        card.addEventListener('click', () => openAlbum(a));
        card.addEventListener('contextmenu', e => listMenu(e, a.title, a.tracks.map(t => t.path), 'album', a));
      }
    } else {
      const ul = h('ul', 'amp-rows', null, parent);
      for (const a of albums) {
        const li = h('li', null, null, ul);
        const row = h('button', 'amp-row', null, li);
        if (!term) coverImg(a.cover, 'amp-art-sm', row);
        const mid = h('span', 'amp-row-mid', null, row);
        h('span', 'amp-row-title', a.title + (term ? ' — ' + a.artist : ''), mid);
        if (!term) h('span', 'amp-row-sub', [a.artist, a.year].filter(Boolean).join(' · '), mid);
        h('span', 'amp-row-count', plural(a.tracks.length, term ? 'tr' : 'track').replace(/trs$/, 'tr'), row);
        row.addEventListener('click', () => openAlbum(a));
        row.addEventListener('contextmenu', e => listMenu(e, a.title, a.tracks.map(t => t.path), 'album', a));
      }
    }
  }

  function renderBrowse() {
    for (const id in tabBtns) tabBtns[id].classList.toggle('is-on', id === nav.tab && !nav.query);
    browse.textContent = ''; toolbar.textContent = '';
    toolbar.hidden = true;
    const roots = api.roots();
    if (!roots.length) {
      const empty = h('div', 'amp-empty', null, browse);
      h('div', 'amp-empty-title', 'Add your music folder', empty);
      h('p', null, 'Point Aurora MP3 at a folder of music on this computer, for example your Music folder. It scans the subfolders and reads tags and covers. Nothing leaves your computer.', empty);
      if (api.systemNowOn && api.systemNowOn()) h('p', null, 'Spotify and other apps playing on this computer show above, and colour the theme, even without a music folder.', empty);
      btn(empty, null, 'Open settings', 'Open settings', 'amp-pill amp-pill-accent', () => api.openSettings());
      return;
    }
    if (!library.tracks.size) {
      const empty = h('div', 'amp-empty', null, browse);
      h('div', 'amp-empty-title', library.scanning ? 'Scanning your music…' : 'No music found yet', empty);
      h('p', null, library.scanning ? 'This only takes a while the first time.' : 'Supported: MP3, FLAC, M4A/AAC, Ogg, Opus and WAV.', empty);
      if (!library.scanning) btn(empty, null, 'Scan now', 'Scan now', 'amp-pill amp-pill-accent', () => api.rescan());
      return;
    }

    if (nav.query.trim()) return renderSearch();
    const top = nav.stack[nav.stack.length - 1];

    if (nav.tab === 'albums') {
      if (top && top.kind === 'album') {
        const a = library.albums.find(x => x.id === top.id); if (!a) { nav.stack.pop(); return renderBrowse(); }
        backBar('Albums');
        detailHead(a.cover, a.title, a.artist, [a.year, plural(a.tracks.length, 'track'), fmt(a.duration)].filter(Boolean).join(' · '), a.tracks.map(t => t.path), ['album', a]);
        const multiArtist = a.artists.length > 1;
        trackRows(browse, a.tracks, { artist: multiArtist });
      } else {
        toolbar.hidden = false;
        const view = d.albumView === 'list' ? 'list' : 'grid';
        h('span', 'amp-count', plural(library.albums.length, 'album') + ' · A–Z', toolbar);
        if (d.theme !== 'terminal') {
          const tg = h('div', 'amp-toggle', null, toolbar);
          const g = btn(tg, 'grid', '[grid]', 'Grid view', 'amp-tg' + (view === 'grid' ? ' is-on' : ''), () => { d.albumView = 'grid'; api.save(); renderBrowse(); });
          const l = btn(tg, 'list', '[list]', 'List view', 'amp-tg' + (view === 'list' ? ' is-on' : ''), () => { d.albumView = 'list'; api.save(); renderBrowse(); });
          g.setAttribute('aria-pressed', view === 'grid'); l.setAttribute('aria-pressed', view === 'list');
        }
        albumCards(browse, library.albums, view);
      }
    } else if (nav.tab === 'artists') {
      if (top && top.kind === 'artist') {
        const r = library.artists.find(x => x.id === top.id); if (!r) { nav.stack.pop(); return renderBrowse(); }
        backBar('Artists');
        detailHead(r.albums[0] && r.albums[0].cover, r.name, plural(r.albums.length, 'album') + ' · ' + plural(r.tracks.length, 'track'), '', r.tracks.map(t => t.path), ['artist', r]);
        h('div', 'amp-h', 'Albums', browse);
        albumCards(browse, r.albums, 'list');
        h('div', 'amp-h', 'All tracks', browse);
        trackRows(browse, r.tracks, { artist: false, album: true, numbers: 'index' });
      } else {
        const ul = h('ul', 'amp-rows', null, browse);
        for (const r of library.artists) {
          const li = h('li', null, null, ul);
          const row = h('button', 'amp-row', null, li);
          if (d.theme !== 'terminal') coverImg(r.albums[0] && r.albums[0].cover, 'amp-art-sm amp-art-round', row);
          const mid = h('span', 'amp-row-mid', null, row);
          h('span', 'amp-row-title', r.name, mid);
          h('span', 'amp-row-sub', plural(r.albums.length, 'album') + ' · ' + plural(r.tracks.length, 'track'), mid);
          row.addEventListener('click', () => openArtist(r));
          row.addEventListener('contextmenu', e => listMenu(e, r.name, r.tracks.map(t => t.path), 'artist', r));
        }
      }
    } else if (nav.tab === 'folders') {
      const tree = library.folders(roots);
      let node = null, crumbs = [];
      for (const s of nav.stack) { const list = node ? node.dirs : tree; const n = list.find(x => x.path === s.path); if (!n) break; node = n; crumbs.push(n); }
      const bar = h('div', 'amp-crumbs', null, browse);
      const rootBtn = h('button', 'amp-link', 'Folders', bar);
      rootBtn.addEventListener('click', () => { nav.stack = []; renderBrowse(); });
      crumbs.forEach((c, i) => { h('span', 'amp-crumb-sep', '/', bar); const b = h('button', 'amp-link', c.name, bar); b.addEventListener('click', () => { nav.stack = nav.stack.slice(0, i + 1); renderBrowse(); }); });
      const dirs = node ? node.dirs : tree, files = node ? node.tracks : [];
      const all = []; const collect = n => { all.push(...n.tracks); n.dirs.forEach(collect); }; if (node) collect(node);
      if (node && all.length) {
        const acts = h('div', 'amp-actions', null, browse);
        btn(acts, 'play', '[play folder]', 'Play folder', 'amp-pill', () => player.playList(all.map(t => t.path), 0));
        btn(acts, 'shuffle', '[shuffle]', 'Shuffle folder', 'amp-pill', () => player.playList(all.map(t => t.path), 0, { shuffle: true }));
        btn(acts, 'more', '[more]', 'More', 'amp-pill amp-pill-icon', e => listMenu(e, node.name, all.map(t => t.path), 'folder', node));
      }
      const ul = h('ul', 'amp-rows', null, browse);
      for (const n of dirs) {
        const li = h('li', null, null, ul);
        const row = h('button', 'amp-row amp-row-dir', null, li);
        row.appendChild(svg('folder', 18));
        const mid = h('span', 'amp-row-mid', null, row);
        h('span', 'amp-row-title', n.name, mid);
        h('span', 'amp-row-count', n.dirs.length ? plural(n.dirs.length, 'folder') : plural(n.tracks.length, 'track'), row);
        row.addEventListener('click', () => { nav.stack.push({ kind: 'folder', path: n.path }); renderBrowse(); });
        row.addEventListener('contextmenu', e => { const all2 = []; const c2 = x => { all2.push(...x.tracks); x.dirs.forEach(c2); }; c2(n); listMenu(e, n.name, all2.map(t => t.path), 'folder', n); });
      }
      if (files.length) trackRows(browse, files, { album: true });
    } else if (nav.tab === 'playlists') {
      if (top && top.kind === 'playlist') {
        const pl = d.playlists.find(x => x.id === top.id); if (!pl) { nav.stack.pop(); return renderBrowse(); }
        backBar('Playlists');
        const tracks = pl.id === 'favourites' ? [] : pl.tracks.map(p => library.tracks.get(p)).filter(Boolean);
        const nameRow = h('div', 'amp-plname', null, browse);
        const name = h('input', 'amp-input amp-plname-input', null, nameRow);
        name.value = pl.name; name.setAttribute('aria-label', 'Playlist name');
        name.addEventListener('change', () => { pl.name = name.value.trim() || pl.name; api.save(); });
        if (top.rename) { setTimeout(() => { name.focus(); name.select(); }, 30); top.rename = false; }
        h('div', 'amp-detail-meta', plural(tracks.length, 'track') + ' · ' + fmt(tracks.reduce((s, t) => s + (t.duration || 0), 0)), browse);
        const acts = h('div', 'amp-actions', null, browse);
        btn(acts, 'play', '[play]', 'Play', 'amp-pill', () => player.playList(tracks.map(t => t.path), 0));
        btn(acts, 'shuffle', '[shuffle]', 'Shuffle', 'amp-pill', () => player.playList(tracks.map(t => t.path), 0, { shuffle: true }));
        btn(acts, 'embed', '[add to note]', 'Add player card to note', 'amp-pill amp-pill-icon', () => api.insertEmbed('playlist', pl));
        btn(acts, 'close', '[delete]', 'Delete playlist', 'amp-pill amp-pill-icon', () => { if (confirmDelete(pl)) { d.playlists = d.playlists.filter(x => x !== pl); api.save(); nav.stack.pop(); renderBrowse(); } });
        if (!tracks.length) h('p', 'amp-hint', 'Right-click any track, album or folder and choose "Add to ' + pl.name + '".', browse);
        trackRows(browse, tracks, { album: true, numbers: 'index', removable: i => { pl.tracks.splice(pl.tracks.indexOf(tracks[i].path), 1); api.save(); renderBrowse(); } });
      } else {
        const acts = h('div', 'amp-actions', null, browse);
        btn(acts, null, '[new playlist]', 'New playlist', 'amp-pill amp-pill-accent', () => newPlaylist());
        const favTracks = Object.keys(d.favourites).map(p => library.tracks.get(p)).filter(Boolean);
        const ul = h('ul', 'amp-rows', null, browse);
        const row = (title, subTxt, onClick, onMenu, icon) => {
          const li = h('li', null, null, ul); const r = h('button', 'amp-row', null, li);
          r.appendChild(svg(icon, 18));
          const mid = h('span', 'amp-row-mid', null, r); h('span', 'amp-row-title', title, mid); h('span', 'amp-row-sub', subTxt, mid);
          r.addEventListener('click', onClick); if (onMenu) r.addEventListener('contextmenu', onMenu);
        };
        row('Favourites', plural(favTracks.length, 'track'), () => { nav.stack = [{ kind: 'favs' }]; renderBrowse(); }, e => listMenu(e, 'Favourites', favTracks.map(t => t.path)), 'heartOn');
        for (const pl of d.playlists) row(pl.name, plural(pl.tracks.length, 'track'), () => { nav.stack = [{ kind: 'playlist', id: pl.id }]; renderBrowse(); }, e => listMenu(e, pl.name, pl.tracks, 'playlist', pl), 'list');
      }
      if (top && top.kind === 'favs') {
        browse.textContent = '';
        backBar('Playlists');
        const favTracks = Object.entries(d.favourites).sort((a, b) => b[1] - a[1]).map(([p]) => library.tracks.get(p)).filter(Boolean);
        h('div', 'amp-detail-title', 'Favourites', browse);
        const acts = h('div', 'amp-actions', null, browse);
        btn(acts, 'play', '[play]', 'Play', 'amp-pill', () => player.playList(favTracks.map(t => t.path), 0));
        btn(acts, 'shuffle', '[shuffle]', 'Shuffle', 'amp-pill', () => player.playList(favTracks.map(t => t.path), 0, { shuffle: true }));
        if (!favTracks.length) h('p', 'amp-hint', 'Press the heart on the player, or right-click a track, to add favourites.', browse);
        trackRows(browse, favTracks, { album: true, numbers: 'index' });
      }
    } else if (nav.tab === 'queue') {
      const q = d.queue.map(p => library.tracks.get(p)).filter(Boolean);
      const acts = h('div', 'amp-actions', null, browse);
      h('span', 'amp-count', plural(q.length, 'track') + (d.shuffle ? ' · shuffled' : ''), acts);
      if (q.length) btn(acts, null, '[save as playlist]', 'Save as playlist', 'amp-pill', () => newPlaylist(d.queue.slice()));
      if (q.length) btn(acts, null, '[clear]', 'Clear queue', 'amp-pill', () => { player.unload(); d.queue = []; d.index = 0; api.save(); renderBrowse(); paintNow(); });
      if (!q.length) h('p', 'amp-hint', 'Nothing queued. Play an album, artist or folder, or right-click and choose "Add to queue".', browse);
      const ol = trackRows(browse, q, { album: true, numbers: 'index', onPlay: i => player.jump(i), removable: i => player.removeAt(i), onMenu: (e, t) => trackMenu(e, t) });
      [...ol.children].forEach((li, i) => { li.dataset.qi = i; });
      const cur = ol.children[d.index]; if (cur) setTimeout(() => cur.scrollIntoView({ block: 'nearest' }), 0);
    }
    markCurrent();
  }

  function confirmDelete(pl) { return pl.tracks.length === 0 || window.confirm('Delete the playlist "' + pl.name + '"? The music files are not touched.'); }

  function renderSearch() {
    const r = library.search(nav.query);
    if (!r.albums.length && !r.artists.length && !r.tracks.length) { h('p', 'amp-hint', 'Nothing matches "' + nav.query.trim() + '".', browse); return; }
    if (r.artists.length) {
      h('div', 'amp-h', 'Artists', browse);
      const ul = h('ul', 'amp-rows', null, browse);
      for (const a of r.artists) { const li = h('li', null, null, ul); const row = h('button', 'amp-row', null, li); const mid = h('span', 'amp-row-mid', null, row); h('span', 'amp-row-title', a.name, mid); h('span', 'amp-row-sub', plural(a.tracks.length, 'track'), mid); row.addEventListener('click', () => openArtist(a)); }
    }
    if (r.albums.length) { h('div', 'amp-h', 'Albums', browse); albumCards(browse, r.albums, 'list'); }
    if (r.tracks.length) { h('div', 'amp-h', 'Tracks', browse); trackRows(browse, r.tracks, { album: true, covers: d.theme !== 'terminal' }); }
    markCurrent();
  }

  /* ---------- painting ---------- */
  let lastCover = undefined, lastFav = null;
  function paintNow() {
    const logLbl = api.logLabel();
    bLog.hidden = !logLbl;
    if (logLbl) { bLog.title = logLbl; bLog.setAttribute('aria-label', logLbl); bLog.querySelector('.amp-lbl').textContent = '[' + logLbl.toLowerCase() + ']'; }
    root.classList.toggle('amp-glass', d.theme !== 'terminal');
    root.classList.toggle('amp-term', d.theme === 'terminal');
    const x = X();
    root.classList.toggle('is-ext', !!x);
    root.classList.toggle('is-playing', x ? x.playing : player.playing);
    nowSrc.hidden = !x; extNote.hidden = !x;
    if (x) return paintExt(x);
    resume.hidden = true;
    const t = player.current;
    if (t && t.cover !== lastCover) {
      lastCover = t.cover; nowArt.textContent = '';
      coverImg(t.cover, 'amp-art-lg', nowArt, t.album);
      amPalette(t.cover ? api.coverUrl(t.cover) : null).then(cols => { colours = cols; });
    } else if (!t && lastCover !== null) { lastCover = null; nowArt.textContent = ''; coverImg(null, 'amp-art-lg', nowArt); }
    nowTitle.textContent = t ? t.title : 'Nothing playing';
    nowArtist.textContent = t ? (t.artist || t.albumArtist || 'Unknown artist') : (library.tracks.size ? 'Pick an album below' : '');
    nowAlbum.textContent = t ? t.album : '';
    const ext = t ? t.path.split('.').pop().toLowerCase() : '';
    nowMeta.textContent = t ? [t.year, ext, player.error].filter(Boolean).join(' · ') : '';
    nowMeta.classList.toggle('is-err', !!player.error);
    nowArtist.disabled = !t; nowAlbum.disabled = !t;

    bPlay.replaceChild(svg(player.playing ? 'pause' : 'play', 24), bPlay.querySelector('.amp-ico'));
    bPlay.querySelector('.amp-lbl').textContent = player.playing ? '[pause]' : '[play]';
    bPlay.setAttribute('aria-label', player.playing ? 'Pause' : 'Play'); bPlay.title = bPlay.getAttribute('aria-label');
    bShuffle.classList.toggle('is-on', !!d.shuffle); bShuffle.setAttribute('aria-pressed', !!d.shuffle);
    bShuffle.querySelector('.amp-lbl').textContent = d.shuffle ? '[shuffle on]' : '[shuffle]';
    bRepeat.classList.toggle('is-on', d.repeat !== 'off');
    bRepeat.classList.toggle('is-one', d.repeat === 'one');
    bRepeat.querySelector('.amp-lbl').textContent = '[repeat ' + d.repeat + ']';
    bRepeat.title = 'Repeat: ' + d.repeat; bRepeat.setAttribute('aria-label', 'Repeat: ' + d.repeat);
    const fav = !!(t && d.favourites[t.path]);
    if (fav !== lastFav) { lastFav = fav; bFav.replaceChild(svg(fav ? 'heartOn' : 'heart', 18), bFav.querySelector('.amp-ico')); }
    bFav.classList.toggle('is-on', fav); bFav.querySelector('.amp-lbl').textContent = fav ? '[♥ fav]' : '[♡ fav]';
    volLbl.textContent = '[vol ' + Math.round(d.volume * 100) + '%]';
    if (document.activeElement !== vol) { vol.value = Math.round(d.volume * 100); fill(vol); }

    const dur = player.duration, cur = player.time;
    if (!seeking) { seek.value = dur ? Math.round(cur / dur * 1000) : 0; fill(seek); tNow.textContent = fmt(cur); }
    tLeft.textContent = dur ? fmt(dur) : '0:00';
    seek.disabled = !t;
    const cells = 28, on = dur ? Math.round(cur / dur * cells) : 0;
    termBar.textContent = '█'.repeat(on) + '░'.repeat(cells - on) + '  ' + fmt(cur) + ' / ' + fmt(dur);

    const st = library.scanning ? `Scanning ${library.progress.done}/${library.progress.total}` : (d.queue.length ? 'Queue · ' + d.queue.length : '');
    sub.textContent = st;
    stats.textContent = library.tracks.size ? `${plural(library.tracks.size, 'track')} · ${plural(library.albums.length, 'album')}` : '';
    bRescan.disabled = library.scanning;
    markCurrent();
  }

  // Spotify (or another app on the computer) is leading: show its track, cover and simple controls
  function paintExt(x) {
    const key = 'ext:' + x.app + '|' + x.album + '|' + x.title + '|' + (x.art ? x.art.length : 0);
    if (key !== lastCover) {
      lastCover = key; nowArt.textContent = '';
      const wrap = h('div', 'amp-art amp-art-lg', null, nowArt);
      if (x.art) { const im = h('img', null, null, wrap); im.alt = ''; im.draggable = false; im.src = x.art; }
      else { wrap.classList.add('is-empty'); wrap.appendChild(svg('disc', 22)); }
      amPalette(x.art || null).then(cols => { colours = cols; });
    }
    nowSrcTxt.textContent = (x.playing ? 'Playing on ' : 'Paused on ') + x.appName;
    nowSrc.classList.toggle('is-paused', !x.playing);
    nowTitle.textContent = x.title;
    nowArtist.textContent = x.artist; nowAlbum.textContent = x.album;
    nowArtist.disabled = true; nowAlbum.disabled = true;
    nowMeta.textContent = 'From your computer'; nowMeta.classList.remove('is-err');
    bPlay.replaceChild(svg(x.playing ? 'pause' : 'play', 24), bPlay.querySelector('.amp-ico'));
    bPlay.querySelector('.amp-lbl').textContent = x.playing ? '[pause]' : '[play]';
    const lbl = (x.playing ? 'Pause ' : 'Play ') + x.appName;
    bPlay.setAttribute('aria-label', lbl); bPlay.title = lbl;
    extNote.textContent = 'Controls ' + x.appName + ' · volume is set in ' + x.appName;
    const t = player.current;
    resume.hidden = !t;
    if (t) resumeTxt.textContent = 'Your music: ' + t.title + (player.time > 1 ? ' · paused at ' + fmt(player.time) : '');
    const logLbl = api.logLabel();
    bLog.hidden = !logLbl;
    const st = library.scanning ? `Scanning ${library.progress.done}/${library.progress.total}` : (d.queue.length ? 'Queue · ' + d.queue.length : '');
    sub.textContent = st;
    markCurrent();
  }

  let colours = [[90, 120, 170], [200, 130, 90], [60, 80, 110]], level = 0, lastPaint = 0;
  function loop(ts) {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || ts - lastPaint < 100) return;
    lastPaint = ts;
    const x = X();
    level += ((x ? (x.playing ? 0.35 : 0) : player.meter()) - level) * 0.3;
    aurora.setStill(!d.motion || d.theme === 'terminal' || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    aurora.update({ cols: colours, playing: x ? x.playing : player.playing, pulsing: false, pulsePeriod: 16, level });
  }

  const offPlayer = player.on(() => { if (!stopped) paintNow(); });
  const offLib = library.on(what => { if (stopped) return; paintNow(); if (what === 'changed') renderBrowse(); });

  paintNow(); renderBrowse(); fill(vol); aurora.start(); raf = requestAnimationFrame(loop);

  return {
    refresh() { lastCover = undefined; paintNow(); renderBrowse(); },
    paint() { if (!stopped) paintNow(); },
    focusSearch() { search.focus(); },
    destroy() { stopped = true; offPlayer(); offLib(); cancelAnimationFrame(raf); aurora.stop(); }
  };
}
