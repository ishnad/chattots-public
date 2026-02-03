import fetch from 'node-fetch';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

export async function searchYouTubeVideos(ageRange, genre, maxResults = 10, pageToken = null) {
  try {
    let query = `${genre || ''} kids videos`;
    if (ageRange) {
      query += ` for kids age ${ageRange}`; // Update query based on age range
    }

    let url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=${YOUTUBE_API_KEY}&maxResults=${maxResults}&type=video&safeSearch=strict`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    console.log(`YouTube API Search URL: ${url}`);

    const searchResponse = await fetch(url);
    const searchData = await searchResponse.json();

    if (searchData.error) {
      console.error('YouTube API search error:', searchData.error);
      return { videos: [], nextPageToken: null };
    }

    if (!searchData.items || searchData.items.length === 0) {
      console.log('No items found in YouTube search data.');
      return { videos: [], nextPageToken: searchData.nextPageToken || null };
    }

    const nextPageTokenFromSearch = searchData.nextPageToken || null;

    // Extract video IDs from search results
    const videoIds = searchData.items.map(item => item.id.videoId).join(',');

    // Fetch video details to check embeddability and restrictions
    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails&id=${videoIds}&key=${YOUTUBE_API_KEY}`;
    const detailsResponse = await fetch(detailsUrl);
    const detailsData = await detailsResponse.json();

    if (detailsData.error) {
      console.error('YouTube API video details error:', detailsData.error);
      // Return search results without embeddability filtering if details fetch fails, but with nextPageToken
      const videos = searchData.items.map(item => ({
        id: item.id.videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails.default.url,
        channelTitle: item.snippet.channelTitle,
      }));
      return { videos: videos, nextPageToken: nextPageTokenFromSearch };
    }

    // Create a map of video details by ID for easy lookup
    const videoDetailsMap = new Map();
    if (detailsData.items) {
        detailsData.items.forEach(item => videoDetailsMap.set(item.id, item));
    }


    // Filter the original search results based on video details
    const watchableVideos = searchData.items.filter(item => {
      const details = videoDetailsMap.get(item.id.videoId);
      // Check if details exist, video is processed, is embeddable, and has no region restrictions
      return details &&
             details.status &&
             details.status.uploadStatus === 'processed' &&
             details.status.embeddable &&
             !details.contentDetails?.regionRestriction; // Exclude if regionRestriction object exists
    });

    const videos = watchableVideos.map(item => ({
      id: item.id.videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: item.snippet.thumbnails.default.url, // Standardized to thumbnailUrl
      channelTitle: item.snippet.channelTitle, // Ensure channelTitle is included
    }));

    return { videos: videos, nextPageToken: nextPageTokenFromSearch };

  } catch (error) {
    console.error('Error searching YouTube API:', error);
    return { videos: [], nextPageToken: null };
  }
}