// src/app/api/admin/users/route.ts
import { NextResponse } from 'next/server';
// Import verifyAdminToken and db from the new shared utility
import admin, { db, verifyAdminToken } from '@/lib/firebaseAdmin'; 

// Define Firestore user data structure (adjust based on actual schema)
interface FirestoreUser {
  username?: string;
  name?: string;
  dob?: string | admin.firestore.Timestamp; // DOB might be stored as Timestamp or string
  // Add other fields if necessary
}

// Combined user data type for API response
interface AppUser {
  uid: string;
  email: string | null;
  displayName: string | null; // Keep Auth display name for reference if needed
  username?: string | null; // From Firestore
  name?: string | null; // From Firestore
  dob?: string | null; // From Firestore (converted to string)
  metadata: {
    lastSignInTime: string | null;
    creationTime: string | null;
  };
}

// Firebase Admin SDK is now initialized in @/lib/firebaseAdmin.ts
// The verifyAdmin function is now verifyAdminToken and imported from @/lib/firebaseAdmin.ts
// The db instance is also imported from @/lib/firebaseAdmin.ts

export async function GET(request: Request) {
  try {
    await verifyAdminToken(); // Ensure admin access first

    const { searchParams } = new URL(request.url);
    const uidParam = searchParams.get('uid');
    const typeParam = searchParams.get('type');

    // Handle profile/activity requests
    // Handle specific profile/activity requests (keep existing logic)
    if (uidParam && typeParam) {

      if (typeParam === 'profiles') { // Use typeParam
        const profilesRef = db.collection('chats').doc(uidParam).collection('profiles');
        const snapshot = await profilesRef.get();
        const profiles = snapshot.docs.map(doc => {
          const data = doc.data();
          const processedData: { [key: string]: any } = {};
          // Iterate over document fields and convert any Timestamps
          for (const key in data) {
            if (data[key]?.toDate instanceof Function) { // Check if it's a Firestore Timestamp
              processedData[key] = data[key].toDate().toISOString(); // Convert to ISO string
            } else {
              processedData[key] = data[key];
            }
          }
          return {
            id: doc.id,
            ...processedData
          };
        });
        return NextResponse.json(profiles);
      } else if (typeParam === 'activity') { // Use typeParam
        // Query the 'activities' subcollection under the specific user's document in 'activityLogs'
        const activityRef = db.collection('activityLogs').doc(uidParam).collection('activities').orderBy('timestamp', 'desc').limit(50);
        // Note: No need for .where('userId', '==', uidParam) anymore as we query the subcollection directly.
        const snapshot = await activityRef.get();
        const activities = snapshot.docs.map(doc => {
          const data = doc.data();
          let timestampStr = 'Invalid time'; // Default value

          try {
            const timestamp = data.timestamp;
            if (timestamp?.toDate) { // Check if it's a Firestore Timestamp
              timestampStr = timestamp.toDate().toISOString();
            } else if (timestamp && !isNaN(new Date(timestamp).getTime())) { // Check if it's a valid date string/number
              timestampStr = new Date(timestamp).toISOString();
            } else if (timestamp) {
              // Handle cases where timestamp might be an object but not a Firestore Timestamp
              console.warn('Unrecognized timestamp format:', timestamp);
              timestampStr = 'Unrecognized format';
            } else {
               timestampStr = 'No timestamp provided';
            }
          } catch (e) {
            console.error('Error processing timestamp for doc', doc.id, ':', e);
            // Keep timestampStr as 'Invalid time'
          }

          return {
            id: doc.id,
            ...data,
            timestamp: timestampStr // Ensure timestamp is always a string or defined default
          };
        });
        // Fetch user email to include in the response
        let userEmail: string | null = null;
        try { userEmail = (await admin.auth().getUser(uidParam)).email || null; } catch { /* ignore if user fetch fails */ }

        return NextResponse.json({ logs: activities, userEmail: userEmail });
      }
       // Add handling for fetching single user details if needed for edit modal prepopulation
       else if (typeParam === 'details') {
         const userRecord = await admin.auth().getUser(uidParam);
         const userDocRef = db.collection('users').doc(uidParam);
         const userDoc = await userDocRef.get();
         const firestoreData = userDoc.exists ? userDoc.data() as FirestoreUser : {};

         // Convert Firestore DOB if it's a Timestamp
         let dobString: string | null = null;
         if (firestoreData.dob) {
             if (firestoreData.dob instanceof admin.firestore.Timestamp) {
                 // Format to YYYY-MM-DD for <input type="date">
                 dobString = firestoreData.dob.toDate().toISOString().split('T')[0];
             } else if (typeof firestoreData.dob === 'string') {
                 // Assume it's already in a usable format or attempt conversion
                 try {
                     dobString = new Date(firestoreData.dob).toISOString().split('T')[0];
                 } catch {
                     dobString = firestoreData.dob; // Fallback to original string if parsing fails
                 }
             }
         }


         const userData: AppUser = {
             uid: userRecord.uid,
             email: userRecord.email || null,
             displayName: userRecord.displayName || null,
             username: firestoreData.username || null,
             name: firestoreData.name || null,
             dob: dobString, // Use converted string
             metadata: {
                 lastSignInTime: userRecord.metadata?.lastSignInTime || null,
                 creationTime: userRecord.metadata?.creationTime || null,
             }
         };
         return NextResponse.json(userData);
       }
    }

    // Default GET - list all users with merged Firestore data
    const listUsersResult = await admin.auth().listUsers(1000);
    const authUsers = listUsersResult.users;

    // Fetch Firestore data for all users concurrently
    const firestorePromises = authUsers.map(user => db.collection('users').doc(user.uid).get());
    const firestoreDocs = await Promise.all(firestorePromises);

    const users: AppUser[] = authUsers.map((userRecord, index) => {
      const firestoreDoc = firestoreDocs[index];
      const firestoreData = firestoreDoc.exists ? firestoreDoc.data() as FirestoreUser : {};

      // Convert Firestore DOB if it's a Timestamp
      let dobString: string | null = null;
      if (firestoreData.dob) {
          if (firestoreData.dob instanceof admin.firestore.Timestamp) {
              dobString = firestoreData.dob.toDate().toISOString().split('T')[0]; // Format YYYY-MM-DD
          } else if (typeof firestoreData.dob === 'string') {
              // Basic validation or attempt conversion if needed
              dobString = firestoreData.dob;
          }
      }


      return {
        uid: userRecord.uid,
        email: userRecord.email || null,
        displayName: userRecord.displayName || null, // Keep original display name if needed
        username: firestoreData.username || null, // Get username from Firestore
        name: firestoreData.name || null, // Get name from Firestore
        dob: dobString, // Get dob from Firestore (as string)
        metadata: {
          lastSignInTime: userRecord.metadata?.lastSignInTime || null,
          creationTime: userRecord.metadata?.creationTime || null,
        }
      };
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('Error in GET /api/admin/users:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    // Provide more specific status codes if possible
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
        status = errorMessage.includes('Unauthorized') ? 401 : 403;
    }
    return NextResponse.json({ error: 'Failed to fetch users', details: errorMessage }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin status
    const payload = await request.json();
    const { uid, action } = payload;

    if (!uid) {
      return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
    }

    // Action: Grant Admin (Default/Fallback)
    // Handles grantAdmin or missing action. If 'action' is present but not 'resetPassword', it will fall here.
    // If 'action' is undefined, it will also fall here.
    if (action === 'grantAdmin' || !action) { 
        // Check if user already has admin claims
        const user = await admin.auth().getUser(uid);
        if (user.customClaims && user.customClaims.admin === true) {
            return NextResponse.json({ message: `User ${uid} is already an admin.` }, { status: 200 });
        }

        // Set admin claim
        await admin.auth().setCustomUserClaims(uid, { ...user.customClaims, admin: true }); // Preserve existing claims
        console.log(`Admin ${decodedToken.uid} granted admin privileges to user ${uid}`);
        // Log this action
        return NextResponse.json({ message: `User ${uid} granted admin privileges` });
    } else {
        // Handle unknown actions if necessary, or return an error
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

  } catch (error) {
    console.error('Error in POST /api/admin/users:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
        status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('not found')) {
        status = 404;
    }
    return NextResponse.json({ error: 'Failed to process request', details: errorMessage }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin
    const payload = await request.json();
    const { uid, email, username, name, dob } = payload;

    if (!uid) {
      return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
    }

    const authUpdateData: { email?: string } = {};
    const firestoreUpdateData: { username?: string; name?: string; dob?: string | admin.firestore.Timestamp } = {};
    let requiresAuthUpdate = false;
    let requiresFirestoreUpdate = false;

    // Prepare Auth update
    if (typeof email === 'string') {
      authUpdateData.email = email;
      requiresAuthUpdate = true;
    }
    // We don't update displayName via Auth here, use Firestore 'name' or 'username'

    // Prepare Firestore update
    if (typeof username === 'string') {
      firestoreUpdateData.username = username;
      requiresFirestoreUpdate = true;
    }
    if (typeof name === 'string') {
      firestoreUpdateData.name = name;
      requiresFirestoreUpdate = true;
    }
    if (typeof dob === 'string') {
        // Optional: Validate DOB format before saving
        // Convert to Timestamp if your Firestore schema uses it
        try {
            // Assuming dob is 'YYYY-MM-DD' string from <input type="date">
            const date = new Date(dob);
            if (!isNaN(date.getTime())) {
                 // firestoreUpdateData.dob = admin.firestore.Timestamp.fromDate(date); // If storing as Timestamp
                 firestoreUpdateData.dob = dob; // Store as string if schema expects string
                 requiresFirestoreUpdate = true;
            } else {
                console.warn(`Invalid DOB format received for user ${uid}: ${dob}`);
                // Decide whether to reject or ignore the invalid DOB
            }
        } catch (e) {
             console.warn(`Error processing DOB for user ${uid}: ${dob}`, e);
        }

    }

    // Perform updates if there are changes
    const updatePromises = [];
    if (requiresAuthUpdate) {
      console.log(`Updating Auth for user ${uid}:`, authUpdateData);
      updatePromises.push(admin.auth().updateUser(uid, authUpdateData));
    }
    if (requiresFirestoreUpdate && Object.keys(firestoreUpdateData).length > 0) {
      console.log(`Updating Firestore for user ${uid}:`, firestoreUpdateData);
      const userDocRef = db.collection('users').doc(uid);
      // Use set with merge: true to create doc if not exists, or update existing
      updatePromises.push(userDocRef.set(firestoreUpdateData, { merge: true }));
    }

    if (updatePromises.length === 0) {
        return NextResponse.json({ message: 'No changes provided to update.' }, { status: 200 });
    }

    await Promise.all(updatePromises);

    console.log(`Admin ${decodedToken.uid} updated user ${uid}`);
    // Log this action

    return NextResponse.json({ message: `User ${uid} updated successfully` });
  } catch (error) {
    console.error('Error in PATCH /api/admin/users:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
     if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
        status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (errorMessage.includes('not found')) {
        status = 404; // e.g., Firestore doc or Auth user not found
    }
    return NextResponse.json({ error: 'Failed to update user', details: errorMessage }, { status });
  } // End catch block
} // End PATCH function

// Helper function to delete all documents in a collection/subcollection in batches
async function deleteCollectionDocs(
  dbInstance: admin.firestore.Firestore, // Renamed to avoid conflict if 'db' is in scope
  collectionPath: string,
  batchSize: number = 100 // Firestore batch limit is 500, choose a safe size
) {
  const collectionRef = dbInstance.collection(collectionPath);
  let query = collectionRef.orderBy(admin.firestore.FieldPath.documentId()).limit(batchSize);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snapshot = await query.get();
    if (snapshot.size === 0) {
      break; // No more documents to delete
    }

    const batch = dbInstance.batch(); // Use the passed dbInstance
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Deleted ${snapshot.size} documents from ${collectionPath}`);

    if (snapshot.size < batchSize) {
      break; // Deleted all remaining documents
    }
    // Prepare the next query starting after the last deleted document.
    query = collectionRef.orderBy(admin.firestore.FieldPath.documentId()).startAfter(snapshot.docs[snapshot.docs.length - 1].id).limit(batchSize);
  }
}


export async function DELETE(request: Request) {
  let targetUidForDeletion: string | undefined;
  try {
    const decodedToken = await verifyAdminToken(); // Verify admin status
    const payload = await request.json();
    targetUidForDeletion = payload.uid;

    if (!targetUidForDeletion) {
      return NextResponse.json({ error: 'Missing uid' }, { status: 400 });
    }

    console.log(`Admin ${decodedToken.uid} initiated deletion for user ${targetUidForDeletion}.`);

    // 1. Delete from Firebase Authentication
    await admin.auth().deleteUser(targetUidForDeletion);
    console.log(`Admin ${decodedToken.uid} deleted user ${targetUidForDeletion} from Firebase Auth.`);

    // 2. Delete from Firestore 'users' collection
    const userDocRef = db.collection('users').doc(targetUidForDeletion);
    if ((await userDocRef.get()).exists) {
        await userDocRef.delete();
        console.log(`Admin ${decodedToken.uid} deleted user ${targetUidForDeletion} data from Firestore 'users' collection.`);
    }


    // 3. Delete all nested data under 'chats/{targetUidForDeletion}'
    const profilesSnapshot = await db.collection('chats').doc(targetUidForDeletion).collection('profiles').get();
    for (const profileDoc of profilesSnapshot.docs) {
      const profileId = profileDoc.id;
      const profileRef = profileDoc.ref;

      // Delete messages within each chatSession
      const chatSessionsSnapshot = await profileRef.collection('chatSessions').get();
      for (const sessionDoc of chatSessionsSnapshot.docs) {
        const sessionId = sessionDoc.id;
        await deleteCollectionDocs(db, `chats/${targetUidForDeletion}/profiles/${profileId}/chatSessions/${sessionId}/messages`);
        console.log(`Deleted messages for session ${sessionId} of profile ${profileId} for user ${targetUidForDeletion}.`);
      }
      // Delete chatSessions
      await deleteCollectionDocs(db, `chats/${targetUidForDeletion}/profiles/${profileId}/chatSessions`);
      console.log(`Deleted chatSessions for profile ${profileId} for user ${targetUidForDeletion}.`);

      // Delete readingLog
      await deleteCollectionDocs(db, `chats/${targetUidForDeletion}/profiles/${profileId}/readingLog`);
      console.log(`Deleted readingLog for profile ${profileId} for user ${targetUidForDeletion}.`);

      // Delete globalRecommendations
      await deleteCollectionDocs(db, `chats/${targetUidForDeletion}/profiles/${profileId}/globalRecommendations`);
      console.log(`Deleted globalRecommendations for profile ${profileId} for user ${targetUidForDeletion}.`);

      // Delete the profile document itself
      await profileRef.delete();
      console.log(`Deleted profile ${profileId} for user ${targetUidForDeletion}.`);
    }
    // After all profiles and their subcollections are deleted, delete the main chat document if it exists
    const userChatDocRef = db.collection('chats').doc(targetUidForDeletion);
    if ((await userChatDocRef.get()).exists) {
        await userChatDocRef.delete();
        console.log(`Admin ${decodedToken.uid} deleted main chat document for user ${targetUidForDeletion}.`);
    }


    // 4. Delete all data under 'activityLogs/{targetUidForDeletion}/activities'
    await deleteCollectionDocs(db, `activityLogs/${targetUidForDeletion}/activities`);
    console.log(`Deleted activities for user ${targetUidForDeletion}.`);
    // Delete the parent activityLogs document if it exists
    const userActivityLogDocRef = db.collection('activityLogs').doc(targetUidForDeletion);
    if ((await userActivityLogDocRef.get()).exists) {
        await userActivityLogDocRef.delete();
        console.log(`Admin ${decodedToken.uid} deleted main activityLog document for user ${targetUidForDeletion}.`);
    }

    return NextResponse.json({ message: `User ${targetUidForDeletion} and all associated data deleted successfully.` });

  } catch (error) {
    console.error('Error in DELETE /api/admin/users for UID:', targetUidForDeletion, error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    let status = 500;
    if (errorMessage.includes('Unauthorized') || errorMessage.includes('Forbidden')) {
        status = errorMessage.includes('Unauthorized') ? 401 : 403;
    } else if (error instanceof Error && 'code' in error && error.code === 'auth/user-not-found') {
        status = 404; // User might have already been deleted
    }
    return NextResponse.json({ error: 'Failed to delete user', details: errorMessage }, { status });
  }
}