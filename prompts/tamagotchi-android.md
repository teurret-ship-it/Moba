# Prompt: gra Android typu tamagotchi, rozwijana iteracyjnie przez `/goal`

Ten plik zawiera dwa elementy:

1. **Prompt startowy.** Wklejasz go raz, w nowym, pustym repozytorium. Claude
   zapisuje z niego specyfikację projektu (`CLAUDE.md` i pliki w `docs/`),
   stawia szkielet aplikacji i domyka iterację 0.
2. **Komendę `/goal`.** Uruchamiasz ją za każdym razem, gdy gra ma zrobić
   kolejny krok. Claude pracuje sam: bierze następną iterację z roadmapy,
   implementuje ją, testuje, dokumentuje i wypycha. Kończy, kiedy warunek
   zostanie spełniony i da się go sprawdzić w rozmowie.

Jak działa `/goal`: po każdej turze mały model sprawdza, czy warunek jest
już spełniony. Jeśli nie, Claude zaczyna następną turę i nie oddaje sterowania.
Z tego wynikają trzy zasady, które prompt egzekwuje:

- warunek musi być sprawdzalny na podstawie tego, co Claude **pokazał
  w rozmowie** (wynik `./gradlew`, hash commita, raport iteracji);
- Claude nie zadaje pytań w trakcie `/goal`, bo nikt na nie nie odpowie.
  Decyzje zapisuje jako ADR w `docs/DECISIONS.md`;
- cały proces jest opisany w `CLAUDE.md`, który Claude Code wczytuje
  automatycznie. Dzięki temu komenda `/goal` może być krótka.

---

## Zanim zaczniesz

- **Nowe repozytorium.** Gra Android to osobny produkt, nie należy do tego
  repozytorium (MOBA).
- **Środowisko z dostępem do sieci Google.** Gradle musi pobierać z
  `dl.google.com`, `maven.google.com` i `repo.maven.apache.org`. W chmurze
  Claude Code ustaw w środowisku politykę sieci, która to dopuszcza, albo
  pracuj lokalnie z zainstalowanym Android SDK. Iteracja 0 tworzy skrypt
  `scripts/setup-android-sdk.sh`. Warto podpiąć go jako setup script
  środowiska, żeby każda sesja startowała z gotowym SDK.
- **Emulator nie jest potrzebny.** Weryfikacja odbywa się na JVM: testy
  jednostkowe, Robolectric i testy zrzutów ekranu Roborazzi. Claude ogląda
  wygenerowane PNG, więc sprawdza UI wzrokowo bez urządzenia.

---

## 1. Prompt startowy (wklej raz, jako zwykłą wiadomość)

````text
Jesteś zespołem w jednej osobie: lead game designer gier typu virtual pet,
senior Android engineer (Kotlin, Jetpack Compose), backend engineer i
specjalista LiveOps/monetyzacji. Budujesz od zera grę mobilną na Androida:
rozbudowaną grę online typu tamagotchi, w której gracz opiekuje się
zwierzakiem. Robocza nazwa: „Kłębek” (zmieniasz ją w jednym miejscu:
`app/src/main/res/values/strings.xml` i ADR-001).

Twoja miara to rynek, nie „działa”. Każda funkcja ma dorównywać liderom
gatunku: Tamagotchi Uni/Paradise, Pou, My Talking Tom 2 / Friends, Finch,
Pokémon Sleep, Neopets, Adopt Me!. Jeśli funkcja wygląda gorzej niż u nich,
iteracja nie jest skończona.

To zadanie ma dwie części:
A) Zapisz poniższą specyfikację do plików repozytorium (sekcja „ZADANIE TERAZ”).
B) Zrealizuj iterację 0.
Każda następna iteracja będzie uruchamiana komendą /goal. Proces opisany
w „PROTOKÓŁ ITERACJI” obowiązuje od teraz.

══════════════════════════════════════════════════════════════════════
1. PRODUKT
══════════════════════════════════════════════════════════════════════

Zdanie retencji (wszystko inne ma mu służyć):
„Gracz opiekuje się zwierzakiem, który żyje w czasie rzeczywistym, żeby
wychować go w unikalną dorosłą formę i pokazać go znajomym, i wraca jutro,
bo zwierzak go potrzebuje, czeka na niego coś nowego, a znajomi odwiedzają
jego pokój.”

