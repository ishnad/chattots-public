import fetch from 'node-fetch';

const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;

// Add limit and page parameters with default values
export async function searchBooks(ageRange, genre, limit = 10, page = 1) {
  try {
    // Calculate startIndex (0-based)
    const startIndex = (page - 1) * limit;

    let query = `intitle:${genre || ''} children's books`;
    if (ageRange) {
      query += ` for kids age ${ageRange}`; // Updated age range query
    }

    // Use the limit and startIndex parameters in the URL
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&key=${GOOGLE_BOOKS_API_KEY}&maxResults=${limit}&startIndex=${startIndex}`;
    console.log(`Google Books API Request (Page ${page}): ${url}`); // Log the URL with page info

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Books API Error:', {
        url,
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      return [];
    }

    const data = await response.json();
    if (data.error) {
      console.error('Google Books API error:', data.error);
      return [];
    }

    if (!data.items) {
      console.log('Google Books API: No items found in response');
      return [];
    }

    // First filter by basic validity
    const validBooks = data.items
      .filter(item => item.volumeInfo?.title && item.volumeInfo.title.trim() !== "")
      .map(item => {
        const volumeInfo = item.volumeInfo;
        return {
          id: item.id, // Google's volume ID
          title: volumeInfo.title.trim(),
          authors: volumeInfo.authors || null,
          description: volumeInfo.description || null,
          coverUrl: volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail || null,
          url: volumeInfo.infoLink || null,
          publishedDate: volumeInfo.publishedDate || null,
          publisher: volumeInfo.publisher || null,
          pageCount: volumeInfo.pageCount || null,
          categories: volumeInfo.categories || null,
          source: 'Google Books', // Added source
          // Fields to ensure consistency, defaulting to null
          callNumber: null,
        };
      });

    if (!ageRange) return validBooks;

    // Filter books by age appropriateness using LLM if ageRange is provided
    if (validBooks.length > 0 && ageRange) {
      try {
        console.log(`Filtering ${validBooks.length} Google Books for age ${ageRange} using LLM...`);
        const prompt = `[INST] You are a helpful children's librarian assistant. Please analyze these book titles and indicate which are appropriate for a ${ageRange} year old child. 

RULES:
1. ONLY respond with the numbers of the appropriate books (1-${validBooks.length}) 
2. Separate numbers by commas (e.g. "1,3,5")
3. Do NOT include any other text or explanations
4. Be inclusive - if a book could be appropriate, include it

Here are the books:\n\n${
          validBooks.map((book, i) => `${i+1}. ${book.title} by ${book.authors?.[0] || 'Unknown'}`).join('\n')
        }[/INST]`;
        
        const llmResponse = await generatellmResponse(prompt);
        console.log(`LLM age filtering response for Google Books: ${llmResponse}`);
        
        const approvedIndices = new Set(
          llmResponse.split(',')
            .map(num => parseInt(num.trim()) - 1)
            .filter(num => !isNaN(num) && num >= 0 && num < validBooks.length)
        );
        
        console.log(`LLM approved ${approvedIndices.size} Google Books as age-appropriate`);
        return validBooks.filter((_, index) => approvedIndices.has(index));
      } catch (error) {
        console.error('Error filtering Google Books by age using LLM:', error);
        return validBooks; // Return all books if LLM filtering fails
      }
    }
  } catch (error) {
    console.error('Error searching Google Books API:', error);
    return [];
  }
}
