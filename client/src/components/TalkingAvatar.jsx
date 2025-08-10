// client/src/components/TalkingAvatar.jsx
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// -------- fallback text → visemes (unchanged logic, slightly compact) -------
function buildVisemeTimelineFromText(text, totalMs = null) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ").length;
  const est = totalMs ?? Math.max(1400, Math.min(18000, words * 272 * 1.35));
  const map = (c) => {
    c = c.toLowerCase();
    if ("a".includes(c)) return "A";
    if ("e".includes(c)) return "E";
    if ("i".includes(c)) return "I";
    if ("o".includes(c)) return "O";
    if ("u".includes(c)) return "U";
    return "I";
  };
  const chars = clean.replace(/[^a-z]/gi, "") || "aaa";
  const step = est / chars.length;
  return chars.split("").map((c, i) => ({ time: i * step, shape: map(c), value: 0.95, dur: step * 0.88 }));
}

// Heuristic Azure viseme→vowel mapping
function mapAzureVisemeToShape(id) {
  const A = new Set([2, 3, 13, 14]);
  const E = new Set([1, 5, 7]);
  const I = new Set([8, 9]);
  const O = new Set([4, 10, 15]);
  const U = new Set([11, 12]);
  if (A.has(id)) return "A";
  if (E.has(id)) return "E";
  if (I.has(id)) return "I";
  if (O.has(id)) return "O";
  if (U.has(id)) return "U";
  return "I";
}

const TalkingAvatar = forwardRef(function TalkingAvatar(
  {
    avatarUrl = "/avatars/husain.glb",
    width = 360,
    height = 520,
    // these are now *starting* camera/model hints; framing is automatic after load
    cameraZ = 2.0,
    modelScale = 1.0,
    modelY = 0.0,
    modelRotationY = 0,
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
  const synthRef = useRef(null);

  // --- morph helpers
  const findIndex = (dict, name) => {
    if (!dict) return -1;
    if (dict[name] !== undefined) return dict[name];
    const keys = Object.keys(dict);
    const exact = keys.find((k) => k.toLowerCase() === name.toLowerCase());
    if (exact) return dict[exact];
    const contains = keys.find((k) => k.toLowerCase().includes(name.toLowerCase()));
    return contains ? dict[contains] : -1;
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
    const vowels = ["A", "E", "I", "O", "U"];
    if (morphIndexRef.current[shape]?.length) {
      vowels.forEach((nm) =>
        morphIndexRef.current[nm].forEach(({ mesh, idx }) => {
          if (!mesh.morphTargetInfluences) return;
          mesh.morphTargetInfluences[idx] = nm === shape ? value : 0;
        })
      );
    } else {
      morphIndexRef.current.mouthOpen.forEach(({ mesh, idx }) => {
        if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[idx] = value;
      });
    }
  };

  const setExpression = () => clearAllMouth();
  const wave = () => (tRef.current = 0);
  const nod = () => (tRef.current = 0);

  // --- frame the model so the whole body fits and is centered
  function frameModel(root, camera, padding = 1.15) {
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Move model so its center is at the origin
    root.position.x += -center.x;
    root.position.y += -center.y;
    root.position.z += -center.z;

    // Lift so feet touch y=0 (nicer for floor/no floor)
    const feetY = box.min.y - center.y; // relative after recenter
    root.position.y += -feetY;

    // Fit camera distance based on height
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = (size.y * padding) / (2 * Math.tan(fov / 2));
    camera.position.set(0, size.y * 0.5, dist);
    camera.lookAt(new THREE.Vector3(0, size.y * 0.5, 0));
  }

  useImperativeHandle(ref, () => ({
    setExpression,
    wave,
    nod,
    driveMouthStart: (text, totalMs) => {
      const tl = buildVisemeTimelineFromText(text, totalMs);
      visemesRef.current = { timeline: tl, startedAt: performance.now(), active: true };
    },
    setMouthByChar: (ch) => {
      const c = (ch || "").toLowerCase();
      const shape = "aeiou".includes(c) ? c.toUpperCase() : "I";
      setMouthShape(shape, 1.0);
    },
    stopMouth: () => {
      visemesRef.current.active = false;
      clearAllMouth();
      try { synthRef.current?.close(); } catch {}
      synthRef.current = null;
    },

    // ---- Azure Speech + visemes ----
    async speakAzure(text, getToken, { muted = false, voice = "en-IN-PrabhatNeural", rate = "-5%" } = {}) {
      try {
        // kill previous
        try { synthRef.current?.close(); } catch {}
        synthRef.current = null;

        const { token, region } = await getToken();
        const speechConfig = sdk.SpeechConfig.fromAuthorizationToken(token, region);
        speechConfig.speechSynthesisVoiceName = voice;

        const audioConfig = muted ? null : sdk.AudioConfig.fromDefaultSpeakerOutput();
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig || undefined);
        synthRef.current = synthesizer;

        synthesizer.visemeReceived = (_s, e) => {
          const shape = mapAzureVisemeToShape(e.visemeId);
          setMouthShape(shape, 1.0);
          setTimeout(() => clearAllMouth(), 70);
        };

        const ssml = `
<speak version="1.0" xml:lang="en-US">
  <voice name="${voice}">
    <prosody rate="${rate}">${(text || "").replace(/&/g, "&amp;")}</prosody>
  </voice>
</speak>`.trim();

        await new Promise((resolve) => {
          synthesizer.speakSsmlAsync(
            ssml,
            () => {
              try { synthesizer.close(); } catch {}
              synthRef.current = null;
              resolve(true);
            },
            (err) => {
              console.error("Azure speak error:", err);
              try { synthesizer.close(); } catch {}
              synthRef.current = null;
              resolve(false);
            }
          );
        });
        clearAllMouth();
      } catch (err) {
        console.error("Azure synth failed:", err);
        throw err;
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
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1 })
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
        root.traverse((o) => (o.frustumCulled = false));
        root.rotation.y = modelRotationY;
        root.scale.setScalar(modelScale);
        root.position.y = modelY;

        // collect morphs
        root.traverse((obj) => {
          if (obj.isMesh || obj.isSkinnedMesh) registerMorphTargets(obj);
        });

        scene.add(root);
        avatarRootRef.current = root;

        // *** center and frame the model for full-body view ***
        frameModel(root, cam, 1.18);

        // first expression
        setExpression(initialExpression);
      },
      undefined,
      (err) => console.error("Failed to load avatar:", err)
    );

    const tick = () => {
      const dt = clockRef.current.getDelta();
      tRef.current += dt;
      glowTRef.current += dt;

      if (avatarRootRef.current) {
        // subtle idle motion
        avatarRootRef.current.rotation.x = Math.sin(tRef.current * 0.6) * 0.02;
        // listening pulse
        const s = listeningGlow ? 1 + Math.sin(glowTRef.current * 3.0) * 0.012 : 1;
        avatarRootRef.current.scale.setScalar(s);
      }

      // fallback timeline
      const v = visemesRef.current;
      if (v.active && v.timeline.length) {
        const elapsed = performance.now() - v.startedAt;
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

    // handle resize so the canvas aspect stays correct
    const onResize = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.round(r.width || width);
      const h = Math.round(r.height || height);
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(rafRef.current);
      try { synthRef.current?.close(); } catch {}
      renderer.dispose();
    };
  }, [avatarUrl, width, height, cameraZ, modelScale, modelY, modelRotationY, showFloor, envIntensity, listeningGlow, initialExpression]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width, height, display: "block" }} />;
});

export default TalkingAvatar;
