"use client";
import { useEffect, useState, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth"; // Remove signOut import
import { logout } from "@/lib/auth"; // Import the centralized logout function
import { collection, getDocs } from "firebase/firestore";
import ChatWrapper from "@/components/chatWrapper";
// Removed ThemeProvider import
import Header from "@/components/Header";
import ProfileSelector from "@/components/ProfileSelector";

function HomeContent() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const searchParams = useSearchParams();
  const [useProfileGenres, setUseProfileGenres] = useState(true); // State for the checkbox
  const profileId = searchParams?.get("profile") ?? null;

  useEffect(() => {
    const fetchProfiles = async (userId: string) => {
      const profilesRef = collection(db, "chats", userId, "profiles");
      const snapshot = await getDocs(profilesRef);
      const profilesData = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name
      }));
      setProfiles(profilesData);
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserEmail(user.email);
        fetchProfiles(user.uid);
      } else {
        localStorage.removeItem("isAuthenticated");
        router.push("/login");
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGenreCheckboxChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setUseProfileGenres(event.target.checked);
  }, []);

  const handleSignOut = async () => {
    if (window.confirm("Are you sure you want to log out?")) {
      try {
        await logout(); // Use the centralized logout function
        localStorage.removeItem("isAuthenticated");
        router.push("/login");
      } catch (error) {
        console.error("Sign Out Error:", error);
        // Optionally show an error message to the user
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-start h-screen bg-blue-500 relative w-full font-comic">
      <div className="w-full text-center mt-4">
        <Header />
      </div>

      {!profileId ? (
        <ProfileSelector />
      ) : (
        <>
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <button
              onClick={() => router.push('/')}
              className="bg-red-500 p-2 rounded text-white"
            >
              ← Back
            </button>
            <div className="bg-yellow-500 p-2 rounded text-white">
            🎈 Hello, {profiles.find((p) => p.id === profileId)?.name || "Unknown"}!
            </div>
          </div>

          {/* Checkbox and Reading Log Button */}
          <div className="absolute top-4 right-20 flex items-center gap-4 bg-blue-500 p-2 rounded text-white"> {/* Increased gap */}
            <label htmlFor="useProfileGenres" className="text-sm">🎨 Show content {profiles.find((p) => p.id === profileId)?.name || "Unknown"} enjoys?</label>
            {/* Checkbox */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="useProfileGenres"
                checked={useProfileGenres}
                onChange={handleGenreCheckboxChange}
                className="mr-2"
              />
            </div>

            {/* Reading Log Button - Link includes profileId */}
            <button
              onClick={() => router.push(`/reading-log?profile=${profileId}`)}
              className="bg-green-500 text-white text-sm px-3 py-1 rounded" // Simple button styling
              disabled={!profileId} // Disable if no profile is selected
            >
              Reading Log
            </button>
          </div>

          <div className="w-full flex justify-center">
            <ChatWrapper profileId={profileId} useProfileGenres={useProfileGenres} /> {/* Pass state to ChatWrapper */}
          </div>
        </>
      )}

      <div className="absolute top-4 right-4">
        <div
          className="relative" // Add relative positioning for the dropdown
          onMouseEnter={() => setMenuOpen(true)}
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            className="w-10 h-10 flex items-center justify-center bg-yellow-500 text-white rounded-full" // Removed relative class, it's on the parent now
        >
          👤
        </button>

        {menuOpen && (
          <div className="absolute right-0 w-48 bg-white shadow-lg rounded p-3 z-10"> {/* Removed mt-2 */}
            <p className="text-sm text-gray-700">{userEmail || "Loading..."}</p>
            <button
              onClick={() => router.push('/settings')}
              className="w-full mt-2 px-4 py-2 bg-gray-200 text-gray-800 rounded"
            >
              Settings
            </button>
            <button
              onClick={handleSignOut}
              className="w-full mt-2 px-4 py-2 bg-red-500 text-white rounded"
            >
              Sign Out
            </button>
          </div>
        )}
       </div> {/* Close the onMouseEnter/Leave div */}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    // Removed ThemeProvider wrapper
    <Suspense fallback={<div>Loading...</div>}>
      <HomeContent />
    </Suspense>
    // Removed ThemeProvider wrapper
  );
}
