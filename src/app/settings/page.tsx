"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase"; // Import db
import { 
  onAuthStateChanged, 
  User, 
  updateEmail, 
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider
} from "firebase/auth";
import { doc, getDoc, collection, getDocs, QueryDocumentSnapshot, updateDoc } from "firebase/firestore"; // Import Firestore functions
import Header from "@/components/Header";
// Removed ThemeProvider import

// Define interface for user data
interface UserData {
  username?: string;
  name?: string;
  dob?: string; // Assuming string format, adjust if needed (e.g., Timestamp)
  email?: string; // Email is usually available directly from User object, but can be stored too
  parentalPin?: string;
  currentPassword?: string;
  newPassword?: string; // Temporary field for password change
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Start loading
  const [pinInput, setPinInput] = useState("");
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [parentalPin, setParentalPin] = useState<string | null>(null); // Store the fetched PIN
  const [userData, setUserData] = useState<UserData | null>(null); // Store fetched user data
  const [childrenProfiles, setChildrenProfiles] = useState<QueryDocumentSnapshot[] | null>(null); // Store fetched children profiles
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<UserData>({
    username: '',
    name: '',
    dob: '',
    email: '',
    parentalPin: '',
    currentPassword: '',
    newPassword: ''
  });
  // Removed expandedProfile state

  useEffect(() => {
    // Check if navigated back from profile page
    const navigatedBack = sessionStorage.getItem('navigatedFromProfile');
    if (navigatedBack === 'true') {
      setIsPinVerified(true); // Bypass PIN prompt
      sessionStorage.removeItem('navigatedFromProfile'); // Remove flag after use
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login");
      } else {
        setUser(currentUser);
        setIsLoading(true); // Set loading true when starting data fetch
        setError(null); // Clear previous errors

        try {
          // Fetch user data (including PIN) and children profiles concurrently
          const userDocRef = doc(db, "users", currentUser.uid);
          const childrenCollectionRef = collection(db, "chats", currentUser.uid, "profiles");

          const [userDocSnap, childrenSnapshot] = await Promise.all([
            getDoc(userDocRef),
            getDocs(childrenCollectionRef)
          ]);

          // Process user data
          if (userDocSnap.exists()) {
            const fetchedUserData = userDocSnap.data() as UserData;
            setUserData({ // Store all relevant user data
                username: fetchedUserData.username,
                name: fetchedUserData.name,
                dob: fetchedUserData.dob,
                email: currentUser.email || fetchedUserData.email, // Prefer auth email, fallback to stored
                parentalPin: fetchedUserData.parentalPin
            });

            if (fetchedUserData.parentalPin) {
              setParentalPin(fetchedUserData.parentalPin);
            } else {
              // Handle case where user exists but has no PIN set
              setError("Parental PIN not set for this account. Cannot access settings.");
              // Keep loading false, but don't verify PIN
            }
          } else {
            setError("User data not found.");
          }

          // Process children profiles
          if (!childrenSnapshot.empty) {
            setChildrenProfiles(childrenSnapshot.docs);
          } else {
            setChildrenProfiles([]); // Set to empty array if no children found
          }

        } catch (err) {
          console.error("Error fetching settings data:", err);
          setError("Failed to load settings data. Please try again.");
          setUserData(null); // Clear data on error
          setChildrenProfiles(null);
          setParentalPin(null);
        } finally {
          setIsLoading(false); // Finished loading all data or encountered error
        }
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [router]); // Dependency array includes router

  const verifyPin = () => {
    setError(null); // Clear previous errors
    if (!parentalPin) {
        setError("Cannot verify PIN. Parental PIN not loaded or set.");
        return;
    }
    if (pinInput === parentalPin) {
      setIsPinVerified(true);
      // No need to set session storage here anymore
    } else {
      setError("Incorrect PIN.");
      setPinInput(""); // Clear input field on incorrect PIN
    }
  };

  const handlePinInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPinInput(e.target.value);
  };

  const handlePinSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    verifyPin();
  };

  const handleEditClick = () => {
    // Initialize editData with empty fields when starting edit mode
    setEditData({
      username: '',
      name: '',
      dob: '',
      email: '', // This will be for the NEW email
      parentalPin: '', // This will be for the NEW PIN
      currentPassword: '',
      newPassword: ''
    });
    setIsEditing(true);
  };

