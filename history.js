import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors'; // Import cors for cross-origin requests

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 4000; // Keep the port as 3000 for consistency with the HTML file's API_BASE_URL

// Middleware to parse JSON bodies and enable CORS
app.use(express.json());
app.use(cors()); // Enable CORS for all routes

// --- Configuration (Hardcoded for the server) ---
const scraperConfig = {
  apiKey: "", // Your hardcoded API key
  maxPages: 100, // Or adjust as needed for historical data
  storageFolder: {
    csv: 'historicaldata',
    json: 'historicaldata_json_temp' // A temporary folder if JSON is still needed internally
  }
};

const baseStoragePath = path.join(__dirname, scraperConfig.storageFolder.csv);

// --- Helper Functions (adapted from previous main function) ---

const ensureDirectories = async () => {
  try {
    await fs.mkdir(baseStoragePath, { recursive: true });
  } catch (_) {
    // Directory likely exists, ignore error
  }
  // Also ensure the temporary JSON folder if it's used internally
  try {
    await fs.mkdir(path.join(__dirname, scraperConfig.storageFolder.json), { recursive: true });
  } catch (_) {}
};

const formatTimestamp = (date) => {
  return date.toISOString().replace(/:/g, '%3A').replace(/\./g, '_');
};

const parseTimestamp = (timestampStr) => {
  return timestampStr.replace(/%3A/g, ':').replace(/_/g, '.');
};

const fetchTweets = async (username, sinceTimestamp, cursor = null) => {
  const baseUrl = 'https://api.twitterapi.io/twitter/tweet/advanced_search';
  const queryParams = new URLSearchParams({
    queryType: 'Latest',
    query: `from:${username} since:${sinceTimestamp}`
  });

  if (cursor) {
    queryParams.append('cursor', cursor);
  }

  const url = `${baseUrl}?${queryParams.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-Key': scraperConfig.apiKey
      }
    });
    if (!response.ok) {
      // Attempt to read error message from response if available
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching tweets for ${username}:`, error);
    throw error;
  }
};

const saveToCsv = async (filepath, tweets) => {
  const headers = [
    'id', 'url', 'text', 'source', 'retweetCount', 'replyCount', 'likeCount',
    'quoteCount', 'viewCount', 'createdAt', 'lang', 'bookmarkCount',
    'inReplyToId', 'conversationId', 'authorUserName', 'authorName',
    'authorFollowers', 'authorFollowing', 'authorDescription'
  ];

  let fileExists = false;
  try {
    await fs.access(filepath);
    fileExists = true;
  } catch (_) {}

  let csv = '';
  if (!fileExists) {
    csv += headers.join(',') + '\n';
  }

  for (const tweet of tweets) {
    const row = [
      `"${tweet.id || ''}"`,
      `"${tweet.url || ''}"`,
      `"${(tweet.text || '').replace(/"/g, '""')}"`,
      `"${tweet.source || ''}"`,
      tweet.retweetCount || 0,
      tweet.replyCount || 0,
      tweet.likeCount || 0,
      tweet.quoteCount || 0,
      tweet.viewCount || 0,
      `"${tweet.createdAt || ''}"`,
      `"${tweet.lang || ''}"`,
      tweet.bookmarkCount || 0,
      `"${tweet.inReplyToId || ''}"`,
      `"${tweet.conversationId || ''}"`,
      `"${tweet.author?.userName || ''}"`,
      `"${tweet.author?.name || ''}"`,
      tweet.author?.followers || 0,
      tweet.author?.following || 0,
      `"${(tweet.author?.description || '').replace(/"/g, '""')}"`
    ];
    csv += row.join(',') + '\n';
  }

  await fs.appendFile(filepath, csv);
};

