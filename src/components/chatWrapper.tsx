"use client";

import dynamic from 'next/dynamic';
// Removed useTheme import

const Chat = dynamic(() => import('@/components/chat'), { ssr: false });

interface ChatWrapperProps {
  profileId: string | null; // Allow null for safety, though page.tsx logic prevents it
  useProfileGenres: boolean;
}

const ChatWrapper = ({ profileId, useProfileGenres }: ChatWrapperProps) => {
  // Removed useTheme hook call
  // Removed theme and toggleTheme props from Chat component
  // Pass useProfileGenres down to Chat
  return <Chat profileId={profileId!} useProfileGenres={useProfileGenres} />; // Use non-null assertion
};

export default ChatWrapper;
