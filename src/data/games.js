import { CircleDot, Compass, Fish, Rocket } from "lucide-react";

// Game catalog. Only games with `playable: true` have been built so far.
export const GAMES = [
  {
    id: "tilt-maze",
    name: "Tilt Maze",
    desc: "Tilt your wrist to roll the ball to the flag.",
    trains: "Wrist",
    minutes: 2,
    tint: "lavender",
    icon: Compass,
    playable: true,
  },
  {
    id: "squeeze-pop",
    name: "Squeeze Pop",
    desc: "Squeeze to pop the bubbles before they float away.",
    trains: "Grip",
    minutes: 2,
    tint: "sky",
    icon: CircleDot,
    playable: true,
  },
  {
    id: "balloon-rescue",
    name: "Balloon Rescue",
    desc: "Pump up the balloon, then rotate your wrist to dodge asteroids.",
    trains: "Grip + wrist",
    minutes: 2,
    tint: "peach",
    icon: Rocket,
    playable: true,
  },
  {
    id: "fishing",
    name: "Fishing",
    desc: "Aim, cast, hook and reel in five fish, one easy move at a time.",
    trains: "Grip + all wrist moves",
    minutes: 3,
    tint: "mint",
    icon: Fish,
    playable: true,
  },
];