// Modified to only support CSV directly and filter replies
const saveData = async (username, tweets) => {
  const folder = baseStoragePath;
  const filepath = path.join(folder, `${username}.csv`);

  // Filter out replies before saving
  const tweetsToSave = tweets.filter(tweet => !tweet.isReply);

  if (tweetsToSave.length === 0) {
      console.log(`No non-reply tweets to save for ${username}.`);
      return { success: true, message: `No new non-reply tweets found for ${username}.`, filename: `${username}.csv` };
  }

  await saveToCsv(filepath, tweetsToSave);
  return { success: true, message: `Saved ${tweetsToSave.length} non-reply tweets for ${username}.`, filename: `${username}.csv` };
};

// --- Scrape Function callable by API ---
const performScraping = async (username) => {
  console.log(`\nInitiating historical scraping for: ${username}`);

  // Calculate 'since' timestamp for one year ago from current date
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const sinceTimestamp = formatTimestamp(oneYearAgo);
  console.log(`Scraping tweets since: ${parseTimestamp(sinceTimestamp)}`);

  let allTweets = [];
  let cursor = null;
  let pageCount = 0;
  let totalScrapedCount = 0;

  try {
    await ensureDirectories(); // Ensure directories are ready before starting

    while (pageCount < scraperConfig.maxPages) {
      console.log(`Fetching page ${pageCount + 1}...`);
      const response = await fetchTweets(username, sinceTimestamp, cursor);

      if (!response.tweets || response.tweets.length === 0) {
          console.log('No more tweets or pages to fetch.');
          break;
      }

      allTweets.push(...response.tweets);
      console.log(`Fetched ${response.tweets.length} tweets on this page. Total so far: ${allTweets.length}`);


      if (!response.has_next_page || !response.next_cursor) {
          console.log('No next page or cursor available.');
          break;
      }

      cursor = response.next_cursor;
      pageCount++;
      await new Promise(res => setTimeout(res, 1000)); // Delay to avoid rate limits
    }

    if (allTweets.length > 0) {
      const result = await saveData(username, allTweets);
      totalScrapedCount = allTweets.filter(tweet => !tweet.isReply).length;
      console.log(`Historical scraping complete for ${username}. Total non-reply tweets saved: ${totalScrapedCount}`);
      return { success: true, message: `Scraped and saved ${totalScrapedCount} non-reply tweets for ${username}.`, filename: result.filename, scrapedCount: totalScrapedCount };
    } else {
      console.log(`No historical tweets found for ${username} since the specified date.`);
      return { success: true, message: `No historical tweets found for ${username} since the specified date.`, filename: `${username}.csv`, scrapedCount: 0 };
    }

  } catch (err) {
    console.error(`Failed to scrape ${username}:`, err);
    return { success: false, message: `Failed to scrape ${username}: ${err.message}` };
  }
};


// --- API Endpoints ---

// Endpoint to trigger scraping
app.post('/api/scrape', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required.' });
  }

  console.log(`API request received to scrape: ${username}`);
  const result = await performScraping(username);

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(500).json(result);
  }
});

// Endpoint to download the CSV file
app.get('/api/download/:username', (req, res) => {
  const { username } = req.params;
  const filePath = path.join(baseStoragePath, `${username}.csv`);

  fs.access(filePath, fs.constants.F_OK)
    .then(() => {
      res.download(filePath, `${username}_historical_tweets.csv`, (err) => {
        if (err) {
          console.error(`Error sending file ${filePath}:`, err);
          res.status(500).json({ success: false, message: 'Could not download file.' });
        } else {
          console.log(`File ${filePath} sent successfully.`);
        }
      });
    })
    .catch(() => {
      res.status(404).json({ success: false, message: 'File not found. Please scrape first.' });
    });
});

// NEW ENDPOINT: To list all CSV files in the historicaldata folder
app.get('/api/files', async (req, res) => {
  try {
    await ensureDirectories(); // Ensure the directory exists before trying to read it
    const files = await fs.readdir(baseStoragePath);
    const csvFiles = files.filter(file => file.endsWith('.csv'));
    res.status(200).json({ success: true, files: csvFiles });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ success: false, message: 'Failed to list files.', error: error.message });
  }
});


// Serve the HTML file statically (optional, but convenient for development)
app.use(express.static(__dirname));

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`Open historicaldata.html in your browser: http://localhost:${PORT}/historicaldata.html`);
});
