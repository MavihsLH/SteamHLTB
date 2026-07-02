<h1 align="center">SteamHLTB — Your Steam Backlog Dashboard with Howlongtobeat data</h1>

<p align="center">
  <img src="https://github.com/user-attachments/assets/d5431033-cc82-47f2-ae50-5bac82ceead3" alt="SteamHLTB Logo" width="220">
</p>

<p align="center">
  (⌐■_■) Clear Your Backlog with Style.
</p>

## (╭ರ_•́) Why build this instead of just using the HowLongToBeat website?
While HowLongToBeat is fantastic, I needed a streamlined interface dedicated specifically to sorting my own Steam library by playtime. More importantly, this dashboard seamlessly integrates and sorts **Steam Family Sharing** games—a feature that isn't natively supported by the standard HowLongToBeat website. 

## (☆ω☆) Features
- **Frutiger Aero & Retro Pixel Themes**: Two stunning visual modes. Toggle between the nostalgic, glassy Y2K Aero look, or slide the coolant capsule to engage a deep-black, copper-accented Retro Pixel aesthetic.
- **Smart Sorting & Filtering**: Filter by Owned/Shared, Played/Unplayed, or Beat It statuses. Sort by playtime, alphabet, or HowLongToBeat lengths (Main, Extra, Completionist).
- **Time Range Filters**: Looking for a quick weekend game? Set a Min and Max hour range to filter your library instantly.
- **Local Caching**: `db.json` locally caches your Steam library and HLTB times so subsequent loads are lightning-fast. Syncs on command!

---

## [ ʘ ʘ ] Screenshots

### Light Mode (Frutiger Aero Inspired) ( ˘▽˘)っ♨
<img width="2560" height="1548" alt="image" src="https://github.com/user-attachments/assets/46375ea3-2905-4f01-96f5-8c45a01fbeb2" />


### Dark Mode (Retro Pixel) [+..••]
<img width="2560" height="1540" alt="image" src="https://github.com/user-attachments/assets/79029363-3710-4ad4-b8fb-cd507af9fc0b" />


### Various Useful Filters (¬‿¬)
<img width="2508" height="1204" alt="image" src="https://github.com/user-attachments/assets/62caf019-9ed7-4e87-b750-529957c4b6bd" />


---

## (ง •̀_•́)ง Installation

### Option A: Standalone Windows Electron App (Recommended) ( ﾟヮﾟ)

You can download and run SteamHLTB instantly as a native standalone desktop application:

1. **Download the Release**: 
   Go to the **Releases** section of this repository and download `SteamHLTB-win32-x64.zip`.
2. **Extract & Launch**: 
   Extract the ZIP archive and run **`SteamHLTB.exe`**.
3. **Easy Visual Configuration**: 
   No manual config files needed! Simply click the **Gear Icon** in the top-right corner on first run to enter your Steam API Key, Steam ID, and any family member IDs directly in the visual settings modal.

---

### Prerequisites (For Options B & C)
You will need your Steam API key and your 17-digit SteamID64:
1. Get your API Key here: [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
2. Get your SteamID64 using a tool like [SteamID.io](https://steamid.io/)

### Configuration (For Options B & C)
1. Clone this repository.
2. In the root directory, create a file named `config.json`.
3. Add your credentials to `config.json` like this:
```json
{
  "STEAM_API_KEY": "YOUR_API_KEY_HERE",
  "STEAM_ID": "YOUR_17_DIGIT_STEAM_ID",
  "FAMILY_STEAM_IDS": ["YOUR FRIEND'S STEAM_ID"]
}
```

---

### Option B: Running with Docker ( 0_0 )

1. Make sure you have Docker and Docker Compose installed.
2. Ensure you have created your `config.json` as shown above. 
3. You also need an empty `db.json` file for the initial mount (the app will write to it):
   ```bash
   touch db.json
   # or on Windows: type nul > db.json
   ```
4. Run the stack in the background:
   ```bash
   docker-compose up -d
   ```
5. Access the dashboard at **http://localhost:3000** (ง •̀_•́)ง

### Option C: Running with Node.js (⌐■_■)

1. Make sure you have [Node.js](https://nodejs.org/) installed (v16 or higher recommended).
2. Install dependencies:
   ```bash
   npm install
   ```
3. Ensure you have created your `config.json` as shown above.
4. Start the server:
   ```bash
   npm start
   ```
5. Access the dashboard at **http://localhost:3000** (ง •̀_•́)ง

---

## (ง'̀-'́)ง Tech Stack
- **Backend**: Node.js, Express, `hltb-api`
- **Frontend**: Vanilla HTML/JS, Modern CSS (No frameworks, just pure custom styling!)

## ( ﾟヮﾟ) Credits
- Playtime data parsed from [HowLongToBeat](https://howlongtobeat.com/).
- Game libraries and family sharing data fetched via the [Steam Web API](https://partner.steamgames.com/doc/webapi_overview) (Valve Corporation).

## ( ﾟヮﾟ) License
Proprietary License (All Rights Reserved). See the [LICENSE](LICENSE) file for more details.
