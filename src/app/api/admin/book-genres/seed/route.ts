import { NextResponse } from 'next/server';
import { db, verifyAdminToken } from '@/lib/firebaseAdmin';
import fs from 'fs/promises'; // Use promises version of fs
import path from 'path';

// Define the expected structure of an entry in the JSON file
interface GenreSeedData {
  value: string;
  synonyms?: string[];
  emoji?: string | null;
}

export async function POST(request: Request) {
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin status first

    // --- Read the local JSON file ---
    // Construct the absolute path to the JSON file
    // process.cwd() gives the root of the Next.js project
    const jsonFilePath = path.join(process.cwd(), 'src', 'data', 'bookGenres.json');
    console.log(`Attempting to read seed file from: ${jsonFilePath}`);

    let genresToSeed: GenreSeedData[];
    try {
        const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
        genresToSeed = JSON.parse(fileContent);
        if (!Array.isArray(genresToSeed)) {
            throw new Error('Invalid JSON format: Expected an array.');
        }
        console.log(`Successfully read ${genresToSeed.length} genres from ${jsonFilePath}`);
    } catch (readError) {
        console.error(`Error reading or parsing ${jsonFilePath}:`, readError);
        throw new Error(`Failed to read or parse seed file: ${jsonFilePath}. Details: ${readError instanceof Error ? readError.message : String(readError)}`);
    }
    // --- End Read JSON file ---


    // --- Write to Firestore using Batch ---
    const batch = db.batch();
    // Ensure we're using the correct collection name with proper validation
    const genresCollectionRef = db.collection('bookGenres');
    
    // First delete all existing book genres to prevent mixing
    console.log('Clearing existing book genres collection...');
    const existingGenres = await genresCollectionRef.get();
    const deleteBatch = db.batch();
    existingGenres.forEach(doc => {
        deleteBatch.delete(doc.ref);
    });
    await deleteBatch.commit();
    let count = 0;

    genresToSeed.forEach((genreData) => {
      if (genreData && typeof genreData.value === 'string' && genreData.value.trim()) {
        // Use the 'value' field as the document ID for simplicity and idempotency
        // Normalize the value for use as an ID (e.g., lowercase, replace spaces)
        // Or, let Firestore auto-generate IDs if preferred (remove .doc(docId))
        // For this example, let's use the value directly, assuming it's unique enough
        // Consider potential ID collisions or invalid characters if values are complex.
        // A safer approach might be to hash the value or use a slugified version.
        // Let's stick to auto-generated IDs for robustness here.
        const docRef = genresCollectionRef.doc(); // Auto-generate ID

        const cleanSynonyms = Array.isArray(genreData.synonyms)
          ? genreData.synonyms.map(s => String(s).trim()).filter(s => s !== '')
          : [];

        batch.set(docRef, {
          value: genreData.value.trim(),
          synonyms: cleanSynonyms,
          emoji: genreData.emoji || null // Preserve emoji from JSON if it exists
        });
        count++;
      } else {
          console.warn("Skipping invalid genre entry during seed:", genreData);
      }
    });

    if (count === 0) {
        return NextResponse.json({ message: 'No valid genres found in the seed file to add.' }, { status: 200 });
    }

    await batch.commit();
    console.log(`Admin ${decodedToken.uid} successfully seeded ${count} book genres into Firestore.`);
    // --- End Write to Firestore ---

    return NextResponse.json({ message: `Successfully seeded ${count} book genres.` }, { status: 200 });

  } catch (error) {
    console.error('Error in POST /api/admin/book-genres/seed:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
      status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('Failed to read')) {
        status = 500; // Indicate server-side file read issue
    }
    return NextResponse.json({ error: 'Failed to seed book genres', details: errorMessage }, { status });
  }
}
