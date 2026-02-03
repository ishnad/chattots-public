import { EntityTypesClient } from '@google-cloud/dialogflow';
import { NextResponse } from 'next/server';
import { db, verifyAdminToken } from '@/lib/firebaseAdmin'; // Import db and verifyAdminToken
// Removed path and fs imports as we'll fetch from Firestore

let entityTypesClient;
try {
     if (
      !process.env.DIALOGFLOW_CREDENTIALS ||
      !process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID
    ) {
      throw new Error('Missing Dialogflow credentials or project ID in environment variables');
    }
    const credentials = JSON.parse(process.env.DIALOGFLOW_CREDENTIALS);
    entityTypesClient = new EntityTypesClient({ credentials });
    console.log("Dialogflow EntityTypesClient Initialized");
} catch (error) {
    console.error("Failed to initialize Dialogflow EntityTypesClient:", error);
    // Prevent endpoint from working if client fails to initialize
    entityTypesClient = null;
}
// Removed getGenresToUpdate function - will fetch directly from Firestore

export async function POST(req) {
    console.log("Received request to update Dialogflow genres.");
    // --- Verify Admin Token ---
    let decodedToken;
    try {
        decodedToken = await verifyAdminToken(); // Verify admin status first
        console.log(`Admin ${decodedToken.uid} initiated Dialogflow genre update.`);
    } catch (authError) {
        console.error("Admin verification failed:", authError);
        const errorMessage = authError instanceof Error ? authError.message : 'Authentication failed';
        const status = errorMessage.includes('Unauthorized') ? 401 : 403;
        return new NextResponse(JSON.stringify({ error: 'Authentication failed', details: errorMessage }), { status });
    }
    // --- End Admin Verification ---

    if (!entityTypesClient) {
        return new NextResponse(JSON.stringify({ error: 'Dialogflow client not initialized' }), { status: 500 });
    }

    // Construct the full entity type path using the project ID from environment variables
    const projectId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID;
    if (!projectId) {
       console.error("Google Project ID is missing from environment variables.");
       return new NextResponse(JSON.stringify({ error: 'Server configuration error: Missing Project ID' }), { status: 500 });
   }
   // Separate entity types for book and content genres
   const bookEntityTypeUUID = 'ba05b0aa-931a-4fdf-90c4-9522e4ec48c6';
   const bookEntityTypeDisplayName = 'book_genre';
   const contentEntityTypeUUID = '61e7ecec-c8d3-4ae3-9114-8794282dbf84';
   const contentEntityTypeDisplayName = 'content_genre';

   // Log the entity type info
   console.log(`Syncing genres to Dialogflow project ${projectId}`);
   console.log(`Book genres entity: ${bookEntityTypeDisplayName} (${bookEntityTypeUUID})`);
   console.log(`Content genres entity: ${contentEntityTypeDisplayName} (${contentEntityTypeUUID})`);

   try {
       // 1. Log the sync operation start
        console.log(`Starting genre sync for project ${projectId}`);

        // 2. Get genres from Firestore - keep separate
        let bookGenres = [];
        let contentGenres = [];
        try {
            console.log("Fetching genres from Firestore collections...");
            
            // Get book genres
            const bookGenresSnapshot = await db.collection('bookGenres').get();
            bookGenres = bookGenresSnapshot.docs.map(doc => ({
                value: doc.data().value,
                synonyms: Array.isArray(doc.data().synonyms) ? doc.data().synonyms : []
            })).filter(g => g.value);
            
            // Get content genres
            const contentGenresSnapshot = await db.collection('contentGenres').get();
            contentGenres = contentGenresSnapshot.docs.map(doc => ({
                value: doc.data().value,
                synonyms: Array.isArray(doc.data().synonyms) ? doc.data().synonyms : []
            })).filter(g => g.value);
            
            console.log(`Fetched ${bookGenres.length} book genres and ${contentGenres.length} content genres from Firestore.`);
        } catch (firestoreError) {
            console.error("Error fetching genres from Firestore:", firestoreError);
            throw new Error(`Failed to fetch genres from Firestore: ${firestoreError.message}`);
        }

        if (bookGenres.length === 0 && contentGenres.length === 0) {
            console.log("Both 'bookGenres' and 'contentGenres' collections are empty or failed to load.");
            return new NextResponse(JSON.stringify({
                error: 'No genres found in Firestore',
                details: 'Both bookGenres and contentGenres collections were empty'
            }), { status: 400 });
        }

        // 3. Process book and content genres separately
        const processEntityType = async (genres, entityUUID, displayName) => {
            const fullPath = `projects/${projectId}/agent/entityTypes/${entityUUID}`;
            
            // Get existing entities for this type
            let existingEntities = [];
            try {
                const [entityTypeResponse] = await entityTypesClient.getEntityType({ name: fullPath });
                existingEntities = entityTypeResponse?.entities || [];
            } catch (error) {
                if (error.code !== 5) throw error; // Ignore NOT_FOUND
            }

            // Merge with Firestore data
            const mergedMap = new Map();
            existingEntities.forEach(e => mergedMap.set(e.value.toLowerCase(), e));
            genres.forEach(g => {
                mergedMap.set(g.value.toLowerCase(), {
                    value: g.value,
                    synonyms: g.synonyms
                });
            });

            const finalEntities = Array.from(mergedMap.values()).sort((a,b) => a.value.localeCompare(b.value));
            
            const payload = {
                name: fullPath,
                displayName,
                kind: 'KIND_MAP',
                entities: finalEntities
            };

            try {
                if (existingEntities.length) {
                    await entityTypesClient.updateEntityType({
                        entityType: payload,
                        updateMask: { paths: ['entities'] }
                    });
                } else {
                    await entityTypesClient.createEntityType({
                        parent: entityTypesClient.agentPath(projectId),
                        entityType: payload
                    });
                }
                return { success: true, count: finalEntities.length };
            } catch (error) {
                console.error(`Error syncing ${displayName}:`, error);
                return { success: false, error };
            }
        };

        // Sync both entity types
        const [bookResult, contentResult] = await Promise.all([
            processEntityType(bookGenres, bookEntityTypeUUID, bookEntityTypeDisplayName),
            processEntityType(contentGenres, contentEntityTypeUUID, contentEntityTypeDisplayName)
        ]);

        // Return combined results
        return new NextResponse(JSON.stringify({
            message: 'Dialogflow genre sync completed',
            results: {
                bookGenres: bookResult,
                contentGenres: contentResult
            }
        }), { status: 200 });

    } catch (error) {
        console.error('Error updating Dialogflow entity type:', error);
        // Provide more specific error details if possible
        const errorMessage = error.details || error.message || 'Unknown error occurred';
        return new NextResponse(JSON.stringify({
            error: 'Failed to update Dialogflow entity type',
            details: errorMessage
        }), { status: 500 });
    }
}
