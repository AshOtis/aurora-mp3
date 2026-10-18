/* Aurora MP3: "what's playing on your computer" (Windows).
 * Spotify, browsers, Apple Music, VLC and others report the current track to Windows (the same information the
 * volume pop-up shows). A small hidden Windows PowerShell process reads it once a second and prints a line
 * of JSON whenever it changes. No Spotify account, API key or network: it only asks Windows. */

const AMN_PRELUDE = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$t) { $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
# Pick a session: never Obsidian itself; prefer one that is playing, then Spotify, then whatever Windows calls current
function Pick {
  $all = @($mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -notmatch 'obsidian' })
  if (-not $all.Count) { return $null }
  $playing = @($all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 4 })
  if ($playing.Count) { $s = @($playing | Where-Object { $_.SourceAppUserModelId -match 'spotify' }); if ($s.Count) { return $s[0] }; return $playing[0] }
  $s = @($all | Where-Object { $_.SourceAppUserModelId -match 'spotify' }); if ($s.Count) { return $s[0] }
  $c = $mgr.GetCurrentSession(); if ($c -and $c.SourceAppUserModelId -notmatch 'obsidian') { return $c }
  return $all[0]
}
`;

// The watcher: prints {"app","status","title","artist","album","art"} when anything changes, {"none":true} when nothing plays
const AMN_WATCH = AMN_PRELUDE + `
$last = ''; $lastArtKey = ''; $art = ''
while ($true) {
  try {
    $s = Pick
    if ($null -eq $s) { $line = '{"none":true}' }
    else {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $st = [int]$s.GetPlaybackInfo().PlaybackStatus
      $artKey = $s.SourceAppUserModelId + '|' + $p.Title + '|' + $p.AlbumTitle + '|' + $p.Artist
      if ($artKey -ne $lastArtKey) {
        $lastArtKey = $artKey; $art = ''
        if ($p.Thumbnail) {
          try {
            $ras = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ras)
            $ms = New-Object System.IO.MemoryStream; $net.CopyTo($ms)
            $ct = $ras.ContentType; if (-not $ct) { $ct = 'image/jpeg' }
            if ($ms.Length -gt 0 -and $ms.Length -lt 3000000) { $art = 'data:' + $ct + ';base64,' + [Convert]::ToBase64String($ms.ToArray()) }
            $net.Dispose(); $ms.Dispose()
          } catch { $art = '' }
        }
      }
      $o = [ordered]@{ app = $s.SourceAppUserModelId; status = $st; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; art = $art }
      $line = ($o | ConvertTo-Json -Compress)
    }
  } catch { $line = '{"none":true}' }
  if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 1000
}
`;

// One-shot control: play/pause, next, previous on the chosen session
const amnControl = (action, app) => AMN_PRELUDE + `
$s = @($mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq '${String(app).replace(/'/g, "''")}' })[0]
if ($null -eq $s) { $s = Pick }
if ($s) { Await ($s.${action}()) ([bool]) | Out-Null }
`;

// Friendly names for the apps people use most
function amnAppName(id) {
  const s = String(id || '').toLowerCase();
  const known = [['spotify', 'Spotify'], ['applemusic', 'Apple Music'], ['itunes', 'iTunes'], ['tidal', 'TIDAL'], ['vlc', 'VLC'],
    ['chrome', 'Chrome'], ['msedge', 'Edge'], ['firefox', 'Firefox'], ['opera', 'Opera'], ['brave', 'Brave'], ['zunemusic', 'Media Player'],
    ['microsoft.media', 'Media Player'], ['foobar', 'foobar2000'], ['musicbee', 'MusicBee'], ['deezer', 'Deezer'], ['amazon', 'Amazon Music'], ['youtube', 'YouTube Music']];
  for (const [k, v] of known) if (s.includes(k)) return v;
  const base = String(id || '').split(/[\\/!]/).pop().replace(/\.exe$/i, '');
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'your computer';
}

class AMSystemNow {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = null;        // { app, appName, playing, paused, title, artist, album, art }
    this.proc = null;
    this.stopped = true;
    this.buf = '';
    this.restartTimer = 0;
    this.failures = 0;
  }

  static supported() { return typeof process !== 'undefined' && process.platform === 'win32'; }

  encode(script) { return Buffer.from(script, 'utf16le').toString('base64'); }

  run(script) {
    const { spawn } = require('child_process');
    return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', this.encode(script)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  }

  start() {
    if (!AMSystemNow.supported() || !this.stopped) return;
    this.stopped = false;
    this.spawnWatcher();
  }

  spawnWatcher() {
    if (this.stopped) return;
    let p;
    try { p = this.run(AMN_WATCH); } catch (e) { this.fail(); return; }
    this.proc = p; this.buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', chunk => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (line) this.take(line);
      }
    });
    p.stderr.on('data', () => {});
    p.on('error', () => this.fail());
    p.on('exit', () => { if (this.proc === p) { this.proc = null; this.fail(); } });
  }

  // the watcher stopped: try again, backing off, so a broken PowerShell never spins
  fail() {
    if (this.stopped) return;
    this.failures++;
    clearTimeout(this.restartTimer);
    if (this.failures > 6) return;
    this.restartTimer = setTimeout(() => this.spawnWatcher(), Math.min(60000, 2000 * this.failures));
  }

  take(line) {
    let o; try { o = JSON.parse(line); } catch (e) { return; }
    this.failures = 0;
    let next = null;
    if (!o.none && o.title) {
      // Windows playback status: 4 playing, 5 paused, 3 stopped
      next = { app: o.app, appName: amnAppName(o.app), playing: o.status === 4, paused: o.status === 5,
        title: o.title, artist: o.artist || '', album: o.album || '', art: o.art || '' };
    }
    this.state = next;
    this.onChange(next);
  }

  control(action) {
    if (!this.state) return;
    const fn = { toggle: 'TryTogglePlayPauseAsync', pause: 'TryPauseAsync', play: 'TryPlayAsync', next: 'TrySkipNextAsync', prev: 'TrySkipPreviousAsync' }[action];
    if (!fn) return;
    // feel instant: show the new state straight away, the watcher confirms it a moment later
    if (action === 'toggle' || action === 'pause' || action === 'play') {
      const playing = action === 'toggle' ? !this.state.playing : action === 'play';
      this.state = Object.assign({}, this.state, { playing, paused: !playing });
      this.onChange(this.state);
    }
    try { const c = this.run(amnControl(fn, this.state.app)); c.on('error', () => {}); } catch (e) { /* ignore */ }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    if (this.proc) { try { this.proc.kill(); } catch (e) { /* gone */ } this.proc = null; }
    if (this.state) { this.state = null; this.onChange(null); }
  }
}
