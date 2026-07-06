const fs = require('fs');
const path = require('path');
const readline = require('readline');

const csvFilePath = path.join(__dirname, '..', 'debug', 'all-games-processed.csv', 'all-games-processed.csv');
const outputJsonPath = path.join(__dirname, '..', 'static', 'js', 'preloaded_hltb.json');

function cleanGameTitleForSearch(title) {
  if (!title) return '';
  let cleaned = title.toLowerCase().trim();
  const hasAscii = /[a-z0-9]/.test(cleaned);
  const hasNonAscii = /[^\x00-\x7F]/.test(cleaned);
  if (hasAscii && hasNonAscii) {
    cleaned = cleaned.replace(/[^\x00-\x7F]/g, ' ');
  }
  cleaned = cleaned.replace(/[™®©\-–—/\\_.,]/g, ' ');
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  if (cleaned.includes(':')) {
    cleaned = cleaned.split(':')[0];
  }
  cleaned = cleaned.replace(/([a-z])([0-9])/g, '$1 $2');
  cleaned = cleaned.replace(/([0-9])([a-z])/g, '$1 $2');
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned.trim();
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // Toggle quote state
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function extractYear(releaseStr) {
  if (!releaseStr) return null;
  const parts = releaseStr.split('-');
  const lastPart = parts[parts.length - 1].trim();
  if (lastPart.length === 4 && !isNaN(lastPart)) {
    return parseInt(lastPart);
  }
  if (lastPart.length === 2 && !isNaN(lastPart)) {
    const val = parseInt(lastPart);
    return val >= 50 ? 1900 + val : 2000 + val;
  }
  // Try extracting any 4-digit number
  const match = releaseStr.match(/\b(19\d\d|20\d\d)\b/);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

async function convert() {
  console.log(`Reading CSV file from: ${csvFilePath}...`);
  if (!fs.existsSync(csvFilePath)) {
    console.error(`Error: File does not exist at ${csvFilePath}`);
    return;
  }

  const fileStream = fs.createReadStream(csvFilePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const dataset = {};
  let lineCount = 0;
  let successCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) continue; // Skip header row

    const cols = parseCsvLine(line);
    if (cols.length < 5) continue;

    const id = cols[0];
    const title = cols[1];
    if (!title) continue;

    const mainStory = cols[2] ? parseFloat(cols[2]) : 0;
    const mainPlusExtras = cols[3] ? parseFloat(cols[3]) : 0;
    const completionist = cols[4] ? parseFloat(cols[4]) : 0;

    const developers = cols[9] || '';
    const publishers = cols[10] || '';
    const platforms = cols[11] || '';
    const genres = cols[12] || '';

    // Prioritize NA release year, then EU, then JP
    let releaseYear = extractYear(cols[13]);
    if (!releaseYear) releaseYear = extractYear(cols[14]);
    if (!releaseYear) releaseYear = extractYear(cols[15]);

    const key = cleanGameTitleForSearch(title);
    if (!key) continue;

    const mainStoryHrs = isNaN(mainStory) ? 0 : Math.round(mainStory);
    const mainPlusExtrasHrs = isNaN(mainPlusExtras) ? 0 : Math.round(mainPlusExtras);
    const completionistHrs = isNaN(completionist) ? 0 : Math.round(completionist);

    const gameProfile = {
      hltbId: id,
      title: title,
      gameplayMain: mainStoryHrs,
      gameplayMainExtra: mainPlusExtrasHrs,
      gameplayCompletionist: completionistHrs,
      developers: developers,
      publishers: publishers,
      genres: genres,
      platforms: platforms,
      releaseYear: releaseYear || null
    };

    const existing = dataset[key];
    if (existing) {
      // Duplicate key resolution: prioritize entries with actual playtimes and genres
      const existingWeight = (existing.gameplayMain ? 3 : 0) + (existing.genres ? 1 : 0);
      const newWeight = (mainStoryHrs ? 3 : 0) + (genres ? 1 : 0);
      if (newWeight > existingWeight) {
        dataset[key] = gameProfile;
      }
    } else {
      dataset[key] = gameProfile;
      successCount++;
    }
  }

  console.log(`Processed ${lineCount} rows from CSV.`);
  console.log(`Generated ${successCount} unique game profiles.`);
  
  console.log(`Writing minified JSON to: ${outputJsonPath}...`);
  fs.writeFileSync(outputJsonPath, JSON.stringify(dataset));
  console.log('Successfully completed CSV ➔ JSON conversion!');
}

convert();