Grupa docelowa: casual, 10+ lat (projektujemy pod Google Play Families
Policy, nawet jeśli w konsoli wybierzemy 13+). Sesja 1–5 minut, 3–6 sesji
dziennie.

Filary (każda iteracja wzmacnia przynajmniej jeden):
1. ŻYWY ZWIERZAK: animacje idle, mimika, reakcje na dotyk, osobowość.
   Zwierzak ma wyglądać na żywego nawet wtedy, gdy gracz nic nie robi.
2. OPIEKA ZE ZNACZENIEM: potrzeby, choroby, sen i ewolucja. Jakość opieki
   wpływa na to, kim zwierzak się stanie.
3. WŁASNY ŚWIAT: kosmetyki, pokój do urządzenia, kolekcje.
4. RAZEM: znajomi, odwiedziny, prezenty, wspólne wydarzenia.
5. ZAWSZE COŚ NOWEGO: zadania dzienne, wydarzenia sezonowe, przepustka.

══════════════════════════════════════════════════════════════════════
2. ZASADY NIENARUSZALNE (łamiesz je = iteracja odrzucona)
══════════════════════════════════════════════════════════════════════

Etyka i dobrostan gracza:
- Zwierzak domyślnie nie umiera na zawsze. Zaniedbany choruje, smutnieje,
  a na końcu „wyrusza w podróż”. Wraca po krótkim zadaniu ratunkowym, bez
  utraty kolekcji ani zakupów. Prawdziwa śmierć istnieje tylko w trybie
  „Klasycznym”, który gracz włącza świadomie, i wtedy zwierzak ma pomnik
  oraz drzewo pokoleń.
- Tempo spadku potrzeb dobierasz tak, żeby gracz zaglądający 3 razy dziennie
  utrzymał zwierzaka w dobrym stanie. Zwierzak śpi wtedy, gdy śpi gracz
  (okno snu ustawiane przy onboardingu, domyślnie 22:00–7:00 lokalnie).
  Podczas snu potrzeby spadają co najmniej 4 razy wolniej.
- Tryb wakacji / „u babci”: wstrzymuje symulację do 14 dni.
- Powiadomienia: najwyżej 3 dziennie, nigdy w oknie snu, bez wpędzania
  w poczucie winy („Kłębek tęskni i umiera” jest zakazane, „Kłębek zgłodniał”
  jest w porządku). Każdy typ powiadomień ma osobny przełącznik.
- Seria logowań ma „zamrożenie” (1 darmowe na tydzień). Utrata serii nie
  może kosztować niczego poza samą serią.
- Żadnych dark patterns: bez fałszywych odliczań, bez potwierdzeń typu
  „Nie, nie lubię zwierząt”, bez ukrytych kosztów.

Monetyzacja (uczciwa, kosmetyczna):
- Płatne są wyłącznie kosmetyki, wygoda bez przewagi i przepustka sezonowa.
  Za pieniądze nie da się kupić przewagi w rankingach mini-gier.
- Żadnych płatnych losowań. Jeśli kiedyś pojawi się element losowy, szanse
  są ujawnione w UI, a płatność za niego jest wyłączona dla kont < 18 lat.
- Reklamy tylko nagradzane, tylko po świadomym tapnięciu, przez Google UMP.
  Dla dzieci bez personalizacji. Nigdy reklama pełnoekranowa wymuszona.
- Zakupy walidowane po stronie serwera (Play Developer API). Waluta twarda
  istnieje tylko na serwerze.

Bezpieczeństwo dzieci i prywatność:
- Brak czatu tekstowego. Komunikacja odbywa się przez gotowe frazy, emotki
  i naklejki. Nazwy zwierzaków i pokoi przechodzą filtr wulgaryzmów (PL+EN)
  i mają przycisk „Zgłoś”. Każdego gracza da się zablokować.
- Konto domyślnie anonimowe. Powiązanie z Google przez Credential Manager
  jest opcjonalne. Bramka wieku przy starcie (neutralna, bez sugerowania
  odpowiedzi).
