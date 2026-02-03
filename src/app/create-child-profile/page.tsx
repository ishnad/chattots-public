"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import CreateChildProfileForm from "@/components/CreateChildProfileForm";
import Header from "@/components/Header";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function CreateChildProfilePage() {
    const router = useRouter();
    const [user, setUser] = useState(auth.currentUser);
    const [parentalPin, setParentalPin] = useState<string | null>(null);
    const [isPinVerified, setIsPinVerified] = useState(false);
    const [pinInput, setPinInput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true); // Loading state for fetching PIN

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
                // Fetch parental PIN
                const userDocRef = doc(db, "users", currentUser.uid);
                try {
                    const userDocSnap = await getDoc(userDocRef);
                    if (userDocSnap.exists()) {
                        const userData = userDocSnap.data();
                        if (userData.parentalPin) {
                            setParentalPin(userData.parentalPin);
                        } else {
                            // Handle case where PIN is not set
                            setError("Parental PIN not set. Please set one in Settings.");
                            // Optionally redirect or disable functionality
                        }
                    } else {
                        setError("User data not found.");
                    }
                } catch (fetchError) {
                    console.error("Error fetching user data:", fetchError);
                    setError("Failed to fetch user data.");
                } finally {
                    setIsLoading(false);
                }
            } else {
                // No user logged in, redirect to login
                router.push("/login");
            }
        });

        return () => unsubscribe();
    }, [router]);

    const handlePinInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPinInput(e.target.value);
        setError(null); // Clear error on input change
    };

    const handlePinSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!parentalPin) {
            setError("Parental PIN not set. Please set one in Settings.");
            return;
        }
        if (pinInput === parentalPin) {
            setIsPinVerified(true);
            setError(null);
        } else {
            setError("Incorrect PIN.");
            setPinInput(""); // Clear input on incorrect PIN
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 w-full">
                <p>Loading...</p> {/* Or a spinner component */}
            </div>
        );
    }

    // Show PIN verification screen if PIN exists and is not yet verified
    if (parentalPin && !isPinVerified) {
        return (
            <div 
                className="w-full h-screen flex flex-col items-center justify-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333]"
                style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
            >
                <h1 className={`text-4xl font-bold mb-4 text-orange-900`}>🤖 ChatTots</h1>
                <div className="bg-white p-6 rounded-2xl w-full max-w-sm border-2 border-yellow-200">
                <h2 className="text-lg font-bold mb-4 text-center text-gray-800">Enter PIN to Add Profile ✏️</h2>
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
                            onClick={() => router.back()} // Go back to the previous page (likely profile selector)
                            className="bg-red-500 w-full p-2 rounded-full text-white"
                        >
                            ← Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Show error if PIN is required but not set
    if (!parentalPin && !isLoading) {
         return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 w-full">
                 <div className="w-full text-center mt-4">
                    <Header />
                </div>
                <div className="bg-white p-6 rounded shadow-md w-full max-w-md mt-8 text-center">
                    <h1 className="text-xl font-bold mb-4 text-red-600">Parental PIN Required</h1>
                    <p className="mb-4">A Parental PIN must be set before you can add new profiles.</p>
                    <button
                        onClick={() => router.push('/settings')}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 mr-2"
                    >
                        Go to Settings
                    </button>
                     <button
                        onClick={() => router.back()}
                        className="px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400"
                     >
                        Back
                     </button>
                </div>
            </div>
        );
    }


    // Render the form only if PIN is verified (or if no PIN was set initially - though the above block handles that)
    return (
        <div className="flex flex-col items-center justify-start h-screen relative w-full font-comic">
            {/* Conditionally render based on PIN verification */}
            {isPinVerified && <CreateChildProfileForm />}
            {/* If PIN wasn't required initially (e.g., feature flag), show form directly */}
            {/* {!parentalPin && <CreateChildProfileForm />} */}
             {/* Back button might be needed here too if the user gets here somehow without verification */}
             {!isPinVerified && !parentalPin && (
                 <div className="mt-6 text-center">
                     <button
                        onClick={() => router.back()}
                        className="px-4 py-2 bg-gray-300 text-black rounded hover:bg-gray-400"
                     >
                        Back
                     </button>
                 </div>
             )}
        </div>
    );
}