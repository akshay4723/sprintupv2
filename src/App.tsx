import { AnimatePresence, motion } from "framer-motion";
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  remove,
  serverTimestamp as rtdbServerTimestamp,
  set,
  update,
} from "firebase/database";
import { getDownloadURL, ref as storageRef, uploadBytesResumable } from "firebase/storage";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, Stars } from "@react-three/drei";
import { FormEvent, ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, BrowserRouter as Router, Routes, useNavigate, useParams } from "react-router-dom";
import YouTube from "react-youtube";
import { auth, db, firebaseConfigured, rtdb, storage } from "./firebase";

type AppUser = {
  uid: string;
  username: string;
  uniqueId: string;
  profileImage: string;
  bio: string;
  onlineStatus: boolean;
  friends: string[];
  friendRequests: string[];
  createdRooms: string[];
  joinedRooms: string[];
  createdAt?: unknown;
  lastActive?: unknown;
};

type RoomDoc = {
  roomId: string;
  hostId: string;
  roomName: string;
  participants: string[];
  invitedUids?: string[];
  kickedUids?: string[];
  visibility?: "public" | "private";
  roomPassword?: string;
  controllers?: string[];
  coHosts?: string[];
  moderators?: string[];
  theatreTheme?: "luxury" | "horror" | "anime" | "cyberpunk" | "retro";
  status: "open" | "closed";
  roomMode?: "video" | "theater";
  currentSource?: "youtube" | "upload";
  currentVideoUrl?: string;
  currentVideoTitle?: string;
  currentVideo?: string;
  currentTimestamp?: number;
  playbackState?: "playing" | "paused";
  createdAt?: unknown;
  closedAt?: unknown;
};

type RequestDoc = {
  id: string;
  fromUid: string;
  toUid: string;
  fromUniqueId: string;
  status: "pending" | "accepted" | "rejected";
};

type ChatMessage = {
  id: string;
  roomId: string;
  fromUid: string;
  fromName: string;
  text: string;
  createdAt?: unknown;
};

type NotificationDoc = {
  id: string;
  toUid: string;
  text: string;
  read: boolean;
  type?: "friendRequest" | "roomInvite";
  roomId?: string;
  fromUid?: string;
  fromName?: string;
  createdAt?: any;
};

type RoomRealtimeState = {
  currentVideo: string;
  currentTimestamp: number;
  playbackState: "playing" | "paused";
  roomMode?: "video" | "theater";
  subtitleText?: string;
  subtitleUpdatedAt?: number;
  controllers?: string[];
  coHosts?: string[];
  moderators?: string[];
  currentSource?: "youtube" | "upload";
  currentVideoUrl?: string;
  currentVideoTitle?: string;
  effects?: {
    papers?: Record<string, { actorUid: string; createdAt: number }>;
    shouts?: Record<string, { actorUid: string; createdAt: number }>;
    crowd?: Record<string, { actorUid: string; type: "cheer" | "laugh" | "scream" | "clap"; createdAt: number }>;
  };
  theatreTheme?: "luxury" | "horror" | "anime" | "cyberpunk" | "retro";
  hostId: string;
  participants: Record<string, { uid: string; username: string; online: boolean }>;
  reactions: Record<string, { emoji: string; sender: string; createdAt: number }>;
  typing: Record<string, { typing: boolean; name: string }>;
  syncEventId?: string;
  syncActorUid?: string;
  updatedAtMs?: number;
  lastUpdated?: number;
  closed?: boolean;
};

type RoomVideo = {
  id: string;
  roomId: string;
  name: string;
  url: string;
  uploaderUid: string;
  uploaderName: string;
  createdAt?: any;
};

type FeedbackItem = {
  id: string;
  uid: string;
  username: string;
  message: string;
  rating: number;
  page: string;
  createdAt?: any;
};

type YoutubeSearchResult = {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
};

const neonButton =
  "rounded-full bg-gradient-to-r from-cyan-300 to-indigo-300 px-5 py-2 text-sm font-semibold text-[#04111a] transition hover:from-cyan-200 hover:to-indigo-200";

const THEATER_SEATS = [
  { x: -2.35, z: -0.9 },
  { x: -1.18, z: -0.9 },
  { x: 0, z: -0.9 },
  { x: 1.18, z: -0.9 },
  { x: 2.35, z: -0.9 },
  { x: -2.35, z: 0.9 },
  { x: -1.18, z: 0.9 },
  { x: 0, z: 0.9 },
  { x: 1.18, z: 0.9 },
  { x: 2.35, z: 0.9 },
];

function extractVideoId(input: string) {
  const direct = input.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/);
  return direct?.[1] ?? input;
}

function parseRoomIdentifier(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      const roomIndex = parts.findIndex((part) => part === "room");
      if (roomIndex >= 0 && parts[roomIndex + 1]) {
        return parts[roomIndex + 1];
      }
    }
  } catch {
    // Fallback to raw value when parsing fails.
  }
  const slashParts = trimmed.split("/").filter(Boolean);
  return slashParts[slashParts.length - 1] || trimmed;
}

function formatClock(value: number) {
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function randomUniqueId(seed: string) {
  const cleaned = seed.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 9) || "sprint";
  return `@${cleaned}${Math.floor(10 + Math.random() * 899)}`;
}

async function ensureUserDoc(user: User) {
  const userRef = doc(db, "users", user.uid);
  const exists = await getDoc(userRef);
  if (exists.exists()) {
    return exists.data() as AppUser;
  }

  const username = user.displayName || user.email?.split("@")[0] || "Guest";
  const profile: AppUser = {
    uid: user.uid,
    username,
    uniqueId: randomUniqueId(username),
    profileImage: user.photoURL || "",
    bio: "Movie nights are better together.",
    onlineStatus: true,
    friends: [],
    friendRequests: [],
    createdRooms: [],
    joinedRooms: [],
    createdAt: serverTimestamp(),
    lastActive: serverTimestamp(),
  };
  await setDoc(userRef, profile);
  return profile;
}

function PresenceBridge({ uid }: { uid: string }) {
  useEffect(() => {
    const statusRef = ref(rtdb, `presence/${uid}`);
    const connectedRef = ref(rtdb, ".info/connected");
    const off = onValue(connectedRef, (snap) => {
      if (!snap.val()) {
        return;
      }
      onDisconnect(statusRef).set({ online: false, lastSeen: rtdbServerTimestamp(), currentlyWatching: null });
      set(statusRef, { online: true, lastSeen: rtdbServerTimestamp(), currentlyWatching: null });
      updateDoc(doc(db, "users", uid), { onlineStatus: true, lastActive: serverTimestamp() }).catch(() => null);
    });

    return () => {
      off();
      set(statusRef, { online: false, lastSeen: rtdbServerTimestamp(), currentlyWatching: null });
      updateDoc(doc(db, "users", uid), { onlineStatus: false, lastActive: serverTimestamp() }).catch(() => null);
    };
  }, [uid]);

  return null;
}

function TheaterRoom({ pulse, theme }: { pulse: number; theme: "luxury" | "horror" | "anime" | "cyberpunk" | "retro" }) {
  const screenRef = useRef<any>(null);
  const themePalette = {
    luxury: { ambient: "#ffe7b0", accent: "#d6b36a", seat: "#40311f", floor: "#1e1a14", back: "#0a0805" },
    horror: { ambient: "#b61f2f", accent: "#e13434", seat: "#2a1116", floor: "#150b0d", back: "#0a0304" },
    anime: { ambient: "#ff9de8", accent: "#8ec6ff", seat: "#2a2446", floor: "#14152d", back: "#0a0a1a" },
    cyberpunk: { ambient: "#6f7cff", accent: "#66d9ff", seat: "#232a41", floor: "#101420", back: "#0f1422" },
    retro: { ambient: "#f3b178", accent: "#ffd08b", seat: "#4a3528", floor: "#2a211a", back: "#150d08" },
  }[theme] || { ambient: "#6f7cff", accent: "#66d9ff", seat: "#232a41", floor: "#101420", back: "#0f1422" };
  useFrame(() => {
    if (screenRef.current) {
      screenRef.current.material.emissiveIntensity = 0.6 + pulse * 0.4;
    }
  });

  return (
    <>
      <Stars radius={70} depth={24} count={900} factor={3.2} saturation={0.8} />
      <ambientLight intensity={0.35} color={themePalette.ambient} />
      <pointLight position={[0, 2.5, -1]} intensity={5.2} color={themePalette.accent} />
      <pointLight position={[-3, 1.5, 1]} intensity={1.4} color="#c678ff" />
      <pointLight position={[3, 1.5, 1]} intensity={1.4} color="#7ff5ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
        <planeGeometry args={[14, 16]} />
        <meshStandardMaterial color={themePalette.floor} roughness={0.85} metalness={0.12} />
      </mesh>
      <mesh position={[0, 2.1, -5.1]}>
        <boxGeometry args={[9.8, 4.9, 0.26]} />
        <meshStandardMaterial color={themePalette.back} metalness={0.35} roughness={0.45} />
      </mesh>
      <mesh ref={screenRef} position={[-1, 1.7, -7.2]}>
        <boxGeometry args={[7.2, 3.2, 0.08]} />
        <meshStandardMaterial color="#90e8ff" emissive="#39cfff" />
      </mesh>

      {[-0.9, 0.9].map((rowZ) =>
        [-2.4, -1.2, 0, 1.2, 2.4].map((xPos) => (
          <mesh key={`${rowZ}-${xPos}`} position={[xPos, -0.05, rowZ]}>
            <boxGeometry args={[1.02, 0.34, 0.62]} />
            <meshStandardMaterial color={themePalette.seat} roughness={0.55} metalness={0.2} />
          </mesh>
        ))
      )}

    </>
  );
}

