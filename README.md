# The Lost Temple of Solara: Co-op 3D Escape Adventure

A first-person 3D escape adventure for 1–6 players. One player starts an expedition and
shares the 5-letter join code. Friends join from a computer, phone or tablet.

- Pick a name, outfit colour and headgear before you play
- 3 chambers: Entrance Hall → Crystal Cavern → Celestial Vault → Daylight
- Synthesized music and sound effects; glow, particles, torches and sunbeams
- Chat, emotes (👋 🎉 🤔), jumping, a journal that saves clues, and a hint button
- About 15–25 minutes per game

## How to deploy (free, step by step)

You need a free **GitHub** account and a free **Render** account. Use a computer if you can.

### Part 1: Put the code on GitHub
1. Unzip `escape-room.zip` on your computer. You get a folder called `escape-room`.
2. Go to https://github.com and sign up or log in.
3. Click the **+** at the top right → **New repository**.
4. Name it `temple-escape`, keep it **Public**, and click **Create repository**.
5. On the new page, click the link **"uploading an existing file"**.
6. Open the `escape-room` folder. Select **everything inside it** (`public` folder, `server.js`,
   `package.json`, `package-lock.json`, `README.md`) and drag it all into the GitHub page.
   Do not drag the outer `escape-room` folder itself, or Render won't find the files.
7. Wait for the upload to finish, then click **Commit changes**.
8. Check: the repository's main page should list `public`, `server.js` and `package.json`.

### Part 2: Put it online with Render
1. Go to https://render.com and click **Get Started**. Sign up with your GitHub account (easiest).
2. In the Render dashboard, click **+ New** → **Web Service**.
3. Choose **Git Provider → GitHub**, allow access, and select your `temple-escape` repo.
4. Fill in the settings:
   - **Name:** temple-escape (this becomes part of your link)
   - **Language / Runtime:** Node
   - **Branch:** main
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Deploy Web Service**. Wait 2–5 minutes until the log says **"Your service is live"**.
6. Your game link is at the top of the page, like `https://temple-escape.onrender.com`.
   Send it to your friends.

### Running a school event (teacher mode, like Kahoot), one device per team
1. On the projector computer, the teacher opens the game link and clicks **👩‍🏫 Host a school event**.
2. The big screen shows the website, a **6-digit PIN** and a **QR code**.
3. Each team opens the link on **one device** (or scans the QR code), types its **team name**, picks an
   avatar and presses **Join event**. Teams pop up live on the big screen.
4. The teacher clicks **🚀 Start the adventure for everyone**. Every team starts at the same moment.
5. The big screen becomes a **live leaderboard** with each team's progress, hints used and finish time.
6. When teams escape, the big screen announces them. Click **🏆 Show podium** for the winners.
7. Next class: **End event**, then **Host a school event** again for a new PIN.
   Many classes can run at the same time, each with its own PIN.

Teacher controls: **Lock joining**, **Chat** on/off, remove a team (✕), **Play again**, **End event**.
If the teacher's page refreshes, click **↩ Resume hosting event** on the home page.
If a team's wifi drops, the device reconnects to the same team automatically.

### Private games (friends at home)
Click **⛺ Private expedition with friends** to get a 5-letter code and play with up to 6 friends without a teacher.

### Good to know
- **Free plan is enough:** 20 classes × 5 team devices (100 devices) all playing at once used about 4% of one CPU core in testing.
- **Safety net for big events:** create a second Render web service from the same GitHub repo (a second link).
  Give half the classes link A and half link B, so one server restart can't affect every class.
- Do a test run on the school wifi beforehand with a few phones or laptops. Chrome works best. If a student's
  connection drops, the game reconnects them to their team automatically.
- On Render's free plan, the server sleeps after 15 minutes with no players. The first visit then
  takes about 30–60 seconds to wake up. Open the link a minute before you play.
- **Netlify, Vercel and GitHub Pages will not work.** The game needs an always-on server for the join codes.
- To update the game later, upload the changed files to GitHub. Render redeploys automatically.

## Run it on your own computer (optional)
Install Node.js 18+ from https://nodejs.org, then in the folder run `npm install` and `npm start`,
and open http://localhost:3000.

## Controls
- **Computer:** click the screen, then WASD move, mouse look, `E` interact, `Space` jump, `Shift` run,
  `T`/`Enter` chat, `J` journal, `H` hint, `1` `2` `3` emotes, `Esc` pause
- **Phone/tablet:** left side = move, right side = look, **USE** to interact, ⤒ to jump

## Answers (spoilers!)
<details><summary>Click to reveal</summary>

1. Gems: red → blue → yellow → green (opens the chest)
2. Stone door: count the carvings: 3 birds, 1 snake, 4 monkeys, 2 jaguars → `3142`
3. Mirrors: steer the sunbeam back-left → front-left → front-right → back-right → crystal
4. Two players stand on the sun and moon stones together (solo: one stone is enough)
5. Sun Door password: planets in order from the Sun → Mercury Q, Venus U, Earth E, Mars S, Jupiter T → `QUEST`
6. Everyone walks out into the daylight together.

To change answers, edit `ANSWERS` in `server.js` and the matching clues in `public/game.js`.
</details>
