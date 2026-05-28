import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const init = () => {

  const canvas = document.getElementById('webgl-canvas');
  if (!canvas) return;

  // ─────────────────────────────────────────────────────
  // 1. RENDERER / SCENE / CAMERA
  // ─────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  // Cap pixel ratio on mobile to prevent extreme fill-rate lag from internal raytracing
  const dpr = window.innerWidth < 768 ? Math.min(window.devicePixelRatio, 1.25) : Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 15);


  // ─────────────────────────────────────────────────────
  // 2. ENVIRONMENT MAP
  //
  //  The environment drives ALL the face colours via the
  //  internal ray tracer.  This is the critical insight for
  //  matching Image 1:
  //
  //  Upper hemisphere (y 0→256 in equirectangular) = COOL BLUE/WHITE
  //    → Rays that exit upward sample this → top faces look blue/steel
  //
  //  Lower hemisphere (y 256→512) = WARM AMBER/ORANGE
  //    → Rays that TIR-bounce inside the glass and exit downward/sideward
  //      sample this → the "interior warm glow" visible when looking
  //      through front faces in Image 1
  //
  //  Equatorial band (y ≈ 252-258) = BRIGHT WHITE
  //    → At grazing angles (cube edges) Fresnel→1, this band gets
  //      reflected perfectly → the bright white edge lines in Image 1
  // ─────────────────────────────────────────────────────
  const ec = document.createElement('canvas');
  ec.width = 1024; ec.height = 512;
  const ex = ec.getContext('2d');

  // Black base
  ex.fillStyle = '#000000';
  ex.fillRect(0, 0, 1024, 512);

  // ── Cool blue/white dome (upper hemisphere y: 0 → 256)
  const coolDome = ex.createLinearGradient(0, 0, 0, 290);
  coolDome.addColorStop(0, 'rgba(170, 205, 255, 0.95)');  // zenith — cool sky blue
  coolDome.addColorStop(0.30, 'rgba(130, 175, 255, 0.60)');  // upper mid — medium blue
  coolDome.addColorStop(0.55, 'rgba( 70, 110, 200, 0.20)');  // near horizon — dim blue
  coolDome.addColorStop(1, 'rgba(  0,   0,   0,  0)');
  ex.fillStyle = coolDome;
  ex.fillRect(0, 0, 1024, 290);

  // ── Warm amber/orange gradient (lower hemisphere y: 256 → 512)
  //    This is the colour you see when looking INTO/THROUGH the glass cube.
  //    TIR bounces redirect rays downward → they exit toward this warm area.
  const warmDome = ex.createLinearGradient(0, 256, 0, 512);
  warmDome.addColorStop(0, 'rgba(  0,   0,   0,  0)');
  warmDome.addColorStop(0.25, 'rgba(160,  60,   5, 0.30)');  // warm horizon entry
  warmDome.addColorStop(0.60, 'rgba(210, 100,  20, 0.65)');  // amber
  warmDome.addColorStop(1, 'rgba(255, 155,  45, 0.75)');  // bright amber at nadir
  ex.fillStyle = warmDome;
  ex.fillRect(0, 256, 1024, 256);

  // Warm spot helpers
  function envSpot(x, y, r, rgb, a) {
    const g = ex.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(0.30, `rgba(${rgb},${a * 0.25})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ex.fillStyle = g;
    ex.fillRect(0, 0, 1024, 512);
  }

  envSpot(165, 50, 165, '255,255,255', 1.00);  // white key light (upper-left)
  envSpot(820, 100, 140, '190,215,255', 0.75);  // cool fill (upper-right)
  envSpot(200, 420, 95, '255,145,35', 0.80);  // warm amber bounce (lower-left)
  envSpot(850, 390, 80, '240,130,25', 0.65);  // warm amber bounce (lower-right)
  envSpot(512, 480, 70, '255,160,50', 0.55);  // warm amber (nadir centre)

  // ── Razor-thin bright equatorial band
  //    This is exactly what becomes the WHITE EDGES in Image 1.
  //    At grazing angles, Fresnel reflectivity → 1.0 (perfect mirror).
  //    The glass edge reflects this bright band as a crisp white line.
  ex.fillStyle = 'rgba(255,255,255,0.95)';
  ex.fillRect(0, 252, 1024, 5);

  ex.fillStyle = 'rgba(255,255,255,0.55)';
  ex.fillRect(0, 247, 1024, 3);
  ex.fillRect(0, 259, 1024, 3);

  // Vertical band for left/right edge highlights
  ex.fillStyle = 'rgba(255,255,255,0.38)';
  ex.fillRect(503, 0, 5, 512);

  const envTex = new THREE.CanvasTexture(ec);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.minFilter = THREE.LinearFilter;
  envTex.magFilter = THREE.LinearFilter;
  envTex.generateMipmaps = false;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;

  // Scene lights — one cool, one warm (matches environment contrast)
  const keyLight = new THREE.DirectionalLight(0xaaccff, 4.5);
  keyLight.position.set(3, 8, 5);
  scene.add(keyLight);

  const warmLight = new THREE.DirectionalLight(0xff8822, 3.5);
  warmLight.position.set(-3, -6, -4);   // from below-behind
  scene.add(warmLight);

  scene.add(new THREE.AmbientLight(0xffffff, 0.10));


  // ─────────────────────────────────────────────────────
  // 3. VERTEX SHADER
  // ─────────────────────────────────────────────────────
  const vertexShader = /* glsl */`
    out vec3 vLocalPos;
    out vec3 vLocalNorm;
    out vec3 vWorldPos;
    out vec3 vWorldNorm;

    void main() {
      vLocalPos  = position;
      vLocalNorm = normalize(normal);
      vWorldNorm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      vec4 wp    = modelMatrix * vec4(position, 1.0);
      vWorldPos  = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;


  // ─────────────────────────────────────────────────────
  // 4. FRAGMENT SHADER
  //
  //  THE CORE FIX: restore traceWave() — the internal ray tracer.
  //
  //  Without it (the broken state):
  //    refract(ray, normal, 1/n) → immediately sample environment
  //    → samples the dark green page → cube looks dark and flat
  //
  //  With traceWave() restored:
  //    refract(ray, normal, 1/n) → ray travels THROUGH the glass →
  //    hits back face → TIR or exit refraction → THEN samples environment
  //    → rays that TIR and exit downward sample the warm amber env →
  //    the "glowing warm interior" of Image 1 appears naturally.
  // ─────────────────────────────────────────────────────
  const fragmentShader = /* glsl */`
    precision highp float;

    uniform mat4      modelMatrix;
    uniform sampler2D uEnvMap;
    uniform float     uB;
    uniform float     uC;
    uniform float     uEnvInt;
    uniform float     uOpacity;
    uniform float     uRefl;
    uniform vec3      uCamPos;
    uniform vec3      uHalf;      // ← RESTORED — needed for AABB glass traversal
    uniform vec3      uTint;

    in vec3 vLocalPos;
    in vec3 vLocalNorm;
    in vec3 vWorldPos;
    in vec3 vWorldNorm;
    out vec4 fragColor;

    const float PI = 3.14159265359;

    float fresnel(float cosT, float n1, float n2) {
      float r0 = (n1 - n2) / (n1 + n2);
      r0 *= r0;
      return r0 + (1.0 - r0) * pow(max(0.0, 1.0 - cosT), 5.0);
    }

    vec3 envSample(vec3 dir) {
      dir = normalize(dir);
      float u = (atan(dir.z, dir.x) + PI) / (2.0 * PI);
      float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
      return texture(uEnvMap, vec2(u, v)).rgb * uEnvInt;
    }

    // ── INTERNAL GLASS RAY TRACER ──────────────────────
    //
    //  Traces one wavelength (IOR = n) through the glass box.
    //
    //  Step 1: entry refraction at the front face (Snell, air→glass).
    //          Different n per wavelength → different entry angles → dispersion.
    //
    //  Step 2: ray travels through the glass interior.
    //          Ray-AABB: find which back face the ray hits first.
    //
    //  Step 3a: if exit angle > critical angle → Total Internal Reflection.
    //           Ray bounces → hits another face → try to exit again.
    //           These bouncing rays, when they finally exit toward the warm
    //           lower environment, create the amber interior glow of Image 1.
    //
    //  Step 3b: normal exit → Fresnel blend of refracted + back-face reflection.
    //
    //  Returns sampled environment colour for this wavelength channel.
    // ──────────────────────────────────────────────────
    vec3 traceWave(vec3 pL, vec3 incL, vec3 nL, float n, mat4 M) {

      // Entry refraction (air IOR=1 → glass IOR=n)
      vec3 d = refract(incL, nL, 1.0 / n);

      // Grazing entry: total external reflection
      if (dot(d, d) < 0.001)
        return envSample((M * vec4(reflect(incL, nL), 0.0)).xyz);

      // ── Ray–AABB: find first back-face hit inside the glass
      //    t_per_axis: how far along d until we hit ±uHalf on each axis
      vec3  tp   = (sign(d) * uHalf - pL) / d;
      float tHit = min(tp.x, min(tp.y, tp.z));
      vec3  pB   = pL + tHit * d;

      // Determine which face was hit (smallest t = first wall)
      vec3 nB;
      if      (tHit >= tp.x - 1e-5) nB = vec3(sign(d.x), 0.0, 0.0);
      else if (tHit >= tp.y - 1e-5) nB = vec3(0.0, sign(d.y), 0.0);
      else                          nB = vec3(0.0, 0.0, sign(d.z));

      // Exit refraction (glass IOR=n → air IOR=1)
      vec3 exitD = refract(d, -nB, n);

      // ── Total Internal Reflection: ray doesn't exit, bounces once more
      if (dot(exitD, exitD) < 0.001) {
        vec3  d2   = reflect(d, nB);
        vec3  tp2  = (sign(d2) * uHalf - pB) / d2;
        float tH2  = min(tp2.x, min(tp2.y, tp2.z));
        vec3  pB2  = pB + tH2 * d2;

        vec3 nB2;
        if      (tH2 >= tp2.x - 1e-5) nB2 = vec3(sign(d2.x), 0.0, 0.0);
        else if (tH2 >= tp2.y - 1e-5) nB2 = vec3(0.0, sign(d2.y), 0.0);
        else                          nB2 = vec3(0.0, 0.0, sign(d2.z));

        vec3 exit2 = refract(d2, -nB2, n);
        if (dot(exit2, exit2) < 0.001) exit2 = reflect(d2, nB2);  // 2nd TIR

        // ← This is where the warm amber appears: TIR'd ray exits toward
        //   the lower/warm part of the environment
        return envSample((M * vec4(exit2, 0.0)).xyz) * uTint;
      }

      // ── Normal exit: blend refracted + partial back-face Fresnel reflection
      float R       = fresnel(max(dot(-d, nB), 0.0), n, 1.0);
      vec3  refCol  = envSample((M * vec4(exitD,         0.0)).xyz);
      vec3  reflCol = envSample((M * vec4(reflect(d, nB),0.0)).xyz);

      return mix(refCol, reflCol, R) * uTint;
    }


    void main() {
      vec3 nL = normalize(vLocalNorm);
      vec3 nW = normalize(vWorldNorm);

      // Camera direction in local space (needed by traceWave AABB)
      vec3 camL = (inverse(modelMatrix) * vec4(uCamPos, 1.0)).xyz;
      vec3 iL   = normalize(vLocalPos - camL);
      vec3 iW   = normalize(vWorldPos - uCamPos);

      // Double-sided: if drawing a back-face, flip normals toward camera
      if (dot(iL, nL) > 0.0) nL = -nL;
      if (dot(iW, nW) > 0.0) nW = -nW;

      // ── Cauchy dispersion IOR per wavelength
      //    n(λ) = B + C/λ²   (λ in micrometers)
      float nR = uB + uC / (0.650 * 0.650);   // red   — lowest IOR → least bent
      float nG = uB + uC / (0.532 * 0.532);   // green — mid
      float nB = uB + uC / (0.450 * 0.450);   // blue  — highest IOR → most bent

      // ── Trace each wavelength through the full glass volume
      //    (entry refract → AABB traverse → TIR or exit refract)
      float r = traceWave(vLocalPos, iL, nL, nR, modelMatrix).r;
      float g = traceWave(vLocalPos, iL, nL, nG, modelMatrix).g;
      float b = traceWave(vLocalPos, iL, nL, nB, modelMatrix).b;
      vec3 traced = vec3(r, g, b);

      // ── Iridescent thin-film overlay (your original formula, kept intact)
      //    Adds a subtle hue shift that varies with viewing angle and normal,
      //    giving that "oily glass" colour modulation on top of the traced result.
      float cosI    = max(dot(-iW, nW), 0.0);
      vec3  iridTint = vec3(1.0) + 0.18 * cos(
        vec3(0.0, 2.094, 4.189)            // 120° apart in colour wheel
        + cosI * 5.5                        // shifts with view angle
        + dot(nW, vec3(0.577)) * 2.2        // shifts with face orientation
      );
      vec3 iridCol = traced * iridTint;

      // ── External Fresnel reflection (front face mirror component)
      float nAvg  = (nR + nG + nB) / 3.0;
      float F     = fresnel(cosI, 1.0, nAvg);
      vec3  extR  = envSample(reflect(iW, nW)) * uRefl;

      // Primary colour: blend traced refraction with Fresnel reflection
      vec3 finalCol = mix(iridCol, extR, F);

      // ── Bevel detection
      //    Flat face: normal axis-aligned → axisMax ≈ 1 → bevelFactor = 0
      //    Bevel face: normal has mixed axes → axisMax < 1 → bevelFactor > 0
      float axisMax    = max(abs(nL.x), max(abs(nL.y), abs(nL.z)));
      float bevelFactor = clamp((1.0 - axisMax) * 6.0, 0.0, 1.0);

      // ── Edge and bevel enhancement
      float edgePow = pow(1.0 - cosI, 3.5);
      finalCol += extR    * edgePow    * 2.2;              // white rim from equatorial band
      finalCol += iridCol * bevelFactor * edgePow * 1.6;  // prismatic rainbow at bevel strip
      finalCol += iridTint * edgePow   * 0.35;            // subtle iridescent sheen at grazing

      // ── Alpha: flat faces nearly invisible, edges opaque
      float alpha = clamp(uOpacity + F * 0.55 + edgePow * 0.80 + bevelFactor * 0.20, 0.0, 1.0);

      fragColor = vec4(finalCol, alpha);
    }
  `;


  // ─────────────────────────────────────────────────────
  // 5. MATERIAL — uHalf RESTORED, tint neutral white
  // ─────────────────────────────────────────────────────
  const baseMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uEnvMap: { value: envTex },
      uB: { value: 1.52 },
      uC: { value: 0.15 },   // dispersion — 0.10 subtle, 0.20 exaggerated
      uEnvInt: { value: 5.5 },   // brightness — higher = more vivid face colours
      uOpacity: { value: 0.05 },   // face base transparency
      uRefl: { value: 2.8 },   // Fresnel reflection multiplier
      uCamPos: { value: camera.position },
      uHalf: { value: new THREE.Vector3(1, 1, 1) },  // ← RESTORED
      uTint: { value: new THREE.Color(0xffffff) }    // neutral — colours from env
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    glslVersion: THREE.GLSL3,
  });


  // ─────────────────────────────────────────────────────
  // 6. GEOMETRY — same sharp bevel as before
  // ─────────────────────────────────────────────────────
  const mkGeo = (s, b) => new RoundedBoxGeometry(s, s, s, 3, b);

  function makeCube(size, bevel, halfSize, pos, mat) {
    const m = mat.clone();
    m.uniforms.uHalf.value.setScalar(halfSize);
    const mesh = new THREE.Mesh(mkGeo(size, bevel), m);
    mesh.position.copy(pos);
    scene.add(mesh);
    return mesh;
  }

  const isMobile = window.innerWidth < 768;
  const cubes = [
    // Large cube — left-center on mobile
    makeCube(2.0, 0.05, 0.95, new THREE.Vector3(isMobile ? -2.5 : -4, isMobile ? -1.4 : -1, 0), baseMat),
    // Smallest cube — top-right corner on mobile (below nav bar, slightly clipped by edge)
    makeCube(1.2, 0.03, 0.57, new THREE.Vector3(isMobile ? 2.8 : 3.5, isMobile ? 3.2 : 2.5, 2), baseMat),
    // Biggest cube — bottom area on mobile, well separated from the others
    makeCube(3.0, 0.07, 1.43, new THREE.Vector3(isMobile ? 1.5 : 5, isMobile ? -4.5 : -3, -3), baseMat),
  ];


  // ─────────────────────────────────────────────────────
  // 7. MANIFESTO DOUBLE-HELIX SPIRAL — UNCHANGED
  // ─────────────────────────────────────────────────────
  const manifestoCanvas = document.getElementById('manifesto-canvas');
  let mScene, mRenderer, mCamera, spiralMesh1, spiralMesh2;
  let mTime = 0;

  if (manifestoCanvas) {
    mScene = new THREE.Scene();
    mScene.environment = scene.environment;

    const mw = manifestoCanvas.clientWidth || window.innerWidth;
    const mh = manifestoCanvas.clientHeight || 600;

    mRenderer = new THREE.WebGLRenderer({ canvas: manifestoCanvas, alpha: true, antialias: true });
    // Aggressively cap pixel ratio on mobile for the secondary scene
    mRenderer.setPixelRatio(window.innerWidth < 768 ? 1.0 : Math.min(window.devicePixelRatio, 2));
    mRenderer.setSize(mw, mh);
    mRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    mRenderer.toneMappingExposure = 1.0;

    mCamera = new THREE.PerspectiveCamera(40, mw / mh, 0.1, 100);
    mCamera.position.set(0, 0, 11);

    class HelixCurve extends THREE.Curve {
      constructor(radius = 1.6, turns = 2.2, height = 10.5, phase = 0) {
        super();
        this.radius = radius;
        this.turns = turns;
        this.height = height;
        this.phase = phase;
      }
      getPoint(t, out = new THREE.Vector3()) {
        const angle = t * Math.PI * 2 * this.turns + this.phase;
        return out.set(
          Math.cos(angle) * this.radius,
          (t - 0.5) * this.height,
          Math.sin(angle) * this.radius
        );
      }
    }

    const spiralVertexShader = /* glsl */`
      out vec3 vWorldNormal;
      out vec3 vWorldPos;
      out vec3 vLocalPos;
      out vec3 vLocalNormal;
      uniform float uTime;

      void main() {
        vLocalPos    = position;
        vLocalNormal = normalize(normal);

        vec3 pos  = position;
        float wave = sin(pos.y * 1.5 + uTime * 2.2) * 0.12;
        pos.x += wave * cos(pos.y);
        pos.z += wave * sin(pos.y);

        vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vec4 wp      = modelMatrix * vec4(pos, 1.0);
        vWorldPos    = wp.xyz;
        gl_Position  = projectionMatrix * viewMatrix * wp;
      }
    `;

    const spiralFragmentShader = /* glsl */`
      precision highp float;

      uniform sampler2D uEnvMap;
      uniform float     uB;
      uniform float     uC;
      uniform float     uEnvInt;
      uniform float     uOpacity;
      uniform float     uRefl;
      uniform vec3      uCamPos;
      uniform vec3      uTint;

      in vec3 vWorldNormal;
      in vec3 vWorldPos;
      in vec3 vLocalPos;
      in vec3 vLocalNormal;
      out vec4 fragColor;

      const float PI = 3.14159265359;

      float fresnel(float cosT, float n1, float n2) {
        float r0 = (n1 - n2) / (n1 + n2);
        r0 *= r0;
        return r0 + (1.0 - r0) * pow(max(0.0, 1.0 - cosT), 5.0);
      }

      vec3 envSample(vec3 dir) {
        dir = normalize(dir);
        float u = (atan(dir.z, dir.x) + PI) / (2.0 * PI);
        float v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
        return texture(uEnvMap, vec2(u, v)).rgb * uEnvInt;
      }

      void main() {
        vec3 nW = normalize(vWorldNormal);
        vec3 iW = normalize(vWorldPos - uCamPos);

        float nR = uB + uC / (0.650 * 0.650);
        float nG = uB + uC / (0.532 * 0.532);
        float nB = uB + uC / (0.450 * 0.450);

        vec3 refractR = refract(iW, nW, 1.0 / nR);
        vec3 refractG = refract(iW, nW, 1.0 / nG);
        vec3 refractB = refract(iW, nW, 1.0 / nB);

        float r = envSample(refractR).r;
        float g = envSample(refractG).g;
        float b = envSample(refractB).b;

        vec3 disp  = vec3(r, g, b) * uTint;
        float cosI = max(dot(-iW, nW), 0.0);
        float nAvg = (nR + nG + nB) / 3.0;
        float F    = fresnel(cosI, 1.0, nAvg);

        vec3 extR     = envSample(reflect(iW, nW)) * uRefl;
        vec3 finalCol = mix(disp, extR, F);

        float edgePow = pow(1.0 - cosI, 3.5);
        finalCol += extR  * edgePow * 2.0;
        finalCol += disp  * edgePow * 1.5;

        float alpha = clamp(uOpacity + F * 0.75 + edgePow * 0.85, 0.0, 1.0);
        fragColor   = vec4(finalCol, alpha);
      }
    `;

    const spiralCurve1 = new HelixCurve(1.5, 2.2, 10.5, 0.0);
    const spiralCurve2 = new HelixCurve(1.5, 2.2, 10.5, Math.PI);

    const tubeGeo1 = new THREE.TubeGeometry(spiralCurve1, 160, 0.26, 32, false);
    const tubeGeo2 = new THREE.TubeGeometry(spiralCurve2, 160, 0.26, 32, false);

    const spiralMat = new THREE.ShaderMaterial({
      vertexShader: spiralVertexShader,
      fragmentShader: spiralFragmentShader,
      uniforms: {
        uEnvMap: { value: envTex },
        uB: { value: 1.52 },
        uC: { value: 0.16 },
        uEnvInt: { value: 3.8 },
        uOpacity: { value: 0.04 },
        uRefl: { value: 2.2 },
        uCamPos: { value: mCamera.position },
        uTint: { value: new THREE.Color(0xf6efff) },
        uTime: { value: 0.0 }
      },
      transparent: true,
      depthWrite: false,
      glslVersion: THREE.GLSL3,
    });

    spiralMesh1 = new THREE.Mesh(tubeGeo1, spiralMat);
    spiralMesh2 = new THREE.Mesh(tubeGeo2, spiralMat.clone());

    const isMobile = window.innerWidth < 768;
    // Push spiral left on mobile to mix with text
    spiralMesh1.position.x = isMobile ? 1.8 : 3.2;
    spiralMesh2.position.x = isMobile ? 1.8 : 3.2;

    const scale = isMobile ? 1.05 : 1.0;
    spiralMesh1.scale.set(scale, scale, scale);
    spiralMesh2.scale.set(scale, scale, scale);

    mScene.add(spiralMesh1);
    mScene.add(spiralMesh2);
  }


  // ─────────────────────────────────────────────────────
  // SHADER BACKGROUND
  // ─────────────────────────────────────────────────────
  const shaderCanvas = document.getElementById('shader-bg');
  let shaderRenderer, shaderScene, shaderCamera, shaderMaterial;
  
  if (shaderCanvas) {
    shaderRenderer = new THREE.WebGLRenderer({ canvas: shaderCanvas, antialias: false });
    // Cap pixel ratio on mobile for the heavy fragment shader
    shaderRenderer.setPixelRatio(window.innerWidth < 768 ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
    shaderRenderer.setSize(window.innerWidth, window.innerHeight);

    shaderScene = new THREE.Scene();
    shaderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const shaderVert = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 1.0);
      }
    `;

    const shaderFrag = `
      uniform float uTime;
      uniform vec2 uResolution;
      uniform vec2 uMouse;
      varying vec2 vUv;

      vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
      float snoise(vec2 v){
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                 -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy) );
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod(i, 289.0);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
          dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 uv = gl_FragCoord.xy / uResolution.xy;
        vec2 mouse = uMouse / uResolution.xy;
        
        uv.x *= uResolution.x / uResolution.y;
        mouse.x *= uResolution.x / uResolution.y;

        // Calculate distance from current pixel to mouse pointer
        float dist = distance(uv, mouse);

        // Slower motion by reducing uTime multipliers
        float n1 = snoise(uv * 1.5 + vec2(uTime * 0.04, uTime * 0.06)) * 0.5 + 0.5;
        float n2 = snoise(uv * 2.5 - vec2(uTime * 0.02, uTime * 0.04)) * 0.5 + 0.5;
        
        // Base noise for the orange shade
        float n3 = snoise(uv * 1.2 + vec2(n1, n2) + uTime * 0.03) * 0.5 + 0.5;

        // Add mouse influence: orange shade increases near the mouse
        float mouseInfluence = smoothstep(0.6, 0.0, dist) * 0.35;
        n3 += mouseInfluence;

        // Colors based on site palette
        vec3 col1 = vec3(0.04, 0.06, 0.04); // Dark olive base
        vec3 col2 = vec3(0.06, 0.18, 0.11); // Deep emerald
        vec3 col3 = vec3(0.77, 0.57, 0.16); // Warm amber
        
        vec3 finalColor = mix(col1, col2, clamp(n1, 0.0, 1.0));
        
        // Reduce orange sections, but they appear more prominently near mouse
        finalColor = mix(finalColor, col3, smoothstep(0.75, 1.0, n3));

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    shaderMaterial = new THREE.ShaderMaterial({
      vertexShader: shaderVert,
      fragmentShader: shaderFrag,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uMouse: { value: new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2) }
      },
      depthWrite: false,
    });

    const shaderGeo = new THREE.PlaneGeometry(2, 2);
    const shaderMesh = new THREE.Mesh(shaderGeo, shaderMaterial);
    shaderScene.add(shaderMesh);
    
    document.addEventListener('mousemove', (e) => {
      // Lerp mouse target towards mouse position to make it feel organic, wait actually just set it and let smoothstep handle
      shaderMaterial.uniforms.uMouse.value.set(e.clientX, window.innerHeight - e.clientY);
    });
  }

  // ─────────────────────────────────────────────────────
  // 8. GSAP ANIMATIONS
  // ─────────────────────────────────────────────────────
  cubes.forEach((cube, i) => {
    const dur = 4 + Math.random() * 2;

    gsap.to(cube.position, {
      y: cube.position.y + 1.2,
      duration: dur,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: -1,
      delay: i * 0.5
    });

    gsap.to(cube.rotation, {
      x: '+=' + Math.PI * 2,
      y: '+=' + Math.PI * 2,
      duration: 15 + i * 5,
      ease: 'none',
      repeat: -1,
    });
  });


  // ─────────────────────────────────────────────────────
  // 9. RENDER LOOP
  // ─────────────────────────────────────────────────────
  let clock = new THREE.Clock();

  // Force shader compilation BEFORE starting intro animation
  renderer.render(scene, camera);
  if (shaderRenderer) shaderRenderer.render(shaderScene, shaderCamera);
  if (manifestoCanvas && mRenderer) mRenderer.render(mScene, mCamera);

  // Now start the GSAP animation (ensures zero main-thread lockups during intro)
  if (window.startIntro) {
    requestAnimationFrame(() => window.startIntro());
  }

  // ─────────────────────────────────────────────────────
  // PERFORMANCE VISIBILITY CULLING
  // ─────────────────────────────────────────────────────
  let isHeroVisible = true;
  let isManifestoVisible = false;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.target.id === 'heroBg' || e.target.id === 'hero') isHeroVisible = e.isIntersecting;
      if (e.target.id === 'manifesto-canvas' || e.target.id === 'about') isManifestoVisible = e.isIntersecting;
    });
  }, { rootMargin: '200px' });

  const heroSection = document.getElementById('hero');
  const manifestoSection = document.getElementById('about');
  if (heroSection) obs.observe(heroSection);
  if (manifestoSection) obs.observe(manifestoSection);

  function animate() {
    requestAnimationFrame(animate);

    // Only render the hero 3D cubes and background shader if they are actually on screen
    if (isHeroVisible) {
      if (shaderRenderer) {
        shaderMaterial.uniforms.uTime.value = clock.getElapsedTime();
        shaderRenderer.render(shaderScene, shaderCamera);
      }

      cubes.forEach(c => {
        if (c.material?.uniforms?.uCamPos)
          c.material.uniforms.uCamPos.value.copy(camera.position);
      });
      renderer.render(scene, camera);
    }

    // Only render the manifesto double-helix if the user scrolled down to it
    if (isManifestoVisible && manifestoCanvas && mRenderer) {
      mTime += 0.015;

      spiralMesh1.rotation.y -= 0.008;
      spiralMesh2.rotation.y -= 0.008;

      spiralMesh1.material.uniforms.uTime.value = mTime;
      spiralMesh2.material.uniforms.uTime.value = mTime;
      spiralMesh1.material.uniforms.uCamPos.value.copy(mCamera.position);
      spiralMesh2.material.uniforms.uCamPos.value.copy(mCamera.position);

      mRenderer.render(mScene, mCamera);
    }
  }

  animate();


  // ─────────────────────────────────────────────────────
  // 10. RESIZE
  // ─────────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    if (shaderRenderer) {
      shaderRenderer.setSize(window.innerWidth, window.innerHeight);
      shaderMaterial.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
    }

    if (manifestoCanvas && mRenderer) {
      const mw = manifestoCanvas.clientWidth;
      const mh = manifestoCanvas.clientHeight;
      mCamera.aspect = mw / mh;
      mCamera.updateProjectionMatrix();
      mRenderer.setSize(mw, mh);
    }
  });

};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}