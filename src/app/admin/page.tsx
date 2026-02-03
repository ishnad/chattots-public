'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link'; // Import Link
import { auth } from '@/lib/firebase'; // Assuming firebase config is exported from here
import {
  User,
  signInWithEmailAndPassword,
  // signOut, // Remove direct import
  onAuthStateChanged,
  getIdToken,
  getIdTokenResult
} from 'firebase/auth';
import { logout } from '@/lib/auth'; // Import the centralized logout function

// Define a type for the user data we expect from the API
interface AppUser {
  uid: string;
  email: string | null;
  displayName?: string | null; // Keep for now, might remove later
  username?: string | null; // Add username
  name?: string | null; // Add name
  dob?: string | null; // Add dob (as string for simplicity in form)
  metadata: {
    lastSignInTime: string | null;
    creationTime: string | null;
  };
}

export default function AdminPage() {
  const [email, setEmail] = useState(''); // Changed from username
  const [password, setPassword] = useState('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true); // Loading state for auth check
  const [authError, setAuthError] = useState(''); // Renamed from error
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [targetUid, setTargetUid] = useState(''); // State for the UID input
  const [grantAdminStatus, setGrantAdminStatus] = useState(''); // '', 'loading', 'success', 'error'
  const [grantAdminMessage, setGrantAdminMessage] = useState(''); // Feedback message for granting admin
  const [updateGenresStatus, setUpdateGenresStatus] = useState(''); // '', 'loading', 'success', 'error'
  const [updateGenresMessage, setUpdateGenresMessage] = useState(''); // Feedback message for updating genres
  const [seedGenresStatus, setSeedGenresStatus] = useState(''); // '', 'loading', 'success', 'error'
  const [seedGenresMessage, setSeedGenresMessage] = useState(''); // Feedback message for seeding genres

  const googleProjectId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_ID;

  // Removed state related to the old edit modal
  const [viewingProfiles, setViewingProfiles] = useState<AppUser | null>(null);
  const [profiles, setProfiles] = useState<any[]>([]);

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true); // Start loading on auth change
      setIsAdmin(false); // Reset admin status
      if (user) {
        setCurrentUser(user);
        try {
          // Force refresh to get latest claims
          const idTokenResult = await getIdTokenResult(user, true);
          if (idTokenResult.claims.admin === true) {
            setIsAdmin(true);
            console.log("User is admin");
          } else {
            console.log("User is not admin");
            setAuthError("Access Denied: You do not have admin privileges.");
          }
        } catch (error) {
          console.error("Error checking admin claim:", error);
          setAuthError("Error verifying admin status.");
          // Optionally sign out the user if claim check fails critically
          // await signOut(auth);
        }
      } else {
        setCurrentUser(null);
      }
      setAuthLoading(false); // Finish loading after check
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      // Force token refresh to ensure latest claims
      await userCredential.user.getIdToken(true);
      
      // Check if we're in an iframe
      if (window.self !== window.top) {
        setAuthError('Admin panel cannot be embedded in iframes due to security restrictions.');
        await logout(); // Use centralized logout
        return;
      }
    } catch (error) {
      console.error("Login failed:", error);
      let errorMessage = "Login failed. Please check your credentials.";
      if (error instanceof Error) {
        // Handle specific cookie-related errors
        if (error.message.includes('cookie') || error.message.includes('SameSite')) {
          errorMessage = "Please ensure third-party cookies are allowed or try in a different browser.";
        } else {
          errorMessage = error.message;
        }
      }
      setAuthError(errorMessage);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to log out?")) {
      setAuthError('');
      try {
        await logout(); // Use the centralized logout function
        // onAuthStateChanged will handle setting user to null
        setUsers([]); // Clear user list on logout
        setFetchError('');
      } catch (error) {
        console.error("Logout failed:", error);
        setAuthError("Logout failed.");
      }
    }
  };

  // Fetch users only if the user is logged in and confirmed as admin
  useEffect(() => {
    if (currentUser && isAdmin) {
      const fetchUsers = async () => {
        setLoadingUsers(true);
        setFetchError('');
        try {
          const token = await currentUser.getIdToken(); // Get the ID token
          const response = await fetch('/api/admin/users', {
            headers: {
              'Authorization': `Bearer ${token}` // Send token in header
            }
          });

          if (!response.ok) {
             const errorData = await response.json().catch(() => ({})); // Try to parse error
             const detail = errorData.details || errorData.error || response.statusText;
             throw new Error(`Failed to fetch users: ${response.status} ${detail}`);
          }

          const data: AppUser[] = await response.json();
          setUsers(data);
        } catch (err) {
          console.error(err);
          setFetchError(err instanceof Error ? err.message : 'An unknown error occurred while fetching users');
          setUsers([]);
        } finally {
          setLoadingUsers(false);
        }
      };

      fetchUsers();
    } else {
        // Clear users if not admin or not logged in
        setUsers([]);
    }
  }, [currentUser, isAdmin]); // Re-run effect when user or admin status changes

  // Function to handle granting admin privileges
  // --- Removed Edit User Modal Functions ---

  const handleViewProfiles = async (user: AppUser) => {
    try {
      const token = await currentUser?.getIdToken();
      const response = await fetch(`/api/admin/users?uid=${user.uid}&type=profiles`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) throw new Error('Failed to fetch profiles');
      
      const data = await response.json();
      setProfiles(data);
      setViewingProfiles(user);
    } catch (error) {
      console.error("Error fetching profiles:", error);
      setFetchError(error instanceof Error ? error.message : 'Failed to load profiles');
    }
  };

  // Removed handleCloseEditModal

  const handleCloseProfilesModal = () => {
    setViewingProfiles(null);
    setProfiles([]);
  };


  // Removed handleEditFormChange

  // Removed handleUpdateUser

