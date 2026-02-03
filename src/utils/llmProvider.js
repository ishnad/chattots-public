// chattots/src/utils/llmProvider.js
import fetch from 'node-fetch'; // Or use global fetch available in Next.js API routes

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const YOUR_SITE_URL = "https://chattots.vercel.app/"; // Replace with your actual site URL
const YOUR_APP_NAME = "chattots"; // Replace with your app name

// --- Prompt Creation Functions ---

/**
 * Creates the llm prompt for initial book recommendations.
 * @param {number} age Target age.
 * @param {string} genres Requested genres.
 * @param {Array<object>} bookData Array of book objects ({ title, authors, link, coverUrl, source, callNumber? }).
 * @param {number} maxToSummarize The maximum number of books the LLM should select and summarize.
 * @returns {string} The formatted prompt string.
 */
export function createInitialBookPrompt(age, genres, bookData, maxToSummarize) {
  const booksList = bookData.length > 0
    ? bookData.map(b => `- Title: "${b.title}", Authors: ${b.authors}, Link: ${b.link || 'N/A'}, Cover: ${b.coverUrl || 'N/A'}, Source: ${b.source}`).join('\n')
    : 'None found.';

  return `[INST] You are a friendly and helpful chatbot assistant speaking directly **to a child** (${age} years old). Your primary user is the child.

User Request Context:
- Target Age: ${age} years old
- Requested Genres: ${genres}

Books Found (Consider all of these for relevance):
${booksList}

Instructions:
 - Generate a friendly and conversational message **speaking directly to the child** (who is ${age} years old), acknowledging their request for books about "${genres}". Use "you" to refer to the child.
 - Review ALL books listed in "Books Found" for relevance to the requested genres: "${genres}".
 - From the relevant books, select **up to ${maxToSummarize} of the MOST SUITABLE books** for the child.
 - In your response, **ONLY mention the titles of these selected (up to ${maxToSummarize}) books**.
 - For each of these selected books, **provide a short (1-2 sentence), engaging summary suitable for a child**. Weave the title and summary naturally into the conversation.
 - **Bold the book titles using Markdown (e.g., **Book Title**) just like you do for video titles.**
 - **Do NOT include authors, Markdown links, or image tags for the books.** The frontend will display detailed book cards separately based on the titles you mention.
 - Keep the overall tone engaging, positive, and **appropriate for speaking to a child**.
 - Example start (if ${maxToSummarize} books selected and maxToSummarize was 2 or more): "Great! Since **you** like ${genres}, I found a couple of books **you** might enjoy. There's **Book A**, which is about [short, engaging summary]. And **you** might also like **Book B**, where [short, engaging summary]. Check them out below!"
 - If no books from the list are deemed suitable, or if "Books Found" was 'None found.': "Hmm, I looked for ${genres} books, but couldn't find any suitable ones this time. Maybe we could try searching for a different topic?"
 [/INST]
Response:`;
}

/**
 * Creates the llm prompt for initial video recommendations.
 * @param {number} age Target age.
 * @param {string} genres Requested genres/topics.
 * @param {Array<object>} videoData Array of video objects ({ title, channel, link, thumbnail }). Top 4 expected.
 * @returns {string} The formatted prompt string.
 */
export function createInitialVideoPrompt(age, genres, videoData) {
  const videoListJson = JSON.stringify(videoData); // Already formatted in route.js, just pass it

  return `[INST] You are a friendly and helpful chatbot assistant speaking directly **to a child** (${age} years old). Your primary user is the child. Your task is to present YouTube video recommendations based on the data provided below.

User Request Context:
- Target Age: ${age} years old
- Requested Genres/Topics: ${genres}

Videos Found (from YouTube):
${videoListJson}

Instructions:
- Generate a friendly, conversational response **speaking directly to the child**, introducing all 4 YouTube video recommendations.
- Address the child directly (e.g., "Here are some cool videos I found for **you**...", "**You** should check these out!").
- For EACH of the 4 videos:
  - Mention the video by title (bold it using **)
  - Provide a 1-2 sentence engaging description suitable for the child's age
  - Include a smooth transition to the next video
- Structure should be: 
  1. Friendly greeting mentioning the genre/theme
  2. Video 1 with description
  3. Video 2 with description  
  4. Video 3 with description
  5. Video 4 with description
  6. Closing encouragement
- Keep the tone engaging and **appropriate for speaking to a ${age}-year-old child**.
- Example: 
"Hey there! I found 4 exciting videos about ${genres} that I think you'll love!
First up is **Video 1 Title**, which shows [fun description]...
Next, check out **Video 2 Title** where [description]...
You might also enjoy **Video 3 Title** because [description]...
And finally don't miss **Video 4 Title**, it's about [description]...
Have fun watching these awesome videos!" 
[/INST]
Response:`;
}

