# Changelog

Wszystkie zmiany widoczne dla użytkowników. Format: [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/), wersjonowanie: [SemVer](https://semver.org/lang/pl/).

## [2.0.0] — 2026-07-27

### Added
- **Stylizacja napisów (panel Stylizacja).** Inspektor: czcionka, rozmiar, odstęp liter, wyrównanie, pogrubienie/kursywa/wersaliki, obrys, cień, poświata (glow), tło, pozycja i szerokość boxa napisów. Wszystko na żywo w podglądzie.
- **Tło napisów (pigułka)** — kolor z przezroczystością, zaokrąglenie rogów i rozpiętość (padding); tło oblewa tekst i jest wypalane do MP4. Ikony wyrównania (L/C/P) zamiast liter.
- **Rozbudowany cień** — kolor z przezroczystością, kąt, odległość, rozmiar i rozmycie (zamiast pojedynczej głębi); wypalany do MP4.
- **Dowolna czcionka z komputera** — wyszukiwarka fontów systemowych obok trzech wbudowanych (Outfit / Inter / JetBrains Mono, dołączone do aplikacji).
- **Pełny wybór koloru z przezroczystością** — picker z polem nasycenia/barwy, suwakiem alfy i polami Hex / R / G / B / Alpha; kolor przy każdej kategorii (tekst, obrys, cień, poświata, tło).
- **Przeciągalny box napisów** na playerze (tryb „Pozycja") — zsynchronizowany z siatką pozycji w Inspektorze.
- **Presety stylu** (zakładka Efekty) — cztery wbudowane (Neon, Twardy cień, Gruby obrys, Miękki) + własne: Nowy / Duplikuj / Zapisz / Usuń / zmiana nazwy / wyszukiwanie, zapamiętywane.
- **Animacje napisów** — zanikanie (fade), karaoke, wjazd, pop, maszyna do pisania, rozmycie; z regulacją czasu i koloru podświetlenia karaoke. Wszystkie typy wypalane do MP4.
- **Eksport wideo MP4 z wypalonymi napisami** — styl, kolory (z przezroczystością), pozycja, czcionki i animacje wtapiane w wideo (ffmpeg + libass), z paskiem postępu i anulowaniem.
- **Modal „Podgląd i eksport"** dla SRT/VTT — podgląd wygenerowanego pliku przed zapisem.
- **Podpowiedzi (tooltips)** na ikonach w całej aplikacji.
- Skrypt `npm run bump <wersja>` — synchronizuje wersję w `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` i `Cargo.lock` jednym poleceniem.
- CHANGELOG.md — sekcja per wersja wyciągana automatycznie do release notes na GitHubie.
- **Podgląd proxy dla ciężkiego / obróconego wideo** — dla materiału 4K albo z flagą rotacji aplikacja generuje w tle lekki podgląd (720p, wypalona rotacja), bo silnik podglądu (WKWebView) nie renderuje surowego 4K (zamrożony obraz, zielony kadr). Transkrypcja i eksport nadal używają oryginału.

### Changed
- **Wyrównanie tekstu jest teraz eksportowane** — justowanie (lewo/środek/prawo) w obrębie boxa napisów przenosi się do ASS/MP4 (wcześniej działało tylko w podglądzie).
- Kolory przeniesione do swoich sekcji w Inspektorze (osobna sekcja „Kolory" usunięta) — kolor obok kontrolki, do której należy.
- Kolory napisów są zapisywane w formacie `#RRGGBBAA` (z kanałem alfa); starsze zapisy migrują automatycznie jako nieprzezroczyste.
- Ostrzeżenie o odwróconych czasach (koniec ≤ początek) — wiersz podświetlany na czerwono i potwierdzenie przy eksporcie formatów z czasem.
- Branch protection na `main`: każda zmiana musi przejść przez PR z zielonym CI (macOS Universal + Windows). Bezpośredni push i force-push zablokowane.
- **Eksport ASS/VTT nie oznacza już projektu jako zapisanego** — aplikacja nie potrafi wczytać tych formatów z powrotem, więc niezapisane zmiany nie znikają już po cichu; kanonicznym zapisem projektu pozostaje SRT.

### Fixed
- Obrys w podglądzie nie „rozjeżdża się" już na krawędziach (rysowany pełnym pierścieniem zamiast czterech rogów).
- Tło napisów po wypaleniu do MP4 nie „wystaje" nad tekstem — pigułka dopasowana do rzeczywistych glifów (uwzględnia diakrytyki), nie do luźnego pola em fontu.
- Przeciąganie plików na okno (otwieranie) — przywrócone; przeciąganie słów między segmentami przepisane na zdarzenia wskaźnika (bez blokowania natywnego drop plików).
- Zaznaczenie słów nie „przykleja się" już po przeniesieniu słowa do innego segmentu.
- Panel porównania tłumaczenia pokazuje się tylko w trybie Tłumaczenie (wcześniej wchodził w transkrypcję i zasłaniał pasek postępu).
- Jasny motyw: czytelne etykiety pod kaflami animacji i presetów.
- Onboarding można ukończyć bez sieci (krok modelu ma „Pomiń — pobiorę później").
- **Wypalanie MP4 nie może już nadpisać pliku źródłowego** — domyślnie proponowana nazwa to `-subtitled.mp4`, a backend odmawia zapisu do pliku wejściowego.
- **Ostrzeżenie o niezapisanych zmianach** obejmuje teraz otwarcie nowego pliku, „ostatnio otwarte", przeciągnięcie pliku i przywrócenie wersji (wcześniej tylko zamknięcie okna).
- **Autozapis historii wersji** nie kasuje już po cichu flagi niezapisanych zmian, gdy zapis się nie powiedzie (brak miejsca / uprawnień) — pokazuje błąd i zachowuje ostrzeżenie przy wyjściu.
- Otwarcie nowego pliku od razu czyści starą transkrypcję (nie wisi do czasu nowej).
- Eksport MP4 przechodzi kontrolę odwróconych czasów (koniec ≤ początek) — wcześniej pomijał to ostrzeżenie.
- Pusty segment ma znów klikalny obszar edycji (placeholder zamiast zapadniętego wiersza).
- Animacja „Color Shift" pokazuje właściwy kolor napisu również w jasnym motywie (wcześniej brała kolor interfejsu → prawie czarne napisy).
- Podgląd wideo w nieobsługiwanym formacie pokazuje komunikat zamiast czarnego ekranu; sterowanie nie zawiesza się.
- Komunikaty o błędach nie znikają już samoczynnie po 4 s.
- Lokalny model tłumaczenia: przy błędzie sprawdzania statusu pojawia się przycisk „Spróbuj ponownie".
- Anulowanie eksportu MP4 działa natychmiast; brak osieroconych procesów ffmpeg; pliki tymczasowe podglądu i wypalania sprzątane przy starcie.
- Wyeksportowany plik ASS łamie linie tak samo jak wypalone MP4 (przy włączonym tle).

### Security
- Pobierane modele Whisper i sidecar ffmpeg weryfikowane po SHA-256 (pinned).
- Usunięto nieużywane uprawnienia silnika podglądu (uruchamianie procesów, dostęp do plików) — nie miały żadnego konsumenta w aplikacji.
- Klucze API są maskowane w komunikatach o błędach tłumaczenia (nie trafiają do panelu logów).

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

[Unreleased]: https://github.com/Melon3k/TranscriptPRO/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Melon3k/TranscriptPRO/compare/v0.1.3...v2.0.0
[0.1.3]: https://github.com/Melon3k/TranscriptPRO/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Melon3k/TranscriptPRO/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Melon3k/TranscriptPRO/releases/tag/v0.1.1
