// client/src/components/TalkingAvatar.jsx
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// ---- conservative text fallback (unchanged) ----
function buildVisemeTimelineFromText(text, totalMs = null) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ").length;
  const est = totalMs ?? Math.max(1400, Math.min(18000, words * 272 * 1.35));
  const mapChar = (ch) => {
    const c = ch.toLowerCase();
    if ("a".includes(c)) return "A";
    if ("e".includes(c)) return "E";
    if ("i".includes(c)) return "I";
    if ("o".includes(c)) return "O";
    if ("u".includes(c)) return "U";
    return "I";
  };
  const chars = clean.replace(/[^a-z]/gi, "") || "aaa";
  const step = est / chars.length;
  return chars.split("").map((c, i) => ({
    time: i * step,
    shape: mapChar(c),
    value: 0.95,
    dur: step * 0.88,
  }));
}

// Rough mapping Azure visemeId -> vowel mouth shapes
// (Azure viseme IDs are phoneme groups; this buckets common vowels)
function mapAzureVisemeToShape(id) {
  // These buckets are heuristic and work well enough for RPM-style avatars
  const A = new Set([2, 3, 13, 14]);          // aa, ah, aw, ay
  const E = new Set([1, 5, 7]);               // ae, eh, ey
  const I = new Set([8, 9]);                  // ih, iy
  const O = new Set([4, 10, 15]);             // ao, ow, oy
  const U = new Set([11, 12]);                // uh, uw
  if (A.has(id)) return "A";
  if (E.has(id)) return "E";
  if (I.has(id)) return "I";
  if (O.has(id)) return "O";
  if (U.has(id)) return "U";
  return "I"; // consonants → small mouth
}