- Minimalizacja danych zgodna z RODO/GDPR-K i COPPA. Analityka bez
  identyfikatorów reklamowych u dzieci. Usunięcie konta jest dostępne
  z aplikacji i działa naprawdę (endpoint + test).
- Na bieżąco utrzymujesz szkic formularza Data Safety w
  `docs/PLAY_DATA_SAFETY.md`.

Inżynieria:
- Serwer jest autorytatywny dla czasu, ekonomii i stanu zwierzaka. Klient
  przewiduje stan i synchronizuje się w trybie offline-first. Zmiana zegara
  w telefonie nic nie daje (test na to).
- Symulacja zwierzaka jest czystą funkcją Kotlin w module współdzielonym
  przez aplikację i serwer, w stylu `advance(state, from, to, rules) -> state`.
  Jest deterministyczna i analityczna: 3 dni offline liczone są przedziałami,
  a nie pętlą po sekundach.
- Żadnych sekretów w repozytorium. Klucze i konfiguracja idą przez
  zmienne środowiskowe / `local.properties` (w .gitignore).
- Assety tylko z licencją, którą da się udokumentować (własne,
  proceduralne, CC0). Każdy asset ma wpis w `docs/ASSETS.md`.

══════════════════════════════════════════════════════════════════════
3. ARCHITEKTURA I STACK (zmiana tylko przez ADR z uzasadnieniem)
══════════════════════════════════════════════════════════════════════

Moduły Gradle (version catalog `gradle/libs.versions.toml`, KSP, Kotlin
w najnowszej stabilnej wersji, build-logic w `build-logic/` jako convention
plugins):
- `:core:sim`: czysty Kotlin/JVM, zero zależności Androida. Model zwierzaka,
  potrzeby, choroby, etapy życia, ewolucja, ekonomia (reguły cen), RNG z
  ziarnem. Współdzielony przez `:app` i `:server`.
- `:core:model`, `:core:data` (Room, DataStore, repozytoria, synchronizacja),
  `:core:network` (Ktor Client + kotlinx.serialization), `:core:designsystem`
  (Material 3, motyw gry, typografia, komponenty), `:core:ui`.
- `:feature:*` dla każdego ekranu/obszaru (home, care, minigames, shop,
  wardrobe, room, friends, events, settings, onboarding).
- `:app`: Compose, Navigation (type-safe), Hilt, WorkManager, Glance (widget).
- `:server`: Ktor Server + PostgreSQL (Exposed albo jOOQ, migracje Flyway),
  `docker-compose.yml` do lokalnego uruchomienia. Testy na Testcontainers,
  a jeśli Docker jest niedostępny, na H2 w trybie PostgreSQL (zapisz to
  w ADR).
- `:baselineprofile` (od fazy 4).

Android: minSdk 26, targetSdk = najnowszy wymagany przez Google Play,
edge-to-edge, predictive back, dynamic color wyłączony (gra ma własną
paletę), wsparcie dla trybu ciemnego, tabletów i składanych urządzeń
(WindowSizeClass).

UI/MVI: każdy ekran ma `UiState` (immutable), `UiEvent` i `ViewModel`
eksponujący `StateFlow`. Efekty jednorazowe idą przez `Channel`. Żadnej logiki
gry w composable.

Zwierzak (render): parametryczny rig wektorowy rysowany w Compose Canvas.
Składa się z ciała-bloba, oczu, powiek, źrenic, pyszczka, uszu/ogona
i akcesoriów. Squash & stretch, oddech, mruganie, śledzenie palca wzrokiem,
mimika z mieszania kształtów ust/oczu. Wygląd jest generowany z „genomu”
(kolor, wzór, kształt uszu, proporcje), więc każdy gracz ma unikalnego
zwierzaka. Rive/Lottie dopuszczalne później przez ADR, jeśli rig
w Canvasie przestanie wystarczać.

Dźwięk i haptyka: krótkie SFX (SoundPool), haptyka przez
`HapticFeedbackConstants` / `VibrationEffect` z primitives tam, gdzie
urządzenie wspiera. Każdy dźwięk i wibracja mają przełącznik.

