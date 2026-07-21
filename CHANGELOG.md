# Changelog

Wszystkie zmiany widoczne dla użytkowników. Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [Unreleased]

### Added
- **Stylizacja napisów (panel Stylizacja).** Inspektor: czcionka, rozmiar, odstęp liter, interlinia, wyrównanie, pogrubienie/kursywa/wersaliki, obrys, cień, poświata (glow), pozycja i szerokość boxa napisów. Wszystko na żywo w podglądzie.
- **Dowolna czcionka z komputera** — wyszukiwarka fontów systemowych obok trzech wbudowanych (Outfit / Inter / JetBrains Mono, dołączone do aplikacji).
- **Pełny wybór koloru z przezroczystością** — picker z polem nasycenia/barwy, suwakiem alfy i polami Hex / R / G / B / Alpha; osobne kolory tekstu, obrysu, cienia i poświaty.
- **Przeciągalny box napisów** na playerze (tryb „Pozycja") — zsynchronizowany z siatką pozycji w Inspektorze.
- **Presety stylu** (zakładka Efekty) — cztery wbudowane (Neon, Twardy cień, Gruby obrys, Miękki) + własne: Nowy / Duplikuj / Zapisz / Usuń / zmiana nazwy / wyszukiwanie, zapamiętywane.
- **Animacje napisów** — zanikanie (fade), karaoke, wjazd, pop, maszyna do pisania, rozmycie; z regulacją czasu, koloru podświetlenia karaoke i in.
- **Eksport wideo MP4 z wypalonymi napisami** — styl, kolory (z przezroczystością), pozycja, czcionki i animacje wtapiane w wideo (ffmpeg + libass), z paskiem postępu i anulowaniem.
- **Modal „Podgląd i eksport"** dla SRT/VTT — podgląd wygenerowanego pliku przed zapisem.
- **Podpowiedzi (tooltips)** na ikonach w całej aplikacji.
- Skrypt `npm run bump <wersja>` — synchronizuje wersję w `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` i `Cargo.lock` jednym poleceniem.
- CHANGELOG.md — sekcja per wersja wyciągana automatycznie do release notes na GitHubie.

### Changed
- Kolory napisów są zapisywane w formacie `#RRGGBBAA` (z kanałem alfa); starsze zapisy migrują automatycznie jako nieprzezroczyste.
- Ostrzeżenie o odwróconych czasach (koniec ≤ początek) — wiersz podświetlany na czerwono i potwierdzenie przy eksporcie formatów z czasem.
- Branch protection na `main`: każda zmiana musi przejść przez PR z zielonym CI (macOS Universal + Windows). Bezpośredni push i force-push zablokowane.

### Fixed
- Przeciąganie plików na okno (otwieranie) — przywrócone; przeciąganie słów między segmentami przepisane na zdarzenia wskaźnika (bez blokowania natywnego drop plików).
- Zaznaczenie słów nie „przykleja się" już po przeniesieniu słowa do innego segmentu.
- Panel porównania tłumaczenia pokazuje się tylko w trybie Tłumaczenie (wcześniej wchodził w transkrypcję i zasłaniał pasek postępu).
- Jasny motyw: czytelne etykiety pod kaflami animacji i presetów.
- Onboarding można ukończyć bez sieci (krok modelu ma „Pomiń — pobiorę później").

### Security
- Pobierane modele Whisper i sidecar ffmpeg weryfikowane po SHA-256 (pinned).

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
