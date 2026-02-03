"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc, updateDoc, Timestamp, collection, query, orderBy, getDocs, deleteDoc } from "firebase/firestore"; // Import deleteDoc
import ReactMarkdown from 'react-markdown';
import Header from "@/components/Header"; // Assuming Header is needed

// Define interface for child profile data
interface ChildProfile {
  name: string;
  dob: Timestamp | null; // Assuming Timestamp from Firestore
  gender: string;
  interests: string[];
  nlbOnly: boolean; // Added for NLB book recommendations
  // Add other fields as necessary
}

// Define interface for form data (might be slightly different, e.g., DOB as string)
interface ProfileFormData {
    name: string;
    dob: string; // Use string for input field
    gender: string;
    interests: string; // Use comma-separated string for input
    nlbOnly: boolean; // Added for NLB book recommendations
}


export default function ChildProfilePage() {
  const router = useRouter();
  const params = useParams();
  // Safely access profileId, default to empty string if params or profileId is null/undefined
  const profileId = (params?.profileId as string) ?? '';

  const [user, setUser] = useState<User | null>(null);
  const [profileData, setProfileData] = useState<ChildProfile | null>(null);
  // Initialize nlbOnly to true by default in formData
  const [formData, setFormData] = useState<ProfileFormData>({ name: '', dob: '', gender: '', interests: '', nlbOnly: true });
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isResetting, setIsResetting] = useState(false); // State for reset operation
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Helper function to normalize gender to match dropdown options
  const normalizeGender = (gender: string | undefined): string => {
    if (!gender) return '';
    const lowerGender = gender.toLowerCase().trim();
    if (lowerGender === 'male') return 'Male';
    if (lowerGender === 'female') return 'Female';
    // If it's already "Male" or "Female", return as is
    if (gender === 'Male' || gender === 'Female') return gender;
    return ''; // Default to empty if not a recognized/convertible value
  };

  // State for Chat History
  interface RecommendationItem {
    // text?: string; // Removing text for now, focusing on structured data
    bookItems?: Array<{ title: string; bookUrl: string; coverUrl?: string }>; // Array for structured book data
    videos?: Array<{ 
      id: string; // YouTube video ID
      title: string; 
      thumbnailUrl?: string; // Optional, matches structure from API
      channelTitle?: string; // Optional
      // videoUrl is constructed, not stored directly in this object
    }>; 
  }
  interface ChatHistoryItem {
    id: string;
    title: string;
    recommendations: RecommendationItem[]; // Use the new structured type
  }
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [isChatHistoryLoading, setIsChatHistoryLoading] = useState(true);
  const [chatHistoryError, setChatHistoryError] = useState<string | null>(null);
  const [openChatId, setOpenChatId] = useState<string | null>(null); // State for dropdown


  // Authentication and Data Fetching
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/login"); // Redirect if not logged in
      } else {
        setUser(currentUser);
        if (profileId) {
          fetchProfileData(currentUser.uid, profileId);
          fetchChatHistory(currentUser.uid, profileId); // Fetch chat history here
        } else {
            setError("Profile ID is missing.");
            setIsLoading(false);
        }
      }
    });
    return () => unsubscribe();
  }, [router, profileId]); // Add profileId dependency

  const fetchProfileData = async (userId: string, profId: string) => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const profileDocRef = doc(db, "chats", userId, "profiles", profId);
      const docSnap = await getDoc(profileDocRef);

      if (docSnap.exists()) {
        const data = docSnap.data() as ChildProfile;
        setProfileData(data);
        // Initialize form data when profile data is fetched
        setFormData({
            name: data.name || '',
            // Convert Timestamp to YYYY-MM-DD string for input type="date"
            dob: data.dob?.toDate ? data.dob.toDate().toISOString().split('T')[0] : '',
            gender: normalizeGender(data.gender), // Use normalizeGender
            interests: Array.isArray(data.interests) ? data.interests.join(', ') : '',
            // Default nlbOnly to true if it's undefined in the fetched data
            nlbOnly: data.nlbOnly === undefined ? true : data.nlbOnly
        });
      } else {
        setError("Profile not found.");
        setProfileData(null);
      }
    } catch (err) {
      console.error("Error fetching profile data:", err);
      setError("Failed to load profile data.");
      setProfileData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Fetch Chat History ---
  const fetchChatHistory = async (userId: string, profId: string) => {
    setIsChatHistoryLoading(true);
    setChatHistoryError(null);
    setChatHistory([]); // Clear previous history

    try {
      const chatSessionsRef = collection(db, "chats", userId, "profiles", profId, "chatSessions");
      const qSessions = query(chatSessionsRef, orderBy("timestamp", "desc")); // Get recent chats first
      const sessionsSnapshot = await getDocs(qSessions);

      const historyItems: ChatHistoryItem[] = [];
      const linkRegex = /\[.*\]\(https?:\/\/.*?\)/; // Regex for markdown links

      for (const sessionDoc of sessionsSnapshot.docs) {
        const sessionData = sessionDoc.data();
        const chatId = sessionDoc.id;
        const chatTitle = sessionData.title || "Untitled Chat";

        const messagesRef = collection(db, "chats", userId, "profiles", profId, "chatSessions", chatId, "messages");
        const qMessages = query(messagesRef, orderBy("timestamp", "asc"));
        const messagesSnapshot = await getDocs(qMessages);

        const recommendations: RecommendationItem[] = []; // Use the new type
        messagesSnapshot.docs.forEach((msgDoc) => {
          const msgData = msgDoc.data();
          // Check if sender is bot
          if (msgData.sender === 'bot') {
            const recommendationItem: RecommendationItem = {};
            let hasContent = false; // Flag to check if we added books or videos

            // Check for book data
            if (msgData.type === 'book' && msgData.bookData && typeof msgData.bookData === 'object') {
              // Ensure bookData has title and url (which is the external link)
              const bookData = msgData.bookData as { title: string; id: string; url?: string; coverUrl?: string }; 
              if (bookData.title && bookData.url) { 
                 recommendationItem.bookItems = [{ 
                    title: bookData.title,
                    bookUrl: bookData.url, // Use the 'url' field for the hyperlink
                    coverUrl: bookData.coverUrl
                 }];
                 hasContent = true;
              }
            }

            // Check for video data
            const hasVideos = Array.isArray(msgData.videos) && msgData.videos.length > 0;
            if (hasVideos) {
              // msgData.videos contains items with { id, title, thumbnailUrl, channelTitle }
              recommendationItem.videos = msgData.videos as Array<{ id: string; title: string; thumbnailUrl?: string; channelTitle?: string }>;
              hasContent = true;
            }

            // Only add the item if we found structured book data or videos
            if (hasContent) {
              recommendations.push(recommendationItem);
            }
            // We ignore plain text messages from the bot for the recommendations list now
          }
        });

        // Only add chat sessions to history if they contain actual recommendations (books or videos)
        if (recommendations.length > 0) {
             historyItems.push({
                 id: chatId,
                 title: chatTitle,
                 recommendations: recommendations,
             });
        }
        // We removed the 'else' block, so chats without extracted books/videos won't be added to the history list.

      }

      setChatHistory(historyItems);

    } catch (err) {
      console.error("Error fetching chat history:", err);
      setChatHistoryError("Failed to load chat history.");
    } finally {
      setIsChatHistoryLoading(false);
    }
  };


  // --- Edit Mode Handlers ---

  const handleEdit = () => {
    if (!profileData) return;
    // Ensure form data is synced with latest profile data before editing
    setFormData({
        name: profileData.name || '',
        dob: profileData.dob?.toDate ? profileData.dob.toDate().toISOString().split('T')[0] : '',
        gender: normalizeGender(profileData.gender), // Use normalizeGender
        interests: Array.isArray(profileData.interests) ? profileData.interests.join(', ') : '',
        // Ensure nlbOnly is included when entering edit mode, default true if undefined
        nlbOnly: profileData.nlbOnly === undefined ? true : profileData.nlbOnly
    });
    setIsEditing(true);
    setSuccessMessage(null); // Clear success message when starting edit
    setError(null); // Clear error message when starting edit
  };

  const handleCancel = () => {
    setIsEditing(false);
    setError(null); // Clear errors on cancel
    // Optionally reset formData to original profileData if needed,
    // but it's often fine to leave it as is until next edit click.
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    // Handle checkbox input type specifically
    const newValue = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData(prev => ({ ...prev, [name]: newValue }));
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !profileId) {
        setError("User or Profile ID missing. Cannot save.");
        return;
    }
    setError(null);
    setSuccessMessage(null);
    setIsLoading(true); // Indicate saving process

    // Validate that a gender is selected
    if (!formData.gender) {
        setError("Please select a gender.");
        setIsLoading(false); // Stop loading indicator
        return; // Prevent form submission
    }

    try {
        // Prepare data for Firestore update
        const interestsArray = formData.interests.split(',').map(item => item.trim()).filter(Boolean);
        const dobTimestamp = formData.dob ? Timestamp.fromDate(new Date(formData.dob)) : null;

        const updatedData: Partial<ChildProfile> = {
            name: formData.name,
            dob: dobTimestamp,
            gender: formData.gender,
            interests: interestsArray,
            nlbOnly: formData.nlbOnly, // Add nlbOnly to the update object
        };

        const profileDocRef = doc(db, "chats", user.uid, "profiles", profileId);
        await updateDoc(profileDocRef, updatedData);

        // Update local state and exit edit mode
        setProfileData(prev => prev ? { ...prev, ...updatedData } : null); // Update local profile data
        setIsEditing(false);
        setSuccessMessage("Profile updated successfully!");

    } catch (err) {
        console.error("Error updating profile:", err);
        setError("Failed to update profile. Please try again.");
    } finally {
        setIsLoading(false);
    }
  };

  // --- Reset Recommendations Handler ---
  const handleResetRecommendations = async () => {
    if (!user || !profileId) {
      setError("User or Profile ID missing. Cannot reset recommendations.");
      return;
    }

    const isConfirmed = window.confirm(
      "Are you sure you want to reset the recommendation history for this profile? " +
      "This will clear the list of previously recommended books and videos used to avoid repetition."
    );

    if (isConfirmed) {
      setIsResetting(true);
      setError(null);
      setSuccessMessage(null);
      
      const globalRecPath = `chats/${user.uid}/profiles/${profileId}/globalRecommendations`;
      const genreContextPath = `chats/${user.uid}/profiles/${profileId}/genrePaginationContext`;

      const globalRecColRef = collection(db, globalRecPath);
      const genreContextColRef = collection(db, genreContextPath);

      console.log(`Attempting to delete documents in: ${globalRecPath} and ${genreContextPath}`);

      try {
        // 1. Delete globalRecommendations
        const globalRecSnapshot = await getDocs(globalRecColRef);
        let globalRecsDeletedCount = 0;
        if (!globalRecSnapshot.empty) {
          const deleteGlobalRecPromises = globalRecSnapshot.docs.map((docSnapshot) => {
            console.log(`Deleting global recommendation: ${docSnapshot.ref.path}`);
            return deleteDoc(docSnapshot.ref);
          });
          await Promise.all(deleteGlobalRecPromises);
          globalRecsDeletedCount = globalRecSnapshot.size;
          console.log(`Finished deleting ${globalRecsDeletedCount} documents in collection: ${globalRecPath}.`);
        } else {
          console.log(`Collection ${globalRecPath} is already empty.`);
        }

        // 2. Delete genrePaginationContext
        const genreContextSnapshot = await getDocs(genreContextColRef);
        let genreContextsDeletedCount = 0;
        if (!genreContextSnapshot.empty) {
          const deleteGenreContextPromises = genreContextSnapshot.docs.map((docSnapshot) => {
            console.log(`Deleting genre pagination context: ${docSnapshot.ref.path}`);
            return deleteDoc(docSnapshot.ref);
          });
          await Promise.all(deleteGenreContextPromises);
          genreContextsDeletedCount = genreContextSnapshot.size;
          console.log(`Finished deleting ${genreContextsDeletedCount} documents in collection: ${genreContextPath}.`);
        } else {
          console.log(`Collection ${genreContextPath} is already empty.`);
        }

        if (globalRecsDeletedCount === 0 && genreContextsDeletedCount === 0) {
          setSuccessMessage("Recommendation history and pagination contexts are already empty.");
        } else {
          setSuccessMessage(
            `Successfully reset recommendation history (${globalRecsDeletedCount} items) and pagination contexts (${genreContextsDeletedCount} items).`
          );
        }

      } catch (err) {
        // Catch errors during query or delete operations
        console.error(`Error attempting to clear collections ${globalRecPath} or ${genreContextPath}:`, err);
         // Log the specific error code and message if available
        if (err instanceof Error) {
             const firebaseError = err as any; // Cast to access potential 'code' property
             console.error("Detailed Error:", firebaseError);
             console.error("Firebase Error Code:", firebaseError.code);
             console.error("Firebase Error Message:", firebaseError.message);
             setError(`Failed to reset recommendation history: ${firebaseError.message} (Code: ${firebaseError.code || 'N/A'})`);
        } else {
            console.error("Non-standard error caught:", err);
            setError("Failed to reset recommendation history due to an unexpected error. Please try again.");
        }
      } finally {
        setIsResetting(false);
      }
    }
  };

  // --- Utility Functions ---
  const formatDob = (timestamp: Timestamp | null): string => {
    if (!timestamp?.toDate) return 'N/A';
    return timestamp.toDate().toLocaleDateString();
  };

  // --- Render Logic ---
  if (isLoading && !profileData) { // Show initial loading state
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 w-full">
        <Header />
        <p className="text-gray-700 dark:text-gray-300 mt-4">Loading profile...</p>
      </div>
    );
  }

  if (error && !profileData) { // Show error if profile couldn't be loaded
      return (
          <div className="flex flex-col items-center justify-start min-h-screen bg-gray-100 w-full">
              <div className="w-full text-center mt-4"><Header /></div>
              <div className="bg-white p-6 rounded shadow-md w-full max-w-md text-gray-800 text-center">
                  <p className="text-red-500">{error}</p>
                  <button
                      onClick={() => router.push('/settings')}
                      className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                      Back to Settings
                  </button>
              </div>
          </div>
      );
  }

  if (!profileData) { // Should ideally be covered by loading/error, but as a fallback
      return (
          <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 w-full">
              <Header />
              <p className="text-gray-700 dark:text-gray-300 mt-4">Profile not available.</p>
               <button
                  onClick={() => router.push('/settings')}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
               >
                  Back to Settings
               </button>
          </div>
      );
  }

  // Main content render
  return (
    <div
      className="w-full min-h-screen flex flex-col items-center px-4 py-8 font-comic text-[#333] overflow-y-auto"
      style={{ backgroundImage: "url('/subtle-settings-backdrop.png')", backgroundSize: "cover" }}
    >
      <div className="w-full text-center mt-4">
        <h1 className={`text-4xl font-bold mb-4 text-black`}>🤖 ChatTots</h1>
      </div>
      <div className="bg-white p-6 rounded shadow-md w-full max-w-2xl text-gray-800">
        <h1 className="text-2xl font-bold mb-6 text-center">
            {isEditing ? `Editing ${profileData.name}'s Profile` : `${profileData.name}'s Profile`}
        </h1>

        {/* Display Success/Error Messages */}
        {successMessage && <p className="text-green-600 text-center mb-4">{successMessage}</p>}
        {error && <p className="text-red-500 text-center mb-4">{error}</p>}
        {isLoading && isEditing && <p className="text-blue-500 text-center mb-4">Saving...</p>}


        {!isEditing ? (
          // --- Display Mode ---
          <div className="space-y-3">
            <p><span className="font-semibold">Name:</span> {profileData.name || "N/A"}</p>
            <p><span className="font-semibold">Date of Birth:</span> {formatDob(profileData.dob)}</p>
            <p><span className="font-semibold">Gender:</span> {profileData.gender || 'N/A'}</p>
            {profileData.interests && profileData.interests.length > 0 && (
              <div>
                <p className="font-semibold">Interests:</p>
                <ul className="list-disc pl-5">
                  {profileData.interests.map((interest, i) => (
                    <li key={i}>{interest}</li>
                  ))}
                </ul>
              </div>
            )}
           {/* Display NLB Only Setting */}
           <p><span className="font-semibold">NLB Book Recommendations Only:</span> {profileData.nlbOnly === undefined ? 'Yes (Default)' : profileData.nlbOnly ? 'Yes' : 'No'}</p>

            {/* --- Chat History Section --- */}
            <div className="mt-6 border-t pt-4">
              <h2 className="text-xl font-semibold mb-3">Chat History</h2>
              {isChatHistoryLoading ? (
                <p className="text-gray-500">Loading chat history...</p>
              ) : chatHistoryError ? (
                <p className="text-red-500">{chatHistoryError}</p>
              ) : chatHistory.length > 0 ? (
                <div className="space-y-2 pr-2"> {/* Removed fixed height constraint */}
                  {chatHistory.map((chat) => (
                    <div key={chat.id} className="border rounded overflow-hidden"> {/* Wrap each chat in a bordered container */}
                      <button
                        onClick={() => setOpenChatId(openChatId === chat.id ? null : chat.id)}
                        className="w-full text-left px-4 py-2 bg-gray-100 hover:bg-gray-200 focus:outline-none flex justify-between items-center"
                      >
                        <h3 className="font-semibold text-lg">{chat.title}</h3>
                        <span>{openChatId === chat.id ? '▲' : '▼'}</span> {/* Indicator */}
                      </button>
                      {openChatId === chat.id && ( // Conditionally render content
                        <div className="p-4 border-t">
                          {chat.recommendations.length > 0 ? (
                            <div className="space-y-3 text-sm">
                              {chat.recommendations.map((rec, index) => (
                                <div key={index}>
                                  {/* Render structured book items if present */}
                                  {rec.bookItems && rec.bookItems.length > 0 && (
                                      <div className="mb-2">
                                          <p className="font-semibold text-sm mb-1">Books:</p>
                                          <ul className="list-disc pl-5 space-y-1 text-sm">
                                              {rec.bookItems.map((book, bIndex) => (
                                                  <li key={bIndex}>
                                                      <a
                                                          href={book.bookUrl} // Use bookUrl from the object
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          className="text-blue-600 hover:underline"
                                                      >
                                                          {book.title || "View Book"} {/* Fallback title */}
                                                      </a>
                                                      {/* Optionally display author or cover image here too */}
                                                      {/* {book.coverUrl && <img src={book.coverUrl} alt={book.title} className="h-10 w-auto inline-block ml-2"/>} */}
                                                  </li>
                                              ))}
                                          </ul>
                                      </div>
                                  )}
                                  {/* Render videos if present */}
                                  {rec.videos && rec.videos.length > 0 && (
                                    <div className="mb-2">
                                      <p className="font-semibold text-sm mb-1">Videos:</p>
                                      <ul className="list-disc pl-5 space-y-1 text-sm">
                                        {rec.videos.map((video, vIndex) => (
                                          <li key={vIndex}>
                                            {video.id ? (
                                              <a
                                                href={`https://www.youtube.com/watch?v=${video.id}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-blue-600 hover:underline"
                                              >
                                                {video.title || "Watch Video"} {/* Fallback title */}
                                              </a>
                                            ) : (
                                              <span>{video.title || "Video (ID missing)"}</span>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-gray-500 italic">No specific recommendations (books/videos) found in this chat.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No chat history found for this profile.</p>
              )}
            </div>
            {/* --- End Chat History Section --- */}

            <div className="flex justify-center space-x-4 pt-4">
               <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
               >
                  Edit Profile
               </button>
                <button
                    onClick={() => {
                        // Set flag before navigating
                        sessionStorage.setItem('navigatedFromProfile', 'true');
                        router.push('/settings'); // Navigate back to settings list
                    }}
                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                >
                    Back to Settings
                </button>
                {/* Add Reset Button */}
                <button
                  onClick={handleResetRecommendations}
                  disabled={isResetting}
                  className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                  title="Clear the list of previously recommended items for this profile"
                >
                  {isResetting ? 'Resetting...' : 'Reset Recommendation History'}
                </button>
            </div>
          </div>
        ) : (
          // --- Edit Mode ---
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-gray-900"
                required
              />
            </div>
            <div>
              <label htmlFor="dob" className="block text-sm font-medium text-gray-700">Date of Birth</label>
              <input
                type="date"
                id="dob"
                name="dob"
                value={formData.dob}
                onChange={handleInputChange}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-gray-900"
              />
            </div>
             <div>
              <label htmlFor="gender" className="block text-sm font-medium text-gray-700">Gender</label>
              <select
                id="gender"
                name="gender"
                value={formData.gender}
                onChange={handleInputChange}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-gray-900"
                required // Add required attribute for browser validation
              >
                <option value="">Select Gender</option> {/* Ensure value is empty for required validation */}
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label htmlFor="interests" className="block text-sm font-medium text-gray-700">Interests (comma-separated)</label>
              <textarea
                id="interests"
                name="interests"
                rows={3}
                value={formData.interests}
                onChange={handleInputChange}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-white text-gray-900"
                placeholder="e.g., Dinosaurs, Space, Art"
              />
            </div>
            {/* NLB Only Checkbox */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="nlbOnly"
                name="nlbOnly"
                checked={formData.nlbOnly}
                onChange={handleInputChange}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded mr-2"
              />
              <label htmlFor="nlbOnly" className="text-sm font-medium text-gray-700">Recommend Books from NLB Only</label>
            </div>
            <div className="flex justify-center space-x-4 pt-4">
              <button
                type="submit"
                disabled={isLoading}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              >
                {isLoading ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isLoading}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