Jakość kodu: ktlint (lub Spotless+ktlint), detekt, Android Lint z
`warningsAsErrors` dla nowych reguł (baseline dozwolony tylko dla
odziedziczonych), testy JUnit5 + Kotest (testy właściwości dla `:core:sim`),
Turbine dla Flow, Robolectric + Roborazzi dla zrzutów ekranu, Kover.

CI: `.github/workflows/ci.yml` uruchamia `./gradlew check` (lint, detekt,
testy, weryfikacja zrzutów), `assembleRelease` z R8 oraz budżety z sekcji 4.

══════════════════════════════════════════════════════════════════════
4. BRAMKI JAKOŚCI (Definition of Done każdej iteracji)
══════════════════════════════════════════════════════════════════════

Twarde (iteracja nie może się zamknąć, jeśli nie przechodzą):
- `./gradlew check` zielony; `./gradlew :app:assembleRelease` buduje się z R8.
- Pokrycie `:core:sim` ≥ 90% linii (Kover verify), reszta: każda nowa
  logika ma test.
- Każdy nowy lub zmieniony ekran ma test zrzutu Roborazzi w wariantach:
  telefon jasny, telefon ciemny, font 200%, tablet. PNG oglądasz sam
  (narzędziem do czytania plików) i opisujesz w raporcie, co sprawdziłeś.
- Rozmiar APK release (arm64) ≤ 30 MB, dziś cel ≤ 15 MB. Skrypt
  `scripts/check-apk-size.sh` sprawdza to w CI.
- Brak nowych ostrzeżeń lint/detekt. Brak `TODO` bez numeru w
  `docs/ROADMAP.md`.
- Dostępność: każdy interaktywny element ma `contentDescription` / semantykę,
  cel dotyku ≥ 48dp, kontrast ≥ 4.5:1 dla tekstu. Wszystkie akcje opieki da się
  wykonać bez gestów precyzyjnych (alternatywa przyciskiem).
- Wszystkie teksty są w zasobach, w wersji PL i EN. Pseudolokalizacja
  (en-XA) nie łamie layoutu.

Docelowe (mierzone od fazy 4, raportowane w każdej iteracji, gdy da się je
zmierzyć):
- Google Play Android vitals: user-perceived crash rate < 1.09%, ANR < 0.47%
  (progi „bad behavior”). Nasz cel to < 0.5% i < 0.2%.
- Zimny start < 1.5 s na urządzeniu klasy średniej (Macrobenchmark),
  60 fps na ekranie głównym bez janku > 5% klatek.
- Retencja (po wejściu na produkcję): D1 ≥ 40%, D7 ≥ 15%, D30 ≥ 6%.

══════════════════════════════════════════════════════════════════════
5. PROTOKÓŁ ITERACJI (wykonujesz go przy każdym /goal)
══════════════════════════════════════════════════════════════════════

0. Nie zadajesz pytań. Gdy coś jest niejasne, wybierasz rozwiązanie zgodne
   z sekcjami 1–4, zapisujesz je jako ADR w `docs/DECISIONS.md` i idziesz dalej.
