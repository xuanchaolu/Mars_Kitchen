/* 火星小厨房 3D 虚拟形象模块（three.js + @pixiv/three-vrm）
 * 用 esbuild 打包成 renderer/js/avatar.bundle.js，向渲染进程暴露 window.NiuAvatar3D
 * 职责：加载 VRM、渲染循环、待机动作（呼吸/眨眼/摆动）、口型同步、表情
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

/** 口型速度：0.5 很慢 … 1.0 正常 … 1.5 快（影响每个口型覆盖的字数与过渡平滑度）*/
let MOUTH_SPEED = 0.75;
const setMouthSpeed = (v) => { MOUTH_SPEED = Math.max(0.4, Math.min(1.6, Number(v) || 0.75)); };
const getMouthSpeed = () => MOUTH_SPEED;
/** 每个口型平均覆盖的字符数（速度越慢覆盖越多，嘴动越少） */
const charsPerViseme = () => Math.max(1, Math.round(2 / MOUTH_SPEED));
// 静止姿态：VRM 模型默认是 T-pose（手臂侧平举），这里把手臂放下来
// 数值由骨骼实测确定：上臂 z≈∓1.32 时手臂自然下垂（离肩横向 0.15m、低于肩 0.50m）
// 肘部 y 轴向为弯曲方向（负值 = 前臂向前）
let REST = {
  lUpper: { x: 0.12, y: 0.10, z: -1.32 },
  rUpper: { x: 0.12, y: -0.10, z: 1.32 },
  lLower: { x: 0.0, y: -0.34, z: -0.12 },
  rLower: { x: 0.0, y: 0.34, z: 0.12 },
  lShoulder: { x: 0, y: 0.04, z: -0.04 },
  rShoulder: { x: 0, y: -0.04, z: 0.04 },
};

