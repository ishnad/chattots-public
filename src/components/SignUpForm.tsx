"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, collection, query, where, getDocs } from "firebase/firestore";

export default function SignUpForm() {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [parentalPin, setParentalPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!name || !dob || !gender || !username || !email || !password || !parentalPin) {
      setError("Please fill in all fields.");
      setLoading(false);
      return;
    }
    if (parentalPin.length !== 4 || !/^\d+$/.test(parentalPin)) {
      setError("Parental PIN must be exactly 4 digits.");
      setLoading(false);
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      localStorage.setItem("isAuthenticated", "true");

      const userDocRef = doc(db, "users", user.uid);
      await setDoc(userDocRef, {
        uid: user.uid,
        name,
        dob,
        gender,
        username,
        email,
        parentalPin,
        createdAt: new Date(),
      });

      router.push("/");
    } catch (err: any) {
      setError(err.message || "Failed to sign up. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-8 rounded-2xl w-full max-w-md border-2 border-yellow-200 text-[#333] font-[Comic_Sans_MS] bg-[#fffbea]">
      {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}
      <form onSubmit={handleSignup} className="space-y-4">
        <input
          type="text" placeholder="Full Name" value={name}
          onChange={(e) => setName(e.target.value)} required
          className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
        />
        <input
          type="text" placeholder="Username" value={username}
          onChange={(e) => setUsername(e.target.value)} required
          className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
        />
        <input
          type="email" placeholder="Email" value={email}
          onChange={(e) => setEmail(e.target.value)} required
          className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
        />
        <input
          type="password" placeholder="Password" value={password}
          onChange={(e) => setPassword(e.target.value)} required minLength={6}
          className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
        />
        <input
          type="date" value={dob}
          onChange={(e) => setDob(e.target.value)} required
          className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
        />
        <select
          value={gender} onChange={(e) => setGender(e.target.value)} required
          className="w-full p-3 border-2 border-yellow-300 rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
        >
          <option value="" disabled>Select Gender</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
          <option value="prefer_not_to_say">Prefer not to say</option>
        </select>
        <input
          type="password" placeholder="Parental PIN (4 digits)" value={parentalPin}
          onChange={(e) => setParentalPin(e.target.value)} required maxLength={4}
          pattern="\d{4}" title="PIN must be 4 digits"
          className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-orange-400 hover:bg-orange-500 text-white py-2 rounded-full transition duration-200 disabled:opacity-50"
        >
          {loading ? "Creating Account..." : "Sign Up! 📝"}
        </button>
      </form>
    </div>
  );
}
