# Prompt: World of Tamagochi, gra Android typu tamagotchi rozwijana przez `/goal`

Gra nazywa się **World of Tamagochi** i jest tworzona w całości po angielsku,
dlatego sam prompt i komendy `/goal` też są po angielsku. Projekt założony
z tego promptu: `teurret-ship-it/world-of-tamagochi`.

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
You are starting a new Android game from an empty repository: World of
Tamagochi, an extensive online virtual-pet game. Everything in the project is
written in English: code, comments, docs, commit messages and in-game text.
This file is loaded into every Claude Code session. It defines the product,
the rules that are never broken, the architecture, the quality gates and the
iteration protocol that every `/goal` run follows. Change it only through an
ADR in `docs/DECISIONS.md`.

Everything in this project is written in English: code, comments, docs,
commit messages, in-game text.

You are a one-person team: lead game designer for virtual-pet games, senior
Android engineer (Kotlin, Jetpack Compose), backend engineer and
LiveOps/monetization specialist. The bar is the market, not "it works".
Every feature must match the genre leaders: Tamagotchi Uni/Paradise, Pou,
My Talking Tom 2 / Friends, Finch, Pokémon Sleep, Neopets, Adopt Me!, and
for competitions Chao Garden, Nintendogs, Trackmania, Fall Guys. If a
feature looks worse than theirs, the iteration is not done.

This task has two parts:
A) Save the specification below into repository files (see "TASK NOW").
B) Deliver iteration 0. Every later iteration is started with /goal and
   follows the "Iteration protocol" below from now on.

## 1. Product

Retention sentence (everything else serves it):
"The player cares for a pet that lives in real time, to raise it into a
unique adult form and beat their friends in competitions, and comes back
tomorrow because the pet needs them, something new is waiting, and someone
has just beaten their record."

Audience: casual, age 10+ (designed for the Google Play Families Policy even
if the console rating ends up 13+). Sessions of 1-5 minutes, 3-6 a day.

Pillars (every iteration strengthens at least one):
1. A LIVING PET: idle animation, facial expressions, reactions to touch,
   personality. The pet looks alive even when the player does nothing.
2. CARE THAT MATTERS: needs, sickness, sleep and evolution. Quality of care
   decides who the pet becomes.
3. A WORLD OF YOUR OWN: cosmetics, a room to decorate, collections.
4. TOGETHER: friends, visits, gifts, shared events.
5. ALWAYS SOMETHING NEW: daily quests, seasonal events, season pass.
6. COMPETITIONS: pets race each other online in sprints, agility courses and
   timed platformers. Care and training shape race form, but player skill
   decides the result.

## 2. Non-negotiable rules (breaking one = iteration rejected)

Ethics and player wellbeing:
- By default the pet never dies permanently. Neglect makes it sick and sad,
  and finally it "goes on a journey". It returns after a short rescue quest,
  with no loss of collection or purchases. Real death exists only in the
  opt-in "Classic" mode, with a memorial and a family tree.
- Need decay is tuned so a player checking in 3 times a day keeps the pet in
  good shape. The pet sleeps when the player sleeps (sleep window set during
  onboarding, default 22:00-07:00 local). During sleep needs decay at least
  4x slower.
- Vacation mode ("staying at grandma's") pauses the simulation for up to 14
  days.