const TalkingAvatar = forwardRef(function TalkingAvatar(
  {
    avatarUrl = "/avatars/husain.glb",
    width = 320,
    height = 420,
    cameraZ = 1.85,
    modelScale = 1.14,
    modelY = -0.44,
    modelRotationY = 0, // use Math.PI if you ever see the back of the head
    showFloor = false,
    envIntensity = 1.0,
    listeningGlow = false,
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

  const morphIndexRef = useRef({ A: [], E: [], I: [], O: [], U: [], mouthOpen: [] });
  const visemesRef = useRef({ timeline: [], startedAt: 0, active: false });
  const rafRef = useRef(0);
  const tRef = useRef(0);
  const glowTRef = useRef(0);

  // speech SDK synthesizer handle (so we can stop if needed)
  const synthRef = useRef(null);

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
    const d = mesh.morphTargetDictionary;
    if (!d) return;
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
    Object.values(morphIndexRef.current).forEach((arr) =>
      arr.forEach(({ mesh, idx }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = 0;
      })
    );
  };

  const setMouthShape = (shape, value = 1.0) => {
    const vowelNames = ["A", "E", "I", "O", "U"];
    if (morphIndexRef.current[shape]?.length) {
      vowelNames.forEach((nm) =>
        morphIndexRef.current[nm].forEach(({ mesh, idx }) => {
          if (!mesh.morphTargetInfluences) return;
          mesh.morphTargetInfluences[idx] = nm === shape ? value : 0;
        })
      );
      return;
    }
    // fallback
    morphIndexRef.current.mouthOpen.forEach(({ mesh, idx }) => {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = value;
    });
  };

  const setExpression = () => {
    // keep simple for generic GLBs
    clearAllMouth();
  };

  const wave = () => {
    tRef.current = 0;
  };
  const nod = () => {
    tRef.current = 0;
  };

  useImperativeHandle(ref, () => ({
    setExpression,
    wave,
    nod,
    driveMouthStart: (text, totalMs) => {
      const tl = buildVisemeTimelineFromText(text, totalMs);
      visemesRef.current = { timeline: tl, startedAt: performance.now(), active: true };
    },
    setMouthByChar: (ch) => {
      // not used when Azure is active; kept for fallback
      const c = (ch || "").toLowerCase();
      const shape = "aeiou".includes(c) ? c.toUpperCase() : "I";
      setMouthShape(shape, 1.0);
    },
    stopMouth: () => {
      visemesRef.current.active = false;
      clearAllMouth();
    },

    // ---- NEW: Azure Speech with visemes ----
    async speakAzure(text, getToken, { muted = false, voice = "en-IN-PrabhatNeural", rate = "+0%" } = {}) {
      try {
        // stop any previous run
        synthRef.current?.close();
        synthRef.current = null;

        const { token, region } = await getToken();
        const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
        speechConfig.speechSynthesisVoiceName = voice;
        // Speed tweak (SSML rate) – we’ll do it via SSML below

        // Output: system default speaker
        const audioConfig = muted
          ? null // don’t play audio when muted
          : sdk.AudioConfig.fromDefaultSpeakerOutput();

        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig || undefined);
        synthRef.current = synthesizer;

        // Request visemes
        synthesizer.visemeReceived = (_s, e) => {
          // e.visemeId matches Azure tables; bucket to mouth shapes
          const shape = mapAzureVisemeToShape(e.visemeId);
          setMouthShape(shape, 1.0);
          // short hold then relax (helps consonants)
          setTimeout(() => clearAllMouth(), 70);
        };

        // Build SSML so we can control speaking rate (keeps lips closer to audio pace)
        const ssml = `
<speak version="1.0" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="${rate}">${text.replace(/&/g, "&amp;")}</prosody>
  </voice>
</speak>`.trim();

        await new Promise((resolve) => {
          synthesizer.speakSsmlAsync(
            ssml,
            result => {
              synthesizer.close();
              synthRef.current = null;
              resolve(true);
            },
            error => {
              console.error("Azure speak error:", error);
              synthesizer.close();
              synthRef.current = null;
              resolve(false);
            }
          );
        });
        clearAllMouth();
      } catch (err) {
        console.error("Azure synth failed:", err);
      }
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const cam = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    cam.position.set(0, 1.45, cameraZ);
    cameraRef.current = cam;

    scene.add(new THREE.DirectionalLight(0xffffff, 1.1)).position.set(0.5, 1.2, 0.8);
    scene.add(new THREE.DirectionalLight(0xffffff, 0.6)).position.set(-0.5, 0.8, -0.6);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6 * envIntensity));

    if (showFloor) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 1 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      scene.add(floor);
    }

    const loader = new GLTFLoader();
    loader.load(
      avatarUrl,
      (gltf) => {
        const root = gltf.scene;
        root.traverse(o => (o.frustumCulled = false));
        root.rotation.y = modelRotationY;
        root.scale.setScalar(modelScale);
        root.position.y = modelY;

        // Register morph targets
        root.traverse((obj) => {
          if (obj.isMesh || obj.isSkinnedMesh) registerMorphTargets(obj);
        });

        scene.add(root);
        avatarRootRef.current = root;
      },
      undefined,
      (err) => console.error("Failed to load avatar:", err)
    );

    const tick = () => {
      const dt = clockRef.current.getDelta();
      tRef.current += dt;
      glowTRef.current += dt;

      if (avatarRootRef.current) {
        // idle micro motion
        avatarRootRef.current.rotation.x = Math.sin(tRef.current * 0.6) * 0.02;
        // listening pulse
        const s = listeningGlow ? 1 + Math.sin(glowTRef.current * 3.0) * 0.012 : 1;
        avatarRootRef.current.scale.setScalar(modelScale * s);
      }

      // fallback text timeline
      const v = visemesRef.current;
      if (v.active && v.timeline.length) {
        const now = performance.now();
        const elapsed = now - v.startedAt;
        let key = null;
        for (let i = v.timeline.length - 1; i >= 0; i--) {
          if (elapsed >= v.timeline[i].time) { key = v.timeline[i]; break; }
        }
        if (key) {
          if (elapsed <= key.time + key.dur) setMouthShape(key.shape, key.value);
          else clearAllMouth();
        }
        const last = v.timeline[v.timeline.length - 1];
        if (elapsed > last.time + last.dur + 120) {
          v.active = false;
          clearAllMouth();
        }
      }

      renderer.render(scene, cam);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
    };
  }, [
    avatarUrl, width, height, cameraZ, modelScale, modelY,
    modelRotationY, showFloor, envIntensity, listeningGlow
  ]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width, height, display: "block" }} />;
});

export default TalkingAvatar;