/**
 * Creates the llm prompt for "more" book recommendations.
 * @param {number} age Target age.
 * @param {string} genres Previously requested genres.
 * @param {Array<object>} bookData Array of *new* book objects ({ title, authors, link, coverUrl, source, callNumber? }).
 * @param {number} maxToSummarize The maximum number of new books the LLM should select and summarize.
 * @returns {string} The formatted prompt string.
 */
export function createMoreBooksPrompt(age, genres, bookData, maxToSummarize) {
    const booksList = bookData.length > 0
        ? bookData.map(b => `- Title: "${b.title}", Authors: ${b.authors}, Link: ${b.link || 'N/A'}, Cover: ${b.coverUrl || 'N/A'}, Source: ${b.source}`).join('\n')
        : 'None found.';

    return `[INST] You are a friendly and helpful chatbot assistant speaking directly **to a child** (${age} years old). The child asked for *more* recommendations based on a previous request.

Previous Request Context:
- Target Age: ${age} years old
- Requested Genres: ${genres}

More Books Found (Consider all of these for relevance, these are different from previous recommendations):
${booksList}

Instructions:
 - Generate a friendly and conversational message **speaking directly to the child** (who is ${age} years old), acknowledging they asked for *more* books about "${genres}". Use "you" to refer to the child.
 - Indicate that these are *different* books from the ones recommended before.
 - Review ALL *new* books listed in "More Books Found" for relevance to the requested genres: "${genres}".
 - From the relevant new books, select **up to ${maxToSummarize} of the MOST SUITABLE new books** for the child.
 - In your response, **ONLY mention the titles of these selected (up to ${maxToSummarize}) new books**.
 - For each of these selected new books, **provide a short (1-2 sentence), engaging summary suitable for a child**. Weave the title and summary naturally into the conversation.
 - **Bold the book titles using Markdown (e.g., **Book Title**) just like you do for video titles.**
 - **Do NOT include authors, Markdown links, or image tags for the books.** The frontend will display the detailed book cards separately based on the titles you mention.
 - Keep the overall tone engaging, positive, and **appropriate for speaking to a child**.
 - Example start (if ${maxToSummarize} books selected and maxToSummarize was 2 or more): "Okay! **You** wanted more books about ${genres}? Here are a couple of different ones I found for **you**. There's **Book X**, which is about [short, engaging summary]. And **you** might also like **Book Y**, where [short, engaging summary]. Take a look!"
 - If no new books from the list are deemed suitable, or if "More Books Found" was 'None found.': "Hmm, I looked for more ${genres} books, but couldn't find any different ones this time. Maybe we could try searching for a different topic?"
 [/INST]
Response:`;
}

/**
 * Creates the llm prompt for "more" video recommendations.
 * @param {number} age Target age.
 * @param {string} genres Previously requested genres/topics.
 * @param {Array<object>} videoData Array of *new* video objects ({ title, channel, link, thumbnail }). Top 4 expected.
 * @returns {string} The formatted prompt string.
 */
export function createMoreVideosPrompt(age, genres, videoData) {
    const videoListJson = JSON.stringify(videoData.map(({ id, ...rest }) => rest)); // Exclude ID from prompt data

    return `[INST] You are a friendly and helpful chatbot assistant speaking directly **to a child** (${age} years old). The child asked for *more* video recommendations based on a previous request.

Previous Request Context:
- Target Age: ${age} years old
- Requested Genres/Topics: ${genres}

More Videos Found (Different from previous recommendations):
${videoListJson}

Instructions:
- Generate a friendly, conversational response **speaking directly to the child**, introducing all 4 YouTube video recommendations.
- Address the child directly (e.g., "Here are some cool videos I found for **you**...", "**You** should check these out!").
- Indicate that these are *different* videos from the ones recommended before.
- Mention the *new* videos listed in the "More Videos Found" data provided above.
- Weave the titles of the videos found into your response naturally. **Make sure to bold the video title using Markdown (e.g., **Video Title**).**
- **Do not** include Markdown links or image tags. The video embeds will be handled separately.
- Keep the tone engaging and **appropriate for speaking to a ${age}-year-old child**.
- Example structure: "**You** got it! Looking for more videos about ${genres}? Here are some different ones for **you**: First up is **${videoData[0]?.title || 'the first new video'}**. Then there's **${videoData[1]?.title || 'another new one'}**..." (Adapt based on actual videos found, and handle cases where fewer than 2 videos might be present).
[/INST]
Response:`;
}


