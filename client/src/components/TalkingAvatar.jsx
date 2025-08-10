// client/src/components/TalkingAvatar.jsx
import React, { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMUtils } from "@pixiv/three-vrm";

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
    avatarUrl = "/avatars/husain.glb",
    requestHeaders = null,
    width = 360,
    height = 520,          // taller to help show full body
    initialExpression = "neutral",
    showFloor = false,
    envIntensity = 1.0,
    modelScale = 1.0,      // NEW: scale model to fit
    modelY = 0.0,          // NEW: vertical offset (raise/lower)
    cameraZ = 1.6,         // NEW: pull camera back to see more of the body
    onLoaded,              // optional callback
    listeningGlow = false, // NEW: subtle glow while listening
  },
  ref
) {
  const canvasRef = useRef(null);
  const vrmRef = useRef(null);
  const gltfRootRef = useRef(null);
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
      default: break;
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
  function startWave(seconds = 2) { gestureRef.current.wave = true; setTimeout(() => (gestureRef.current.wave = false), seconds * 1000); }
  function startNod(seconds = 1.2) { gestureRef.current.nod = true; setTimeout(() => (gestureRef.current.nod = false), seconds * 1000); }

  useImperativeHandle(ref, () => ({
    setExpression,
    wave: () => startWave(),
    nod: () => startNod(),
    driveMouthFromText: (text) => {
      if (!vrmRef.current) return;
      const timeline = buildVisemeTimelineFromText(text);
      visemesRef.current.timeline = timeline;
      visemesRef.current.startedAt = performance.now();
      visemesRef.current.active = true;
    },
    stopMouth: () => { visemesRef.current.active = false; clearMouth(); },
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

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 100);
    camera.position.set(0, 1.45, cameraZ); // farther back
    cameraRef.current = camera;

    // Lights
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(0.6, 1.2, 0.9);
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
      floor.position.y = -0.05;
      scene.add(floor);
    }

    // Loader
    const loader = new GLTFLoader();
    if (requestHeaders && typeof loader.setRequestHeader === "function") {
      loader.setRequestHeader(requestHeaders);
    }
    loader.load(
      avatarUrl,
      async (gltf) => {
        try {
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
          const vrm = await VRM.from(gltf);
          vrm.scene.traverse((o) => (o.frustumCulled = false));
          // Face camera
          vrm.scene.rotation.y = 0;
          // Frame adjustments
          vrm.scene.position.y = modelY;
          vrm.scene.scale.setScalar(modelScale);
          scene.add(vrm.scene);
          vrmRef.current = vrm;
          gltfRootRef.current = null;
          setExpression(initialExpression);
          onLoaded?.("vrm");
        } catch (e) {
          // Plain glTF
          gltf.scene.traverse((o) => (o.frustumCulled = false));
          gltf.scene.rotation.y = 0;
          gltf.scene.position.y = modelY;
          gltf.scene.scale.setScalar(modelScale);
          scene.add(gltf.scene);
          vrmRef.current = null;
          gltfRootRef.current = gltf.scene;
          onLoaded?.("gltf");
          console.warn("Loaded as plain GLB (no lip‑sync).");
        }
      },
      undefined,
      (err) => console.error("Avatar load failed:", err)
    );

    const tick = () => {
      const dt = clockRef.current.getDelta();

      if (vrmRef.current) {
        gestureRef.current.t += dt;

        const head = vrmRef.current.humanoid?.getBoneNode("head");
        if (gestureRef.current.nod && head) {
          head.rotation.x = Math.sin(gestureRef.current.t * 6) * 0.15;
        }
        const upper = vrmRef.current.humanoid?.getBoneNode("rightUpperArm");
        const lower = vrmRef.current.humanoid?.getBoneNode("rightLowerArm");
        if (gestureRef.current.wave && upper && lower) {
          upper.rotation.z = -1.2;
          lower.rotation.z = Math.sin(gestureRef.current.t * 8) * 0.6;
        }

        // Visemes
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

      // Listening glow (subtle)
      if (listeningGlow) {
        key.intensity = 1.35;
      } else {
        key.intensity = 1.15;
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
  }, [avatarUrl, width, height, showFloor, envIntensity, initialExpression, requestHeaders, modelScale, modelY, cameraZ, listeningGlow, onLoaded]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height, borderRadius: 16 }}
    />
  );
});

export default TalkingAvatar;
