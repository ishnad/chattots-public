import { NextResponse } from 'next/server';
import { db, verifyAdminToken } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

interface UpdateGenrePayload {
  value?: string;
  synonyms?: string[];
  emoji?: string | null; // Add optional emoji
}

// Helper function to get genreId from URL parameters
function getGenreId(request: Request): string | null {
    // Example URL: /api/admin/book-genres/some-genre-id
    // Need to extract 'some-genre-id'
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/');
    // Find the segment after 'book-genres'
    const genreIdIndex = pathSegments.findIndex(segment => segment === 'book-genres') + 1;
    return pathSegments[genreIdIndex] || null;
}


export async function PATCH(request: Request) {
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin status
    const genreId = getGenreId(request);

    if (!genreId) {
        return NextResponse.json({ error: 'Missing genre ID in URL path' }, { status: 400 });
    }

    const payload: UpdateGenrePayload = await request.json();
    const { value, synonyms, emoji } = payload; // Destructure emoji

    const updateData: { value?: string; synonyms?: string[]; emoji?: string | null; updatedAt?: FieldValue } = {}; // Add emoji to type
    let hasUpdate = false;

    if (value !== undefined) {
        if (typeof value !== 'string' || value.trim() === '') {
            return NextResponse.json({ error: 'Invalid genre value provided' }, { status: 400 });
        }
        updateData.value = value.trim();
        hasUpdate = true;
    }

    if (synonyms !== undefined) {
        if (!Array.isArray(synonyms)) {
             return NextResponse.json({ error: 'Invalid synonyms format, expected an array' }, { status: 400 });
        }
        updateData.synonyms = synonyms.map(s => String(s).trim()).filter(s => s !== '');
        hasUpdate = true;
    }

    // Handle emoji update (allow setting to null or empty string to clear it)
    if (emoji !== undefined) {
        updateData.emoji = (typeof emoji === 'string' && emoji.trim()) ? emoji.trim() : null;
        hasUpdate = true;
    }


    if (!hasUpdate) {
        return NextResponse.json({ message: 'No update data provided' }, { status: 200 });
    }

    // Add an update timestamp
    // updateData.updatedAt = FieldValue.serverTimestamp();

    const genreRef = db.collection('bookGenres').doc(genreId);

    // Check if document exists before updating (optional but good practice)
    const docSnap = await genreRef.get();
    if (!docSnap.exists) {
        return NextResponse.json({ error: `Genre with ID ${genreId} not found` }, { status: 404 });
    }

    await genreRef.update(updateData);

    console.log(`Admin ${decodedToken.uid} updated book genre ${genreId}`);

    return NextResponse.json({ message: `Genre ${genreId} updated successfully` });

  } catch (error) {
    console.error(`Error in PATCH /api/admin/book-genres/[genreId]:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
      status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('not found')) {
        status = 404;
    }
    return NextResponse.json({ error: 'Failed to update book genre', details: errorMessage }, { status });
  }
}

export async function DELETE(request: Request) {
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin status
    const genreId = getGenreId(request);

     if (!genreId) {
        return NextResponse.json({ error: 'Missing genre ID in URL path' }, { status: 400 });
    }

    const genreRef = db.collection('bookGenres').doc(genreId);

    // Check if document exists before deleting (optional but good practice)
    const docSnap = await genreRef.get();
    if (!docSnap.exists) {
        return NextResponse.json({ error: `Genre with ID ${genreId} not found` }, { status: 404 });
    }

    await genreRef.delete();

    console.log(`Admin ${decodedToken.uid} deleted book genre ${genreId}`);

    return NextResponse.json({ message: `Genre ${genreId} deleted successfully` });

  } catch (error) {
    console.error(`Error in DELETE /api/admin/book-genres/[genreId]:`, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
      status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('not found')) {
        status = 404; // Might happen if deleted concurrently
    }
    return NextResponse.json({ error: 'Failed to delete book genre', details: errorMessage }, { status });
  }
}