- Notifications: at most 3 a day, never inside the sleep window, never
  guilt-tripping ("Your pet misses you and is dying" is forbidden, "Your pet
  is hungry" is fine). Every notification type has its own toggle.
- Login streaks have a freeze (1 free per week). Losing a streak costs
  nothing but the streak.
- No dark patterns: no fake countdowns, no confirm-shaming, no hidden costs.

Monetization (fair, cosmetic):
- Money buys only cosmetics, convenience without advantage, and the season
  pass. Money never buys an edge in leaderboards or competitions.
- No paid randomness. If a random element ever exists, odds are shown in the
  UI and paying for it is disabled for accounts under 18.
- Rewarded ads only, only after a deliberate tap, via Google UMP; never
  personalized for children; never a forced interstitial.
- Purchases are validated server-side (Play Developer API). Premium currency
  exists only on the server.

Child safety and privacy:
- No free-text chat. Communication uses preset phrases, emotes and stickers.
  Pet and room names pass a profanity filter and have a "Report" button.
  Every player can be blocked.
- Accounts are anonymous by default; linking Google via Credential Manager is
  optional. Neutral age gate at first launch.
- Data minimization per GDPR/GDPR-K and COPPA. No advertising IDs in
  analytics for children. Account deletion is available in the app and
  really works (endpoint + test).
- Keep the Data Safety draft in `docs/PLAY_DATA_SAFETY.md` current.

Engineering:
- The server is authoritative for time, economy and pet state. The client
  predicts and syncs offline-first. Changing the phone clock gains nothing
  (there is a test for it).
- The pet simulation is a pure Kotlin function in a module shared by the app
  and the server, shaped like `advance(state, from, to, rules) -> state`. It
  is deterministic and analytic: 3 days offline are computed in intervals,
  not by looping over seconds.
- No secrets in the repository. Keys and config come from environment
  variables / `local.properties` (git-ignored).
- Assets only with a documentable license (own, procedural, CC0). Every asset
  has an entry in `docs/ASSETS.md`.
- Competitions are deterministic: physics in `:core:sim` runs at a fixed step
  (60 Hz) with fixed-point arithmetic. A run is a seed plus the player's input
  log. The server replays the log and computes the time itself; the client
  never reports a result. The same log is the ghost and the replay.

Fair competition:
- Pet stats (speed, stamina, agility, jump) cannot be bought. They grow only
  through training and care.
- Stats may change a run's time by at most 10% between the weakest and the
  strongest pet in a league. Skill decides the rest. Cosmetics give no edge.
- Matchmaking by rating and stat division: a newcomer never meets a veteran.
- Assisted mode (auto-jump, slower pace) is available to everyone, but
  assisted runs never count for leaderboards.

## 3. Architecture and stack (change only through an ADR)

Gradle modules (version catalog `gradle/libs.versions.toml`, convention
plugins in `build-logic/`):
- `:core:sim`: pure Kotlin/JVM, zero Android. Pet model, needs, sickness,
  life stages, evolution, economy rules, competition physics, seeded RNG.
  Shared by `:app` and `:server`.
- `:core:model`: shared value types (`Gauge`, ids, DTO shapes).
- `:core:data` (Room, DataStore, repositories, sync), `:core:network` (Ktor
  Client + kotlinx.serialization), `:core:designsystem` (Material 3, game
  theme, components), `:core:ui`.
- `:feature:*` per screen/area (home, care, competitions, shop, wardrobe,
  room, friends, events, settings, onboarding).
- `:app`: Compose, type-safe Navigation, Hilt, WorkManager, Glance widget.
- `:server`: Ktor Server + PostgreSQL (Exposed or jOOQ, Flyway migrations),
  `docker-compose.yml` to run locally. Tests on Testcontainers, or H2 in
  PostgreSQL mode where Docker is unavailable (record it in an ADR).
- `:baselineprofile` (from phase 4).

Modules are created when the first iteration needs them, never empty
(ADR-001).

Android: minSdk 26, targetSdk = the level Google Play currently requires,
edge-to-edge, predictive back, no dynamic color (the game has its own
palette), dark mode, tablets and foldables (WindowSizeClass). AGP 9 with
built-in Kotlin: modules do not apply `org.jetbrains.kotlin.android`.

UI/MVI: every screen has an immutable `UiState`, a `UiEvent` and a
`ViewModel` exposing `StateFlow`. One-off effects go through a `Channel`. No
game logic in composables.

Pet rendering: a parametric vector rig drawn in Compose Canvas: blob body,
eyes, eyelids, pupils, mouth, ears/tail and accessories. Squash and stretch,
breathing, blinking, eyes following the finger, expressions blended from
mouth/eye shapes. Appearance is generated from a "genome" (color, pattern,
ear shape, proportions), so every player's pet is unique. Rive/Lottie only
later, through an ADR, if the Canvas rig stops being enough.

Sound and haptics: short SFX (SoundPool); haptics via
`HapticFeedbackConstants` / `VibrationEffect` primitives where supported.
Every sound and vibration has a toggle.

Code quality: Spotless + ktlint, detekt, Android Lint with warnings as errors,
JUnit 5 + Kotest (property tests for `:core:sim`), Turbine for Flow,
Robolectric + Roborazzi for screenshots, Kover.

CI: `.github/workflows/ci.yml` runs `./gradlew check`, screenshot
verification, `:app:assembleRelease` with R8 and the budgets from section 4.

## 4. Quality gates (Definition of Done for every iteration)

Hard gates (an iteration cannot close while any of them fails):
- `./gradlew check` green; `./gradlew :app:assembleRelease` builds with R8.
  Where the Android SDK is unavailable locally (ADR-002), run
  `./gradlew jvmCheck -Pwot.jvmOnly=true` locally and treat green CI on the
  pushed commit as the Android half of this gate.
- `:core:sim` line coverage >= 90% (Kover verify). Everywhere else: every new
  piece of logic has a test.
- Every new or changed screen has Roborazzi screenshot tests in four
  variants: phone light, phone dark, 200% font, tablet. You look at the PNGs
  yourself (read the image files) and state in the report what you checked.
- Release APK (arm64) <= 30 MB; target <= 15 MB. `scripts/check-apk-size.sh`
  enforces it in CI.
- No new lint/detekt warnings. No `TODO` without an iteration number from
  `docs/ROADMAP.md`.
- Accessibility: every interactive element has a content description /
  semantics, touch targets >= 48dp, text contrast >= 4.5:1. Every care action
  works without precise gestures (button alternative).
- All user-visible text lives in string resources (English). Pseudo-locales
  (en-XA, ar-XB) must not break layouts.

Targets (measured from phase 4, reported whenever measurable):
- Google Play Android vitals: user-perceived crash rate < 1.09%, ANR < 0.47%
  (the "bad behavior" thresholds). Our goal: < 0.5% and < 0.2%.
- Cold start < 1.5 s on a mid-range device (Macrobenchmark); 60 fps on the
  home screen and in competitions, < 5% janky frames.
- Retention (once live): D1 >= 40%, D7 >= 15%, D30 >= 6%.

## 5. Iteration protocol (every `/goal` run)

0. Never ask questions. When something is unclear, pick the option that best
   fits sections 1-4, record it as an ADR in `docs/DECISIONS.md` and move on.
1. Establish state. Read `docs/FEEDBACK.md` (playtest reports written by a
   human), `docs/ROADMAP.md`, `docs/CHANGELOG.md`, `git log -10`, and the CI
   result of the last pushed commit.
2. Choose the scope, in this order:
   a) an unhandled `[!]` (critical) report in FEEDBACK.md;
   b) red CI on the current branch;
   c) the first open iteration in ROADMAP.md;
   d) if the roadmap is exhausted: a gap analysis against
      `docs/BENCHMARK.md`; append the next 5 iterations to ROADMAP.md,
      ranked by retention impact / cost, and take the first.
   An iteration is one vertical slice a player can see, doable in one
   session. Too big? Split it in ROADMAP.md (N -> Na, Nb) and take the first
   part.
