import fetch from 'node-fetch';
import { generatellmResponse } from './llmProvider';

export async function searchK12Books(genre, limit = 5, page = 1, ageRange = null) { // Add ageRange parameter
  try {
    // Calculate offset (0-based)
    const offset = (page - 1) * limit;

    // Use the limit and offset parameters in the URL
    const url = `https://openlibrary.org/search.json?subject=${encodeURIComponent(genre)}&limit=${limit}&offset=${offset}`;
    console.log(`Open Library API Request (Page ${page}): ${url}`); // Log the URL with page info

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Open Library API Error:', {
        url,
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      return [];
    }

    const data = await response.json();
    if (!data.docs || data.docs.length === 0) {
      console.log('Open Library API: No documents found');
      return [];
    }

    // First filter by basic validity
    const validBooks = data.docs
      .filter(book => book.title && book.title.trim() !== "" && book.key)
      .map(book => ({
        id: book.key, // OpenLibrary key (e.g., /works/OL...W)
        title: book.title.trim(),
        authors: book.author_name || null, // author_name is usually an array
        description: book.first_sentence_value || null, // Often 'first_sentence_value' is available
        coverUrl: book.cover_i ? `https://covers.openlibrary.org/b/id/${book.cover_i}-M.jpg` : null,
        url: `https://openlibrary.org${book.key}`,
        publishedDate: book.first_publish_year ? String(book.first_publish_year) : null,
        publisher: book.publisher ? (Array.isArray(book.publisher) ? book.publisher[0] : book.publisher) : null,
        pageCount: book.number_of_pages_median || null,
        categories: book.subject || null, // subject is usually an array of strings
        source: 'Open Library', // Added source, distinct from K12 if needed later
        // Fields to ensure consistency, defaulting to null
        callNumber: null,
      }));

    if (!ageRange) return validBooks;

    // Filter books by age appropriateness using LLM if ageRange is provided
    if (validBooks.length > 0 && ageRange) {
      try {
        console.log(`Filtering ${validBooks.length} Open Library books for age ${ageRange} using LLM...`);
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
        console.log(`LLM age filtering response for Open Library: ${llmResponse}`);
        
        const approvedIndices = new Set(
          llmResponse.split(',')
            .map(num => parseInt(num.trim()) - 1)
            .filter(num => !isNaN(num) && num >= 0 && num < validBooks.length)
        );
        
        console.log(`LLM approved ${approvedIndices.size} Open Library books as age-appropriate`);
        return validBooks.filter((_, index) => approvedIndices.has(index));
      } catch (error) {
        console.error('Error filtering Open Library books by age using LLM:', error);
        return validBooks; // Return all books if LLM filtering fails
      }
    }
    return validBooks; // Return books if no age filtering was needed
  } catch (error) {
    console.error('Error fetching books from Open Library:', error);
    return [];
  }
}