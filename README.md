# SteamHLTB 🎮 ⏱️ (⌐■_■)

A beautiful, self-hosted web dashboard that fetches your entire Steam library and seamlessly syncs it with **HowLongToBeat** data. Know exactly how long it takes to clear your backlog with style! 

![SteamHLTB Hero](hero_image_placeholder.png)

## ✨ Features
- **Frutiger Aero & Retro Pixel Themes**: Two stunning visual modes. Toggle between the nostalgic, glassy Y2K Aero look, or slide the coolant capsule to engage a deep-black, copper-accented Retro Pixel aesthetic.
- **Smart Sorting & Filtering**: Filter by Owned/Shared, Played/Unplayed, or Beat It statuses. Sort by playtime, alphabet, or HowLongToBeat lengths (Main, Extra, Completionist).
- **Time Range Filters**: Looking for a quick weekend game? Set a Min and Max hour range to filter your library instantly.
- **Local Caching**: `db.json` locally caches your Steam library and HLTB times so subsequent loads are lightning-fast. Syncs on command!

---

## 📸 Screenshots

### Light Mode (Y2K Aero) 💧
![Light Mode Overview](light_mode_overview_placeholder.png)

### Dark Mode (Retro Pixel) 🕹️
![Dark Mode Overview](dark_mode_overview_placeholder.png)

### Time Range Filters ⏳
![Filters Showcase](filters_showcase_placeholder.png)

---

## 🚀 Installation

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
  "STEAM_ID": "YOUR_17_DIGIT_STEAM_ID"
}
```

---

### Option A: Running with Docker (Recommended) 🐳

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
5. Access the dashboard at **http://localhost:3000** 🚀

### Option B: Running with Node.js 🟩

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
5. Access the dashboard at **http://localhost:3000** 🚀

---

## 🛠️ Tech Stack
- **Backend**: Node.js, Express, `hltb-api`
- **Frontend**: Vanilla HTML/JS, Modern CSS (No frameworks, just pure custom styling!)

## 📝 License
MIT License. Feel free to fork and build upon this!
