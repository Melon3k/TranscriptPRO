# TranscriptPRO

Desktopowy edytor napisów z lokalną transkrypcją AI przez Whisper. Wszystko działa offline — modele Whispera pracują na twoim komputerze, żadne audio nie wychodzi do chmury (chyba że świadomie użyjesz tłumaczenia AI).

Aplikacja zbudowana na Tauri 2.0 (Rust backend + React frontend) — natywne okno, niskie zużycie pamięci, dostępna na macOS i Windows.

## Funkcje

### Transkrypcja
- **Lokalny Whisper** — pięć modeli do wyboru: `tiny` (75 MB), `small` (466 MB, dołączony), `medium` (1.5 GB), `large-v3` (3.1 GB), `large-v3-turbo` (1.6 GB)
- **Automatyczne pobieranie modeli** z HuggingFace z paskiem postępu
- **99 języków** plus auto-detekcja
- **Word-level timestamps** — każde słowo dostaje znacznik czasu
- **Wykrywanie mówców** (diarization) — opcjonalne grupowanie wypowiedzi po profilu głosu
- **Postęp na żywo** — procentowy progres podczas inferencji whisper.cpp
- **Anulowanie** — przerwij długą transkrypcję jednym kliknięciem (whisper kończy w obrębie jednego polla)

### Edytor napisów
- **Lista segmentów** z edycją tekstu in-place
- **Split / Merge** — dziel długie segmenty i łącz krótkie
- **Word-drag** — przeciągaj słowa między segmentami zachowując timestampy
- **Undo / Redo** (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z) z historią 50 kroków
- **Synchroniczny odtwarzacz** — wideo/audio + podświetlony aktualny segment