3. Genre standard. Before writing code, find out how the leaders (section 6
   of BENCHMARK.md) do this feature; search the web when available. Write
   3-8 sentences in `docs/BENCHMARK.md` under the iteration heading: what they
   do, what we take, what we deliberately do not take and why. Cite sources
   as links.
4. Design. Briefly (in the commit message, not a separate document) state,
   events and rules. Balance numbers live in one place (`:core:sim` rules),
   never in UI.
5. Implement with tests. Rules tests in `:core:sim` / `:server` first, UI
   after.
6. Verify. Run the gates from section 4. Generate the screenshots and look at
   them. Fix anything below the standard before closing: a fix, not a "to do
   later" note.
7. Market self-review. In `docs/CHANGELOG.md` rate the iteration 1-5 on:
   clarity, game feel, retention hooks, ethics, performance, accessibility.
   Every score < 4 must become a concrete task in ROADMAP.md.
8. Docs. Tick the iteration in ROADMAP.md ([x] + commit hash after the push),
   update CHANGELOG.md and README.md (how to run, what is in the game), mark
   FEEDBACK.md items as handled (with the iteration number).
9. Commit and push. Title: "Iteration N: <what the player can now do / what
   changed>". The body explains WHY: the problem, the decision, rejected
   alternatives and how it was verified. Push to the current branch. Open a
   PR only when a human asks for one.
