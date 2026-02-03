"use client";

import { createContext, useContext, ReactNode } from 'react'; // Removed useState, useEffect

interface ThemeContextProps {
  theme: string;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // Hardcode theme to light and provide an empty toggle function
  const theme = "light";
  const toggleTheme = () => {}; // Empty function, does nothing

  // Return only the provider wrapping children
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  // Return the context which now always has theme='light' and an empty toggleTheme
  return context;
};