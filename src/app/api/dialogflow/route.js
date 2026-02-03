import { SessionsClient, EntityTypesClient } from '@google-cloud/dialogflow'; // Import EntityTypesClient
import { v4 as uuidv4 } from 'uuid';
import { NextResponse } from 'next/server';
import { searchBooks } from '@/utils/googleBooksApi'; // Corrected path
import { searchYouTubeVideos } from '@/utils/youtubeApi'; // Corrected path
import { searchK12Books } from '@/utils/openLibraryApi'; // Corrected path
import { searchNLBBooks } from '@/utils/nationalLibraryBoardApi'; // Corrected path
import {
  generatellmResponse,
  createInitialBookPrompt,
  createInitialVideoPrompt,
  createMoreBooksPrompt,
  createMoreVideosPrompt
} from '@/utils/llmProvider'; // Corrected path and added new functions
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK only once using your specific method
if (!admin.apps.length) {
  try {
    const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !firebasePrivateKey) {
      throw new Error('Missing Firebase Admin credentials in environment variables');
    }
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: firebasePrivateKey,
      })
    });
    console.log('Firebase Admin SDK Initialized');
  } catch (initError) {
    console.error('Firebase Admin SDK Initialization Error:', initError);
    // Consider how to handle this error - maybe return a 500 response earlier
  }
}

const dbAdmin = admin.firestore(); // Get Firestore instance from Admin SDK

// --- Initialize Dialogflow Entity Client ---
let entityTypesClient;
try {
     if (
      !process.env.DIALOGFLOW_CREDENTIALS ||
      !process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID
    ) {
      // Error logged later if needed, allow execution to continue for session client
      console.warn('Missing Dialogflow credentials or project ID for Entity Client');
      entityTypesClient = null;
    } else {
        const entityCredentials = JSON.parse(process.env.DIALOGFLOW_CREDENTIALS);
        entityTypesClient = new EntityTypesClient({ credentials: entityCredentials });
        console.log("Dialogflow EntityTypesClient Initialized for route.js");
    }
} catch (error) {
    console.error("Failed to initialize Dialogflow EntityTypesClient in route.js:", error);
    entityTypesClient = null;
}
// --- End Entity Client Init ---

// --- Cache for Dialogflow Genres ---
let cachedGenres = [];
let lastGenreFetchTimestamp = 0;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// Wrapper function to get genres, using cache
async function getDialogflowGenreSuggestions() {
    const now = Date.now();
    if (now - lastGenreFetchTimestamp < CACHE_DURATION_MS && cachedGenres.length > 0) {
        console.log("Returning cached Dialogflow genres.");
        return cachedGenres;
    }

    console.log("Cache expired or empty. Fetching Dialogflow genres...");
    const fetchedGenres = await fetchDialogflowGenres(entityTypesClient, process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID);

    if (fetchedGenres.length > 0) {
        console.log(`Successfully fetched ${fetchedGenres.length} genres. Updating cache.`);
        cachedGenres = fetchedGenres;
        lastGenreFetchTimestamp = now;
    } else {
        console.warn("Failed to fetch genres from Dialogflow or none found. Cache not updated.");
        // Optionally, decide if you want to return the potentially stale cache here
        // or just the empty array returned by fetchDialogflowGenres
    }
    return fetchedGenres; // Return the newly fetched (or empty) list
}
// --- End Cache ---

// --- Cache for Firestore Genres ---
let cachedFirestoreGenres = [];
let lastFirestoreGenreFetchTimestamp = 0;
// Shorter cache for Firestore as it might be updated more often via admin panel
const FIRESTORE_CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

async function getFirestoreGenres(contentType = 'book') {
    const now = Date.now();
    const cacheKey = contentType === 'book' ? 'cachedBookGenres' : 'cachedcontentGenres';
    const lastFetchKey = contentType === 'book' ? 'lastBookGenreFetchTimestamp' : 'lastVideoGenreFetchTimestamp';
    
    if (now - global[lastFetchKey] < FIRESTORE_CACHE_DURATION_MS && global[cacheKey]?.length > 0) {
        console.log(`Returning cached ${contentType} genres.`);
        return global[cacheKey];
    }

    console.log(`Firestore ${contentType} genre cache expired or empty. Fetching from Firestore...`);
    try {
        const collectionName = contentType === 'book' ? 'bookGenres' : 'contentGenres';
        const snapshot = await dbAdmin.collection(collectionName).select('value').get();
        const genresData = snapshot.docs
            .map(doc => doc.data().value)
            .filter(value => typeof value === 'string' && value.trim() !== '');

        if (genresData.length > 0) {
            console.log(`Successfully fetched ${genresData.length} ${contentType} genres. Updating cache.`);
            global[cacheKey] = genresData;
            global[lastFetchKey] = now;
        } else {
            console.warn(`No genres found in Firestore '${collectionName}' collection. Cache not updated.`);
            global[cacheKey] = [];
        }
        return global[cacheKey];
    } catch (error) {
        console.error(`Error fetching ${contentType} genres:`, error);
        global[cacheKey] = [];
        return [];
    }
}
// --- End Firestore Genre Cache ---


const MAX_FINAL_RECOMMENDATIONS = 4; // Define max books/videos to show at once

// Fisher-Yates (aka Knuth) Shuffle function
function shuffleArray(array) {
  let currentIndex = array.length, randomIndex;
  // While there remain elements to shuffle.
  while (currentIndex !== 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }
  return array;
}

// Helper function to sanitize genre string for Firestore document ID
function sanitizeGenreForDocId(genreString) {
  if (!genreString || typeof genreString !== 'string' || genreString.trim() === "") return 'default_genre_key';
  // Replace invalid characters with underscores, limit length, ensure it's not empty
  const sanitized = genreString.toLowerCase().replace(/[^a-z0-9_,-]/g, '_').replace(/_{2,}/g, '_').substring(0, 100);
  return sanitized || 'default_genre_key'; // Fallback if sanitization results in empty string
}