### Tłumaczenie
- **Gemini** (Google AI) — domyślnie `gemini-3.1-flash-lite`, automatyczny retry przy 429
- **Claude** (Anthropic API)
- **Lokalny — TranslateGemma 4B (offline)** — model pobierany na żądanie (~2,3 GB, weryfikacja
  SHA-256), inference przez wbudowany sidecar `llama-server` (Metal na Apple Silicon, CPU na
  Windows); tłumaczenie bez klucza API i bez internetu. Wymaga wskazania języka źródłowego.
  Model TranslateGemma jest udostępniany przez Google na warunkach
  [Gemma Terms of Use](https://ai.google.dev/gemma/terms) — pobierając go w aplikacji,
  akceptujesz te warunki.

### Import / Export
- **Import** SRT z dowolnego źródła
- **Export**: standardowy SRT, SRT z timestampami per-słowo, plain TXT
- **Auto-save** — opcjonalnie zapisuj wersję po każdej transkrypcji lub imporcie

### Historia wersji
- Każda istotna zmiana (transkrypcja, import, tłumaczenie) zapisywana automatycznie
- **Diff view** — porównaj dwie wersje obok siebie
- **Restore** — wróć do dowolnego punktu w czasie
- Historia trzymana per-projekt w `~/Library/Application Support/transcriptpro/history/`

### Panel logów
- **Dolny drawer** z logami na żywo (ikona terminala w toolbarze)
- Streamowane eventy z Rust → React: model load, ffmpeg, każdy segment whispera, batche tłumaczenia, błędy
- Ring buffer 500 ostatnich wpisów, kolory per poziom

## Wymagania

- **macOS** 11+ lub **Windows** 10+
- **FFmpeg** w PATH — używany do ekstrakcji audio z plików wideo
  - macOS: `brew install ffmpeg`
  - Windows: pobierz z [ffmpeg.org](https://ffmpeg.org/download.html) i dodaj do PATH
- Dla developmentu: Node.js 18+, Rust toolchain, [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Instalacja (użytkownicy końcowi)

Pobierz najnowszy instalator z [Releases](https://github.com/Melon3k/TranscriptPRO/releases/latest):

- **macOS** — `TranscriptPRO_x.y.z_universal.dmg` (działa na Intel i Apple Silicon)
- **Windows** — `TranscriptPRO_x.y.z_x64-setup.exe`

### Pierwsze uruchomienie — ostrzeżenia OS

Aplikacja nie jest jeszcze podpisana komercyjnym certyfikatem, więc system pokaże ostrzeżenie. To normalne — kliknij:

- **macOS**: w Finderze prawym przyciskiem na app → **Otwórz** → **Otwórz** w dialogu. Alternatywnie w terminalu: `xattr -d com.apple.quarantine /Applications/TranscriptPRO.app`
- **Windows**: w SmartScreen → **Więcej informacji** → **Uruchom mimo to**

Po pierwszej akceptacji system zapamięta wybór.

### Aktualizacje

Aplikacja sprawdza aktualizacje automatycznie (raz na 6 h oraz przy każdym starcie). Gdy nowa wersja jest dostępna, w prawym dolnym rogu pojawi się powiadomienie z przyciskiem **Zainstaluj teraz** — pobieranie, weryfikacja podpisu (Ed25519) i restart dzieją się jednym kliknięciem.

Auto-check można wyłączyć w **Settings → Aktualizacje**. Manualne sprawdzenie tym samym przyciskiem.

## Instalacja (development)

```bash
git clone https://github.com/Melon3k/TranscriptPRO.git
cd TranscriptPRO
npm install
npm run tauri dev
```

Pierwsze uruchomienie skompiluje Rusta (3–8 min). Kolejne odpalają się w sekundy.

### Build produkcyjny

```bash
npm run tauri build
```

Wynik trafia do `src-tauri/target/release/bundle/`.

## Workflow

1. **Otwórz plik** (Open Media) — wybierz video lub audio. FFmpeg wyekstrahuje 16 kHz mono WAV.
2. **Wybierz model Whisper** w panelu po prawej. Jeśli model nie jest pobrany, kliknij Download.
3. **Wybierz język** (lub zostaw Auto) i kliknij **Transcribe**. W trakcie:
   - Pasek pokazuje procentowy postęp
   - Panel logów (Terminal icon) pokazuje każdy segment z preview tekstu
   - Możesz przerwać przyciskiem **Cancel**
4. **Edytuj** napisy w głównym oknie — split, merge, word-drag, popraw tekst.
5. **(Opcjonalnie) Przetłumacz** w zakładce Translate — wybierz provider, podaj klucz API (zapisany lokalnie), wybierz język docelowy.
6. **Export** w wybranym formacie (SRT / Word SRT / TXT).

## Konfiguracja

Ustawienia są persystowane w `localStorage` pod kluczem `transcriptpro-settings`:

- Wybrany model Whisper
- Dark mode
- Auto-save on import / transcription

Żeby zresetować do defaults: DevTools → Application → Local Storage → usuń klucz.

Klucze API (Gemini, Claude) NIE są trzymane w localStorage — leżą zaszyfrowane (AES-256-GCM)
w pliku `keys.enc.json` w katalogu aplikacji, a klucz szyfrujący w systemowym magazynie
poświadczeń (macOS Keychain / Windows Credential Manager). Dzięki temu macOS pyta o dostęp
do pęku kluczy najwyżej raz na uruchomienie (przy pierwszym tłumaczeniu chmurowym), a nie
przy każdym odczycie. Klucze nigdy nie wracają do warstwy UI.

## Znane ograniczenia

- Modele Whispera większe niż `small` wymagają sporo RAM (large-v3 — ok. 5 GB)
- Diarization to prosty algorytm (RMS + zero-crossing + spectral centroid), nie equivalent profesjonalnym narzędziom typu pyannote
- Translation przez Gemini/Claude wymaga klucza API i połączenia z internetem; tryb lokalny
  (TranslateGemma) działa offline, ale jakość idiomów jest niższa niż w modelach chmurowych
- Aplikacja nie jest jeszcze podpisana komercyjnym certyfikatem OS (macOS Developer ID, Windows Authenticode) — pierwsze uruchomienie wymaga zaakceptowania ostrzeżenia, patrz sekcja **Pierwsze uruchomienie — ostrzeżenia OS** wyżej. Sam mechanizm aktualizacji jest podpisany kluczem Ed25519 (Tauri updater) niezależnie od OS.

## Fonty

Aplikacja bundluje trzy kroje pisma: **Outfit**, **Inter** i **JetBrains Mono** — każdy na licencji
SIL Open Font License 1.1, self-hostowane przez pakiety [Fontsource](https://fontsource.org)
(brak CDN-u webfontów — CSP pozostaje zamknięte).

Wypalanie napisów do MP4 dodatkowo bundluje statyczne instancje Regular+Bold tych samych trzech
krojów (TTF, SIL OFL 1.1) w `src-tauri/fonts/`, dołączane jako zasoby Tauri — dzięki temu wypalone
wideo renderuje te same kroje co podgląd na ekranie (libass czyta TTF, nie woff2). Obie kopie
współistnieją: `@fontsource` .woff2 obsługuje UI aplikacji, a TTF-y obsługują wypalanie w libass.

## Licencja

Prywatny projekt. Wszelkie prawa zastrzeżone.
