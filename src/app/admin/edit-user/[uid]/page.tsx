'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation'; // Import hooks for routing
import Link from 'next/link';
import { auth } from '@/lib/firebase'; // Adjust path as needed
import { User, getIdToken, onAuthStateChanged } from 'firebase/auth';

// Define a type for the user data we expect from the API
interface AppUser {
  uid: string;
  email: string | null;
  displayName?: string | null;
  username?: string | null;
  name?: string | null;
  dob?: string | null; // Expecting YYYY-MM-DD string format
  metadata?: { // Optional metadata
    lastSignInTime: string | null;
    creationTime: string | null;
  };
}

export default function EditUserPage() {
  const params = useParams(); // Can be null initially
  const router = useRouter(); // Hook for navigation
  const uid = typeof params?.uid === 'string' ? params.uid : null; // Get UID safely

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const [userData, setUserData] = useState<AppUser | null>(null);
  const [loadingUserDetails, setLoadingUserDetails] = useState(true);
  const [fetchError, setFetchError] = useState('');

  // Form state
  const [editFormData, setEditFormData] = useState({
    email: '',
    username: '',
    name: '',
    dob: '',
  });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState('');
  const [editSuccess, setEditSuccess] = useState('');

  // Delete User State
  const [deleteUserLoading, setDeleteUserLoading] = useState(false);
  const [deleteUserMessage, setDeleteUserMessage] = useState('');
  const [deleteUserError, setDeleteUserError] = useState('');

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      setIsAdmin(false);
      if (user) {
        setCurrentUser(user);
        try {
          const idTokenResult = await user.getIdTokenResult(true);
          if (idTokenResult.claims.admin === true) {
            setIsAdmin(true);
          } else {
            setAuthError("Access Denied: You do not have admin privileges.");
            // Redirect non-admins away?
            // router.push('/admin'); // Or a different page
          }
        } catch (error) {
          console.error("Error checking admin claim:", error);
          setAuthError("Error verifying admin status.");
        }
      } else {
        setCurrentUser(null);
        // Redirect logged-out users?
        // router.push('/login');
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, [router]); // Add router to dependency array if used for redirection

  // Fetch user details function
  // Fetch user details function (only if uid is available)
  const fetchUserDetails = useCallback(async () => {
    if (!currentUser || !isAdmin || !uid) {
        console.log("Fetch prerequisites not met:", { hasCurrentUser: !!currentUser, isAdmin, hasUid: !!uid });
        setLoadingUserDetails(false); // Ensure loading stops if prerequisites aren't met
        if (!uid) setFetchError("User ID not found in URL.");
        // Errors for currentUser/isAdmin are handled by auth checks
        return;
    }

    setLoadingUserDetails(true);
    setFetchError('');
    try {
      const token = await getIdToken(currentUser);
      const response = await fetch(`/api/admin/users?uid=${uid}&type=details`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `Failed to fetch user details: ${response.status}`);
      }

      const fetchedUserData: AppUser = await response.json();
      setUserData(fetchedUserData);
      // Initialize form data
      setEditFormData({
        email: fetchedUserData.email || '',
        username: fetchedUserData.username || '',
        name: fetchedUserData.name || '',
        dob: fetchedUserData.dob || '', // Assumes API returns YYYY-MM-DD
      });

    } catch (error) {
      console.error("Error fetching user details:", error);
      setFetchError(error instanceof Error ? error.message : "Failed to load user details.");
      setUserData(null); // Clear user data on error
    } finally {
      setLoadingUserDetails(false);
    }
  }, [currentUser, isAdmin, uid]); // Dependencies for the fetch function

  // Fetch user details when auth state is ready and user is admin
  // Effect to trigger fetchUserDetails or handle missing UID
  useEffect(() => {
    if (!uid) {
        setLoadingUserDetails(false);
        setFetchError("User ID is missing from the URL.");
        return; // Don't proceed if UID is missing
    }

    if (!authLoading && currentUser && isAdmin) {
      fetchUserDetails();
    } else if (!authLoading && (!currentUser || !isAdmin)) {
        // Handle case where user is not logged in or not admin after auth check
        setLoadingUserDetails(false); // Stop loading indicator
        if (!currentUser) setAuthError("Please log in.");
        // AuthError for non-admin is set in the auth listener
    }
  }, [authLoading, currentUser, isAdmin, uid, fetchUserDetails]); // Add uid dependency


  const handleEditFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userData || !currentUser || !isAdmin) return;

    setEditLoading(true);
    setEditError('');
    setEditSuccess('');

    // Validate username isn't empty if it's being changed
    if (editFormData.username !== (userData.username || '') && !editFormData.username.trim()) {
      setEditError('Username cannot be empty');
      setEditLoading(false);
      return;
    }

    // Validate name isn't empty if it's being changed
    if (editFormData.name !== (userData.name || '') && !editFormData.name.trim()) {
      setEditError('Name cannot be empty');
      setEditLoading(false);
      return;
    }

    // Construct payload with potentially changed fields
    const updatePayload: {
        uid: string;
        email?: string;
        username?: string;
        name?: string;
        dob?: string;
    } = { uid: userData.uid };

    let changed = false;
    // Compare with the initially loaded data for the editingUser
    if (editFormData.email !== (userData.email || '')) {
      updatePayload.email = editFormData.email;
      changed = true;
    }
    if (editFormData.username !== (userData.username || '')) {
      updatePayload.username = editFormData.username;
      changed = true;
    }
    if (editFormData.name !== (userData.name || '')) {
      updatePayload.name = editFormData.name;
      changed = true;
    }
     if (editFormData.dob !== (userData.dob || '')) {
      updatePayload.dob = editFormData.dob;
      changed = true;
    }

    if (!changed) {
      setEditSuccess("No changes detected.");
      setEditLoading(false);
      return;
    }

    try {
      const token = await getIdToken(currentUser);
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(updatePayload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || `Request failed with status ${response.status}`);
      }

      setEditSuccess(data.message || 'User updated successfully!');
      // Optionally refetch user data to confirm changes
      await fetchUserDetails();
      // Optionally redirect after a delay
      // setTimeout(() => router.push('/admin'), 1500);

    } catch (error) {
      console.error("Error updating user:", error);
      setEditError(error instanceof Error ? error.message : 'An unknown error occurred.');
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!userData || !currentUser || !isAdmin) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to permanently delete the user ${userData.email} (UID: ${userData.uid})? This action will remove all their data and cannot be undone.`
    );

    if (!confirmDelete) {
      return;
    }

    setDeleteUserLoading(true);
    setDeleteUserMessage('');
    setDeleteUserError('');
    setEditError(''); // Clear other errors
    setEditSuccess('');


    try {
      const token = await getIdToken(currentUser);
      const response = await fetch(`/api/admin/users`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ uid: userData.uid }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.details || data.error || `Request failed with status ${response.status}`);
      }

      setDeleteUserMessage(data.message || 'User deleted successfully.');
      // Redirect to admin dashboard after a short delay
      setTimeout(() => {
        router.push('/admin');
      }, 2000);

    } catch (error) {
      console.error("Error deleting user:", error);
      setDeleteUserError(error instanceof Error ? error.message : 'Failed to delete user.');
    } finally {
      setDeleteUserLoading(false);
    }
  };

  // Render loading state
  if (authLoading || loadingUserDetails) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <p className="text-gray-700">Loading...</p>
      </div>
    );
  }

  // Render error/access denied state
  if (authError) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
              <p className="text-red-600 text-xl mb-4">{authError}</p>
              <Link href="/admin/login" className="text-blue-500 hover:underline">
                  Go to Login
              </Link>
          </div>
      );
  }

  if (fetchError) {
      return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 p-4">
              <p className="text-red-600 text-xl mb-4">Error loading user data: {fetchError}</p>
              <Link href="/admin" className="text-blue-500 hover:underline">
                  Back to Admin Dashboard
              </Link>
          </div>
      );
  }

  if (!currentUser || !isAdmin || !userData) {
      // This case should ideally be covered by the loading/error states above
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-100">
              <p className="text-gray-700">Could not load user data or insufficient permissions.</p>
          </div>
      );
  }


  // Render the edit form
  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-xl p-6">
        <div className="flex justify-between items-center mb-6 border-b pb-4">
          <h1 className="text-2xl font-semibold text-gray-900">Edit User: {userData.email}</h1>
          <Link href="/admin" className="text-blue-500 hover:underline text-sm">
            &larr; Back to Dashboard
          </Link>
        </div>

        <form onSubmit={handleUpdateUser}>
          {/* Username Field */}
          <div className="mb-4">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              value={editFormData.username}
              onChange={handleEditFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter username"
              disabled={editLoading || deleteUserLoading}
            />
          </div>

          {/* Name Field */}
          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              id="name"
              name="name"
              value={editFormData.name}
              onChange={handleEditFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter full name"
              disabled={editLoading || deleteUserLoading}
            />
          </div>

          {/* Date of Birth Field */}
          <div className="mb-4">
            <label htmlFor="dob" className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
            <input
              type="date" // Use date input type
              id="dob"
              name="dob"
              value={editFormData.dob} // Assumes dob is in 'YYYY-MM-DD' format
              onChange={handleEditFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              disabled={editLoading || deleteUserLoading}
            />
          </div>

          {/* Email Field */}
          <div className="mb-4">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={editFormData.email}
              onChange={handleEditFormChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter email address"
              disabled={editLoading || deleteUserLoading}
            />
          </div>

          {/* Feedback Messages */}
          {editError && <p className="text-red-500 text-sm mb-3">{editError}</p>}
          {editSuccess && <p className="text-green-500 text-sm mb-3">{editSuccess}</p>}

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3 mt-6">
            <Link href="/admin">
              <button
                type="button"
                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline"
                disabled={editLoading || deleteUserLoading}
              >
                Cancel
              </button>
            </Link>
            <button
              type="submit"
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50"
              disabled={editLoading || deleteUserLoading}
            >
              {editLoading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>

        {/* Delete User Section */}
        <div className="mt-8 border-t pt-6">
          <h4 className="text-md font-semibold mb-3 text-gray-800">Delete User</h4>
          <p className="text-sm text-gray-600 mb-3">
            This action is irreversible. Deleting the user will remove their account and all associated data from Firebase Authentication and Firestore.
          </p>
          <button
            type="button"
            onClick={handleDeleteUser}
            className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50 w-full sm:w-auto"
            disabled={deleteUserLoading || editLoading}
          >
            {deleteUserLoading ? 'Deleting...' : 'Delete User Permanently'}
          </button>
          {deleteUserError && <p className="text-red-500 text-sm mt-2">{deleteUserError}</p>}
          {deleteUserMessage && <p className="text-green-500 text-sm mt-2">{deleteUserMessage}</p>}
        </div>
      </div>
    </div>
  );
}
