import { CircleDot, Compass, Fish, Rocket } from "lucide-react";

// Game catalog. Only games with `playable: true` have been built so far.
// level: "easy", "medium" or "hard" -- the Games menu groups them that way.
export const GAMES = [
  {
    id: "tilt-maze",
    name: "Tilt Maze",
    desc: "Tilt your wrist to roll the ball to the flag.",
    trains: "Wrist",
    minutes: 2,
    tint: "lavender",
    icon: Compass,
    level: "easy",
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
    level: "easy",
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
    level: "medium",
    playable: true,
  },
  {
    id: "fishing",
    name: "Fishing",
    desc: "Drop your hook into the deep, squeeze to hook rare fish, and reel them in. 20 fish to collect!",
    trains: "Grip + all wrist moves",
    minutes: 3,
    tint: "mint",
    icon: Fish,
    level: "hard",
    playable: true,
  },
];