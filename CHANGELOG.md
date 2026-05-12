# Changelog

Wszystkie zmiany widoczne dla użytkowników. Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [Unreleased]

### Added
- Skrypt `npm run bump <wersja>` — synchronizuje wersję w `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` i `Cargo.lock` jednym poleceniem.
- CHANGELOG.md — sekcja per wersja wyciągana automatycznie do release notes na GitHubie.

### Changed
- Branch protection na `main`: każda zmiana musi przejść przez PR z zielonym CI (macOS Universal + Windows). Bezpośredni push i force-push zablokowane.

## [0.1.3] — 2026-05-12

### Added
- **FFmpeg jako bundled sidecar** — aplikacja przenosi własną statyczną binarkę ffmpeg w środku `.dmg` / `.exe`. Działa od razu po instalacji, bez `brew install ffmpeg` ani konfiguracji PATH.

### Fixed
- macOS: aplikacja uruchomiona z Findera nie znajdowała ffmpeg mimo `brew install` (GUI apps nie dziedziczą shell PATH).
- Windows: błąd „FFmpeg not found" przy próbie ekstrakcji audio na czystym systemie bez ffmpeg.
- CI: macOS Universal build pakuje teraz pojedynczy fat-binary ffmpeg (`lipo`) zamiast wymagać per-architecture builds.

## [0.1.2] — 2026-05-12

### Fixed
- Okno **Ustawień** scrolluje się gdy lista opcji przekracza wysokość okna aplikacji (wcześniej fragmenty były ucinane bez możliwości przewinięcia).

### Changed
- CI workflow podbity do `actions/checkout@v5` i `actions/setup-node@v5` (Node 22 / Node 24-ready).

## [0.1.1] — 2026-05-11

### Added
- **Automatyczne aktualizacje** przez Tauri updater podpisany kluczem Ed25519. Aplikacja sprawdza nową wersję przy starcie i co 6 h.
- Toast „Dostępna aktualizacja" w prawym dolnym rogu z przyciskiem **Zainstaluj teraz** — pobiera, weryfikuje podpis, instaluje i restartuje aplikację jednym kliknięciem.
- Sekcja **Aktualizacje** w Ustawieniach: aktualna wersja, przełącznik auto-check, manualny przycisk „Sprawdź teraz".
- GitHub Actions workflow `release.yml` budujący **macOS Universal DMG** (Intel + Apple Silicon) i **Windows NSIS installer** na każdy push taga `v*`. Artefakty trafiają do GitHub Releases z manifestem `latest.json` dla updatera.

[Unreleased]: https://github.com/Melon3k/TranscriptPRO/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/Melon3k/TranscriptPRO/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Melon3k/TranscriptPRO/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Melon3k/TranscriptPRO/releases/tag/v0.1.1
