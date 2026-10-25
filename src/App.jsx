import { memo, useCallback, useMemo, useState } from "react";
import { useAirGripSensor } from "./ble/useAirGripSensor";
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
import Garden from "./games/garden/Garden";
import SessionIntro from "./session/SessionIntro";
import SessionSummary from "./session/SessionSummary";
import { markPlanDone, newSessionId, planFrom, savePlanIds } from "./session/plan";
import BaselineAssessment from "./baseline/BaselineAssessment";
import { getBaseline } from "./data/baseline";
import { sessionHand, useHand } from "./data/hand";
import { getProfiles, sessionOwner, useProfiles } from "./data/profiles";
import WhoIsPlaying from "./profiles/WhoIsPlaying";
import ProfileForm from "./profiles/ProfileForm";
import { getGuest } from "./data/guest";
import { getDevMode } from "./data/devMode";

const TRANSPORT_KEY = "aquagrip.transport";

// "ble", "usb", or "phone"
function loadTransport() {
  try {
    const saved = localStorage.getItem(TRANSPORT_KEY);
    return saved === "usb" || saved === "phone" ? saved : "ble";
  } catch {
    return "ble";
  }
}

// Memoized so the sensor's ~50 updates per second don't re-render a game
const GAME_SCREENS = {
  "tilt-maze": memo(TiltMaze),
  "squeeze-pop": memo(SqueezePop),
  "balloon-rescue": memo(BalloonRescue),
  fishing: memo(Fishing),
  garden: memo(Garden),
};

function App() {
  const [tab, setTab] = useState("home");
  // Always starts off: real device + this browser's saved history
  const [demoMode, setDemoMode] = useState(false);
  const [transport, setTransport] = useState(loadTransport);
  const sensor = useAirGripSensor({ mock: demoMode, transport });
  const phoneMode = !demoMode && transport === "phone";
  const savedSessions = useSavedSessions();
  // Each person, and each of their hands, has its own progress
  const hand = useHand();
  const { profiles, active } = useProfiles();
  const mySessions = useMemo(
    () => savedSessions.filter((s) => sessionOwner(s, profiles) === active?.id && sessionHand(s) === hand),
    [savedSessions, profiles, active, hand]
  );
  const sessions = demoMode ? mockSessions : mySessions;

  // ---- People: who's playing, add/edit profile ----
  const [people, setPeople] = useState(() => (getProfiles().length !== 1 ? { view: "who", onStart: true } : null));
  const closePeople = () => {
    setPeople(null);
    setTab("home");
    window.scrollTo({ top: 0 });
  };

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
      // Storage blocked: the choice just isn't remembered next visit
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
    if (!demoMode && !phoneMode && !getDevMode() && !getBaseline(false)) {
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
  // ids: the games picked on the session screen, in order
  const startSession = (ids) => {
    savePlanIds(ids);
    setGuided({ stage: "game", plan: planFrom(ids), id: newSessionId(), step: 0, results: [], startedAt: Date.now() });
    window.scrollTo({ top: 0 });
  };
  const endSession = useCallback(() => {
    setGuided(null);
    setTab("home");
    window.scrollTo({ top: 0 });
  }, []);
  const nextStep = useCallback(
    (result) => {
      const results = [...guided.results, { gameId: guided.plan[guided.step].gameId, result }];
      const isLast = guided.step + 1 >= guided.plan.length;
      if (isLast && !getGuest()) markPlanDone(demoMode);
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
  const guidedPlan = guided?.plan;
  const sessionStep = useMemo(
    () =>
      guidedStage === "game"
        ? { index: guidedStep, total: guidedPlan.length, nextName: guidedPlan[guidedStep + 1]?.game.name }
        : null,
    [guidedStage, guidedStep, guidedPlan]
  );

  if (people && !baselineOpen) {
    const backToWho = () => setPeople(getProfiles().length === 0 || people.onStart ? { view: "who", onStart: people.onStart } : null);
    return (
      <main className="screen">
        {people.view === "who" && (
          <WhoIsPlaying
            onDone={closePeople}
            onAdd={() => setPeople({ view: "add", onStart: people.onStart })}
            onClose={people.onStart ? null : closePeople}
          />
        )}
        {people.view === "add" && (
          <ProfileForm
            onClose={() => (getProfiles().length && active ? closePeople() : backToWho())}
            onBaseline={() => {
              closePeople();
              openBaseline();
            }}
          />
        )}
        {people.view === "edit" && active && (
          <ProfileForm
            key={active.id}
            profile={active}
            onClose={closePeople}
            onDeleted={() => setPeople({ view: "who", onStart: true })}
          />
        )}
      </main>
    );
  }

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
          phoneMode={phoneMode}
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
    const StepGame = GAME_SCREENS[guidedPlan[guidedStep].gameId];
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
          phoneMode={phoneMode}
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
          phoneMode={phoneMode}
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
            onSwitchPerson={() => setPeople({ view: "who" })}
            onEditProfile={() => setPeople({ view: "edit" })}
            onOpenBaseline={openBaseline}
            connectionState={sensor.connectionState}
            demoMode={demoMode}
          />
        )}
        {tab === "games" && (
          <GameMenu
            phoneMode={phoneMode}
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