// client/src/components/TalkingAvatar.jsx
import React, {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Build a conservative (slower) viseme timeline as fallback (when TTS boundaries aren’t available) */
function buildVisemeTimelineFromText(text, totalMs = null) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  // Slower pacing to match human TTS more closely
  // ~220 wpm => ~272ms/word, padded 1.35x
  const words = clean.split(" ").length;
  const est = totalMs ?? Math.max(1400, Math.min(18000, words * 272 * 1.35));

  const mapChar = (ch) => {
    ch = ch.toLowerCase();
    if ("a".includes(ch)) return "A";
    if ("e".includes(ch)) return "E";
    if ("i".includes(ch)) return "I";
    if ("o".includes(ch)) return "O";
    if ("u".includes(ch)) return "U";
    return Math.random() < 0.5 ? "I" : "U"; // small fallback
  };

  const chars = clean.replace(/[^a-z]/gi, "") || "aaa";
  const step = est / chars.length;

  return chars.split("").map((c, idx) => ({
    time: idx * step,
    shape: mapChar(c),
    value: 0.95,
    dur: step * 0.88,
  }));
}

const TalkingAvatar = forwardRef(function TalkingAvatar(
  {
    avatarUrl = "/avatars/husain.glb",
    width = 320,
    height = 420,
    /** Camera & model placement */
    cameraZ = 1.85,
    modelScale = 1.14,
    modelY = -0.44,
    modelRotationY = 0, // If you see the back of the head, try Math.PI
    /** Visuals */
    showFloor = false,
    envIntensity = 1.0,
    listeningGlow = false, // subtle breathing/pulse while mic is listening
    /** Expressions (simple) */
    initialExpression = "neutral",
  },
  ref
) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const avatarRootRef = useRef(null);

  // Meshes with morph targets
  const morphMeshesRef = useRef([]);
  // Cached morph target indices across meshes
  const morphIndexRef = useRef({
    A: [],
    E: [],
    I: [],
    O: [],
    U: [],
    mouthOpen: [],
  });

  // Text-timeline fallback state
  const visemesRef = useRef({ timeline: [], startedAt: 0, active: false });

  // Anim helpers
  const rafRef = useRef(0);
  const tRef = useRef(0);
  const glowTRef = useRef(0);

  /** Morph discovery helpers */
  const findIndex = (dict, name) => {
    if (!dict) return -1;
    if (dict[name] !== undefined) return dict[name];
    const keys = Object.keys(dict);
    const exact = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (exact) return dict[exact];
    const contains = keys.find((k) => k.toLowerCase().includes(name.toLowerCase()));
    if (contains) return dict[contains];
    return -1;
  };

  const registerMorphTargets = (mesh) => {
    if (!mesh.morphTargetDictionary) return;
    const d = mesh.morphTargetDictionary;

    const tryOne = (...names) => {
      for (const nm of names) {
        const idx = findIndex(d, nm);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const A = tryOne("viseme_aa", "A");
    const E = tryOne("viseme_e", "E");
    const I = tryOne("viseme_ih", "I");
    const O = tryOne("viseme_oh", "O");
    const U = tryOne("viseme_uh", "U");
    const mouthOpen = tryOne("mouthOpen", "MouthOpen", "mouth_open");

    if (A >= 0) morphIndexRef.current.A.push({ mesh, idx: A });
    if (E >= 0) morphIndexRef.current.E.push({ mesh, idx: E });
    if (I >= 0) morphIndexRef.current.I.push({ mesh, idx: I });
    if (O >= 0) morphIndexRef.current.O.push({ mesh, idx: O });
    if (U >= 0) morphIndexRef.current.U.push({ mesh, idx: U });
    if (mouthOpen >= 0) morphIndexRef.current.mouthOpen.push({ mesh, idx: mouthOpen });
  };

  const clearAllMouth = () => {
    const sets = Object.values(morphIndexRef.current);
    sets.forEach((arr) =>
      arr.forEach(({ mesh, idx }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = 0;
      })
    );
  };

  const setMouthShape = (shape, value = 1.0) => {
    const vowelNames = ["A", "E", "I", "O", "U"];
    if (morphIndexRef.current[shape]?.length) {
      vowelNames.forEach((nm) => {
        morphIndexRef.current[nm].forEach(({ mesh, idx }) => {
          if (!mesh.morphTargetInfluences) return;
          mesh.morphTargetInfluences[idx] = nm === shape ? value : 0;
        });
      });
      return;
    }
    // fallback: mouthOpen
    const arr = morphIndexRef.current.mouthOpen;
    if (arr.length) {
      arr.forEach(({ mesh, idx }) => {
        mesh.morphTargetInfluences[idx] = value;
      });
    }
  };

  /** Simple expression (for plain GLBs we keep it subtle) */
  const setExpression = (mode = "neutral") => {
    // No dedicated emotion morphs on most RPM GLBs; keep to mouth only
    clearAllMouth();
    // You could add small head tilts here per mode if you want later.
  };

  /** Cute gestures (very subtle) */
  const wave = () => {
    // We’ll reuse tRef for a tiny shoulder wiggle effect in the loop
    tRef.current = 0;
  };

  const nod = () => {
    tRef.current = 0;
  };

  // Real-time char → viseme mapper
  const charToShape = (ch) => {
    const c = (ch || "").toLowerCase();
    if ("a".includes(c)) return "A";
    if ("e".includes(c)) return "E";
    if ("i".includes(c)) return "I";
    if ("o".includes(c)) return "O";
    if ("u".includes(c)) return "U";
    return "I";
  };

  /** Expose control API to parent (App.js) */
  useImperativeHandle(ref, () => ({
    setExpression,
    wave,
    nod,
    /** Start slow fallback timeline */
    driveMouthStart: (text, totalMsFallback) => {
      const tl = buildVisemeTimelineFromText(text, totalMsFallback);
      visemesRef.current.timeline = tl;
      visemesRef.current.startedAt = performance.now();
      visemesRef.current.active = true;
    },
    /** Real-time mouth from TTS boundaries */
    setMouthByChar: (ch) => {
      const shape = charToShape(ch);
      setMouthShape(shape, 1.0);
      // Optional: auto-clear after ~90ms to avoid sticking if boundary gaps are large
      // setTimeout(() => clearAllMouth(), 90);
    },
    stopMouth: () => {
      visemesRef.current.active = false;
      clearAllMouth();
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;

    // Renderer / Scene / Camera
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(0, 1.45, cameraZ);
    cameraRef.current = camera;

    // Lights
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(0.5, 1.2, 0.8);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-0.5, 0.8, -0.6);
    scene.add(fill);

    const amb = new THREE.AmbientLight(0xffffff, 0.6 * envIntensity);
    scene.add(amb);

    // Optional floor
    if (showFloor) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.receiveShadow = true;
      scene.add(floor);
    }

    // Load GLB
    const loader = new GLTFLoader();
    loader.load(
      avatarUrl,
      (gltf) => {
        const root = gltf.scene;
        root.traverse((o) => (o.frustumCulled = false));

        // Face the camera; try 0 or Math.PI if you see the back of the head
        root.rotation.y = modelRotationY;
        root.scale.setScalar(modelScale);
        root.position.y = modelY;

        // Collect meshes with morph targets
        const morphMeshes = [];
        root.traverse((obj) => {
          if (obj.isMesh || obj.isSkinnedMesh) {
            morphMeshes.push(obj);
            registerMorphTargets(obj);
          }
        });
        morphMeshesRef.current = morphMeshes;

        scene.add(root);
        avatarRootRef.current = root;

        setExpression(initialExpression);
      },
      undefined,
      (err) => console.error("Failed to load avatar:", err)
    );

    // Animation loop
    const tick = () => {
      const dt = clockRef.current.getDelta();
      tRef.current += dt;
      glowTRef.current += dt;

      // Listening pulse
      if (avatarRootRef.current && listeningGlow) {
        const s = 1 + Math.sin(glowTRef.current * 3.0) * 0.015;
        avatarRootRef.current.scale.setScalar(modelScale * s);
      } else if (avatarRootRef.current) {
        avatarRootRef.current.scale.setScalar(modelScale);
      }

      // Tiny idle sway
      if (avatarRootRef.current) {
        avatarRootRef.current.rotation.x = Math.sin(tRef.current * 0.6) * 0.02;
      }

      // Fallback timeline driver
      const v = visemesRef.current;
      if (v.active && v.timeline.length) {
        const elapsed = performance.now() - v.startedAt;

        // get latest key <= elapsed
        let key = null;
        for (let i = v.timeline.length - 1; i >= 0; i--) {
          if (elapsed >= v.timeline[i].time) {
            key = v.timeline[i];
            break;
          }
        }
        if (key) {
          if (elapsed <= key.time + key.dur) {
            setMouthShape(key.shape, key.value);
          } else {
            clearAllMouth();
          }
        }
        const last = v.timeline[v.timeline.length - 1];
        if (elapsed > last.time + last.dur + 120) {
          v.active = false;
          clearAllMouth();
        }
      }

      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj.isMesh) obj.geometry?.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
    };
  }, [
    avatarUrl,
    width,
    height,
    showFloor,
    envIntensity,
    initialExpression,
    cameraZ,
    modelScale,
    modelY,
    modelRotationY,
    listeningGlow,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height, display: "block" }}
    />
  );
});

export default TalkingAvatar;
