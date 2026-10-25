// Shared GLSL: noise helpers (still used by fire, forest, monks, palace...),
// the atmosphere (height fog + analytic lamp in-scattering) every material
// runs through, and the surface library: photo-scanned PBR sets sampled with
// biplanar mapping and anti-tiling, plus a few small procedural materials.

export const NLAMP = 10;

export const noiseGLSL = /* glsl */ `
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash13(vec3 p3){ p3=fract(p3*.1031); p3+=dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec3 p){
  vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float vnoise2(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y);
}
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=.5; } return s/0.9375; }
// x: F1, y: F2, z: cell hash
vec3 voronoi(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); float f1=8., f2=8., id=0.;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g=vec2(float(x),float(y)); vec2 o=hash22(i+g)*.85+.075;
    float d=length(g+o-f);
    if(d<f1){ f2=f1; f1=d; id=hash12(i+g); } else if(d<f2){ f2=d; }
  }
  return vec3(f1,f2,id);
}
`;

export const atmosGLSL = /* glsl */ `
uniform float uTime;
uniform vec3 uLampPos[${NLAMP}];
uniform vec3 uLampCol[${NLAMP}];
uniform vec3 uFogCol;
uniform float uUnder;
uniform float uFogBase;
uniform vec3 uMoonDir;
uniform sampler2D uNoise; // tiling low-frequency noise: R 4 cycles, G 8, B 16, A 6 (per tile)
uniform sampler2D uLF;    // light field: R sun shadow height, GBA mean town height at ~1.5/5/14 m
uniform vec4 uLFBox;      // x0, z0, 1/size, valid
uniform vec4 uFogK;       // haze density, ground-mist density, mist falloff (1/m), sky fog distance

// x: key light (1 lit, 0 in the shadow of the town), y: sky visibility.
// p, n in world space. Two fetches of a small texture.
#define WORLDLIGHT
vec2 worldLight(vec3 p, vec3 n){
  if (uLFBox.w < 0.5) return vec2(1.0);
  vec2 uv = (p.xz - uLFBox.xy) * uLFBox.z;
  vec2 e = min(uv, 1.0 - uv);
  float inside = smoothstep(0.0, 0.1, min(e.x, e.y));
  uv.y = 1.0 - uv.y;
  vec2 nd = vec2(n.x, -n.z) * uLFBox.z;
  float S = texture2D(uLF, uv + nd * 0.6).r;
  float sun = smoothstep(S - 0.15, S + 0.9, p.y + 0.2);
  vec3 hb = texture2D(uLF, uv + nd * 2.5).gba;
  vec3 occ = max(hb - p.y, 0.0);
  vec3 v = vec3(1.5, 5.0, 14.0);
  v = v / (v + occ * 1.6);
  float sky = dot(v, vec3(0.3, 0.35, 0.35));
  return mix(vec2(1.0), vec2(sun, sky), inside);
}

vec3 applyAtmos(vec3 col, vec3 wpos){
  vec3 ro = cameraPosition;
  vec3 rd = wpos - ro; float L = max(length(rd), 1e-3); rd /= L;
  // Two media, both integrated in closed form along the ray (no steps, no
  // screen-space noise): a thin even haze, and a dense mist that pools at the
  // ground and thins upward (scale height ~7 m). Its base trails the ground
  // under the eye, so from the ridge the valleys lie drowned in it.
  float haze = mix(uFogK.x, 0.05, uUnder);
  float dG = mix(uFogK.y, 0.03, uUnder);
  float b = mix(uFogK.z, 0.05, uUnder);
  float ground = uFogBase - 4.0 * uUnder;
  float k = b * rd.y * L;
  float g0 = dG * exp(-b * (ro.y - ground));
  float odG = abs(k) > 1e-3 ? g0 * (1.0 - exp(-k)) / (b * rd.y) : g0 * L;
  // Slow drifting banks of mist, anchored in the world: the density is read
  // where the ray meets the surface (or 70 m out), at 15-60 m scales.
  vec3 mp = ro + rd * min(L, 70.0);
  vec2 drift = vec2(uTime * 0.0011, uTime * 0.0006);
  float n = texture2D(uNoise, mp.xz * 0.0042 + drift).r * 0.6
          + texture2D(uNoise, mp.zx * 0.0115 - drift * 1.7 + mp.y * 0.004).g * 0.4;
  n = smoothstep(0.2, 0.8, n);
  float od = haze * L + odG * mix(0.35, 1.65, n);
  float fogAmt = 1.0 - exp(-od);
  // Colour of the mist: lit by the overcast from above, brighter towards the
  // bright west (forward scattering), cooler and darker away from it and
  // towards the ground.
  float md = dot(rd, uMoonDir);
  // (the key light's own glow in the mist is added by the shaft pass, where it reaches)
  float fwd = 0.85 + 0.15 * pow(max(md, 0.0), 4.0);
  vec3 fogC = uFogCol * fwd * mix(vec3(0.93, 0.97, 1.05), vec3(1.04, 1.01, 0.97), max(md, 0.0));
  fogC *= 0.86 + 0.14 * smoothstep(-0.25, 0.3, rd.y);
  fogC = mix(fogC, vec3(0.010, 0.008, 0.007), uUnder);
  // Closed-form integral of 1/(h^2+t^2) along the view ray for every lamp:
  // cheap volumetric halos that wrap around geometry edges.
  vec3 scat = vec3(0.0);
  float dens = haze + g0;
  for (int i=0;i<${NLAMP};i++){
    if (uLampCol[i].r + uLampCol[i].g < 1e-4) continue;
    vec3 lp = uLampPos[i] - ro;
    float t0 = dot(lp, rd);
    float h = max(length(lp - rd*t0), 0.3);
    float a = (atan((L - t0)/h) - atan(-t0/h)) / h;
    scat += uLampCol[i] * a * exp(-dens*0.8*clamp(t0, 0.0, L));
  }
  scat *= mix(0.012, 0.02, uUnder) * mix(0.7, 1.3, n);
  return mix(col, fogC, fogAmt) + scat;
}
`;