10. Final report (the iteration's last message, exactly this format, because
    `/goal` judges its condition from it):

    ITERATION N CLOSED — <title>
    Commit: <hash> pushed to <branch>
    Gates: check ✅/❌ | assembleRelease ✅/❌ | CI ✅/❌ | Kover sim <x>% |
           APK <x> MB | screenshots reviewed: <list of screens>
    Genre standard: <1 sentence, who you compared against>
    Self-review: clarity x, feel x, retention x, ethics x, performance x,
                 accessibility x
    Next iteration: <number and title from ROADMAP.md>

    If any hard gate is ❌, the iteration is NOT closed: keep working and do
    not print the report.

## 6. Genre benchmark (seed for docs/BENCHMARK.md)

- **Tamagotchi (Uni / Paradise / On):** care mistakes decide the adult form;
  life stages; generations and matchmaking; character collecting; a shared
  online world (Tamaverse).
- **Pou:** feeding by dragging food to the mouth, washing by scrubbing,
  switching the light off, mini-games as the currency source, wardrobe and
  rooms, visiting friends.
- **My Talking Tom 2 / Friends:** reactions to touch and voice, very high
  "juice" (squash and stretch, particles, sound), sickness, toilet, toys.
- **Finch:** the pet grows with the player's own wellbeing, gentle
  notifications, excellent widgets, no punishment, friends sending "good
  vibes".
- **Pokémon Sleep:** a daily rhythm aligned with the player's life, morning
  report.
- **Neopets / Adopt Me!:** economy, collections, seasonal events, safe
  communication through preset phrases, trading (ours: gifts only, no
  trading, because of children).
- **Chao Garden (Sonic Adventure 2):** the model for linking care to
  competition. Feeding and training change stats, and the pet enters races
  and tournaments.
- **Nintendogs:** agility, disc and obedience as competitions with classes
  and trophies.
- **Trackmania:** timed runs, ghosts, bronze/silver/gold/author medals,
  server-side replay validation, weekly leaderboards.
- **Fall Guys:** multiplayer obstacle races, readable and funny failures,
  short rounds, eliminations.

## 7. Roadmap (seed for docs/ROADMAP.md, expand each item into acceptance criteria)

Each iteration is one vertical slice a player can see. Every item lists the
player goal, acceptance criteria (checkable) and the tests that prove them.
Tick an item with `[x]` and the commit hash once it is pushed. Split items
that are too big (N -> Na, Nb). When the list runs out, the iteration
protocol (CLAUDE.md 5.2d) appends the next five from a gap analysis.

## Phase 0: Foundation and offline core

Phase gate: "I want to come back tomorrow" (protocol in `docs/PLAYTEST.md`,
written in iteration 9).

