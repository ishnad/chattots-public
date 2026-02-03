"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { logActivity } from "@/lib/activityLogger";

const colorOptions = ["#f87171", "#fbbf24", "#34d399", "#60a5fa", "#c084fc"];

export default function CreateChildProfileForm() {
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [interests, setInterests] = useState("");
  const [favoriteColor, setFavoriteColor] = useState(colorOptions[0]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const user = auth.currentUser;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!user || !name.trim()) {
      setError("Please fill in all required fields.");
      setLoading(false);
      return;
    }

    const profileData = {
      name: name.trim(),
      dob: new Date(dob),
      gender,
      interests: interests
        .split(",")
        .map((i) => i.trim())
        .filter((i) => i),
      favoriteColor,
      created: serverTimestamp(),
    };

    try {
      const profilesRef = collection(db, "chats", user.uid, "profiles");
      const docRef = await addDoc(profilesRef, profileData);
      await logActivity(user.uid, "Child Profile Created", {
        profileId: docRef.id,
        profileName: profileData.name,
      });

      router.push("/");
    } catch (error) {
      console.error("Error creating profile:", error);
      setError("Failed to create profile. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="w-full h-screen flex flex-col items-center justify-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333]"
      style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
    >  
      <h1 className={`text-4xl font-bold mb-4 text-orange-900`}>🤖 ChatTots</h1>

      <div className="bg-white p-6 rounded-2xl w-full max-w-md border-2 border-yellow-200">
        {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Child Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
          />
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
            className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
          />
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            required
            className="w-full p-3 border-2 border-yellow-300 rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-orange-300"
          >
            <option value="" disabled>
              Select Gender
            </option>
            <option value="male">Boy👦</option>
            <option value="female">Girl👧</option>
          </select>
          <input
            type="text"
            placeholder="Interests (comma separated)"
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            className="w-full p-3 border-2 border-yellow-300 rounded-full focus:outline-none focus:ring-2 focus:ring-orange-300 bg-[#fff3c7]"
          />

          {/* Favorite Color Picker */}
          <div>
            <label className="block font-semibold mb-2">Favorite Color</label>
            <div className="flex gap-3">
              {colorOptions.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`w-10 h-10 rounded-full border-4 ${
                    favoriteColor === color ? "border-orange-400" : "border-white"
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={() => setFavoriteColor(color)}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-400 hover:bg-green-500 text-white py-2 rounded-full transition duration-200 disabled:opacity-50 mt-4"
          >
            {loading ? "Creating Profile..." : "Create Profile 🎈"}
          </button>

          <button
            type="button"
            onClick={() => router.push("/")}
            className="w-full bg-red-500 text-white py-2 mt-2 rounded-full"
          >
            ← Back
          </button>
        </form>
      </div>
    </div>
  );
}
