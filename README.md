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
- **Gemini** (Google AI) — domyślnie `gemini-2.0-flash-lite`, automatyczny retry przy 429
- **Claude** (Anthropic API)
- **LibreTranslate** — self-hosted lub publiczny, bez klucza dla podstawowego użytku

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
- Klucze API (Gemini, Claude)
- URL LibreTranslate
- Dark mode
- Auto-save on import / transcription

Żeby zresetować do defaults: DevTools → Application → Local Storage → usuń klucz.

## Architektura

```
React (Vite, port 1420 w dev)
  ↕  Tauri IPC (Channel<T> dla streamingu)
Rust (whisper-rs, reqwest, tokio)
  ↕  whisper.cpp (FFI)
```

- **Frontend state**: Zustand (`subtitleStore`, `playerStore`, `settingsStore`, `versionStore`, `logStore`)
- **Backend commands**: `src-tauri/src/commands/` (audio, file_io, transcribe, translate)
- **Whisper integration**: `src-tauri/src/whisper/model.rs` — direct FFI dla progress callback (bypass znanego use-after-free w `set_progress_callback_safe` z whisper-rs 0.13)
- **Logger**: `src-tauri/src/logger.rs` emituje eventy `app-log` przez Tauri's emit API

## Znane ograniczenia

- Modele Whispera większe niż `small` wymagają sporo RAM (large-v3 — ok. 5 GB)
- Diarization to prosty algorytm (RMS + zero-crossing + spectral centroid), nie equivalent profesjonalnym narzędziom typu pyannote
- Translation przez Gemini/Claude wymaga klucza API i połączenia z internetem
- Aplikacja nie jest jeszcze podpisana cyfrowo — macOS może wymagać `xattr -d com.apple.quarantine` na pierwsze uruchomienie

## Licencja

Prywatny projekt. Wszelkie prawa zastrzeżone.
