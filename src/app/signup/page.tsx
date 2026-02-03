"use client";

import SignUpForm from "@/components/SignUpForm"; // We will create this component next
import Header from "@/components/Header";

export default function SignUpPage() {
  return (
    <div 
      className="w-full h-screen flex flex-col items-center justify-center min-h-screen px-4 bg-yellow-50 font-comic text-[#333]"
      style={{ backgroundImage: "url('/subtle-yellow-backdrop.png')", backgroundSize: "cover" }}
    >  
      <div className="w-full text-center mt-4">
        <h1 className={`text-4xl font-bold mb-4 text-orange-900`}>🤖 ChatTots</h1>
      </div>
      <SignUpForm />
    </div>
  );
}