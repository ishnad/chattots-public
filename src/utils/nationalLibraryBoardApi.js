import fetch from 'node-fetch';
import { generatellmResponse } from './llmProvider';

const NLB_APP_ID = process.env.NLB_APP_ID || 'DEV-MDanish';
const NLB_APP_CODE = process.env.NLB_APP_CODE;
const NLB_API_KEY = process.env.NLB_API_KEY;
const BASE_URL = 'https://openweb.nlb.gov.sg/api/v2/Catalogue';

export async function searchNLBBooks(ageRange, genre, page = 1, limit = 10) {
    try {
        // Validate credentials
        if (!NLB_APP_CODE || !NLB_API_KEY) {
            console.error('NLB_APP_CODE or NLB_API_KEY is not set in environment variables');
            return [];
        }

        // Validate parameters
        if (!genre || typeof genre !== 'string') {
            throw new Error('Invalid genre parameter');
        }
        
        // Validate ageRange and determine intended audience
        let intendedAudiences = 'Junior'; // Default audience
        if (ageRange <= 6) {
            intendedAudiences = 'Early Literacy';
        } else if (ageRange <= 12) {
            intendedAudiences = 'Junior';
        } else { // ageRange > 12 and <= 18
            intendedAudiences = 'Teen';
        }
        console.log(`Using IntendedAudience: ${intendedAudiences} for age ${ageRange}`);
        // Standard offset calculation required by API
        const offset = (page - 1) * limit;

        const queryParams = new URLSearchParams({
            Keywords: genre + ", English",
            Offset: offset,
            IntendedAudience: intendedAudiences, // Use the determined audience
            Language: 'eng',
            Format: 'bks', // Search for Books
            Limit: limit
        });

        const url = `${BASE_URL}/SearchTitles?${queryParams.toString()}`;
        console.log(`NLB API Request: ${url}`);

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'x-app-id': NLB_APP_ID,
                'x-app-code': NLB_APP_CODE,
                'x-api-key': NLB_API_KEY,
                'User-Agent': 'Chattots/1.0'
            },
            timeout: 20000 // Increased timeout to 20 seconds
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('NLB API Error:', {
                url,
                status: response.status,
                statusText: response.statusText,
                error: errorText,
                requestParams: Object.fromEntries(queryParams)
            });
            
            if (response.status === 403) {
                console.error('NLB API Access Denied. Please check:');
                console.error('1. NLB_APP_ID, NLB_APP_CODE and NLB_API_KEY are set correctly in environment variables');
                console.error('2. The application credentials have proper permissions');
                console.error('3. The API key is valid and not expired');
                console.error('3. The request headers are properly formatted');
            }
            
            return []; // Return empty array instead of throwing error
        }

        const data = await response.json();
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid API response format');
        }
        
        // Check the response structure for SearchTitles
        if (!data.titles || !Array.isArray(data.titles)) {
            console.log('No titles found or invalid format from SearchTitles endpoint');
            return [];
        }

        // Log the raw response data for debugging (Moved inside try block)
        console.log('Raw NLB API Response:', JSON.stringify(data, null, 2));


        const books = data.titles;

        if (books.length === 0) {
            console.log('No books found matching the criteria');
            return [];
        }

        // --- REMOVED: Explicit English language filter ---
        // We will rely on the API's Language=eng parameter and let the LLM handle any outliers.
        // const englishBooks = books.filter(book => { ... });
        // console.log(`Filtered ${books.length} raw results down to ${englishBooks.length} English books.`);
        // --- END REMOVED FILTER ---


        // Process results based on the SearchTitles structure
        const nlbBaseCoverUrl = 'https://www.nlb.gov.sg'; // Base URL for relative cover images

        const mappedBooksPromises = books
          .filter(book => book.title && book.title.trim() !== "") // Filter out books without valid titles
          .map(async (book) => {
            const firstRecord = book.records && book.records.length > 0 ? book.records[0] : null;
            
            let finalCoverUrl = null;
            if (book.CoverImg) { // CoverImg seems to be the field from GetTitleDetails, SearchTitles might use coverUrl object
                finalCoverUrl = String(book.CoverImg).startsWith('/') ? `${nlbBaseCoverUrl}${book.CoverImg}` : book.CoverImg;
            } else if (book.coverUrl) {
                const path = book.coverUrl.medium || book.coverUrl.small;
                if (path) {
                    finalCoverUrl = String(path).startsWith('/') ? `${nlbBaseCoverUrl}${path}` : path;
                }
            }

            const recordId = firstRecord?.brn ? String(firstRecord.brn) : null;
            const nlbCardBaseUrl = 'https://catalogue.nlb.gov.sg/search/card';
            const nlbSearchBaseUrl = 'https://catalogue.nlb.gov.sg/search?query=';
            
            // Prioritize BRN for direct card link, then BID, then title search as fallback
            let bookUrl;
            if (recordId) {
                bookUrl = `${nlbCardBaseUrl}?recordId=${recordId}`;
            } else if (book.BID) {
                bookUrl = `${nlbCardBaseUrl}?bid=${book.BID}`;
            } else if (book.title) {
                bookUrl = `${nlbSearchBaseUrl}${encodeURIComponent(book.title.trim())}`;
            } else {
                bookUrl = null;
            }
            
            const bookId = book.BID || recordId || `nlb_${book.title?.trim().replace(/\s/g, '_') || Date.now()}`;

            return {
                id: bookId,
                title: book.title.trim(),
                authors: book.author ? book.author.split(';').map(a => a.trim()) : (firstRecord?.otherAuthors || ['Unknown Author']),
                description: firstRecord?.summary?.[0] || firstRecord?.subjects?.[0] || null,
                coverUrl: finalCoverUrl,
                url: bookUrl,
                publisher: firstRecord?.publisher?.[0] || null,
                publishYear: firstRecord?.publishDate ? firstRecord.publishDate.split('-')[0] : null,
                isbn: firstRecord?.isbns?.[0] || null,
                callNumber: firstRecord?.callNumber || null, // Assuming callNumber might be in records
                language: firstRecord?.language?.[0] || null,
                format: firstRecord?.format?.name || null,
                source: 'National Library Board (NLB)', // Added source
                // Fields to ensure consistency with other sources, defaulting to null
                pageCount: null,
                categories: firstRecord?.subjects || null,
                physicalCopyExists: typeof book.physicalCopyExists === 'boolean' ? book.physicalCopyExists : null, // from previous mapping
                status: book.status || null, // from previous mapping
                mediaCode: book.mediaCode || null, // from previous mapping
                branchName: book.branchName || null, // from previous mapping
            };
        });

        const resolvedMappedBooks = (await Promise.all(mappedBooksPromises)).filter(Boolean); // Filter out any nulls if a book was skipped

        // Filter books by age appropriateness using LLM if ageRange is provided
        if (resolvedMappedBooks.length > 0 && ageRange) { // Only filter if there are books and an age range
            try {
                console.log(`Filtering ${resolvedMappedBooks.length} NLB books for age ${ageRange} using LLM...`);
                const prompt = `[INST] You are a helpful children's librarian assistant. Please analyze these book titles and indicate which are appropriate for a ${ageRange} year old child. 

RULES:
1. ONLY respond with the numbers of the appropriate books (1-${resolvedMappedBooks.length}) 
2. Separate numbers by commas (e.g. "1,3,5")
3. Do NOT include any other text or explanations
4. Be inclusive - if a book could be appropriate, include it

Here are the books:\n\n${
                    resolvedMappedBooks.map((book, i) => `${i+1}. ${book.title} by ${book.authors?.[0] || 'Unknown'}`).join('\n')
                }[/INST]`;
                
                const llmResponse = await generatellmResponse(prompt);
                console.log(`LLM age filtering response for NLB: ${llmResponse}`);
                
                const approvedIndices = new Set(
                    llmResponse.split(',')
                        .map(num => parseInt(num.trim()) - 1)
                        .filter(num => !isNaN(num) && num >= 0 && num < resolvedMappedBooks.length)
                );
                
                console.log(`LLM approved ${approvedIndices.size} NLB books as age-appropriate`);
                return resolvedMappedBooks.filter((_, index) => approvedIndices.has(index));
            } catch (error) {
                console.error('Error filtering NLB books by age using LLM:', error);
                return resolvedMappedBooks; // Return all resolved books if LLM filtering fails
            }
        }
        return resolvedMappedBooks; // Return if no ageRange or no books to filter
    } catch (error) {
        console.error('Error searching NLB API:', {
            error: error.message,
            stack: error.stack
        });
        return [];
    }
}
