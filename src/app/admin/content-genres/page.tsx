'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { db, auth } from '@/lib/firebase';
import { User as FirebaseUser, onAuthStateChanged, getIdTokenResult } from 'firebase/auth';
import { collection, getDocs, doc, query, orderBy } from 'firebase/firestore';

interface ContentGenre {
  id: string;
  value: string;
  synonyms: string[];
  emoji?: string | null;
}

export default function ContentGenresPage() {
  const [genres, setGenres] = useState<ContentGenre[]>([]);
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionStatus, setActionStatus] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [newGenre, setNewGenre] = useState<Omit<ContentGenre, 'id'>>({
    value: '',
    synonyms: [''],
    emoji: ''
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      setIsAdmin(false);
      if (user) {
        setCurrentUser(user);
        try {
          const idTokenResult = await getIdTokenResult(user, true);
          if (idTokenResult.claims.admin === true) {
            setIsAdmin(true);
            fetchGenres();
          } else {
            setError("Access Denied: You do not have admin privileges.");
            setLoading(false);
          }
        } catch (err) {
          console.error("Error checking admin claim:", err);
          setError("Error verifying admin status.");
          setLoading(false);
        }
      } else {
        setCurrentUser(null);
        setError("Please log in to manage content genres.");
        setLoading(false);
        setGenres([]);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const fetchGenres = async () => {
    setLoading(true);
    setError('');
    try {
      const genresQuery = query(collection(db, 'contentGenres'), orderBy('value'));
      const querySnapshot = await getDocs(genresQuery);
      const genresData = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ContentGenre[];
      setGenres(genresData);
    } catch (err) {
      console.error("Error fetching content genres:", err);
      setError(err instanceof Error ? err.message : 'Failed to fetch content genres');
    } finally {
      setLoading(false);
    }
  };

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

  const handleSave = async (genre: ContentGenre) => {
    if (!currentUser) {
        setError("Authentication error. Please log in again.");
        return;
    }
    setActionStatus('loading');
    setActionMessage('');
    setError('');

    try {
        const token = await currentUser.getIdToken();
        const response = await fetch(`/api/admin/content-genres/${genre.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                value: genre.value,
                synonyms: genre.synonyms.filter(s => s.trim() !== ''),
                emoji: genre.emoji || null
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.details || data.error || `Failed to update genre (Status: ${response.status})`);
        }

        setActionStatus('success');
        setActionMessage(`Content genre "${genre.value}" updated successfully.`);
        fetchGenres(); // Refresh the list
        // Trigger Dialogflow update after successful save
        await triggerDialogflowUpdate();

    } catch (err) {
        console.error("Error saving content genre:", err);
        setActionStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to update content genre';
        setActionMessage(message);
        setError(message);
    }
  };

  const handleDelete = async (id: string, value: string) => {
    if (!currentUser) {
        setError("Authentication error. Please log in again.");
        return;
    }
    if (window.confirm(`Are you sure you want to delete the content genre "${value}"?`)) {
        setActionStatus('loading');
        setActionMessage('');
        setError('');

        try {
            const token = await currentUser.getIdToken();
            const response = await fetch(`/api/admin/content-genres/${id}`, {
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
            setActionMessage(`Content genre "${value}" deleted successfully.`);
            setGenres(genres.filter(g => g.id !== id));
            // Trigger Dialogflow update after successful delete
            await triggerDialogflowUpdate();

        } catch (err) {
            console.error("Error deleting content genre:", err);
            setActionStatus('error');
            const message = err instanceof Error ? err.message : 'Failed to delete content genre';
            setActionMessage(message);
            setError(message);
        }
    }
  };

  const handleAddGenre = async () => {
    if (!currentUser) {
        setError("Authentication error. Please log in again.");
        return;
    }
    if (!newGenre.value.trim()) {
        setError("Content genre name cannot be empty.");
        return;
    }

    setActionStatus('loading');
    setActionMessage('');
    setError('');

    try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/admin/content-genres', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                value: newGenre.value,
                synonyms: newGenre.synonyms.filter(s => s.trim() !== ''),
                emoji: newGenre.emoji || null
            }),
        });

        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                throw new Error(`Request failed with status ${response.status}`);
            }
            throw new Error(errorData.details || errorData.error || `Failed to add genre (Status: ${response.status})`);
        }

        const data = await response.json();

        if (!data.id) {
            throw new Error('Invalid response from server - missing genre ID');
        }

        setActionStatus('success');
        setActionMessage(`Content genre "${data.value}" added successfully.`);
        setNewGenre({ value: '', synonyms: [''], emoji: '' });
        
        // Optimistically update the local state instead of refetching
        setGenres(prev => [...prev, {
            id: data.id,
            value: data.value,
            synonyms: data.synonyms || [],
            emoji: data.emoji || null
        }]);
        
        // Trigger Dialogflow update after successful add
        await triggerDialogflowUpdate();

    } catch (err) {
        console.error("Error adding content genre:", err);
        setActionStatus('error');
        const message = err instanceof Error ? err.message : 'Failed to add content genre';
        setActionMessage(message);
        setError(message);
    }
  };

  if (authLoading) {
    return <div className="p-4 text-center">Verifying authentication...</div>;
  }

  if (!isAdmin || !currentUser) {
     return (
        <div className="p-6 max-w-4xl mx-auto">
             <h1 className="text-2xl font-bold mb-6">Manage Content Genres</h1>
             <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">
                 {error || "Access Denied. Please log in as an admin."}
             </div>
        </div>
     );
  }

  if (loading) {
    return <div className="p-4 text-center">Loading content genres...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto h-screen overflow-y-auto">
       <div className="flex justify-between items-center mb-6 sticky top-0 bg-white py-4 z-10">
         <h1 className="text-2xl font-bold">Manage Content Genres</h1>
         <Link href="/admin">
           <button className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline">
             &larr; Back to Admin
           </button>
         </Link>
       </div>

      {error && !actionMessage && <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">{error}</div>}

      {actionMessage && (
          <div className={`p-4 mb-4 border-l-4 ${
              actionStatus === 'success' ? 'bg-green-100 border-green-500 text-green-700' :
              actionStatus === 'error' ? 'bg-red-100 border-red-500 text-red-700' :
              'bg-blue-100 border-blue-500 text-blue-700'
          }`}>
              {actionStatus === 'loading' ? 'Processing...' : actionMessage}
          </div>
      )}

      <div className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Add New Content Genre</h2>
        <div className="flex flex-col space-y-4">
          <div>
            <label className="block text-gray-700 mb-2">Genre Name</label>
            <input
              type="text"
              value={newGenre.value}
              onChange={(e) => setNewGenre({...newGenre, value: e.target.value})}
              className="w-full p-2 border rounded"
              placeholder="e.g. Cartoon"
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-2">Emoji (Optional)</label>
            <input
              type="text"
              value={newGenre.emoji || ''}
              onChange={(e) => setNewGenre({...newGenre, emoji: e.target.value})}
              className="w-full p-2 border rounded"
              placeholder="e.g. 🎬 (Max 1 emoji)"
              maxLength={2}
            />
          </div>
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
                  placeholder="e.g. Animation"
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
            {actionStatus === 'loading' ? 'Adding...' : 'Add Content Genre'}
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Existing Content Genres</h2>
        {genres.length === 0 ? (
          <p>No content genres found.</p>
        ) : (
          <div className="space-y-6">
            {genres.map((genre, index) => (
              <div key={genre.id} className="border p-4 rounded">
                <div className="flex justify-between items-center mb-2">
                  <input
                    type="text"
                    value={genre.value}
                    onChange={(e) => {
                        const updatedGenres = [...genres];
                        updatedGenres[index].value = e.target.value;
                        setGenres(updatedGenres);
                    }}
                    className="text-lg font-medium border-b focus:outline-none focus:border-blue-500 flex-grow mr-4"
                  />
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
                      className="w-12 p-1 border rounded text-center"
                      maxLength={2}
                    />
                  </div>
                  <button
                    onClick={() => handleDelete(genre.id, genre.value)}
                    className="px-3 py-1 bg-red-500 text-white rounded text-sm disabled:opacity-50 ml-4"
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
