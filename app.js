import * as THREE from './vendor/three/three.module.js';

/* ============================================================================
   ① 配置区：改树、改文字，基本只动这里
   ========================================================================== */
const CONFIG = {
  text: {
    kicker:    '2026 · CHRISTMAS',
    title:     '璀璨圣诞树',
    subtitle:  'Merry Christmas<br>愿你想见的人，都在光里',
    signature: '— 送给每一个还在等雪的人'
  },

  tree: {
    height:   14,       // 树高（相机距离按这个来）
    radius:   5.4,      // 底部半径，越大越"胖"
    count:    1300,     // 粒子数：400 轻 / 1300 标准 / 2600 密
    spin:     0.0016,   // 自转速度
    surface:  0.90,     // 粒子贴树面的程度：0.7 实心，0.95 空心
    thickness:0.20,     // 树面随机厚度
    colors: {           // 配色（改成金红系就换这四个值）
      core:   '#f4ffe6',
      edge:   '#1ab05a',
      accent: '#ffc93c',
      warm:   '#ff4d3d'
    },
    mix: { warm: 0.07, accent: 0.20 }   // 暖色 / 紫色粒子占比
  },

  lamps:  { count: 160, size: 0.16, spiral: 7 },
  gifts:  { count: 22, ringMin: 6.4, ringMax: 9.8 },
  snow:   { count: 900, radius: 22, top: 22, bottom: -9, speed: 0.55 },
  photo:  { max: 6, orbitRadius: 8.2, focusZ: 14.5 },

  // 手势阈值：ext = 伸展手指数，pinch = 拇指尖↔食指尖 / 掌宽
  gesture: {
    pinchDist: 0.46,   // 小于它算捏合（调大更容易触发）
    stableFrames: 4,   // 连续几帧一致才生效，防抖
    idleBack: 1.6      // 手消失几秒后自动回树
  }
};

/* ============================================================================
   ② 基础工具
   ========================================================================== */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* 文案注入：改 CONFIG.text 就会同步到这里 */
$('kicker').textContent = CONFIG.text.kicker;
$('title').textContent = CONFIG.text.title;
$('subtitle').innerHTML = CONFIG.text.subtitle;
$('signature').textContent = CONFIG.text.signature;
document.title = CONFIG.text.title;

/* ============================================================================
   ③ Three.js 场景
   ========================================================================== */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b2317');
scene.fog = new THREE.FogExp2('#0a2418', 0.013);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 3.4, 27);
camera.lookAt(0, 1.2, 0);

scene.add(new THREE.AmbientLight(0x9fc9a8, 1.15));
const keyLight = new THREE.DirectionalLight(0xfff4dc, 1.4);
keyLight.position.set(8, 14, 10);
scene.add(keyLight);
const baseLight = new THREE.PointLight(0xffe2b0, 22, 40, 2);
baseLight.position.set(0, -7, 0);
scene.add(baseLight);
const topLight = new THREE.PointLight(0xffcf4a, 32, 30, 2);
topLight.position.set(0, 8, 0);
scene.add(topLight);

