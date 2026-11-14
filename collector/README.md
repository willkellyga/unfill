# Playtest collector

Every level a tester finishes in Unfill is sent here automatically and lands as one row in a Google Sheet. The game
side is `src/app/game/playtest.ts`; this folder is the receiving end, a Google Apps Script web app (free, runs in
Will's Google account, no server to look after).

## Set it up (about 5 minutes, once)

1. Open **[sheets.new](https://sheets.new)** while signed in to Google, and name the sheet "Unfill playtest".
2. In the sheet, choose **Extensions › Apps Script**. Delete the code that's there, paste in all of
   [`Code.gs`](Code.gs), and click **Save** (the disk icon).
3. Click **Deploy › New deployment**. Next to "Select type", click the gear and choose **Web app**. Set
   **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**.
4. Click **Authorize access** and pick your account. Google says it "hasn't verified this app" because it's your own
   script: click **Advanced › Go to Untitled project (unsafe)**, then **Allow**.
5. Copy the **Web app URL** (it ends in `/exec`) and send it to Claude. It goes in `COLLECTOR_URL` in
   `src/app/game/playtest.ts`, and the game starts sending once that's merged and Pages redeploys.

To check it, open the URL in a browser: it should say "Unfill playtest collector is running."

If `Code.gs` changes later, paste the new code, then **Deploy › Manage deployments ›** pencil icon **› Version: New
version › Deploy**. That keeps the same URL, so the game doesn't need changing.

## What arrives

The script adds a **Plays** tab: one row per finished level (`type` = `level`) and one each time someone starts
playing (`type` = `open`). The columns:

| column | meaning |
| --- | --- |
| `received` | when the Sheet got it |
| `name`, `device` | the tester's name from Settings (or a `?tester=Name` link) and a random id for the phone |
| `app` | the build (git commit) that played it |
| `run`, `n` | the run (same number for every level of one run) and the level number |
| `board`, `role`, `tier`, `cols`, `rows`, `colors` | which library board, and its slot in the sawtooth |
| `solverPar`, `par`, `grant` | the solver's par, the par shown, and the moves the level poured in |
| `movesStart`, `movesLeft`, `lifts` | moves at the start and end of the level, and lifts made |
| `outcome` | `clear`, `out` (ran out of moves: the run ended) or `quit` (started a new run from Settings) |
| `points`, `score` | points for the board, and the run's score after it |
| `startedAt`, `endedAt`, `activeSec` | times (ms since 1970) and playing seconds, pauses over a minute left out |
| `think`, `pour` | per lift, ms spent looking before the tap and ms the pour took (the last lift has no pour) |
| `taps`, `mirror`, `perm` | the cells tapped, and the board's mirror and color swap, so a level can be replayed exactly |
| `resumes` | times the level was picked up again after the app was closed |
| `installed`, `ios`, `screen` | home-screen app or browser, iPhone or not, screen size |

Anything it can't read goes to an **Errors** tab, whole, so nothing is lost.

## Read it

Download the Plays tab (**File › Download › Comma-separated values**) and run

    npm run tuning:playtest -- ~/Downloads/plays.csv

for each tester's runs, minutes per run, par results, seconds per lift and closest bot (see
`gen/tuning/playtest.ts`). Claude can also read the Sheet directly through the Google Sheets connector.

## Notes

- Offline play is kept on the phone (up to 500 rows) and sent when it's back online, when the app opens, and after
  each level. A row sent twice is written once.
- Test links (`?tray=`, `?nosave`) and scripted browsers send nothing. `npm run playtest-check` tests the whole path
  against `scripts/collector-fake.cjs`, which runs this `Code.gs` against an in-memory Sheet.
- The URL is in the public repo, so anyone who finds it could add rows. For a family playtest that's fine; rows
  from unknown phones are easy to spot and delete.
- Settings tells testers that their play is sent, and moving progress between Safari and the home-screen app keeps
  the same id and name, so one person shows up once.
