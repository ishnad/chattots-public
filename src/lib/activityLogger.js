import { getFirestore, collection, addDoc, serverTimestamp } from "firebase/firestore";
import { app } from "./firebase"; // Assuming firebase app is initialized here

const db = getFirestore(app);

/**
 * Logs a user activity to the 'activityLogs' collection in Firestore.
 * @param {string | undefined} userId - The UID of the user performing the action.
 * @param {string} action - A description of the action performed (e.g., 'User Logged In').
 * @param {object} [details={}] - Optional additional details about the event.
 */
export const logActivity = async (userId, action, details = {}) => {
  if (!userId) {
    // In some cases (like failed login before user is known), userId might be null.
    // Decide if you want to log these events with userId as null or skip them.
    console.warn(`Attempted to log activity "${action}" without a userId.`);
    // Optionally log with null userId:
    // userId = null;
    // Or return if userId is strictly required:
     return;
  }
  try {
    const logData = {
      userId: userId, // Keep userId field for potential direct queries if needed later
      action: action,
      timestamp: serverTimestamp(), // Use server timestamp for consistency
    };
    // Only add details field if it's not empty
    if (details && Object.keys(details).length > 0) {
      logData.details = details;
    }

    // Write to the 'activities' subcollection under the specific user's document in 'activityLogs'
    const userActivitiesRef = collection(db, "activityLogs", userId, "activities");
    await addDoc(userActivitiesRef, logData);
    console.log(`Activity logged: ${action} for user ${userId}`);
  } catch (error) {
    console.error("Error logging activity:", error);
    // Decide if you want to re-throw, handle, or just log the error
  }
};