function TheaterRoomAvatars({
  participants,
  hostId,
}: {
  participants: Array<{ uid: string; username: string }>;
  hostId?: string;
}) {
  return (
    <>
      {participants.slice(0, 8).map((participant, index) => {
        const seat = THEATER_SEATS[index] || { x: 0, z: 0.9 };
        const isHostSeat = participant.uid === hostId;
        return (
          <group key={participant.uid} position={[seat.x, 0.28, seat.z]}>
            <mesh>
              <sphereGeometry args={[0.13, 24, 24]} />
              <meshStandardMaterial color={isHostSeat ? "#ffd17f" : "#8fdcff"} emissive={isHostSeat ? "#ffaf35" : "#3daaff"} emissiveIntensity={0.45} />
            </mesh>
            <mesh position={[0, -0.16, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 0.22, 16]} />
              <meshStandardMaterial color="#5f6f9b" />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function TheaterViewerCamera({ seatIndex }: { seatIndex: number }) {
  const { camera } = useThree();
  const seat = THEATER_SEATS[Math.max(0, seatIndex)] || THEATER_SEATS[2];
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);

  useEffect(() => {
    camera.position.set(seat.x, 0.78, seat.z + 0.45);
    camera.lookAt(-1, 1.6, -7.2);
    yawRef.current = camera.rotation.y;
    pitchRef.current = camera.rotation.x;
  }, [camera, seatIndex]);

  useEffect(() => {
    const handleStart = (clientX: number, clientY: number, target: HTMLElement | null) => {
      if (target?.closest("[data-ui-overlay='true']")) {
        return;
      }
      draggingRef.current = true;
      lastXRef.current = clientX;
      lastYRef.current = clientY;
    };

    const handleMove = (clientX: number, clientY: number) => {
      if (!draggingRef.current) {
        return;
      }
      const dx = clientX - lastXRef.current;
      const dy = clientY - lastYRef.current;
      lastXRef.current = clientX;
      lastYRef.current = clientY;
      yawRef.current -= dx * 0.003;
      pitchRef.current -= dy * 0.0026;
      pitchRef.current = Math.max(-0.55, Math.min(0.42, pitchRef.current));
    };

    const onMouseDown = (event: MouseEvent) => handleStart(event.clientX, event.clientY, event.target as HTMLElement | null);
    const onMouseMove = (event: MouseEvent) => handleMove(event.clientX, event.clientY);
    const onMouseUp = () => { draggingRef.current = false; };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches[0]) {
        handleStart(event.touches[0].clientX, event.touches[0].clientY, event.target as HTMLElement | null);
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches[0]) {
        handleMove(event.touches[0].clientX, event.touches[0].clientY);
      }
    };
    const onTouchEnd = () => { draggingRef.current = false; };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);

      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  useFrame(() => {
    camera.position.set(seat.x, 0.78, seat.z + 0.45);
    camera.rotation.order = "YXZ";
    camera.rotation.y = yawRef.current;
    camera.rotation.x = pitchRef.current;
  });

  return null;
}

function PaperBurst({ origin, startedAt }: { origin: { x: number; z: number }; startedAt: number }) {
  const groupRef = useRef<any>(null);
  const particles = useMemo(
    () =>
      Array.from({ length: 42 }).map((_, index) => ({
        id: index,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 1.5 + Math.random() * 2.1,
        vz: -2.2 - Math.random() * 2.4,
        rot: (Math.random() - 0.5) * 0.34,
        size: 0.06 + Math.random() * 0.1,
        sway: (Math.random() - 0.5) * 0.6,
        tone: Math.floor(Math.random() * 5),
      })),
    []
  );

  useFrame(() => {
    if (!groupRef.current) {
      return;
    }
    const t = Math.min(3.1, (Date.now() - startedAt) / 1000);
    groupRef.current.children.forEach((child: any, index: number) => {
      const p = particles[index];
      const x = origin.x + p.vx * t + Math.sin(t * 5 + index) * p.sway * 0.2;
      const y = 0.55 + p.vy * t - 0.92 * t * t;
      const z = origin.z + p.vz * t;
      child.position.set(x, Math.max(-0.2, y), z);
      child.rotation.x += p.rot;
      child.rotation.y += p.rot * 1.4;
      child.rotation.z += p.rot * 0.8;
      const mat = child.material as { opacity?: number };
      mat.opacity = Math.max(0.08, 1 - t / 3.1);
    });
  });

  return (
    <group ref={groupRef}>
      {particles.map((particle) => (
        <mesh key={particle.id}>
          <boxGeometry args={[particle.size, particle.size * 1.2, particle.size * 0.03]} />
          <meshStandardMaterial
            color={
              particle.tone === 0
                ? "#f8f3e8"
                : particle.tone === 1
                  ? "#fff8cf"
                  : particle.tone === 2
                    ? "#eceefe"
                    : particle.tone === 3
                      ? "#f5e2cb"
                      : "#e8f7ff"
            }
            emissive="#bfc9ff"
            emissiveIntensity={0.22}
            side={2}
            transparent
            opacity={1}
          />
        </mesh>
      ))}
    </group>
  );
}

function PaperBurstsLayer({
  bursts,
  seatMap,
}: {
  bursts: Array<{ id: string; actorUid: string; createdAt: number }>;
  seatMap: Record<string, { x: number; z: number }>;
}) {
  return (
    <>
      {bursts.map((burst) => (
        <PaperBurst key={burst.id} origin={seatMap[burst.actorUid] || { x: 0, z: 0.9 }} startedAt={burst.createdAt} />
      ))}
    </>
  );
}

type Toast = { id: number; text: string; tone: "info" | "success" | "error" };

type OverlayPaperPiece = {
  id: string;
  burstId: string;
  left: number;
  top: number;
  dx: number;
  dy: number;
  rotate: number;
  duration: number;
  delay: number;
  colorA: string;
  colorB: string;
  size: number;
};

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed right-4 top-20 z-[120] space-y-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            className={`rounded-xl px-4 py-2 text-sm backdrop-blur-sm ${
              toast.tone === "success"
                ? "bg-emerald-400/20 text-emerald-100"
                : toast.tone === "error"
                  ? "bg-rose-400/20 text-rose-100"
                  : "bg-cyan-400/20 text-cyan-100"
            }`}
          >
            {toast.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function PaperOverlay({ pieces }: { pieces: OverlayPaperPiece[] }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[440] overflow-hidden">
      <AnimatePresence>
        {pieces.map((piece) => (
          <motion.div
            key={piece.id}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.65 }}
            animate={{
              x: piece.dx,
              y: piece.dy,
              opacity: [0, 1, 1, 0],
              rotate: piece.rotate,
              scale: [0.7, 1, 1, 0.82],
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: piece.duration, delay: piece.delay, ease: "easeOut" }}
            className="absolute rounded-[2px] shadow-[0_0_12px_rgba(255,255,255,0.25)]"
            style={{
              left: `${piece.left}%`,
              top: `${piece.top}%`,
              width: `${piece.size}px`,
              height: `${piece.size * 1.26}px`,
              background: `linear-gradient(145deg, ${piece.colorA}, ${piece.colorB})`,
            }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04050b] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(76,104,255,0.5),transparent_42%),radial-gradient(circle_at_82%_5%,rgba(38,186,255,0.4),transparent_40%),linear-gradient(180deg,#02040a_0%,#04050b_45%,#090d1a_100%)]" />
      <motion.div
        className="absolute -left-24 top-16 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-[120px]"
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ duration: 8, repeat: Number.POSITIVE_INFINITY }}
      />
      <motion.div
        className="absolute -right-20 bottom-12 h-96 w-96 rounded-full bg-cyan-500/20 blur-[130px]"
        animate={{ x: [0, -20, 0], y: [0, 15, 0] }}
        transition={{ duration: 7, repeat: Number.POSITIVE_INFINITY }}
      />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16">
        <p className="text-sm tracking-[0.35em] text-cyan-300/80">SPRINT UP</p>
        <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-tight sm:text-6xl">
          Feel close even when you are worlds apart.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-white/75">
          Sprint Up is a futuristic social watch-together world with synced YouTube playback, live reactions, and emotional shared movie nights powered fully by Firebase.
        </p>
        <div className="mt-8 flex gap-3">
          <a href="/auth" className={neonButton}>
            Start Watching
          </a>
          <a href="/dashboard" className="rounded-full border border-white/20 bg-white/10 px-5 py-2 text-sm transition hover:bg-white/20">
            Enter Dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

function AuthPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      if (mode === "signup") {
        const creds = await createUserWithEmailAndPassword(auth, email, password);
        const generated = username || creds.user.email?.split("@")[0] || "viewer";
        await setDoc(doc(db, "users", creds.user.uid), {
          uid: creds.user.uid,
          username: generated,
          uniqueId: randomUniqueId(generated),
          profileImage: "",
          bio: "Movie nights are better together.",
          onlineStatus: true,
          friends: [],
          friendRequests: [],
          createdRooms: [],
          joinedRooms: [],
          createdAt: serverTimestamp(),
          lastActive: serverTimestamp(),
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      navigate("/dashboard");
    } catch (error) {
      setNotice((error as Error).message);
    }
  };

  return (
    <div className="min-h-screen bg-[#05060c] px-6 py-14 text-white">
      <div className="mx-auto grid w-full max-w-5xl gap-8 md:grid-cols-2">
        <div>
          <p className="text-sm tracking-[0.3em] text-cyan-300">SPRINT UP AUTH</p>
          <h2 className="mt-4 text-4xl font-semibold">Join your next emotional movie night.</h2>
          <p className="mt-4 text-white/70">Login with email, Google, or jump in as a guest in seconds.</p>
        </div>
        <form onSubmit={onSubmit} className="rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl">
          <div className="mb-4 flex gap-2 text-sm">
            <button type="button" onClick={() => setMode("login")} className={`rounded-full px-3 py-1 ${mode === "login" ? "bg-white/20" : "bg-white/5"}`}>
              Login
            </button>
            <button type="button" onClick={() => setMode("signup")} className={`rounded-full px-3 py-1 ${mode === "signup" ? "bg-white/20" : "bg-white/5"}`}>
              Signup
            </button>
          </div>
          {mode === "signup" && (
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              className="mb-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 outline-none"
            />
          )}
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            className="mb-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 outline-none"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            className="mb-4 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 outline-none"
          />
          <button className={`${neonButton} w-full`} type="submit">
            {mode === "signup" ? "Create account" : "Login"}
          </button>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <button
              type="button"
              className="rounded-full border border-white/20 bg-white/10 px-3 py-2"
              onClick={async () => {
                try {
                  const creds = await signInWithPopup(auth, new GoogleAuthProvider());
                  await ensureUserDoc(creds.user);
                  navigate("/dashboard");
                } catch (error) {
                  setNotice((error as Error).message);
                }
              }}
            >
              Google
            </button>
            <button
              type="button"
              className="rounded-full border border-white/20 bg-white/10 px-3 py-2"
              onClick={async () => {
                try {
                  const creds = await signInAnonymously(auth);
                  await ensureUserDoc(creds.user);
                  navigate("/dashboard");
                } catch (error) {
                  setNotice((error as Error).message);
                }
              }}
            >
              Guest
            </button>
          </div>
          <button
            type="button"
            className="mt-3 text-xs text-cyan-200"
            onClick={async () => {
              if (!email) {
                setNotice("Enter your email first.");
                return;
              }
              await sendPasswordResetEmail(auth, email);
              setNotice("Password reset email sent.");
            }}
          >
            Forgot password
          </button>
          {notice && <p className="mt-3 text-xs text-pink-200">{notice}</p>}
        </form>
      </div>
    </div>
  );
}

function Dashboard({ me }: { me: AppUser }) {
  const [rooms, setRooms] = useState<RoomDoc[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<AppUser[]>([]);
  const [requests, setRequests] = useState<RequestDoc[]>([]);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [queryId, setQueryId] = useState("");
  const [searchResult, setSearchResult] = useState<AppUser | null>(null);
  const [outgoingPending, setOutgoingPending] = useState<Record<string, boolean>>({});
  const [incomingPending, setIncomingPending] = useState<Record<string, boolean>>({});
  const [presenceMap, setPresenceMap] = useState<Record<string, { online: boolean; lastSeen?: number }>>({});
  const [joinRoomId, setJoinRoomId] = useState("");
  const [dashboardNotice, setDashboardNotice] = useState("");
  const [joiningRoom, setJoiningRoom] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [roomNameInput, setRoomNameInput] = useState("");
  const [roomVisibility, setRoomVisibility] = useState<"public" | "private">("public");
  const [roomPasswordInput, setRoomPasswordInput] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const navigate = useNavigate();

  const pushToast = (text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 2400);
  };

  useEffect(() => {
    const roomQ = query(collection(db, "rooms"), where("participants", "array-contains", me.uid), limit(12));
    const offRooms = onSnapshot(roomQ, (snap) => {
      setRooms(snap.docs.map((docSnap) => docSnap.data() as RoomDoc));
    });

    const reqQ = query(collection(db, "friendRequests"), where("toUid", "==", me.uid), where("status", "==", "pending"));
    const offReq = onSnapshot(reqQ, (snap) => {
      setRequests(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<RequestDoc, "id">),
        }))
      );
    });

    const outgoingQ = query(collection(db, "friendRequests"), where("fromUid", "==", me.uid), where("status", "==", "pending"));
    const offOutgoing = onSnapshot(outgoingQ, (snap) => {
      const pendingMap: Record<string, boolean> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as RequestDoc;
        pendingMap[data.toUid] = true;
      });
      setOutgoingPending(pendingMap);
    });

    const incomingQ = query(collection(db, "friendRequests"), where("toUid", "==", me.uid), where("status", "==", "pending"));
    const offIncoming = onSnapshot(incomingQ, (snap) => {
      const pendingMap: Record<string, boolean> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as RequestDoc;
        pendingMap[data.fromUid] = true;
      });
      setIncomingPending(pendingMap);
    });

    const notifQ = query(collection(db, "notifications"), where("toUid", "==", me.uid), limit(20));
    const offNotif = onSnapshot(notifQ, (snap) => {
      setNotifications(
        snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<NotificationDoc, "id">) }))
          .sort((a, b) => (a.read === b.read ? 0 : a.read ? 1 : -1))
      );
    });

    if (!me.friends.length) {
      setFriendProfiles([]);
      return () => {
        offRooms();
        offReq();
        offOutgoing();
        offIncoming();
        offNotif();
      };
    }

    const friendQ = query(collection(db, "users"), where("uid", "in", me.friends.slice(0, 10)));
    const offFriends = onSnapshot(friendQ, (snap) => {
      setFriendProfiles(snap.docs.map((d) => d.data() as AppUser));
    });

    const presenceUnsubs = me.friends.slice(0, 25).map((friendUid) =>
      onValue(ref(rtdb, `presence/${friendUid}`), (presenceSnap) => {
        const val = presenceSnap.val() as { online?: boolean; lastSeen?: number } | null;
        setPresenceMap((prev) => ({
          ...prev,
          [friendUid]: { online: Boolean(val?.online), lastSeen: val?.lastSeen },
        }));
      })
    );

    return () => {
      offRooms();
      offReq();
      offOutgoing();
      offIncoming();
      offNotif();
      offFriends();
      presenceUnsubs.forEach((unsub) => unsub());
    };
  }, [me.uid, me.friends]);

  const createRoom = async () => {
    if (roomVisibility === "private" && roomPasswordInput.trim().length < 4) {
      pushToast("Private rooms need a password with at least 4 characters.", "error");
      return;
    }
    const roomRef = doc(collection(db, "rooms"));
    const payload: RoomDoc = {
      roomId: roomRef.id,
      hostId: me.uid,
      roomName: roomNameInput.trim() || `${me.username}'s Room`,
      participants: [me.uid],
      invitedUids: [],
      kickedUids: [],
      controllers: [],
      coHosts: [],
      moderators: [],
      visibility: roomVisibility,
      roomPassword: roomVisibility === "private" ? roomPasswordInput.trim() : "",
      status: "open",
      roomMode: "video",
      theatreTheme: "cyberpunk",
      currentSource: "youtube",
      currentVideoUrl: "",
      currentVideoTitle: "",
      currentVideo: "dQw4w9WgXcQ",
      currentTimestamp: 0,
      playbackState: "paused",
      createdAt: serverTimestamp(),
    };
    await setDoc(roomRef, payload);
    await updateDoc(doc(db, "users", me.uid), { createdRooms: arrayUnion(roomRef.id), joinedRooms: arrayUnion(roomRef.id) });
    await set(ref(rtdb, `rooms/${roomRef.id}`), {
      currentVideo: "dQw4w9WgXcQ",
      currentTimestamp: 0,
      playbackState: "paused",
      roomMode: "video",
      theatreTheme: "cyberpunk",
      currentSource: "youtube",
      currentVideoUrl: "",
      currentVideoTitle: "",
      subtitleText: "",
      subtitleUpdatedAt: Date.now(),
      controllers: [],
      coHosts: [],
      moderators: [],
      hostId: me.uid,
      syncActorUid: me.uid,
      participants: {
        [me.uid]: { uid: me.uid, username: me.username, online: true },
      },
      reactions: {},
      typing: {},
      syncEventId: `init-${Date.now()}`,
      updatedAtMs: Date.now(),
      lastUpdated: rtdbServerTimestamp(),
    });
    setShowCreateRoom(false);
    setRoomNameInput("");
    setRoomVisibility("public");
    setRoomPasswordInput("");
    navigate(`/room/${roomRef.id}`);
  };

  const joinRoom = async (incomingRoomId?: string, bypassPassword = false) => {
    const targetRoomId = parseRoomIdentifier(incomingRoomId || joinRoomId);
    if (!targetRoomId) {
      setDashboardNotice("Enter a room ID or invite link.");
      return;
    }
    setJoiningRoom(true);
    try {
      const roomRef = doc(db, "rooms", targetRoomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        setDashboardNotice("Room not found. Check the room ID or invite link.");
        return;
      }

      const roomData = roomSnap.data() as RoomDoc;
      if (roomData.status === "closed") {
        setDashboardNotice("This room was closed by the host.");
        return;
      }
      if (roomData.kickedUids?.includes(me.uid)) {
        setDashboardNotice("Host removed you from this room.");
        return;
      }
      if (roomData.visibility === "private" && !bypassPassword) {
        const entered = window.prompt("Enter room password");
        if (!entered || entered !== (roomData.roomPassword || "")) {
          setDashboardNotice("Incorrect room password.");
          return;
        }
      }

      await updateDoc(roomRef, { participants: arrayUnion(me.uid) }).catch(() => null);
      await updateDoc(doc(db, "users", me.uid), { joinedRooms: arrayUnion(targetRoomId) }).catch(() => null);
      setDashboardNotice("Joining room...");
      pushToast("Joining room...", "success");
      setJoinRoomId(targetRoomId);
      navigate(`/room/${targetRoomId}`);
    } catch {
      setDashboardNotice("Unable to join right now. Please try again.");
    } finally {
      setJoiningRoom(false);
    }
  };

  const sendFriendRequest = async () => {
    if (!searchResult || searchResult.uid === me.uid) {
      return;
    }
    if (me.friends.includes(searchResult.uid) || outgoingPending[searchResult.uid] || incomingPending[searchResult.uid]) {
      return;
    }
    await addDoc(collection(db, "friendRequests"), {
      fromUid: me.uid,
      toUid: searchResult.uid,
      fromUniqueId: me.uniqueId,
      status: "pending",
      createdAt: serverTimestamp(),
    });
    await addDoc(collection(db, "notifications"), {
      toUid: searchResult.uid,
      text: `${me.uniqueId} sent you a friend request`,
      createdAt: serverTimestamp(),
      read: false,
    });
    setOutgoingPending((prev) => ({ ...prev, [searchResult.uid]: true }));
    pushToast("Friend request sent.", "success");
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim()) {
      return;
    }
    setSendingFeedback(true);
    try {
      await addDoc(collection(db, "feedback"), {
        uid: me.uid,
        username: me.username,
        message: feedbackText.trim(),
        rating: feedbackRating,
        page: "dashboard",
        createdAt: serverTimestamp(),
      });
      setFeedbackText("");
      setFeedbackRating(5);
      pushToast("Feedback sent. Thank you!", "success");
    } catch {
      pushToast("Could not send feedback.", "error");
    } finally {
      setSendingFeedback(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#05060d] px-4 py-6 text-white sm:px-6">
      <ToastStack toasts={toasts} />
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-cyan-300 text-xs font-bold text-[#04131c]">GZ</div>
              <p className="text-sm tracking-[0.25em] text-cyan-300">GOLDEN Z VISION</p>
            </div>
            <h1 className="text-3xl font-semibold">Dashboard</h1>
            <p className="text-sm text-white/65">Welcome back {me.username}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate(`/profile/${me.uid}`)} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm">
              Profile
            </button>
            <button onClick={() => navigate("/rooms")} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm">
              Recent Rooms
            </button>
            <button onClick={() => setShowCreateRoom(true)} className={neonButton}>
              Create Room
            </button>
          </div>
        </div>

        {showCreateRoom && (
          <div className="mb-6 rounded-3xl border border-white/15 bg-black/40 p-4 backdrop-blur-xl">
            <h3 className="text-lg font-semibold">Create Room</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <input
                value={roomNameInput}
                onChange={(event) => setRoomNameInput(event.target.value)}
                placeholder="Room name"
                className="rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRoomVisibility("public")}
                  className={`rounded-full px-3 py-1.5 text-xs ${roomVisibility === "public" ? "bg-cyan-300 text-[#03121a]" : "bg-white/10"}`}
                >
                  Public
                </button>
                <button
                  onClick={() => setRoomVisibility("private")}
                  className={`rounded-full px-3 py-1.5 text-xs ${roomVisibility === "private" ? "bg-cyan-300 text-[#03121a]" : "bg-white/10"}`}
                >
                  Private
                </button>
              </div>
            </div>
            {roomVisibility === "private" && (
              <input
                value={roomPasswordInput}
                onChange={(event) => setRoomPasswordInput(event.target.value)}
                type="password"
                placeholder="Set room password"
                className="mt-3 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm"
              />
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={createRoom} className={neonButton}>
                Create Now
              </button>
              <button
                onClick={() => {
                  setShowCreateRoom(false);
                  setRoomNameInput("");
                  setRoomPasswordInput("");
                  setRoomVisibility("public");
                }}
                className="rounded-full bg-white/10 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr_1fr]">
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl">
            <h2 className="font-semibold">Friends Online</h2>
            <div className="mt-3 space-y-2">
              {friendProfiles.map((friend) => (
                <div key={friend.uid} className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2 text-sm">
                  <span>{friend.username}</span>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${presenceMap[friend.uid]?.online ?? friend.onlineStatus ? "bg-emerald-400" : "bg-zinc-500"}`} />
                    <button
                      className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]"
                      onClick={async () => {
                        const confirmed = window.confirm(`Remove ${friend.username} from your friends list?`);
                        if (!confirmed) {
                          return;
                        }
                        await updateDoc(doc(db, "users", me.uid), { friends: arrayRemove(friend.uid) });
                        await updateDoc(doc(db, "users", friend.uid), { friends: arrayRemove(me.uid) });
                        pushToast(`${friend.username} removed from friends.`, "success");
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {!friendProfiles.length && <p className="text-sm text-white/55">No friends yet.</p>}
            </div>

            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-sm">Search by Unique ID</p>
              <input
                value={queryId}
                onChange={(event) => setQueryId(event.target.value)}
                placeholder="@cineghost77"
                className="mt-2 w-full rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
              />
              <button
                onClick={async () => {
                  const userQ = query(collection(db, "users"), where("uniqueId", "==", queryId.trim()), limit(1));
                  const found = await getDocs(userQ);
                  setSearchResult(found.docs.length ? (found.docs[0].data() as AppUser) : null);
                }}
                className="mt-2 rounded-full bg-white/15 px-3 py-1.5 text-xs"
              >
                Search
              </button>

              {searchResult && (
                <div className="mt-2 rounded-xl bg-white/5 p-3 text-sm">
                  <p>
                    {searchResult.username} <span className="text-white/60">{searchResult.uniqueId}</span>
                  </p>
                  {me.friends.includes(searchResult.uid) ? (
                    <span className="mt-2 inline-block rounded-full bg-emerald-300/20 px-3 py-1 text-xs text-emerald-200">Already Friends</span>
                  ) : incomingPending[searchResult.uid] ? (
                    <span className="mt-2 inline-block rounded-full bg-amber-300/20 px-3 py-1 text-xs text-amber-100">Incoming Request Pending</span>
                  ) : outgoingPending[searchResult.uid] ? (
                    <span className="mt-2 inline-block rounded-full bg-cyan-300/20 px-3 py-1 text-xs text-cyan-100">Friend Request Sent</span>
                  ) : (
                    <button onClick={sendFriendRequest} className="mt-2 rounded-full bg-cyan-300 px-3 py-1 text-xs text-[#05111a]">
                      Send Friend Request
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-sm">Join Room</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={joinRoomId}
                    onChange={(event) => setJoinRoomId(event.target.value)}
                    placeholder="Paste room ID or invite link"
                    className="flex-1 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={() => joinRoom()}
                    className="rounded-full bg-cyan-300 px-3 py-1 text-xs text-[#04121a] disabled:cursor-not-allowed disabled:opacity-70"
                    disabled={joiningRoom}
                  >
                    {joiningRoom ? "Joining..." : "Join"}
                  </button>
                </div>
                {dashboardNotice && <p className="mt-2 text-xs text-amber-200">{dashboardNotice}</p>}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h2 className="font-semibold">Friend Requests</h2>
            <div className="mt-3 space-y-2">
              {requests.map((request) => (
                <div key={request.id} className="rounded-xl bg-black/30 p-3 text-sm">
                  <p>{request.fromUniqueId} wants to connect.</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-full bg-emerald-300 px-3 py-1 text-xs text-[#02170f]"
                      onClick={async () => {
                        await updateDoc(doc(db, "friendRequests", request.id), { status: "accepted" });
                        await updateDoc(doc(db, "users", me.uid), { friends: arrayUnion(request.fromUid) });
                        await updateDoc(doc(db, "users", request.fromUid), { friends: arrayUnion(me.uid) });
                        await addDoc(collection(db, "notifications"), {
                          toUid: request.fromUid,
                          text: `${me.uniqueId} accepted your request`,
                          createdAt: serverTimestamp(),
                          read: false,
                        });
                      }}
                    >
                      Accept
                    </button>
                    <button
                      className="rounded-full bg-white/15 px-3 py-1 text-xs"
                      onClick={() => updateDoc(doc(db, "friendRequests", request.id), { status: "rejected" })}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              {!requests.length && <p className="text-sm text-white/55">No pending requests.</p>}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h2 className="font-semibold">Activity</h2>
            <p className="mt-2 text-sm text-white/65">You are currently in {rooms.length} room(s). Open Recent Rooms for a dedicated room layout.</p>
            <h3 className="mt-5 font-semibold">Invites</h3>
            <div className="mt-3 space-y-2">
              {notifications
                .filter((item) => item.type === "roomInvite" && item.roomId)
                .map((item) => (
                  <div key={item.id} className="rounded-xl bg-black/30 p-3 text-sm">
                    <p>{item.text}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded-full bg-cyan-300 px-3 py-1 text-xs text-[#03121a]"
                        onClick={async () => {
                          if (item.roomId) {
                            await joinRoom(item.roomId, true);
                            await deleteDoc(doc(db, "notifications", item.id));
                          }
                        }}
                      >
                        Join Invite
                      </button>
                      <button className="rounded-full bg-white/15 px-3 py-1 text-xs" onClick={() => deleteDoc(doc(db, "notifications", item.id))}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              {!notifications.some((item) => item.type === "roomInvite" && item.roomId && !item.read) && (
                <p className="text-sm text-white/55">No active room invites.</p>
              )}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-4">
          <h2 className="font-semibold">Golden Z Vision Feedback</h2>
          <p className="mt-1 text-sm text-white/65">Share your experience so we can improve Sprint Up.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="text-xs text-white/70">Rating</label>
            <input
              type="range"
              min={1}
              max={10}
              value={feedbackRating}
              onChange={(event) => setFeedbackRating(Number(event.target.value))}
              className="w-44 accent-cyan-300"
            />
            <span className="text-sm text-cyan-200">{feedbackRating}/10</span>
          </div>
          <textarea
            value={feedbackText}
            onChange={(event) => setFeedbackText(event.target.value)}
            className="mt-3 h-24 w-full rounded-2xl border border-white/15 bg-black/30 px-3 py-2 text-sm"
            placeholder="Tell us what you love and what should be better..."
          />
          <button onClick={submitFeedback} disabled={sendingFeedback} className="mt-3 rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#04131c]">
            {sendingFeedback ? "Sending..." : "Send Feedback"}
          </button>
        </section>
      </div>
    </div>
  );
}

function RecentRoomsPage({ me }: { me: AppUser }) {
  const [rooms, setRooms] = useState<RoomDoc[]>([]);
  const [notice, setNotice] = useState("");
  const [joiningRoomId, setJoiningRoomId] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    const roomQ = query(collection(db, "rooms"), where("participants", "array-contains", me.uid), limit(30));
    const offRooms = onSnapshot(roomQ, (snap) => {
      setRooms(
        snap.docs
          .map((docSnap) => docSnap.data() as RoomDoc)
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      );
    });
    return () => offRooms();
  }, [me.uid]);

  const openRoom = async (roomId: string) => {
    setJoiningRoomId(roomId);
    try {
      const roomRef = doc(db, "rooms", roomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        setNotice("Room no longer exists.");
        return;
      }
      const roomData = roomSnap.data() as RoomDoc;
      if (roomData.status === "closed") {
        setNotice("This room is closed.");
        return;
      }
      if (roomData.kickedUids?.includes(me.uid)) {
        setNotice("Host removed you from this room.");
        return;
      }
      if (roomData.visibility === "private") {
        const entered = window.prompt("Enter room password");
        if (!entered || entered !== (roomData.roomPassword || "")) {
          setNotice("Incorrect room password.");
          return;
        }
      }
      await updateDoc(roomRef, { participants: arrayUnion(me.uid) }).catch(() => null);
      await updateDoc(doc(db, "users", me.uid), { joinedRooms: arrayUnion(roomId) }).catch(() => null);
      navigate(`/room/${roomId}`);
    } finally {
      setJoiningRoomId("");
    }
  };

  return (
    <div className="min-h-screen bg-[#04060e] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm tracking-[0.3em] text-cyan-300">SPRINT UP</p>
            <h1 className="text-3xl font-semibold">Recent Rooms</h1>
            <p className="text-sm text-white/65">Open any room and continue watching with your friends.</p>
          </div>
          <button className="rounded-full bg-white/10 px-4 py-2 text-sm" onClick={() => navigate("/dashboard")}>
            Back
          </button>
        </div>

        {notice && <p className="mb-4 rounded-xl bg-amber-300/15 px-3 py-2 text-sm text-amber-100">{notice}</p>}

        <div className="grid gap-3">
          {rooms.map((room) => (
            <button
              key={room.roomId}
              className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:bg-white/10"
              onClick={() => openRoom(room.roomId)}
              disabled={room.status === "closed" || joiningRoomId === room.roomId}
            >
              <div>
                <p className="font-medium">{room.roomName}</p>
                <p className="text-xs text-white/55">Room ID: {room.roomId}</p>
              </div>
              <span className="text-sm text-cyan-200">{room.status === "closed" ? "Closed" : joiningRoomId === room.roomId ? "Opening..." : "Open"}</span>
            </button>
          ))}
          {!rooms.length && <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/65">No recent rooms yet.</p>}
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ me }: { me: AppUser }) {
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const feedbackQ = query(collection(db, "feedback"), limit(200));
    const unsub = onSnapshot(feedbackQ, (snap) => {
      const items = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<FeedbackItem, "id">) }))
        .sort((a, b) => {
          const aMs = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
          const bMs = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
          return bMs - aMs;
        });
      setFeedbacks(items);
    });
    return () => unsub();
  }, []);

  return (
    <div className="min-h-screen bg-[#06070f] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-cyan-300 text-xs font-bold text-[#04131c]">GZ</div>
              <p className="text-sm tracking-[0.25em] text-cyan-300">GOLDEN Z VISION</p>
            </div>
            <h1 className="text-3xl font-semibold">Admin Feedback Dashboard</h1>
            <p className="text-sm text-white/65">Viewing as {me.username}</p>
          </div>
          <button className="rounded-full bg-white/10 px-4 py-2 text-sm" onClick={() => navigate("/dashboard")}>
            Back
          </button>
        </div>

        <div className="grid gap-3">
          {feedbacks.map((feedback) => (
            <div key={feedback.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-cyan-200">{feedback.username}</span>
                <span className="text-white/60">Rating: {feedback.rating}/10</span>
              </div>
              <p className="text-sm text-white/80">{feedback.message}</p>
            </div>
          ))}
          {!feedbacks.length && <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/65">No feedback yet.</p>}
        </div>
      </div>
    </div>
  );
}

function ProfilePage({ me }: { me: AppUser }) {
  const { uid } = useParams();
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [historyRooms, setHistoryRooms] = useState<RoomDoc[]>([]);

  useEffect(() => {
    const targetUid = uid || me.uid;
    const unsub = onSnapshot(doc(db, "users", targetUid), (snap) => {
      if (snap.exists()) {
        setProfile(snap.data() as AppUser);
      }
    });

    const roomQ = query(collection(db, "rooms"), where("participants", "array-contains", targetUid), limit(20));
    const offRooms = onSnapshot(roomQ, (snap) => setHistoryRooms(snap.docs.map((d) => d.data() as RoomDoc)));
    return () => {
      unsub();
      offRooms();
    };
  }, [uid, me.uid]);

  if (!profile) {
    return <div className="min-h-screen bg-[#060711] p-6 text-white">Loading profile...</div>;
  }

  return (
    <div className="min-h-screen bg-[#05060d] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-4xl rounded-3xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/70 to-indigo-400/70 text-2xl font-semibold text-[#04131c]">
            {profile.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{profile.username}</h1>
            <p className="text-sm text-cyan-200">{profile.uniqueId}</p>
            <p className="text-sm text-white/70">{profile.bio}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-black/30 p-4 text-center">
            <p className="text-2xl font-semibold">{profile.friends.length}</p>
            <p className="text-xs text-white/60">Friends</p>
          </div>
          <div className="rounded-2xl bg-black/30 p-4 text-center">
            <p className="text-2xl font-semibold">{profile.joinedRooms.length}</p>
            <p className="text-xs text-white/60">Joined Rooms</p>
          </div>
          <div className="rounded-2xl bg-black/30 p-4 text-center">
            <p className="text-2xl font-semibold">{historyRooms.length}</p>
            <p className="text-xs text-white/60">Watch History</p>
          </div>
        </div>

        <h2 className="mt-7 text-lg font-semibold">Recent Watch Rooms</h2>
        <div className="mt-3 grid gap-2">
          {historyRooms.map((room) => (
            <div key={room.roomId} className="rounded-xl bg-black/30 px-3 py-2 text-sm">
              {room.roomName}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WatchRoom({ me }: { me: AppUser }) {
  const { roomId = "" } = useParams();
  const [roomState, setRoomState] = useState<RoomRealtimeState | null>(null);
  const [roomDoc, setRoomDoc] = useState<RoomDoc | null>(null);
  const [youtubeInput, setYoutubeInput] = useState("dQw4w9WgXcQ");
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [floatReactions, setFloatReactions] = useState<{ id: string; emoji: string; sender: string }[]>([]);
  const [friendProfiles, setFriendProfiles] = useState<AppUser[]>([]);
  const [sentInviteMap, setSentInviteMap] = useState<Record<string, number>>({});
  const [syncing, setSyncing] = useState(false);
  const [roomClosing, setRoomClosing] = useState(false);
  const [copyingInvite, setCopyingInvite] = useState(false);
  const [invitingUid, setInvitingUid] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingVideos, setSearchingVideos] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<YoutubeSearchResult[]>([]);
  const [searchNotice, setSearchNotice] = useState("");
  const [uploadedVideos, setUploadedVideos] = useState<RoomVideo[]>([]);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [paperBursts, setPaperBursts] = useState<Array<{ id: string; actorUid: string; createdAt: number }>>([]);
  const [overlayPaperPieces, setOverlayPaperPieces] = useState<OverlayPaperPiece[]>([]);
  const [lastThrowAt, setLastThrowAt] = useState(0);
  const [theaterHudCollapsed, setTheaterHudCollapsed] = useState(false);
  const playedShoutIdsRef = useRef<Set<string>>(new Set());
  const processedPaperBurstIdsRef = useRef<Set<string>>(new Set());
  const [subtitleInput, setSubtitleInput] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [timelineTime, setTimelineTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const navigate = useNavigate();
  const playerRef = useRef<any>(null);
  const appliedEventRef = useRef<string>("");
  const suppressStateRef = useRef(false);
  const inputDirtyRef = useRef(false);
  const accessCheckedRef = useRef(false);
  const hostPrevTimeRef = useRef<number>(0);
  const lastFirestorePersistRef = useRef<number>(0);
  const hostHasInitiallySyncedRef = useRef(false);
  const isHostRef = useRef(false);
  const participantIdsRef = useRef<string[]>([]);

  const isHost = roomDoc?.hostId === me.uid;
  const videoId = extractVideoId(roomState?.currentVideo || youtubeInput);
  const participantIds = new Set(Object.keys(roomState?.participants || {}));
  const orderedParticipants = useMemo(() => {
    const participantsMap = roomState?.participants || {};
    const order = roomDoc?.participants || [];
    const merged = Array.from(new Set([roomDoc?.hostId, ...order, ...Object.keys(participantsMap)].filter(Boolean) as string[]));
    return merged
      .map((uid) => participantsMap[uid])
      .filter(Boolean)
      .map((item) => ({ uid: item.uid, username: item.username }));
  }, [roomDoc?.hostId, roomDoc?.participants, roomState?.participants]);
  const mySeatIndex = Math.max(0, orderedParticipants.findIndex((participant) => participant.uid === me.uid));
  const roomMode = roomState?.roomMode || roomDoc?.roomMode || "video";
  const theatreTheme = roomState?.theatreTheme || roomDoc?.theatreTheme || "cyberpunk";
  const currentSource = roomState?.currentSource || "youtube";
  const currentVideoUrl = roomState?.currentVideoUrl || "";
  const canControlPlayback = true;
  const canSeekTimeline = true;
  const canLoadVideo = true;
  const canEditSubtitles = true;
  const theaterPulse = useMemo(() => 0.6 + Math.sin(Date.now() / 700) * 0.3, [roomState?.updatedAtMs]);
  const seatMapByUid = useMemo(() => {
    const map: Record<string, { x: number; z: number }> = {};
    orderedParticipants.forEach((participant, index) => {
      map[participant.uid] = THEATER_SEATS[index] || { x: 0, z: 0.9 };
    });
    return map;
  }, [orderedParticipants]);

  useEffect(() => {
    isHostRef.current = Boolean(isHost);
    participantIdsRef.current = Object.keys(roomState?.participants || {});
  }, [isHost, roomState?.participants]);

  const pushToast = (text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 2600);
  };

  const syncPlayerToRoomState = (forceSeek = false) => {
    if (!playerRef.current || !roomState) {
      return;
    }

    const player = playerRef.current;
    const remoteTimeBase = Number(roomState.currentTimestamp || 0);
    const remoteTime =
      roomState.playbackState === "playing" && roomState.updatedAtMs
        ? remoteTimeBase + (Date.now() - roomState.updatedAtMs) / 1000
        : remoteTimeBase;
    const localTime = player.getCurrentTime?.() || 0;
    const drift = Math.abs(remoteTime - localTime);

    if (forceSeek || drift > 1.2) {
      setSyncing(true);
      suppressStateRef.current = true;
      player.seekTo?.(remoteTime, true);
      window.setTimeout(() => {
        suppressStateRef.current = false;
        setSyncing(false);
      }, 800);
    }

    if (roomState.playbackState === "playing") {
      player.playVideo?.();
    } else {
      player.pauseVideo?.();
    }
  };

  const playShoutSound = () => {
    const src = (import.meta.env.VITE_SHOUT_SOUND as string | undefined) || "/sounds/shout.mp3";
    const base = new Audio(src);
    base.volume = 0.95;
    const audio = base.cloneNode(true) as HTMLAudioElement;
    audio.play().catch(() => null);
  };

  const playCrowdSound = (type: "cheer" | "laugh" | "scream" | "clap") => {
    const map = {
      cheer: (import.meta.env.VITE_CROWD_CHEER_SOUND as string | undefined) || "/sounds/cheer.mp3",
      laugh: (import.meta.env.VITE_CROWD_LAUGH_SOUND as string | undefined) || "/sounds/laugh.mp3",
      scream: (import.meta.env.VITE_CROWD_SCREAM_SOUND as string | undefined) || "/sounds/scream.mp3",
      clap: (import.meta.env.VITE_CROWD_CLAP_SOUND as string | undefined) || "/sounds/clap.mp3",
    } as const;
    const base = new Audio(map[type]);
    base.volume = 0.8;
    const audio = base.cloneNode(true) as HTMLAudioElement;
    audio.play().catch(() => null);
  };

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const roomDocRef = doc(db, "rooms", roomId);
    const unsubRoomDoc = onSnapshot(roomDocRef, async (snap) => {
      if (!snap.exists()) {
        navigate("/dashboard");
        return;
      }
      const data = snap.data() as RoomDoc;
      setRoomDoc(data);
      if (data.status === "closed") {
        setRoomClosing(true);
      }
      if (data.kickedUids?.includes(me.uid)) {
        pushToast("Host removed you from this room.", "error");
        navigate("/dashboard");
        return;
      }
      if (!data.participants.includes(me.uid)) {
        if (!accessCheckedRef.current) {
          accessCheckedRef.current = true;
          if (data.visibility === "private" && !data.invitedUids?.includes(me.uid)) {
            const entered = window.prompt("Enter room password");
            if (!entered || entered !== (data.roomPassword || "")) {
              pushToast("Incorrect room password.", "error");
              navigate("/dashboard");
              return;
            }
          }
        }
        await updateDoc(roomDocRef, { participants: arrayUnion(me.uid) }).catch(() => null);
        await updateDoc(doc(db, "users", me.uid), { joinedRooms: arrayUnion(roomId) }).catch(() => null);
      }

      const roomStateRef = ref(rtdb, `rooms/${roomId}`);
      const realtimeSnapshot = await get(roomStateRef);
      if (!realtimeSnapshot.exists() && data.status === "open") {
        await set(roomStateRef, {
          currentVideo: data.currentVideo || "dQw4w9WgXcQ",
          currentTimestamp: data.currentTimestamp || 0,
          playbackState: data.playbackState || "paused",
          roomMode: data.roomMode || "video",
          theatreTheme: data.theatreTheme || "cyberpunk",
          currentSource: (data as any).currentSource || "youtube",
          currentVideoUrl: (data as any).currentVideoUrl || "",
          currentVideoTitle: (data as any).currentVideoTitle || "",
          subtitleText: "",
          subtitleUpdatedAt: Date.now(),
          controllers: data.controllers || [],
          coHosts: data.coHosts || [],
          moderators: data.moderators || [],
          hostId: data.hostId,
          syncActorUid: data.hostId,
          participants: {
            [me.uid]: { uid: me.uid, username: me.username, online: true },
          },
          reactions: {},
          typing: {},
          syncEventId: `restore-${Date.now()}`,
          updatedAtMs: Date.now(),
          lastUpdated: Date.now(),
          closed: false,
        } satisfies RoomRealtimeState);
      }
    });

    const stateRef = ref(rtdb, `rooms/${roomId}`);
    const unsubState = onValue(stateRef, (snap) => {
      const data = snap.val();
      if (!data) {
        return;
      }
      const nextState = data as RoomRealtimeState;
      setRoomState(nextState);
      if (!inputDirtyRef.current) {
        setYoutubeInput(nextState.currentVideo || "");
      }
    });

    const reactionsRef = ref(rtdb, `rooms/${roomId}/reactions`);
    const unsubReactions = onValue(reactionsRef, (snap) => {
      const vals = snap.val() || {};
      const items = Object.entries(vals).map(([id, value]) => ({ id, ...(value as { emoji: string; sender: string; createdAt: number }) }));
      const now = Date.now();
      setFloatReactions(items.filter((item) => now - item.createdAt < 5000));
    });

    const typingRef = ref(rtdb, `rooms/${roomId}/typing`);
    const unsubTyping = onValue(typingRef, (snap) => {
      const vals = snap.val() || {};
      const active = Object.entries(vals)
        .filter(([uid, value]) => uid !== me.uid && (value as any).typing)
        .map(([, value]) => (value as any).name as string);
      setTypingUsers(active);
    });

    const msgQ = query(collection(db, "messages"), where("roomId", "==", roomId), limit(100));
    const unsubMsgs = onSnapshot(msgQ, (snap) => {
      const sorted = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, "id">) }))
        .sort((a, b) => String((a.createdAt as any)?.seconds || 0).localeCompare(String((b.createdAt as any)?.seconds || 0)));
      setMessages(sorted);
    });

    const roomVideosQ = query(collection(db, "roomVideos"), where("roomId", "==", roomId), limit(40));
    const unsubRoomVideos = onSnapshot(roomVideosQ, (snap) => {
      const items = snap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<RoomVideo, "id">) }))
        .sort((a, b) => {
          const aMs = typeof a.createdAt?.toMillis === "function" ? a.createdAt.toMillis() : 0;
          const bMs = typeof b.createdAt?.toMillis === "function" ? b.createdAt.toMillis() : 0;
          return bMs - aMs;
        });
      setUploadedVideos(items);
    });

    const papersRef = ref(rtdb, `rooms/${roomId}/effects/papers`);
    const unsubPapers = onValue(papersRef, (snap) => {
      const value = (snap.val() || {}) as Record<string, { actorUid: string; createdAt: number }>;
      const now = Date.now();
      const active = Object.entries(value)
        .map(([id, payload]) => ({ id, actorUid: payload.actorUid, createdAt: payload.createdAt }))
        .filter((item) => now - item.createdAt < 3200);
      setPaperBursts(active);
    });

    const shoutsRef = ref(rtdb, `rooms/${roomId}/effects/shouts`);
    const unsubShouts = onValue(shoutsRef, (snap) => {
      const value = (snap.val() || {}) as Record<string, { actorUid: string; createdAt: number }>;
      Object.entries(value).forEach(([id, payload]) => {
        if (Date.now() - payload.createdAt > 4500) {
          return;
        }
        if (!playedShoutIdsRef.current.has(id)) {
          playedShoutIdsRef.current.add(id);
          if (payload.actorUid === me.uid && Date.now() - payload.createdAt < 1200) {
            return;
          }
          playShoutSound();
        }
      });
    });

    const crowdRef = ref(rtdb, `rooms/${roomId}/effects/crowd`);
    const unsubCrowd = onValue(crowdRef, (snap) => {
      const value = (snap.val() || {}) as Record<string, { actorUid: string; type: "cheer" | "laugh" | "scream" | "clap"; createdAt: number }>;
      Object.entries(value).forEach(([id, payload]) => {
        if (Date.now() - payload.createdAt > 5000) {
          return;
        }
        const key = `crowd-${id}`;
        if (!playedShoutIdsRef.current.has(key)) {
          playedShoutIdsRef.current.add(key);
          playCrowdSound(payload.type);
        }
      });
    });

    if (me.friends.length > 0) {
      const friendQ = query(collection(db, "users"), where("uid", "in", me.friends.slice(0, 10)));
      onSnapshot(friendQ, (snap) => {
        setFriendProfiles(snap.docs.map((docSnap) => docSnap.data() as AppUser));
      });
    } else {
      setFriendProfiles([]);
    }

    const sentInviteQ = query(
      collection(db, "notifications"),
      where("type", "==", "roomInvite"),
      where("roomId", "==", roomId),
      where("fromUid", "==", me.uid)
    );
    const unsubSentInvites = onSnapshot(sentInviteQ, (snap) => {
      const sentMap: Record<string, number> = {};
      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as NotificationDoc;
        if (data.toUid) {
          const createdMs = typeof data.createdAt?.toMillis === "function" ? data.createdAt.toMillis() : Date.now();
          sentMap[data.toUid] = Math.max(sentMap[data.toUid] || 0, createdMs);
        }
      });
      setSentInviteMap(sentMap);
    });

    set(ref(rtdb, `rooms/${roomId}/participants/${me.uid}`), { uid: me.uid, username: me.username, online: true });
    set(ref(rtdb, `presence/${me.uid}/currentlyWatching`), roomId);
    onDisconnect(ref(rtdb, `rooms/${roomId}/participants/${me.uid}`)).remove();

    return () => {
      if (isHostRef.current && !roomClosing) {
        const nextHost = participantIdsRef.current.find((uid) => uid !== me.uid);
        if (nextHost) {
          updateDoc(doc(db, "rooms", roomId), { hostId: nextHost }).catch(() => null);
          update(ref(rtdb, `rooms/${roomId}`), { hostId: nextHost, updatedAtMs: Date.now() }).catch(() => null);
        }
      }
      unsubRoomDoc();
      unsubState();
      unsubReactions();
      unsubTyping();
      unsubMsgs();
      unsubRoomVideos();
      unsubPapers();
      unsubShouts();
      unsubCrowd();
      unsubSentInvites();
      remove(ref(rtdb, `rooms/${roomId}/participants/${me.uid}`));
      set(ref(rtdb, `presence/${me.uid}/currentlyWatching`), null);
    };
  }, [roomId, me.uid, me.username]);

  useEffect(() => {
    if (!playerRef.current || !roomState) {
      return;
    }
    const eventChanged = Boolean(roomState.syncEventId && roomState.syncEventId !== appliedEventRef.current);
    const isExternalActor = roomState.syncActorUid && roomState.syncActorUid !== me.uid;

    if (isExternalActor) {
      syncPlayerToRoomState(eventChanged);
      if (roomState.syncEventId) {
        appliedEventRef.current = roomState.syncEventId;
      }

      // If a participant updated the room, the host immediately adopts the change and reclaims the
      // primary sync actor role. This ensures the host's timeline perfectly updates in Firebase
      // and remains the absolute, stable source of truth for all other participants!
      if (isHost) {
        const currentTime = playerRef.current.getCurrentTime?.() || Number(roomState.currentTimestamp);
        update(ref(rtdb, `rooms/${roomId}`), {
          currentTimestamp: currentTime,
          syncActorUid: me.uid,
          updatedAtMs: Date.now(),
          lastUpdated: rtdbServerTimestamp(),
        }).catch(() => null);
      }
    } else if (!isSeeking) {
      // Periodic self-correction if host/actor gets out of state locally
      const expected = roomState.playbackState === "playing" ? 1 : 2;
      const current = playerRef.current?.getPlayerState?.() || 2;
      if (expected !== current) {
        if (expected === 1) playerRef.current?.playVideo?.();
        else playerRef.current?.pauseVideo?.();
      }
    }
  }, [roomState, me.uid, isSeeking, isHost, roomId]);

  useEffect(() => {
    if (!paperBursts.length) {
      return;
    }

    const palette = [
      ["#fff8dc", "#f5e7c3"],
      ["#eef3ff", "#dce6ff"],
      ["#ffe9d4", "#ffd7b0"],
      ["#f4f7ff", "#d9ecff"],
      ["#fff5e9", "#e7d9be"],
    ] as const;

    const additions: OverlayPaperPiece[] = [];
    paperBursts.forEach((burst) => {
      if (processedPaperBurstIdsRef.current.has(burst.id)) {
        return;
      }
      processedPaperBurstIdsRef.current.add(burst.id);
      const origin = seatMapByUid[burst.actorUid] || { x: 0, z: 0.9 };
      const leftBase = 50 + origin.x * 7.4;
      const topBase = 73 - origin.z * 4;

      for (let index = 0; index < 36; index += 1) {
        const colors = palette[Math.floor(Math.random() * palette.length)];
        additions.push({
          id: `${burst.id}-${index}`,
          burstId: burst.id,
          left: leftBase + (Math.random() - 0.5) * 6,
          top: topBase + (Math.random() - 0.5) * 4,
          dx: (Math.random() - 0.5) * 260,
          dy: -(180 + Math.random() * 260),
          rotate: (Math.random() - 0.5) * 980,
          duration: 1.9 + Math.random() * 1,
          delay: Math.random() * 0.14,
          colorA: colors[0],
          colorB: colors[1],
          size: 8 + Math.random() * 12,
        });
      }
    });

    if (additions.length) {
      setOverlayPaperPieces((prev) => [...prev, ...additions]);
      const affectedBurstIds = Array.from(new Set(additions.map((item) => item.burstId)));
      window.setTimeout(() => {
        setOverlayPaperPieces((prev) => prev.filter((item) => !affectedBurstIds.includes(item.burstId)));
      }, 3400);
    }
  }, [paperBursts, seatMapByUid]);

  useEffect(() => {
    if (!roomId || !canControlPlayback || !playerRef.current || roomClosing) {
      return;
    }

    const timer = window.setInterval(() => {
      const currentTime = playerRef.current?.getCurrentTime?.() || 0;
      const currentPlayback = playerRef.current?.getPlayerState?.() === 1 ? "playing" : "paused";

      if (!hostHasInitiallySyncedRef.current) {
        hostHasInitiallySyncedRef.current = true;
        const remoteTime = Number(roomState?.currentTimestamp || 0);
        if (remoteTime > 0) {
          // If time is present in the room, move to the proper time in the timeline first!
          playerRef.current?.seekTo?.(remoteTime, true);
          return;
        }
      }

      hostPrevTimeRef.current = currentTime;

      if (isHost && Date.now() - lastFirestorePersistRef.current > 5000) {
        updateDoc(doc(db, "rooms", roomId), {
          currentTimestamp: currentTime,
          playbackState: currentPlayback,
          currentVideo: extractVideoId(youtubeInput),
        }).catch(() => null);
        lastFirestorePersistRef.current = Date.now();
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [roomId, canControlPlayback, isHost, youtubeInput, roomClosing, roomState?.currentTimestamp]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchSuggestions([]);
      setSearchResults([]);
      setSearchNotice("");
      return;
    }

    const timer = window.setTimeout(async () => {
      const q = encodeURIComponent(searchQuery.trim());
      setSearchingVideos(true);
      const youtubeApiKey = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;
      try {
        const suggestRes = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${q}`);
        const suggestJson = (await suggestRes.json()) as [string, string[]];
        setSearchSuggestions((suggestJson?.[1] || []).slice(0, 5));
      } catch {
        setSearchSuggestions([]);
      }

      try {
        let mapped: YoutubeSearchResult[] = [];

        // Preferred: official YouTube Data API when API key is configured.
        if (youtubeApiKey) {
          const apiRes = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=8&q=${q}&key=${youtubeApiKey}`
          );
          if (!apiRes.ok) {
            throw new Error("youtube-api-failed");
          }
          const apiJson = (await apiRes.json()) as {
            items?: Array<{
              id?: { videoId?: string };
              snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } };
            }>;
          };
          mapped = (apiJson.items || [])
            .map((item) => ({
              id: item.id?.videoId || "",
              title: item.snippet?.title || "Untitled",
              author: item.snippet?.channelTitle || "Unknown",
              thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
            }))
            .filter((item) => item.id);
        } else {
          // Fallback: community endpoint for quick setup when no API key is provided.
          const resultRes = await fetch(`https://piped.video/api/v1/search?q=${q}&filter=videos`);
          if (!resultRes.ok) {
            throw new Error("fallback-search-failed");
          }
          const resultJson = (await resultRes.json()) as Array<{ url: string; title: string; uploaderName: string; thumbnail: string }>;
          mapped = resultJson
            .map((item) => {
              const id = extractVideoId(item.url || "");
              return {
                id,
                title: item.title || "Untitled",
                author: item.uploaderName || "Unknown",
                thumbnail: item.thumbnail || "",
              };
            })
            .filter((item) => item.id)
            .slice(0, 8);
        }

        setSearchResults(mapped);
        setSearchNotice(mapped.length ? "" : "No videos found for this search.");
      } catch {
        setSearchResults([]);
        setSearchNotice(
          youtubeApiKey
            ? "Search failed. Check VITE_YOUTUBE_API_KEY quota/restrictions."
            : "Search unavailable. Add VITE_YOUTUBE_API_KEY to use official YouTube search."
        );
      } finally {
        setSearchingVideos(false);
      }
    }, 420);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!playerRef.current) {
      return;
    }
    const timer = window.setInterval(() => {
      const nextTime = playerRef.current?.getCurrentTime?.() || 0;
      const nextDuration = playerRef.current?.getDuration?.() || 0;
      if (!isSeeking) {
        setTimelineTime(nextTime);
      }
      setVideoDuration(nextDuration);
    }, 300);
    return () => window.clearInterval(timer);
  }, [isSeeking, videoId]);

  const pushPlayback = async (patch: Record<string, unknown>) => {
    if (!canControlPlayback || !roomId || !playerRef.current || roomClosing) {
      return;
    }

    const nextPlaybackState = String(patch.playbackState ?? (playerRef.current?.getPlayerState?.() === 1 ? "playing" : "paused"));

    // Apply local intent immediately for responsive controls before network roundtrip.
    if (patch.currentTimestamp !== undefined) {
      playerRef.current.seekTo?.(Number(patch.currentTimestamp), true);
    }
    if (nextPlaybackState === "playing") {
      playerRef.current.playVideo?.();
    } else if (nextPlaybackState === "paused") {
      playerRef.current.pauseVideo?.();
    }

    const syncEventId = `${Date.now()}-${Math.round(Math.random() * 1e5)}`;

    // Prepare the exact fields to update in the Realtime Database
    const rtdbUpdate: Record<string, unknown> = {
      ...patch,
      syncActorUid: me.uid,
      syncEventId,
      updatedAtMs: Date.now(),
      lastUpdated: rtdbServerTimestamp(),
    };

    // Always ensure the current timestamp is correctly paired with the new updatedAtMs anchor!
    // If not explicitly provided in the patch, grab the fully settled current time directly from the player.
    if (patch.currentTimestamp !== undefined) {
      rtdbUpdate.currentTimestamp = patch.currentTimestamp;
    } else {
      rtdbUpdate.currentTimestamp = playerRef.current?.getCurrentTime?.() || 0;
    }

    await update(ref(rtdb, `rooms/${roomId}`), rtdbUpdate);

    const firestoreUpdate: Record<string, unknown> = {
      playbackState: nextPlaybackState,
      currentVideo: String(patch.currentVideo ?? roomState?.currentVideo ?? extractVideoId(youtubeInput)),
      currentSource: String(patch.currentSource ?? roomState?.currentSource ?? "youtube"),
      currentVideoUrl: String(patch.currentVideoUrl ?? roomState?.currentVideoUrl ?? ""),
      currentVideoTitle: String(patch.currentVideoTitle ?? roomState?.currentVideoTitle ?? ""),
    };

    if (patch.currentTimestamp !== undefined) {
      firestoreUpdate.currentTimestamp = Number(patch.currentTimestamp);
    }

    await updateDoc(doc(db, "rooms", roomId), firestoreUpdate).catch(() => null);
  };

  const closeRoom = async () => {
    if (!roomId || !isHost) {
      return;
    }
    await updateDoc(doc(db, "rooms", roomId), { status: "closed", closedAt: serverTimestamp() });
    await update(ref(rtdb, `rooms/${roomId}`), { closed: true, playbackState: "paused", updatedAtMs: Date.now() });
    setRoomClosing(true);
  };

  const switchRoomMode = async (mode: "video" | "theater") => {
    if (!roomId || !isHost || roomClosing) {
      return;
    }
    await update(ref(rtdb, `rooms/${roomId}`), {
      roomMode: mode,
      syncActorUid: me.uid,
      syncEventId: `mode-${Date.now()}`,
      updatedAtMs: Date.now(),
      lastUpdated: rtdbServerTimestamp(),
    });
    await updateDoc(doc(db, "rooms", roomId), { roomMode: mode });
    pushToast(mode === "theater" ? "Switched to Theater 3D mode." : "Switched to Video mode.", "success");
  };

  const removeParticipant = async (participantUid: string, participantName: string) => {
    if (!roomId || !isHost || participantUid === me.uid) {
      return;
    }
    const confirmKick = window.confirm(`Remove ${participantName} from this room?`);
    if (!confirmKick) {
      return;
    }
    await updateDoc(doc(db, "rooms", roomId), {
      participants: arrayRemove(participantUid),
      kickedUids: arrayUnion(participantUid),
    });
    await remove(ref(rtdb, `rooms/${roomId}/participants/${participantUid}`));
    await addDoc(collection(db, "notifications"), {
      toUid: participantUid,
      text: `${me.username} removed you from ${roomDoc?.roomName || "the room"}`,
      createdAt: serverTimestamp(),
      read: false,
    });
    pushToast(`${participantName} was removed.`, "success");
  };



  const syncSubtitle = async () => {
    if (!roomId || !canEditSubtitles) {
      return;
    }
    await update(ref(rtdb, `rooms/${roomId}`), {
      subtitleText: subtitleInput.trim(),
      subtitleUpdatedAt: Date.now(),
      updatedAtMs: Date.now(),
    });
    await updateDoc(doc(db, "rooms", roomId), { subtitleText: subtitleInput.trim() }).catch(() => null);
    pushToast("Subtitle synced to everyone.", "success");
  };

  const sendInvite = async (friend: AppUser) => {
    if (!roomId) {
      return;
    }
    const inviteCooldownMs = 10 * 60 * 1000;
    const lastInviteAt = sentInviteMap[friend.uid] || 0;
    const cooldownLeft = inviteCooldownMs - (Date.now() - lastInviteAt);

    if (participantIds.has(friend.uid)) {
      pushToast(`${friend.username} is already in this room.`, "info");
      return;
    }
    if (cooldownLeft > 0) {
      const mins = Math.ceil(cooldownLeft / 60000);
      pushToast(`Invite cooldown active for ${friend.username}. Try again in ${mins}m.`, "info");
      return;
    }

    setInvitingUid(friend.uid);
    try {
      await addDoc(collection(db, "notifications"), {
        toUid: friend.uid,
        text: `${me.username} invited you to watch together in ${roomDoc?.roomName || "a room"}`,
        type: "roomInvite",
        roomId,
        fromUid: me.uid,
        fromName: me.username,
        createdAt: serverTimestamp(),
        read: false,
      });
      await updateDoc(doc(db, "rooms", roomId), { invitedUids: arrayUnion(friend.uid) });
      setSentInviteMap((prev) => ({ ...prev, [friend.uid]: Date.now() }));
      pushToast(`Invite sent to ${friend.username}.`, "success");
    } catch {
      pushToast("Could not send invite. Please try again.", "error");
    } finally {
      setInvitingUid("");
    }
  };

  const copyInviteLink = async () => {
    setCopyingInvite(true);
    try {
      await navigator.clipboard.writeText(inviteLink);
      pushToast("Successfully copied the invite link.", "success");
    } catch {
      pushToast("Copy failed. Please copy manually.", "error");
    } finally {
      setCopyingInvite(false);
    }
  };

  const uploadRoomVideo = async (file: File) => {
    if (!roomId) {
      return;
    }
    setUploadingVideo(true);
    setUploadProgress(0);

    const filePath = `roomUploads/${roomId}/${Date.now()}-${file.name}`;
    const storagePath = storageRef(storage, filePath);
    const uploadTask = uploadBytesResumable(storagePath, file);

    uploadTask.on(
      "state_changed",
      (snapshot) => {
        const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        setUploadProgress(progress);
      },
      (error) => {
        pushToast(`Video upload failed: ${error.message}`, "error");
        setUploadingVideo(false);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          await addDoc(collection(db, "roomVideos"), {
            roomId,
            name: file.name,
            url,
            uploaderUid: me.uid,
            uploaderName: me.username,
            createdAt: serverTimestamp(),
          });
          pushToast("Video uploaded successfully.", "success");
        } catch {
          pushToast("Could not save video info.", "error");
        } finally {
          setUploadingVideo(false);
          setUploadProgress(0);
        }
      }
    );
  };

  const selectUploadedVideo = async (video: RoomVideo) => {
    if (!canLoadVideo) {
      pushToast("Only host/co-host can switch room video.", "error");
      return;
    }
    setYoutubeInput(video.name);
    await pushPlayback({
      currentSource: "upload",
      currentVideoUrl: video.url,
      currentVideoTitle: video.name,
      currentTimestamp: 0,
      playbackState: "paused",
    });
  };

  const throwPapers = async () => {
    if (!roomId || roomMode !== "theater") {
      return;
    }
    if (Date.now() - lastThrowAt < 1500) {
      return;
    }
    setLastThrowAt(Date.now());
    window.setTimeout(() => {
      setLastThrowAt(0);
    }, 1500);

    const localId = `local-${Date.now()}-${Math.random()}`;
    setPaperBursts((prev) => [...prev, { id: localId, actorUid: me.uid, createdAt: Date.now() }]);
    window.setTimeout(() => {
      setPaperBursts((prev) => prev.filter((item) => item.id !== localId));
    }, 3200);

    const burstRef = push(ref(rtdb, `rooms/${roomId}/effects/papers`));
    await set(burstRef, { actorUid: me.uid, createdAt: Date.now() });
    window.setTimeout(() => remove(burstRef), 3500);
  };

  const shoutInTheater = async () => {
    if (!roomId || roomMode !== "theater") {
      return;
    }
    playShoutSound();
    const shoutRef = push(ref(rtdb, `rooms/${roomId}/effects/shouts`));
    await set(shoutRef, { actorUid: me.uid, createdAt: Date.now() });
    window.setTimeout(() => remove(shoutRef), 4500);
  };

  const triggerCrowdReaction = async (type: "cheer" | "laugh" | "scream" | "clap") => {
    if (!roomId) {
      return;
    }
    playCrowdSound(type);
    const reactionRef = push(ref(rtdb, `rooms/${roomId}/effects/crowd`));
    await set(reactionRef, { actorUid: me.uid, type, createdAt: Date.now() });
    window.setTimeout(() => remove(reactionRef), 5000);
  };

  const bindHtmlVideoPlayer = (videoElement: HTMLVideoElement | null) => {
    if (!videoElement) {
      return;
    }
    // Ensure the video is explicitly unmuted and volume is set to audible
    videoElement.muted = false;
    videoElement.volume = 1.0;

    playerRef.current = {
      getCurrentTime: () => videoElement.currentTime || 0,
      getDuration: () => videoElement.duration || 0,
      playVideo: () => {
        videoElement.muted = false;
        videoElement.volume = 1.0;
        void videoElement.play();
      },
      pauseVideo: () => videoElement.pause(),
      seekTo: (time: number) => {
        videoElement.currentTime = time;
      },
      getPlayerState: () => (videoElement.paused ? 2 : 1),
    };
  };

  const sendReaction = async (emoji: string) => {
    if (!roomId) {
      return;
    }
    const reactionRef = push(ref(rtdb, `rooms/${roomId}/reactions`));
    await set(reactionRef, { emoji, sender: me.username, createdAt: Date.now() });
    window.setTimeout(() => remove(reactionRef), 5000);
  };

  const inviteLink = `${window.location.origin}/room/${roomId}`;

  if (!roomId) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!roomDoc || !roomState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#03050b] text-white">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-cyan-300 border-t-transparent" />
          <p className="text-sm text-white/70">Connecting to room...</p>
        </div>
      </div>
    );
  }

  if (roomMode === "theater") {
    return (
      <div className="relative h-screen w-full overflow-hidden bg-[#010208] text-white">
        <ToastStack toasts={toasts} />
        <PaperOverlay pieces={overlayPaperPieces} />

        <div className="absolute inset-0">
          <Canvas camera={{ position: [0, 1.8, 6], fov: 52 }}>
            <TheaterViewerCamera seatIndex={mySeatIndex} />
            <TheaterRoom pulse={theaterPulse} theme={theatreTheme} />
            <TheaterRoomAvatars participants={orderedParticipants} hostId={roomDoc?.hostId} />
            <PaperBurstsLayer bursts={paperBursts} seatMap={seatMapByUid} />
            <Html transform position={[-1, 1.7, -7.35]} rotation={[0, 0, 0]} distanceFactor={6.2} zIndexRange={[5, 0]}>
              <div className="pointer-events-none w-[760px] overflow-hidden border border-cyan-200/40 shadow-[0_0_30px_rgba(57,207,255,0.3)]">
                {currentSource === "upload" ? (
                  <video
                    src={currentVideoUrl}
                    className="h-[340px] w-[760px] bg-black object-contain"
                    ref={bindHtmlVideoPlayer}
                    playsInline
                    onLoadedMetadata={(event) => {
                      bindHtmlVideoPlayer(event.currentTarget);
                      setVideoDuration(event.currentTarget.duration || 0);
                      window.setTimeout(() => syncPlayerToRoomState(true), 80);
                    }}
                    onPlay={() => {
                      if (canControlPlayback && !suppressStateRef.current) {
                        pushPlayback({ playbackState: "playing" }).catch(() => null);
                      }
                    }}
                    onPause={() => {
                      if (canControlPlayback && !suppressStateRef.current) {
                        pushPlayback({ playbackState: "paused" }).catch(() => null);
                      }
                    }}
                  />
                ) : (
                  <YouTube
                    videoId={videoId}
                    opts={{
                      width: "760",
                      height: "340",
                      playerVars: {
                        autoplay: 0,
                        controls: 0,
                        modestbranding: 1,
                        rel: 0,
                        iv_load_policy: 3,
                        fs: 0,
                        disablekb: 1,
                        playsinline: 1,
                      },
                    }}
                    onReady={(event) => {
                      playerRef.current = event.target;
                      const duration = event.target?.getDuration?.() || 0;
                      setVideoDuration(duration);
                      window.setTimeout(() => syncPlayerToRoomState(true), 80);
                    }}
                    onStateChange={(event) => {
                      if (!canControlPlayback || suppressStateRef.current || roomClosing) {
                        return;
                      }
                      const stateCode = event.data;
                      if (stateCode !== 1 && stateCode !== 2) {
                        return;
                      }
                      pushPlayback({ playbackState: stateCode === 1 ? "playing" : "paused" }).catch(() => null);
                    }}
                  />
                )}
              </div>
            </Html>
          </Canvas>
        </div>

        <div data-ui-overlay="true" className="pointer-events-none fixed inset-x-0 top-4 z-[500] flex items-start justify-between px-4 sm:px-6">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              className="rounded-full border border-fuchsia-200/50 bg-fuchsia-300/25 px-4 py-1.5 text-xs font-semibold tracking-[0.18em] text-fuchsia-50 shadow-[0_0_20px_rgba(255,120,220,0.35)] backdrop-blur-md"
              onClick={() => setTheaterHudCollapsed((prev) => !prev)}
            >
              UP
            </button>
            {!theaterHudCollapsed && (
              <>
            <div className="flex rounded-full border border-white/20 bg-black/25 p-1 text-xs backdrop-blur-sm">
              <button
                className="rounded-full bg-cyan-300 px-3 py-1 text-[#04131c]"
                onClick={() => switchRoomMode("video")}
                disabled={!isHost || roomClosing}
              >
                Exit Theater
              </button>
              <button
                className="rounded-full px-3 py-1 text-white/85"
                onClick={() => switchRoomMode("theater")}
                disabled={!isHost || roomClosing}
              >
                Theater
              </button>
            </div>
            <div className="flex rounded-full border border-white/20 bg-black/25 p-1 text-xs backdrop-blur-sm">
              {(["luxury", "horror", "anime", "cyberpunk", "retro"] as const).map((theme) => (
                <button
                  key={theme}
                  className={`rounded-full px-2 py-1 ${theatreTheme === theme ? "bg-white/30 text-white" : "text-white/75"}`}
                  onClick={async () => {
                    if (!isHost || roomClosing) {
                      return;
                    }
                    await update(ref(rtdb, `rooms/${roomId}`), { theatreTheme: theme, updatedAtMs: Date.now() });
                    await updateDoc(doc(db, "rooms", roomId), { theatreTheme: theme });
                  }}
                >
                  {theme}
                </button>
              ))}
            </div>
            <button className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-xs backdrop-blur-sm" onClick={copyInviteLink}>
              {copyingInvite ? "Copying..." : "Copy Invite"}
            </button>
            <button className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-xs backdrop-blur-sm" onClick={() => navigate("/dashboard")}>
              Back
            </button>
              </>
            )}
          </div>
          <p className="pointer-events-auto rounded-full border border-white/20 bg-black/20 px-3 py-1 text-xs text-white/70 backdrop-blur-sm">Room {roomId}</p>
        </div>

        {roomState?.subtitleText && (
          <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 w-[85%] max-w-3xl -translate-x-1/2 text-center text-sm text-white">
            {roomState.subtitleText}
          </div>
        )}

        <AnimatePresence>
          {syncing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-full bg-cyan-400/85 px-3 py-1 text-xs font-semibold text-[#03121d]"
            >
              Syncing...
            </motion.div>
          )}
        </AnimatePresence>

        {!theaterHudCollapsed && (
          <aside data-ui-overlay="true" className="pointer-events-auto fixed right-4 top-20 bottom-24 z-[460] w-[300px] overflow-hidden text-sm text-white/90">
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-cyan-200/80">Live Chat</p>
          <div className="h-full overflow-auto pr-1">
            {messages.map((message) => (
              <p key={message.id} className="mb-2 leading-snug text-white/90">
                <span className="text-cyan-200">{message.fromName}:</span> {message.text}
              </p>
            ))}
          </div>
          </aside>
        )}

        <div data-ui-overlay="true" className="pointer-events-auto fixed inset-x-4 bottom-4 z-[500] flex flex-col gap-3 sm:inset-x-6">
          {!theaterHudCollapsed && (
            <div className="rounded-2xl border border-white/20 bg-black/25 px-4 py-3 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between text-xs text-white/75">
              <span>{currentSource === "upload" ? roomState?.currentVideoTitle || "Uploaded Video" : "YouTube"}</span>
              <span>
                {formatClock(timelineTime)} / {formatClock(videoDuration)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => pushPlayback({ playbackState: "playing" })}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs"
                disabled={!canControlPlayback || roomClosing}
              >
                Play
              </button>
              <button
                onClick={() => pushPlayback({ playbackState: "paused" })}
                className="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-xs"
                disabled={!canControlPlayback || roomClosing}
              >
                Pause
              </button>
              <button
                onClick={async () => {
                  if (playerRef.current) {
                    hostHasInitiallySyncedRef.current = true;
                    const currentTime = timelineTime || playerRef.current.getCurrentTime?.() || 0;
                    playerRef.current.seekTo?.(currentTime, true);
                    await pushPlayback({ currentTimestamp: currentTime });
                    pushToast("Synced everyone's timeline to you.", "success");
                  }
                }}
                className="rounded-full border border-cyan-200/40 bg-cyan-400/20 px-4 py-1.5 text-xs text-cyan-200 transition hover:bg-cyan-400/30"
                disabled={!canSeekTimeline || roomClosing}
              >
                Sync Timeline
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(1, videoDuration)}
                value={Math.min(timelineTime, Math.max(1, videoDuration))}
                className="ml-auto min-w-[220px] flex-1 accent-cyan-300"
                onMouseDown={() => setIsSeeking(true)}
                onMouseUp={async (event) => {
                  const target = Number((event.target as HTMLInputElement).value);
                  setTimelineTime(target);
                  setIsSeeking(false);
                  if (playerRef.current) {
                    playerRef.current.seekTo?.(target, true);
                  }
                  if (canSeekTimeline) {
                    await pushPlayback({ currentTimestamp: target });
                  }
                }}
                onChange={(event) => setTimelineTime(Number(event.target.value))}
                disabled={!canSeekTimeline || roomClosing}
              />
            </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={throwPapers}
              className="rounded-full border border-cyan-200/40 bg-cyan-300/25 px-6 py-3 text-sm font-semibold tracking-wide text-cyan-50 shadow-[0_0_28px_rgba(74,211,255,0.35)] backdrop-blur-md transition hover:scale-105 hover:bg-cyan-300/35 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={Date.now() - lastThrowAt < 1500}
            >
              {Date.now() - lastThrowAt < 1500 ? "THROW PAPERS (COOLDOWN)" : "THROW PAPERS"}
            </button>
            <button
              onClick={shoutInTheater}
              className="rounded-full border border-rose-200/40 bg-rose-300/25 px-6 py-3 text-sm font-semibold tracking-wide text-rose-50 shadow-[0_0_28px_rgba(255,112,153,0.35)] backdrop-blur-md transition hover:scale-105 hover:bg-rose-300/35"
            >
              SHOUT
            </button>
            <button
              onClick={() => triggerCrowdReaction("cheer")}
              className="rounded-full border border-emerald-200/40 bg-emerald-300/25 px-5 py-3 text-sm font-semibold tracking-wide text-emerald-50 shadow-[0_0_22px_rgba(110,255,190,0.3)] backdrop-blur-md transition hover:scale-105"
            >
              CHEER
            </button>
            <button
              onClick={() => triggerCrowdReaction("clap")}
              className="rounded-full border border-amber-200/40 bg-amber-300/25 px-5 py-3 text-sm font-semibold tracking-wide text-amber-50 shadow-[0_0_22px_rgba(255,216,120,0.3)] backdrop-blur-md transition hover:scale-105"
            >
              CLAP
            </button>
          </div>

          {!theaterHudCollapsed && (
            <>
              <div className="flex flex-wrap gap-2">
                {["😂", "😭", "😱", "❤️", "🔥", "🍿", "👏"].map((emoji) => (
                  <button key={emoji} onClick={() => sendReaction(emoji)} className="rounded-full border border-white/20 bg-black/25 px-3 py-1 text-base backdrop-blur-sm">
                    {emoji}
                  </button>
                ))}
              </div>

              <form
                className="flex gap-2"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!chatInput.trim()) {
                    return;
                  }
                  await addDoc(collection(db, "messages"), {
                    roomId,
                    fromUid: me.uid,
                    fromName: me.username,
                    text: chatInput.trim(),
                    createdAt: serverTimestamp(),
                  });
                  setChatInput("");
                  set(ref(rtdb, `rooms/${roomId}/typing/${me.uid}`), { typing: false, name: me.username });
                }}
              >
                <input
                  value={chatInput}
                  onChange={(event) => {
                    setChatInput(event.target.value);
                    set(ref(rtdb, `rooms/${roomId}/typing/${me.uid}`), {
                      typing: event.target.value.length > 0,
                      name: me.username,
                    });
                  }}
                  className="flex-1 rounded-full border border-white/20 bg-black/20 px-4 py-2 text-sm backdrop-blur-sm"
                  placeholder="Send a message"
                />
                <button className="rounded-full border border-white/20 bg-black/25 px-4 py-2 text-sm">Send</button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#03050b] px-4 py-5 text-white sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm tracking-[0.32em] text-cyan-300">WATCH ROOM</p>
            <h1 className="text-2xl font-semibold">{roomDoc?.roomName || "Loading room..."}</h1>
            <p className="mt-1 text-xs text-white/60">Room ID: {roomId}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full border border-white/15 bg-white/5 p-1 text-xs">
              <button
                className="rounded-full bg-cyan-300 px-3 py-1 text-[#04131c]"
                onClick={() => switchRoomMode("video")}
                disabled={!isHost || roomClosing}
              >
                Video
              </button>
              <button
                className="rounded-full px-3 py-1 text-white/80"
                onClick={() => switchRoomMode("theater")}
                disabled={!isHost || roomClosing}
              >
                Theater 3D
              </button>
            </div>
            <button
              className="rounded-full bg-white/10 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
              onClick={copyInviteLink}
              disabled={copyingInvite}
            >
              {copyingInvite ? "Copying..." : "Copy Invite Link"}
            </button>
             {isHost && roomDoc?.status !== "closed" && (
               <button className="rounded-full bg-rose-400 px-4 py-2 text-sm font-semibold text-[#25070d]" onClick={closeRoom}>
                 Close Room
               </button>
             )}
             <button className="rounded-full bg-white/10 px-4 py-2 text-sm" onClick={() => navigate("/dashboard")}>
              Back
            </button>
          </div>
        </div>

         {roomClosing && <p className="mb-3 rounded-xl bg-rose-400/20 px-4 py-2 text-sm text-rose-100">This room is closed by the host.</p>}
         <ToastStack toasts={toasts} />

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.5fr_1fr]">
          <aside className="rounded-3xl border border-white/10 bg-white/5 p-4">
             <h2 className="font-semibold">Participants</h2>
            <div className="mt-3 space-y-2 text-sm">
               {Object.values(roomState?.participants || {}).map((participant) => (
                <div
                  key={participant.uid}
                  className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2"
                >
                  <span>{participant.username}</span>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    {isHost && participant.uid !== me.uid && (
                      <button
                        className="rounded-full bg-rose-400/80 px-2 py-0.5 text-[11px] text-[#1b0409]"
                        onClick={() => removeParticipant(participant.uid, participant.username)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

             <h3 className="mt-5 font-semibold">Invite Friends</h3>
             <div className="mt-3 space-y-2 text-sm">
               {friendProfiles.map((friend) => (
                 <div key={friend.uid} className="flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
                   <span>{friend.username}</span>
                    {participantIds.has(friend.uid) ? (
                      <span className="rounded-full bg-emerald-300/20 px-3 py-1 text-xs text-emerald-200">In Room</span>
                    ) : sentInviteMap[friend.uid] && Date.now() - sentInviteMap[friend.uid] < 10 * 60 * 1000 ? (
                      <span className="rounded-full bg-white/15 px-3 py-1 text-xs text-white/80">
                        Invited ({Math.ceil((10 * 60 * 1000 - (Date.now() - sentInviteMap[friend.uid])) / 60000)}m)
                      </span>
                    ) : (
                      <button
                        className="rounded-full bg-cyan-300 px-3 py-1 text-xs text-[#03121a] disabled:cursor-not-allowed disabled:opacity-70"
                        onClick={() => sendInvite(friend)}
                        disabled={invitingUid === friend.uid}
                      >
                        {invitingUid === friend.uid ? "Sending..." : "Invite"}
                      </button>
                    )}
                 </div>
               ))}
               {!friendProfiles.length && <p className="text-xs text-white/55">Add friends to send room invites.</p>}
             </div>
          </aside>

          <section className="relative rounded-3xl border border-white/10 bg-black/50 p-3 shadow-[0_0_60px_rgba(61,122,255,0.35)]">
            <div className="relative overflow-hidden rounded-2xl border border-white/10">
              <div className="relative z-10">
                {currentSource === "upload" ? (
                  <video
                    src={currentVideoUrl}
                    className="h-[420px] w-full bg-black object-contain"
                    ref={bindHtmlVideoPlayer}
                    playsInline
                    controls
                    onLoadedMetadata={(event) => {
                      bindHtmlVideoPlayer(event.currentTarget);
                      setVideoDuration(event.currentTarget.duration || 0);
                      window.setTimeout(() => syncPlayerToRoomState(true), 80);
                    }}
                    onPlay={() => {
                      if (canControlPlayback && !suppressStateRef.current) {
                        pushPlayback({ playbackState: "playing" }).catch(() => null);
                      }
                    }}
                    onPause={() => {
                      if (canControlPlayback && !suppressStateRef.current) {
                        pushPlayback({ playbackState: "paused" }).catch(() => null);
                      }
                    }}
                  />
                ) : (
                  <YouTube
                    videoId={videoId}
                    opts={{
                      width: "100%",
                      height: "420",
                      playerVars: {
                        autoplay: 0,
                        controls: 0,
                        modestbranding: 1,
                        rel: 0,
                        iv_load_policy: 3,
                        fs: 0,
                        disablekb: 1,
                        playsinline: 1,
                      },
                    }}
                    onReady={(event) => {
                      playerRef.current = event.target;
                      const duration = event.target?.getDuration?.() || 0;
                      setVideoDuration(duration);
                      window.setTimeout(() => syncPlayerToRoomState(true), 80);
                    }}
                    onStateChange={(event) => {
                      if (!canControlPlayback || suppressStateRef.current || roomClosing) {
                        return;
                      }
                      const stateCode = event.data;
                      if (stateCode !== 1 && stateCode !== 2) {
                        return;
                      }
                      pushPlayback({ playbackState: stateCode === 1 ? "playing" : "paused" }).catch(() => null);
                    }}
                  />
                )}
              </div>

              {roomState?.subtitleText && (
                <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 w-[85%] -translate-x-1/2 rounded-lg bg-black/55 px-3 py-2 text-center text-sm text-white shadow-lg">
                  {roomState.subtitleText}
                </div>
              )}
            </div>

            <AnimatePresence>
              {syncing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-cyan-400/85 px-3 py-1 text-xs font-semibold text-[#03121d]"
                >
                  Syncing...
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={youtubeInput}
                onChange={(event) => setYoutubeInput(event.target.value)}
                onFocus={() => {
                  inputDirtyRef.current = true;
                }}
                onBlur={() => {
                  inputDirtyRef.current = false;
                }}
                placeholder="Paste YouTube URL"
                className="min-w-[220px] flex-1 rounded-full border border-white/15 bg-black/30 px-4 py-2 text-sm"
              />
              <button
                onClick={() =>
                  pushPlayback({
                    currentSource: "youtube",
                    currentVideoUrl: "",
                    currentVideo: extractVideoId(youtubeInput),
                    currentTimestamp: 0,
                    playbackState: "paused",
                  })
                }
                className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#04141d]"
                disabled={!canLoadVideo || roomClosing}
              >
                Load Video
              </button>
              <button onClick={() => pushPlayback({ playbackState: "playing" })} className="rounded-full bg-white/15 px-4 py-2 text-sm" disabled={!canControlPlayback || roomClosing}>
                Play
              </button>
              <button onClick={() => pushPlayback({ playbackState: "paused" })} className="rounded-full bg-white/15 px-4 py-2 text-sm" disabled={!canControlPlayback || roomClosing}>
                Pause
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-white/70">
                <div className="flex items-center gap-2">
                  <span>{formatClock(timelineTime)}</span>
                  <span>/</span>
                  <span>{formatClock(videoDuration)}</span>
                </div>
                <button
                  onClick={async () => {
                    if (playerRef.current) {
                      hostHasInitiallySyncedRef.current = true;
                      const currentTime = timelineTime || playerRef.current.getCurrentTime?.() || 0;
                      playerRef.current.seekTo?.(currentTime, true);
                      await pushPlayback({ currentTimestamp: currentTime });
                      pushToast("Synced everyone's timeline to you.", "success");
                    }
                  }}
                  className="rounded-full bg-cyan-400/20 px-3 py-1 text-[11px] text-cyan-200 transition hover:bg-cyan-400/30"
                  disabled={!canSeekTimeline || roomClosing}
                >
                  Sync Timeline
                </button>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(1, videoDuration)}
                value={Math.min(timelineTime, Math.max(1, videoDuration))}
                className="mt-1 w-full accent-cyan-300"
                onMouseDown={() => setIsSeeking(true)}
                onMouseUp={async (event) => {
                  const target = Number((event.target as HTMLInputElement).value);
                  setTimelineTime(target);
                  setIsSeeking(false);
                  if (playerRef.current) {
                    playerRef.current.seekTo(target, true);
                  }
                  if (canSeekTimeline) {
                    await pushPlayback({ currentTimestamp: target });
                  }
                }}
                onChange={(event) => setTimelineTime(Number(event.target.value))}
                disabled={!canSeekTimeline || roomClosing}
              />
              {!canSeekTimeline && <p className="mt-1 text-[11px] text-white/50">Host, co-host, and moderator can seek timeline.</p>}
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <p className="text-xs text-white/65">Synced subtitle overlay</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={subtitleInput}
                  onChange={(event) => setSubtitleInput(event.target.value)}
                  className="flex-1 rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm"
                  placeholder="Type subtitle for everyone"
                  disabled={!canEditSubtitles}
                />
                <button
                  className="rounded-full bg-white/15 px-4 py-2 text-sm disabled:opacity-60"
                  onClick={syncSubtitle}
                  disabled={!canEditSubtitles}
                >
                  Sync Subtitle
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="text-xs text-white/70">Search YouTube videos</p>
              <div className="mt-2 flex gap-2">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search trailers, clips, movies"
                  className="flex-1 rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm"
                />
                <button className="rounded-full bg-white/15 px-4 py-2 text-sm" onClick={() => setSearchQuery(youtubeInput)} type="button">
                  Use URL
                </button>
              </div>
              {searchingVideos && <p className="mt-2 text-xs text-cyan-200">Searching videos...</p>}
              {!searchingVideos && searchSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {searchSuggestions.map((item) => (
                    <button key={item} className="rounded-full bg-white/10 px-3 py-1 text-xs" onClick={() => setSearchQuery(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              )}
              {searchNotice && <p className="mt-2 text-xs text-amber-200">{searchNotice}</p>}
              {!searchingVideos && searchResults.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/35 p-2 text-left"
                      onClick={() => {
                        setYoutubeInput(result.id);
                        if (canLoadVideo) {
                          pushPlayback({ currentSource: "youtube", currentVideoUrl: "", currentVideo: result.id, currentTimestamp: 0, playbackState: "paused" }).catch(
                            () => null
                          );
                        }
                      }}
                    >
                      <img src={result.thumbnail} alt={result.title} className="h-12 w-20 rounded-md object-cover" />
                      <span className="text-xs">
                        <span className="line-clamp-2 block text-white/90">{result.title}</span>
                        <span className="text-white/50">{result.author}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-white/70">Uploaded Room Videos</p>
                <label className={`rounded-full px-3 py-1 text-xs ${uploadingVideo ? "bg-cyan-400/20 text-cyan-200" : "cursor-pointer bg-white/15"}`}>
                  {uploadingVideo ? `Uploading... ${uploadProgress}%` : "Upload Video"}
                  <input
                    type="file"
                    accept="video/*,video/mp4,video/webm,video/ogg,video/x-matroska,.mkv,.avi,.mov"
                    className="hidden"
                    disabled={uploadingVideo || !canLoadVideo}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        uploadRoomVideo(file).catch(() => null);
                      }
                    }}
                  />
                </label>
              </div>
              <div className="mt-2 grid gap-2 max-h-40 overflow-auto pr-1">
                {uploadedVideos.map((video) => (
                  <button
                    key={video.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-left text-xs"
                    onClick={() => selectUploadedVideo(video)}
                    disabled={!canLoadVideo}
                  >
                    <span className="line-clamp-1">{video.name}</span>
                    <span className="text-cyan-200">Play</span>
                  </button>
                ))}
                {!uploadedVideos.length && <p className="text-xs text-white/50">No uploaded videos yet.</p>}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {["😂", "😭", "😱", "❤️", "🔥", "🍿", "👏"].map((emoji) => (
                <button key={emoji} onClick={() => sendReaction(emoji)} className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-lg">
                  {emoji}
                </button>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <button onClick={() => triggerCrowdReaction("cheer")} className="rounded-full bg-emerald-300/20 px-3 py-1 text-emerald-100">
                Crowd Cheer
              </button>
              <button onClick={() => triggerCrowdReaction("laugh")} className="rounded-full bg-amber-300/20 px-3 py-1 text-amber-100">
                Audience Laugh
              </button>
              <button onClick={() => triggerCrowdReaction("scream")} className="rounded-full bg-rose-300/20 px-3 py-1 text-rose-100">
                Horror Scream
              </button>
              <button onClick={() => triggerCrowdReaction("clap")} className="rounded-full bg-cyan-300/20 px-3 py-1 text-cyan-100">
                Clapping
              </button>
            </div>

            {floatReactions.map((reaction) => (
              <motion.div
                key={reaction.id}
                initial={{ opacity: 0, y: 10, scale: 0.6 }}
                animate={{ opacity: 1, y: -55, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2 }}
                className="pointer-events-none absolute bottom-20 left-[45%] rounded-full bg-white/15 px-2.5 py-1 text-lg"
              >
                {reaction.emoji}
              </motion.div>
            ))}
          </section>

          <aside className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <h2 className="font-semibold">Live Chat</h2>
            <div className="mt-3 h-[360px] space-y-2 overflow-auto pr-1 text-sm">
              {messages.map((message) => (
                <div key={message.id} className="rounded-xl bg-black/35 px-3 py-2">
                  <p className="text-cyan-200">{message.fromName}</p>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
            {typingUsers.length > 0 && <p className="mt-2 text-xs text-cyan-300">{typingUsers.join(", ")} typing...</p>}
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!chatInput.trim()) {
                  return;
                }
                await addDoc(collection(db, "messages"), {
                  roomId,
                  fromUid: me.uid,
                  fromName: me.username,
                  text: chatInput.trim(),
                  createdAt: serverTimestamp(),
                });
                setChatInput("");
                set(ref(rtdb, `rooms/${roomId}/typing/${me.uid}`), { typing: false, name: me.username });
              }}
            >
              <input
                value={chatInput}
                onChange={(event) => {
                  setChatInput(event.target.value);
                  set(ref(rtdb, `rooms/${roomId}/typing/${me.uid}`), {
                    typing: event.target.value.length > 0,
                    name: me.username,
                  });
                }}
                className="flex-1 rounded-full border border-white/15 bg-black/35 px-4 py-2 text-sm"
                placeholder="Send a message"
              />
              <button className="rounded-full bg-cyan-300 px-4 py-2 text-sm font-semibold text-[#041018]">Send</button>
            </form>
          </aside>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ user, children }: { user: User | null; children: ReactElement }) {
  if (!user) {
    return <Navigate to="/auth" replace />;
  }
  return children;
}

function Shell() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        return;
      }
      const userDoc = await ensureUserDoc(nextUser);
      setProfile(userDoc);
      setLoading(false);
      onSnapshot(doc(db, "users", nextUser.uid), (snap) => {
        if (snap.exists()) {
          setProfile(snap.data() as AppUser);
        }
      });
    });
    return () => unsub();
  }, []);

  const nav = useMemo(
    () =>
      user ? (
        <div className="fixed right-3 top-3 z-50 flex gap-2 text-xs">
          <span className="hidden items-center rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-white/80 sm:inline-flex">
            Golden Z Vision
          </span>
          <a href="/dashboard" className="rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-white">
            Dashboard
          </a>
          <button className="rounded-full border border-white/15 bg-black/40 px-3 py-1.5" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>
      ) : null,
    [user]
  );

  if (!firebaseConfigured) {
    return (
      <div className="min-h-screen bg-[#06070f] p-6 text-white">
        <h1 className="text-2xl font-semibold">Firebase configuration missing</h1>
        <p className="mt-2 text-sm text-white/70">Set VITE_FIREBASE_* environment variables to run Sprint Up.</p>
      </div>
    );
  }

  if (loading) {
    return <div className="min-h-screen bg-[#06070f] p-6 text-white">Loading Sprint Up...</div>;
  }

  return (
    <>
      {nav}
      {user && <PresenceBridge uid={user.uid} />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute user={user}>{profile ? <Dashboard me={profile} /> : <div className="p-4 text-white">Loading...</div>}</ProtectedRoute>
          }
        />
        <Route
          path="/profile/:uid"
          element={<ProtectedRoute user={user}>{profile ? <ProfilePage me={profile} /> : <div className="p-4 text-white">Loading...</div>}</ProtectedRoute>}
        />
        <Route
          path="/rooms"
          element={<ProtectedRoute user={user}>{profile ? <RecentRoomsPage me={profile} /> : <div className="p-4 text-white">Loading...</div>}</ProtectedRoute>}
        />
        <Route
          path="/admin"
          element={<ProtectedRoute user={user}>{profile ? <AdminDashboard me={profile} /> : <div className="p-4 text-white">Loading...</div>}</ProtectedRoute>}
        />
        <Route
          path="/room/:roomId"
          element={<ProtectedRoute user={user}>{profile ? <WatchRoom me={profile} /> : <div className="p-4 text-white">Loading...</div>}</ProtectedRoute>}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <Shell />
    </Router>
  );
}
