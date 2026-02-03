import { NextResponse } from 'next/server';
import { db, verifyAdminToken } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore'; // Import FieldValue if needed

interface NewGenrePayload {
  value: string;
  synonyms?: string[]; // Synonyms are optional on creation
  emoji?: string | null; // Add optional emoji
}

export async function POST(request: Request) {
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin status first
    const payload: NewGenrePayload = await request.json();

    const { value, synonyms, emoji } = payload; // Destructure emoji

    if (!value || typeof value !== 'string' || value.trim() === '') {
      return NextResponse.json({ error: 'Missing or invalid genre value' }, { status: 400 });
    }

    // Validate synonyms (optional)
    const cleanSynonyms = Array.isArray(synonyms)
      ? synonyms.map(s => String(s).trim()).filter(s => s !== '')
      : [];

    // Add the new genre document to Firestore
    const docRef = await db.collection('bookGenres').add({
      value: value.trim(),
      synonyms: cleanSynonyms,
      emoji: (typeof emoji === 'string' && emoji.trim()) ? emoji.trim() : null, // Save emoji or null
      // Optional: Add a timestamp if needed
      // createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`Admin ${decodedToken.uid} added book genre ${docRef.id} with value "${value.trim()}"`);

    // Return the newly created genre data including its ID
    // Return the newly created genre data including its ID and emoji
    return NextResponse.json({
        id: docRef.id,
        value: value.trim(),
        synonyms: cleanSynonyms,
        emoji: (typeof emoji === 'string' && emoji.trim()) ? emoji.trim() : null // Return saved emoji value
    }, { status: 201 }); // 201 Created

  } catch (error) {
    console.error('Error in POST /api/admin/book-genres:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
      status = errorMessage.includes('Unauthorized') ? 401 : 403;
    }
    return NextResponse.json({ error: 'Failed to add book genre', details: errorMessage }, { status });
  }
}

// Optional: Add a GET handler here if you want the client to fetch genres via API instead of direct Firestore access
// export async function GET(request: Request) { ... }
