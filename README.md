# SteamHLTB (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧

A beautiful, dual-theme local web dashboard that connects to your Steam library and merges it with completion time data from HowLongToBeat. Filter, sort, and organize your backlog in style!

---

## ✧･ﾟ: *✧･ﾟ:* Features *:･ﾟ✧*:･ﾟ✧

* **Steam Library Sync**: Fetches your owned and shared games directly using the Steam Web API.
* **HowLongToBeat Integration**: Automatically estimates playtime for Main Story, Main + Extra, and Completionist runs.
* **Smart Filtering & Sorting**: Filter by played/unplayed, ownership status, completion status, or specific Time-to-Beat ranges!
* **Dual Themes**:
  * **Y2K Frutiger Aero (Light Mode)**: Glossy, bubbly, and vibrant with glassmorphism.
  * **Retro Pixel (Dark Mode)**: Deep black, copper accents, dot-matrix overlays, and classic pixel typography (`DotGothic16`).

---

## (⌐■_■) Previews

### Light Mode (Y2K Aero)
![Light Mode Preview](./docs/light-mode.png)

### Dark Mode (Retro Pixel)
![Dark Mode Preview](./docs/dark-mode.png)

### Filters & Sorting
![Filters Preview](./docs/filters.png)

---

## (ง ͠° ͟ل͜ ͡°)ง Setup & Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/MavihsLH/SteamHLTB.git
   cd SteamHLTB
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your API Keys:
   Create a `config.json` in the root directory:
   ```json
   {
     "STEAM_API_KEY": "YOUR_STEAM_API_KEY",
     "STEAM_ID": "YOUR_STEAM_ID"
   }
   ```
   *Get your Steam API key from [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)*.

4. Run the server:
   ```bash
   npm start
   ```

5. Open your browser and go to `http://localhost:3000`.

---

## ʕ•ᴥ•ʔ Tech Stack
* **Frontend**: Vanilla HTML/CSS/JS (No frameworks, pure styling).
* **Backend**: Node.js + Express.
* **APIs**: Steam Web API, `howlongtobeat` npm package.

---

*(Note: Image placeholders in the Previews section are ready to be replaced with actual screenshots!)*
