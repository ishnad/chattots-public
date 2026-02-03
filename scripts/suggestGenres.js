import path from 'path';
import fs from 'fs/promises';
import { generatellmResponse } from '../src/utils/llmProvider.js'; // Adjust path as needed

const GENRE_FILE_PATH = path.join(process.cwd(), 'src', 'data', 'bookGenres.json');

/**
 * Creates the prompt for the LLM to suggest new genres.
 * @param {Array<string>} existingGenres - List of current genre values.
 * @returns {string} The formatted prompt string.
 */
function createGenreSuggestionPrompt(existingGenres) {
    const existingList = existingGenres.join(', ');
    return `[INST] You are an expert librarian specializing in children's literature.
Your task is to suggest additional common book genres suitable for children (ages 4-12) that are missing from the provided list.

Existing Genres:
${existingList}

Instructions:
- Analyze the "Existing Genres" list.
- Identify common, distinct book genres appropriate for children (ages 4-12) that are NOT already included.
- Focus on broad, recognizable genres. Avoid overly niche or adult-specific genres.
- Provide a list of suggested new genres.
- Format your response as a simple comma-separated list of the suggested genre names ONLY. Do not include explanations, greetings, or any other text.
- Example Output: Historical Fiction, Fables, Poetry, Science Books
[/INST]
Response:`;
}

/**
 * Main function to suggest new genres.
 */
async function suggestNewGenres() {
    console.log("Starting genre suggestion process...");

    // 1. Read existing genres
    let existingGenres = [];
    let existingGenreValues = [];
    try {
        console.log(`Reading existing genres from: ${GENRE_FILE_PATH}`);
        const jsonData = await fs.readFile(GENRE_FILE_PATH, 'utf-8');
        existingGenres = JSON.parse(jsonData);
        if (!Array.isArray(existingGenres)) {
            throw new Error("Genre file does not contain a valid JSON array.");
        }
        // Extract just the 'value' field for comparison and prompting
        existingGenreValues = existingGenres.map(g => g.value?.trim()).filter(Boolean);
        console.log(`Found ${existingGenreValues.length} existing genres.`);
    } catch (error) {
        console.error(`Error reading or parsing genre file: ${error.message}`);
        return; // Stop execution if we can't read the file
    }

    if (existingGenreValues.length === 0) {
        console.warn("Existing genre list is empty. Cannot generate suggestions based on it.");
        // Optionally, you could modify the prompt to ask for a starter list
        return;
    }

    // 2. Create prompt
    const prompt = createGenreSuggestionPrompt(existingGenreValues);

    // 3. Call LLM
    let suggestionsText;
    try {
        console.log("Calling LLM to get genre suggestions...");
        suggestionsText = await generatellmResponse(prompt);
        if (!suggestionsText || typeof suggestionsText !== 'string') {
            throw new Error("LLM returned an empty or invalid response.");
        }
        console.log("Received suggestions from LLM:", suggestionsText);
    } catch (error) {
        console.error(`Error getting suggestions from LLM: ${error.message}`);
        return; // Stop execution if LLM call fails
    }

    // 4. Process LLM response
    // Split by comma, trim whitespace, filter empty strings
    const suggestedGenres = suggestionsText.split(',')
        .map(g => g.trim())
        .filter(g => g.length > 0);

    if (suggestedGenres.length === 0) {
        console.log("LLM did not suggest any new genres.");
        return;
    }

    // 5. Compare and filter
    const existingGenresLower = new Set(existingGenreValues.map(g => g.toLowerCase()));
    const newUniqueSuggestions = suggestedGenres.filter(suggestion =>
        !existingGenresLower.has(suggestion.toLowerCase())
    );

    // 6. Output suggestions
    if (newUniqueSuggestions.length > 0) {
        console.log("\n--- New Genre Suggestions ---");
        console.log("The following genres were suggested by the LLM and are not in your current list:");
        newUniqueSuggestions.forEach(genre => console.log(`- ${genre}`));
        console.log("\n--- New Genre Suggestions ---");
        console.log("The following genres were suggested by the LLM and are not in your current list:");
        newUniqueSuggestions.forEach(genre => console.log(`- ${genre}`));

        // --- Automatically add suggestions to the JSON file ---
        console.log(`\nAutomatically adding ${newUniqueSuggestions.length} new suggestions to ${GENRE_FILE_PATH}...`);
        console.warn("WARNING: Automatically adding LLM suggestions. Review the file for accuracy and add synonyms manually.");

        const newEntries = newUniqueSuggestions.map(genreValue => ({
            value: genreValue,
            synonyms: [] // Add synonyms manually later
        }));

        // Combine existing genres with new entries
        const updatedGenres = [...existingGenres, ...newEntries];

        // Sort alphabetically by value for consistency (optional but recommended)
        updatedGenres.sort((a, b) => a.value.localeCompare(b.value));

        try {
            // Write the updated array back to the file, formatted nicely
            await fs.writeFile(GENRE_FILE_PATH, JSON.stringify(updatedGenres, null, 2), 'utf-8');
            console.log(`Successfully updated ${GENRE_FILE_PATH}.`);
            console.log("IMPORTANT: Please review the updated file and add appropriate synonyms for the new entries.");
        } catch (writeError) {
            console.error(`Error writing updated genres back to file: ${writeError.message}`);
        }
        // --- End automatic update ---

    } else {
        console.log("\n--- No New Genres Found ---");
        console.log("The LLM's suggestions did not contain any genres that aren't already in your list or the LLM provided no suggestions.");
    }

    console.log("\nGenre suggestion process finished.");
}

suggestNewGenres().catch(error => {
    console.error("An unexpected error occurred:", error);
    process.exit(1);
});
