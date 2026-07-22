# Warunki korzystania i komponenty firm trzecich

> **STATUS: DRAFT — do przeglądu prawnego.** Ten dokument to inżynierski,
> w dobrej wierze przygotowany zarys warunków dotyczących komponentów firm
> trzecich, które aplikacja pobiera lub dołącza. **Nie jest opinią prawną** i
> przed publicznym wydaniem musi go zaakceptować dział prawny. Wiążące pozostają
> oryginalne licencje/warunki, do których odsyłają poniższe sekcje.

TranscriptPRO to lokalna aplikacja desktopowa. Transkrypcja i lokalne tłumaczenie
działają w całości na urządzeniu użytkownika; tłumaczenie w chmurze (Gemini /
Claude) wysyła tekst do dostawcy tylko wtedy, gdy użytkownik jawnie je wybierze i
poda własny klucz API.

## Model lokalnego tłumaczenia — TranslateGemma (Google)

Funkcja tłumaczenia offline korzysta z modelu **TranslateGemma 4B** udostępnianego
przez Google. Model **nie jest dołączony do instalatora** — jest pobierany na
żądanie z publicznego mirrora (z weryfikacją rozmiaru i SHA-256) dopiero po
świadomej akcji użytkownika.

Korzystanie z modelu podlega:

- **[Gemma Terms of Use](https://ai.google.dev/gemma/terms)**, oraz
- **[Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy)**.

**Klauzula pass-through (kluczowa).** Pobierając model w aplikacji i korzystając z
lokalnego tłumaczenia, użytkownik potwierdza, że:

1. zapoznał się z Gemma Terms of Use oraz Gemma Prohibited Use Policy i akceptuje
   je jako warunek korzystania z modelu;
2. **ograniczenia użycia** wynikające z tych dokumentów obowiązują użytkownika i
   dotyczą również **wygenerowanych tłumaczeń (outputów)** — użytkownik nie może
   wykorzystywać modelu ani jego wyników do celów zakazanych w Prohibited Use
   Policy;
3. jeżeli użytkownik dalej udostępnia wyniki modelu, zobowiązuje się przekazać te
   same ograniczenia użycia swoim odbiorcom (dalszy pass-through), zgodnie z
   wymogiem dystrybucji w Gemma Terms of Use;
4. dostawca aplikacji udostępnia jedynie mechanizm pobrania i uruchomienia modelu
   — nie modyfikuje jego wag i nie usuwa powyższych zobowiązań.

Aplikacja pokazuje tę informację również w panelu Tłumaczenie przed pobraniem
modelu.

> **Do decyzji prawnej:** (a) czy pobieranie z ungated mirrora (zamiast z gated
> repozytorium Google) spełnia wymogi dystrybucji Gemma; (b) ostateczne brzmienie
> klauzuli pass-through w regulaminie/ToS dostępnym publicznie.

## Modele transkrypcji — Whisper (whisper.cpp)

Modele Whisper pobierane są na żądanie z Hugging Face (weryfikacja SHA-256).
Podlegają licencji oryginalnych modeli OpenAI Whisper (MIT) oraz warunkom
repozytoriów, z których są pobierane.

## FFmpeg

Aplikacja dołącza statyczną binarkę **FFmpeg** (ekstrakcja audio, wypalanie
napisów do MP4). FFmpeg jest rozpowszechniany na licencji LGPL/GPL w zależności od
konfiguracji builda. **Do weryfikacji prawnej:** licencja konkretnego builda
dołączanego do instalatora i wynikające z niej obowiązki (m.in. udostępnienie
źródeł / informacja o licencji przy redystrybucji).

## Czcionki

Dołączone kroje **Outfit**, **Inter** i **JetBrains Mono** są na licencji
**SIL Open Font License 1.1**, która zezwala na osadzanie i redystrybucję.

## Aplikacja

Kod aplikacji: projekt prywatny, wszelkie prawa zastrzeżone (patrz `README.md`).
