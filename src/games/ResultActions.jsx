import { ArrowRight } from "lucide-react";

// Buttons on a game's results card. In a guided session the main action
// moves on to the next step; on its own, a game offers Play again / Done.
export default function ResultActions({ sessionStep, onNext, onPlayAgain, onExit, playAgainLabel = "Play again" }) {
  if (sessionStep) {
    const last = sessionStep.index === sessionStep.total - 1;
    return (
      <>
        <button className="btn btn-primary btn-block btn-next" onClick={onNext}>
          {last ? "Finish session" : `Next: ${sessionStep.nextName}`}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button className="btn btn-secondary btn-block" onClick={onPlayAgain}>
          {playAgainLabel}
        </button>
      </>
    );
  }
  return (
    <>
      <button className="btn btn-primary btn-block" onClick={onPlayAgain}>
        {playAgainLabel}
      </button>
      <button className="btn btn-secondary btn-block" onClick={onExit}>
        Done
      </button>
    </>
  );
}

// Small "Step 1 of 3" tag shown under a game's title during a session.
export function StepTag({ sessionStep }) {
  if (!sessionStep) return null;
  return (
    <span className="game-step">
      Step {sessionStep.index + 1} of {sessionStep.total}
    </span>
  );
}