// Removed handlePasswordReset

  const handleGrantAdmin = async () => {
    if (!currentUser || !targetUid) {
      setGrantAdminMessage('Please enter a UID.');
      setGrantAdminStatus('error');
      return;
    }

    setGrantAdminStatus('loading');
    setGrantAdminMessage('');

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ uid: targetUid }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || `Request failed with status ${response.status}`);
      }

      setGrantAdminStatus('success');
      setGrantAdminMessage(data.message || 'Successfully granted admin privileges.');
      setTargetUid(''); // Clear input on success

    } catch (error) {
      console.error("Error granting admin privileges:", error);
      setGrantAdminStatus('error');
      setGrantAdminMessage(error instanceof Error ? error.message : 'An unknown error occurred.');
    }
  };

  // Function to handle updating Dialogflow genres
  const handleUpdateDialogflowGenres = async () => {
    if (!currentUser) {
      setUpdateGenresMessage('You must be logged in.');
      setUpdateGenresStatus('error');
      return;
    }

    setUpdateGenresStatus('loading');
    setUpdateGenresMessage('');

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/admin/dialogflow/update-genres', {
        method: 'POST',
        headers: {
          // No Content-Type needed for this specific POST if not sending a body
          'Authorization': `Bearer ${token}`,
        },
        // No body needed as the API route reads from the file system
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || `Request failed with status ${response.status}`);
      }

      setUpdateGenresStatus('success');
      setUpdateGenresMessage(data.message || 'Successfully triggered Dialogflow genre update.');

    } catch (error) {
      console.error("Error updating Dialogflow genres:", error);
      setUpdateGenresStatus('error');
      setUpdateGenresMessage(error instanceof Error ? error.message : 'An unknown error occurred.');
    }
  };

  // Function to handle seeding book genres from JSON
  const handleSeedBookGenres = async () => {
      if (!currentUser) {
        setSeedGenresMessage('You must be logged in.');
        setSeedGenresStatus('error');
        return;
      }
      if (!window.confirm("This will overwrite existing genres in Firestore with data from bookGenres.json. Are you sure?")) {
          return;
      }

      setSeedGenresStatus('loading');
      setSeedGenresMessage('');

      try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/admin/book-genres/seed', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            // No Content-Type needed if no body is sent
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.details || data.error || `Request failed with status ${response.status}`);
        }

        setSeedGenresStatus('success');
        setSeedGenresMessage(data.message || 'Successfully seeded book genres.');

      } catch (error) {
        console.error("Error seeding book genres:", error);
        setSeedGenresStatus('error');
        setSeedGenresMessage(error instanceof Error ? error.message : 'An unknown error occurred during seeding.');
      }
    };

  const handleSeedContentGenres = async () => {
      if (!currentUser) {
        setSeedGenresMessage('You must be logged in.');
        setSeedGenresStatus('error');
        return;
      }
      if (!window.confirm("This will overwrite existing genres in Firestore with data from contentGenres.json. Are you sure?")) {
          return;
      }

      setSeedGenresStatus('loading');
      setSeedGenresMessage('');

      try {
        const token = await currentUser.getIdToken();
        const response = await fetch('/api/admin/content-genres/seed', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.details || data.error || `Request failed with status ${response.status}`);
        }

        setSeedGenresStatus('success');
        setSeedGenresMessage(data.message || 'Successfully seeded content genres.');

      } catch (error) {
        console.error("Error seeding content genres:", error);
        setSeedGenresStatus('error');
        setSeedGenresMessage(error instanceof Error ? error.message : 'An unknown error occurred during seeding.');
      }
    };


  // --- Render Logic ---

  // Show loading indicator while checking auth/admin status
  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-700">Loading...</p>
      </div>
    );
  }

  // Add error boundary for metadata access
  const getCreationTime = (user: AppUser) => {
    try {
      return user.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleString() : 'N/A';
    } catch (e) {
      console.error("Error parsing creation time:", e);
      return 'N/A';
    }
  };

  const getLastSignInTime = (user: AppUser) => {
    try {
      return user.metadata?.lastSignInTime ? new Date(user.metadata.lastSignInTime).toLocaleString() : 'N/A';
    } catch (e) {
      console.error("Error parsing last sign in time:", e);
      return 'N/A';
    }
  };

  // Removed Edit Modal content definition

  if (currentUser && isAdmin) {
    return (
      <>
      {/* Use h-screen and overflow-y-auto for fixed height and vertical scrolling, add padding */}
      <div className="h-screen overflow-y-auto flex flex-col items-center bg-gray-100 p-6">
        {/* Cookie warning banner */}
        {typeof window !== 'undefined' && document.cookie.includes('__vercel_live_token') && (
          <div className="w-full max-w-4xl bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4 rounded sticky top-0 z-20"> {/* Make banner sticky */}
            <p className="font-bold">Warning: Cookie Issue Detected</p>
            <p>For best experience, please:</p>
            <ul className="list-disc pl-5 mt-1">
              <li>Disable any cookie-blocking extensions</li>
              <li>Allow third-party cookies in browser settings</li>
              <li>Try opening in a new tab instead of iframe</li>
            </ul>
          </div>
        )}
         <div className="w-full max-w-4xl flex justify-between items-center mb-6 px-4">
            <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
            <div className="flex space-x-2">
              {googleProjectId ? (
                <>
                  <a
                    href={`https://dialogflow.cloud.google.com/#/agent/${googleProjectId}/intents`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
                  >
                    Open Dialogflow
                  </a>
                  <a
                    href={`https://console.firebase.google.com/project/${googleProjectId}/overview`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
                  >
                    Open Firebase
                  </a>
                </>
              ) : (
                <p className="text-sm text-red-500">GOOGLE_PROJECT_ID not configured.</p>
              )}
              <button
                  onClick={handleLogout}
                  className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
              >
                  Logout
              </button>
            </div>
         </div>
        <p className="text-gray-700 mb-4">Welcome, {currentUser.email}! (UID: {currentUser.uid})</p>

        {/* Section to Grant Admin Privileges */}
        <div className="w-full max-w-4xl bg-white p-6 rounded-lg shadow-md mb-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900">Grant Admin Privileges</h2>
          <div className="flex items-center space-x-4">
            <input
              type="text"
              placeholder="Enter User UID"
              value={targetUid}
              onChange={(e) => setTargetUid(e.target.value)}
              className="flex-grow px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
            />
            <button
              onClick={handleGrantAdmin}
              disabled={grantAdminStatus === 'loading' || !targetUid}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50"
            >
              {grantAdminStatus === 'loading' ? 'Granting...' : 'Grant Admin'}
            </button>
          </div>
          {grantAdminMessage && (
            <p className={`mt-4 text-sm ${grantAdminStatus === 'error' ? 'text-red-500' : 'text-green-500'}`}>
              {grantAdminMessage}
            </p>
          )}
        </div>

        {/* Section to Manage Book Genres */}
        <div className="w-full max-w-4xl bg-white p-6 rounded-lg shadow-md mb-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900">Book Genre Management</h2>
          <div className="flex items-center space-x-4">
            <Link 
              href="/admin/book-genres"
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
            >
              Manage Book Genres
            </Link>
            {/* <button
               onClick={handleSeedBookGenres}
               disabled={seedGenresStatus === 'loading'}
               className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50 ml-4"
            >
               {seedGenresStatus === 'loading' ? 'Seeding...' : 'Seed Book Genres'}
            </button> */}
          </div>
          {seedGenresMessage && (
            <p className={`mt-4 text-sm ${seedGenresStatus === 'error' ? 'text-red-500' : 'text-green-500'}`}>
              {seedGenresMessage}
            </p>
          )}
        </div>

        {/* Section to Manage Content Genres */}
        <div className="w-full max-w-4xl bg-white p-6 rounded-lg shadow-md mb-6">
          <h2 className="text-2xl font-semibold mb-4 text-gray-900">Content Genre Management</h2>
          <div className="flex items-center space-x-4">
            <Link 
              href="/admin/content-genres"
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
            >
              Manage Content Genres
            </Link>
            {/* <button
               onClick={handleSeedContentGenres}
               disabled={seedGenresStatus === 'loading'}
               className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50 ml-4"
            >
               {seedGenresStatus === 'loading' ? 'Seeding...' : 'Seed Content Genres'}
            </button> */}
          </div>
          {seedGenresMessage && (
            <p className={`mt-4 text-sm ${seedGenresStatus === 'error' ? 'text-red-500' : 'text-green-500'}`}>
              {seedGenresMessage}
            </p>
          )}
        </div>


        <div className="w-full bg-white p-6 rounded-lg shadow-md"> {/* Removed max-w-4xl */}
          <h2 className="text-2xl font-semibold mb-4 text-gray-900">User Management</h2>
          {loadingUsers && <p className="text-gray-700">Loading users...</p>}
          {fetchError && <p className="text-red-500">Error fetching users: {fetchError}</p>}
          {!loadingUsers && !fetchError && (
            <div className="overflow-x-auto">
              <div className="inline-block min-w-full align-middle">
                <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">UID</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Login</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.length > 0 ? (
                    users.map((user) => (
                      <tr key={user.uid}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.email || 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{user.username || user.displayName || 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{user.uid}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {getCreationTime(user)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {getLastSignInTime(user)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <Link href={`/admin/edit-user/${user.uid}`} className="text-indigo-600 hover:text-indigo-900 mr-3">
                              Edit
                          </Link>
                          <button 
                            onClick={() => handleViewProfiles(user)}
                            className="text-green-600 hover:text-green-900 mr-3"
                          >
                            View Profiles
                          </button>
                          <Link href={`/admin/activity/${user.uid}`} className="text-yellow-600 hover:text-yellow-900">
                              View Activity
                          </Link>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
                </table>
              </div>
            </div>
          )}
    
          {/* Removed Edit User Modal rendering */}
        </div>
      </div>

      {/* View Profiles Modal */}
      {viewingProfiles && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-semibold text-gray-900">
                Profiles for: {viewingProfiles.email}
              </h3>
              <button 
                onClick={handleCloseProfilesModal}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            {profiles.length > 0 ? (
              <div className="space-y-4">
                {profiles.map((profile, index) => (
                  <div key={index} className="border-b pb-4">
                    <h4 className="font-medium">{profile.name}</h4>
                    <p className="text-sm text-gray-600">DOB: {profile.dob}</p>
                    <p className="text-sm text-gray-600">Gender: {profile.gender}</p>
                    <p className="text-sm text-gray-600">Interests: {profile.interests?.join(', ')}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No profiles found for this user.</p>
            )}
          </div>
        </div>
      )}

      </>
    );
  }

  // Show Login Form if not logged in, or Access Denied if logged in but not admin
  return (
    // Use min-h-screen for vertical scrolling, add padding
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6 relative"> {/* Added relative for absolute positioning */}
      {/* Cookie warning banner */}
      {typeof window !== 'undefined' && document.cookie.includes('__vercel_live_token') && (
        // Position banner at the top within the padded area
        <div className="absolute top-6 left-6 right-6 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded">
          <p className="font-bold">Warning: Cookie Issue Detected</p>
          <p>For best experience, please:</p>
          <ul className="list-disc pl-5 mt-1">
            <li>Disable any cookie-blocking extensions</li>
            <li>Allow third-party cookies in browser settings</li>
            <li>Try opening in a new tab instead of iframe</li>
          </ul>
        </div>
      )}
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm mx-4">
        {authError && authError.includes('cookie') && (
          <div className="mb-4 p-3 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700">
            <p className="font-bold">Cookie Issue Detected</p>
            <p className="text-sm">Try these steps:</p>
            <ul className="text-sm list-disc pl-5 mt-1">
              <li>Use Chrome/Firefox in normal (not incognito) mode</li>
              <li>Enable third-party cookies in browser settings</li>
              <li>Try a different browser if issues persist</li>
            </ul>
          </div>
        )}
        <h2 className="text-2xl font-bold mb-6 text-center text-gray-900">Admin Login</h2>
        {currentUser && !isAdmin && !authLoading && ( // Show access denied if logged in but not admin
             <p className="text-red-500 text-center mb-4">Access Denied: You do not have admin privileges.</p>
        )}
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="block text-gray-700 mb-2" htmlFor="email">
              Email
            </label>
            <input
              type="email" // Changed type to email
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
              required
              autoComplete="email"
            />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700 mb-2" htmlFor="password">
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300"
              required
              autoComplete="current-password"
            />
          </div>
          {authError && <p className="text-red-500 text-sm mb-4">{authError}</p>}
          <button
            type="submit"
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50"
            disabled={authLoading} // Disable button while logging in
          >
            {authLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>
         {currentUser && !isAdmin && !authLoading && ( // Show logout button if logged in but not admin
             <button
                onClick={handleLogout}
                className="mt-4 w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
            >
                Logout
            </button>
         )}
      </div>

      {/* Removed Edit User Modal rendering from login section */}
    </div>
  );
}
