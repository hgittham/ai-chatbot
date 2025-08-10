import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMUtils } from "@pixiv/three-vrm";

// Build a simple viseme timeline from text (A/I/U/E/O) for free lip‑sync
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
  return chars.split("").map((c, i) => ({
    time: i * step,
    shape: mapChar(c),
    value: 0.95,
    dur: step * 0.85,
  }));
}

const TalkingAvatar = forwardRef(function TalkingAvatar(
  {
    avatarUrl = "/avatars/husain.glb",     // place your file in client/public/avatars/
    requestHeaders = null,                 // e.g. { "X-API-Key": "RPM_..." } if using RPM
    width = 360,
    height = 420,
    initialExpression = "neutral",
    showFloor = false,
    envIntensity = 1.0,
  },
  ref
) {
  const canvasRef = useRef(null);
  const vrmRef = useRef(null);            // holds VRM instance (null if plain GLB)
  const gltfRootRef = useRef(null);       // holds GLTF scene when not VRM
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const clockRef = useRef(new THREE.Clock());
  const rafRef = useRef(0);

  const visemesRef = useRef({ timeline: [], startedAt: 0, active: false });
  const gestureRef = useRef({ wave: false, nod: false, t: 0 });

  function setAllExpressions(value = 0) {
    const vrm = vrmRef.current;
    if (!vrm?.blendShapeProxy) return;
    const p = vrm.blendShapeProxy;
    ["Joy", "Sorrow", "Angry", "Fun", "Blink", "Blink_L", "Blink_R"].forEach((k) => {
      try { p.setValue(k, value); } catch {}
    });
  }

  function setExpression(mode = "neutral") {
    const vrm = vrmRef.current;
    if (!vrm?.blendShapeProxy) return;
    const p = vrm.blendShapeProxy;
    setAllExpressions(0);
    switch (mode) {
      case "happy": p.setValue("Joy", 0.85); break;
      case "surprised": p.setValue("O", 0.95); p.setValue("Fun", 0.35); break;
      case "thinking": p.setValue("Sorrow", 0.2); p.setValue("Blink", 0.15); break;
      default: break; // neutral
    }
  }

  function setMouthShape(shape, value = 0.9) {
    const vrm = vrmRef.current;
    if (!vrm?.blendShapeProxy) return;
    const p = vrm.blendShapeProxy;
    ["A", "I", "U", "E", "O"].forEach((s) => {
      try { p.setValue(s, s === shape ? value : 0); } catch {}
    });
  }

  function clearMouth() { setMouthShape("A", 0); }

  function startWave(seconds = 2) {
    gestureRef.current.wave = true;
    setTimeout(() => (gestureRef.current.wave = false), seconds * 1000);
  }

  function startNod(seconds = 1.2) {
    gestureRef.current.nod = true;
    setTimeout(() => (gestureRef.current.nod = false), seconds * 1000);
  }

  // Public API for parent
  useImperativeHandle(ref, () => ({
    setExpression,
    wave: () => startWave(),
    nod: () => startNod(),
    driveMouthFromText: (text) => {
      if (!vrmRef.current) return; // lipsync only when VRM available
      const timeline = buildVisemeTimelineFromText(text);
      visemesRef.current.timeline = timeline;
      visemesRef.current.startedAt = performance.now();
      visemesRef.current.active = true;
    },
    stopMouth: () => { visemesRef.current.active = false; clearMouth(); },
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
    // scene.background = new THREE.Color(0x111111); // uncomment to debug background
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(0, 1.45, 1.25);
    cameraRef.current = camera;

    // Lights
    const light1 = new THREE.DirectionalLight(0xffffff, 1.1);
    light1.position.set(0.5, 1.2, 0.8);
    scene.add(light1);
    const light2 = new THREE.DirectionalLight(0xffffff, 0.6);
    light2.position.set(-0.5, 0.8, -0.6);
    scene.add(light2);
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

    // Loader (attach headers if using RPM)
    const loader = new GLTFLoader();
    if (requestHeaders && typeof loader.setRequestHeader === "function") {
      loader.setRequestHeader(requestHeaders);
    }

    loader.load(
      avatarUrl,
      async (gltf) => {
        try {
          // Try to treat as VRM
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          const vrm = await VRM.from(gltf);
          vrm.scene.traverse((o) => (o.frustumCulled = false));
          vrm.scene.rotation.y = 0;
          scene.add(vrm.scene);
          vrmRef.current = vrm;
          gltfRootRef.current = null;
          setExpression(initialExpression);
          console.log("Loaded avatar as VRM");
        } catch (e) {
          // Fallback: plain GLTF scene (visible, but no VRM lipsync/expressions)
          console.warn("Not a VRM; using plain GLTF scene (no lip‑sync).", e);
          gltf.scene.traverse((o) => (o.frustumCulled = false));
          gltf.scene.rotation.y = 0;
          scene.add(gltf.scene);
          vrmRef.current = null;
          gltfRootRef.current = gltf.scene;
        }
      },
      undefined,
      (err) => {
        console.error("Avatar load failed:", err);
      }
    );

    // Animation loop
    const tick = () => {
      const dt = clockRef.current.getDelta();

      // Gestures (only meaningful for VRM models with humanoid rig)
      if (vrmRef.current) {
        gestureRef.current.t += dt;

        // Head nod — three-vrm v2: access bones by string names
        const head = vrmRef.current.humanoid?.getBoneNode("head");
        if (gestureRef.current.nod && head) {
          head.rotation.x = Math.sin(gestureRef.current.t * 6) * 0.15;
        }

        // Hand wave (right arm)
        const upper = vrmRef.current.humanoid?.getBoneNode("rightUpperArm");
        const lower = vrmRef.current.humanoid?.getBoneNode("rightLowerArm");
        if (gestureRef.current.wave && upper && lower) {
          upper.rotation.z = -1.2;
          lower.rotation.z = Math.sin(gestureRef.current.t * 8) * 0.6;
        }

        // Mouth timeline (only when VRM + blendshapes exist)
        const v = visemesRef.current;
        if (v.active && v.timeline.length) {
          const elapsed = performance.now() - v.startedAt;
          const key = v.timeline.findLast((k) => elapsed >= k.time);
          if (key) {
            if (elapsed <= key.time + key.dur) setMouthShape(key.shape, key.value);
            else clearMouth();
          }
          const last = v.timeline[v.timeline.length - 1];
          if (elapsed > last.time + last.dur + 120) { v.active = false; clearMouth(); }
        }

        vrmRef.current.update(dt);
      }

      // (Plain GLB branch has no special updates here)
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // Cleanup
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
  }, [avatarUrl, width, height, showFloor, envIntensity, initialExpression, requestHeaders]);

  return <canvas ref={canvasRef} width={width} height={height} style={{ width, height }} />;
});

export default TalkingAvatar;
