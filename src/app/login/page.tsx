"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { signInWithEmailAndPassword } from "firebase/auth";
import { collection, query, where, getDocs, addDoc, serverTimestamp } from "firebase/firestore"; // Import addDoc and serverTimestamp
import Link from 'next/link';
import Header from "@/components/Header";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      let loginEmail = identifier;

      if (!identifier.includes('@')) {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("username", "==", identifier));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
          setError("We couldn’t find that name. Try again or ask a grown-up!");
          return;
        }

        loginEmail = querySnapshot.docs[0].data().email;
      }

      const userCredential = await signInWithEmailAndPassword(auth, loginEmail, password); // Get user credential
      localStorage.setItem("isAuthenticated", "true");

      // Log login activity
      if (userCredential.user) {
        const userId = userCredential.user.uid;
        // Write to the 'activities' subcollection under the specific user's document in 'activityLogs'
        const userActivitiesRef = collection(db, "activityLogs", userId, "activities");
        await addDoc(userActivitiesRef, { // Correctly use userActivitiesRef here
          userId: userCredential.user.uid,
          action: 'User Logged In',
          timestamp: serverTimestamp() // Use server timestamp for accuracy
        });
      }

      router.push("/");
    } catch (err: any) {
      setError("Hmm... that doesn’t look right. Want to try again?");
    }
  };

  return (
    <div 
      className="w-full h-screen flex flex-col items-center justify-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333]"
      style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
    >      
      <div className="w-full text-center mt-4">
        <h1 className={`text-4xl font-bold mb-4 text-orange-900`}>ChatTots</h1>
      </div>
    
      {/* Mascot not decided yet */}
      <div className="text-6xl mb-4 animate-bounce">🤖</div>

      <div className="bg-white p-6 rounded-2xl w-full max-w-sm border-2 border-yellow-200">
        {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}

        <form onSubmit={handleLogin} className="space-y-4">
          <input
            type="text"
            placeholder="Email"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
          />
          <button
            type="submit"
            className="w-full bg-orange-400 hover:bg-orange-500 text-white py-2 rounded-full transition duration-200"
          >
            Let’s Go 🚀
          </button>
        </form>

        <p className="mt-6 text-center text-xl1 text-black">
          Don't have an account?{" "}
          <Link href="/signup" className="font-medium text-orange-500 hover:text-orange-600">
            Sign Up Here!
          </Link>
        </p>
      </div>
    </div>
  );
}