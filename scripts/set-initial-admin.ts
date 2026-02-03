import * as admin from 'firebase-admin';
    import * as dotenv from 'dotenv';

    // Load environment variables from .env.local (or .env)
    // Make sure your Firebase Admin credentials are in this file
    dotenv.config({ path: '.env.local' }); // Adjust path if needed

    // --- Configuration ---
    const targetUserUid = 'HxLxkj6WAqUwudyFGEYbSNE66df2'; // The UID of the user to make admin
    // --- End Configuration ---


    // Prepare Firebase Admin credentials from environment variables
    const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    const adminConfig = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: firebasePrivateKey,
    };

    // Validate environment variables
    if (!adminConfig.projectId || !adminConfig.clientEmail || !adminConfig.privateKey) {
      console.error('Error: Missing Firebase Admin SDK configuration environment variables.');
      console.error('Please ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are set in your .env.local file.');
      process.exit(1); // Exit with an error code
    }

    // Initialize Firebase Admin SDK
    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert(adminConfig),
        });
        console.log('Firebase Admin SDK Initialized.');
      } else {
        console.log('Firebase Admin SDK already initialized.');
      }
    } catch (error) {
      console.error('Firebase Admin SDK initialization error:', error);
      process.exit(1);
    }

    // Function to set the admin claim
    async function setAdminClaim(uid: string) {
      console.log(`Attempting to set 'admin: true' claim for user UID: ${uid}`);
      try {
        // Check if user exists first (optional but good practice)
        await admin.auth().getUser(uid);
        console.log(`User ${uid} found.`);

        // Set the custom claim
        await admin.auth().setCustomUserClaims(uid, { admin: true });
        console.log(`Successfully set 'admin: true' claim for user UID: ${uid}`);

        // Verify the claim (optional)
        const userRecord = await admin.auth().getUser(uid);
        console.log(`Verification: Custom claims for ${uid}:`, userRecord.customClaims);
        if (userRecord.customClaims?.admin === true) {
            console.log("Admin claim successfully verified.");
        } else {
            console.warn("Verification failed: Admin claim not found after setting.");
        }

      } catch (error: any) {
        console.error(`Error setting admin claim for UID ${uid}:`, error.message);
        if (error.code === 'auth/user-not-found') {
          console.error(`Error: User with UID ${uid} does not exist in Firebase Authentication.`);
        }
        process.exit(1); // Exit on error
      }
    }

    // Execute the function
    setAdminClaim(targetUserUid).then(() => {
      console.log('Script finished successfully.');
      process.exit(0); // Exit successfully
    }).catch(() => {
      // Error handling is done within setAdminClaim, but catch any unexpected promise rejection
      console.error('An unexpected error occurred during script execution.');
      process.exit(1);
    });