/* 地面 */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(46, 64),
  new THREE.MeshStandardMaterial({ color: 0x0a1f14, roughness: 0.6, metalness: 0.35 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -CONFIG.tree.height / 2 - 0.9;
scene.add(ground);

/* 地面光晕：让礼盒有"落地"的实感 */
const floorGlow = new THREE.Mesh(
  new THREE.PlaneGeometry(34, 34),
  new THREE.MeshBasicMaterial({
    map: makeGlowTexture(), color: 0xc8a45a, transparent: true,
    opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  })
);
floorGlow.rotation.x = -Math.PI / 2;
floorGlow.position.y = ground.position.y + 0.03;
scene.add(floorGlow);

/* ============================================================================
   ④ 粒子树
   ========================================================================== */
const T = CONFIG.tree;
const N = T.count;

const treePos    = new Float32Array(N * 3);   // 树上坐标
const scatterPos = new Float32Array(N * 3);   // 散开坐标
const curPos     = new Float32Array(N * 3);   // 当前坐标
const aColor     = new Float32Array(N * 3);
const aSize      = new Float32Array(N);

const C = {
  core:   new THREE.Color(T.colors.core),
  edge:   new THREE.Color(T.colors.edge),
  accent: new THREE.Color(T.colors.accent),
  warm:   new THREE.Color(T.colors.warm)
};

const H = T.height, R = T.radius;

for (let i = 0; i < N; i++) {
  const i3 = i * 3;
  // 分层撒点：让粒子聚成一层层枝叶，而不是均匀填满
  const LAYERS = 26;
  const layer = Math.floor(Math.random() * LAYERS);
  const t = (layer + 0.12 + Math.random() * 0.76) / LAYERS;   // 0 底 → 1 顶
  const y = -H / 2 + t * H;

  // 圆锥撒点：半径随高度收缩，再贴到树面附近，留随机厚度
  const ang = Math.random() * Math.PI * 2;
  const tier = 1 + 0.09 * Math.sin(t * Math.PI * 9 + ang * 1.8);   // 分层起伏
  const rad = (1 - t) * R * tier * (T.surface + Math.random() * T.thickness);
  const droop = Math.cos(ang * 3) * 0.24 * (1 - t);         // 枝头下垂，避免完美圆锥

  treePos[i3]     = Math.cos(ang) * rad;
  treePos[i3 + 1] = y + droop + (Math.random() - 0.5) * 0.3;
  treePos[i3 + 2] = Math.sin(ang) * rad;

  // 散开坐标：球壳 + 向上飘
  const sr = 14 + Math.random() * 12;
  const sth = Math.random() * Math.PI * 2;
  const sph = Math.acos(2 * Math.random() - 1);
  scatterPos[i3]     = sr * Math.sin(sph) * Math.cos(sth);
  scatterPos[i3 + 1] = sr * Math.cos(sph) * 0.9 + 3;
  scatterPos[i3 + 2] = sr * Math.sin(sph) * Math.sin(sth);

  curPos[i3]     = treePos[i3];
  curPos[i3 + 1] = treePos[i3 + 1];
  curPos[i3 + 2] = treePos[i3 + 2];

  // 颜色分配
  const pick = Math.random();
  const col = pick < T.mix.warm
    ? C.warm.clone()
    : pick < T.mix.warm + T.mix.accent
      ? C.accent.clone()
      : C.edge.clone().lerp(C.core, Math.random() * 0.65);
  col.multiplyScalar(0.72 + Math.random() * 0.5);
  aColor[i3] = col.r; aColor[i3 + 1] = col.g; aColor[i3 + 2] = col.b;

  aSize[i] = 0.2 + Math.random() * 0.42 + (Math.random() > 0.92 ? 0.5 : 0);
}

const treeGeo = new THREE.BufferGeometry();
treeGeo.setAttribute('position', new THREE.BufferAttribute(curPos, 3).setUsage(THREE.DynamicDrawUsage));
treeGeo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
treeGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

const treeMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:   { value: 0 },
    uAudio:  { value: 0 },
    uScale:  { value: Math.min(window.devicePixelRatio, 2) }
  },
  vertexShader: /* glsl */`
    attribute vec3 aColor;
    attribute float aSize;
    uniform float uTime;
    uniform float uAudio;
    uniform float uScale;
    varying vec3 vColor;
    varying float vGlow;
    void main() {
      vColor = aColor;
      vec3 p = position;
      // 轻微呼吸，避免"死"粒子
      p.y += sin(uTime * 1.1 + p.x * 1.8 + p.z * 1.8) * 0.035;
      p.xz *= 1.0 + uAudio * 0.045;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float s = aSize * (1.0 + uAudio * 0.85);
      gl_PointSize = s * uScale * (300.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
      vGlow = 0.55 + 0.45 * sin(uTime * 2.2 + p.y * 1.4 + p.x * 0.6);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying float vGlow;
    void main() {
      float d = length(gl_PointCoord - vec2(0.5));
      if (d > 0.5) discard;
      float a = smoothstep(0.5, 0.0, d);
      a = pow(a, 1.7);
      vec3 c = vColor * (1.02 + vGlow * 0.42);
      gl_FragColor = vec4(c, a);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

const treePoints = new THREE.Points(treeGeo, treeMat);
treePoints.frustumCulled = false;

const treeGroup = new THREE.Group();
treeGroup.add(treePoints);
scene.add(treeGroup);

/* 树顶星：实心小星 + 径向贴图光晕（不用球体，球体会变成灰盘） */
function makeGlowTexture() {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,244,200,0.95)');
  g.addColorStop(0.42, 'rgba(255,205,90,0.40)');
  g.addColorStop(1, 'rgba(255,170,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const starGroup = new THREE.Group();
starGroup.position.y = H / 2 + 0.55;
const starCore = new THREE.Mesh(
  new THREE.OctahedronGeometry(0.38, 0),
  new THREE.MeshBasicMaterial({ color: 0xfff8d2, toneMapped: false })
);
const starHalo = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(),
  color: 0xffffff,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  opacity: 1.0
}));
starHalo.scale.set(5.2, 5.2, 1);
starGroup.add(starCore, starHalo);
treeGroup.add(starGroup);

/* ============================================================================
   ⑤ 灯带（沿树螺旋的小灯泡）
   ========================================================================== */
const lampCount = CONFIG.lamps.count;
const lampGeo = new THREE.SphereGeometry(CONFIG.lamps.size, 10, 10);
const lampMesh = new THREE.InstancedMesh(
  lampGeo,
  new THREE.MeshBasicMaterial({ toneMapped: false }),
  lampCount
);
lampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
treeGroup.add(lampMesh);

const lampData = [];
const lampPalette = ['#ffcc3d', '#ff4d4d', '#fff6dc', '#3ddc84', '#ffab3d'];
const dummy = new THREE.Object3D();
for (let i = 0; i < lampCount; i++) {
  const t = 0.06 + (i / lampCount) * 0.9;
  const ang = t * Math.PI * 2 * CONFIG.lamps.spiral;
  const rad = (1 - t) * R * 0.99;
  lampData.push({
    x: Math.cos(ang) * rad,
    y: -H / 2 + t * H,
    z: Math.sin(ang) * rad,
    phase: Math.random() * Math.PI * 2,
    color: new THREE.Color(lampPalette[i % lampPalette.length])
  });
  dummy.position.set(lampData[i].x, lampData[i].y, lampData[i].z);
  dummy.scale.setScalar(1);
  dummy.updateMatrix();
  lampMesh.setMatrixAt(i, dummy.matrix);
  lampMesh.setColorAt(i, lampData[i].color);
}
if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;

/* ============================================================================
   ⑥ 礼盒
   ========================================================================== */
const giftCount = CONFIG.gifts.count;
const giftGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
const giftMesh = new THREE.InstancedMesh(
  giftGeo,
  new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.16, emissive: 0x000000, emissiveIntensity: 0, envMapIntensity: 0.4 }),
  giftCount
);
giftMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(giftMesh);

/* 金色缎带：一个长条几何，横竖各一条拼成十字 */
const ribbonMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(0.98, 0.11, 0.11),
  new THREE.MeshStandardMaterial({ color: 0xffd98a, metalness: 1, roughness: 0.22, emissive: 0x3a2a08, emissiveIntensity: 0.32 }),
  giftCount * 2
);
ribbonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(ribbonMesh);

const giftData = [];
const giftPalette = ['#e5332e', '#31c46b', '#e8b93a', '#fff7ea', '#c0181c'];
for (let i = 0; i < giftCount; i++) {
  const ang = (i / giftCount) * Math.PI * 2 + Math.random() * 0.3;
  const rad = CONFIG.gifts.ringMin + Math.random() * (CONFIG.gifts.ringMax - CONFIG.gifts.ringMin);
  giftData.push({
    ang,
    rad,
    y: -H / 2 - 0.35 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
    size: 0.5 + Math.random() * 0.38,
    spin: (Math.random() - 0.5) * 0.4,
    color: new THREE.Color(giftPalette[i % giftPalette.length])
  });
  giftMesh.setColorAt(i, giftData[i].color);
  dummy.position.set(Math.cos(ang) * rad, giftData[i].y, Math.sin(ang) * rad);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(giftData[i].size);
  dummy.updateMatrix();
  giftMesh.setMatrixAt(i, dummy.matrix);
}
if (giftMesh.instanceColor) giftMesh.instanceColor.needsUpdate = true;

/* ============================================================================
   ⑦ 雪
   ========================================================================== */
const snowCount = CONFIG.snow.count;
const snowPos = new Float32Array(snowCount * 3);
const snowVel = new Float32Array(snowCount);
const snowPhase = new Float32Array(snowCount);

for (let i = 0; i < snowCount; i++) {
  const r = Math.sqrt(Math.random()) * CONFIG.snow.radius;
  const a = Math.random() * Math.PI * 2;
  snowPos[i * 3]     = Math.cos(a) * r;
  snowPos[i * 3 + 1] = CONFIG.snow.bottom + Math.random() * (CONFIG.snow.top - CONFIG.snow.bottom);
  snowPos[i * 3 + 2] = Math.sin(a) * r;
  snowVel[i] = 0.5 + Math.random() * 1.1;
  snowPhase[i] = Math.random() * Math.PI * 2;
}

const snowGeo = new THREE.BufferGeometry();
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage));
const snowPoints = new THREE.Points(snowGeo, new THREE.PointsMaterial({
  size: 0.13, color: 0xffffff, transparent: true, opacity: 0.74,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
}));
snowPoints.frustumCulled = false;
scene.add(snowPoints);

/* ============================================================================
   ⑧ 照片
   ========================================================================== */
const photoGroup = new THREE.Group();
scene.add(photoGroup);
const photoItems = [];          // {mesh, id, angle}

function layoutPhoto(item, index) {
  const n = Math.max(photoItems.length, 1);
  const step = Math.PI * 2 / n;
  const ang = index * step + Math.PI / 6;
  item.angle = ang;
  item.orbit = new THREE.Vector3(
    Math.cos(ang) * CONFIG.photo.orbitRadius,
    0.4 + Math.sin(index * 1.7) * 1.9 + 2.4,
    Math.sin(ang) * CONFIG.photo.orbitRadius
  );
  // 弹出后的位置：树顶上方横向排开
  const spread = Math.min(2.5, 9 / n);
  item.focus = new THREE.Vector3(
    (index - (n - 1) / 2) * spread,
    4.1,
    CONFIG.photo.focusZ
  );
}

function refreshLayout() {
  photoItems.forEach((it, i) => layoutPhoto(it, i));
}

function addPhotoToScene(id, source) {
  const img = source;
  const tex = new THREE.Texture(img);
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;

  const ar = (img.width || 1) / (img.height || 1);
  const h = 2.7;
  const w = h * ar;

  const group = new THREE.Group();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, toneMapped: false })
  );
  const frame = new THREE.Mesh(
    new THREE.PlaneGeometry(w + 0.16, h + 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
  );
  frame.position.z = -0.02;
  group.add(frame, plane);

  group.scale.setScalar(1);
  photoGroup.add(group);

  const item = { mesh: group, id, angle: 0, orbit: new THREE.Vector3(), focus: new THREE.Vector3() };
  photoItems.push(item);
  refreshLayout();

  // 初始位置直接放到轨道上，避免从原点飞过来
  item.mesh.position.copy(item.orbit);
  return item;
}

function removePhoto(index) {
  const item = photoItems[index];
  if (!item) return;
  photoGroup.remove(item.mesh);
  item.mesh.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
  photoItems.splice(index, 1);
  refreshLayout();
  renderThumbs();
}

/* ============================================================================
   ⑨ 存储（IndexedDB 存 Blob，换浏览器就没了）
   ========================================================================== */
const DB_NAME = 'aurora-christmas-tree';
let dbPromise = null;
function getDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function dbAll() {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const req = tx.objectStore('photos').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(blob) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const req = tx.objectStore('photos').add({ blob, ts: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbDelete(id) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const req = tx.objectStore('photos').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function renderThumbs() {
  const wrap = $('thumbs');
  wrap.innerHTML = '';
  photoItems.forEach((item, i) => {
    const d = document.createElement('div');
    d.className = 'th';
    const img = document.createElement('img');
    img.src = item.preview || '';
    d.appendChild(img);
    const x = document.createElement('div');
    x.className = 'x';
    x.textContent = '×';
    x.onclick = async () => {
      const id = item.id;
      removePhoto(i);
      if (id != null) await dbDelete(id).catch(() => {});
    };
    d.appendChild(x);
    wrap.appendChild(d);
  });
}

/* ============================================================================
   ⑩ 音频律动
   ========================================================================== */
let audioCtx = null, analyser = null, audioEl = null, freqData = null, audioLevel = 0;

async function loadMusic(file) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume();
    if (audioEl) { audioEl.pause(); audioEl.src = ''; }
    audioEl = new Audio(URL.createObjectURL(file));
    audioEl.loop = true;
    const src = audioCtx.createMediaElementSource(audioEl);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    await audioEl.play();
    toast('音乐已就位 · 树会跟着节拍呼吸');
  } catch (e) {
    toast('音乐加载失败：' + e.message);
  }
}

/* ============================================================================
   ⑪ 手势识别
   ========================================================================== */
const video = $('cam');
const overlay = $('camOverlay');
const octx = overlay.getContext('2d');

const HAND_EDGES = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

let handLandmarker = null;
let handLoopOn = false;
let lastVideoTime = -1;
let lastHandAt = 0;

const G = {
  state: 'IDLE',       // IDLE / FIST / OPEN / PINCH
  candidate: 'IDLE',
  stable: 0,
  raw: 'IDLE'
};

function classify(lm) {
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const wrist = lm[0];
  const handScale = dist(lm[0], lm[9]) + 1e-6;

  // 四指：指尖到腕的距离 > PIP 到腕 → 伸直
  const fingers = [[5, 8], [9, 12], [13, 16], [17, 20]]; // [pip, tip]
  let ext = 0;
  for (const [pip, tip] of fingers) {
    if (dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.08) ext++;
  }

  const pinch = dist(lm[4], lm[8]) / handScale;

  if (pinch < CONFIG.gesture.pinchDist && ext >= 1) return 'PINCH';
  if (ext >= 3) return 'OPEN';
  if (ext <= 1) return 'FIST';
  return G.state;
}

function drawSkeleton(lm) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);
  if (!lm) return;
  const px = p => [(1 - p.x) * w, p.y * h];
  octx.strokeStyle = '#ffd24a';
  octx.lineWidth = 1.6;
  for (const [a, b] of HAND_EDGES) {
    const p1 = px(lm[a]), p2 = px(lm[b]);
    octx.beginPath();
    octx.moveTo(p1[0], p1[1]);
    octx.lineTo(p2[0], p2[1]);
    octx.stroke();
  }
  octx.fillStyle = '#ffffff';
  for (const p of lm) {
    const [x, y] = px(p);
    octx.beginPath();
    octx.arc(x, y, 1.8, 0, Math.PI * 2);
    octx.fill();
  }
}

async function initHandEngine() {
  const boot = $('boot');
  boot.textContent = '手势引擎后台加载中（不影响看树）';
  try {
    const { FilesetResolver, HandLandmarker } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    const opts = {
      baseOptions: { modelAssetPath: './vendor/models/hand_landmarker.task', delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    };
    try {
      handLandmarker = await HandLandmarker.createFromOptions(fileset, opts);
    } catch (e) {
      opts.baseOptions.delegate = 'CPU';
      handLandmarker = await HandLandmarker.createFromOptions(fileset, opts);
    }
    boot.textContent = '手势引擎就绪 · 点「开启手势」';
    setTimeout(() => boot.classList.add('hide'), 1600);
  } catch (e) {
    boot.textContent = '手势引擎加载失败（检查 vendor/mediapipe）';
    console.error(e);
  }
}

async function startCamera() {
  if (!handLandmarker) {
    toast('手势引擎还在后台加载，等十几秒再点一次');
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    $('camState').textContent = 'TRACKING';
    return true;
  } catch (e) {
    $('camState').textContent = 'NO CAMERA';
    toast('摄像头打不开：需要 HTTPS 或 localhost，并允许权限');
    return false;
  }
}

function tickHand() {
  if (!handLoopOn || !handLandmarker || video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  let result;
  try {
    result = handLandmarker.detectForVideo(video, performance.now());
  } catch (e) {
    return;
  }

  const lm = result?.landmarks?.[0];
  if (lm) {
    lastHandAt = performance.now();
    G.raw = classify(lm);

    // 连续帧一致才切换，避免疯狂抖
    if (G.raw === G.candidate) {
      G.stable++;
    } else {
      G.candidate = G.raw;
      G.stable = 1;
    }
    if (G.stable >= CONFIG.gesture.stableFrames && G.state !== G.candidate) {
      G.state = G.candidate;
      applyGesture(G.state);
    }
  } else {
    G.raw = 'IDLE';
    if (performance.now() - lastHandAt > CONFIG.gesture.idleBack * 1000 && G.state !== 'IDLE') {
      G.state = 'IDLE';
      G.candidate = 'IDLE';
      G.stable = 0;
      if (sceneState !== 'TREE') setSceneState('TREE');
    }
  }

  drawSkeleton(lm || null);
  updateBadge();
}

function updateBadge() {
  const names = { IDLE: 'IDLE', FIST: '握拳 · 成树', OPEN: '摊手 · 散开', PINCH: '捏指 · 弹照片' };
  const hints = {
    IDLE: '未识别到手',
    FIST: 'FIST → 汇聚',
    OPEN: 'OPEN → 星云',
    PINCH: 'PINCH → 相片'
  };
  // 只在值变化时写 DOM，省一点开销
  const label = names[G.state] || 'IDLE';
  const hint = hints[G.state] || '';
  if ($('gName').textContent !== label) $('gName').textContent = label;
  if ($('gHint').textContent !== hint) $('gHint').textContent = hint;
}

/* ============================================================================
   ⑫ 场景状态机
   ========================================================================== */
let sceneState = 'TREE';

function setSceneState(next) {
  if (sceneState === next) return;
  sceneState = next;
}

function applyGesture(g) {
  if (g === 'FIST') {
    setSceneState('TREE');
  } else if (g === 'OPEN') {
    setSceneState('SPREAD');
  } else if (g === 'PINCH') {
    if (photoItems.length === 0) {
      toast('还没有照片，先点「添加照片」');
      setSceneState('TREE');
    } else {
      setSceneState('PHOTO');
    }
  }
}

/* ============================================================================
   ⑬ 交互绑定
   ========================================================================== */
$('btnHand').addEventListener('click', async () => {
  const btn = $('btnHand');
  if (handLoopOn) {
    handLoopOn = false;
    btn.classList.remove('on');
    btn.textContent = '开启手势';
    $('camState').textContent = 'PAUSED';
    octx.clearRect(0, 0, overlay.width, overlay.height);
    return;
  }
  const ok = await startCamera();
  if (ok) {
    handLoopOn = true;
    btn.classList.add('on');
    btn.textContent = '手势运行中';
    toast('握拳成树 · 摊手散开 · 捏指弹照片');
  }
});

$('btnPhotos').addEventListener('click', () => $('filePhotos').click());
$('btnMusic').addEventListener('click', () => $('fileMusic').click());

/* 手动模式：没摄像头 / 手机上也能切状态 */
document.querySelectorAll('[data-gesture]').forEach(btn => {
  btn.addEventListener('click', () => applyGesture(btn.dataset.gesture));
});

$('filePhotos').addEventListener('change', async e => {
  const files = [...e.target.files].slice(0, CONFIG.photo.max);
  for (const file of files) {
    if (photoItems.length >= CONFIG.photo.max) { toast(`最多 ${CONFIG.photo.max} 张照片`); break; }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      const id = await dbPut(file);
      const item = addPhotoToScene(id, img);
      item.preview = url;
      renderThumbs();
      toast(`已添加 ${photoItems.length} 张照片`);
    } catch (err) {
      toast('这张照片读不出来：' + err.message);
    }
  }
  e.target.value = '';
});

$('fileMusic').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  await loadMusic(file);
  e.target.value = '';
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============================================================================
   ⑭ 主循环
   ========================================================================== */
const clock = new THREE.Clock();
const pointer = { x: 0, y: 0 };
window.addEventListener('pointermove', e => {
  pointer.x = e.clientX / window.innerWidth - 0.5;
  pointer.y = e.clientY / window.innerHeight - 0.5;
});

function animate() {
  requestAnimationFrame(animate);
  try {
    renderFrame();
  } catch (err) {
    console.error('[tree] frame error:', err && err.message ? err.message : err);
  }
}

function renderFrame() {
  const delta = Math.min(clock.getDelta(), 0.06);
  const t = clock.elapsedTime;
  const dt = delta;

  /* 音频能量 */
  let target = 0;
  if (analyser && freqData && !audioEl?.paused) {
    analyser.getByteFrequencyData(freqData);
    let sum = 0;
    // 只看低频段，节拍更明显
    const n = Math.floor(freqData.length * 0.45);
    for (let i = 0; i < n; i++) sum += freqData[i];
    target = sum / n / 255;
  }
  audioLevel += (target - audioLevel) * 0.12;
  const pulse = audioLevel > 0.02 ? audioLevel : 0.28 + 0.12 * Math.sin(t * 1.5);

  /* 粒子 */
  const lerpK = sceneState === 'SPREAD' ? 0.045 : 0.06;
  for (let i = 0; i < N; i++) {
    const i3 = i * 3;
    const tx = sceneState === 'SPREAD' ? scatterPos[i3] : treePos[i3];
    const ty = sceneState === 'SPREAD' ? scatterPos[i3 + 1] : treePos[i3 + 1];
    const tz = sceneState === 'SPREAD' ? scatterPos[i3 + 2] : treePos[i3 + 2];
    curPos[i3]     += (tx - curPos[i3]) * lerpK;
    curPos[i3 + 1] += (ty - curPos[i3 + 1]) * lerpK;
    curPos[i3 + 2] += (tz - curPos[i3 + 2]) * lerpK;
  }
  treeGeo.attributes.position.needsUpdate = true;
  treeMat.uniforms.uTime.value = t;
  treeMat.uniforms.uAudio.value = pulse;
  treeGroup.rotation.y += T.spin;

  /* 灯带闪烁 */
  for (let i = 0; i < lampCount; i++) {
    const d = lampData[i];
    const fl = 0.55 + 0.45 * Math.sin(t * 2.4 + d.phase) + pulse * 0.55;
    dummy.position.set(d.x, d.y, d.z);
    dummy.scale.setScalar(clamp(fl, 0.5, 1.9));
    dummy.updateMatrix();
    lampMesh.setMatrixAt(i, dummy.matrix);
  }
  lampMesh.instanceMatrix.needsUpdate = true;

  /* 礼盒 */
  const giftSpread = sceneState === 'SPREAD' ? 1.55 : 1.0;
  for (let i = 0; i < giftCount; i++) {
    const g = giftData[i];
    const rad = g.rad * giftSpread;
    const gx = Math.cos(g.ang + t * 0.06) * rad;
    const gy = g.y + Math.sin(t * 0.9 + g.phase) * 0.22;
    const gz = Math.sin(g.ang + t * 0.06) * rad;
    const rot = t * g.spin + g.phase;

    dummy.position.set(gx, gy, gz);
    dummy.rotation.set(0, rot, 0);
    dummy.scale.setScalar(g.size);
    dummy.updateMatrix();
    giftMesh.setMatrixAt(i, dummy.matrix);

    // 缎带：横条 + 竖条
    dummy.rotation.set(0, rot, 0);
    dummy.updateMatrix();
    ribbonMesh.setMatrixAt(i * 2, dummy.matrix);
    dummy.rotation.set(0, rot, Math.PI / 2);
    dummy.updateMatrix();
    ribbonMesh.setMatrixAt(i * 2 + 1, dummy.matrix);
  }
  giftMesh.instanceMatrix.needsUpdate = true;
  ribbonMesh.instanceMatrix.needsUpdate = true;

  /* 雪 */
  const snowArr = snowGeo.attributes.position.array;
  for (let i = 0; i < snowCount; i++) {
    const i3 = i * 3;
    snowArr[i3 + 1] -= snowVel[i] * dt * CONFIG.snow.speed * 10;
    snowArr[i3]     += Math.sin(t * 0.8 + snowPhase[i]) * 0.012;
    snowArr[i3 + 2] += Math.cos(t * 0.6 + snowPhase[i]) * 0.012;
    if (snowArr[i3 + 1] < CONFIG.snow.bottom) {
      const r = Math.sqrt(Math.random()) * CONFIG.snow.radius;
      const a = Math.random() * Math.PI * 2;
      snowArr[i3]     = Math.cos(a) * r;
      snowArr[i3 + 1] = CONFIG.snow.top;
      snowArr[i3 + 2] = Math.sin(a) * r;
    }
  }
  snowGeo.attributes.position.needsUpdate = true;

  /* 照片：轨道 / 弹出 */
  for (let i = 0; i < photoItems.length; i++) {
    const item = photoItems[i];
    const targetPos = sceneState === 'PHOTO' ? item.focus : item.orbit;
    item.mesh.position.lerp(targetPos, sceneState === 'PHOTO' ? 0.1 : 0.075);
    const targetScale = sceneState === 'PHOTO' ? 1.35 : 1.0;
    const s = item.mesh.scale.x + (targetScale - item.mesh.scale.x) * 0.08;
    item.mesh.scale.setScalar(s);
    item.mesh.lookAt(camera.position);
  }

  /* 树顶星 */
  starGroup.rotation.y += 0.01;
  starCore.material.color.setHSL(0.125, 0.72, 0.80 + pulse * 0.10);
  const halo = 5.0 + pulse * 2.4;
  starHalo.scale.set(halo, halo, 1);

  /* 灯光呼吸 */
  baseLight.intensity = 12 + pulse * 9;
  topLight.intensity = 22 + pulse * 16;

  /* 相机缓动 + 视差 */
  const camY = 3.4 + Math.sin(t * 0.16) * 0.55 - pointer.y * 1.6;
  const camX = Math.sin(t * 0.1) * 1.1 + pointer.x * 2.4;
  camera.position.x += (camX - camera.position.x) * 0.04;
  camera.position.y += (camY - camera.position.y) * 0.04;
  camera.position.z = 27 - (sceneState === 'PHOTO' ? 1.5 : 0) - pulse * 0.8;
  camera.lookAt(0, 1.1, 0);

  /* 手势轮询（约 30fps 足够） */
  if (handLoopOn) tickHand();

  renderer.render(scene, camera);
}

/* ============================================================================
   ⑮ 启动
   ========================================================================== */
(async function boot() {
  // 恢复缓存里的照片
  try {
    const saved = await dbAll();
    let i = 0;
    for (const rec of saved) {
      if (!rec.blob || i >= CONFIG.photo.max) continue;
      const url = URL.createObjectURL(rec.blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      const item = addPhotoToScene(rec.id, img);
      item.preview = url;
      i++;
    }
    renderThumbs();
  } catch (e) {
    console.warn('photo restore skipped', e);
  }

  overlay.width = overlay.clientWidth * Math.min(window.devicePixelRatio, 2);
  overlay.height = overlay.clientHeight * Math.min(window.devicePixelRatio, 2);

  animate();            // 先把树画出来，不用等手势引擎
  initHandEngine();     // 手势引擎在后台慢慢加载，不挡首屏
})();
