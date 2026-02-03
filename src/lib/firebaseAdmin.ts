import * as admin from 'firebase-admin';
import { headers } from 'next/headers';

// Initialize Firebase Admin
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const adminConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: firebasePrivateKey,
};

if (!admin.apps.length) {
  try {
    if (!adminConfig.projectId || !adminConfig.clientEmail || !adminConfig.privateKey) {
      throw new Error('Missing Firebase Admin SDK configuration');
    }
    admin.initializeApp({
      credential: admin.credential.cert(adminConfig),
    });
    console.log("Firebase Admin SDK Initialized Successfully (from lib/firebaseAdmin.ts).");
  } catch (error) {
    console.error('Firebase Admin SDK initialization error (from lib/firebaseAdmin.ts):', error);
    // Depending on your error handling strategy, you might want to re-throw the error
    // or handle it in a way that calling functions can understand initialization failed.
  }
} else {
    console.log("Firebase Admin SDK already initialized (checked by lib/firebaseAdmin.ts).");
}

export const db = admin.firestore(); // Export Firestore instance

export async function verifyAdminToken(): Promise<admin.auth.DecodedIdToken> {
  if (!admin.apps.length) {
    // This check is important if initialization could fail silently or be deferred.
    console.error('Firebase Admin SDK not initialized when verifyAdminToken was called.');
    throw new Error('Firebase Admin SDK not initialized');
  }

  const headerList = await headers();
  const authorization = headerList.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing or invalid Authorization header');
  }

  const idToken = authorization.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (decodedToken.admin !== true) {
      throw new Error('Forbidden: User is not an admin');
    }
    return decodedToken; // Return decoded token if admin
  } catch (error) {
    // Log the specific error for better debugging
    console.error('Error verifying ID token or admin claim:', error);
    // Re-throw a more generic error or the original one, depending on desired exposure
    if (error instanceof Error && (error.message.includes('ID token has expired') || error.message.includes('TOKEN_EXPIRED'))) {
        throw new Error('Unauthorized: Token expired.');
    }
    throw new Error('Unauthorized: Invalid token or insufficient permissions.');
  }
}

// Export admin for other potential uses, though direct use should be limited
export default admin;