1. Ustal stan. Przeczytaj `docs/FEEDBACK.md` (zgłoszenia z playtestów pisane
   przez człowieka), `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `git log -10`.
2. Wybierz zakres, w tej kolejności:
   a) nieobsłużone zgłoszenie z FEEDBACK.md oznaczone [!] (krytyczne);
   b) zielony build, jeśli main jest czerwony;
   c) pierwsza niezamknięta iteracja z ROADMAP.md;
   d) jeśli roadmapa jest wyczerpana: zrób analizę luk względem
      `docs/BENCHMARK.md`, dopisz do ROADMAP.md kolejne 5 iteracji
      uszeregowanych według wpływu na retencję / koszt i weź pierwszą.
   Iteracja to jeden pionowy przekrój, który da się pokazać graczowi.
   Ma być wykonalna w jednej sesji. Za duża? Podziel ją w ROADMAP.md
   (N → Na, Nb) i weź pierwszą część.
3. Standard gatunku. Zanim zaczniesz pisać kod, ustal, jak tę funkcję robią
   liderzy (sekcja 6). Szukaj w sieci, jeśli masz dostęp. Zapisz 3–8 zdań
   w `docs/BENCHMARK.md` pod nagłówkiem iteracji: co robią, co z tego bierzemy,
   czego świadomie nie bierzemy i dlaczego. Źródła podawaj jako linki.
4. Projekt. Napisz krótko (w opisie commita, nie w osobnym dokumencie) stan,
   zdarzenia i reguły. Liczby balansu trzymaj w jednym miejscu
   (`:core:sim` `Rules`), nie w UI.
5. Implementacja z testami. Najpierw testy reguł w `:core:sim` / `:server`,
   potem UI.
6. Weryfikacja. Uruchom bramki z sekcji 4. Wygeneruj zrzuty i obejrzyj je.
   Napraw wszystko, co odstaje od standardu, zanim zamkniesz iterację.
   Wybierasz poprawkę, nie notatkę „do poprawy później”.
7. Samoocena rynkowa. W `docs/CHANGELOG.md` oceń iterację w skali 1–5 w:
   czytelność, „game feel”, haki retencji, etyka, wydajność, dostępność.
   Każda ocena < 4 musi mieć konkretne zadanie dopisane do ROADMAP.md.
8. Dokumentacja. Odhacz iterację w ROADMAP.md ([x] + hash commita po
   wypchnięciu), uzupełnij CHANGELOG.md i README.md (jak uruchomić, co jest
   w grze), a FEEDBACK.md oznacz jako obsłużone (z numerem iteracji).
9. Commit i push. Tytuł: „Iteracja N: <co gracz teraz może / co się
   zmieniło>”, po polsku. Treść wyjaśnia DLACZEGO: problem, decyzję,
   odrzucone alternatywy i to, jak zostało zweryfikowane. Wypchnij na bieżącą
   gałąź. PR otwierasz tylko wtedy, gdy człowiek o to poprosi.
10. Raport końcowy (ostatnia wiadomość iteracji, dokładnie w tym formacie,
    bo na jego podstawie /goal ocenia warunek):

    ITERACJA N ZAMKNIĘTA — <tytuł>
    Commit: <hash> wypchnięty na <gałąź>
    Bramki: check ✅/❌ | assembleRelease ✅/❌ | Kover sim <x>% |
            APK <x> MB | zrzuty obejrzane: <lista ekranów>
    Standard gatunku: <1 zdanie, z kim się porównujesz>
    Samoocena: czytelność x, feel x, retencja x, etyka x, wydajność x,
               dostępność x
    Następna iteracja: <numer i tytuł z ROADMAP.md>

    Jeśli którakolwiek twarda bramka jest ❌, iteracja NIE jest zamknięta.
    Wtedy pracujesz dalej, a raportu nie wypisujesz.

══════════════════════════════════════════════════════════════════════
6. BENCHMARK GATUNKU (punkt wyjścia do docs/BENCHMARK.md)
══════════════════════════════════════════════════════════════════════

- Tamagotchi (Uni/Paradise/On): błędy opieki decydują o formie dorosłej,
  etapy życia, pokolenia i swatanie, kolekcjonowanie postaci, wspólny
  świat online (Tamaverse).
- Pou: karmienie przeciąganiem jedzenia do pyszczka, mycie gestem szorowania,
  gaszenie światła, mini-gry jako źródło waluty, garderoba i pokoje,
  odwiedziny u znajomych.
- My Talking Tom 2 / Friends: reakcje na dotyk i głos, bardzo wysoki
  „juice” (squash & stretch, cząsteczki, dźwięk), choroby, toaleta, zabawki.
- Finch: zwierzak rośnie dzięki dobrostanowi gracza, łagodne powiadomienia,
  świetne widgety, brak karania, przyjaciele wysyłający sobie „good vibes”.
- Pokémon Sleep: rytm dobowy zgodny z życiem gracza, poranny raport.
- Neopets / Adopt Me!: ekonomia, kolekcje, wydarzenia sezonowe, bezpieczna
  komunikacja przez gotowe frazy, handel (u nas: tylko prezenty, bez handlu,
  ze względu na dzieci).

══════════════════════════════════════════════════════════════════════
7. ROADMAPA (zapisz do docs/ROADMAP.md jako checklistę)
══════════════════════════════════════════════════════════════════════

Każda pozycja ma w pliku: cel dla gracza, kryteria akceptacji (sprawdzalne)
i testy, które ją potwierdzają. Poniżej znajdują się cel i kluczowe kryteria;
rozwiń je przy zapisie.

FAZA 0: FUNDAMENT I RDZEŃ OFFLINE (bramka: „chcę tu wrócić jutro”)
[ ] 0. Szkielet: moduły z sekcji 3, build-logic, version catalog, CI,
       ktlint/detekt/Kover/Roborazzi, `scripts/setup-android-sdk.sh`,
       pusty ekran Compose z motywem gry, `:server` z /health i testem,
       docker-compose, README, ADR-001 (stack). Kryterium: `./gradlew check
       assembleRelease` zielone lokalnie i w CI.
[ ] 1. Symulacja potrzeb w `:core:sim`: głód, energia, higiena, radość,
       zdrowie (0–100), spadek zależny od etapu życia i okna snu,
       analityczne `advance()`. Testy właściwości: monotoniczność,
       ograniczenia 0..100, `advance(a→c) == advance(b→c)∘advance(a→b)`.
[ ] 2. Żywy zwierzak: rig wektorowy z genomu, oddech, mruganie, wzrok za
       palcem, 6 min (szczęśliwy, głodny, śpiący, brudny, chory, smutny),
       głaskanie gestem z reakcją i haptyką. Zrzuty każdej miny.
[ ] 3. Akcje opieki: karmienie przeciąganiem jedzenia do pyszczka (z
       alternatywą przyciskiem), mycie szorowaniem z pianą, sen
       z gaszeniem światła, zabawa piłką. Każda akcja ma animację, dźwięk,
       haptykę i liczbę nad paskiem.
[ ] 4. Persistencja i czas: Room + DataStore, catch-up po powrocie z poranną
       kartką „co się działo, gdy cię nie było”, ochrona przed cofnięciem
       zegara (offline: monotoniczny czas + ostatni znany czas serwera).
[ ] 5. Cykl życia i ewolucja: jajo → niemowlę → dziecko → nastolatek →
       dorosły. Co najmniej 6 form dorosłych zależnych od błędów opieki
       i dominującej aktywności. Animacja przemiany i wpis do albumu.
[ ] 6. Choroby i zła opieka bez okrucieństwa: choroba, lekarstwo, „podróż”
       zamiast śmierci, zadanie ratunkowe, tryb wakacji.
[ ] 7. Powiadomienia z szacunkiem: WorkManager, kanały, prośba o
       POST_NOTIFICATIONS w kontekście (po pierwszym głodzie, nie przy
       starcie), limity z sekcji 2.
[ ] 8. Onboarding (FTUE): wyklucie jajka jako samouczek, nazwanie zwierzaka,
       ustawienie okna snu. Mniej niż 60 s do pierwszego głaskania, zero ścian
       tekstu. Test zrzutów całej ścieżki.
[ ] 9. Widget na ekran główny (Glance): zwierzak i jego najpilniejsza potrzeba.
       Bramka fazy: plik `docs/PLAYTEST.md` z protokołem (5 osób, czy wracają
       w dniu 2 bez proszenia).

FAZA 1: TREŚĆ I EKONOMIA
[ ] 10. Waluta miękka i model ekonomii w `:core:sim` (źródła/ujścia,
        symulacja 30 dni gry w teście, inflacja ≤ ustalony próg).
[ ] 11–13. Trzy mini-gry (zręcznościowa, logiczna, rytmiczna), 60–90 s każda,
        nagroda zależna od wyniku z dziennym limitem, rekord lokalny.
[ ] 14. Sklep i spiżarnia: jedzenie o różnych efektach, ulubione smaki
        zwierzaka (osobowość).
[ ] 15. Garderoba: kosmetyki na rigu (czapki, okulary, szaliki), podgląd
        przed zakupem.
[ ] 16. Pokój: urządzanie na siatce, meble wpływają na nastrój, tapety, kilka
        pokoi (kuchnia, łazienka, sypialnia, bawialnia jako miejsca akcji).
[ ] 17. Zadania dzienne i tygodniowe, seria logowań z zamrożeniem,
        osiągnięcia.
[ ] 18. Osobowość: cechy zwierzaka wynikające z historii opieki, wpływające
        na reakcje i dialogi (dymki z obrazkami).

FAZA 2: ONLINE
[ ] 19. Konto anonimowe na serwerze, tokeny, migracja stanu lokalnego.
[ ] 20. Synchronizacja offline-first: serwer autorytatywny, kolejka akcji
        z kluczami idempotencji, rozwiązywanie konfliktów. Test „dwa
        urządzenia, jeden zwierzak”.
[ ] 21. Ekonomia na serwerze: walidacja transakcji, anty-cheat czasu (test
        z cofniętym zegarem klienta).
[ ] 22. Powiązanie z Google (Credential Manager), usunięcie konta.
[ ] 23. Znajomi: kody/QR, zaproszenia, lista, blokowanie i zgłaszanie.
[ ] 24. Odwiedziny: pokój znajomego, wspólne głaskanie/karmienie z bonusem
        dla obu stron, księga gości z naklejkami.
[ ] 25. Prezenty i gotowe frazy (bezpieczna komunikacja).
[ ] 26. Tygodniowe rankingi mini-gier (wśród znajomych i globalnie),
        walidacja wyników po stronie serwera.
[ ] 27. Push przez FCM (za interfejsem, z fallbackiem na WorkManager).

FAZA 3: LIVEOPS I MONETYZACJA
[ ] 28. Zdalna konfiguracja i flagi funkcji z serwera (z wartościami
        domyślnymi w aplikacji).
[ ] 29. Kalendarz wydarzeń sezonowych (serwerowy), pierwsze wydarzenie
        z tematycznymi kosmetykami i mini-zadaniami.
[ ] 30. Przepustka sezonowa (darmowa ścieżka + płatna, wyłącznie
        kosmetyki).
[ ] 31. Google Play Billing (najnowsza wersja biblioteki), walidacja
        paragonów na serwerze, przywracanie zakupów, kontrola rodzicielska
        zakupów.
[ ] 32. Nagradzane reklamy z UMP, tryb dla dzieci, limit dzienny.
[ ] 33. Analityka z poszanowaniem prywatności: lejek FTUE, retencja,
        ekonomia. Panel KPI w `docs/KPI.md` + testy A/B przez flagi.
[ ] 34. Pokolenia: dorosły zwierzak może zostać rodzicem, potomek dziedziczy
        geny, a gracz buduje drzewo rodowe i album pokoleń.

FAZA 4: JAKOŚĆ PREMIUM I WYDANIE
[ ] 35. Baseline Profiles + Macrobenchmark, budżety z sekcji 4 w CI.
[ ] 36. Dostępność: audyt TalkBack, tryb dla daltonistów, ograniczenie
        ruchu, duże przyciski.
[ ] 37. Tablety i składane: układy dwupanelowe.
[ ] 38. Lokalizacja: kolejne języki (DE, ES, PT-BR) i formaty dat/liczb.
[ ] 39. Crashlytics lub odpowiednik, polityka prywatności, Data Safety,
        zgodność z Families Policy (checklista w docs).
[ ] 40. Pipeline wydania: podpisany AAB, Gradle Play Publisher na ścieżkę
        wewnętrzną, wersjonowanie, notatki wydania z CHANGELOG.
Dalej: analiza luk z BENCHMARK.md wyznacza kolejne iteracje (protokół
pkt 2d), np. Wear OS, gesty głosowe, AR „zwierzak w pokoju”, kluby.

══════════════════════════════════════════════════════════════════════
8. ZADANIE TERAZ
══════════════════════════════════════════════════════════════════════

1. Utwórz pliki:
   - `CLAUDE.md`: sekcje 1–5 tej specyfikacji (w całości, to jest
     konstytucja projektu wczytywana przy każdej sesji) oraz krótka sekcja
     „Komendy” z poleceniami build/test/zrzuty.
   - `docs/ROADMAP.md`: sekcja 7 rozwinięta do kryteriów akceptacji.
   - `docs/BENCHMARK.md`: sekcja 6 + miejsce na notatki iteracji.
   - `docs/DECISIONS.md`: ADR-001 (stack i architektura modułów).
   - `docs/CHANGELOG.md`, `docs/FEEDBACK.md` (z instrukcją dla człowieka:
     jak zgłaszać, `[!]` = krytyczne), `docs/ASSETS.md`,
     `docs/PLAY_DATA_SAFETY.md`.
2. Zrealizuj iterację 0 zgodnie z protokołem (sekcja 5), łącznie z commitem,
   pushem i raportem końcowym.
````

---

## 2. Komenda `/goal` (uruchamiasz przy każdym kolejnym kroku)

Wariant podstawowy, **jedna iteracja na jedno uruchomienie**. Po każdej
iteracji masz moment, żeby zagrać, wpisać uwagi do `docs/FEEDBACK.md`
i dopiero wtedy ruszyć dalej:

```text
/goal Następna iteracja wybrana według protokołu z CLAUDE.md (sekcja 5, pkt 2) jest zrealizowana i zamknięta: w rozmowie widać wynik `./gradlew check` i `./gradlew :app:assembleRelease` zakończonych BUILD SUCCESSFUL, iteracja jest odhaczona w docs/ROADMAP.md, a ostatnia wiadomość zawiera raport „ITERACJA N ZAMKNIĘTA” ze wszystkimi bramkami ✅ i hashem commita wypchniętego na bieżącą gałąź.
```

Wariant „cała faza” (dłuższa autonomiczna praca, np. na noc):

```text
/goal Wszystkie iteracje FAZY 0 w docs/ROADMAP.md są odhaczone [x] z hashami commitów; każda została zrealizowana osobnym commitem według protokołu z CLAUDE.md; ostatni raport „ITERACJA N ZAMKNIĘTA” w rozmowie ma wszystkie bramki ✅, a `git status` pokazuje czyste drzewo zsynchronizowane z origin.
```

Wariant „poprawki z playtestu” (gdy w `docs/FEEDBACK.md` są nowe zgłoszenia):

```text
/goal Każde nieobsłużone zgłoszenie w docs/FEEDBACK.md jest oznaczone jako obsłużone z numerem iteracji, poprawki są wypchnięte, a raport „ITERACJA N ZAMKNIĘTA” w rozmowie ma wszystkie bramki ✅.
```

---

## Dlaczego prompt jest zbudowany w ten sposób

- **Konstytucja w `CLAUDE.md`, krótki `/goal`.** Specyfikacja jest w pliku,
  który każda sesja wczytuje automatycznie. Dzięki temu iteracja 25 pracuje
  według tych samych reguł co iteracja 1, nawet w nowej sesji bez historii.
- **Warunek sprawdzalny z rozmowy.** Model oceniający `/goal` widzi tylko
  rozmowę, nie repozytorium. Dlatego warunek wymaga wypisania wyników
  Gradle i raportu w stałym formacie. „Gra jest dobra” nie da się sprawdzić,
  „BUILD SUCCESSFUL + wszystkie bramki ✅” da się.
- **Benchmark przed kodem.** Punkt 3 protokołu zmusza do porównania się
  z liderami gatunku przed implementacją. Do tego służy wymóg „najwyższych
  standardów rynkowych”: standard ustala porównanie, a nie gust.
- **Samoocena z konsekwencją.** Ocena poniżej 4 nie może zostać samym
  komentarzem: musi stać się pozycją w roadmapie. Gra poprawia się w ten
  sposób, nawet gdy roadmapa się skończy (protokół pkt 2d).
- **Twoje uwagi mają pierwszeństwo.** Zgłoszenia `[!]` w `docs/FEEDBACK.md`
  wyprzedzają roadmapę. Prawdziwy playtest jest ważniejszy niż plan.
- **Symulacja współdzielona przez aplikację i serwer.** Te same reguły
  liczą stan na telefonie (offline, przewidywanie) i na serwerze
  (autorytet, anty-cheat). Dzięki temu oszukanie zegara nic nie daje,
  a testy reguł pisze się raz.
