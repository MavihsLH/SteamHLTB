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
<img width="2534" height="1422" alt="image" src="https://github.com/user-attachments/assets/2f2f79a8-32c2-4f28-934b-4cc6b985ce99" />


### Dark Mode (Retro Pixel) [+..••]
<img width="2560" height="1416" alt="image" src="https://github.com/user-attachments/assets/08a7a0d8-94ed-4507-b170-f3b4b72a7121" />



### Various Useful Filters (¬‿¬)
<img width="2436" height="582" alt="image" src="https://github.com/user-attachments/assets/d4ac4151-dd7e-4305-9c2d-550885e45f77" />


---

## (ง •̀_•́)ง Installation

### Prerequisites
You will need your Steam API key and your 17-digit SteamID64.
1. Get your API Key here: [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
2. Get your SteamID64 using a tool like [SteamID.io](https://steamid.io/)

### Configuration
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

### Option A: Running with Docker (Recommended) ( 0_0 )

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

### Option B: Running with Node.js (⌐■_■)

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

### Option C: Standalone Windows Electron App ( ﾟヮﾟ)

You can download and run SteamHLTB as a native standalone desktop application:

1. **Download the Release**: 
   Go to the **Releases** section of this repository and download `SteamHLTB-win32-x64.zip`.
2. **Extract & Launch**: 
   Extract the ZIP archive and run **`SteamHLTB.exe`**.
3. **Easy Visual Configuration**: 
   You no longer need to create or edit `config.json` manually! Simply click the **Gear Icon** in the top-right corner on first run to enter your Steam API Key, Steam ID, and any family member IDs directly in the visual settings modal.

---

## (ง'̀-'́)ง Tech Stack
- **Backend**: Node.js, Express, `hltb-api`
- **Frontend**: Vanilla HTML/JS, Modern CSS (No frameworks, just pure custom styling!)

## ( ﾟヮﾟ) Credits
- Playtime data parsed from [HowLongToBeat](https://howlongtobeat.com/).
- Game libraries and family sharing data fetched via the [Steam Web API](https://partner.steamgames.com/doc/webapi_overview) (Valve Corporation).

## ( ﾟヮﾟ) License
MIT License. Feel free to fork and build upon this!
