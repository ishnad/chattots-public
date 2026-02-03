'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
// Removed Link import as we'll use a standard anchor tag
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, query, onSnapshot, orderBy, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'; // Import updateDoc and deleteDoc
import styles from './reading-log.module.css'; // Import the new CSS Module

interface Book {
  id: string; // This will now hold the Firestore Document ID
  nlbUrl?: string; // Added field to hold the NLB URL if present in data
  title: string;
  author: string;
  coverUrl?: string;
  addedAt?: any;
  status?: string;
}

interface Profile {
  id: string;
  name: string;
}

function ReadingLogContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const profileId = searchParams?.get("profile");

  const [readingLog, setReadingLog] = useState<Book[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setCurrentUser(user);
      } else {
        setCurrentUser(null);
        router.push('/login');
      }
    });
    return () => unsubscribeAuth();
  }, [router]);

  useEffect(() => {
    // Reset states if dependencies are missing
    if (!currentUser || !profileId) {
      setLoading(false);
      setReadingLog([]);
      setProfile(null);
      setError(null); // Clear previous errors
      if (!profileId && currentUser) { // Only set error if logged in but no profile ID
          setError("No profile selected.");
      }
      return; // Stop execution
    }

    // Start loading and clear previous errors/data for the new fetch
    setLoading(true);
    setError(null);
    setReadingLog([]);
    setProfile(null); // Also reset profile data

    let unsubscribeFirestore: (() => void) | null = null;

    const fetchProfileAndLog = async () => {
      try {
        // 1. Fetch Profile Name
        const profileRef = doc(db, "chats", currentUser.uid, "profiles", profileId);
        const profileSnap = await getDoc(profileRef);

        if (!profileSnap.exists()) {
          console.error("Profile document not found for ID:", profileId);
          setError("Profile not found.");
          setLoading(false); // Stop loading
          return; // Stop if profile doesn't exist
        }
        // Profile exists, set profile state
        setProfile({ id: profileSnap.id, ...profileSnap.data() } as Profile);

        // 2. Set up Listener for Reading Log (only after confirming profile exists)
        const logCollectionRef = collection(db, "chats", currentUser.uid, "profiles", profileId, "readingLog");
        const q = query(logCollectionRef, orderBy('addedAt', 'desc'));

        unsubscribeFirestore = onSnapshot(q, (snapshot) => {
          // Listener successfully attached (even if snapshot is empty)
          const books: Book[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
              id: doc.id, // Assign Firestore doc ID to 'id'
              nlbUrl: data.id, // Assign the 'id' field from data (NLB URL) to 'nlbUrl'
              title: data.title,
              author: data.author,
              coverUrl: data.coverUrl,
              addedAt: data.addedAt,
              status: data.status,
            };
          });
          setReadingLog(books);
          setError(null); // Clear any previous listener error on successful update
          setLoading(false); // Stop loading once data (or empty snapshot) is received
        }, (err) => {
          // Error occurred within the listener (e.g., permissions)
          console.error("Firestore snapshot error:", err); // Log the specific Firestore error
          // Check for permission denied specifically
          if (err.code === 'permission-denied') {
             setError("Permission denied loading reading log.");
          } else {
             setError("Error loading reading log."); // Generic error for other listener issues
          }
          setReadingLog([]); // Clear potentially stale data
          setLoading(false); // Stop loading on error
        });

      } catch (err) {
          // Catch errors during getDoc (profile fetch) or initial listener setup
          console.error("Error fetching profile or setting up listener:", err);
          setError("Failed to load profile data."); // Error likely happened before listener setup
          setLoading(false); // Stop loading
      }
    };

    fetchProfileAndLog();

    // Cleanup function for the listener
    return () => {
      if (unsubscribeFirestore) {
        console.log("Unsubscribing from Firestore listener for profile:", profileId);
        unsubscribeFirestore();
      }
    };

  }, [currentUser, profileId]); // Dependencies for the effect

  const handleBack = () => {
    router.push(`/?profile=${profileId}`);
  };

  const handleStatusChange = async (bookId: string, newStatus: string) => {
    if (!currentUser || !profileId) {
      console.error("User or profile ID missing, cannot update status.");
      setError("Could not update status: Missing user or profile information.");
      return;
    }
    const bookRef = doc(db, "chats", currentUser.uid, "profiles", profileId, "readingLog", bookId);
    try {
      await updateDoc(bookRef, { status: newStatus });
      console.log(`Book ${bookId} status updated to ${newStatus}`);
      // No need to manually update state here, Firestore listener will do it
    } catch (err) {
      console.error("Error updating book status:", err);
      setError("Failed to update book status.");
    }
  };

  const handleDeleteBook = async (bookId: string, bookTitle: string) => {
    if (!currentUser || !profileId) {
      console.error("User or profile ID missing, cannot delete book.");
      setError("Could not delete book: Missing user or profile information.");
      return;
    }

    // Confirmation dialog
    const isConfirmed = window.confirm(`Are you sure you want to delete "${bookTitle}" from the reading log?`);

    if (isConfirmed) {
      const bookRef = doc(db, "chats", currentUser.uid, "profiles", profileId, "readingLog", bookId);
      try {
        await deleteDoc(bookRef);
        console.log(`Book ${bookId} (${bookTitle}) deleted successfully.`);
        // Firestore listener will automatically update the UI state
      } catch (err) {
        console.error("Error deleting book:", err);
        setError("Failed to delete book.");
      }
    } else {
      console.log("Book deletion cancelled by user.");
    }
  };


  return (
    // Use styles from the imported CSS module
    <main className={styles.main}>
      <div className={styles.header}>
        <div className="bg-yellow-500 p-2 rounded text-white">
          📖 {profile?.name ? `${profile.name}'s Reading Log` : 'Reading Log'}
        </div>
        <button onClick={handleBack} className={styles.utilityButton} disabled={!profileId}>
          ← Back
        </button>
      </div>

      <div className={styles.readingLogContainer}>
        {loading && <p>Loading reading log...</p>}
        {error && <p className={styles.error}>{error}</p>}
        {!loading && !error && readingLog.length === 0 && (
          <p>This reading log is empty. Add books from the chat!</p>
        )}
        {!loading && !error && readingLog.length > 0 && (
          <ul>
            {readingLog.map((book) => (
              // Combine module style with utility classes if needed
              <li key={book.id} className={`${styles.logItem} flex items-center gap-4 justify-between`}>
                 <div className="flex items-center gap-4 flex-grow">
                   {book.coverUrl && (
                     <img src={book.coverUrl} alt={`${book.title} cover`} className="w-12 h-16 object-cover rounded flex-shrink-0" />
                   )}
                   <div className="flex-grow">
                     {/* Use standard anchor tag to link directly to the external nlbUrl */}
                     <a href={book.nlbUrl || '#'} target="_blank" rel="noopener noreferrer" className="hover:underline">
                       <strong className="block">{book.title}</strong>
                     </a>
                     <span className="text-sm text-gray-600">by {book.author}</span>
                   </div>
                 </div>
                 <div className="flex-shrink-0">
                   <select
                     value={book.status || 'to-read'} // Default to 'to-read' if status is missing
                     onChange={(e) => handleStatusChange(book.id, e.target.value)}
                     className={`${styles.statusDropdown} p-1 border rounded bg-white text-sm`} // Add some basic styling
                     disabled={!currentUser || !profileId} // Disable if user/profile not loaded
                   >
                     <option value="to-read">To Read</option>
                     <option value="reading">Reading</option>
                     <option value="completed">Completed</option>
                     <option value="dropped">Dropped</option>
                   </select>
                   {/* Delete Button */}
                   <button
                     onClick={() => handleDeleteBook(book.id, book.title)}
                     className="ml-2 text-red-500 hover:text-red-700 text-xl" // Basic styling
                     title={`Delete "${book.title}"`}
                     disabled={!currentUser || !profileId} // Disable if user/profile not loaded
                   >
                     🗑️
                   </button>
                 </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Removed <style jsx> block */}
    </main>
  );
}

export default function ReadingLogPage() {
    return (
        <Suspense fallback={<div>Loading profile...</div>}>
            <ReadingLogContent />
        </Suspense>
    );
}