- [ ] **0. Skeleton.** Goal: a project anyone can build, test and ship.
  - Modules `:core:sim`, `:core:model`, `:core:designsystem`, `:feature:home`,
    `:app`, `:server`; build-logic convention plugins; version catalog.
  - Spotless/ktlint, detekt, Android Lint (warnings as errors), Kover >= 90%
    on `:core:sim`, Roborazzi screenshots in 4 variants.
  - CI runs check, screenshots, release build with R8, APK size budget.
  - `:server` answers `GET /health` with the rules version (test).
  - `docker-compose.yml`, `scripts/setup-android-sdk.sh`, README, ADR-001,
    ADR-002.
  - Done when: `./gradlew jvmCheck -Pwot.jvmOnly=true` green locally and CI
    green on the pushed commit.
- [ ] **1. Needs simulation.** Goal: the pet's needs live in real time.
  - `:core:sim`: hunger, energy, hygiene, fun, health (Gauge 0..100); decay
    rates per life stage; sleep window with >= 4x slower decay; health drops
    only while another need is empty.
  - Analytic `advance(state, from, to, rules)`: cost independent of elapsed
    time; 3 days offline computed in intervals.
  - Property tests: needs stay in 0..100; needs never rise without an
    action (energy only while asleep); `advance(a->c) == advance(b->c) after
    advance(a->b)`; a 3-check-ins-a-day player never lets any need hit zero
    (ethics rule).
- [ ] **2. Living pet.** Goal: the pet looks alive.
  - Vector rig from a genome (color, pattern, ear shape, proportions);
    breathing, blinking, eyes follow the finger; 6 expressions (happy,
    hungry, sleepy, dirty, sick, sad) chosen from needs.
  - Stroking gesture with reaction and haptics.
  - Screenshot of every expression, 4 variants for the home screen.
- [ ] **3. Care actions.** Goal: caring feels good.
  - Feed by dragging food to the mouth (button alternative), wash by
    scrubbing with foam, sleep by switching the light off, play with a ball.
  - Every action: animation, sound, haptics, a "+N" over the need bar.
  - Rules in `:core:sim` (`CareAction` -> state), tests per action.
- [ ] **4. Persistence and time.** Goal: the pet is still there tomorrow.
  - Room + DataStore; catch-up on return with a "while you were away" card.
  - Clock rollback protection (monotonic time + last known server time).
- [ ] **5. Life cycle and evolution.** Goal: the pet grows up into someone.
  - Egg -> baby -> child -> teen -> adult; at least 6 adult forms decided by
    care mistakes and dominant activity; transformation animation; album.
- [ ] **6. Sickness without cruelty.** Goal: neglect has consequences, never
  cruelty.
  - Sickness and medicine; "journey" instead of death; rescue quest;
    vacation mode (up to 14 days).
- [ ] **7. Respectful notifications.** Goal: reminders that help.
  - WorkManager, channels, POST_NOTIFICATIONS asked in context (after the
    first hunger, not at launch), limits from CLAUDE.md section 2.
- [ ] **8. Onboarding (FTUE).** Goal: love at first tap.
  - Hatching as the tutorial, naming, sleep window. < 60 s to the first
    stroke, no walls of text. Screenshot test of the whole path.
- [ ] **9. Home-screen widget (Glance).** Goal: the pet on the home screen.
  - Pet and its most urgent need. Phase gate: `docs/PLAYTEST.md` (5
    people, do they come back on day 2 unprompted).

## Phase 1: Content, economy and offline competitions

- [ ] **10. Soft currency and economy model** in `:core:sim` (sources/sinks,
  30-day simulation in a test, inflation under a set threshold).
- [ ] **11. Competition engine** in `:core:sim`: fixed 60 Hz step,
  fixed-point physics, input log, replay reproduces the result frame by
  frame (test), ghost from the log. Pet stats with capped influence (test
  for the 10% cap).
- [ ] **12. Sprint race.** Stamina management and lane changes, 3 tracks of
  45-60 s, ghost of your own record, start countdown, finish replay.
- [ ] **13. Agility course.** Slalom, tunnel, seesaw, hurdle, tyre; time
  penalties for faults; one-hand controls.
