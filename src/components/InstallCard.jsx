import { Download } from "lucide-react";
import { isIOS, promptInstall, useInstallState } from "../pwa/installPrompt";

// Always shown until AirGrip is running as an installed app
export default function InstallCard() {
  const state = useInstallState();
  if (state === "installed") return null;

  const manualSteps = isIOS()
    ? "In Safari, tap Share, then “Add to Home Screen”."
    : "Open your browser menu (⋮) and choose “Install app”.";

  return (
    <section className="install-card tint-sky" aria-label="Install AirGrip">
      <div className="install-icon">
        <Download size={22} aria-hidden="true" />
      </div>
      <div className="install-text">
        <strong>Install AirGrip</strong>
        <span>{state === "ready" ? "Opens full-screen like an app and works offline." : manualSteps}</span>
      </div>
      {state === "ready" && (
        <button className="btn btn-primary install-btn" onClick={promptInstall}>
          Install
        </button>
      )}
    </section>
  );
}