  const handleSaveClick = async () => {
    if (!user || !userData) return;
    setError(null); // Clear previous errors at the start

    // Check if trying to change password without current password
    if (editData.newPassword && editData.newPassword.trim() !== '' && (!editData.currentPassword || editData.currentPassword.trim() === '')) {
        setError("Current password is required to set a new password.");
        return; // Stop execution
    }

    try {
      const userDocRef = doc(db, "users", user.uid);
      
      // Create update object with only changed fields that are not empty
      const updates: Partial<UserData> = {};
      if (editData.username && editData.username.trim() !== '' && editData.username !== userData.username) {
        updates.username = editData.username.trim();
      }
      if (editData.name && editData.name.trim() !== '' && editData.name !== userData.name) {
        updates.name = editData.name.trim();
      }
      // Only update DOB if it's not empty and different from the original
      if (editData.dob && editData.dob.trim() !== '' && editData.dob !== userData.dob) {
          updates.dob = editData.dob.trim();
      }

      // Validate and add parental PIN to updates if changed
      const newParentalPinTrimmed = editData.parentalPin?.trim();
      if (newParentalPinTrimmed && newParentalPinTrimmed !== '') {
        if (!/^\d{4}$/.test(newParentalPinTrimmed)) {
          setError("Parental PIN must be exactly 4 digits.");
          return;
        }
        if (newParentalPinTrimmed !== userData.parentalPin) {
          updates.parentalPin = newParentalPinTrimmed;
        }
      }
      
      if (Object.keys(updates).length > 0) {
        await updateDoc(userDocRef, updates);
      }

      // Check if we need to reauthenticate (non-empty email change or non-empty password change)
      const newEmailTrimmed = editData.email?.trim();
      const emailChanged = newEmailTrimmed && newEmailTrimmed !== '' && newEmailTrimmed !== user.email; // Compare with auth user.email
      const passwordChanged = editData.newPassword && editData.newPassword.trim() !== '';
      const needsReauth = emailChanged || passwordChanged;

      if (needsReauth) {
        if (!editData.currentPassword) {
          throw new Error('Current password is required to update sensitive information');
        }
        // Also ensure user email exists for re-authentication
        if (!user.email) {
            throw new Error('User email is missing, cannot reauthenticate.');
        }
        
        try {
          // Assert currentPassword is a string here because of the check above
          const credential = EmailAuthProvider.credential(user.email, editData.currentPassword!); 
          await reauthenticateWithCredential(user, credential);
        } catch (err: any) { // Added :any to access err.code
          console.error("Reauthentication failed:", err);
          if (err.code === 'auth/wrong-password') {
            setError('The current password you entered is incorrect. Please try again.');
          } else {
            setError('Reauthentication failed. Please check your current password and try again.');
          }
          return; // Stop execution if reauthentication fails
        }
      }

      // Handle email change if different and not empty
      if (emailChanged) {
        await updateEmail(user, newEmailTrimmed!); // Use non-null assertion as it's checked in emailChanged
        // Email verification is sent. user.email will update via onAuthStateChanged.
      }

      // Handle password change if provided and not empty
      if (passwordChanged) {
        // Assert newPassword is a string here because passwordChanged check ensures it
        await updatePassword(user, editData.newPassword!); 
        // Clear password fields after successful update
        setEditData(prev => ({ ...prev, newPassword: '', currentPassword: '' }));
      }

      // Update user data state (username, name, dob from Firestore; parentalPin from updates object)
      // Email is not updated here directly, it will refresh via onAuthStateChanged
      const updatedUserData: UserData = { // Ensure type consistency
        ...userData, // existing data
        ...updates,  // applied Firestore updates (username, name, dob, parentalPin)
        // email in userData should reflect user.email, which updates via onAuthStateChanged
      };
      if (user?.email && userData?.email !== user.email) { // Sync if auth email changed
        updatedUserData.email = user.email;
      }
      setUserData(updatedUserData);
      
      // Reset edit state
      setIsEditing(false);
      setError(null);
      
      // Update parental pin state if it was part of updates
      if (updates.parentalPin) {
        setParentalPin(updates.parentalPin);
      }

      // Show success message
      let successMessage = "Your account has been updated successfully!";
      alert(successMessage);

    } catch (err) {
      console.error("Error updating user data:", err);
      // Check if error is an instance of Error to access message property safely
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Failed to update profile: ${errorMessage}. Please try again.`);
    }
  };

  const handleCancelClick = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Render loading state
  if (isLoading) {
    return (
      // Removed ThemeProvider wrapper
      <div 
        className="w-full h-screen flex flex-col items-center justify-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333]"
        style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
      >
        <h1 className={`text-4xl font-bold mb-4 text-orange-900`}>🤖 ChatTots</h1>
        <p className="text-gray-700 dark:text-black">Loading...</p>
      </div>
      // Removed ThemeProvider wrapper
    );
  }

  // Render PIN input form if not verified AND a PIN is set
  // If no PIN is set, error message is shown instead (handled in useEffect)
  if (!isPinVerified && parentalPin) {
    return (
      // Removed ThemeProvider wrapper
      <div 
        className="w-full h-screen flex flex-col items-center justify-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333]"
        style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
      >
        <h1 className={`text-4xl font-bold mb-4 text-orange-900`}>🤖 ChatTots</h1>
        <div className="bg-white p-6 rounded-2xl w-full max-w-sm border-2 border-yellow-200">
          <h2 className="text-lg font-bold mb-4 text-center text-gray-800">Enter PIN to Unlock Settings 🔒</h2>
          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              value={pinInput}
              onChange={handlePinInputChange}
              placeholder="Enter Parental PIN"
              className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
              maxLength={4} // Assuming a 4-digit PIN
              required
            />
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
            <button
              type="submit"
              className="w-full bg-orange-400 hover:bg-orange-500 text-white py-2 rounded-full transition duration-200"
            >
              Verify PIN
            </button>
          </form>
           <div className="mt-4 text-center">
             <button
                onClick={() => router.back()}
                className="bg-red-500 w-full p-2 rounded-full text-white"
             >
                ← Back
             </button>
          </div>
        </div>
      </div>
      // Removed ThemeProvider wrapper
    );
  }

  // Render settings content if PIN is verified
  // Or render error if PIN is not set
  return (
    // Removed ThemeProvider wrapper
    <div 
      className="w-full h-screen flex flex-col items-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333] overflow-y-auto"
      style={{ backgroundImage: "url('/subtle-settings-backdrop.png')", backgroundSize: "cover" }}
    >
      <div className="w-full text-center mt-4 pt-4"> {/* Added pt-4 for spacing */}
        <h1 className={`text-4xl font-bold mb-4 text-black`}>🤖 ChatTots</h1>
      </div>
      <div className="bg-white p-6 rounded w-full max-w-2xl shadow-md text-gray-800 mb-8">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>

        {error && !parentalPin && ( // Show error prominently if PIN isn't set
          <p className="text-red-500 text-center mb-4">{error}</p>
        )}

        {isPinVerified && userData && (
          <div className="mb-8 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold border-b pb-2 border-gray-300">Your Account</h2>
              {!isEditing ? (
                <button
                  onClick={handleEditClick}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Edit Account
                </button>
              ) : (
                <div className="space-x-2">
                  <button
                    onClick={handleSaveClick}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                  >
                    Save
                  </button>
                  <button
                    onClick={handleCancelClick}
                    className="px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-4">
                {/* Add error display here */}
                {error && <p className="text-red-500 text-sm text-center mb-4">{error}</p>} 
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                  <input
                    type="text"
                    name="username"
                    value={editData.username || ''}
                    onChange={handleEditChange}
                    placeholder={userData?.username || "Enter new username"}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    name="name"
                    value={editData.name || ''}
                    onChange={handleEditChange}
                    placeholder={userData?.name || "Enter new name"}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    name="dob"
                    value={editData.dob || ''}
                    onChange={handleEditChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Email</label>
                  <p className="w-full px-3 py-2 border border-gray-200 rounded bg-gray-50 text-gray-600">{user?.email || "N/A"}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Email (Optional)</label>
                  <input
                    type="email"
                    name="email" // This corresponds to editData.email for the new email
                    value={editData.email || ''}
                    onChange={handleEditChange}
                    placeholder="Enter new email address"
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                  <input
                    type="password"
                    name="currentPassword"
                    value={editData.currentPassword || ''}
                    onChange={handleEditChange}
                    placeholder="Required for email/password changes"
                    className="w-full px-3 py-2 border border-gray-300 rounded mb-4"
                    required={!!((editData.email && editData.email.trim() !== '' && editData.email.trim() !== (user?.email || '')) || (editData.newPassword && editData.newPassword.trim() !== ''))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                  <input
                    type="password"
                    name="newPassword"
                    value={editData.newPassword || ''}
                    onChange={handleEditChange}
                    placeholder="Leave blank to keep current"
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Parental PIN</label>
                  <input
                    type="password"
                    name="parentalPin" // This corresponds to editData.parentalPin for the new PIN
                    value={editData.parentalPin || ''}
                    onChange={handleEditChange}
                    placeholder="Enter new 4-digit PIN (optional)"
                    inputMode="numeric" // Hint for numeric keyboard on mobile
                    pattern="\d*" // Allow browser to hint at digits, JS will validate length
                    maxLength={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-3 mb-4">
                  <span className="text-3xl">👤</span>
                  <span className="text-lg font-medium">{userData.username || "N/A"}</span>
                </div>
                <p><span className="font-semibold">Name:</span> {userData.name || "N/A"}</p>
                <p><span className="font-semibold">Date of Birth:</span> {userData.dob || "N/A"}</p>
                <p><span className="font-semibold">Email:</span> {userData.email || "N/A"}</p>
              </>
            )}
          </div>
        )}

        {isPinVerified && childrenProfiles && (
          <div className="mb-6">
            <h2 className="text-xl font-semibold mb-3 border-b pb-2 border-gray-300">Children Profiles</h2>
            {childrenProfiles.length > 0 ? (
              <div className="space-y-2">
                {/* Updated rendering logic for children profiles */}
                {childrenProfiles.map((profileDoc) => {
                  const profile = profileDoc.data();
                  return (
                    <div key={profileDoc.id} className="flex justify-between items-center p-4 bg-white rounded-lg border border-gray-200">
                      <h3 className="text-lg font-medium">{profile.name || `Profile ${profileDoc.id}`}</h3>
                      <button
                        onClick={() => router.push(`/settings/profile/${profileDoc.id}`)}
                        className="px-3 py-1 bg-indigo-500 text-white text-sm rounded hover:bg-indigo-600"
                      >
                        View / Edit Profile
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>No children profiles found.</p>
            )}
          </div>
        )}

        {/* Keep Back button accessible */}
        <div className="mt-8 text-center">
          <button
             onClick={() => router.push("/")} // Changed back to original "Back" which goes Home
             className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
             Back
           </button>
        </div>
      </div>
    </div>
  );
}