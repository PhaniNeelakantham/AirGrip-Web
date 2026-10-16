import { memo, useCallback, useMemo, useState } from "react";
import { useAquaGripSensor } from "./ble/useAquaGripSensor";
import { mockSessions } from "./data/mockSessions";
import { useSavedSessions } from "./data/sessionStore";
import BottomNav from "./components/BottomNav";
import Home from "./screens/Home";
import GameMenu from "./screens/GameMenu";
import ProgressTracker from "./screens/ProgressTracker";
import TiltMaze from "./games/tiltMaze/TiltMaze";
import SqueezePop from "./games/squeezePop/SqueezePop";
import BalloonRescue from "./games/balloonRescue/BalloonRescue";
import Fishing from "./games/fishing/Fishing";
import SessionIntro from "./session/SessionIntro";
import SessionSummary from "./session/SessionSummary";
import { TODAY_PLAN, markPlanDone, newSessionId } from "./session/plan";
import BaselineAssessment from "./baseline/BaselineAssessment";
import { getBaseline } from "./data/baseline";
import { sessionHand, useHand } from "./data/hand";

const TRANSPORT_KEY = "aquagrip.transport";

// "ble" (Bluetooth) or "usb" (cable, Chrome/Edge on a computer).
function loadTransport() {
  try {
    return localStorage.getItem(TRANSPORT_KEY) === "usb" ? "usb" : "ble";
  } catch {
    return "ble";
  }
}

// Memoized so the sensor's ~50 updates per second don't re-render a game;
// games read live data from `readingRef` inside their own frame loop.
const GAME_SCREENS = {
  "tilt-maze": memo(TiltMaze),
  "squeeze-pop": memo(SqueezePop),
  "balloon-rescue": memo(BalloonRescue),
  fishing: memo(Fishing),
};

