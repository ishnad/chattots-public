"use client";

import { useEffect } from "react";
import { app } from "@/lib/firebase";

export default function TestFirebase() {
  useEffect(() => {
    console.log("✅ Firebase App:", app);
  }, []);

  return <p>Check console for Firebase log.</p>;
}
