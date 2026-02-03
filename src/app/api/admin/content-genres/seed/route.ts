import { NextResponse } from 'next/server';
import { db, verifyAdminToken } from '@/lib/firebaseAdmin';
import fs from 'fs/promises';
import path from 'path';

interface GenreSeedData {
  value: string;
  synonyms?: string[];
  emoji?: string | null;
}

export async function POST(request: Request) {
  try {
    const decodedToken = await verifyAdminToken();

    const jsonFilePath = path.join(process.cwd(), 'src', 'data', 'contentGenres.json');
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

    const batch = db.batch();
    // Ensure we're using the correct collection name with proper validation
    const genresCollectionRef = db.collection('contentGenres');
    
    // First delete all existing content genres to prevent mixing
    console.log('Clearing existing content genres collection...');
    const existingGenres = await genresCollectionRef.get();
    const deleteBatch = db.batch();
    existingGenres.forEach(doc => {
        deleteBatch.delete(doc.ref);
    });
    await deleteBatch.commit();
    let count = 0;

    genresToSeed.forEach((genreData) => {
      if (genreData && typeof genreData.value === 'string' && genreData.value.trim()) {
        const docRef = genresCollectionRef.doc();
        const cleanSynonyms = Array.isArray(genreData.synonyms)
          ? genreData.synonyms.map(s => String(s).trim()).filter(s => s !== '')
          : [];

        batch.set(docRef, {
          value: genreData.value.trim(),
          synonyms: cleanSynonyms,
          emoji: genreData.emoji || null
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
    console.log(`Admin ${decodedToken.uid} successfully seeded ${count} content genres into Firestore.`);

    return NextResponse.json({ message: `Successfully seeded ${count} content genres.` }, { status: 200 });

  } catch (error) {
    console.error('Error in POST /api/admin/content-genres/seed:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
      status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('Failed to read')) {
        status = 500;
    }
    return NextResponse.json({ error: 'Failed to seed content genres', details: errorMessage }, { status });
  }
}
