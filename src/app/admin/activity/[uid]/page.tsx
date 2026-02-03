'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { auth } from '@/lib/firebase';
import { User, onAuthStateChanged, getIdTokenResult } from 'firebase/auth';

// Define a type for the activity log data we expect from the API
interface ActivityLog {
  action: string;
  timestamp: string; // Assuming ISO string from backend
  details?: any;
}

export default function UserActivityPage() {
  const params = useParams();
  const uid = params?.uid as string; // Get UID from URL, add optional chaining

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [targetUserEmail, setTargetUserEmail] = useState<string | null>(null); // To display whose activity we're viewing

  // Listen for auth state changes and check admin status
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
          } else {
            setAuthError("Access Denied: You do not have admin privileges.");
          }
        } catch (error) {
          console.error("Error checking admin claim:", error);
          setAuthError("Error verifying admin status.");
        }
      } else {
        setCurrentUser(null);
        setAuthError("Please log in as an admin."); // Prompt login if not logged in
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Fetch activity logs if user is admin and UID is available
  useEffect(() => {
    if (currentUser && isAdmin && uid) {
      const fetchActivity = async () => {
        setLoadingActivity(true);
        setFetchError('');
        setActivityLogs([]); // Clear previous logs
        try {
          const token = await currentUser.getIdToken();
          const response = await fetch(`/api/admin/users?uid=${uid}&type=activity`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!response.ok) {
             const errorData = await response.json().catch(() => ({}));
             const detail = errorData.details || errorData.error || response.statusText;
             // Attempt to get user email for context even if activity fetch fails
             if (errorData.userEmail) setTargetUserEmail(errorData.userEmail);
             throw new Error(`Failed to fetch activity: ${response.status} ${detail}`);
          }

          const data = await response.json();
          // Assuming the API returns { logs: ActivityLog[], userEmail: string }
          setActivityLogs(data.logs || []); // Handle case where logs might be missing
          setTargetUserEmail(data.userEmail || null); // Store the email, default to null if not provided
        } catch (err) {
          console.error("Error fetching activity:", err);
          setFetchError(err instanceof Error ? err.message : 'An unknown error occurred');
        } finally {
          setLoadingActivity(false);
        }
      };

      fetchActivity();
    } else if (!authLoading && !isAdmin) {
        // If auth check is done and user is not admin, ensure error is shown
        if (!authError) setAuthError("Access Denied: You do not have admin privileges.");
    } else if (!authLoading && !currentUser) {
        if (!authError) setAuthError("Please log in as an admin.");
    }
  }, [currentUser, isAdmin, uid, authLoading, authError]); // Add authLoading and authError dependencies

  // Render loading state: Wait for auth AND activity fetch to complete or error out
  // Show loading if auth is pending OR if auth is done but activity is still loading AND no target email/fetch error yet
  // Render loading state: Wait until auth is done AND (activity fetch is done OR target email is known OR fetch error occurred)
  // Refined loading state: Show if auth is loading, OR if auth is done, user is admin, and activity is loading.
  if (authLoading || (!authLoading && isAdmin && loadingActivity)) {
     return (
       <div className="min-h-screen flex items-center justify-center bg-gray-100">
         <p className="text-gray-700">Loading user activity...</p>
       </div>
     );
   }

  // Render error state
  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <p className="text-red-600 bg-red-100 p-4 rounded border border-red-300">{authError}</p>
      </div>
    );
  }
   if (fetchError) {
    return (
      <div className="min-h-screen flex flex-col items-center bg-gray-100 p-6">
         <h1 className="text-2xl font-bold text-gray-900 mb-4">
           Activity Logs for: {targetUserEmail || `User (${uid})`}
         </h1>
        <p className="text-red-500">Error fetching activity: {fetchError}</p>
        {/* Optionally add a link back */}
        <a href="/admin" className="mt-4 text-blue-600 hover:underline">Back to Admin Dashboard</a>
      </div>
    );
  }

  // Render activity logs
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-xl p-6">
        <div className="flex justify-between items-center mb-6 border-b pb-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Activity Logs for: {targetUserEmail || `User (${uid})`}
          </h1>
           <a href="/admin" className="text-sm text-blue-600 hover:underline">
             &larr; Back to Admin Dashboard
           </a>
        </div>

        {activityLogs.length > 0 ? (
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2"> {/* Added max-h, overflow-y-auto, and pr-2 for scrollbar spacing */}
            {activityLogs.map((log, index) => {
              let timestamp = 'Unknown time';
              try {
                if (log.timestamp) {
                  timestamp = new Date(log.timestamp).toLocaleString();
                }
              } catch (e) {
                console.error("Error parsing activity timestamp:", e);
                timestamp = 'Invalid time';
              }

              return (
                <div key={index} className="border-b pb-4 last:border-b-0">
                  <p className="font-medium text-gray-800">{log.action || 'Unknown action'}</p>
                  <p className="text-sm text-gray-600">At: {timestamp}</p>
                  {log.details && (
                    <pre className="text-xs bg-gray-50 p-2 mt-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(log.details, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-4">No activity logs found for this user.</p>
        )}
      </div>
    </div>
  );
}