// Surface library. MAT is a per-material #define; textured materials get
// TILE (metres per texture repeat) and the samplers tA (albedo, sRGB), tN
// (normal, OpenGL), tM (R ao, G roughness, B height). The ground also gets
// tA2/tN2/tM2 (Roman basoli) and tA3/tN3/tM3 (mud).
export const surfaceGLSL = /* glsl */ `
struct Surf { vec3 alb; float rough; float ao; vec3 nrm; vec3 emi; };

uniform sampler2D uTown; // R Roman paving, G street, B gutter, A terrain height
uniform vec4 uTownBox;   // x0, z0, 1/width, 1/depth (metres)
uniform vec2 uTownH;     // terrain height range encoded in A
vec4 townAt(vec2 xz){ return texture2D(uTown, (xz - uTownBox.xy) * uTownBox.zw); }
float terrainY(vec2 xz){ return uTownH.x + townAt(xz).a * (uTownH.y - uTownH.x); }
float groundY(vec3 p){ float g = terrainY(p.xz); return p.y < g - 2.5 ? g - 7.0 : g; }
float underAt(vec3 p){ return step(p.y, terrainY(p.xz) - 2.5); }

// Porous stone, brick, lime, timber and earth scatter light; they do not
// mirror the sky. A grazing sky reflection on them is exactly what reads as
// plastic, so keep only a trace of specular (metals and glazes keep theirs).
#if MAT == 7 || MAT == 8 || MAT == 16 || MAT == 18 || MAT == 15
  #define SPEC_K 1.0
#else
  #define SPEC_K 0.1
#endif
// Scanned roughness maps run as low as ~0.5; dry porous surfaces never are.
#define POROUS(r) mix(0.86, 1.0, clamp(r, 0.0, 1.0))

#ifdef TILE
uniform sampler2D tA; uniform sampler2D tN; uniform sampler2D tM;
#endif
#if MAT == 1
uniform sampler2D tA2; uniform sampler2D tN2; uniform sampler2D tM2;
uniform sampler2D tA3; uniform sampler2D tN3; uniform sampler2D tM3;
#endif

// Anti-tiling (after Inigo Quilez, "texture repetition", technique 3): a slow
// noise picks one of 8 random offsets per region and blends between two.
// The same offsets are reused for albedo, normal and packed maps.
struct NT { vec2 uv; vec2 oa; vec2 ob; float f; vec2 dx; vec2 dy; };
NT ntSetup(vec2 uv){
  NT t;
  t.uv = uv;
  float k = texture2D(uNoise, uv*0.071).a;
  float l = k*8.0;
  float ia = floor(l);
  t.f = fract(l);
  t.oa = sin(vec2(3.0,7.0)*ia);
  t.ob = sin(vec2(3.0,7.0)*(ia+1.0));
  t.dx = dFdx(uv); t.dy = dFdy(uv);
  return t;
}
// Blend weight between the two offsets; outside the transition band only one
// fetch is needed (most pixels).
vec4 ntGet(sampler2D s, NT t, float w){
  if (w < 0.002) return textureGrad(s, t.uv + t.oa, t.dx, t.dy);
  if (w > 0.998) return textureGrad(s, t.uv + t.ob, t.dx, t.dy);
  return mix(textureGrad(s, t.uv + t.oa, t.dx, t.dy), textureGrad(s, t.uv + t.ob, t.dx, t.dy), w);
}

// One planar projection of a full set.
struct Smp { vec3 a; vec3 n; vec3 m; };
Smp sampleSet(sampler2D A, sampler2D Nm, sampler2D M, vec2 uv){
  NT t = ntSetup(uv);
  float w = smoothstep(0.3, 0.7, t.f);
  Smp s;
  s.a = ntGet(A, t, w).rgb;
  s.n = ntGet(Nm, t, w).xyz * 2.0 - 1.0;
  s.m = ntGet(M, t, w).rgb;
  return s;
}

#ifdef TILE
// Biplanar mapping (two strongest axes, sharpened weights): no seams on
// curved surfaces, a third cheaper than triplanar. Normals are reoriented
// per projection (UDN) and summed onto the geometric normal.
Smp biplanar(vec3 p, vec3 n){
  // Hand-laid courses are never ruled lines: wave the lookup a few cm over a
  // metre or two, so brick and stone rows rise, dip and drift.
  vec2 wv = texture2D(uNoise, vec2(p.x + p.z, p.y) * 0.045).rg - 0.5;
  vec2 wv2 = texture2D(uNoise, p.xz * 0.06 + p.y * 0.02).ba - 0.5;
  p += vec3(wv.x, wv.y * 0.6, wv2.x) * 0.09 + vec3(wv2.y, 0.0, wv.x) * 0.03;
  vec3 an = abs(n);
  // major axis
  ivec3 ma = (an.x > an.y && an.x > an.z) ? ivec3(0,1,2) : (an.y > an.z) ? ivec3(1,2,0) : ivec3(2,0,1);
  // minor axis
  ivec3 mi = (an.x < an.y && an.x < an.z) ? ivec3(0,1,2) : (an.y < an.z) ? ivec3(1,2,0) : ivec3(2,0,1);
  ivec3 me = ivec3(3) - mi - ma;
  // Projection coordinates: (u, v) chosen so that v is world-up on walls.
  vec2 uvX = vec2(p.z, p.y), uvY = vec2(p.x, p.z), uvZ = vec2(p.x, p.y);
  vec2 u1 = ma.x == 0 ? uvX : ma.x == 1 ? uvY : uvZ;
  vec2 u2 = me.x == 0 ? uvX : me.x == 1 ? uvY : uvZ;
  vec2 w = vec2(an[ma.x], an[me.x]);
  w = clamp((w - 0.5773) / (1.0 - 0.5773), 0.0, 1.0);
  w = pow(w, vec2(4.0));
  w /= (w.x + w.y + 1e-4);
  Smp s1 = sampleSet(tA, tN, tM, u1 / TILE);
  Smp s2 = s1;
  // Flat, axis-aligned faces (most walls, floors) need only one projection.
  if (w.y > 0.02) s2 = sampleSet(tA, tN, tM, u2 / TILE + 0.37);
  else w = vec2(1.0, 0.0);
  // World directions of +u and +v for each projection.
  vec3 U1 = ma.x == 0 ? vec3(0,0,1) : ma.x == 1 ? vec3(1,0,0) : vec3(1,0,0);
  vec3 V1 = ma.x == 0 ? vec3(0,1,0) : ma.x == 1 ? vec3(0,0,1) : vec3(0,1,0);
  vec3 U2 = me.x == 0 ? vec3(0,0,1) : me.x == 1 ? vec3(1,0,0) : vec3(1,0,0);
  vec3 V2 = me.x == 0 ? vec3(0,1,0) : me.x == 1 ? vec3(0,0,1) : vec3(0,1,0);
  Smp o;
  o.a = s1.a*w.x + s2.a*w.y;
  o.m = s1.m*w.x + s2.m*w.y;
  o.n = (s1.n.x*U1 + s1.n.y*V1)*w.x + (s2.n.x*U2 + s2.n.y*V2)*w.y;
  return o;
}
#endif

// Low-frequency world variation: a gentle colour/brightness drift, damp and
// grime at the foot of walls, moss on surfaces that face the sky.
void weather(inout Surf s, vec3 p, vec3 n, float mossAmt){
  vec4 nz = texture2D(uNoise, p.xz*0.021 + p.y*0.013);
  vec4 nz2 = texture2D(uNoise, vec2(p.x + p.z, p.y)*0.07);
  s.alb *= 0.86 + 0.28*nz.r;
  s.alb *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), nz.g);
  float y = p.y - groundY(p);
  float under = underAt(p);
  float damp = (1.0 - smoothstep(0.0, 0.25 + 0.8*nz2.r, y)) * (1.0 - under) * (1.0 - smoothstep(0.5, 0.9, n.y));
  s.alb *= mix(1.0, 0.72, damp);
  s.alb = mix(s.alb, s.alb*vec3(0.85, 0.95, 0.7), damp*0.5);
  s.rough = mix(s.rough, 0.75, damp*0.4);
  // Rain streaks: vertical darkening on walls.
  float streak = smoothstep(0.55, 0.9, texture2D(uNoise, vec2((p.x + p.z)*0.45, p.y*0.035)).b) * (1.0 - abs(n.y));
  s.alb *= 1.0 - 0.22*streak*(1.0 - under);
  float moss = smoothstep(0.35, 0.8, n.y) * smoothstep(0.45, 0.7, nz2.g) * mossAmt * (1.0 - under);
  s.alb = mix(s.alb, vec3(0.045, 0.055, 0.025)*(0.7 + 0.6*nz.b), moss*0.75);
}

vec3 tintTex(vec3 c, vec3 tint, float k){ return c * mix(vec3(1.0), tint, k); }

Surf surface(vec3 p, vec3 n){
  Surf s; s.emi = vec3(0.); s.rough = 0.9; s.ao = 1.0; s.nrm = n; s.alb = vec3(0.2);
#if defined(TILE) && MAT != 1 && MAT != 4
  Smp t = biplanar(p, n);
  s.alb = t.a * ALB_K;
  s.ao = t.m.r;
  s.rough = POROUS(t.m.g * ROUGH_K);
  s.nrm = normalize(n + t.n * NRM_K);
  // Cavities: dirt and shadow settle in the joints and pores (height map),
  // so the relief reads even where the light is flat.
  float cav = smoothstep(0.5, 0.08, t.m.b);
  s.alb *= 1.0 - 0.35 * cav;
  #ifdef TINT
  s.alb = tintTex(s.alb, TINT, 1.0);
  #endif
  weather(s, p, n, MOSS);
#elif MAT == 4
  // Roof: one projection aligned with the slope, tiles running down it.
  vec3 A = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-4, 0.0, 0.0));
  vec3 B = normalize(cross(n, A));
  Smp t = sampleSet(tA, tN, tM, vec2(dot(p, A), dot(p, B)) / TILE);
  s.alb = t.a * ALB_K;
  s.ao = t.m.r;
  s.rough = POROUS(t.m.g * ROUGH_K);
  s.nrm = normalize(n + (t.n.x*A + t.n.y*B) * NRM_K);
  weather(s, p, n, MOSS);
#elif MAT == 1
  // Ground: river cobbles in the alleys, Roman basoli surviving on the main
  // lane, trodden mud everywhere else; height-blended where they meet.
  vec4 tw = townAt(p.xz);
  float under = underAt(p);
  vec4 nz = texture2D(uNoise, p.xz*0.03);
  float street = smoothstep(0.25, 0.75, tw.g) * (1.0 - under);
  float bas = street * smoothstep(0.3, 0.6, tw.r) * smoothstep(0.35, 0.55, nz.r);
  float cob = street - bas;
  float mud = 1.0 - street;
  // A touch of parallax offset for the stones close by (single step: no layers).
  vec3 vd = normalize(cameraPosition - p);
  float near = 1.0 - smoothstep(4.0, 9.0, length(cameraPosition - p));
  vec2 uv = p.xz;
  vec3 a = vec3(0.0), nn = vec3(0.0), m = vec3(0.0);
  float wsum = 0.0;
  if (cob > 0.01) {
    float hc = texture2D(tM, uv / TILE).b;
    vec2 off = -vd.xz / max(vd.y, 0.3) * (hc - 0.5) * 0.03 * near;
    Smp c = sampleSet(tA, tN, tM, (uv + off) / TILE);
    // The scan's stones are warm; pull them towards grey river limestone.
    vec3 g = vec3(dot(c.a, vec3(0.3, 0.55, 0.15)));
    c.a = mix(c.a, g * vec3(1.02, 1.0, 0.95), 0.55);
    float w = cob * (0.6 + c.m.b);
    a += c.a*w; nn += c.n*w; m += c.m*w; wsum += w;
  }
  if (bas > 0.01) {
    Smp c = sampleSet(tA2, tN2, tM2, uv / 3.0);
    float w = bas * (0.6 + c.m.b);
    a += c.a*w*vec3(0.85, 0.85, 0.9); nn += c.n*w; m += c.m*w; wsum += w;
  }
  if (mud > 0.01) {
    Smp c = sampleSet(tA3, tN3, tM3, uv / 3.15);
    float w = mud * (0.4 + c.m.b * 0.6);
    a += c.a*w; nn += c.n*w; m += c.m*w; wsum += w;
  }
  a /= wsum; nn /= wsum; m /= wsum;
  s.alb = a * 0.85;
  s.ao = m.r;
  s.rough = POROUS(m.g);
  s.nrm = normalize(n + vec3(nn.x, 0.0, nn.y) * 1.0);
  // Standing water: in the gutters and the low spots of the mud. Dull, not mirrors.
  float wet = clamp(tw.b * street + mud * smoothstep(0.62, 0.7, nz.g) * smoothstep(0.35, 0.15, m.b), 0.0, 1.0) * (1.0 - under);
  s.alb *= 1.0 - 0.4*wet;
  s.rough = mix(s.rough, 0.3, wet);
  s.nrm = normalize(mix(s.nrm, n, wet*0.7));
  s.alb *= 0.88 + 0.24*nz.b;
#elif MAT == 6
  float g = vnoise(p*40.);
  s.alb = vec3(0.42,0.37,0.27)*(0.75+0.3*g); s.rough = 0.8;
#elif MAT == 7
  s.alb = vec3(0.03,0.027,0.024)*(0.8+0.4*vnoise(p*12.)); s.rough = 0.75;
#elif MAT == 8
  // Closed shutters: firelight leaks through the cracks between boards.
  vec2 uv = abs(n.x) > abs(n.z) ? p.zy : p.xy;
  float id = floor(uv.x/0.12); float fx = fract(uv.x/0.12);
  float crack = (1.-smoothstep(0.0,0.08,fx)) + (1.-smoothstep(1.0,0.92,fx));
  crack *= 0.6 + 0.4*vnoise(vec3(uv*vec2(3.,9.), id));
  float seed = hash13(floor(p*0.5));
  float fl = 0.7 + 0.3*vnoise(vec3(uTime*2.2+seed*40., seed, 0.));
  s.alb = vec3(0.07,0.045,0.025)*(0.7+0.5*vnoise(vec3(uv.x*50., uv.y*1.5, id)));
  s.emi = mix(vec3(1.0,0.35,0.08), vec3(1.0,0.55,0.2), seed) * crack * fl * 3.0;
  s.rough = 0.9;
#elif MAT == 11
  s.alb = vec3(0.05,0.035,0.025)*(0.75+0.4*vnoise(p*vec3(25.,6.,25.))); s.rough = 1.0;
#elif MAT == 15
  vec3 v = voronoi(p.xz*14.);
  float hot = smoothstep(0.1,0.0,v.x-0.05) + 0.5*(1.-smoothstep(0.0,0.25,v.y-v.x));
  float fl = 0.6+0.4*vnoise(vec3(p.xz*6., uTime*1.5));
  s.alb = vec3(0.02);
  s.emi = mix(vec3(0.9,0.12,0.02), vec3(1.0,0.45,0.1), v.z) * (1.-hot*0.8) * fl * 3.0;
  s.rough = 1.0;
#elif MAT == 16
  float m = vnoise(p*vec3(30.,8.,30.));
  float fl = 0.75+0.25*vnoise(vec3(uTime*3.+p.x*20., p.z, 0.));
  s.alb = vec3(0.1,0.06,0.02);
  s.emi = vec3(1.0,0.48,0.14)*(0.4+0.8*m)*fl*1.6;
  s.rough = 0.6;
#elif MAT == 17
  s.alb = vec3(0.24,0.12,0.07)*(0.7+0.4*vnoise(p*30.)); s.rough = 0.9;
#elif MAT == 18
  s.alb = mix(vec3(0.09,0.06,0.03), vec3(0.06,0.09,0.07), smoothstep(0.4,0.7,vnoise(p*12.)));
  s.rough = 0.7;
#endif
  return s;
}
`;