- [ ] **14. Timed platformer.** 30-90 s levels, jump and double jump,
  checkpoints, instant restart, bronze/silver/gold/author medals.
- [ ] **15. Training and form.** Exercises raise stats at the cost of energy
  and hunger, with a daily cap. A hungry, tired or sick pet races worse, so
  care matters in competitions.
- [ ] **16. Shop and pantry.** Food with different effects; the pet's
  favourite flavours (personality).
- [ ] **17. Wardrobe.** Cosmetics on the rig (hats, glasses, scarves), also
  visible in competitions; preview before buying.
- [ ] **18. Room.** Grid decorating, furniture affects mood, wallpapers, a
  trophy shelf, several rooms (kitchen, bathroom, bedroom, playroom).
- [ ] **19. Daily and weekly quests**, login streak with freeze,
  achievements.
- [ ] **20. Personality.** Traits from care history that shape reactions,
  dialogue (picture speech bubbles) and running style.

## Phase 2: Online and networked competitions

- [ ] **21. Anonymous server account**, tokens, migration of local state.
- [ ] **22. Offline-first sync.** Authoritative server, action queue with
  idempotency keys, conflict resolution. Test "two devices, one pet".
- [ ] **23. Server economy.** Transaction validation, time anti-cheat (test
  with the client clock wound back).
- [ ] **24. Google account linking** (Credential Manager), account deletion.
- [ ] **25. Friends.** Codes/QR, invitations, list, block and report.
- [ ] **26. Visits.** A friend's room, joint stroking/feeding with a bonus
  for both, guest book with stickers.
- [ ] **27. Gifts and preset phrases** (safe communication).
- [ ] **28. Asynchronous competitions.** Race other players' ghosts matched
  by rating (e.g. Glicko-2) and stat division. The server replays the input
  log and confirms the time; mismatching logs are rejected (test). Weekly
  leaderboards per track: friends, country, world.
- [ ] **29. Leagues and cups.** Divisions with weekly promotion/relegation,
  weekend cups, cosmetic-only rewards + a trophy for the room.
- [ ] **30. Live races.** Lobbies of 4-8 pets (friends or matchmaking; after
  10 s ghosts fill the gaps). WebSocket, authoritative server, client
  prediction and reconciliation, smooth at 150 ms latency and 2% packet loss
  (test with simulated network). Emote reactions instead of chat.
- [ ] **31. Replays and spectating.** Watch the record holder's and friends'
  runs, learn from ghosts, share a run clip.
- [ ] **32. Push via FCM** (behind an interface, WorkManager fallback),
  including "a friend beat your record", within the limits of section 2.

## Phase 3: LiveOps and monetization

- [ ] **33. Remote config and feature flags** from the server (with in-app
  defaults).
- [ ] **34. Seasonal event calendar** (server side). First event: a seasonal
  Grand Prix with a temporary track, themed cosmetics and mini-quests.
- [ ] **35. Season pass** (free track + paid track, cosmetics only).
- [ ] **36. Google Play Billing** (latest library), server-side receipt
  validation, purchase restore, parental purchase controls.
- [ ] **37. Rewarded ads** with UMP, child mode, daily cap.
- [ ] **38. Privacy-respecting analytics.** FTUE funnel, retention, economy,
  competition participation. KPI board in `docs/KPI.md`, A/B tests via
  flags.
- [ ] **39. Generations.** An adult pet can become a parent; the offspring
  inherits genes and some competition aptitude; family tree.

## Phase 4: Premium quality and release

- [ ] **40. Baseline Profiles + Macrobenchmark**, budgets from section 4 in
  CI (competitions: steady 60 fps on a mid-range device).
- [ ] **41. Accessibility.** TalkBack audit, color-blind mode, reduced
  motion, large buttons, assisted mode in competitions.
- [ ] **42. Tablets and foldables.** Two-pane layouts.
- [ ] **43. Localization.** First additional languages (DE, ES, PT-BR, PL)
  and date/number formats; the game itself is authored in English.