// --- Helper Function to Fetch Dialogflow Genres ---
async function fetchDialogflowGenres(client, projectId) {
    if (!client || !projectId) {
        console.error("Cannot fetch Dialogflow genres: Client or Project ID missing.");
        return [];
    }
    // Find this in Dialogflow Console URL when viewing the 'book_genre' entity type
    const entityTypeUUID = 'ba05b0aa-931a-4fdf-90c4-9522e4ec48c6';
    const fullEntityTypePath = `projects/${projectId}/agent/entityTypes/${entityTypeUUID}`;
    console.log(`Attempting to fetch genres from Dialogflow entity: ${fullEntityTypePath}`);

    try {
        const [entityTypeResponse] = await client.getEntityType({ name: fullEntityTypePath });
        if (entityTypeResponse && Array.isArray(entityTypeResponse.entities)) {
            const genres = entityTypeResponse.entities
                .map(entity => entity.value) // Extract the primary value
                .filter(value => value); // Filter out any potentially empty values
            console.log(`Successfully fetched ${genres.length} genres from Dialogflow.`);
            // Return the full list of genres
            return genres;
        } else {
            console.warn("No entities found in Dialogflow response or format unexpected.");
            return [];
        }
    } catch (error) {
        console.error(`Error fetching Dialogflow entity type (${fullEntityTypePath}):`, error.message || error.details || error);
        // Don't throw, just return empty array on error
        return [];
    }
}
// --- End Helper Function ---

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++ Reusable Video Recommendation Handler ++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
async function handleVideoRecommendation({
  userId, profileId, chatId, // chatId is still useful for logging or specific chat interactions if any
  ageRangeToUse, genresToUse,
  isInitialRequest,
  currentGenrePaginationVideoData, // Renamed: { unshownYoutubeVideos: [], nextYoutubePageToken: null } for the *current* genre
  globallyExcludedVideoIds, // Set of video IDs to exclude
  genrePaginationContextRef, // Firestore ref for the genre-specific pagination context
  dbAdmin, // Firestore admin instance
  MAX_FINAL_RECOMMENDATIONS,
  YOUTUBE_API_FETCH_LIMIT,
  admin // Firebase admin namespace for firestore.FieldValue
}) {
  const logPrefix = isInitialRequest ? "[INITIAL VIDEOS]" : "[MORE VIDEOS]";
  console.log(`${logPrefix} handleVideoRecommendation called. Age: ${ageRangeToUse}, Genres: ${genresToUse}, isInitial: ${isInitialRequest}`);
  console.log(`${logPrefix} Received currentGenrePaginationVideoData:`, currentGenrePaginationVideoData);
  console.log(`${logPrefix} Received globallyExcludedVideoIds size:`, globallyExcludedVideoIds.size);

  let videosToProcess = [];
  let effectiveNextPageTokenForSaving = null; // Token for the *next* API call, to be saved in session

  const unshownVideosFromCache = currentGenrePaginationVideoData?.unshownYoutubeVideos || [];
  const nextPageTokenFromCache = currentGenrePaginationVideoData?.nextYoutubePageToken;

  if (unshownVideosFromCache.length > 0) {
    console.log(`${logPrefix} Serving ${unshownVideosFromCache.length} videos from provided session cache.`);
    videosToProcess = unshownVideosFromCache;
    effectiveNextPageTokenForSaving = nextPageTokenFromCache; // This token was already for the *next* API call
  } else {
    if (nextPageTokenFromCache === null && !isInitialRequest) { // For "more", if cache is empty and token is null, means end of pages
        console.log(`${logPrefix} No unshown videos in cache and no next API page token (explicitly null).`);
        return new NextResponse(
            JSON.stringify({ response: `I've searched all the YouTube videos for *${genresToUse}* for *${ageRangeToUse}* year olds and there are no more new ones to show right now!` }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    }
    // For initial requests, or "more" requests with a page token (or first "more" call where token might be undefined/null initially)
    console.log(`${logPrefix} Unshown cache empty. Fetching from YouTube API using pageToken: ${nextPageTokenFromCache}`);
    const { videos: videosFromAPI, nextPageToken: newApiTokenFromCurrentFetch } = await searchYouTubeVideos(ageRangeToUse, genresToUse, YOUTUBE_API_FETCH_LIMIT, nextPageTokenFromCache)
      .catch(e => {
        console.error(`${logPrefix} Error fetching YouTube Videos from API:`, e);
        return { videos: [], nextPageToken: nextPageTokenFromCache }; // Preserve old token on error
      });
    videosToProcess = videosFromAPI;
    effectiveNextPageTokenForSaving = newApiTokenFromCurrentFetch;
    console.log(`${logPrefix} Fetched ${videosToProcess.length} videos from API. Next API page token to save: ${effectiveNextPageTokenForSaving}`);
  }

  // Filter videos using the provided global exclusions
  console.log(`${logPrefix} Total globally excluded video IDs to use: ${globallyExcludedVideoIds.size}`);
  const globallyFilteredVideos = videosToProcess.filter(video => {
    if (!video.id) return false;
    // Assuming IDs in globallyExcludedVideoIds are already sanitized if needed, or match video.id directly.
    // The globalRecommendations stores video.id directly as doc.id.
    return !globallyExcludedVideoIds.has(video.id);
  });
  console.log(`${logPrefix} Found ${globallyFilteredVideos.length} videos after global filtering for genre '${genresToUse}'.`);

  const videosToDisplayNow = globallyFilteredVideos.slice(0, MAX_FINAL_RECOMMENDATIONS);
  const remainingUnshownVideosToSave = globallyFilteredVideos.slice(MAX_FINAL_RECOMMENDATIONS);

  // Update/Store genre-specific pagination context
  if (genrePaginationContextRef) {
    const updateData = {
      lastRecommendationGenre: genresToUse, // Store the genre this context is for
      lastRecommendationType: 'videos',   // Store the type
      nextYoutubePageToken: effectiveNextPageTokenForSaving || null,
      unshownYoutubeVideos: remainingUnshownVideosToSave,
      lastRecommendationTimestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    try {
      await genrePaginationContextRef.set(updateData, { merge: true });
      console.log(`${logPrefix} Stored/Updated genre-specific video pagination context (Genre: ${genresToUse}, NextAPIPageToken: ${updateData.nextYoutubePageToken}, Unshown: ${updateData.unshownYoutubeVideos.length})`);
    } catch (paginationUpdateError) {
      console.error(`${logPrefix} Error storing/updating genre-specific video pagination context for genre ${genresToUse}:`, paginationUpdateError);
    }
  } else {
    console.warn(`${logPrefix} Missing genrePaginationContextRef. Cannot store genre-specific video pagination context.`);
  }

  if (videosToDisplayNow.length === 0) {
    let noResultsMessage = `Hmm, I couldn't find any YouTube videos about *${genresToUse}* suitable for *${ageRangeToUse}* year olds right now.`;
    const canOfferMore = remainingUnshownVideosToSave.length > 0 || (effectiveNextPageTokenForSaving !== null);
    if (canOfferMore) {
      noResultsMessage += " You can ask for 'More Recommendations' to see if I can find some!";
    } else {
      noResultsMessage += " Maybe try different topics?";
    }
    const responsePayload = {
        response: noResultsMessage,
        videos: [],
        prompts: canOfferMore ? ["More Recommendations please 👉 ✨"] : []
    };
    if (isInitialRequest) {
        responsePayload.newTitle = `Videos about: ${genresToUse}`;
    }
    return new NextResponse(JSON.stringify(responsePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  console.log(`${logPrefix} Recommending ${videosToDisplayNow.length} videos now. Storing ${remainingUnshownVideosToSave.length} for later.`);

  const videoDataForLlm = videosToDisplayNow.map(v => ({
    id: v.id, // Keep id for internal use if needed by LLM prompt, but prompt functions should strip it if not for LLM
    title: v.title,
    channel: v.channelTitle,
    link: `https://www.youtube.com/watch?v=${v.id}`,
    thumbnail: v.thumbnailUrl
  }));

  const llmPromptFunction = isInitialRequest ? createInitialVideoPrompt : createMoreVideosPrompt;
  const llmPrompt = llmPromptFunction(ageRangeToUse, genresToUse, videoDataForLlm);

  console.log(`${logPrefix} Generating llm response for videos...`);
  let llmResponseText = "";
  try {
    llmResponseText = await generatellmResponse(llmPrompt);
  } catch (llmError) {
    if (llmError.message === 'LLM request timed out.') {
      console.warn(`${logPrefix} LLM request timed out. Using fallback response for videos.`);
      llmResponseText = `I found some videos about *${genresToUse}* for you! My usual introduction is taking a little break, but here they are:`;
    } else {
      // For other LLM errors, we might still want to fail the request or use a more generic error message.
      // For now, re-throwing will let the main error handler catch it, or we can set a generic error text.
      // Let's use a simple fallback text for any LLM error to ensure content is still delivered if possible.
      console.error(`${logPrefix} Error generating LLM response for videos:`, llmError.message);
      llmResponseText = `I had a little trouble thinking of a fun introduction for these videos about *${genresToUse}*, but here are the recommendations:`;
    }
  }

  // Store newly recommended items globally
  const genresArrayForStorage = genresToUse.split(',').map(g => g.trim()).filter(g => g);
  if (userId && profileId && genresArrayForStorage.length > 0) {
    for (const video of videosToDisplayNow) {
      if (video.id) {
        const globalRecDocRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('globalRecommendations').doc(video.id);
        try {
          await globalRecDocRef.set({
            type: 'video',
            genres: admin.firestore.FieldValue.arrayUnion(...genresArrayForStorage),
            recommendedAt: admin.firestore.FieldValue.serverTimestamp(),
            title: video.title || 'N/A',
            channelTitle: video.channelTitle || 'N/A',
            thumbnailUrl: video.thumbnailUrl || null
          }, { merge: true });
        } catch (storeError) {
          console.error(`${logPrefix} Error storing global recommendation for video ${video.id}:`, storeError);
        }
      }
    }
    console.log(`${logPrefix} Attempted to store ${videosToDisplayNow.length} videos globally.`);
  }

  const responsePayload = {
    response: llmResponseText,
    videos: videosToDisplayNow,
    prompts: (remainingUnshownVideosToSave.length > 0 || effectiveNextPageTokenForSaving !== null) ? ["More Recommendations please 👉 ✨"] : []
  };
  if (isInitialRequest) {
    responsePayload.newTitle = `Videos about: ${genresToUse}`;
  }

  return new NextResponse(JSON.stringify(responsePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++ End Reusable Video Recommendation Handler ++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++ Reusable Book Recommendation Handler +++++++++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
async function handleBookRecommendation({
  userId, profileId, chatId, // chatId still useful for logging
  ageRangeToUse, genresToUse, finalNlbOnly,
  isInitialRequest,
  currentGenrePaginationBookData, // Renamed: { unshownBooks: [], nextBookPageContext: { nlb:1, google:1, openlibrary:1 } }
  globallyExcludedBookIds, // Set of book IDs (sanitized) to exclude
  genrePaginationContextRef, // Firestore ref for genre-specific pagination
  dbAdmin,
  MAX_FINAL_RECOMMENDATIONS,
  NLB_FETCH_LIMIT, // e.g., 10
  OTHER_FETCH_LIMIT, // e.g., 3
  admin
}) {
  const logPrefix = isInitialRequest ? "[INITIAL BOOKS]" : "[MORE BOOKS]";
  console.log(`${logPrefix} handleBookRecommendation called. Age: ${ageRangeToUse}, Genres: ${genresToUse}, NLBOnly: ${finalNlbOnly}, Initial: ${isInitialRequest}`);
  console.log(`${logPrefix} Received currentGenrePaginationBookData:`, JSON.stringify(currentGenrePaginationBookData));
  console.log(`${logPrefix} Received globallyExcludedBookIds size:`, globallyExcludedBookIds.size);

  let booksToProcessForLLM = [];
  let nextPageContextForSaving = { ...(currentGenrePaginationBookData?.nextBookPageContext || { nlb: 1, google: 1, openlibrary: 1 }) }; // Copy or default

  const unshownBooksFromCache = currentGenrePaginationBookData?.unshownBooks || [];

  if (unshownBooksFromCache.length > 0) {
    console.log(`${logPrefix} Serving ${unshownBooksFromCache.length} books from provided session cache.`);
    // These books are already LLM-approved from a previous fetch for the *same logical page*.
    // We just need to display them. The LLM interaction for *this specific batch* is skipped.
    // The `nextPageContextForSaving` remains as it was, pointing to the start of the *next* un-fetched page.
    const booksToDisplayNow = unshownBooksFromCache.slice(0, MAX_FINAL_RECOMMENDATIONS);
    const remainingUnshownBooksToSave = unshownBooksFromCache.slice(MAX_FINAL_RECOMMENDATIONS);

    // The LLM text would have been generated when these unshownBooks were first fetched.
    // For simplicity in this refactor, if serving from cache, we might need a generic intro
    // or retrieve a stored LLM response if we decide to save it.
    // For now, let's assume if unshownBooks exist, we create a simple text part.
    // A more advanced approach would be to store the LLM's conversational text with the unshownBooks.
    let llmResponseText;
    let newLlmResponseGeneratedForCache = false;

    if (currentGenrePaginationBookData?.lastLlmBookResponseText) {
        llmResponseText = currentGenrePaginationBookData.lastLlmBookResponseText;
        console.log(`${logPrefix} Using stored LLM response text from cache.`);
    } else {
        console.log(`${logPrefix} No stored LLM response text found in cache. Attempting to generate a new one for cached books.`);
        if (booksToDisplayNow.length > 0) {
            const bookDataForLlmPrompt = booksToDisplayNow.map(b => ({
                title: b.title, authors: Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || b.author || 'Unknown'),
                link: b.url, coverUrl: b.coverUrl, source: b.source, callNumber: b.callNumber
            }));
            const llmPromptFunction = isInitialRequest ? createInitialBookPrompt : createMoreBooksPrompt;
            const llmPromptForCache = llmPromptFunction(ageRangeToUse, genresToUse, bookDataForLlmPrompt, MAX_FINAL_RECOMMENDATIONS);
            try {
                llmResponseText = await generatellmResponse(llmPromptForCache);
                newLlmResponseGeneratedForCache = true; // Mark that we generated a new one
                console.log(`${logPrefix} Successfully generated new LLM response for cached books.`);
            } catch (llmErrorCache) {
                console.error(`${logPrefix} Error generating new LLM response for cached books:`, llmErrorCache.message);
                llmResponseText = isInitialRequest ?
                    `I found some more books for you about *${genresToUse}*!` :
                    `Here are some more books about *${genresToUse}* that you might like:`;
                console.log(`${logPrefix} Using basic generic intro text after failing to regenerate LLM response for cache.`);
            }
        } else {
            // Should not happen if unshownBooksFromCache.length > 0 led to booksToDisplayNow.length > 0
            // but as a fallback if booksToDisplayNow is empty for some reason.
            llmResponseText = `I'm ready to show you some books about *${genresToUse}*!`;
            console.log(`${logPrefix} No books to display from cache, using minimal generic intro.`);
        }
    }


    // Update genre-specific pagination context
    if (genrePaginationContextRef) {
        const updateData = {
            unshownBooks: remainingUnshownBooksToSave,
            lastRecommendationTimestamp: admin.firestore.FieldValue.serverTimestamp()
            // lastLlmBookResponseText will be added conditionally below
        };
        // If we generated a new LLM response for the cached books, store it.
        if (newLlmResponseGeneratedForCache && llmResponseText) {
            updateData.lastLlmBookResponseText = llmResponseText;
        }
        try {
            await genrePaginationContextRef.set(updateData, { merge: true });
            console.log(`${logPrefix} Updated genre-specific book pagination context (serving from cache). Unshown: ${remainingUnshownBooksToSave.length}. LLM text updated: ${newLlmResponseGeneratedForCache}`);
        } catch (e) { console.error(`${logPrefix} Error updating genre-specific book pagination context (cache serving):`, e); }
    }

    const messages = [{ sender: 'bot', text: llmResponseText, type: 'text' }];
    booksToDisplayNow.forEach(book => messages.push({ type: 'book', sender: 'bot', bookData: book }));

    const responsePayload = {
        messages,
        // For books, always offer "More" as we don't have a definitive end-of-results from APIs.
        // The user can decide if they want to continue fetching subsequent pages.
        prompts: ["More Recommendations please 👉 ✨"] 
    };
    if (isInitialRequest) responsePayload.newTitle = `Books about: ${genresToUse}`;
    return new NextResponse(JSON.stringify(responsePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // If no unshown books in cache, fetch from APIs
  console.log(`${logPrefix} Unshown cache empty. Fetching from APIs using page context:`, nextPageContextForSaving);
  let combinedBooksRaw = [];
  const currentPageNlb = nextPageContextForSaving.nlb || 1;
  const currentPageGoogle = nextPageContextForSaving.google || 1;
  const currentPageOpenLibrary = nextPageContextForSaving.openlibrary || 1;

  if (finalNlbOnly) {
    console.log(`${logPrefix} NLB Only Mode: Fetching ${NLB_FETCH_LIMIT} from NLB page ${currentPageNlb}`);
    const nlbBooks = await searchNLBBooks(ageRangeToUse, genresToUse, currentPageNlb, NLB_FETCH_LIMIT)
        .catch(e => { console.error(`${logPrefix} NLB API Error (NLB Only):`, e); return []; });
    
    if (nlbBooks.length === 0) {
      console.log(`${logPrefix} No NLB books found for NLB-only mode`);
      return new NextResponse(
        JSON.stringify({ 
          response: `I couldn't find any books about *${genresToUse}* from the National Library Board for *${ageRangeToUse}* year olds. Try a different topic or disable NLB-only mode in settings.`,
          prompts: []
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    combinedBooksRaw = nlbBooks.map(b => ({ ...b, id: b.url || b.title, source: 'National Library Board (NLB)' }));
    nextPageContextForSaving.nlb = currentPageNlb + 1;
  } else {
    console.log(`${logPrefix} Mixed Mode: Fetching ${OTHER_FETCH_LIMIT} from Google (pg ${currentPageGoogle}), OpenLib (pg ${currentPageOpenLibrary}), NLB (pg ${currentPageNlb})`);
    const [googleApiBooks, openLibraryApiBooks, nlbApiBooks] = await Promise.all([
        searchBooks(ageRangeToUse, genresToUse, OTHER_FETCH_LIMIT, currentPageGoogle).catch(e => { console.error(`${logPrefix} Google Books API Error:`, e); return []; }),
        searchK12Books(genresToUse, OTHER_FETCH_LIMIT, currentPageOpenLibrary).catch(e => { console.error(`${logPrefix} K12 Books API Error:`, e); return []; }),
        searchNLBBooks(ageRangeToUse, genresToUse, currentPageNlb, OTHER_FETCH_LIMIT).catch(e => { console.error(`${logPrefix} NLB API Error (Mixed):`, e); return []; })
    ]);
    combinedBooksRaw = [
       ...googleApiBooks, // Already filtered and mapped in searchBooks
       ...openLibraryApiBooks, // Already filtered and mapped in searchK12Books
       ...nlbApiBooks // Already filtered and mapped in searchNLBBooks
    ];
    // The utility functions now handle their own title filtering and mapping.
    // The source field is also added by each utility function.
    nextPageContextForSaving.nlb = currentPageNlb + 1;
    nextPageContextForSaving.google = currentPageGoogle + 1;
    nextPageContextForSaving.openlibrary = currentPageOpenLibrary + 1;
  }
  console.log(`${logPrefix} Fetched ${combinedBooksRaw.length} raw book candidates from APIs.`);

  // Filter against globally excluded and ensure uniqueness for this batch
  let candidatePoolForLLM = combinedBooksRaw.filter(book => {
    if (!book.id) return false;
    const sanitizedId = book.id.replace(/\//g, '_');
    return !globallyExcludedBookIds.has(sanitizedId);
  });
  candidatePoolForLLM = Array.from(new Map(candidatePoolForLLM.map(item => [item.id, item])).values());
  console.log(`${logPrefix} Candidate pool for LLM after global filtering & unique check: ${candidatePoolForLLM.length}`);

  let llmApprovedBooks = [];
  let llmResponseText = "";

  if (candidatePoolForLLM.length > 0) {
    const batchDataForPrompt = candidatePoolForLLM.map(b => ({
        title: b.title, authors: Array.isArray(b.authors) ? b.authors.join(', ') : (b.authors || b.author || 'Unknown'),
        link: b.url, // Use the mapped b.url
        coverUrl: b.coverUrl, // Use the mapped b.coverUrl
        callNumber: b.callNumber, source: b.source
    }));
    const llmPromptFunction = isInitialRequest ? createInitialBookPrompt : createMoreBooksPrompt;
    // Pass MAX_FINAL_RECOMMENDATIONS to the prompt function
    const llmPrompt = llmPromptFunction(ageRangeToUse, genresToUse, batchDataForPrompt, MAX_FINAL_RECOMMENDATIONS);
    console.log(`${logPrefix} Sending batch to LLM for filtering/summarizing...`);
    try {
      llmResponseText = await generatellmResponse(llmPrompt);
    } catch (llmError) {
      if (llmError.message === 'LLM request timed out.') {
        console.warn(`${logPrefix} LLM request timed out. Using fallback response for books and showing all candidates.`);
        llmResponseText = `I found some books about *${genresToUse}* for you! My usual introduction is taking a little break, but here they are:`;
        // If LLM times out, we don't have its filtering. Show all candidates from this batch.
        llmApprovedBooks = [...candidatePoolForLLM]; // Use all candidates as "approved"
      } else {
        console.error(`${logPrefix} Error generating LLM response for books (not a timeout or known fast abort):`, llmError); // Log the full error object
        llmResponseText = `I had a little trouble thinking of a fun introduction for these books about *${genresToUse}*, but here are the recommendations:`;
        // For other errors, also show all candidates as a fallback.
        llmApprovedBooks = [...candidatePoolForLLM];
      }
    }

    // If llmResponseText was successfully generated (no timeout/error that set llmApprovedBooks directly)
    // then filter based on its content.
    if (llmApprovedBooks.length === 0 && candidatePoolForLLM.length > 0 && llmResponseText && !llmResponseText.startsWith("I found some books") && !llmResponseText.startsWith("I had a little trouble")) {
        const llmResponseLower = llmResponseText.toLowerCase();
        llmApprovedBooks = candidatePoolForLLM.filter(book => {
            if (!book.title) return false;
            const lowerTitle = book.title.toLowerCase();
            const colonIndex = lowerTitle.indexOf(':');
            let corePart = (colonIndex !== -1) ? lowerTitle.substring(0, colonIndex).trim() : lowerTitle.substring(0, 15).trim();
            const approved = corePart && llmResponseLower.includes(corePart);
            if(approved) console.log(`${logPrefix} [LLM MATCH] Found core part "${corePart}" from title "${book.title}" in LLM response.`);
            return approved;
        });
        console.log(`${logPrefix} LLM approved ${llmApprovedBooks.length} books from the current API fetch (after successful LLM response).`);
    } else if (llmApprovedBooks.length > 0 && (llmResponseText.startsWith("I found some books") || llmResponseText.startsWith("I had a little trouble"))) {
        console.log(`${logPrefix} Using ${llmApprovedBooks.length} books due to LLM timeout/error fallback.`);
    }


    // const llmResponseLower = llmResponseText.toLowerCase(); // Moved inside the conditional block

    // llmApprovedBooks = candidatePoolForLLM.filter(book => { // Original filtering logic moved
    // }); // Removed orphaned code block
    // console.log(`${logPrefix} LLM approved ${llmApprovedBooks.length} books from the current API fetch.`); // Removed redundant log
  } else {
    console.log(`${logPrefix} Candidate pool for LLM was empty. No books sent to LLM.`);
    // Generate a "no results for this attempt" message if LLM wasn't called
     const noResultsPromptForLLM = isInitialRequest ?
        createInitialBookPrompt(ageRangeToUse, genresToUse, [], MAX_FINAL_RECOMMENDATIONS) : // Pass empty array and max
        createMoreBooksPrompt(ageRangeToUse, genresToUse, [], MAX_FINAL_RECOMMENDATIONS);   // Pass empty array and max
     llmResponseText = await generatellmResponse(noResultsPromptForLLM);
  }

  const shuffledLlmApprovedBooks = shuffleArray([...llmApprovedBooks]);
  const booksToDisplayNow = shuffledLlmApprovedBooks.slice(0, MAX_FINAL_RECOMMENDATIONS);
  const newUnshownBooksToSave = shuffledLlmApprovedBooks.slice(MAX_FINAL_RECOMMENDATIONS);

  // Clean LLM response text
  let cleanedLlmResponseText = llmResponseText;
  const paragraphs = cleanedLlmResponseText.split(/\n\s*\n/);
  const cleanedParagraphs = paragraphs.filter(p => !p.includes('(Note:'));
  cleanedLlmResponseText = cleanedParagraphs.join('\n\n').trim();
  cleanedLlmResponseText = cleanedLlmResponseText.replace(/\(Note:[\s\S]*?\)/gmi, '').trim();
  console.log(`${logPrefix} Cleaned LLM response text:`, cleanedLlmResponseText.substring(0,100) + "...");

  // Update genre-specific pagination context
  if (genrePaginationContextRef) {
    const updateData = {
      lastRecommendationGenre: genresToUse,
      lastRecommendationType: 'books',
      // lastNlbBookPage: nextPageContextForSaving.nlb -1, // Less relevant with full context object
      nextBookPageContext: nextPageContextForSaving, // Save the incremented page numbers
      unshownBooks: newUnshownBooksToSave,
      lastLlmBookResponseText: cleanedLlmResponseText, // Store the LLM's conversational text
      lastRecommendationTimestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    try {
      await genrePaginationContextRef.set(updateData, { merge: true });
      console.log(`${logPrefix} Stored/Updated genre-specific book pagination context. NextPages: ${JSON.stringify(nextPageContextForSaving)}, Unshown: ${newUnshownBooksToSave.length}`);
    } catch (e) { console.error(`${logPrefix} Error storing/updating genre-specific book pagination context:`, e); }
  }

  if (booksToDisplayNow.length === 0) {
    let noResultsMessage;
    if (finalNlbOnly) {
      noResultsMessage = `I couldn't find any books about *${genresToUse}* from the National Library Board for *${ageRangeToUse}* year olds. Try a different topic or disable NLB-only mode in settings.`;
    } else {
      noResultsMessage = cleanedLlmResponseText || `I couldn't find any more books about *${genresToUse}* for *${ageRangeToUse}* year olds this time. You can try asking for "More Recommendations" to check the next set of library pages, or try a different topic!`;
    }
    
    const responsePayload = {
      response: noResultsMessage,
      prompts: finalNlbOnly ? [] : ["More Recommendations please 👉 ✨"] // Don't offer "More" in NLB-only mode if no results
    };
    if (isInitialRequest) responsePayload.newTitle = `Books about: ${genresToUse}`;
    return new NextResponse(JSON.stringify(responsePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Store newly displayed books globally
  const genresArrayForStorage = genresToUse.split(',').map(g => g.trim()).filter(g => g);
  if (userId && profileId && genresArrayForStorage.length > 0) {
    for (const book of booksToDisplayNow) {
      if (book.id) {
        const safeDocId = book.id.replace(/\//g, '_');
        const globalRecDocRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('globalRecommendations').doc(safeDocId);
        try {
          await globalRecDocRef.set({
            originalId: book.id, type: 'book',
            genres: admin.firestore.FieldValue.arrayUnion(...genresArrayForStorage),
            recommendedAt: admin.firestore.FieldValue.serverTimestamp(),
            title: book.title || 'N/A',
            author: Array.isArray(book.authors) ? book.authors.join(', ') : (book.authors || book.author || 'Unknown'),
            coverUrl: book.coverUrl || null // Use the mapped book.coverUrl
          }, { merge: true });
        } catch (storeError) { console.error(`${logPrefix} Error storing global book rec ${safeDocId}:`, storeError); }
      }
    }
    console.log(`${logPrefix} Attempted to store ${booksToDisplayNow.length} books globally.`);
  }

  const messages = [{ sender: 'bot', text: cleanedLlmResponseText, type: 'text' }];
  booksToDisplayNow.forEach(book => {
    messages.push({
      type: 'book', sender: 'bot',
      bookData: {
        id: book.id, 
        title: book.title,
        author: Array.isArray(book.authors) ? book.authors.join(', ') : (book.authors || book.author || 'Unknown'),
        coverUrl: book.coverUrl, // Use the already mapped coverUrl
        callNumber: book.callNumber, 
        source: book.source,
        url: book.url // Crucially, add the external URL here
      }
    });
  });

  const responsePayload = {
    messages,
    // For books, always offer "More" as we don't have a definitive end-of-results from APIs.
    prompts: ["More Recommendations please 👉 ✨"]
  };
  if (isInitialRequest) responsePayload.newTitle = `Books about: ${genresToUse}`;

  return new NextResponse(JSON.stringify(responsePayload), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++ End Reusable Book Recommendation Handler +++++++++++++++++++++++++++++++++++++++++++
// ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


export async function POST(req) {
  try {
    const {
      message,
      sessionId: clientSessionId,
      userId,
      profileId,
      chatId, // <-- Add chatId here
      useProfileGenres = true,
      nlbOnly: nlbOnlyFromRequest = true // <-- Extract from request, default to true
     } = await req.json(); // Extract message, session ID, user ID, profile ID, chatId, useProfileGenres, and nlbOnly

    // --- Pre-warming Ping Check ---
    if (message === "__PING__") {
      console.log("Received pre-warm ping request.");
      return new NextResponse(JSON.stringify({ status: "pong" }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // --- End Pre-warming Ping Check ---

    if (!message || !userId || !profileId) {
      let missing = [];
      if (!message) missing.push('Message');
      // Allow ping requests without userId/profileId
      if (!userId && message !== "__PING__") missing.push('User ID');
      if (!profileId) missing.push('Profile ID');
      return new NextResponse(
        JSON.stringify({ error: `${missing.join(', ')} required` }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // REMOVED: Eager fetching of genres. Will fetch on demand using cache wrapper.

    // Check if Dialogflow credentials are loaded correctly
    if (
      !process.env.DIALOGFLOW_CREDENTIALS ||
      !process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID ||
      !process.env.GOOGLE_BOOKS_API_KEY ||
      !process.env.OPENROUTER_API_KEY // Check for OPENROUTER_API_KEY (updated from HUGGINGFACE)
    ) {
      console.error(
        'Missing Dialogflow credentials, project ID, Google Books API key, or OpenRouter API key in environment variables' // Update error message
      );
      return new NextResponse(
        JSON.stringify({ error: 'Server configuration error' }), // More specific error
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const credentials = JSON.parse(process.env.DIALOGFLOW_CREDENTIALS);
    const projectId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID;

    // Initialize Dialogflow client with credentials from environment variable
    const sessionClient = new SessionsClient({
      credentials,
    });

    // Use the session ID from the client or generate a new one if it's missing
    const sessionId = clientSessionId || uuidv4();
    console.log('Received Session ID:', sessionId);
    // Construct the session path manually
    const sessionPath = `projects/${projectId}/agent/sessions/${sessionId}`;

    // Prepare the request to send to Dialogflow
    const request = {
      session: sessionPath,
      queryInput: {
        text: {
          text: message,
          languageCode: 'en',
        },
      },
   };

   // --- Fetch Dialogflow Intent and Profile Data Concurrently ---
   let result, profileData, profileSnap;

   const dialogflowPromise = sessionClient.detectIntent(request);
   // Fetch profile only if userId and profileId are present
   const profilePromise = (userId && profileId)
       ? dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).get()
       : Promise.resolve(null); // Resolve immediately if no IDs

   try {
       const [dialogflowResponses, fetchedProfileSnap] = await Promise.all([dialogflowPromise, profilePromise]);

       // Process Dialogflow response
       result = dialogflowResponses[0].queryResult;
       console.log('Dialogflow response received.');

       // Process Profile response
       profileSnap = fetchedProfileSnap; // Can be null if IDs were missing
       if (profileSnap && profileSnap.exists) { // Check if snap exists
           profileData = profileSnap.data();
           console.log('Fetched Profile Data:', profileData);
       } else {
           profileData = null; // Ensure profileData is null if not found or IDs missing
           if (userId && profileId) { // Only log 'not found' if we actually looked
                console.log(`Profile not found for userId: ${userId}, profileId: ${profileId}`);
           }
       }

   } catch (fetchError) {
       console.error('Error fetching Dialogflow intent or profile data:', fetchError);
       // Determine how to handle this - maybe return a generic error
       // Improved error checking might be needed here based on actual error types
       return new NextResponse(
           JSON.stringify({ error: 'Internal Server Error during initial data fetch' }),
           { status: 500, headers: { 'Content-Type': 'application/json' } }
       );
   }

   const intentName = result?.intent?.displayName; // Get intent name after fetching
   // --- Determine Age Range, Genres, and NLB Setting ---
   let profileAgeRange = null;
   let profileGenres = null;
   let profileNlbOnlySetting = null; // Variable to store profile's nlbOnly setting

   // Process the fetched profileData (if it exists)
   if (profileData) {
       // Calculate age from DOB
       if (profileData.dob && profileData.dob instanceof Timestamp) {
         const dobDate = profileData.dob.toDate();
         const today = new Date();
         let age = today.getFullYear() - dobDate.getFullYear();
         const m = today.getMonth() - dobDate.getMonth();
         if (m < 0 || (m === 0 && today.getDate() < dobDate.getDate())) {
           age--;
         }
         profileAgeRange = age >= 0 ? age : null; // Use calculated age if valid
       }

       // Get interests as genres
       if (Array.isArray(profileData.interests) && profileData.interests.length > 0) {
         profileGenres = profileData.interests.join(', ');
       }

       // Get nlbOnly setting from profile if it exists and is a boolean
       if (typeof profileData.nlbOnly === 'boolean') {
           profileNlbOnlySetting = profileData.nlbOnly;
       }
   }

   // Get parameters from Dialogflow as fallback for age/genre
   const dialogflowAgeRange = parseInt(result.parameters?.fields?.child_age?.stringValue) || null;
    const dialogflowGenreList = 
      intentName?.toLowerCase() === 'recommend content' || intentName?.toLowerCase() === 'recommend videos' 
        ? result.parameters?.fields?.content_genre?.listValue?.values || []
        : result.parameters?.fields?.book_genre?.listValue?.values || [];
    let dialogflowGenresArray = dialogflowGenreList.map(genreObj => genreObj.stringValue); // Make mutable

    // --- Clear Stale Dialogflow Genre Params ---
    // If profile genres are disabled AND the intent is a general recommendation request
    // (not a direct genre specification or follow-up like 'recommend.more'),
    // ignore any genre parameters Dialogflow might have carried over in its session context.
    const isGeneralRecommendationIntent = intentName?.toLowerCase().includes('recommend books') || intentName?.toLowerCase().includes('recommend content');
    if (!useProfileGenres && isGeneralRecommendationIntent) {
        console.log(`[CONTEXT CLEAR] useProfileGenres is false and intent is general (${intentName}). Clearing Dialogflow genre params to avoid stale context.`);
        dialogflowGenresArray = []; // Force empty array
    }
    // --- End Clear Stale Dialogflow Genre Params ---


    // --- Debug Logging for Genre Loop ---
    console.log(`[DEBUG GENRE LOOP] Received message: "${message}"`);
    console.log(`[DEBUG GENRE LOOP] Dialogflow Intent: ${result?.intent?.displayName}`);
    console.log(`[DEBUG GENRE LOOP] Dialogflow Parameters Raw:`, JSON.stringify(result.parameters?.fields, null, 2));
    console.log(`[DEBUG GENRE LOOP] Extracted dialogflowGenresArray from params:`, dialogflowGenresArray);
    // --- End Debug Logging ---


    // --- Refined Genre Determination ---
    const profileGenresArray = (Array.isArray(profileData?.interests) ? profileData.interests : []);
    let finalGenresArray = [];
    let genresSource = "None"; // For logging

    if (useProfileGenres && profileGenresArray.length > 0) {
        // If using profile genres and they exist, start with them
        finalGenresArray = [...profileGenresArray];
        genresSource = "Profile";
        // Combine with Dialogflow genres from the current request, ensuring uniqueness
        finalGenresArray = [...new Set([...finalGenresArray, ...dialogflowGenresArray])];
        if (dialogflowGenresArray.length > 0 && finalGenresArray.length > profileGenresArray.length) {
             genresSource += "+Dialogflow"; // Indicate if Dialogflow added anything new
        }
    } else {
        // If NOT using profile genres OR profile genres are empty,
        // ONLY use Dialogflow genres detected in the CURRENT request.
        finalGenresArray = [...dialogflowGenresArray]; // Use only current Dialogflow params
        if (finalGenresArray.length > 0) {
            genresSource = "Dialogflow";
        }
    }

    // --- Fallback Logic: Check if input message is a known genre ---
    if (finalGenresArray.length === 0 && message && typeof message === 'string') {
        const knownGenres = await getFirestoreGenres(); // <-- Use Firestore genres (uses cache)
        const directMatch = knownGenres.find(g => g.toLowerCase() === message.trim().toLowerCase());
        if (directMatch) {
            console.log(`[DEBUG GENRE LOOP FALLBACK] Input message "${message}" directly matches known Firestore genre "${directMatch}". Adding manually as Dialogflow missed it.`);
            finalGenresArray.push(directMatch); // Add the matched genre
            if (genresSource === "None") {
                genresSource = "Direct Match Fallback";
            } else {
                genresSource += "+Direct Match Fallback";
            }
        }
    }
    // --- End Fallback Logic ---

    const finalGenres = finalGenresArray.join(', '); // Join the final array. Will be "" if no genres determined.
    console.log(`Determined finalGenres: "${finalGenres}" (Source: ${genresSource}, useProfileGenres: ${useProfileGenres})`);
    // --- End Refined Genre Determination ---


    // Prioritize profile data for age, fallback to Dialogflow
    const finalAgeRange = profileAgeRange !== null ? profileAgeRange : dialogflowAgeRange;

    // Determine final nlbOnly setting: Prioritize profile, then request/default
    const finalNlbOnly = profileNlbOnlySetting !== null ? profileNlbOnlySetting : nlbOnlyFromRequest;

    console.log('Dialogflow Parameters:', result.parameters.fields);
    console.log('Intent Name:', intentName);
    console.log('Profile Age Range:', profileAgeRange);
    console.log('Profile Genres:', profileGenres);
    console.log('Profile NLB Only Setting:', profileNlbOnlySetting); // Log profile setting
    console.log('Dialogflow Age Range:', dialogflowAgeRange);
    console.log('Dialogflow Genres Array:', dialogflowGenresArray); // Log the array from Dialogflow
    console.log('--- Final Values ---');
    console.log('Final Age Range:', finalAgeRange);
    console.log('Final Genres:', finalGenres);
    console.log('Final NLB Only:', finalNlbOnly, `(Source: ${profileNlbOnlySetting !== null ? 'Profile' : 'Request/Default'})`); // Log final setting and source

    console.log('Full Dialogflow Response:', JSON.stringify(result, null, 2));

    // --- Fetch Globally Recommended Items for Current Genres ---
    let globallyRecommendedIdsForCurrentGenres = new Set();
    if (userId && profileId) {
        try {
            const globalRecsRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('globalRecommendations');
            const globalRecsSnap = await globalRecsRef.get();
            const currentGenresArray = finalGenres.split(',').map(g => g.trim()).filter(g => g);

            globalRecsSnap.forEach(doc => {
              const data = doc.data();
              // Check if the item was recommended for *any* of the genres in the current request
              if (data.genres && Array.isArray(data.genres) && data.genres.some(g => currentGenresArray.includes(g))) {
                 globallyRecommendedIdsForCurrentGenres.add(doc.id);
              }
            });
            console.log(`Found ${globallyRecommendedIdsForCurrentGenres.size} globally recommended items to exclude for current genres.`);
        } catch (fetchGlobalError) {
            console.error("Error fetching global recommendations:", fetchGlobalError);
            // Continue without global exclusions if fetch fails
        }
    } else {
        console.warn("Missing userId or profileId, cannot fetch global recommendations.");
    }
    // --- End Fetch Global Recommendations ---


    // MORE RECOMMENDATIONS - Handle request for more items of the same type/genre
    if (intentName?.toLowerCase() === 'recommend.more') {
      // **** ADDED DETAILED LOGGING ****
      console.log(`[DEBUG MORE] Entered 'recommend.more' block. Intent: ${intentName}`);
      if (!userId || !profileId || !chatId) {
        console.warn("[DEBUG MORE] Missing userId, profileId, or chatId for 'recommend.more'. Cannot retrieve context.");
        return new NextResponse(
          JSON.stringify({ response: "Sorry, I can't remember what we were talking about. What would you like recommendations for?" }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        // --- Read context from the specific Chat Session ---
        let chatSessionData = null;
        let lastType = null;
        let lastGenre = null;
        let lastNlbBookPage = 1; // Default to page 1
        const chatSessionRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('chatSessions').doc(chatId);
        const chatSessionSnap = await chatSessionRef.get();

        // **** ADDED DETAILED LOGGING ****
        if (chatSessionSnap.exists) {
          chatSessionData = chatSessionSnap.data();
          lastType = chatSessionData?.lastRecommendationType; // Read from chat session
          lastGenre = chatSessionData?.lastRecommendationGenre; // Read from chat session
          lastNlbBookPage = chatSessionData?.lastNlbBookPage || 1; // Read last page, default to 1
          console.log(`[DEBUG MORE] Chat session found for chatId: ${chatId}. Data:`, JSON.stringify(chatSessionData));
          console.log(`[DEBUG MORE] Read context: Type=${lastType}, Genre=${lastGenre}, LastNLBPage=${lastNlbBookPage}`);
        } else {
          console.log(`[DEBUG MORE] Chat session NOT found for chatId: ${chatId}`);
        }

        // Check if context was found in the chat session
        if (!lastType || !lastGenre) {
          console.log(`No previous recommendation context found in chat session: ${chatId}`);
          return new NextResponse(
            JSON.stringify({ response: "I don't recall recommending anything specific in this chat yet. What kind of books or videos are you interested in?" }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        // Use the finalNlbOnly setting determined earlier for fetching more
        const useNlbOnlyForMore = finalNlbOnly; // <-- Use the final determined value
        console.log(`'recommend.more' using NLB Only setting: ${useNlbOnlyForMore}`);
        // Use the age range stored in the profile or fallback to Dialogflow's last known age
        const ageForMore = finalAgeRange; // Use the age determined earlier in the request

        // **** ADDED DETAILED LOGGING ****
        console.log(`[DEBUG MORE] Using Age: ${ageForMore}`);
        console.log(`[DEBUG MORE] Checking condition: (lastType === 'books' && ageForMore !== null) -> (${lastType === 'books'} && ${ageForMore !== null})`);

        if (lastType === 'books' && ageForMore !== null) {
          const NLB_FETCH_LIMIT_MORE = 10;
          const OTHER_FETCH_LIMIT_MORE = 3;
          console.log(`[MORE BOOKS] Processing 'more' request for books. Age: ${ageForMore}, Genres: ${lastGenre}, NLBOnly: ${useNlbOnlyForMore}`);

          // Prepare currentGenrePaginationBookData for the handler
          // 1. Get lastGenre from chat-specific session
          // 2. Use lastGenre to get genre-specific pagination context
          const sanitizedLastGenreKeyBooks = sanitizeGenreForDocId(lastGenre);
          const genrePaginationContextRefForMoreBooks = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('genrePaginationContext').doc(sanitizedLastGenreKeyBooks);
          let genrePaginationDataForMoreBooks = null;
          const genrePaginationSnapForMoreBooks = await genrePaginationContextRefForMoreBooks.get();
          if (genrePaginationSnapForMoreBooks.exists) {
            genrePaginationDataForMoreBooks = genrePaginationSnapForMoreBooks.data();
          }

          const currentBookPaginationState = {
            unshownBooks: genrePaginationDataForMoreBooks?.unshownBooks || [],
            nextBookPageContext: genrePaginationDataForMoreBooks?.nextBookPageContext || { nlb: 1, google: 1, openlibrary: 1 }
          };
           // Ensure all sources have a page number in context
          currentBookPaginationState.nextBookPageContext.nlb = currentBookPaginationState.nextBookPageContext.nlb || 1;
          currentBookPaginationState.nextBookPageContext.google = currentBookPaginationState.nextBookPageContext.google || 1;
          currentBookPaginationState.nextBookPageContext.openlibrary = currentBookPaginationState.nextBookPageContext.openlibrary || 1;
          console.log(`[MORE BOOKS] Using genre pagination context for '${lastGenre}':`, currentBookPaginationState);


          // Prepare globallyExcludedBookIds for the handler (specific to lastGenre)
          let excludedBookIdsForLastGenre = new Set();
          const lastGenresArray = lastGenre.split(',').map(g => g.trim()).filter(g => g);
          if (userId && profileId && lastGenresArray.length > 0) {
            try {
              const globalRecsRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('globalRecommendations');
              const globalRecsSnap = await globalRecsRef.get();
              globalRecsSnap.forEach(doc => {
                const data = doc.data();
                if (data.type === 'book' && data.genres && Array.isArray(data.genres) && data.genres.some(g => lastGenresArray.includes(g))) {
                  excludedBookIdsForLastGenre.add(doc.id); // doc.id is the sanitized ID
                }
              });
              console.log(`[MORE BOOKS] Built exclusion set for lastGenre ('${lastGenre}'). Excluded IDs: ${excludedBookIdsForLastGenre.size}`);
            } catch (fetchGlobalErrorMoreBooks) {
              console.error("[MORE BOOKS] Error fetching global recommendations for 'more books':", fetchGlobalErrorMoreBooks);
            }
          } else {
            console.warn("[MORE BOOKS] Missing userId, profileId, or lastGenresArray empty. Cannot build specific exclusion set.");
          }

          return handleBookRecommendation({
            userId, profileId, chatId,
            ageRangeToUse: ageForMore,
            genresToUse: lastGenre,
            finalNlbOnly: useNlbOnlyForMore,
            isInitialRequest: false,
            currentGenrePaginationBookData: currentBookPaginationState, // Pass genre-specific pagination data
            globallyExcludedBookIds: excludedBookIdsForLastGenre,
            genrePaginationContextRef: genrePaginationContextRefForMoreBooks, // Pass ref to genre-specific context
            dbAdmin,
            MAX_FINAL_RECOMMENDATIONS,
            NLB_FETCH_LIMIT: NLB_FETCH_LIMIT_MORE,
            OTHER_FETCH_LIMIT: OTHER_FETCH_LIMIT_MORE,
            admin
          });
        } else if (lastType === 'videos' && ageForMore !== null) {
          console.log(`[MORE VIDEOS] Processing 'more' request for videos. Age: ${ageForMore}, Genres: ${lastGenre}`);
          const YOUTUBE_FETCH_LIMIT_MORE = 15;

          // Prepare currentGenrePaginationVideoData for the handler
          // 1. Get lastGenre from chat-specific session
          // 2. Use lastGenre to get genre-specific pagination context
          const sanitizedLastGenreKey = sanitizeGenreForDocId(lastGenre);
          const genrePaginationContextRefForMore = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('genrePaginationContext').doc(sanitizedLastGenreKey);
          let genrePaginationDataForMore = null;
          const genrePaginationSnapForMore = await genrePaginationContextRefForMore.get();
          if (genrePaginationSnapForMore.exists) {
            genrePaginationDataForMore = genrePaginationSnapForMore.data();
          }

          const currentVideoPaginationState = {
            unshownYoutubeVideos: genrePaginationDataForMore?.unshownYoutubeVideos || [],
            nextYoutubePageToken: genrePaginationDataForMore?.nextYoutubePageToken
          };
          console.log(`[MORE VIDEOS] Using genre pagination context for '${lastGenre}':`, currentVideoPaginationState);

          // Prepare globallyExcludedVideoIds for the handler (specific to lastGenre)
          let excludedVideoIdsForLastGenre = new Set();
          const lastcontentGenresArray = lastGenre.split(',').map(g => g.trim()).filter(g => g);
          if (userId && profileId && lastcontentGenresArray.length > 0) {
            try {
              const globalRecsRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('globalRecommendations');
              const globalRecsSnap = await globalRecsRef.get();
              globalRecsSnap.forEach(doc => {
                const data = doc.data();
                if (data.type === 'video' && data.genres && Array.isArray(data.genres) && data.genres.some(g => lastcontentGenresArray.includes(g))) {
                  excludedVideoIdsForLastGenre.add(doc.id);
                }
              });
              console.log(`[MORE VIDEOS] Built exclusion set for lastGenre ('${lastGenre}'). Excluded IDs: ${excludedVideoIdsForLastGenre.size}`);
            } catch (fetchGlobalErrorMoreVideos) {
              console.error("[MORE VIDEOS] Error fetching global recommendations for 'more videos':", fetchGlobalErrorMoreVideos);
            }
          } else {
            console.warn("[MORE VIDEOS] Missing userId, profileId, or lastcontentGenresArray empty. Cannot build specific exclusion set.");
          }

          return handleVideoRecommendation({
            userId, profileId, chatId,
            ageRangeToUse: ageForMore,
            genresToUse: lastGenre,
            isInitialRequest: false,
            currentGenrePaginationVideoData: currentVideoPaginationState, // Pass genre-specific pagination data
            globallyExcludedVideoIds: excludedVideoIdsForLastGenre,
            genrePaginationContextRef: genrePaginationContextRefForMore, // Pass ref to genre-specific context
            dbAdmin,
            MAX_FINAL_RECOMMENDATIONS,
            YOUTUBE_API_FETCH_LIMIT: YOUTUBE_FETCH_LIMIT_MORE,
            admin
          });
        } else {
          // Fallback if type is unknown or age is missing for some reason
          console.log(`Cannot provide 'more' recommendations. Type: ${lastType}, Age: ${ageForMore}`);
          return new NextResponse(
            JSON.stringify({ response: "I remember you asked for something, but I'm not sure if it was books or videos, or the age range. Could you ask for recommendations again?" }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

      } catch (error) {
        console.error("Error processing 'recommend.more' intent:", error);
        return new NextResponse(
          JSON.stringify({ response: "Oops! Something went wrong while trying to find more recommendations. Please try asking again." }),
          { status: 500, headers: { 'Content-Type': 'application/json' } } // Use 500 for internal errors
        );
      }
    }

    // BOOKS - Only handle if intent explicitly matches book recommendation
    if (intentName?.toLowerCase() === 'recommend books' && finalAgeRange !== null) {
      if (finalGenres) {
        try {
          const NLB_FETCH_LIMIT_INITIAL = 10;
          const OTHER_FETCH_LIMIT_INITIAL = 3;
          let currentGenrePaginationBookState = {
            unshownBooks: [],
            nextBookPageContext: { nlb: 1, google: 1, openlibrary: 1 } // Default for initial
          };
          let genrePaginationContextRefForBook;

          if (userId && profileId) { // chatId not strictly needed for genre context, but good for logging
            const sanitizedGenreKey = sanitizeGenreForDocId(finalGenres);
            genrePaginationContextRefForBook = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('genrePaginationContext').doc(sanitizedGenreKey);
            const genrePaginationSnap = await genrePaginationContextRefForBook.get();

            if (genrePaginationSnap.exists) {
              const data = genrePaginationSnap.data();
              // Check if the stored context is for books. Genre match is implicit by doc key.
              if (data?.lastRecommendationType === 'books') {
                currentGenrePaginationBookState.unshownBooks = data.unshownBooks || [];
                currentGenrePaginationBookState.nextBookPageContext = data.nextBookPageContext || { nlb: 1, google: 1, openlibrary: 1 };
                // Ensure all sources have a page number in context
                currentGenrePaginationBookState.nextBookPageContext.nlb = currentGenrePaginationBookState.nextBookPageContext.nlb || 1;
                currentGenrePaginationBookState.nextBookPageContext.google = currentGenrePaginationBookState.nextBookPageContext.google || 1;
                currentGenrePaginationBookState.nextBookPageContext.openlibrary = currentGenrePaginationBookState.nextBookPageContext.openlibrary || 1;
                console.log(`[INITIAL BOOKS] Genre pagination context found for '${finalGenres}'. Using unshown: ${currentGenrePaginationBookState.unshownBooks.length}, pageContext: ${JSON.stringify(currentGenrePaginationBookState.nextBookPageContext)}`);
              } else if (data?.lastRecommendationType) {
                 console.log(`[INITIAL BOOKS] Genre pagination context for '${finalGenres}' exists but is for type '${data.lastRecommendationType}', not 'books'. Starting fresh for books.`);
              } else {
                 console.log(`[INITIAL BOOKS] Genre pagination context for '${finalGenres}' exists but is malformed or new. Starting fresh.`);
              }
            } else {
              console.log(`[INITIAL BOOKS] No genre-specific pagination context found for '${finalGenres}'. Will perform fresh search and create context.`);
            }
          } else {
             console.warn("[INITIAL BOOKS] Missing userId or profileId. Cannot access or create genre-specific book pagination state.");
          }

          // globallyRecommendedIdsForCurrentGenres (Set of sanitized IDs) is already fetched and available.
          const recommendationResponse = await handleBookRecommendation({
            userId, profileId, chatId,
            ageRangeToUse: finalAgeRange,
            genresToUse: finalGenres,
            finalNlbOnly: finalNlbOnly, // Use the already determined finalNlbOnly
            isInitialRequest: true,
            currentGenrePaginationBookData: currentGenrePaginationBookState,
            globallyExcludedBookIds: globallyRecommendedIdsForCurrentGenres,
            genrePaginationContextRef: genrePaginationContextRefForBook, // Pass ref to genre-specific context
            dbAdmin,
            MAX_FINAL_RECOMMENDATIONS,
            NLB_FETCH_LIMIT: NLB_FETCH_LIMIT_INITIAL,
            OTHER_FETCH_LIMIT: OTHER_FETCH_LIMIT_INITIAL,
            admin
          });

          // After successful recommendation, update the CHAT-SPECIFIC session
          // so "More Recommendations" in *this chat* knows what genre/type it was.
          if (userId && profileId && chatId) {
            const chatSpecificSessionRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('chatSessions').doc(chatId);
            try {
                await chatSpecificSessionRef.set({
                    lastRecommendationGenre: finalGenres,
                    lastRecommendationType: 'books',
                    lastRecommendationTimestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`[INITIAL BOOKS] Updated chat-specific session ${chatId} with last rec type/genre.`);
            } catch (chatSessionUpdateError) {
                console.error(`[INITIAL BOOKS] Error updating chat-specific session ${chatId}:`, chatSessionUpdateError);
            }
          }
          return recommendationResponse;

        } catch (error) {
          console.error('[INITIAL BOOKS] Error processing book recommendations:', error);
          // Fallback response if llm or data fetching fails critically
          return new NextResponse(
            JSON.stringify({
              response: `Sorry, I had trouble finding book recommendations about *${finalGenres}* for *${finalAgeRange}* year olds. Please try again later.`,
              newTitle: 'Error getting books'
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } else { // Genres are missing (either profile had none and useProfileGenres=true, or useProfileGenres=false and Dialogflow had none)
        const profileHadInterests = Array.isArray(profileData?.interests) && profileData.interests.length > 0;
        console.log(`Book recommendation intent: No final genre determined (useProfileGenres: ${useProfileGenres}, profileHadInterests: ${profileHadInterests}, dialogflowFoundGenres: ${dialogflowGenresArray.length > 0}). Prompting with suggestions.`);
        // Fetch appropriate genres based on content type
        const genreSuggestions = await getFirestoreGenres('book');
        const randomGenrePrompts = shuffleArray([...genreSuggestions]).slice(0, 5);

        // --- Explicitly ask for genre if age is known ---
        let responseText;
        if (finalAgeRange !== null) {
            // Age is known, but genre is missing. Ask for genre.
            console.log(`[Missing Genre Fallback - Books] Age (${finalAgeRange}) known, asking for genre.`);
            responseText = `Okay, I can find books suitable for ${finalAgeRange} year olds. What genre are you interested in?`;
        } else {
            // Both age and genre are missing. Use Dialogflow's text or a generic default.
            console.log(`[Missing Genre Fallback - Books] Age and Genre unknown. Using Dialogflow fulfillment or default.`);
            responseText = result.fulfillmentText || "What genre of books are you interested in, and for what age?";
        }
        // --- End Explicit Genre Ask ---

        return new NextResponse(
          JSON.stringify({
            response: responseText, // Use the determined response text
            prompts: randomGenrePrompts.length > 0 ? randomGenrePrompts : ["Adventure", "Fantasy"] // Use randomized or fallback
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // VIDEOS - Only handle if intent explicitly matches video recommendation
    if ((intentName?.toLowerCase() === 'recommend content' || intentName?.toLowerCase() === 'recommend videos') && finalAgeRange !== null) {
      if (finalGenres) {
        try {
          const YOUTUBE_FETCH_LIMIT_INITIAL = 10;
          let currentGenrePaginationVideoState = { unshownYoutubeVideos: [], nextYoutubePageToken: null };
          let genrePaginationContextRefForVideo;

          if (userId && profileId) { // chatId not strictly needed for genre context
            const sanitizedGenreKey = sanitizeGenreForDocId(finalGenres);
            genrePaginationContextRefForVideo = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('genrePaginationContext').doc(sanitizedGenreKey);
            const genrePaginationSnap = await genrePaginationContextRefForVideo.get();

            if (genrePaginationSnap.exists) {
              const data = genrePaginationSnap.data();
              if (data?.lastRecommendationType === 'videos') { // Genre match is implicit by doc key
                currentGenrePaginationVideoState.unshownYoutubeVideos = data.unshownYoutubeVideos || [];
                currentGenrePaginationVideoState.nextYoutubePageToken = data.nextYoutubePageToken;
                console.log(`[INITIAL VIDEOS] Genre pagination context found for '${finalGenres}'. Using unshown: ${currentGenrePaginationVideoState.unshownYoutubeVideos.length}, token: ${currentGenrePaginationVideoState.nextYoutubePageToken}`);
              } else if (data?.lastRecommendationType) {
                console.log(`[INITIAL VIDEOS] Genre pagination context for '${finalGenres}' exists but is for type '${data.lastRecommendationType}', not 'videos'. Starting fresh for videos.`);
              } else {
                console.log(`[INITIAL VIDEOS] Genre pagination context for '${finalGenres}' exists but is malformed or new. Starting fresh.`);
              }
            } else {
              console.log(`[INITIAL VIDEOS] No genre-specific pagination context found for '${finalGenres}'. Will perform fresh search and create context.`);
            }
          } else {
             console.warn("[INITIAL VIDEOS] Missing userId or profileId. Cannot access or create genre-specific video pagination state.");
          }
          
          // globallyRecommendedIdsForCurrentGenres is already fetched and available.
          const recommendationResponse = await handleVideoRecommendation({
            userId, profileId, chatId,
            ageRangeToUse: finalAgeRange,
            genresToUse: finalGenres,
            isInitialRequest: true,
            currentGenrePaginationVideoData: currentGenrePaginationVideoState,
            globallyExcludedVideoIds: globallyRecommendedIdsForCurrentGenres, 
            genrePaginationContextRef: genrePaginationContextRefForVideo, 
            dbAdmin,
            MAX_FINAL_RECOMMENDATIONS,
            YOUTUBE_API_FETCH_LIMIT: YOUTUBE_FETCH_LIMIT_INITIAL,
            admin
          });

          // After successful recommendation, update the CHAT-SPECIFIC session
          if (userId && profileId && chatId) {
            const chatSpecificSessionRef = dbAdmin.collection('chats').doc(userId).collection('profiles').doc(profileId).collection('chatSessions').doc(chatId);
            try {
                await chatSpecificSessionRef.set({
                    lastRecommendationGenre: finalGenres,
                    lastRecommendationType: 'videos',
                    lastRecommendationTimestamp: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.log(`[INITIAL VIDEOS] Updated chat-specific session ${chatId} with last rec type/genre.`);
            } catch (chatSessionUpdateError) {
                console.error(`[INITIAL VIDEOS] Error updating chat-specific session ${chatId}:`, chatSessionUpdateError);
            }
          }
          return recommendationResponse;

        } catch (error) {
          console.error('[INITIAL VIDEOS] Error processing video recommendations:', error);
          // Fallback response
          return new NextResponse(
            JSON.stringify({
              response: `Sorry, I had trouble finding video recommendations about *${finalGenres}* for *${finalAgeRange}* year olds. Please try again later.`,
              newTitle: 'Error getting videos',
              videos: []
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } else { // Genres are missing (either profile had none and useProfileGenres=true, or useProfileGenres=false and Dialogflow had none)
        const profileHadInterests = Array.isArray(profileData?.interests) && profileData.interests.length > 0;
        console.log(`Video recommendation intent: No final genre determined (useProfileGenres: ${useProfileGenres}, profileHadInterests: ${profileHadInterests}, dialogflowFoundGenres: ${dialogflowGenresArray.length > 0}). Prompting with suggestions.`);
        // Fetch video-specific genres
        const videoGenreSuggestions = await getFirestoreGenres('video');
        const randomGenrePrompts = shuffleArray([...videoGenreSuggestions]).slice(0, 5);

        // --- Explicitly ask for genre if age is known ---
        let responseText;
         if (finalAgeRange !== null) {
            // Age is known, but genre is missing. Ask for genre.
            console.log(`[Missing Genre Fallback - Videos] Age (${finalAgeRange}) known, asking for genre.`);
            responseText = `Got it, videos for ${finalAgeRange} year olds. What topics or genres are you interested in watching?`;
        } else {
            // Both age and genre are missing. Use Dialogflow's text or a generic default.
            console.log(`[Missing Genre Fallback - Videos] Age and Genre unknown. Using Dialogflow fulfillment or default.`);
            responseText = result.fulfillmentText || "What kind of videos are you interested in, and for what age?";
        }
        // --- End Explicit Genre Ask ---

        return new NextResponse(
          JSON.stringify({
            response: responseText, // Use the determined response text
            prompts: randomGenrePrompts.length > 0 ? randomGenrePrompts : ["Adventure", "Animals"] // Use randomized or fallback
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    // Default fallback - ensure we don't mix content types
    const fallbackResponse = {
        response: result.fulfillmentText || "Would you like recommendations for books or videos?",
        prompts: [],
        strictType: 'unknown' // Prevent mixing content types
    };
    return new NextResponse(
      JSON.stringify(fallbackResponse),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Dialogflow API error:', error);
    return new NextResponse(
      JSON.stringify({ error: 'Internal Server Error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        }
    );
    }
}