function App() {
  const [tab, setTab] = useState("home");
  // Always starts off: real device + this browser's saved history.
  const [demoMode, setDemoMode] = useState(false);
  const [transport, setTransport] = useState(loadTransport);
  const sensor = useAquaGripSensor({ mock: demoMode, transport });
  const savedSessions = useSavedSessions();
  // Each hand has its own progress. (Demo data isn't tied to a hand.)
  const hand = useHand();
  const handSessions = useMemo(() => savedSessions.filter((s) => sessionHand(s) === hand), [savedSessions, hand]);
  const sessions = demoMode ? mockSessions : handSessions;

  const navigate = (next) => {
    setTab(next);
    window.scrollTo({ top: 0 });
  };

  const changeDemoMode = (next) => {
    sensor.disconnect();
    setDemoMode(next);
  };

  const changeTransport = (next) => {
    sensor.disconnect();
    setTransport(next);
    try {
      localStorage.setItem(TRANSPORT_KEY, next);
    } catch {
      // Storage blocked: the choice just isn't remembered next visit.
    }
  };

  const [playing, setPlaying] = useState(null);
  const leaveGame = useCallback(() => {
    setPlaying(null);
    setTab("games");
    window.scrollTo({ top: 0 });
  }, []);

  // ---- Today's guided session: intro -> each game in order -> summary ----
  const [guided, setGuided] = useState(null); // { stage, id, step, results, startedAt }

  // ---- Baseline assessment (full screen); returns to wherever it was opened ----
  const [baselineOpen, setBaselineOpen] = useState(null); // { thenSession } | null
  const openBaseline = useCallback(() => setBaselineOpen({ thenSession: false }), []);

  const openSession = () => {
    // The games are tuned from the baseline, so take it first if it's missing
    // (optional in Demo mode, which has default ranges).
    if (!demoMode && !getBaseline(false)) {
      setBaselineOpen({ thenSession: true });
      return;
    }
    setGuided({ stage: "intro" });
    window.scrollTo({ top: 0 });
  };
  const closeBaseline = (done) => {
    const thenSession = baselineOpen?.thenSession;
    setBaselineOpen(null);
    window.scrollTo({ top: 0 });
    if (done && thenSession) setGuided({ stage: "intro" });
  };
  const startSession = () => {
    setGuided({ stage: "game", id: newSessionId(), step: 0, results: [], startedAt: Date.now() });
    window.scrollTo({ top: 0 });
  };
  const endSession = useCallback(() => {
    setGuided(null);
    setTab("home");
    window.scrollTo({ top: 0 });
  }, []);
  const nextStep = useCallback(
    (result) => {
      const results = [...guided.results, { gameId: TODAY_PLAN[guided.step].gameId, result }];
      const isLast = guided.step + 1 >= TODAY_PLAN.length;
      if (isLast) markPlanDone(demoMode);
      setGuided({
        ...guided,
        results,
        step: isLast ? guided.step : guided.step + 1,
        stage: isLast ? "summary" : "game",
        ...(isLast && { finishedAt: Date.now() }),
      });
      window.scrollTo({ top: 0 });
    },
    [guided, demoMode]
  );
  const guidedStage = guided?.stage;
  const guidedStep = guided?.step;
  const sessionStep = useMemo(
    () =>
      guidedStage === "game"
        ? { index: guidedStep, total: TODAY_PLAN.length, nextName: TODAY_PLAN[guidedStep + 1]?.game.name }
        : null,
    [guidedStage, guidedStep]
  );

  if (baselineOpen) {
    return (
      <BaselineAssessment
        demoMode={demoMode}
        connectionState={sensor.connectionState}
        readingRef={sensor.readingRef}
        lastDataAtRef={sensor.lastDataAtRef}
        onReconnect={sensor.connect}
        onClose={closeBaseline}
      />
    );
  }

  if (guidedStage === "intro") {
    return (
      <main className="screen screen--game">
        <SessionIntro
          demoMode={demoMode}
          connectionState={sensor.connectionState}
          onStart={startSession}
          onExit={endSession}
        />
      </main>
    );
  }

  if (guidedStage === "summary") {
    return (
      <main className="screen screen--game">
        <SessionSummary
          results={guided.results}
          durationMs={guided.finishedAt - guided.startedAt}
          sessions={sessions}
          demoMode={demoMode}
          onHome={endSession}
          onProgress={() => {
            setGuided(null);
            navigate("progress");
          }}
        />
      </main>
    );
  }

  if (guidedStage === "game") {
    const StepGame = GAME_SCREENS[TODAY_PLAN[guidedStep].gameId];
    return (
      <main className="screen screen--game">
        <StepGame
          key={`${guided.id}-${guidedStep}`}
          connectionState={sensor.connectionState}
          readingRef={sensor.readingRef}
          lastDataAtRef={sensor.lastDataAtRef}
          demoMode={demoMode}
          onExit={endSession}
          onReconnect={sensor.connect}
          onOpenBaseline={openBaseline}
          sessionStep={sessionStep}
          sessionGroupId={guided.id}
          onNext={nextStep}
        />
      </main>
    );
  }

  const Game = GAME_SCREENS[playing];
  if (Game) {
    return (
      <main className="screen screen--game">
        <Game
          connectionState={sensor.connectionState}
          readingRef={sensor.readingRef}
          lastDataAtRef={sensor.lastDataAtRef}
          demoMode={demoMode}
          onExit={leaveGame}
          onReconnect={sensor.connect}
          onOpenBaseline={openBaseline}
        />
      </main>
    );
  }

  return (
    <>
      <main key={tab} className="screen">
        {tab === "home" && (
          <Home
            sessions={sessions}
            onNavigate={navigate}
            onStartSession={openSession}
            onOpenBaseline={openBaseline}
            connectionState={sensor.connectionState}
            demoMode={demoMode}
          />
        )}
        {tab === "games" && (
          <GameMenu
            sensor={sensor}
            demoMode={demoMode}
            onDemoModeChange={changeDemoMode}
            transport={transport}
            onTransportChange={changeTransport}
            onPlay={(id) => {
              setPlaying(id);
              window.scrollTo({ top: 0 });
            }}
          />
        )}
        {tab === "progress" && (
          <ProgressTracker sessions={sessions} demoMode={demoMode} onNavigate={navigate} />
        )}
      </main>
      <BottomNav tab={tab} onChange={navigate} />
    </>
  );
}

export default App;