// 说话时口型的自然交替序列（aa 为张口，占比更高，看起来更像在说话）
const VISEME_CYCLE = ['aa', 'ih', 'aa', 'ou', 'aa', 'ee', 'oh', 'aa'];
const PUNCT = /[，。！？、；：,.!?;:…—（）()「」《》"'"'~·]/;
const SPACE = /[\s\u3000]/;

function pickViseme(ch, i) {
  if (PUNCT.test(ch) || SPACE.test(ch)) return null;
  const code = ch.codePointAt(0) || 0;
  // 交替序列为主，叠加字符码点的轻微扰动，避免机械重复
  return VISEME_CYCLE[(i + (code % 3)) % VISEME_CYCLE.length];
}

/** 把一串可读字符切成若干口型（每个口型覆盖 charsPerViseme 个字，带幅度差异） */
function pushChunkVisemes(track, chars, startIdx, durMs) {
  const group = charsPerViseme();
  let i = 0;
  while (i < chars.length) {
    const slice = chars.slice(i, i + group);
    const share = slice.length / chars.length;
    const d = Math.max(90, durMs * share);
    // 幅度在 0.55~0.98 之间变化：形状有差异但句中不完全闭嘴（避免"抖动"观感）
    const amp = 0.55 + ((startIdx + i) % 4) * 0.11 + (slice.length > 2 ? 0.08 : 0);
    track.push({ v: pickViseme(slice[0], startIdx + i), d, a: Math.min(0.98, amp) });
    i += group;
  }
  return startIdx + chars.length;
}

/** 纯文本估算口型轨道（无词边界时使用） */
function buildVisemeTrack(text) {
  const track = [];
  const chars = Array.from(String(text || ''));
  let buf = [];
  let idx = 0;
  const flush = (dur) => {
    if (!buf.length) return;
    idx = pushChunkVisemes(track, buf, idx, dur || buf.length * 220);
    buf = [];
  };
  for (const ch of chars) {
    if (SPACE.test(ch)) { flush(); track.push({ v: null, d: 90 }); continue; }
    if (PUNCT.test(ch)) { flush(); track.push({ v: null, d: 200 }); continue; }
    buf.push(ch);
  }
  flush();
  return track;
}

/** 用 Edge TTS 词边界时间轴构建轨道：与音频时间一致，标点/句间闭口，句中只换形状不闭嘴 */
function buildTrackFromBoundaries(boundaries, totalMs, fallbackText) {
  if (!boundaries || !boundaries.length) {
    const t = buildVisemeTrack(fallbackText || '');
    const total = t.reduce((a, s) => a + s.d, 0);
    if (totalMs && total > 0) {
      const k = totalMs / total;
      t.forEach((s) => { s.d = Math.max(45, Math.round(s.d * k)); });
    }
    return t;
  }
  const track = [];
  let cursor = 0;
  let idx = 0;
  for (const b of boundaries) {
    const start = Math.max(0, Number(b.startMs) || 0);
    const end = Math.max(start + 40, Number(b.endMs) || (start + 300));
    if (start > cursor + 20) track.push({ v: null, d: start - cursor }); // 句间停顿 → 闭口
    const chars = Array.from(String(b.text || ''));
    // 拆成“标点分隔的片段”：片段内只换口型不闭嘴，标点处短暂闭口
    let seg = [];
    let segStart = start;
    let offset = 0;
    const total = end - start;
    for (const ch of chars) {
      if (PUNCT.test(ch) || SPACE.test(ch)) {
        const segDur = total * (seg.length / Math.max(1, chars.length));
        if (seg.length) { idx = pushChunkVisemes(track, seg, idx, segDur); seg = []; }
        track.push({ v: null, d: Math.max(80, total * 0.06) }); // 标点：短暂闭口
        offset += seg.length + 1;
      } else {
        seg.push(ch);
      }
    }
    if (seg.length) {
      const segDur = total * (seg.length / Math.max(1, chars.length));
      idx = pushChunkVisemes(track, seg, idx, segDur);
    }
    // 若标点闭口占时略超，按实际时间兜底（保证轨道总长≈音频长度）
    const trackLen = track.reduce((a, s) => a + s.d, 0);
    const targetSoFar = end;
    if (trackLen < targetSoFar - 30) track.push({ v: null, d: targetSoFar - trackLen });
    cursor = end;
  }
  const trackLen = track.reduce((a, s) => a + s.d, 0);
  if (totalMs && trackLen < totalMs - 20) track.push({ v: null, d: totalMs - trackLen });
  return track;
}

function createAvatarRenderer(canvas, opts = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,   // 允许读取画面像素（调参/自检用）
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // 灯光：MToon 卡通材质需要主光 + 环境光
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(1.0, 2.2, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe4d6, 0.42);
  fill.position.set(-1.6, 1.2, 1.0);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  // —— 面部柔光组：正面主面光 + 面部补光 + 背后轮廓光 ——
  const faceLightGroup = new THREE.Group();
  const faceKey = new THREE.DirectionalLight(0xfff7ee, 0.55);   // 柔和暖白，正面偏右上（强度经实测标定）
  const faceFill = new THREE.DirectionalLight(0xfff0e6, 0.28);  // 冷白补光，正面偏左
  const rimLight = new THREE.DirectionalLight(0xffd9c8, 0.25);  // 轮廓光，背后（增加立体感）
  [faceKey, faceFill, rimLight].forEach((l) => {
    l.target.position.set(0, 1.4, 0);
    faceLightGroup.add(l);
    faceLightGroup.add(l.target);
  });
  scene.add(faceLightGroup);
  let faceLightOn = true;
  let faceIntensity = { key: 0.55, fill: 0.28, rim: 0.25 };
  const setFaceLight = (on) => {
    faceLightOn = !!on;
    faceLightGroup.visible = faceLightOn;
    return faceLightOn;
  };
  /** 调参用：直接设置面光强度 */
  const setFaceLightIntensity = (k, f, r) => {
    faceIntensity = { key: Number(k), fill: Number(f), rim: Number(r) };
    faceKey.intensity = faceIntensity.key;
    faceFill.intensity = faceIntensity.fill;
    rimLight.intensity = faceIntensity.rim;
    return faceIntensity;
  };
  /** 调参用：测量画面中央（面部）区域的亮度统计 */
  const measureCanvas = () => {
    try {
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const W = c.width, H = c.height;
      const x0 = Math.floor(W * 0.28), x1 = Math.floor(W * 0.72);
      const y0 = Math.floor(H * 0.14), y1 = Math.floor(H * 0.44);
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let sum = 0, n = 0, clip = 0, dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;                     // 透明背景跳过
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        sum += lum; n++;
        if (lum > 250) clip++;
        if (lum < 60) dark++;
      }
      return n ? { mean: +(sum / n).toFixed(1), n, clipPct: +(100 * clip / n).toFixed(2), darkPct: +(100 * dark / n).toFixed(2) } : null;
    } catch (e) { return { error: String(e.message) }; }
  };

  const avatarPivot = new THREE.Group();   // 水平旋转用
  scene.add(avatarPivot);

  let vrm = null;
  let clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;

  // —— 动画状态 ——
  // —— 水平旋转（拖动）——
  const MAX_YAW = 1.75;          // ±100°
  let yaw = 0;
  let yawTarget = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartYaw = 0;
  let dragMoved = 0;

  const st = {
    mode: 'idle',          // idle | thinking | speaking
    t: 0,
    blinkTimer: 2 + Math.random() * 3,
    blinkPhase: -1,        // -1 表示未在眨眼
    mouth: 0,              // 当前口型开合
    mouthTarget: 0,
    viseme: null,
    track: [],
    trackTotal: 0,
    speechElapsed: 0,
    speaking: false,
    visemeNames: null,     // {aa:'aa', ...} 按模型实际表情名解析（兼容 VRM 0.x 的 a/i/u/e/o）
    nod: 0,
    tilt: 0,
    lookX: 0,
    lookY: 0,
    gesture: { active: false, side: 1, t: 0, dur: 0.9, next: 2.5 },
    gestureAmount: 0,
    targetLookX: 0,
    targetLookY: 0,
    ready: false,
  };

  const lookTarget = new THREE.Object3D();
  avatarPivot.add(lookTarget);

  function resize() {
    const w = canvas.clientWidth || 300;
    const h = canvas.clientHeight || 400;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  /** 加载 VRM（传入 ArrayBuffer，避开 file:// 读取限制） */
  function load(arrayBuffer) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      loader.parse(
        arrayBuffer,
        '',
        (gltf) => {
          try {
            const model = gltf.userData.vrm;
            if (!model) { reject(new Error('不是有效的 VRM 文件')); return; }
            VRMUtils.rotateVRM0(model); // VRM 0.x 需转向，1.0 无副作用
            vrm = model;
            avatarPivot.add(vrm.scene);

            // —— 相机取景：三分之四身，露出裙摆 ——
            // 依据模型包围盒与画布宽高比自动计算距离，避免窄面板把裙子裁掉
            const box = new THREE.Box3().setFromObject(vrm.scene);
            const size = box.getSize(new THREE.Vector3());
            const height = size.y || 1.6;
            const topY = box.max.y;
            const bottomY = box.min.y;
            const focusY = topY - height * 0.135;          // 脸部高度（灯光/视线用）
            const targetY = bottomY + height * 0.665;      // 取景中心（约胸口下方）
            const frameH = height * 0.73;                  // 画幅覆盖：约 0.30h ~ 1.03h
            const vFov = (camera.fov * Math.PI) / 180;
            const aspect = (canvas.clientWidth || 300) / (canvas.clientHeight || 420) || 0.42;
            const distV = (frameH / 2) / Math.tan(vFov / 2);
            const frameW = height * 0.30;                  // 需容纳的最大宽度（裙摆/手）
            const distH = (frameW / 2) / (Math.tan(vFov / 2) * aspect);
            const dist = Math.max(distV, distH) * 1.07;    // 留 7% 边距
            camera.position.set(0, targetY + frameH * 0.045, dist);
            camera.lookAt(0, targetY, 0);
            lookTarget.position.set(0, focusY, 0.8);

            if (vrm.lookAt) {
              vrm.lookAt.target = lookTarget;
              if ('autoUpdate' in vrm.lookAt) vrm.lookAt.autoUpdate = true;
            }
            // 解析该模型实际可用的口型/眨眼表情名（VRM 1.0: aa/ih/ou/ee/oh；VRM 0.x: a/i/u/e/o）
            resolveExpressionNames(model);
            // 面部灯光位置按人物高度摆放（面部正前方略上方）
            faceKey.position.set(0.32, focusY + 0.28, 1.30);
            faceKey.target.position.set(0, focusY - 0.02, 0);
            faceFill.position.set(-0.62, focusY + 0.06, 1.10);
            faceFill.target.position.set(0, focusY - 0.04, 0);
            rimLight.position.set(-0.45, focusY + 0.50, -1.30);
            rimLight.target.position.set(0, focusY + 0.1, 0);

            // 自动校准手臂静止姿态（各模型骨骼朝向不同）
            try { st.poseCalibration = calibrateRestPose(); } catch (e) { st.poseCalibration = null; }
            // 关闭视锥剔除，避免 VRM 网格在部分角度消失
            vrm.scene.traverse((o) => { o.frustumCulled = false; });

            st.ready = true;
            bindDragRotate();
            resize();
            startLoop();
            resolve(model);
          } catch (e) {
            reject(e);
          }
        },
        (err) => reject(err instanceof Error ? err : new Error('加载 VRM 失败'))
      );
    });
  }

  // —— 骨骼辅助 ——
  function bone(name) {
    return vrm && vrm.humanoid ? vrm.humanoid.getNormalizedBoneNode(name) : null;
  }

  const setBoneRot = (name, r) => {
    const b = bone(name);
    if (b && r) { b.rotation.x = r.x || 0; b.rotation.y = r.y || 0; b.rotation.z = r.z || 0; }
  };

  /** 立即应用整套静止姿态（探测/调参用；渲染循环每帧也会应用） */
  function applyPoseNow(pose) {
    const P = pose || REST;
    setBoneRot('leftUpperArm', P.lUpper);
    setBoneRot('rightUpperArm', P.rUpper);
    setBoneRot('leftLowerArm', P.lLower);
    setBoneRot('rightLowerArm', P.rLower);
    setBoneRot('leftShoulder', P.lShoulder);
    setBoneRot('rightShoulder', P.rShoulder);
    if (vrm) vrm.scene.updateMatrixWorld(true);
  }

  /** 载入后自动校准手臂静止姿态：不同模型骨骼朝向可能相反，逐一试出「手在肩下且贴身」的方案 */
  function calibrateRestPose() {
    const saved = JSON.parse(JSON.stringify(REST));
    const lowerFor = (z, side) => {
      // side: -1 左臂, +1 右臂；肘部弯曲方向与上臂方向一致
      const dir = z < 0 ? -1 : 1;
      return { x: 0, y: dir * 0.34 * (side < 0 ? -1 : 1) * (dir < 0 ? 1 : -1) * (side < 0 ? 1 : -1), z: dir * 0.12 * (side < 0 ? -1 : 1) };
    };
    // 上臂方向 × 前臂弯曲方向 组合：前臂**必须左右镜像**（否则会出现"一只手抬起/甩到身后"）
    const UPPER = [
      { tag: 'z负', lz: -1.32, rz: 1.32 },
      { tag: 'z正', lz: 1.32, rz: -1.32 },
      { tag: 'z负-缓', lz: -1.05, rz: 1.05 },
      { tag: 'z正-缓', lz: 1.05, rz: -1.05 },
    ];
    const BEND = [{ tag: 'F', b: 1 }, { tag: 'B', b: -1 }];
    let best = null;
    let bestScore = -Infinity;
    const report = [];
    for (const u of UPPER) {
      for (const bd of BEND) {
        const pose = {
          lUpper: { x: 0.12, y: 0.10, z: u.lz },
          rUpper: { x: 0.12, y: -0.10, z: u.rz },
          // 镜像：左臂取负号、右臂取正号，弯曲方向由 b 决定
          lLower: { x: 0, y: -0.34 * bd.b, z: -0.12 * bd.b },
          rLower: { x: 0, y: 0.34 * bd.b, z: 0.12 * bd.b },
          lShoulder: saved.lShoulder,
          rShoulder: saved.rShoulder,
        };
        applyPoseNow(pose);
        const m = measureBones();
        if (!m.leftHand || !m.leftShoulder || !m.rightHand || !m.rightShoulder) continue;
        const drop = ((m.leftShoulder.y - m.leftHand.y) + (m.rightShoulder.y - m.rightHand.y)) / 2;
        const out = (Math.abs(m.leftHand.x - m.leftShoulder.x) + Math.abs(m.rightHand.x - m.rightShoulder.x)) / 2;
        const asymY = Math.abs(m.leftHand.y - m.rightHand.y);
        const asymZ = Math.abs(m.leftHand.z - m.rightHand.z);
        const forward = (m.leftHand.z + m.rightHand.z) / 2;   // 手越靠前越好（背后为负）
        let score = drop;
        if (drop < 0) score -= 2.5 * Math.abs(drop);          // 手高于肩 → 强烈惩罚
        score -= Math.max(0, out - 0.32) * 2;                 // 太外张（仍是侧平举）
        score -= Math.max(0, 0.06 - out) * 1.5;               // 过度贴身（可能穿模）
        score -= asymY * 4 + asymZ * 3;                       // 左右不对称 → 惩罚
        score -= Math.max(0, -forward - 0.02) * 1.2;          // 手甩到身后 → 惩罚
        report.push({
          tag: u.tag + '/' + bd.tag, drop: +drop.toFixed(3), out: +out.toFixed(3),
          asym: +(asymY + asymZ).toFixed(3), fwd: +forward.toFixed(3), score: +score.toFixed(3),
        });
        if (score > bestScore) { bestScore = score; best = pose; }
      }
    }
    if (best) REST = Object.assign(saved, best);
    applyPoseNow(REST);
    return report;
  }

  function measureBones() {
    const world = (name) => {
      const b = bone(name);
      if (!b) return null;
      const v = new THREE.Vector3();
      b.getWorldPosition(v);
      return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) };
    };
    return {
      leftShoulder: world('leftShoulder'), rightShoulder: world('rightShoulder'),
      leftHand: world('leftHand'), rightHand: world('rightHand'),
      hips: world('hips'), head: world('head'),
    };
  }

  function setExpression(name, weight) {
    if (!vrm || !vrm.expressionManager || !name) return;
    try { vrm.expressionManager.setValue(name, weight); } catch (_) {}
  }

  const VISEME_ALIASES = {
    aa: ['aa', 'a', 'A', 'vowel_a', 'mouth_a'],
    ih: ['ih', 'i', 'I', 'vowel_i', 'mouth_i'],
    ou: ['ou', 'u', 'U', 'vowel_u', 'mouth_u'],
    ee: ['ee', 'e', 'E', 'vowel_e', 'mouth_e'],
    oh: ['oh', 'o', 'O', 'vowel_o', 'mouth_o'],
  };

  /** 找出模型上真实存在的表情名，写入 st.visemeNames / st.blinkName */
  function resolveExpressionNames(model) {
    const em = model && model.expressionManager;
    const names = {};
    st.visemeNames = {};
    st.blinkName = null;
    if (!em) return;
    const has = (n) => {
      try { return !!em.getExpression(n); } catch (_) { return false; }
    };
    for (const key of Object.keys(VISEME_ALIASES)) {
      const found = VISEME_ALIASES[key].find(has);
      if (found) st.visemeNames[key] = found;
    }
    st.blinkName = ['blink', 'Blink', 'blink_l', 'blinkLeft'].find(has) || null;
    st.availableExpressions = [];
    try {
      const map = em.expressionMap || {};
      st.availableExpressions = Object.keys(map);
    } catch (_) {}
  }

  function startLoop() {
    if (raf) return;
    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      update(dt);
    };
    raf = requestAnimationFrame(tick);
  }

  function update(dt) {
    if (!vrm) return;
    st.t += dt;

    // 水平旋转（拖动后平滑跟随）
    yaw += (yawTarget - yaw) * Math.min(1, dt * 12);
    avatarPivot.rotation.y = yaw;

    // ---------- 口型（按绝对时间推进，每个元音开合一次）----------
    if (st.speaking) {
      st.speechElapsed += dt * 1000;
      let acc = 0;
      let seg = null;
      let segStart = 0;
      for (let i = 0; i < st.track.length; i++) {
        const s0 = st.track[i];
        if (st.speechElapsed < acc + s0.d) { seg = s0; segStart = acc; break; }
        acc += s0.d;
      }
      if (seg && seg.v) {
        const p = seg.d ? (st.speechElapsed - segStart) / seg.d : 0;
        // 柔和包络：句中从不到零（只变形状），避免"抖动"观感
        const env = 0.45 + 0.55 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, p))), 0.85);
        st.viseme = seg.v;
        st.mouthTarget = (0.10 + 0.78 * env) * (seg.a || 1);
      } else {
        st.viseme = null;
        st.mouthTarget = 0;      // 停顿/标点：完全闭口
      }
      if (!seg) {               // 轨道播完
        st.speaking = false;
        st.viseme = null;
        st.mouthTarget = 0;
      }
    } else {
      st.viseme = null;
      st.mouthTarget = 0;
    }

    // 平滑过渡：速度可调（越慢越柔）
    const k = Math.min(1, dt * (7 + 7 * MOUTH_SPEED));
    st.mouth += (st.mouthTarget - st.mouth) * k;
    if (st.mouth < 0.008 && st.mouthTarget === 0) st.mouth = 0;

    // 关键：每帧只让「当前」口型打开，其余元音强制归零，避免多个口型叠加卡住
    const vn = st.visemeNames || {};
    let applied = false;
    for (const key of VISEMES) {
      const name = vn[key];
      if (!name) continue;
      applied = true;
      setExpression(name, key === st.viseme ? st.mouth : 0);
    }
    if (!applied && st.viseme) setExpression(st.viseme, st.mouth);

    // ---------- 眨眼 ----------
    st.blinkTimer -= dt;
    if (st.blinkPhase < 0 && st.blinkTimer <= 0) {
      st.blinkPhase = 0;
      st.blinkTimer = 2.4 + Math.random() * 3.6;
    }
    if (st.blinkPhase >= 0) {
      st.blinkPhase += dt;
      const p = st.blinkPhase / 0.16;
      const val = p < 0.5 ? p * 2 : Math.max(0, 2 - p * 2);
      setExpression(st.blinkName || 'blink', Math.min(1, val));
      if (p >= 1) { st.blinkPhase = -1; setExpression(st.blinkName || 'blink', 0); }
    }

    // ---------- 姿态（呼吸 + 摆动 + 说话点头）----------
    const head = bone('head');
    const neck = bone('neck');
    const spine = bone('spine');
    const chest = bone('chest');
    const hips = bone('hips');

    const breathe = Math.sin(st.t * 1.15) * 0.014;
    const sway = Math.sin(st.t * 0.62) * 0.05;
    const sway2 = Math.sin(st.t * 0.41 + 1.3) * 0.035;

    // 说话时按音节点头 + 思考时轻微侧头
    if (st.mode === 'speaking') {
      st.nod = Math.sin(st.t * 7.5) * 0.022 * (0.4 + st.mouth);
      st.tilt = Math.sin(st.t * 1.1) * 0.02;
    } else if (st.mode === 'thinking') {
      st.nod = Math.sin(st.t * 1.6) * 0.012;
      st.tilt = 0.06 + Math.sin(st.t * 0.9) * 0.02;
    } else {
      st.nod += (0 - st.nod) * Math.min(1, dt * 3);
      st.tilt += (0 - st.tilt) * Math.min(1, dt * 3);
    }

    if (head) {
      head.rotation.x = -breathe * 0.6 + st.nod + Math.sin(st.t * 0.9) * 0.012;
      head.rotation.y = sway * 0.8 + st.lookX * 0.25;
      head.rotation.z = st.tilt;
    }
    if (neck) {
      neck.rotation.x = st.nod * 0.35 + Math.sin(st.t * 0.8) * 0.01;
      neck.rotation.y = sway * 0.35;
    }
    if (chest) chest.rotation.x = breathe;
    if (spine) {
      spine.rotation.x = breathe * 0.6;
      spine.rotation.z = sway2 * 0.25;
      spine.rotation.y = sway2 * 0.3;
    }
    if (hips) hips.rotation.z = sway2 * 0.12;

    // ---------- 手臂：静止姿态 + 说话时小幅手势 ----------
    // 手势调度：说话中每隔几秒做一次小幅抬手动作
    if (st.mode === 'speaking') {
      if (!st.gesture.active) {
        st.gesture.next -= dt;
        if (st.gesture.next <= 0) {
          st.gesture.active = true;
          st.gesture.t = 0;
          st.gesture.dur = 0.8 + Math.random() * 0.7;
          st.gesture.side = Math.random() < 0.5 ? 1 : -1;   // 1=左臂 2=右臂
          st.gesture.next = 2.2 + Math.random() * 2.6;
        }
      } else {
        st.gesture.t += dt;
        if (st.gesture.t >= st.gesture.dur) { st.gesture.active = false; st.gesture.t = 0; }
      }
    } else {
      st.gesture.active = false;
      st.gesture.t = 0;
      st.gesture.next = 1.6;
    }
    const gp = st.gesture.active ? Math.sin(Math.PI * (st.gesture.t / st.gesture.dur)) : 0;
    st.gestureAmount += (gp - st.gestureAmount) * Math.min(1, dt * 10);

    // 说话时的细微摆动（非手势）
    const talkSway = st.mode === 'speaking' ? Math.sin(st.t * 3.1) * 0.018 * (0.4 + st.mouth) : 0;
    const idleSway = Math.sin(st.t * 0.55) * 0.02;

    const lArm = bone('leftUpperArm');
    const rArm = bone('rightUpperArm');
    const lFore = bone('leftLowerArm');
    const rFore = bone('rightLowerArm');
    const lShoulder = bone('leftShoulder');
    const rShoulder = bone('rightShoulder');

    // 手势作用在左臂（side=1）或右臂（side=-1）上：抬起即让 z 靠近 0
    const lLift = st.gestureAmount * (st.gesture.side === 1 ? 0.42 : 0.0);
    const rLift = st.gestureAmount * (st.gesture.side === -1 ? 0.42 : 0.0);

    const setBone = (b, x, y, z) => { if (b) { b.rotation.x = x; b.rotation.y = y; b.rotation.z = z; } };
    setBone(lArm, REST.lUpper.x + talkSway, REST.lUpper.y + idleSway * 0.5, REST.lUpper.z + lLift + talkSway * 0.6);
    setBone(rArm, REST.rUpper.x + talkSway, REST.rUpper.y - idleSway * 0.5, REST.rUpper.z - rLift - talkSway * 0.6);
    setBone(lFore, REST.lLower.x, REST.lLower.y - lLift * 0.5, REST.lLower.z + lLift * 0.3);
    setBone(rFore, REST.rLower.x, REST.rLower.y + rLift * 0.5, REST.rLower.z - rLift * 0.3);
    setBone(lShoulder, REST.lShoulder.x, REST.lShoulder.y, REST.lShoulder.z - lLift * 0.25);
    setBone(rShoulder, REST.rShoulder.x, REST.rShoulder.y, REST.rShoulder.z + rLift * 0.25);

    // 视线：缓慢靠近目标（跟随鼠标或轻微游移）
    st.lookX += (st.targetLookX - st.lookX) * Math.min(1, dt * 3);
    st.lookY += (st.targetLookY - st.lookY) * Math.min(1, dt * 3);
    if (vrm.lookAt) {
      const focusY = 1.33;
      lookTarget.position.set(st.lookX * 0.9, focusY + 0.05 + st.lookY * 0.45, 1.0);
    }

    // 表情：思考/开心微表情
    if (st.mode === 'thinking') setExpression('relaxed', 0.45);
    else if (st.mode === 'speaking') setExpression('relaxed', 0.25);
    else setExpression('relaxed', 0.18);

    vrm.update(dt);

    resize();
    renderer.render(scene, camera);
  }

  // —— 拖动旋转交互 ——
  function bindDragRotate() {
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      dragStartX = e.clientX;
      dragStartYaw = yawTarget;
      dragMoved = 0;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - dragStartX;
      dragMoved = Math.max(dragMoved, Math.abs(dx));
      // 0.011 弧度/像素 ≈ 拖动 160px 转 100°
      yawTarget = Math.max(-MAX_YAW, Math.min(MAX_YAW, dragStartYaw + dx * 0.011));
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = 'grab';
    });
    // 双击复位到正面
    canvas.addEventListener('dblclick', (e) => { e.preventDefault(); yawTarget = 0; dragMoved = 0; });
  }

  // ---------- 对外接口 ----------
  return {
    load,
    resize,
    isReady: () => st.ready,
    setMood(mode) {
      st.mode = mode === 'speaking' || mode === 'thinking' ? mode : 'idle';
    },
    /** 开始说话：按文本生成口型轨道 */
    /** 开始说话：优先用词边界时间轴，其次按文本+音频时长估算 */
    beginSpeech(text, opts) {
      const o = opts || {};
      const track = buildTrackFromBoundaries(o.boundaries, o.durationMs, text);
      st.track = track;
      st.trackTotal = track.reduce((a, s) => a + s.d, 0);
      st.speechElapsed = 0;
      st.viseme = null;
      st.mouth = 0;
      st.speaking = true;
      st.mode = 'speaking';
    },
    /** 轮廓剖面（调参用）：按高度分带统计模型最大半宽，用于定位裙摆等 */
    silhouette(bands) {
      if (!vrm) return null;
      const n = bands || 40;
      const box = new THREE.Box3().setFromObject(vrm.scene);
      const h = box.max.y - box.min.y || 1;
      const out = new Array(n).fill(0);
      const v = new THREE.Vector3();
      vrm.scene.updateMatrixWorld(true);
      vrm.scene.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
        const pos = o.geometry.attributes.position;
        const step = Math.max(1, Math.floor(pos.count / 4000));   // 抽样，避免慢
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i);
          o.localToWorld(v);
          const band = Math.floor((v.y - box.min.y) / h * n);
          if (band >= 0 && band < n) out[band] = Math.max(out[band], Math.abs(v.x));
        }
      });
      return { minY: +box.min.y.toFixed(3), maxY: +box.max.y.toFixed(3), height: +h.toFixed(3),
               bandHeight: +(h / n).toFixed(4),
               widths: out.map((w) => +w.toFixed(3)) };
    },
    /** 姿态探测（调参与自检用）：应用姿态补丁并回读骨骼世界坐标
     *  兼容旧签名 probePose(lz, rz) —— 只调上臂 z 轴 */
    probePose(patch, rzLegacy) {
      if (!vrm) return null;
      const prev = REST;
      let pose;
      if (typeof patch === 'number') {
        const z = patch;
        const zr = typeof rzLegacy === 'number' ? rzLegacy : -z;
        pose = Object.assign({}, REST, {
          lUpper: Object.assign({}, REST.lUpper, { z }),
          rUpper: Object.assign({}, REST.rUpper, { z: zr }),
        });
      } else {
        pose = Object.assign({}, REST, patch || {});
      }
      applyPoseNow(pose);
      const out = measureBones();
      applyPoseNow(prev);
      return out;
    },
    /** 覆盖静止姿态（调参用） */
    setRestPose(patch) {
      REST = Object.assign({}, REST, patch || {});
      return REST;
    },
    getRestPose: () => JSON.parse(JSON.stringify(REST)),
    /** 结束说话：立即闭口（所有口型强制归零，避免说完嘴不合上）*/
    endSpeech() {
      st.speaking = false;
      st.mouthTarget = 0;
      st.mouth = 0;
      st.viseme = null;
      st.mode = 'idle';
      const vn = st.visemeNames || {};
      for (const key of VISEMES) if (vn[key]) setExpression(vn[key], 0);
      // 未解析出标准口型名时，兜底把常见名一并归零
      ['aa', 'ih', 'ou', 'ee', 'oh', 'a', 'i', 'u', 'e', 'o'].forEach((n) => setExpression(n, 0));
    },
    /** 语音进度回调用：按已读字符数重新对齐口型轨道 */
    syncSpeech(charIndex) {
      if (!st.speaking) return;
      st.trackIdx = Math.min(Math.max(0, charIndex | 0), Math.max(0, st.track.length - 1));
      st.trackElapsed = 0;
    },
    setExpression,
    setFaceLight,
    setFaceLightIntensity,
    measureCanvas,
    setMouthSpeed,
    getMouthSpeed,
    /** 鼠标移动 → 视线跟随（-1..1）；拖动旋转时不跟随 */
    look(dx, dy) {
      if (dragging) return;
      st.targetLookX = Math.max(-1, Math.min(1, dx || 0));
      st.targetLookY = Math.max(-1, Math.min(1, dy || 0));
    },
    /** 是否刚发生过拖动（用于区分"点击"与"拖动"）*/
    wasDragged: () => dragMoved > 4,
    setYaw(rad) { yawTarget = Math.max(-MAX_YAW, Math.min(MAX_YAW, Number(rad) || 0)); return yawTarget; },
    getYaw: () => yaw,
    stats() {
      let meshes = 0;
      let bones = 0;
      if (vrm) {
        vrm.scene.traverse((o) => { if (o.isMesh) meshes++; if (o.isBone) bones++; });
      }
      let pose = null;
      if (vrm) {
        const m = measureBones();
        const { leftShoulder: ls, leftHand: lh, rightShoulder: rs, rightHand: rh, hips: hp } = m;
        if (ls && lh && rs && rh && hp) {
          pose = {
            handBelowShoulder: +(((ls.y - lh.y) + (rs.y - rh.y)) / 2).toFixed(3),   // 正值 = 手在肩下方
            handOutward: +((Math.abs(lh.x - ls.x) + Math.abs(rh.x - rs.x)) / 2).toFixed(3), // 越小 = 越贴身
            handVsHips: +(((lh.y - hp.y) + (rh.y - hp.y)) / 2).toFixed(3),
            leftHand: lh, rightHand: rh, shoulderY: ls.y, hipsY: hp.y,
          };
        }
      }
      const bounds = vrm ? (() => {
        const box = new THREE.Box3().setFromObject(vrm.scene);
        return { minY: +box.min.y.toFixed(3), maxY: +box.max.y.toFixed(3), height: +(box.max.y - box.min.y).toFixed(3) };
      })() : null;
      const vis = {};
      const vn = st.visemeNames || {};
      for (const key of VISEMES) {
        const name = vn[key];
        if (!name) continue;
        let w = 0;
        try { w = vrm.expressionManager.getValue(name) || 0; } catch (_) {}
        vis[key] = +Number(w).toFixed(3);
      }
      return {
        ready: st.ready,
        bounds,
        camera: { y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3), fov: camera.fov, aspect: +camera.aspect.toFixed(3) },
        pose,
        visemes: vis,
        visemeMap: vn,
        visemeOpenCount: Object.values(vis).filter((x) => x > 0.05).length,
        yaw: +yaw.toFixed(3),
        yawDeg: Math.round((yaw * 180) / Math.PI),
        mouthSpeed: MOUTH_SPEED,
        faceLight: faceLightOn,
        charsPerViseme: charsPerViseme(),
        availableExpressions: st.availableExpressions || [],
        poseCalibration: st.poseCalibration || null,
        version: vrm && vrm.meta ? (vrm.meta.metaVersion || '1.0') : null,
        name: vrm && vrm.meta ? vrm.meta.name : null,
        meshes,
        bones,
        expressions: vrm && vrm.expressionManager ? Object.keys(vrm.expressionManager.expressionMap || {}).length : 0,
        speaking: st.speaking,
        mood: st.mode,
        mouth: Number(st.mouth.toFixed(3)),
      };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      if (vrm) {
        scene.remove(vrm.scene);
        if (VRMUtils.deepDispose) VRMUtils.deepDispose(vrm.scene);
        vrm = null;
      }
      renderer.dispose();
    },
  };
}

window.NiuAvatar3D = { create: createAvatarRenderer, buildVisemeTrack };
