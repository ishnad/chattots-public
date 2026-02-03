import { NextResponse } from 'next/server';
import { db, verifyAdminToken } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

interface NewGenrePayload {
  value: string;
  synonyms?: string[];
  emoji?: string | null;
}

export async function POST(request: Request) {
  try {
    const decodedToken = await verifyAdminToken();
    const payload: NewGenrePayload = await request.json();
    
    const { value, synonyms, emoji } = payload;

    if (!value || typeof value !== 'string' || value.trim() === '') {
      return NextResponse.json(
        { error: 'Genre value is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Validate synonyms (optional)
    const cleanSynonyms = Array.isArray(synonyms)
      ? synonyms.map(s => String(s).trim()).filter(s => s !== '')
      : [];

    const newGenre = {
      value: value.trim(),
      synonyms: cleanSynonyms,
      emoji: (typeof emoji === 'string' && emoji.trim()) ? emoji.trim() : null, // Save emoji or null
    };

    const docRef = await db.collection('contentGenres').add(newGenre);
    console.log(`Admin ${decodedToken.uid} created new content genre ${docRef.id}`);

    return NextResponse.json({
      id: docRef.id,
      ...newGenre
    }, { status: 201 });

  } catch (error) {
    console.error('Error in POST /api/admin/content-genres:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to create content genre';
    let status = 500;
    
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
      status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('required')) {
      status = 400;
    }

    return NextResponse.json(
      { error: 'Failed to create content genre', details: errorMessage },
      { status }
    );
  }
}
