import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { followSystemColorScheme } from "../lib/color-scheme.ts";
import "../styles.css";
import { ChooseScreen } from "./ChooseScreen.tsx";
import { LocalSetup } from "./LocalSetup.tsx";
import { RemoteSetup } from "./RemoteSetup.tsx";

type SetupScreen = "choose" | "local" | "remote";

/** The desktop app opens a given screen when the server it remembers does not answer at start. */
const startScreen = (new URLSearchParams(location.search).get("screen") ?? "choose") as SetupScreen;

/** The desktop app's first-run flow: choose where clots runs, then set up that server. */
function SetupApp() {
  const [screen, setScreen] = useState<SetupScreen>(startScreen);
  const choose = () => setScreen("choose");

  if (screen === "local") {
    return <LocalSetup onBack={choose} />;
  }

  if (screen === "remote") {
    return <RemoteSetup onBack={choose} />;
  }

  return <ChooseScreen onChoose={setScreen} />;
}

followSystemColorScheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SetupApp />
  </StrictMode>,
);
