'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link'; // Import Link for navigation
import { db, auth } from '@/lib/firebase'; // Import client-side db and auth instances
import { User as FirebaseUser, onAuthStateChanged, getIdTokenResult } from 'firebase/auth'; // Import client-side auth utilities
import { collection, getDocs, doc, query, orderBy } from 'firebase/firestore'; // Use client-side Firestore for READ only

// Admin-only operations (add, update, delete) must be moved to API routes.

interface BookGenre {
  id: string;
  value: string;
  synonyms: string[];
  emoji?: string | null; // Add optional emoji field
}

export default function BookGenresPage() {
  const [genres, setGenres] = useState<BookGenre[]>([]);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true); // Separate loading for auth check
  const [loading, setLoading] = useState(true); // Loading for genre data
  const [error, setError] = useState('');
  const [actionStatus, setActionStatus] = useState(''); // For add/update/delete feedback ('loading', 'success', 'error')
  const [actionMessage, setActionMessage] = useState(''); // Feedback message
  const [newGenre, setNewGenre] = useState<Omit<BookGenre, 'id'>>({ // Use Omit for type safety
    value: '',
    synonyms: [''],
    emoji: '' // Initialize emoji field
  });

  const triggerDialogflowUpdate = async () => {
    if (!currentUser) return;
    
    try {
        const token = await currentUser.getIdToken();
        await fetch('/api/admin/dialogflow/update-genres', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });
    } catch (err) {
        console.error("Error triggering Dialogflow update:", err);
    }
  };

  // Authentication and Admin Check Effect
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      setIsAdmin(false);
      if (user) {
        setCurrentUser(user);
        try {
          const idTokenResult = await getIdTokenResult(user, true); // Force refresh
          if (idTokenResult.claims.admin === true) {
            setIsAdmin(true);
            console.log("Book Genres Page: User is admin.");
            // Trigger genre fetch only after confirming admin status
            fetchGenres();
          } else {
            console.log("Book Genres Page: User is not admin.");
            setError("Access Denied: You do not have admin privileges.");
            setLoading(false); // Stop data loading if not admin
          }
        } catch (err) {
          console.error("Error checking admin claim:", err);
          setError("Error verifying admin status.");
          setLoading(false);
        }
      } else {
        setCurrentUser(null);
        setError("Please log in to manage book genres.");
        setLoading(false); // Stop data loading if logged out
        setGenres([]); // Clear genres if logged out
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []); // Run only once on mount


  // Fetch Genres Effect (now depends on isAdmin flag set by auth effect)
  const fetchGenres = async () => {
    console.log("fetchGenres called..."); // Log start
    // This function is now called by the auth effect when admin status is confirmed
    // No need for separate useEffect here
    // const fetchGenres = async () => {
      setLoading(true);
      setError('');
      try {
        console.log("Querying bookGenres collection..."); // Log query attempt
        // Use client-side SDK for reading genres (allowed by rules for authenticated users)
        const genresQuery = query(collection(db, 'bookGenres'), orderBy('value'));
        const querySnapshot = await getDocs(genresQuery);
        console.log(`Found ${querySnapshot.size} documents in bookGenres.`); // Log count
        const genresData = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as BookGenre[];
        console.log("Processed genresData:", genresData); // Log processed data
        setGenres(genresData);
      } catch (err) {
        console.error("Error fetching genres:", err); // Log the actual error object
        setError(err instanceof Error ? err.message : 'Failed to fetch genres');
      } finally {
        setLoading(false);
      }
  }; // End of fetchGenres function definition

    // Removed direct call to fetchGenres here, it's called from auth effect
    // fetchGenres();
  // }, []); // Removed dependency array, logic moved to auth effect

  const handleAddSynonym = (index: number) => {
    const updatedGenres = [...genres];
    updatedGenres[index].synonyms.push('');
    setGenres(updatedGenres);
  };

  const handleRemoveSynonym = (genreIndex: number, synonymIndex: number) => {
    const updatedGenres = [...genres];
    updatedGenres[genreIndex].synonyms.splice(synonymIndex, 1);
    setGenres(updatedGenres);
  };

  const handleSynonymChange = (genreIndex: number, synonymIndex: number, value: string) => {
    const updatedGenres = [...genres];
    updatedGenres[genreIndex].synonyms[synonymIndex] = value;
    setGenres(updatedGenres);
  };

  const handleSave = async (genre: BookGenre) => {
    if (!currentUser) {
        setError("Authentication error. Please log in again.");
        return;
    }
    setActionStatus('loading');
    setActionMessage('');
    setError('');

    try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`/api/admin/book-genres/${genre.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                value: genre.value,
                synonyms: genre.synonyms.filter(s => s.trim() !== ''), // Send cleaned synonyms
                emoji: genre.emoji || null // Send emoji (or null if empty/undefined)
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.details || data.error || `Failed to update genre (Status: ${response.status})`);
        }

        setActionStatus('success');
        setActionMessage(`Genre "${genre.value}" updated successfully.`);
        // Trigger Dialogflow update after successful save
        await triggerDialogflowUpdate();

    } catch (err) {
        console.error("Error saving genre:", err);
        setActionStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to update genre';
        setActionMessage(message);
        setError(message); // Also set general error if needed
    } finally {
        // Optionally clear status after a delay
        // setTimeout(() => { setActionStatus(''); setActionMessage(''); }, 3000);
    }
  };

  const handleDelete = async (id: string, value: string) => {
    if (!currentUser) {
        setError("Authentication error. Please log in again.");
        return;
    }
    if (window.confirm(`Are you sure you want to delete the genre "${value}"?`)) {
        setActionStatus('loading');
        setActionMessage('');
        setError('');

        try {
            const token = await currentUser.getIdToken();
            const response = await fetch(`/api/admin/book-genres/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.details || data.error || `Failed to delete genre (Status: ${response.status})`);
            }

            setActionStatus('success');
            setActionMessage(`Genre "${value}" deleted successfully.`);
            // Update UI optimistically
            setGenres(genres.filter(g => g.id !== id));
            // Trigger Dialogflow update after successful delete
            await triggerDialogflowUpdate();

        } catch (err) {
            console.error("Error deleting genre:", err);
            setActionStatus('error');
            const message = err instanceof Error ? err.message : 'Failed to delete genre';
            setActionMessage(message);
            setError(message);
        } finally {
             // Optionally clear status after a delay
             // setTimeout(() => { setActionStatus(''); setActionMessage(''); }, 3000);
        }
    }
  };

  const handleAddGenre = async () => {
    if (!currentUser) {
        setError("Authentication error. Please log in again.");
        return;
    }
    if (!newGenre.value.trim()) {
        setError("Genre name cannot be empty.");
        return;
    }

    setActionStatus('loading');
    setActionMessage('');
    setError('');

    try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/admin/book-genres', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                value: newGenre.value,
                synonyms: newGenre.synonyms.filter(s => s.trim() !== ''),
                emoji: newGenre.emoji || null // Send emoji (or null if empty)
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.details || data.error || `Failed to add genre (Status: ${response.status})`);
        }

        setActionStatus('success');
        setActionMessage(`Genre "${data.value}" added successfully.`);
        // Trigger Dialogflow update after successful add
        await triggerDialogflowUpdate();
        // Add the new genre returned from the API (includes the ID) to the state
        const addedGenre: BookGenre = {
            id: data.id,
            value: data.value,
            synonyms: data.synonyms,
            emoji: data.emoji // Expect emoji back from API
        };
        setGenres([...genres, addedGenre].sort((a, b) => a.value.localeCompare(b.value))); // Keep sorted
        setNewGenre({ value: '', synonyms: [''], emoji: '' }); // Reset form including emoji

    } catch (err) {
        console.error("Error adding genre:", err);
        setActionStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to add genre';
        setActionMessage(message);
        setError(message);
    } finally {
         // Optionally clear status after a delay
         // setTimeout(() => { setActionStatus(''); setActionMessage(''); }, 3000);
    }
  };

  // Render loading state based on auth check first, then data loading
  if (authLoading) {
    return <div className="p-4 text-center">Verifying authentication...</div>;
  }

  // If not admin or logged out after auth check, show error and stop
  if (!isAdmin || !currentUser) {
     return (
        <div className="p-6 max-w-4xl mx-auto">
             <h1 className="text-2xl font-bold mb-6">Manage Book Genres</h1>
             <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">
                 {error || "Access Denied. Please log in as an admin."}
             </div>
        </div>
     );
  }

  // If admin, but data is still loading
  if (loading) {
    return <div className="p-4 text-center">Loading genres...</div>;
  }

  // Main content render for authenticated admin
  return (
    // Add h-screen and overflow-y-auto for full height scrolling
    <div className="p-6 max-w-4xl mx-auto h-screen overflow-y-auto">
       <div className="flex justify-between items-center mb-6 sticky top-0 bg-white py-4 z-10"> {/* Make header sticky */}
         <h1 className="text-2xl font-bold">Manage Book Genres</h1>
         <Link href="/admin">
           <button className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline">
             &larr; Back to Admin
           </button>
         </Link>
       </div>

      {/* Display general errors */}
      {error && !actionMessage && <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">{error}</div>}

      {/* Display action feedback */}
      {actionMessage && (
          <div className={`p-4 mb-4 border-l-4 ${
              actionStatus === 'success' ? 'bg-green-100 border-green-500 text-green-700' :
              actionStatus === 'error' ? 'bg-red-100 border-red-500 text-red-700' :
              'bg-blue-100 border-blue-500 text-blue-700' // For loading or other statuses
          }`}>
              {actionStatus === 'loading' ? 'Processing...' : actionMessage}
          </div>
      )}


      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Add New Genre</h2>
        <div className="flex flex-col space-y-4">
          <div>
            <label className="block text-gray-700 mb-2">Genre Name</label>
            <input
              type="text"
              value={newGenre.value}
              onChange={(e) => setNewGenre({...newGenre, value: e.target.value})}
              className="w-full p-2 border rounded"
              placeholder="e.g. Fantasy"
            />
          </div>
          {/* Add Emoji Input */}
          <div>
            <label className="block text-gray-700 mb-2">Emoji (Optional)</label>
            <input
              type="text"
              value={newGenre.emoji || ''}
              onChange={(e) => setNewGenre({...newGenre, emoji: e.target.value})}
              className="w-full p-2 border rounded"
              placeholder="e.g. ✨ (Max 1 emoji)"
              maxLength={2} // Allow for variation selectors in some emojis
            />
          </div>
          {/* End Add Emoji Input */}
          <div>
            <label className="block text-gray-700 mb-2">Synonyms</label>
            {newGenre.synonyms.map((synonym, index) => (
              <div key={index} className="flex mb-2">
                <input
                  type="text"
                  value={synonym}
                  onChange={(e) => {
                    const updatedSynonyms = [...newGenre.synonyms];
                    updatedSynonyms[index] = e.target.value;
                    setNewGenre({...newGenre, synonyms: updatedSynonyms});
                  }}
                  className="flex-grow p-2 border rounded"
                  placeholder="e.g. Sci-Fi"
                />
                <button
                  onClick={() => {
                    const updatedSynonyms = [...newGenre.synonyms];
                    updatedSynonyms.splice(index, 1);
                    setNewGenre({...newGenre, synonyms: updatedSynonyms});
                  }}
                  className="ml-2 px-3 bg-red-500 text-white rounded"
                  disabled={newGenre.synonyms.length <= 1}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              onClick={() => setNewGenre({...newGenre, synonyms: [...newGenre.synonyms, '']})}
              className="mt-2 px-4 py-2 bg-gray-200 rounded"
            >
              Add Synonym
            </button>
          </div>
          <button
            onClick={handleAddGenre}
            className="px-4 py-2 bg-green-500 text-white rounded disabled:opacity-50"
            disabled={!newGenre.value.trim() || actionStatus === 'loading'}
          >
            {actionStatus === 'loading' ? 'Adding...' : 'Add Genre'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Existing Genres</h2>
        {genres.length === 0 ? (
          <p>No genres found.</p>
        ) : (
          <div className="space-y-6">
            {genres.map((genre, index) => (
              <div key={genre.id} className="border p-4 rounded">
                <div className="flex justify-between items-center mb-2"> {/* Use items-center */}
                  {/* Make value editable */}
                   <input
                      type="text"
                      value={genre.value}
                      onChange={(e) => {
                          const updatedGenres = [...genres];
                          updatedGenres[index].value = e.target.value;
                          setGenres(updatedGenres);
                      }}
                      className="text-lg font-medium border-b focus:outline-none focus:border-blue-500 flex-grow mr-4" // Add styling
                    />
                   {/* Add Emoji Input for Existing */}
                   <div className="ml-4 flex items-center">
                     <label className="text-sm mr-2">Emoji:</label>
                     <input
                       type="text"
                       value={genre.emoji || ''}
                       onChange={(e) => {
                           const updatedGenres = [...genres];
                           updatedGenres[index].emoji = e.target.value;
                           setGenres(updatedGenres);
                       }}
                       className="w-12 p-1 border rounded text-center" // Small input for emoji
                       maxLength={2}
                     />
                   </div>
                   {/* End Emoji Input */}
                  <button
                    onClick={() => handleDelete(genre.id, genre.value)} // Pass value for confirm message
                    className="px-3 py-1 bg-red-500 text-white rounded text-sm disabled:opacity-50 ml-4" // Added margin
                    disabled={actionStatus === 'loading'}
                  >
                    {actionStatus === 'loading' ? '...' : 'Delete'}
                  </button>
                </div>
                <div className="mb-3">
                  <label className="block text-gray-600 mb-1">Synonyms</label>
                  <div className="space-y-2">
                    {genre.synonyms.map((synonym, sIndex) => (
                      <div key={sIndex} className="flex">
                        <input
                          type="text"
                          value={synonym}
                          onChange={(e) => handleSynonymChange(index, sIndex, e.target.value)}
                          className="flex-grow p-2 border rounded"
                        />
                        <button
                          onClick={() => handleRemoveSynonym(index, sIndex)}
                          className="ml-2 px-3 bg-red-500 text-white rounded"
                          disabled={genre.synonyms.length <= 1}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => handleAddSynonym(index)}
                      className="mt-1 px-3 py-1 bg-gray-200 rounded text-sm"
                    >
                      Add Synonym
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleSave(genre)}
                  className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
                  disabled={actionStatus === 'loading'}
                >
                  {actionStatus === 'loading' ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
