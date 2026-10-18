"""Build the Obsidian plugin into dist/ (main.js, styles.css, manifest.json). No dependencies: python3 build.py"""
import pathlib, shutil
R = pathlib.Path(__file__).resolve().parent; src = R / 'src'; out = R / 'dist'; out.mkdir(exist_ok=True)
read = lambda f: (src / f).read_text(encoding='utf-8')
main = ("'use strict';\nconst { Plugin, ItemView, Notice, Menu, PluginSettingTab, Setting } = require('obsidian');\n\n"
        + '\n'.join(read(f) for f in ['tags.js', 'library.js', 'player.js', 'aurora.js', 'nowplaying.js', 'ui.js', 'glue.js']))
(out / 'main.js').write_text(main, encoding='utf-8')
(out / 'styles.css').write_text(read('ui.css') + '\n' + read('extra.css'), encoding='utf-8')
shutil.copy(R / 'manifest.json', out / 'manifest.json')
print('dist/ ready: main.js, manifest.json, styles.css')
