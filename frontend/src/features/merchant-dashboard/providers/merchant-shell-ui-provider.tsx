"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode
} from "react";

interface MerchantShellUiContextValue {
  commandOpen: boolean;
  globalQuery: string;
  loggingOut: boolean;
  mobileNavOpen: boolean;
  searchRef: MutableRefObject<HTMLInputElement | null>;
  setCommandOpen: (value: boolean) => void;
  setGlobalQuery: (value: string) => void;
  setLoggingOut: (value: boolean) => void;
  setMobileNavOpen: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  sidebarCollapsed: boolean;
}

const MerchantShellUiContext = createContext<MerchantShellUiContextValue | null>(null);

export function MerchantShellUiProvider({ children }: { children: ReactNode }) {
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  const value = useMemo<MerchantShellUiContextValue>(
    () => ({
      commandOpen,
      globalQuery,
      loggingOut,
      mobileNavOpen,
      searchRef,
      setCommandOpen,
      setGlobalQuery,
      setLoggingOut,
      setMobileNavOpen,
      setSidebarCollapsed,
      sidebarCollapsed
    }),
    [commandOpen, globalQuery, loggingOut, mobileNavOpen, sidebarCollapsed]
  );

  return <MerchantShellUiContext.Provider value={value}>{children}</MerchantShellUiContext.Provider>;
}

export function useMerchantShellUi() {
  const context = useContext(MerchantShellUiContext);
  if (!context) {
    throw new Error("useMerchantShellUi must be used within MerchantShellUiProvider.");
  }
  return context;
}
