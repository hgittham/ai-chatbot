// client/src/components/TalkingAvatar.jsx
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Build a simple viseme timeline from text (free mode) */
function buildVisemeTimelineFromText(text, totalMs = null) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const words = clean.split(" ").length;
  const estTotal = totalMs ?? Math.max(1200, Math.min(12000, words * 333));

  const mapChar = (ch) => {
    ch = ch.toLowerCase();
    if ("a".includes(ch)) return "A";
    if ("e".includes(ch)) return "E";
    if ("i".includes(ch)) return "I";
    if ("o".includes(ch)) return "O";
    if ("u".includes(ch)) return "U";
    return Math.random() < 0.5 ? "I" : "U";
  };

  const chars = clean.replace(/[^a-z]/gi, "") || "aaa";
  const step = estTotal / chars.length;

  return chars.split("").map((c, idx) => ({
    time: idx * step,
    shape: mapChar(c),
    value: 1.0,
    dur: step * 0.8
  }));
}

const TalkingAvatar = forwardRef(function TalkingAvatar(
  {
    avatarUrl = "/avatars/husain.glb",
    width = 320,
    height = 440,
    initialExpression = "neutral",
    cameraZ = 1.85,
    modelScale = 1.14,
    modelY = -0.44,
    modelRotationY = 0,
    showFloor = false,
    envIntensity = 1.0,
    listeningGlow = false // when true, subtle scale pulse
  },
  ref
) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const avatarRef = useRef(null);

  // all skinned/meshes to manipulate morph targets
  const morphMeshesRef = useRef([]);
  // indices for various mouth shapes across meshes
  const morphIndexRef = useRef({
    A: [], E: [], I: [], O: [], U: [], mouthOpen: []
  });

  // text-based viseme state
  const visemesRef = useRef({ timeline: [], startedAt: 0, active: false });
  const rafRef = useRef(0);
  const tRef = useRef(0);
  const glowTRef = useRef(0);

  /** Helpers to discover morph target indices on a mesh */
  const getIndex = (dict, name) => {
    if (!dict) return -1;
    const keys = Object.keys(dict);
    // exact
    if (dict[name] !== undefined) return dict[name];
    // case-insensitive
    const k = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (k) return dict[k];
    // contains
    const contains = keys.find((k) => k.toLowerCase().includes(name.toLowerCase()));
    if (contains) return dict[contains];
    return -1;
  };

  const discoverMorphTargets = (mesh) => {
    if (!mesh.morphTargetDictionary) return;
    const d = mesh.morphTargetDictionary;

    const tryNames = (candidates) => {
      for (const nm of candidates) {
        const idx = getIndex(d, nm);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    // Try common sets
    // visemes
    const A = tryNames(["viseme_aa", "A"]);
    const E = tryNames(["viseme_e", "E"]);
    const I = tryNames(["viseme_ih", "I"]);
    const O = tryNames(["viseme_oh", "O"]);
    const U = tryNames(["viseme_uh", "U"]);
    const mouthOpen = tryNames(["mouthOpen", "MouthOpen", "mouth_open"]);

    // Store any found
    if (A >= 0) morphIndexRef.current.A.push({ mesh, idx: A });
    if (E >= 0) morphIndexRef.current.E.push({ mesh, idx: E });
    if (I >= 0) morphIndexRef.current.I.push({ mesh, idx: I });
    if (O >= 0) morphIndexRef.current.O.push({ mesh, idx: O });
    if (U >= 0) morphIndexRef.current.U.push({ mesh, idx: U });
    if (mouthOpen >= 0) morphIndexRef.current.mouthOpen.push({ mesh, idx: mouthOpen });
  };

  const clearAllMouth = () => {
    const sets = Object.values(morphIndexRef.current);
    sets.forEach((arr) => {
      arr.forEach(({ mesh, idx }) => {
        if (!mesh.morphTargetInfluences) return;
        mesh.morphTargetInfluences[idx] = 0;
      });
    });
  };

  const setMouthShape = (shape, value = 1.0) => {
    const names = ["A", "E", "I", "O", "U"];
    // if we have explicit shape
    if (morphIndexRef.current[shape]?.length) {
      names.forEach((nm) => {
        const arr = morphIndexRef.current[nm];
        arr.forEach(({ mesh, idx }) => {
          if (!mesh.morphTargetInfluences) return;
          mesh.morphTargetInfluences[idx] = nm === shape ? value : 0;
        });
      });
      return;
    }
    // fallback to mouthOpen if no vowels
    const arr = morphIndexRef.current.mouthOpen;
    if (arr.length) {
      arr.forEach(({ mesh, idx }) => {
        mesh.morphTargetInfluences[idx] = value;
      });
    }
  };

  const setExpression = (mode = "neutral") => {
    // For plain GLB, we don’t have named emotions.
    // We can emulate with eyebrows/eyes if present; most RPM GLBs don’t expose those.
    // Keep it simple: neutral clears mouth; the “expression” is subtle head nod/wave.
    clearAllMouth();
  };

  const wave = () => {
    tRef.current = 0; // reused for a simple wave anim
  };

  const nod = () => {
    tRef.current = 0; // reused for a nod anim
  };

  // Public API
  useImperativeHandle(ref, () => ({
    setExpression,
    wave,
    nod,
    driveMouthFromText: (text) => {
      const tl = buildVisemeTimelineFromText(text);
      visemesRef.current.timeline = tl;
      visemesRef.current.startedAt = performance.now();
      visemesRef.current.active = true;
    },
    stopMouth: () => {
      visemesRef.current.active = false;
      clearAllMouth();
    }
  }));

  useEffect(() => {
    const canvas = canvasRef.current;

    // Renderer/Scene/Camera
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6 * envIntensity));

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
        // make sure nothing gets frustum-culled
        root.traverse((o) => (o.frustumCulled = false));

        // Face camera (some RPM models import backwards)
        root.rotation.y = modelRotationY;

        root.scale.setScalar(modelScale);
        root.position.y = modelY;

        // collect meshes with morph targets
        const morphMeshes = [];
        root.traverse((obj) => {
          if (obj.isMesh || obj.isSkinnedMesh) {
            morphMeshes.push(obj);
            discoverMorphTargets(obj);
          }
        });
        morphMeshesRef.current = morphMeshes;

        scene.add(root);
        avatarRef.current = root;

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

      // listening glow = subtle breathing scale
      if (avatarRef.current && listeningGlow) {
        const s = 1 + Math.sin(glowTRef.current * 3.0) * 0.015;
        avatarRef.current.scale.setScalar(modelScale * s);
      } else if (avatarRef.current) {
        avatarRef.current.scale.setScalar(modelScale);
      }

      // very tiny idle motion
      if (avatarRef.current) {
        avatarRef.current.rotation.x = Math.sin(tRef.current * 0.6) * 0.02;
      }

      // speech visemes
      const v = visemesRef.current;
      if (v.active && v.timeline.length) {
        const elapsed = performance.now() - v.startedAt;
        // find the latest key we passed
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
  }, [avatarUrl, width, height, showFloor, envIntensity, initialExpression, cameraZ, modelScale, modelY, listeningGlow]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width, height }} />;
});

export default TalkingAvatar;
