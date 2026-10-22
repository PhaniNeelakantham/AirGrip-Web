import { Clock, Hand, Play } from "lucide-react";
import { GAMES } from "../data/games";
import DevicePanel from "../components/DevicePanel";

function GameCardBody({ game, locked }) {
  const { name, desc, trains, minutes, icon: Icon, playable } = game;
  return (
    <>
      <div className="game-art">
        <Icon size={34} strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="game-body">
        <h3 className="game-name">{name}</h3>
        <p className="game-desc">{desc}</p>
        <div className="game-meta">
          <span className="chip">
            <Hand size={14} aria-hidden="true" /> {trains}
          </span>
          <span className="chip">
            <Clock size={14} aria-hidden="true" /> {minutes} min
          </span>
          {locked ? (
            <span className="soon">Needs the AquaGrip</span>
          ) : playable ? (
            <span className="play-badge">
              <Play size={13} fill="currentColor" aria-hidden="true" /> Play
            </span>
          ) : (
            <span className="soon">Coming soon</span>
          )}
        </div>
      </div>
    </>
  );
}

const SECTIONS = [
  { level: "easy", title: "Easy", note: "a good place to start" },
  { level: "medium", title: "Medium", note: "grip and wrist together" },
  { level: "hard", title: "Hard", note: "for a bigger challenge" },
];

export default function GameMenu({ phoneMode = false, sensor, demoMode, onDemoModeChange, transport, onTransportChange, onPlay }) {
  return (
    <>
      <header className="screen-header">
        <div className="eyebrow">Games</div>
        <h1 className="title">Play &amp; practice</h1>
        <p className="subtitle">Short, fun exercises for your hand and wrist.</p>
      </header>

      <DevicePanel
        sensor={sensor}
        demoMode={demoMode}
        onDemoModeChange={onDemoModeChange}
        transport={transport}
        onTransportChange={onTransportChange}
      />

      {SECTIONS.map(({ level, title, note }) => {
        const games = GAMES.filter((g) => (g.level ?? "easy") === level);
        if (!games.length) return null;
        return (
          <section key={level} aria-label={title}>
            <h2 className="section-title">
              {title}
              <span className="section-note">{note}</span>
            </h2>
            <div className="games">
              {games.map((game) =>
                // With just a phone there's no grip sensor: grip games are locked.
                game.playable && !(phoneMode && game.needsGrip) ? (
                  <button key={game.id} className={`game-card tint-${game.tint}`} onClick={() => onPlay(game.id)}>
                    <GameCardBody game={game} />
                  </button>
                ) : (
                  <article key={game.id} className={`game-card tint-${game.tint}`} aria-disabled="true">
                    <GameCardBody game={game} locked={game.playable} />
                  </article>
                )
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
