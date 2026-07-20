# Bundled caption fonts

These static TTFs are bundled (via `tauri.conf.json` `bundle.resources`) so the
MP4 burn-in render uses the app's real caption fonts instead of libass
fontconfig system substitution. libass matches by the font's **internal
name-table family** (name ID 1), so each file's family must equal the ASS
`Fontname` emitted by `src-tauri/src/subtitle/ass.rs` — `Outfit`, `Inter`,
`JetBrains Mono`. Fetched and verified by `scripts/download-fonts.sh`; do not
hand-edit or rename.

Only Regular + Bold are shipped (italic stays faux-synthesized by libass,
matching the CSS-synthesized italic in the on-screen preview).

## Attribution — all SIL Open Font License 1.1

| Family        | Upstream                                             |
| ------------- | ---------------------------------------------------- |
| Outfit        | https://github.com/Outfitio/Outfit-Fonts (© Outfit)  |
| Inter         | https://github.com/rsms/inter (© The Inter Project Authors) |
| JetBrains Mono| https://github.com/JetBrains/JetBrainsMono (© 2020 The JetBrains Mono Project Authors) |

The SIL OFL 1.1 permits bundling and redistribution with the software. Full
license text ships with each upstream project (linked above).