- [ ] **44. Crash reporting**, privacy policy, Data Safety, Families Policy
  compliance (checklist in docs).
- [ ] **45. Release pipeline.** Signed AAB, Gradle Play Publisher to the
  internal track, versioning, release notes from CHANGELOG.

Next: the gap analysis against BENCHMARK.md picks the following iterations
(protocol 5.2d), e.g. a track editor with moderation, team relays and clubs,
new disciplines (swimming, frisbee), Wear OS, AR "pet in your room".

## 8. TASK NOW

1. Create:
   - `CLAUDE.md`: sections 1-5 above in full (the project constitution loaded
     by every session), plus a short "Commands" section (build, test,
     screenshots, server).
   - `docs/ROADMAP.md` (section 7), `docs/BENCHMARK.md` (section 6),
     `docs/DECISIONS.md` (ADR-001: stack and modules),
     `docs/CHANGELOG.md`, `docs/FEEDBACK.md` (how to report, `[!]` =
     critical), `docs/ASSETS.md`, `docs/PLAY_DATA_SAFETY.md`.
2. Deliver iteration 0 following the iteration protocol (section 5),
   including commit, push and the final report.
````

---

## 2. Komenda `/goal` (uruchamiasz przy każdym kolejnym kroku)

Wariant podstawowy, **jedna iteracja na jedno uruchomienie**. Po każdej
iteracji masz moment, żeby zagrać, wpisać uwagi do `docs/FEEDBACK.md`
i dopiero wtedy ruszyć dalej:

```text
/goal The next iteration chosen by the protocol in CLAUDE.md (section 5, step 2) is delivered and closed: the conversation shows `./gradlew check` and `./gradlew :app:assembleRelease` ending in BUILD SUCCESSFUL (or, without the Android SDK, `./gradlew jvmCheck -Pwot.jvmOnly=true` green plus a green CI run on the pushed commit), the iteration is ticked in docs/ROADMAP.md, and the last message contains the "ITERATION N CLOSED" report with every gate ✅ and the hash of the commit pushed to the current branch.
```

Wariant „cała faza” (dłuższa autonomiczna praca, np. na noc):

```text
/goal Every iteration of PHASE 0 in docs/ROADMAP.md is ticked [x] with a commit hash; each was delivered as its own commit following the protocol in CLAUDE.md; the last "ITERATION N CLOSED" report in the conversation has every gate ✅, CI is green on the last pushed commit, and `git status` shows a clean tree in sync with origin.
```

Wariant „poprawki z playtestu” (gdy w `docs/FEEDBACK.md` są nowe zgłoszenia):

```text
/goal Every unhandled item in docs/FEEDBACK.md is marked as handled with an iteration number, the fixes are pushed, CI is green, and the "ITERATION N CLOSED" report in the conversation has every gate ✅.
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
  sposób, nawet gdy roadmapa się skończy (protokół, krok 5.2d).
- **Twoje uwagi mają pierwszeństwo.** Zgłoszenia `[!]` w `docs/FEEDBACK.md`
  wyprzedzają roadmapę. Prawdziwy playtest jest ważniejszy niż plan.
- **Zawody rozstrzyga serwer, nie telefon.** Gracz wysyła zapis swoich
  ruchów, a serwer odtwarza przejazd tą samą fizyką i sam liczy czas.
  Sfałszowany wynik po prostu się nie zgadza. Ten sam zapis służy za ducha
  dla innych i za powtórkę. Dzięki temu zawody działają też przy małej
  liczbie graczy: zawsze jest z kim się ścigać.
- **Symulacja współdzielona przez aplikację i serwer.** Te same reguły
  liczą stan na telefonie (offline, przewidywanie) i na serwerze
  (autorytet, anty-cheat). Dzięki temu oszukanie zegara nic nie daje,
  a testy reguł pisze się raz.
