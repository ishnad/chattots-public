"use client";

import { useState, useRef, useEffect, useCallback } from "react"; // Added useCallback
import { v4 as uuidv4 } from "uuid";
import ReactMarkdown from "react-markdown";
import Link from 'next/link';
import { PlaceholdersAndVanishInput } from "@/components/ui/placeholders-and-vanish-input"; // Added import
import { auth, db } from "@/lib/firebase";
import { collection, addDoc, query, orderBy, onSnapshot, doc, getDoc, setDoc, getDocs, serverTimestamp, deleteDoc } from "firebase/firestore";

// Removed hardcoded genreEmojiMap

// Interface for fetched genre data including emoji
interface GenreWithEmoji {
  id: string;
  value: string; // The genre name used for matching prompts
  emoji?: string | null;
}

interface ChatProps {
  // Removed theme
  // Removed toggleTheme
  profileId: string;
  useProfileGenres: boolean; // Add the new prop
}

// Define default prompts for empty chats
const DEFAULT_PROMPTS = [
    "Recommend me a book 📕",
    "Recommend me a video 📺",
];

export default function Chat({ profileId, useProfileGenres }: ChatProps) { // Add useProfileGenres here
  const [chats, setChats] = useState<{ id: string; title: string }[]>([]);
  // Updated message state to include optional type and book data
  const [messages, setMessages] = useState<{
    sender: string;
    text: string;
    videos?: { id: string; title: string; description: string; thumbnail: string; videoUrl: string }[];
    type?: 'book' | string; // Add type, e.g., 'book'
    bookData?: { id: string; title: string; author: string; coverUrl?: string; url?: string; }; // Add book data structure
    prompts?: string[]; // Add optional array for clickable prompts
  }[]>([]);
  const [input, setInput] = useState("");
  const [loadingChatId, setLoadingChatId] = useState<string | null>(null); // Changed loading state
  const [isRecording, setIsRecording] = useState(false);
  const [isRecognitionReady, setIsRecognitionReady] = useState(false);
  const [isAddingBook, setIsAddingBook] = useState(false); // State for adding book operation
  // const [addedBookIds, setAddedBookIds] = useState<Set<string>>(new Set()); // REMOVED: Temporary session state
  const [readingLogBookIds, setReadingLogBookIds] = useState<Set<string>>(new Set()); // State for persistent log IDs
  const [currentPrompts, setCurrentPrompts] = useState<string[]>(DEFAULT_PROMPTS); // Initialize with default prompts
  const [chatSearchTerm, setChatSearchTerm] = useState(""); // State for chat search term
  const [fetchedBookGenres, setFetchedBookGenres] = useState<GenreWithEmoji[]>([]); // State for book genres
  const [fetchedContentGenres, setFetchedContentGenres] = useState<GenreWithEmoji[]>([]); // State for content genres
  const [currentContentType, setCurrentContentType] = useState<'book'|'video'|null>(null); // Track current recommendation type
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const user = auth.currentUser;

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState(() => {
      const storedSessionId = localStorage.getItem("sessionId");
      return storedSessionId ? storedSessionId : uuidv4();
    });

  useEffect(() => {
    localStorage.setItem("sessionId", sessionId);
  }, [sessionId]);

  useEffect(() => {
    // When profileId changes, reset selected chat, messages, and prompts
    // to ensure a clean state for the new profile context.
    setSelectedChatId(null);
    setMessages([]);
    setCurrentPrompts(DEFAULT_PROMPTS);

    // Generate a new session ID for Dialogflow to ensure conversation context is reset per profile
    const newSessionId = uuidv4();
    setSessionId(newSessionId);
    console.log(`Profile changed to ${profileId}, new Dialogflow session ID generated: ${newSessionId}`);

    if (!user || !profileId) {
      setChats([]); // Clear chat list if no user/profile
      return;
    }

    const chatsRef = collection(db, "chats", user.uid, "profiles", profileId, "chatSessions");
    const q = query(chatsRef, orderBy("timestamp", "desc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({
        id: doc.id,
        title: doc.data().title || "Untitled Chat",
      }));
      setChats(chatList);
    });

    return () => unsubscribe();
  }, [user, profileId]);

  useEffect(() => {
    if (!user || !profileId) {
        // If no user/profile, clear messages and don't set up listener
        setMessages([]);
        return;
    }

    if (!selectedChatId) {
        // If a chat is not selected (e.g., after deletion or initial load), clear messages
        console.log("No chat selected, clearing messages.");
        setMessages([]);
        return; // No listener needed
    }

    // If we have a selected chat, set up the listener
    const currentChatIdForListener = selectedChatId; // Capture the ID for use in callbacks
    console.log(`Setting up message listener for chat: ${currentChatIdForListener}`); // Use captured ID
    const messagesRef = collection(db, "chats", user.uid, "profiles", profileId, "chatSessions", currentChatIdForListener, "messages");
    const q = query(messagesRef, orderBy("timestamp", "asc"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      // --- Snapshot Guard ---
      // Get the chat ID associated with this specific listener instance
      const listenerChatId = currentChatIdForListener; // Use the captured ID

      // We also need the *current* selectedChatId from state. This is tricky inside the callback.
      // A simpler approach: The cleanup function *should* run when selectedChatId changes.
      // Let's rely on the cleanup and add logging. If issues persist, we might need a ref.

      // Log using the listener's ID and the *current* state ID for comparison
      console.log(`Received message snapshot for listener associated with chat: ${listenerChatId}. Currently selected chat: ${selectedChatId}`); // Add log

      // Basic check: If the listener's chat ID doesn't match the selected one, ignore.
      // This helps if the selectedChatId changed but cleanup hasn't fully finished.
      // Note: This check might be redundant if cleanup works perfectly, but adds safety.
      // A better check might involve comparing against the *current* state value if accessible reliably.
      // For now, let's proceed assuming cleanup handles the deselection case.

      // --- Check if the snapshot belongs to the currently selected chat ---
      // It's crucial to compare against the *current* selectedChatId state here.
      if (listenerChatId !== selectedChatId) {
          console.log(`Ignoring snapshot for listener ${listenerChatId} because current chat is ${selectedChatId}`);
          return; // Don't process if the chat has changed since the listener was set up
      }
      // --- End Check ---

      const msgs = snapshot.docs.map(doc => {
        const data = doc.data();
        // Ensure sender and text are always strings, provide defaults if necessary
        const sender = typeof data.sender === 'string' ? data.sender : 'unknown';
        const text = typeof data.text === 'string' ? data.text : '';
        return {
          sender: sender, // Use the sanitized sender
          text: text,     // Use the sanitized text
          // sender: data.sender as string, // REMOVE Duplicate
          // text: data.text as string, // REMOVE Duplicate
          videos: data.videos || [], // Retrieve videos array
          type: data.type as string | undefined, // Retrieve type
          bookData: data.bookData as { id: string; title: string; author: string; coverUrl?: string; url?: string; } | undefined, // Retrieve bookData
          prompts: data.prompts as string[] | undefined, // Retrieve prompts array
        };
      });
      // Only update messages if the snapshot is for the currently selected chat
      // This check might be implicitly handled by the listener cleanup, but explicit check adds safety.
      // Re-evaluate if needed: We need a reliable way to get the *current* selectedChatId here.
      // Sticking with the assumption that the cleanup function handles the switch/delete correctly for now.
      setMessages(msgs); // Update messages based on the snapshot

      // --- Control Prompts Based on Last Message in Firestore ---
      if (snapshot.empty) {
        console.log("Listener: Chat is empty, setting default prompts.");
        setCurrentPrompts(DEFAULT_PROMPTS);
      } else if (msgs.length > 0) {
        const lastMessage = msgs[msgs.length - 1];
        if (lastMessage?.sender === 'bot' && lastMessage.prompts && lastMessage.prompts.length > 0) {
          console.log("Listener: Last message from bot has prompts, setting them:", lastMessage.prompts);
          setCurrentPrompts(lastMessage.prompts); // Set prompts from the last bot message
        } else {
          // Clear prompts if last message is from user OR from bot but has no prompts stored
          console.log(`Listener: Last message from ${lastMessage?.sender} or has no prompts, clearing prompts.`);
          setCurrentPrompts([]);
        }
      } else {
         // Should not happen if snapshot is not empty, but clear prompts just in case
         setCurrentPrompts([]);
      }
      // --- End Control Prompts ---

    }, (error) => { // Add error handler for the listener
        // Use the listenerChatId captured above for more specific error logging
        const errorChatId = currentChatIdForListener; // Use captured ID
        console.error(`Error listening to messages for chat ${errorChatId}:`, error);
        // Optionally handle the error, e.g., show a message to the user, maybe clear messages for this chat
        // setMessages([]); // Example: Clear messages on listener error
    });

    // Cleanup function
    return () => {
        // Log which chat listener is being cleaned up
        const cleanupChatId = currentChatIdForListener; // Use captured ID
        console.log(`Cleaning up message listener for chat: ${cleanupChatId}`); // Add log
        unsubscribe();
    };
    // Ensure selectedChatId is a dependency so the effect re-runs when it changes
  }, [user, selectedChatId, profileId]); // Dependencies: user, selectedChatId, profileId

  // --- Effect to listen for Reading Log changes ---
  useEffect(() => {
    if (!user || !profileId) {
      setReadingLogBookIds(new Set()); // Clear log IDs if no user/profile
      return;
    }

    console.log(`Setting up reading log listener for profile: ${profileId}`);
    const logCollectionRef = collection(db, "chats", user.uid, "profiles", profileId, "readingLog");
    const q = query(logCollectionRef); // No specific ordering needed, just IDs

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const bookIds = new Set<string>();
      snapshot.docs.forEach(doc => {
        const bookData = doc.data();
        // IMPORTANT: Assuming the original book ID/URL is stored in the 'id' field within the readingLog document
        if (bookData.id) {
          bookIds.add(bookData.id);
        }
      });
      console.log(`Reading log listener updated. Found ${bookIds.size} book IDs.`);
      setReadingLogBookIds(bookIds);
    }, (error) => {
      console.error(`Error listening to reading log for profile ${profileId}:`, error);
      setReadingLogBookIds(new Set()); // Clear on error
    });

    // Cleanup function
    return () => {
      console.log(`Cleaning up reading log listener for profile: ${profileId}`);
      unsubscribe();
    };
  }, [user, profileId]); // Dependencies: user, profileId
  // --- End Reading Log Listener Effect ---


  // --- Pre-warm API Route on Mount ---
  useEffect(() => {
    console.log("Sending pre-warm ping to API route...");
    fetch("/api/dialogflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Send minimal data, just the ping message
      body: JSON.stringify({ message: "__PING__" }),
    })
    .then(response => {
      if (response.ok) {
        console.log("Pre-warm ping successful.");
      } else {
        console.warn("Pre-warm ping failed:", response.status, response.statusText);
      }
    })
    .catch(error => {
      console.error("Error sending pre-warm ping:", error);
    });
  }, []); // Empty dependency array ensures this runs only once on mount

  // --- Effect to Fetch Genres with Emojis ---
  useEffect(() => {
    const fetchGenresFromDb = async () => {
      console.log("Fetching genres with emojis from Firestore...");
      try {
        const [bookGenresSnap, contentGenresSnap] = await Promise.all([
          getDocs(query(collection(db, 'bookGenres'), orderBy('value'))),
          getDocs(query(collection(db, 'contentGenres'), orderBy('value')))
        ]);

        const bookGenres = bookGenresSnap.docs.map(doc => ({
          id: doc.id,
          value: doc.data().value,
          emoji: doc.data().emoji || null,
        })) as GenreWithEmoji[];

        const contentGenres = contentGenresSnap.docs.map(doc => ({
          id: doc.id,
          value: doc.data().value,
          emoji: doc.data().emoji || null,
        })) as GenreWithEmoji[];

        setFetchedBookGenres(bookGenres);
        setFetchedContentGenres(contentGenres);
        console.log(`Fetched ${bookGenres.length} book genres and ${contentGenres.length} content genres with emojis.`);
      } catch (error) {
        console.error("Error fetching genres with emojis:", error);
        setFetchedBookGenres([]);
        setFetchedContentGenres([]);
      }
    };

    fetchGenresFromDb();
  }, []);
  // --- End Fetch Genres Effect ---

  const startNewChat = () => {
    const newChatId = uuidv4();
    setSelectedChatId(newChatId);

    setChats(prevChats => {
      const chatTitle = `Untitled Chat`;
      createChatToFirebase(newChatId, chatTitle);
      return [...prevChats, { id: newChatId, title: chatTitle }];
    });
    setMessages([]);
    setCurrentPrompts(DEFAULT_PROMPTS); // Set default prompts for the new empty chat
    
    // Generate a new session ID to ensure fresh context
    const newSessionId = uuidv4();
    setSessionId(newSessionId);
    console.log(`New chat started with fresh session ID: ${newSessionId}`);
  };

  const createChatToFirebase = async (chatId: string, chatTitle: string) => {
     if(auth.currentUser && profileId){
      await setDoc(doc(db, "chats", auth.currentUser.uid, "profiles", profileId, "chatSessions", chatId), {
          title: chatTitle,
          timestamp: serverTimestamp(),
        });
     }
  };

  // Modified sendMessage to accept optional text override
  const sendMessage = async (messageTextOverride?: string) => {
    const textToSend = messageTextOverride || input.trim(); // Use override or trimmed input

    if (!textToSend || !user || !profileId) return; // Check textToSend

    setCurrentPrompts([]); // Clear prompts when starting to send a message

    let chatId = selectedChatId;
    let isNewChatJustCreated = false; // Flag to track if chat is created in this call

    if (!chatId) {
      chatId = uuidv4();
      setSelectedChatId(chatId);
      isNewChatJustCreated = true; // Set flag

      const chatTitle = `Untitled Chat`;
      await setDoc(doc(db, "chats", user.uid, "profiles", profileId, "chatSessions", chatId), {
        title: chatTitle,
        timestamp: serverTimestamp(),
      });

      setChats([...chats, { id: chatId, title: chatTitle }]);
    }

    const messagesRef = collection(db, "chats", user.uid, "profiles", profileId, "chatSessions", chatId, "messages");
    await addDoc(messagesRef, {
      sender: "user",
      text: textToSend, // Use textToSend here
      timestamp: serverTimestamp(),
    });

    const userMessageText = textToSend; // Store the text that was actually sent
    setInput(""); // Always clear the input field
    setLoadingChatId(chatId); // Set loading state to the current chat ID
    const currentRequestChatId = chatId; // Keep track of the chat ID for this specific request

    const body = JSON.stringify({
      message: userMessageText, // Use stored input
      sessionId: sessionId, // Use the latest session ID from state
      userId: user.uid, // Add userId
      profileId: profileId, // Add profileId from props
      useProfileGenres: useProfileGenres, // Add the checkbox state
      chatId: chatId // Add the current chat ID
    });
    console.log('Sending to Dialogflow API:', body); // Updated log message for clarity

    try {
      const response = await fetch("/api/dialogflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
      });

      let data;
      try {
        const responseText = await response.text();
        try {
          data = responseText ? JSON.parse(responseText) : {};
          console.log("<<< Received API Response Data >>>", JSON.stringify(data, null, 2));
        } catch (jsonError) {
          console.error("Error parsing API response JSON:", jsonError, "Response text:", responseText);
          throw new Error(`Invalid JSON response: ${responseText.substring(0, 100)}`);
        }
      } catch (error) {
        console.error("Error processing API response:", error);
        // Clear prompts even if response processing fails initially
        setCurrentPrompts([]);
        throw error;
      }

      // Update current prompts based on API response
      setCurrentPrompts(data?.prompts || []);

      const videos = data?.videos || []; // Extract videos array with null check

      // --- Frontend Chat Existence Check ---
      // Check if the chat associated with this request still exists in the local state
      // This relies on the optimistic UI update in deleteChat removing the chat promptly.
      // currentRequestChatId is the ID of the chat this API request was made for.
      // selectedChatId is the current value from React state.
      // isNewChatJustCreated is true if this sendMessage call created currentRequestChatId.

      // Condition to process the response:
      // 1. If the chat was just created by this sendMessage call (isNewChatJustCreated is true),
      //    then currentRequestChatId IS the chat we care about, regardless of the potentially stale selectedChatId state.
      // 2. OR, if it's not a newly created chat, then the response's chat ID (currentRequestChatId)
      //    must match the currently selected chat ID in the state (selectedChatId).
      if (isNewChatJustCreated || currentRequestChatId === selectedChatId) {
          // If we are here, it means either:
          // A) The chat was just created in this function call. currentRequestChatId is this new chat's ID.
          //    We should process the response for this new chat.
          // B) The chat was NOT just created, AND the response is for the currently selected chat.
          //    We should process the response.

          // Now, an additional check: ensure the chat (new or existing) is still considered "valid"
          // (e.g., hasn't been deleted in the meantime, or is in the local list if it's an existing one).
          const chatStillExistsInUiContext = isNewChatJustCreated || chats.some(chat => chat.id === currentRequestChatId);

          if (chatStillExistsInUiContext) {
              if (isNewChatJustCreated) {
                  console.log(`Frontend check: Chat ${currentRequestChatId} (newly created by this call) processing response.`);
              } else { // This implies currentRequestChatId === selectedChatId and it's an existing chat in the list
                  console.log(`Frontend check: Chat ${currentRequestChatId} (existing, selected, and in local list) processing response.`);
              }

              // --- Update Title (Only if chat exists and is selected/newly created) ---
              if (data.newTitle) {
                try {
                  // Use currentRequestChatId here as it's confirmed to be the relevant chat ID
                  const chatDocRef = doc(db, "chats", user.uid, "profiles", profileId, "chatSessions", currentRequestChatId);
                  await setDoc(chatDocRef, {
                    title: data.newTitle,
                  }, { merge: true });
                  console.log(`Successfully updated title for chat ${currentRequestChatId} to "${data.newTitle}"`);
                  setChats(prevChats => prevChats.map(c =>
                    c.id === currentRequestChatId ? { ...c, title: data.newTitle } : c
                  ));
                } catch (titleError) {
                    console.error(`Error updating chat title ${currentRequestChatId} in Firestore:`, titleError);
                }
              }
              // --- End Title Update ---

              // --- Add Messages (Only if chat is valid for processing) ---
              if (Array.isArray(data.messages)) {
                console.log("--- Processing data.messages array ---");
                type ApiMessage = {
                  sender?: string; text?: string; videos?: any[]; timestamp?: any;
                  type?: string; bookData?: any; prompts?: string[];
                };
                data.messages.forEach((message: ApiMessage, index: number) => {
                  const messageToAdd: any = {
                    sender: message.sender || "bot", text: message.text || "",
                    videos: message.videos || [],
                    timestamp: message.timestamp || serverTimestamp(),
                  };
                  if (message.type !== undefined && message.type !== null) messageToAdd.type = message.type;
                  if (message.bookData) messageToAdd.bookData = message.bookData;
                  if (index === data.messages.length - 1) messageToAdd.prompts = data.prompts || [];
                  
                  console.log("--- Adding message from array to Firestore ---", JSON.stringify(messageToAdd, null, 2));
                  try {
                    addDoc(messagesRef, messageToAdd);
                  } catch (firestoreError) {
                    console.error("Error adding message from array to Firestore:", firestoreError, "Message data:", messageToAdd);
                  }
                });
              } else {
                console.log("--- API response did not contain data.messages array, processing as single fallback message ---");
                const singleMessageToAdd: any = {
                  sender: "bot", text: data.response || "", videos: videos,
                  timestamp: serverTimestamp(),
                };
                if (data.type !== undefined && data.type !== null) singleMessageToAdd.type = data.type;
                if (data.bookData) singleMessageToAdd.bookData = data.bookData;
                singleMessageToAdd.prompts = data.prompts || [];

                console.log("--- Adding single fallback message to Firestore ---", singleMessageToAdd);
                try {
                  await addDoc(messagesRef, singleMessageToAdd);
                } catch (firestoreError) {
                   console.error("Error adding single fallback message to Firestore:", firestoreError, "Message data:", singleMessageToAdd);
                }
              }
              // --- End Add Messages ---

              setCurrentPrompts(data?.prompts || []);

          } else {
              // This case means:
              // - isNewChatJustCreated is FALSE (it's an existing chat)
              // - currentRequestChatId === selectedChatId (it's selected)
              // - BUT chats.some(chat => chat.id === currentRequestChatId) is FALSE (not in local list)
              // This is the "stale 'chats' list or race condition" case.
              console.log(`Frontend check: Chat ${currentRequestChatId} is selected, but not in local 'chats' list (and wasn't just created by this call). Skipping response processing due to potential stale 'chats' list or race condition.`);
          }
      } else {
          // This case means:
          // - isNewChatJustCreated is FALSE (it's an existing chat)
          // - AND currentRequestChatId !== selectedChatId (response is for a chat that is no longer selected)
          console.log(`Frontend check: Response for chat ${currentRequestChatId} but selected chat is now ${selectedChatId}. Skipping Firestore write for bot response.`);
      }

  } catch (error) { // Outer catch for fetch/parsing errors
      console.error("Error sending message or processing API response:", error);
      // Clear prompts on error as well, as the flow is interrupted.
      setCurrentPrompts([]);
      // Optionally show an error message to the user here
    } finally {
      // Clear loading state only if this request was the one loading
      setLoadingChatId(prevLoadingId => (prevLoadingId === currentRequestChatId ? null : prevLoadingId));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage(); // No argument needed here
    }
  };

  const deleteChat = async (chatId: string) => {
    if (!user || !profileId) return;

    const chatRef = doc(db, "chats", user.uid, "profiles", profileId, "chatSessions", chatId);
    const messagesRef = collection(chatRef, "messages");

    // --- Optimistic UI Update ---
    // Remove the chat from the local state immediately
    setChats(prevChats => prevChats.filter(chat => chat.id !== chatId));

    // If the deleted chat was selected, clear selection, messages, and set default prompts
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      setMessages([]); // Clear messages for the deleted chat
      setCurrentPrompts(DEFAULT_PROMPTS); // Set default prompts when no chat is selected after deletion
    }

    // If the deleted chat was the one loading, clear the loading state
    setLoadingChatId(prevLoadingId => (prevLoadingId === chatId ? null : prevLoadingId));
    // --- End Optimistic UI Update ---

    // --- Perform Firestore Deletion in the background ---
    try {
        const messagesSnapshot = await getDocs(messagesRef);
        const deletePromises = messagesSnapshot.docs.map((doc) => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        await deleteDoc(chatRef);
        console.log(`Successfully deleted chat ${chatId} and its messages from Firestore.`);
    } catch (error) {
        console.error(`Error deleting chat ${chatId} from Firestore:`, error);
        // Optional: Add the chat back to the UI state if deletion fails?
        // Or show an error message to the user.
    }
    // --- End Firestore Deletion ---

    // Note: State updates for selectedChatId and loadingChatId are now handled
    // in the optimistic update section above. The check below is redundant.
    /*
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      setMessages([]);
    }

    // If the deleted chat was the one loading, clear the loading state
    setLoadingChatId(prevLoadingId => (prevLoadingId === chatId ? null : prevLoadingId));
    */
  };

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Setup Speech Recognition
  useEffect(() => {
    let recognition: SpeechRecognition | null = null;

    const handleResult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setInput(transcript);
      console.log('Speech recognized:', transcript);
      
      // Remove manual DOM manipulation - setting the state `setInput(transcript)`
      // and passing it as a prop to the controlled PlaceholdersAndVanishInput
      // is sufficient.
      // const inputComponent = document.querySelector('.PlaceholdersAndVanishInput');
      // ... (removed code) ...
    };

    const handleError = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        console.log('No speech detected.');
      } else if (event.error === 'audio-capture') {
        console.error('Audio capture error. Ensure microphone access is granted.');
      } else if (event.error === 'not-allowed') {
        console.error('Microphone access denied.');
      }
      setIsRecording(false); // Ensure state is updated on error
    };

    const handleStart = () => {
      console.log('Speech recognition actually started.');
      setIsRecording(true); // Set recording state when recognition starts
    };

    const handleEnd = () => {
      console.log('Speech recognition ended.');
      setIsRecording(false); // Ensure state is updated when recognition ends
    };

    // Check if window is defined (for SSR compatibility) and SpeechRecognition is supported
    if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      // Use addEventListener for better compatibility
      recognition.addEventListener('result', handleResult);
      recognition.addEventListener('error', handleError);
      recognition.addEventListener('start', handleStart); // Listen for start event
      recognition.addEventListener('end', handleEnd);     // Listen for end event

      recognitionRef.current = recognition;
      setIsRecognitionReady(true);
      console.log('Speech Recognition initialized.');
    } else {
      console.warn('Speech Recognition API is not supported in this browser.');
      setIsRecognitionReady(false);
    }

    // Cleanup function
    return () => {
      if (recognitionRef.current) {
        console.log('Cleaning up speech recognition listeners and stopping.');
        // Remove listeners
        recognitionRef.current.removeEventListener('result', handleResult);
        recognitionRef.current.removeEventListener('error', handleError);
        recognitionRef.current.removeEventListener('start', handleStart);
        recognitionRef.current.removeEventListener('end', handleEnd);
        // Stop recognition
        recognitionRef.current.stop();
        recognitionRef.current = null; // Clear the ref
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only once on mount

  const handleVoiceInput = useCallback(() => {
    if (!recognitionRef.current || !isRecognitionReady) {
      console.warn('Speech Recognition not initialized or not ready.');
      return;
    }

    // The state update (isRecording) is now handled by the event listeners ('start', 'end', 'error')

    if (isRecording) {
      console.log('handleVoiceInput: Requesting stop.');
      recognitionRef.current.stop();
      // Let the 'end' or 'error' event listener handle setting isRecording to false
    } else {
      console.log('handleVoiceInput: Requesting start.');
      try {
        recognitionRef.current.start();
        // Let the 'start' event listener handle setting isRecording to true
      } catch (error) {
        console.error("Error invoking recognition.start():", error);
        // If start() itself throws an error, reset state here
        setIsRecording(false);
      }
    }
  }, [isRecording, isRecognitionReady]); // Add isRecognitionReady dependency

  // Function to add book to reading log and update UI state
  const addBookToLog = async (book: { id: string; title: string; author: string; coverUrl?: string; url?: string; }) => {
    if (!user || !profileId || !book || !book.id) { // Added checks for book and book.id
      console.error("User, profile, or book data missing");
      // Maybe show a user-facing error message
      return;
    }

    // REMOVED: Optimistic UI update - Button state now relies on Firestore listener

    console.log("Attempting to add book to log:", book);
    setIsAddingBook(true); // Indicate background activity (optional, as button changes instantly)

    try {
      // --- Firestore Logic ---
      // 1. Define the path to the specific profile's reading log.
      const logCollectionRef = collection(db, "chats", user.uid, "profiles", profileId, "readingLog"); // Correct path

      // 2. Check if the book already exists in the log for this profile (optional)
      //    const q = query(logCollectionRef, where("id", "==", book.id)); // Assuming bookData has a unique 'id' field from the source
      //    const existing = await getDocs(q);
      //    if (!existing.empty) {
      //      console.log("Book already in log");
      //      // Show feedback to user
      //      setLoading(false);
      //      return;
      //    }

      // 3. Add the book document
      await addDoc(logCollectionRef, {
        ...book, // Spread book details
        addedAt: serverTimestamp(), // Timestamp when added
        status: 'to-read', // Default status (optional)
        profileId: profileId // Associate with the profile (optional)
      });

      console.log("Book added successfully:", book.title);
      // Optionally provide user feedback (e.g., a toast notification)

    } catch (error) {
      console.error("Error adding book to reading log:", error);
      // Show user-facing error message
    } finally {
      setIsAddingBook(false);
    }
  };

  // Handler for clicking a suggested prompt
  const handlePromptClick = (promptText: string) => {
    console.log("Prompt clicked:", promptText);
    sendMessage(promptText); // Call sendMessage with the prompt's text
  };

  return (
    <div className="flex h-screen w-full font-comic bg-green-200 p-4">
      {/* Updated sidebar class to always use bg-gray-200 */}
      <div className="sidebar-container w-[25%] p-4 overflow-y-auto bg-yellow-100 rounded-2xl mr-4 shadow-lg border-4 border-yellow-300" style={{ backgroundImage: "url('/subtle-pencil-backdrop.png')", backgroundSize: "cover" }}>
        <h2 className="font-bold mb-2">Past Chats</h2>
        <button onClick={startNewChat} className="bg-blue-500 text-white w-full py-2 rounded mb-2">
          + New Chat
        </button>
        {/* Chat Search Input */}
        <input
          type="text"
          placeholder="Search chats..."
          value={chatSearchTerm}
          onChange={(e) => setChatSearchTerm(e.target.value)}
          className="w-full p-2 mb-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {chats
          .filter(chat => chat.title.toLowerCase().includes(chatSearchTerm.toLowerCase()))
          .map(chat => (
          <div key={chat.id} className="flex justify-between items-center">
            <div
              className={`p-2 rounded cursor-pointer ${chat.id === selectedChatId ? "bg-blue-300" : "hover:bg-gray-300"}`}
              onClick={() => setSelectedChatId(chat.id)}
            >
              {chat.title}
            </div>
            <button
              onClick={() => deleteChat(chat.id)}
              className="text-red-500 hover:text-red-700 ml-2"
            >
              🗑️
            </button>
          </div>
        ))}
      </div>

      <div className="chat-container flex-1 flex flex-col bg-white rounded-2xl shadow-lg border-4 border-blue-300 overflow-hidden">
        {/* Removed theme toggle button */}
<div className="flex-1 overflow-y-auto p-4 bg-blue-50" style={{ backgroundImage: "url('/subtle-book-backdrop.png')", backgroundSize: "cover" }} ref={chatContainerRef}>
          {messages.map((msg, index) => (
            <div key={index} className={`p-2 my-1 rounded-lg ${
              msg.sender === "user"
                ? "bg-purple-200 ml-auto text-purple-900 border-2 border-purple-300"
                : `bg-green-300 text-gray-800 border-green-900 ${msg.videos && msg.videos.length > 0 ? 'w-full' : 'mr-auto'}` // Conditionally make bubble full width if videos exist
            }`}>
              {msg.sender === "bot" ? (
                msg.type === 'book' && msg.bookData ? (
                  // Render Book Recommendation
                  <div className="flex items-start gap-3">
                    {/* Optional: Book Cover */}
                    {msg.bookData.coverUrl && (
                      <img src={msg.bookData.coverUrl} alt={`${msg.bookData.title} cover`} className="w-16 h-24 object-cover rounded flex-shrink-0" />
                    )}
                    <div className="flex-grow">
                      {/* --- MODIFICATION START --- */}
                      <a href={msg.bookData.url || '#'} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        <strong className="block">{msg.bookData.title}</strong>
                      </a>
                      {/* --- MODIFICATION END --- */}
                      {/* Display regular text if any */}
                      {msg.text && (
                         <ReactMarkdown components={{ a: ({ href, children }) => <Link href={href || '/'} className="read-more">{children}</Link> }}>
                           {msg.text}
                         </ReactMarkdown>
                      )}
                    </div>
                    {/* Conditional Rendering: Checkmark or Add Button based on Firestore log */}
                    {readingLogBookIds.has(msg.bookData.id) ? (
                      <span className="ml-2 px-2 py-1 text-2xl self-center" title="Added to Reading Log">✅</span>
                    ) : (
                      <button
                        onClick={() => addBookToLog(msg.bookData!)} // Assert non-null as we checked bookData
                        className="ml-2 px-2 py-1 bg-green-500 text-white rounded text-xl font-bold hover:bg-green-600 self-center disabled:opacity-50"
                        title={`Add "${msg.bookData.title}" to Reading Log`}
                        // Disable button while any add operation is in progress OR if already in log (double check)
                        disabled={isAddingBook || readingLogBookIds.has(msg.bookData.id)}
                      >
                        +
                      </button>
                    )}
                  </div>
                ) : (
                  // Render Standard Bot Message (Text/Video)
                  <div>
                    <ReactMarkdown components={{ a: ({ href, children }) => <Link href={href || '/'} className="read-more">{children}</Link> }}>
                      {msg.text}
                    </ReactMarkdown>
                    {/* Render YouTube embeds if videos exist - now in 2-column grid */}
                    {msg.videos && msg.videos.length > 0 && (
                      <div className="grid grid-cols-2 gap-2 mt-4">
                        {msg.videos.map((video, videoIndex) => (
                          <div key={videoIndex} className="youtube-embed aspect-video">
                            <iframe
                              className="w-full h-full"
                              src={`https://www.youtube.com/embed/${video.id}`}
                              title={video.title || "YouTube video player"}
                              frameBorder="0"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                              referrerPolicy="strict-origin-when-cross-origin"
                              allowFullScreen
                            ></iframe>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Clickable prompts are now rendered near the input area */}
                  </div>
                )
              ) : (
                // Render User Message
                msg.text
              )}
            </div>
          ))}
          {/* Show loading indicator only if a chat is actively loading AND it's the selected chat */}
          {loadingChatId !== null && loadingChatId === selectedChatId && (
           <div className="p-4 my-3 rounded-2xl bg-green-200 mr-auto text-green-400 border-2 border-green-300 shadow-md max-w-[80%]">
             <div className="flex gap-2 items-center">
               <div className="w-3 h-3 bg-green-600 rounded-full animate-bounce"></div>
          <div className="w-3 h-3 bg-green-600 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          <div className="w-3 h-3 bg-green-600 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
          <span className="ml-2">Thinking...</span>
            </div>
          </div>
        )}
        {/* Render Clickable Prompts (Aligned Right) After Messages and Loading Indicator */}
        {/* Show prompts if they exist AND (no chat is selected OR the currently selected chat is NOT loading) */}
        {currentPrompts.length > 0 && (selectedChatId === null || loadingChatId !== selectedChatId) && (
             <div className="p-4 flex flex-col items-end"> {/* Align container to the right */}
               <div className="flex flex-wrap justify-end gap-2 max-w-[80%]"> {/* Justify buttons right, limit width */}
                 {currentPrompts.map((prompt, pIndex) => (
                   <button
                     key={pIndex}
                     onClick={() => handlePromptClick(prompt)}
                     // Style similar to user message bubble but as button - increased padding and text size
                     className="px-6 py-4 bg-purple-200 text-purple-1500 rounded-full text-base hover:bg-purple-300 transition-colors duration-150 ease-in-out shadow border border-purple-300"
                     disabled={!!loadingChatId} // Disable if loading (redundant check, but safe)
                   >
                     {/* Prepend emoji if found in fetched genres state */}
                     {(currentContentType === 'book' 
                       ? fetchedBookGenres.find(g => g.value === prompt)?.emoji 
                       : fetchedContentGenres.find(g => g.value === prompt)?.emoji) || ''}
                     {prompt}
                   </button>
                 ))}
               </div>
             </div>
           )}
        </div>

        {/* Container for Input Area */}
        <div className="input-area-container p-2 border-t border-gray-300 bg-white">
           {/* Prompts are now rendered after the message list */}

           {/* Input Row */}
           <div className="flex gap-2 items-center h-12"> {/* Adjusted height */}
             <div className="flex-1 relative h-full"> {/* Ensure relative positioning and full height */}
               <PlaceholdersAndVanishInput
                 placeholders={[
                "Can you recommend me a book?",
                "I want to watch a cartoon video.",
                "Type your message...",
              ]}
              onChange={(e) => {
                setInput(e.target.value);
                setCurrentPrompts([]); // Clear prompts when user types
              }}
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(); // No argument needed here
              }}
              value={input} // Pass the input state as value prop
                // Remove the key prop: key={`input-${input}`}
              />
            </div>
            <button onClick={() => sendMessage()} className="bg-purple-700 text-white px-4 py-2 rounded self-stretch" disabled={!!loadingChatId}>Send 🚀</button> {/* Stretch button height */}
            <button
              onClick={handleVoiceInput}
            className={`px-3 py-2 rounded text-white ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-green-700 hover:bg-green-800'} disabled:opacity-50`}
            title={isRecording ? "Stop Recording" : "Start Voice Input"}
              disabled={!!loadingChatId || !isRecognitionReady} // Disable if loading or recognition not ready
            >
              {isRecording ? '🛑' : '🎙️'} {/* Use different icons for state */}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