// --- API Call Function ---

/**
 * Generates a conversational response using the llm model based on a detailed prompt.
 *
 * @param {string} prompt The detailed prompt including context, data, and instructions for the model.
 * @returns {Promise<string>} A promise that resolves to the generated text response from the model.
 * @throws {Error} If the API call fails or the response structure is unexpected.
 */
export async function generatellmResponse(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY; // Use OPENROUTER_API_KEY

  if (!apiKey) {
    console.error("OpenRouter API key (OPENROUTER_API_KEY) is missing from environment variables.");
    throw new Error("Server configuration error: Missing OpenRouter API key.");
  }

  // Log more of the prompt for debugging OpenRouter 500 errors.
  const promptLogSuffix = prompt.length > 1000 ? `... (prompt length: ${prompt.length})` : "";
  console.log("Sending prompt to OpenRouter/llm (start):", prompt.substring(0, 1000) + promptLogSuffix);

  const callStartTime = Date.now(); // Record start time

  const controller = new AbortController();
  const timeoutDuration = 45000; // 45-second timeout
  const timeoutId = setTimeout(() => {
    const elapsed = Date.now() - callStartTime;
    console.log(`[LLM PROVIDER TIMEOUT] AbortController.abort() called after ${elapsed}ms (configured for ${timeoutDuration}ms).`);
    controller.abort();
  }, timeoutDuration);

  try {
    const instructionMatch = prompt.match(/\[INST\]([\s\S]*?)\[\/INST\]/);
    const userInstruction = instructionMatch ? instructionMatch[1].trim() : prompt;

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': YOUR_SITE_URL,
        'X-Title': YOUR_APP_NAME,
      },
      body: JSON.stringify({
        model: "mistralai/mistral-7b-instruct:free", // Changed model
        messages: [
          { role: "user", content: userInstruction }
        ],
        temperature: 0.7,
        max_tokens: 1500, 
      }),
      signal: controller.signal
    });

    const fetchEndTime = Date.now();
    console.log(`[LLM PROVIDER] Fetch call completed in ${fetchEndTime - callStartTime}ms.`);
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text();
      // Log the full prompt if OpenRouter returns an error
      console.error(`OpenRouter API Error: ${response.status} ${response.statusText}. Prompt sent:\n---\n${prompt}\n---\nError Body:`, errorBody);
      throw new Error(`OpenRouter API request failed with status ${response.status}: ${errorBody}`);
    }

    const result = await response.json();

    if (result && result.error && result.error.message) {
      // Log the full prompt if OpenRouter returns an error object
      console.error("OpenRouter API returned an error object:", result.error, "Prompt sent:\n---\n" + prompt + "\n---");
      throw new Error(`OpenRouter API error: ${result.error.message} (Code: ${result.error.code || 'N/A'})`);
    }

    if (result && result.choices && result.choices[0] && result.choices[0].message && typeof result.choices[0].message.content === 'string') {
      const generatedText = result.choices[0].message.content.trim();
      // Log only the beginning of the generated text for brevity
      console.log("Generated text from OpenRouter/llm:", generatedText.substring(0, 200) + (generatedText.length > 200 ? "..." : ""));
      const cleanText = generatedText.split("Response:").pop().trim();
      return cleanText;
    } else {
      console.error("Unexpected response structure from OpenRouter API. Result:", result, "Prompt sent:\n---\n" + prompt + "\n---");
      throw new Error("Unexpected response structure from OpenRouter API. Expected choices[0].message.content string.");
    }

  } catch (error) {
    const catchTime = Date.now();
    const elapsedInCatch = catchTime - callStartTime;
    clearTimeout(timeoutId); 

    if (error.name === 'AbortError') {
      // This is our client-side timeout
      console.error(`[LLM PROVIDER ABORT_ERROR] OpenRouter API call aborted by client-side timeout after ${elapsedInCatch}ms. Error:`, error.message);
      throw new Error('LLM request timed out.'); 
    } else {
      // This is any other error, including errors from OpenRouter (like the 500) or network issues
      console.error(`[LLM PROVIDER OTHER_ERROR] Error during OpenRouter API call or processing. Elapsed time: ${elapsedInCatch}ms. Error Message: ${error.message}. Full Error:`, error);
      // Re-throw the original error message, or a more generic one if preferred
      throw new Error(error.message || 'Error processing LLM request.'); 
    }
  }
}
