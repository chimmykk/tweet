import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const config = {
    apiKey: "",
    maxPages: 100, // Or adjust as needed for historical data
    storageFolder: {
      csv: 'historicaldata',
      json: 'historicaldata_json_temp' // A temporary folder if JSON is still needed internally, though we'll only save CSV
    },
    users: [
      {
        username: "rilso_y",
        lastTimestampScrape: null // We'll calculate this dynamically for historical
      }
    ]
  };

  const baseStoragePath = path.join(__dirname, config.storageFolder.csv);

  // Helper Functions (re-defined within main or as nested functions)
  const ensureDirectories = async () => {
    try {
      await fs.mkdir(baseStoragePath, { recursive: true });
    } catch (_) {
      // Directory likely exists, ignore error
    }
    // Also ensure the temporary JSON folder if it's used internally
    try {
      await fs.mkdir(path.join(__dirname, config.storageFolder.json), { recursive: true });
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
          'X-API-Key': config.apiKey
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
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
        return;
    }

    await saveToCsv(filepath, tweetsToSave);
  };

  const scrapeUser = async (userConfig) => {
    const { username } = userConfig;
    console.log(`\nScraping historical tweets for: ${username}`);

    // Calculate 'since' timestamp for one year ago from current date
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const sinceTimestamp = formatTimestamp(oneYearAgo);
    console.log(`Scraping tweets since: ${parseTimestamp(sinceTimestamp)}`);

    let allTweets = [];
    let cursor = null;
    let pageCount = 0;

    try {
      while (pageCount < config.maxPages) {
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
        await saveData(username, allTweets); // Save directly to CSV with filtering
        console.log(`Saved ${allTweets.filter(tweet => !tweet.isReply).length} non-reply tweets for ${username} to ${username}.csv`);
      } else {
        console.log(`No historical tweets found for ${username} since the specified date.`);
      }

    } catch (err) {
      console.error(`Failed to scrape ${username}:`, err);
    }
  };

  // Main scraping logic
  await ensureDirectories();

  for (const user of config.users) {
    await scrapeUser(user);
  }

  console.log('✅ Historical scraping complete.');
}

// Run the main function
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
