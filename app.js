import * as THREE from './vendor/three/three.module.min.js';

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
    radius:   6.3,      // 底部半径，越大越"胖"
    count:    3600,     // 粒子数：400 轻 / 1300 标准 / 3600 密
    spin:     0.0016,   // 自转速度
    surface:  0.80,     // 粒子贴树面的程度：0.7 实心，0.95 空心
    thickness:0.30,     // 树面随机厚度（越厚越蓬）
    colors: {           // 金主，绿红为辅
      core:   '#fffdf0',
      edge:   '#1c8f4a',
      accent: '#ffd036',
      warm:   '#ff4632'
    },
    mix: { warm: 0.06, accent: 0.58, green: 0.20 }   // 红 / 金 / 绿 占比，剩下的是暖白
  },

  lamps:  { count: 260, size: 0.22, spiral: 7 },
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
const isMobile = window.matchMedia('(max-width: 820px)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
/* 分辨率尽量贴近屏幕：手机和桌面都给到 2 倍，按总像素封顶，再由下面的帧率保护兜底 */
function pickPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  const cap = 2;
  const maxPixels = isMobile ? 2600000 : 5000000;
  let p = Math.min(dpr, cap);
  while (p > 1 && window.innerWidth * window.innerHeight * p * p > maxPixels) p -= 0.25;
  return Math.max(1, p);
}
renderer.setPixelRatio(pickPixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.38;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#04060b');
scene.fog = new THREE.FogExp2('#04060b', 0.010);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 3.4, 27);
camera.lookAt(0, 1.2, 0);

scene.add(new THREE.AmbientLight(0xffe9c2, 1.30));
const keyLight = new THREE.DirectionalLight(0xfff4dc, 1.55);
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
  new THREE.CircleGeometry(170, 96),
  new THREE.MeshStandardMaterial({ color: 0x04060b, roughness: 0.9, metalness: 0.05 })
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

  // 圆锥撒点：大部分贴树面（轮廓清楚），一小撮落在体内（让树有体积、更饱满）
  const ang = Math.random() * Math.PI * 2;
  const tier = 1 + 0.09 * Math.sin(t * Math.PI * 9 + ang * 1.8);   // 分层起伏
  const shell = Math.random() < 0.15
    ? 0.30 + Math.random() * 0.55                                  // 体内填充
    : T.surface + Math.random() * T.thickness;
  const rad = (1 - t) * R * tier * shell;
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

  // 颜色分配：金为主，绿红为辅，其余暖白压亮
  const pick = Math.random();
  const cW = T.mix.warm, cA = T.mix.accent, cG = T.mix.green;
  let col;
  if (pick < cW) col = C.warm.clone();
  else if (pick < cW + cA) col = C.accent.clone();
  else if (pick < cW + cA + cG) col = C.edge.clone().lerp(C.core, Math.random() * 0.10);
  else col = C.core.clone();
  col.multiplyScalar(0.95 + Math.random() * 0.42);
  aColor[i3] = col.r; aColor[i3 + 1] = col.g; aColor[i3 + 2] = col.b;

  aSize[i] = 0.32 + Math.random() * 0.56 + (Math.random() > 0.88 ? 0.68 : 0);
}

const treeGeo = new THREE.BufferGeometry();
// 位置常驻显存：树上位置 + 散开位置各一份，靠 uMix 在 shader 里插值，CPU 每帧不再改 buffer
treeGeo.setAttribute('position', new THREE.BufferAttribute(treePos, 3));
treeGeo.setAttribute('aScatter', new THREE.BufferAttribute(scatterPos, 3));
treeGeo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
treeGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));

const treeMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:   { value: 0 },
    uAudio:  { value: 0 },
    uScale:  { value: renderer.getPixelRatio() },
    uMix:    { value: 0 }
  },
  vertexShader: /* glsl */`
    attribute vec3 aColor;
    attribute float aSize;
    attribute vec3 aScatter;
    uniform float uTime;
    uniform float uAudio;
    uniform float uScale;
    uniform float uMix;
    varying vec3 vColor;
    varying float vGlow;
    void main() {
      vColor = aColor;
      vec3 p = mix(position, aScatter, uMix);
      // 轻微呼吸，避免"死"粒子
      p.y += sin(uTime * 1.1 + p.x * 1.8 + p.z * 1.8) * 0.035;
      p.xz *= 1.0 + uAudio * 0.045;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float s = aSize * (1.0 + uAudio * 0.85);
      gl_PointSize = s * uScale * (355.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
      vGlow = 0.30 + 0.80 * sin(uTime * 3.2 + p.y * 1.4 + p.x * 0.6);
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
      vec3 c = vColor * (1.44 + vGlow * 0.74);
      gl_FragColor = vec4(c, a);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

let treeMix = 0;   // 0 = 成树，1 = 散开（GPU 插值进度）
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

/* 树体柔光：整棵树外面裹一层金光，提亮也提"分量"，不遮粒子细节 */
const treeGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: makeGlowTexture(),
  color: 0xffd777,
  transparent: true,
  opacity: 0.18,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false
}));
treeGlow.position.set(0, 0.2, -1.0);
treeGlow.scale.set(11.8, 16.6, 1);
treeGlow.renderOrder = -1;
scene.add(treeGlow);

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
const lampPalette = ['#ffd447', '#ffc02a', '#ffe98f', '#fff6d6', '#ff9f1c', '#ffd447', '#31c46b', '#ff4d4d'];
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
const giftPalette = ['#e5332e', '#e8b93a', '#31c46b', '#ffcf4a', '#c0181c', '#fff7ea'];
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

let handLoading = false;
async function initHandEngine() {
  const boot = $('boot');
  if (handLandmarker || handLoading) return;
  handLoading = true;
  boot.textContent = '手势引擎加载中…（首次要下十几 MB）';
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
    boot.textContent = '手势引擎加载失败（检查网络或 vendor/mediapipe）';
    console.error(e);
  }
  handLoading = false;
}

async function startCamera() {
  if (!handLandmarker) {
    if (handLoading) { toast('手势引擎正在下载，等它好了再点一次'); return false; }
    toast('正在下载手势引擎（约 17MB，网慢可能要几十秒）');
    const bootEl = $('boot');
    bootEl.classList.remove('hide');
    await initHandEngine();
    if (!handLandmarker) {
      bootEl.textContent = '手势引擎下载失败，看看网络再试';
      return false;
    }
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
    const name = (e && e.name) || 'UnknownError';
    console.warn('getUserMedia failed:', name, e && e.message);
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      $('camState').textContent = 'BLOCKED';
      toast('摄像头被拦了：点地址栏左边的小图标，把「摄像头」改成允许，然后刷新');
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      $('camState').textContent = 'NO CAMERA';
      toast('系统没检测到摄像头设备');
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      $('camState').textContent = 'BUSY';
      toast('摄像头被别的程序占着（会议/微信视频/相机预览），关掉再试');
    } else if (name === 'OverconstrainedError') {
      $('camState').textContent = 'NO CAMERA';
      toast('摄像头不支持这个分辨率，换一个摄像头试试');
    } else {
      $('camState').textContent = 'NO CAMERA';
      toast('摄像头打不开：' + name + '（需要 https 或 localhost）');
    }
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
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('浏览器不给用摄像头：需要用 https 或 localhost 打开，现在这个地址不行');
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
  renderer.setPixelRatio(pickPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  treeMat.uniforms.uScale.value = renderer.getPixelRatio();
  overlay.width = overlay.clientWidth * Math.min(window.devicePixelRatio, 2);
  overlay.height = overlay.clientHeight * Math.min(window.devicePixelRatio, 2);
});

/* ============================================================================
   ⑭ 主循环
   ========================================================================== */
const clock = new THREE.Clock();
const pointer = { x: 0, y: 0 };
let perfTick = 0, perfSum = 0, perfDone = false;
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

  /* 粒子：形变交给 GPU，这里只推一个 0→1 的进度值，调用从 3N 次降到 1 次 */
  const lerpK = sceneState === 'SPREAD' ? 0.045 : 0.06;
  const targetMix = sceneState === 'SPREAD' ? 1 : 0;
  treeMix += (targetMix - treeMix) * lerpK;
  if (Math.abs(targetMix - treeMix) < 0.0004) treeMix = targetMix;
  treeMat.uniforms.uMix.value = treeMix;
  treeMat.uniforms.uTime.value = t;
  treeMat.uniforms.uAudio.value = pulse;
  treeGroup.rotation.y += T.spin;

  /* 灯带闪烁 */
  for (let i = 0; i < lampCount; i++) {
    const d = lampData[i];
    const fl = 0.30 + 0.90 * Math.sin(t * 3.9 + d.phase) + pulse * 0.65;
    dummy.position.set(d.x, d.y, d.z);
    dummy.scale.setScalar(clamp(fl, 0.42, 2.45));
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
  const halo = 5.2 + pulse * 2.2;
  starHalo.scale.set(halo, halo, 1);

  /* 灯光呼吸 */
  baseLight.intensity = 15 + pulse * 12;
  topLight.intensity = 27 + pulse * 19;

  /* 相机缓动 + 视差 */
  const camY = 3.4 + Math.sin(t * 0.16) * 0.55 - pointer.y * 1.6;
  const camX = Math.sin(t * 0.1) * 1.1 + pointer.x * 2.4;
  camera.position.x += (camX - camera.position.x) * 0.04;
  camera.position.y += (camY - camera.position.y) * 0.04;
  camera.position.z = 27 - (sceneState === 'PHOTO' ? 1.5 : 0) - pulse * 0.8;
  camera.lookAt(0, 1.1, 0);

  /* 手势轮询（约 30fps 足够） */
  if (handLoopOn) tickHand();

  /* 帧率保护：开头几十帧明显吃力，就把分辨率退回 1.5 倍，宁可少一点锐度也不卡 */
  if (!perfDone && t > 1.5) {
    perfSum += delta; perfTick++;
    if (perfTick >= 40) {
      if (perfSum / perfTick > 0.024 && renderer.getPixelRatio() > 1.5) {
        renderer.setPixelRatio(1.5);
        renderer.setSize(window.innerWidth, window.innerHeight);
        treeMat.uniforms.uScale.value = 1.5;
      }
      perfDone = true;
    }
  }

  renderer.render(scene, camera);
}

/* ============================================================================
   ⑮ 启动
   ========================================================================== */
(async function boot() {
  overlay.width = overlay.clientWidth * Math.min(window.devicePixelRatio, 2);
  overlay.height = overlay.clientHeight * Math.min(window.devicePixelRatio, 2);

  animate();            // 第一帧立刻出树，不等照片和后端
  const bootEl = $('boot');
  bootEl.textContent = '树已就绪 · 点「开启手势」再用摄像头';
  setTimeout(() => bootEl.classList.add('hide'), 2200);

  // 照片恢复放后台，不再挡首帧
  try {
    const saved = await dbAll();
    const ready = [];
    for (const rec of saved) {
      if (!rec.blob || ready.length >= CONFIG.photo.max) continue;
      const url = URL.createObjectURL(rec.blob);
      const img = new Image();
      img.src = url;
      ready.push({ rec, url, img });
    }
    await Promise.all(ready.map(r => r.img.decode().catch(() => null)));
    for (const r of ready) {
      const item = addPhotoToScene(r.rec.id, r.img);
      item.preview = r.url;
    }
    renderThumbs();
  } catch (e) {
    console.warn('photo restore skipped', e);
  }
})();
