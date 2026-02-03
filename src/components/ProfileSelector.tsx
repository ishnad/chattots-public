"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  query,
  onSnapshot,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
} from "firebase/firestore";
import Link from "next/link";

type Profile = {
  id: string;
  name: string;
  favoriteColor?: string;
};

export default function ProfileSelector() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const router = useRouter();
  const user = auth.currentUser; // Keep this for profile fetching
  const [parentalPin, setParentalPin] = useState<string | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [profileToDeleteId, setProfileToDeleteId] = useState<string | null>(null);
  const [isLoadingPin, setIsLoadingPin] = useState(false); // Loading state for PIN fetch on demand

  // Fetch profiles effect
  useEffect(() => {
    if (!user) return;

    const profilesRef = collection(db, "chats", user.uid, "profiles");
    const q = query(profilesRef);

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const profileList = snapshot.docs.map((doc) => ({
        id: doc.id,
        name: doc.data().name,
        favoriteColor: doc.data().favoriteColor || "#fbbf24", // fallback yellow
      }));
      setProfiles(profileList);
    });

    return () => unsubscribe();
  }, [user]); // Dependency remains user

  // Function to fetch PIN on demand
  const fetchParentalPin = async (): Promise<string | null> => {
      if (!user) return null;
      setIsLoadingPin(true);
      setError(null);
      try {
          const userDocRef = doc(db, "users", user.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
              const fetchedPin = userDocSnap.data()?.parentalPin;
              if (fetchedPin) {
                  setParentalPin(fetchedPin);
                  setIsLoadingPin(false);
                  return fetchedPin;
              } else {
                  setError("Parental PIN not set. Cannot delete profile.");
                  setIsLoadingPin(false);
                  return null;
              }
          } else {
              setError("User data not found.");
              setIsLoadingPin(false);
              return null;
          }
      } catch (fetchError) {
          console.error("Error fetching user data:", fetchError);
          setError("Failed to fetch PIN.");
          setIsLoadingPin(false);
          return null;
      }
  };


  // Initiate deletion process: fetch PIN and show modal
  const handleDeleteClick = async (profileId: string) => {
    setProfileToDeleteId(profileId);
    setPinInput(""); // Clear previous input
    setError(null); // Clear previous error

    const fetchedPin = parentalPin || await fetchParentalPin(); // Use cached or fetch

    if (fetchedPin) {
        setShowPinModal(true); // Show modal only if PIN exists
    } else {
        // Error state should already be set by fetchParentalPin if PIN doesn't exist
        // Optionally show an alert or different UI feedback
        alert(error || "Cannot delete profile: Parental PIN is not set or could not be fetched.");
        setProfileToDeleteId(null); // Reset target profile
    }
  };

  // Handle PIN input change
  const handlePinInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPinInput(e.target.value);
    if (error) setError(null); // Clear error on new input
  };

  // Handle PIN submission from modal
  const handlePinSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pinInput === parentalPin) {
      setError(null);
      setShowPinModal(false);
      confirmAndDeleteProfile(); // Proceed with deletion
    } else {
      setError("Incorrect PIN.");
      setPinInput(""); // Clear input
    }
  };

  // Actual deletion logic (extracted from original deleteProfile)
  const confirmAndDeleteProfile = async () => {
    if (!user || !profileToDeleteId) return;

    // Optional: Add a final confirmation dialog here if desired
    // const confirmDelete = confirm("Are you sure you want to permanently delete this profile and all its data?");
    // if (!confirmDelete) {
    //   setProfileToDeleteId(null); // Reset if cancelled
    //   return;
    // }

    try {
      const profileRef = doc(db, "chats", user.uid, "profiles", profileToDeleteId);
      const chatSessionsRef = collection(profileRef, "chatSessions");

      // Delete chat sessions and their messages
      const snapshot = await getDocs(chatSessionsRef);
      const deletePromises = snapshot.docs.map(async (chatDoc) => {
        const messagesRef = collection(chatSessionsRef, chatDoc.id, "messages");
        const messagesSnapshot = await getDocs(messagesRef);
        const messageDeletes = messagesSnapshot.docs.map((msgDoc) =>
          deleteDoc(msgDoc.ref)
        );
        await Promise.all(messageDeletes);
        return deleteDoc(chatDoc.ref); // Delete chat session doc
      });

      await Promise.all(deletePromises);

      // Delete the profile document itself
      await deleteDoc(profileRef);

      setProfileToDeleteId(null); // Reset after successful deletion
      // Profiles state will update automatically via the onSnapshot listener
    } catch (delError) {
      console.error("Error deleting profile:", delError);
      setError("Failed to delete profile. Please try again.");
      // Keep modal closed, but show error maybe via an alert or toast
      alert("Failed to delete profile. Please try again.");
      setProfileToDeleteId(null); // Reset target profile even on error
    }
  };

  const handleCloseModal = () => {
      setShowPinModal(false);
      setPinInput("");
      setError(null);
      setProfileToDeleteId(null); // Ensure we reset the target profile ID
  };

  return (
    <div
      className="w-full h-screen flex flex-col items-center justify-center px-4 font-comic text-[#333]"
      style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
    >
      <h1 className="text-4xl font-bold text-orange-900 mb-10">Tap your name to begin an adventure! 🚀</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-xl w-full">
        {profiles.map((profile) => (
          <div key={profile.id} className="flex flex-col items-center group relative">
            <button
              onClick={() => router.push(`/?profile=${profile.id}`)}
              className="w-24 h-24 md:w-28 md:h-28 rounded-full flex items-center justify-center text-white text-2xl font-bold shadow-md transition duration-200"
              style={{
                backgroundColor: profile.favoriteColor || "#fbbf24",
              }}
            >
              {profile.name.charAt(0).toUpperCase()}
            </button>
            <p className="mt-2 text-md font-semibold">{profile.name}</p>

            {/* Delete Icon on Hover - Triggers PIN modal */}
            <button
              onClick={() => handleDeleteClick(profile.id)}
              className="absolute top-0 right-0 p-1 bg-red-500 text-white text-xs rounded-full opacity-0 group-hover:opacity-100 transition duration-200"
              title="Delete"
              disabled={isLoadingPin} // Disable while fetching PIN
            >
              ✕
            </button>
          </div>
        ))}

        {/* Add New Profile */}
        <Link href="/create-child-profile">
          <div className="flex flex-col items-center cursor-pointer">
            <div className="w-24 h-24 md:w-28 md:h-28 rounded-full bg-green-400 hover:bg-green-500 text-white text-4xl font-bold flex items-center justify-center transition duration-200 shadow-md">
              +
            </div>
            <p className="mt-2 text-md font-semibold text-green-700">Add Profile</p>
          </div>
        </Link>
      </div>

      {/* PIN Verification Modal */}
      {showPinModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl w-full max-w-sm border-2 border-yellow-200">
            <h2 className="text-lg font-bold mb-4 text-center text-gray-800">Enter PIN to Delete Profile 🗑️</h2>
            <form onSubmit={handlePinSubmit} className="space-y-3">
              <input
                type="password"
                value={pinInput}
                onChange={handlePinInputChange}
                placeholder="Enter Parental PIN"
                className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
                maxLength={4} // Assuming a 4-digit PIN
                required
                autoFocus // Focus the input when modal opens
              />
              {error && <p className="text-red-500 text-sm text-center">{error}</p>}
              {isLoadingPin && <p className="text-blue-500 text-sm text-center">Loading PIN...</p>}
              <button
                type="submit"
                className="w-full px-4 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-50"
                disabled={isLoadingPin}
              >
                Confirm Delete
              </button>
              <button
                type="button"
                onClick={handleCloseModal}
                className="w-full px-4 py-2 bg-gray-300 text-black rounded-full hover:bg-gray-400 mt-2"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}