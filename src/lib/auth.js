import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { app } from "./firebase";
import { logActivity } from "./activityLogger"; // Import shared logger

const auth = getAuth(app);

// Removed local logActivity function, using imported version
export const login = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    // Log login activity after successful login
    if (user) {
      await logActivity(user.uid, 'User Logged In');
    }
    return user;
  } catch (error) {
    console.error("Login error:", error.message);
    // Optionally log failed login attempt here if needed, potentially without user ID
    // await logActivity(null, 'Login Failed', { email: email, error: error.message });
    throw error;
  }
};

export const register = async (email, password) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    // Log registration activity after successful registration
    if (user) {
      await logActivity(user.uid, 'User Registered', { email: user.email }); // Include email in details
    }
    return user;
  } catch (error) {
    console.error("Registration error:", error.message);
    // Optionally log failed registration attempt
    // await logActivity(null, 'Registration Failed', { email: email, error: error.message });
    throw error;
  }
};

export const logout = async () => {
  const user = auth.currentUser; // Get user *before* signing out
  const userId = user?.uid; // Store UID before it becomes null

  try {
    // Log logout activity *before* signing out
    if (userId) {
      await logActivity(userId, 'User Logged Out');
    } else {
      console.warn("Logout attempted but no user was found to log activity for.");
    }

    await signOut(auth);
  } catch (error) {
    console.error("Error during logActivity or signOut:", error);
    // Optionally log failed logout attempt
    if (userId) {
      // await logActivity(userId, 'Logout Failed', { error: error.message });
    }
    throw error;
  }
};